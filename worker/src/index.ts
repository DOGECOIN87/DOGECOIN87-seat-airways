/**
 * The advert server, and the cabin directory.
 *
 * The wall, keyed by wallet:
 *
 *   GET  /banners   the published wall, keyed by wallet
 *   POST /banner    put an advert up, if you can prove the wallet is yours
 *
 * The directory, behind a session that same wallet signature opens:
 *
 *   POST   /session    prove the key, get a bearer token for a day
 *   DELETE /session    hand it back
 *   GET    /directory  every published card
 *   PUT    /profile    publish or amend your own
 *   GET    /messages   your introductions, both directions
 *   POST   /messages   send one
 *
 * ── What this service does not do ─────────────────────────────────────────
 * It does not know which seat anybody is in, and it must not learn. Working
 * that out means the whole seat ladder — ranking, cutoffs, tie-breaks, the
 * cargo-hold rule — and a second copy of that logic would drift from the
 * page's copy the first time either changed. The page already computes the
 * ladder, because computing the ladder is what the page is. So adverts are
 * stored against the wallet that published them and the page decides where
 * they hang.
 *
 * That leaves exactly one question here: is this request really from the
 * wallet it names? Everything below is in service of answering it.
 */

import {
  challenge, decodeDataUrl, imageType, readStoredBanner, sha256Hex, verifySignature,
  MAX_AGE_MS, MAX_IMAGE_BYTES, COOLDOWN_SECONDS, type StoredBanner,
} from './verify';
import {
  bearerToken, isAddress, messageId, mintToken, readMessageBody, readProfileInput,
  signInChallenge, tokenHash,
  MESSAGES_PER_HOUR, MESSAGE_PAGE, SESSION_TTL_MS, SIGNIN_MAX_AGE_MS,
} from './networking';
import { readLadder } from './ladder';
import { canViewContact, zoneRank } from '../../src/lib/seating';

export interface Env {
  BANNERS: KVNamespace;
  /**
   * The cabin directory: profiles, introductions, sessions. Optional.
   *
   * Unbound, the wall works exactly as before and the directory routes say
   * plainly that this deployment has none rather than failing as if the
   * request were wrong. Bind it and apply `migrations/` to turn it on.
   */
  DIRECTORY?: D1Database;
  /**
   * Object storage for the artwork. Optional.
   *
   * Bound, images go to R2 and are served straight from it, which keeps the
   * Worker off the read path entirely — the right answer once there is any
   * traffic. Unbound, they go into KV instead and the Worker serves them.
   *
   * That fallback is not a compromise on correctness, it is a compromise on
   * serving cost, and it exists because enabling R2 requires a payment method
   * even on the free tier. A 384px JPEG is about 30 KB against KV's 25 MB
   * value limit — three orders of magnitude of headroom — so the artwork fits
   * either way and the choice can be deferred.
   *
   * Adding the binding later moves new uploads to R2 with no code change.
   */
  IMAGES?: R2Bucket;
  /** Public base URL images are served from. Only needed with R2. */
  PUBLIC_IMAGE_BASE?: string;
  /**
   * The holder list, as JSON: `[{ address, balance }, …]`.
   *
   * The same feed the page reads, and pointing both at one URL is what keeps
   * the two seating charts identical. Without it the directory cannot tell
   * one cabin from another, so it withholds contact details from everybody
   * but their owner and shows nobody another wallet's conversations.
   */
  HOLDERS_URL?: string;
  /** Must match the page's `VITE_MANIFEST_SIZE`. Defaults to 40, as it does. */
  MANIFEST_SIZE?: string;
  /** How long seating is cached, in milliseconds. Defaults to a minute. */
  LADDER_CACHE_MS?: string;
  /** Solana RPC, used only to check the publisher holds the token at all. */
  RPC_URL?: string;
  /** The token this aircraft is flying. */
  TOKEN_MINT?: string;
  /** Comma-separated origins allowed to call this. */
  ALLOWED_ORIGINS?: string;
}


/** Where the artwork lives, and how to address it. */
const usingR2 = (env: Env) => Boolean(env.IMAGES && env.PUBLIC_IMAGE_BASE);

/** Put the bytes somewhere, and return the URL they will be read back from. */
async function storeImage(
  env: Env,
  request: Request,
  key: string,
  bytes: Uint8Array,
  type: string,
  updated: string,
): Promise<string> {
  if (usingR2(env)) {
    await env.IMAGES!.put(key, bytes as BufferSource, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
    });
  } else {
    // KV holds the bytes, and the content type rides along as metadata so the
    // read path does not have to sniff them again.
    await env.BANNERS.put(`image:${key}`, bytes as unknown as ArrayBuffer, { metadata: { type } });
  }
  return imageUrl(env, request, key, updated);
}

/**
 * The URL an already-stored image is served from.
 *
 * ── Why the key is the hash of the bytes ──────────────────────────────────
 * Keyed by wallet, replacing an advert overwrote it in place and the URL
 * never changed. The bytes are cached, so a holder who put up a second
 * advert was handed the URL their browser had cached for the first: the page
 * showed the *old* picture immediately after a publish they had just signed
 * for. Nothing had failed, and there was no way for the browser to know.
 * They would try again, hit the cooldown, and be told to slow down.
 *
 * Addressing an image by its own content settles that at the storage layer
 * rather than with a query string bolted on the end. Different artwork is a
 * different URL because it is a different image; the same artwork is the
 * same URL, so a re-upload costs nothing and there is no cache to bust. It
 * is also what makes `immutable` honest on the read path: that URL cannot
 * ever mean different bytes.
 *
 * `updated` therefore only reaches records written before this — keys that
 * are not hash-shaped, which still need the version to be re-read.
 */
function imageUrl(env: Env, request: Request, key: string, updated?: string): string {
  const base = usingR2(env)
    ? `${env.PUBLIC_IMAGE_BASE!.replace(/\/$/, '')}/${key}`
    : new URL(`/images/${key}`, request.url).toString();
  const hashKeyed = /^banners\/[0-9a-f]{32}\./.test(key);
  const version = !hashKeyed && updated ? Date.parse(updated) : NaN;
  return Number.isFinite(version) ? `${base}?v=${version}` : base;
}

/**
 * Does this wallet hold the token at all? Storage is not free.
 *
 * Every way of *not getting an answer* is treated as "do not know", and a
 * wallet this cannot judge is let through. That is not laxity, it is the
 * only reading that survives a public RPC: one 429 used to become
 * "That wallet does not hold the token", told to a holder who does, with no
 * way to tell the difference from the page. The check rests on the RPC being
 * both reachable and truthful, so the moment it is neither the honest answer
 * is to stand aside.
 *
 * What this costs if it is wrong is one signed upload of at most half a
 * megabyte from a wallet that proved it owns its own key. What it saves is
 * the wall staying writable through a rate limit. And an advert from a
 * non-holder still never appears: the page hangs adverts off the manifest,
 * so a wallet with no seat has nowhere to hang one.
 */
async function holdsToken(env: Env, owner: string): Promise<boolean> {
  // Unconfigured means "do not check" rather than "refuse everybody", so the
  // service is usable before a mint exists.
  if (!env.RPC_URL || !env.TOKEN_MINT) return true;
  const cachedUntil = ownerCache.get(owner) ?? 0;
  if (cachedUntil > Date.now()) return true;
  try {
    const res = await fetch(env.RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [owner, { mint: env.TOKEN_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    // Rate limited, out of credit, misconfigured, down: not an answer.
    if (!res.ok) return true;
    const body = (await res.json()) as {
      result?: { value?: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] };
    };
    // A JSON-RPC error carries no `result` at all. Absent is unknown; an
    // empty `value` is a real answer, and means no.
    const accounts = body.result?.value;
    if (!Array.isArray(accounts)) return true;
    const valid = accounts.some((a) => (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0) > 0);
    if (valid) ownerCache.set(owner, Date.now() + OWNER_CACHE_MS);
    return valid;
  } catch {
    // An RPC outage should not take the wall offline for everyone.
    return true;
  }
}

/* ── CORS ───────────────────────────────────────────────────────────────── */

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const ok = origin && (allowed.length === 0 || allowed.includes(origin));
  return {
    'access-control-allow-origin': ok && origin ? origin : allowed[0] ?? '*',
    'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/* ── The wall ───────────────────────────────────────────────────────────── */

/* Every published advert, in one record.

   GET /banners used to list() the namespace and read each record, on every
   page view. KV's free plan allows 1,000 list() calls a day, and launch
   traffic spent them: from then on the handler threw "KV list() limit
   exceeded for the day", the response went out as Cloudflare's CORS-less
   1101 page, and every visitor saw house adverts. A page view is now one
   get(), against a limit of 100,000.

   Uploads update the index directly; the warm Worker isolate keeps a short
   snapshot so repeated reads do not hit KV. Entries go through
   readStoredBanner on the way out, so one malformed entry costs one advert,
   as it did before. */
const WALL_KEY = 'wall';
type Wall = Record<string, StoredBanner>;
const MAX_REQUEST_BYTES = 1_500_000;
const WALL_CACHE_MS = 30_000;
const OWNER_CACHE_MS = 45_000;
let wallSnapshot: { value: Wall; expiresAt: number } | undefined;
const ownerCache = new Map<string, number>();

async function readWall(env: Env): Promise<Wall> {
  if (wallSnapshot && wallSnapshot.expiresAt > Date.now()) return wallSnapshot.value;
  const raw = await env.BANNERS.get(WALL_KEY).catch(() => null);
  if (!raw) {
    wallSnapshot = { value: {}, expiresAt: Date.now() + WALL_CACHE_MS };
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    wallSnapshot = { value: {}, expiresAt: Date.now() + WALL_CACHE_MS };
    return {};
  }
  if (!parsed || typeof parsed !== 'object') {
    wallSnapshot = { value: {}, expiresAt: Date.now() + WALL_CACHE_MS };
    return {};
  }
  const wall: Wall = {};
  for (const [owner, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const stored = readStoredBanner(JSON.stringify(entry));
    if (stored) wall[owner] = stored;
  }
  wallSnapshot = { value: wall, expiresAt: Date.now() + WALL_CACHE_MS };
  return wall;
}

async function addToWall(env: Env, owner: string, stored: StoredBanner): Promise<void> {
  const wall = await readWall(env);
  wall[owner] = stored;
  await env.BANNERS.put(WALL_KEY, JSON.stringify(wall));
  wallSnapshot = { value: wall, expiresAt: Date.now() + WALL_CACHE_MS };
}

function wallEtag(wall: Wall): string {
  const newest = Object.values(wall).reduce((max, item) => Math.max(max, Date.parse(item.updated) || 0), 0);
  return `"${Object.keys(wall).length}-${newest}"`;
}

/* ── The cabin directory ────────────────────────────────────────────────────
   Profiles and introductions, in SQL, because they are rows: one card per
   wallet, and messages read back by recipient and by sender.

   What this service still does not know is which seat anybody is in. The page
   decides that, as it does for adverts, and the section perks — contacts
   surfaced to your own section, introductions between First Class members —
   are the page's reading of the manifest it already holds.

   The lines this service does draw are the two it can hold on its own:

     · Nothing here is readable without a session, and a session is only
       opened by a wallet that proved its key *and* holds the token. The
       directory is a room for holders because a non-holder never gets a
       token to ask with. (`holdsToken` stands aside when it cannot reach the
       RPC to find out — see its own note on why that is the honest failure.)
     · Inside that room the cabin decides the rest, and it is transparent
       looking aft and opaque looking forward: contact details go to your own
       section and everything behind it, conversations are readable by the
       two wallets on them and by any section ahead of both. `ladder.ts` says
       how this side comes to know which is which without keeping a second
       copy of the seating. */

interface ProfileRow {
  address: string;
  display_name: string;
  role: string;
  email: string;
  website: string;
  linkedin: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  sender: string;
  recipient: string;
  body: string;
  sent_at: string;
}

/**
 * A card as the asking wallet is allowed to see it.
 *
 * Name and role are the roster, and the roster is the whole cabin's. The
 * contact details are the perk, and they go no further forward than the
 * person asking: your own section and everything behind it. `readable` says
 * which of the two this is, so the page can tell "nothing to show" from
 * "not yours to see".
 */
const asProfile = (row: ProfileRow, readable: boolean) => ({
  address: row.address,
  displayName: row.display_name,
  role: row.role,
  email: readable ? row.email : '',
  website: readable ? row.website : '',
  linkedin: readable ? row.linkedin : '',
  readable,
  updated: row.updated_at,
});

const asMessage = (row: MessageRow) => ({
  id: row.id,
  from: row.sender,
  to: row.recipient,
  body: row.body,
  sentAt: row.sent_at,
});

/** The wallet behind a bearer token, or null if there is not one. */
async function sessionAddress(db: D1Database, request: Request): Promise<string | null> {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return null;
  const row = await db
    .prepare('SELECT address, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await tokenHash(token))
    .first<{ address: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row.address;
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

export default {
  /* An uncaught exception goes out as Cloudflare's error page, which carries
     no CORS headers, so the browser reports a CORS failure and the real cause
     is invisible from the site. Answer with JSON and CORS instead. */
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e);
      return json({ error: 'Something went wrong on our side.' }, 500, corsHeaders(env, request.headers.get('origin')));
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get('origin'));

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Keep oversized bodies out of parsing and signature verification. The
    // client sends a compressed 384px image, so this is intentionally well
    // above the 512 KiB stored-image limit while still bounding an abuse case.
    const contentLength = Number(request.headers.get('content-length'));
    const writes = request.method === 'POST' || request.method === 'PUT';
    if (writes && Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json({ error: 'That request is too large.' }, 413, cors);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: 'seat-airlines-banners',
        storage: usingR2(env) ? 'r2' : 'kv',
        directory: Boolean(env.DIRECTORY),
        // Whether this deployment can tell one cabin from another at all.
        sections: Boolean(env.HOLDERS_URL),
      }, 200, { ...cors, 'cache-control': 'no-store' });
    }

    /* ── The directory ──────────────────────────────────────────────────
       Nothing below is cacheable: every response is either a credential or
       somebody's private correspondence. */
    const directoryRoute = ['/session', '/directory', '/profile', '/messages'].includes(url.pathname);
    if (directoryRoute) {
      const db = env.DIRECTORY;
      if (!db) {
        return json({ error: 'This deployment has no cabin directory configured.' }, 503, cors);
      }
      const priv = { ...cors, 'cache-control': 'no-store' };

      /* Opening a session. The one route here that a signature reaches; every
         other one is the token it hands back. */
      if (request.method === 'POST' && url.pathname === '/session') {
        let body: { address?: unknown; issued?: unknown; signature?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: 'That request was not JSON.' }, 400, priv);
        }

        const address = isAddress(body.address) ? body.address : '';
        const issued = typeof body.issued === 'string' ? body.issued : '';
        const signature = typeof body.signature === 'string' ? body.signature : '';
        if (!address || !issued || !signature) {
          return json({ error: 'That sign-in was missing something.' }, 400, priv);
        }

        const at = Date.parse(issued);
        if (!Number.isFinite(at) || Math.abs(Date.now() - at) > SIGNIN_MAX_AGE_MS) {
          return json({ error: 'That signature has expired. Try again.' }, 400, priv);
        }

        if (!(await verifySignature(address, signInChallenge(address, issued), signature))) {
          return json({ error: 'That signature does not match the wallet.' }, 401, priv);
        }

        /* Spend the signature. It stays valid for five minutes, so without
           this a captured one is a second token for somebody else. */
        const spent = await db
          .prepare('INSERT OR IGNORE INTO signins (address, issued, expires_at) VALUES (?, ?, ?)')
          .bind(address, issued, at + SIGNIN_MAX_AGE_MS)
          .run();
        if (!spent.meta.changes) {
          return json({ error: 'That sign-in has already been used. Try again.' }, 401, priv);
        }

        if (!(await holdsToken(env, address))) {
          return json({ error: 'That wallet does not hold the token.' }, 403, priv);
        }

        const token = mintToken();
        const expires = Date.now() + SESSION_TTL_MS;
        await db.batch([
          db.prepare('INSERT INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)')
            .bind(await tokenHash(token), address, expires),
          // Nothing else sweeps these up, and a sign-in is the moment there is
          // already a write in flight.
          db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
          db.prepare('DELETE FROM signins WHERE expires_at < ?').bind(Date.now()),
        ]);

        return json({ token, address, expires }, 200, priv);
      }

      if (request.method === 'DELETE' && url.pathname === '/session') {
        const token = bearerToken(request.headers.get('authorization'));
        if (token) {
          await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
        }
        return json({ ok: true }, 200, priv);
      }

      const me = await sessionAddress(db, request);
      if (!me) return json({ error: 'Sign in to read the cabin directory.' }, 401, priv);

      if (request.method === 'GET' && url.pathname === '/directory') {
        const ladder = await readLadder(env);
        const mine = ladder.zoneOf(me);

        /* Only the aircraft, and only ever the aircraft.

           The roster the page draws is the manifest, so a card belonging to a
           wallet that has dropped off it is one nobody can see — and a row
           nobody can see is a row not worth reading out of the database. This
           used to be the last 500 cards written, which fetched the hold's
           and then quietly declined to show them. Your own card is always in
           the list, seated or not, because you are allowed to edit it after
           being out-held. */
        const wanted = [...new Set([...ladder.seated(), me])];
        const holes = wanted.map(() => '?').join(',');
        const { results } = await db
          .prepare(
            'SELECT address, display_name, role, email, website, linkedin, updated_at' +
            ` FROM profiles WHERE address IN (${holes}) ORDER BY updated_at DESC`,
          )
          .bind(...wanted)
          .all<ProfileRow>();

        const out: Record<string, ReturnType<typeof asProfile>> = {};
        for (const row of results ?? []) {
          const readable = row.address === me
            || (ladder.live && canViewContact(mine, ladder.zoneOf(row.address)));
          out[row.address] = asProfile(row, readable);
        }
        return json(out, 200, priv);
      }

      if (request.method === 'PUT' && url.pathname === '/profile') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'That request was not JSON.' }, 400, priv);
        }
        const parsed = readProfileInput(body);
        if ('error' in parsed) return json({ error: parsed.error }, 400, priv);

        const updated = new Date().toISOString();
        const { profile } = parsed;
        await db
          .prepare(
            'INSERT INTO profiles (address, display_name, role, email, website, linkedin, updated_at)' +
            ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
            ' ON CONFLICT(address) DO UPDATE SET display_name = excluded.display_name,' +
            ' role = excluded.role, email = excluded.email, website = excluded.website,' +
            ' linkedin = excluded.linkedin, updated_at = excluded.updated_at',
          )
          .bind(me, profile.displayName, profile.role, profile.email, profile.website, profile.linkedin, updated)
          .run();

        return json({ ...profile, address: me, updated }, 200, priv);
      }

      if (request.method === 'GET' && url.pathname === '/messages') {
        const columns = 'SELECT id, sender, recipient, body, sent_at FROM messages';
        const [inbox, sent] = await db.batch<MessageRow>([
          db.prepare(`${columns} WHERE recipient = ? ORDER BY sent_at DESC LIMIT ?`).bind(me, MESSAGE_PAGE),
          db.prepare(`${columns} WHERE sender = ? ORDER BY sent_at DESC LIMIT ?`).bind(me, MESSAGE_PAGE),
        ]);

        /* What carries forward from further aft.

           The cabin is transparent looking backwards and opaque looking
           forwards: a holder reads the conversations of every section behind
           them, and none of the one they are in or ahead of it.

           Named as the people it covers rather than as everybody it does not.
           "Neither end is in front of me" would also sweep in the hold, whose
           wallets are on no manifest and no roster and have no name the page
           could put to them — two strangers the reader cannot see, talking.
           Nobody is owed that, and it is a table scan to fetch it. So the
           question asked is the small one: both ends seated, both behind me.

           Unseated yourself, you overhear nothing. */
        let overheard: MessageRow[] = [];
        const ladder = await readLadder(env);
        const mine = ladder.zoneOf(me);
        if (ladder.live && mine) {
          const behind = ladder.seatedBehind(mine);
          if (behind.length) {
            const holes = behind.map(() => '?').join(',');
            const rows = await db
              .prepare(
                `${columns} WHERE sender IN (${holes}) AND recipient IN (${holes})` +
                ' ORDER BY sent_at DESC LIMIT ?',
              )
              .bind(...behind, ...behind, MESSAGE_PAGE)
              .all<MessageRow>();
            overheard = rows.results ?? [];
          }
        }

        return json({
          inbox: (inbox.results ?? []).map(asMessage),
          sent: (sent.results ?? []).map(asMessage),
          overheard: overheard.map(asMessage),
        }, 200, priv);
      }

      if (request.method === 'POST' && url.pathname === '/messages') {
        let body: { to?: unknown; body?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: 'That request was not JSON.' }, 400, priv);
        }

        const to = isAddress(body.to) ? body.to : '';
        if (!to) return json({ error: 'That is not a wallet address.' }, 400, priv);
        if (to === me) return json({ error: 'That message is addressed to you.' }, 400, priv);

        const parsed = readMessageBody(body.body);
        if ('error' in parsed) return json({ error: parsed.error }, 400, priv);

        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await db
          .prepare('SELECT COUNT(*) AS sent FROM messages WHERE sender = ? AND sent_at > ?')
          .bind(me, hourAgo)
          .first<{ sent: number }>();
        if ((recent?.sent ?? 0) >= MESSAGES_PER_HOUR) {
          return json({ error: 'That is enough introductions for one hour.' }, 429, priv);
        }

        const message = { id: messageId(), from: me, to, body: parsed.body, sentAt: new Date().toISOString() };
        await db
          .prepare('INSERT INTO messages (id, sender, recipient, body, sent_at) VALUES (?, ?, ?, ?, ?)')
          .bind(message.id, message.from, message.to, message.body, message.sentAt)
          .run();

        return json(message, 200, priv);
      }

      return json({ error: `${request.method} is not allowed on ${url.pathname}.` }, 405, priv);
    }

    if (request.method === 'GET' && url.pathname === '/banners') {
      const wall = await readWall(env);
      const etag = wallEtag(wall);
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { ...cors, etag, 'cache-control': 'public, max-age=30, stale-while-revalidate=120' } });
      }
      const out: Record<string, { image: string; alt: string; href?: string }> = {};
      for (const [owner, stored] of Object.entries(wall)) {
        out[owner] = {
          image: imageUrl(env, request, stored.key, stored.updated),
          alt: stored.alt,
          ...(stored.href ? { href: stored.href } : {}),
        };
      }
      return json(out, 200, {
        ...cors,
        // The wall is read constantly and written rarely.
        etag,
        'cache-control': 'public, max-age=30, stale-while-revalidate=120',
      });
    }

    if (request.method === 'POST' && url.pathname === '/banner') {
      let body: {
        owner?: unknown; image?: unknown; alt?: unknown;
        href?: unknown; issued?: unknown; signature?: unknown;
      };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'That request was not JSON.' }, 400, cors);
      }

      const owner = typeof body.owner === 'string' ? body.owner : '';
      const image = typeof body.image === 'string' ? body.image : '';
      const issued = typeof body.issued === 'string' ? body.issued : '';
      const signature = typeof body.signature === 'string' ? body.signature : '';
      const alt = typeof body.alt === 'string' ? body.alt.slice(0, 280) : '';
      const href = typeof body.href === 'string' ? body.href.slice(0, 500) : undefined;

      if (!owner || !image || !issued || !signature) {
        return json({ error: 'That request was missing something.' }, 400, cors);
      }

      // Time first: it is the cheapest check and it bounds replay.
      const at = Date.parse(issued);
      if (!Number.isFinite(at) || Math.abs(Date.now() - at) > MAX_AGE_MS) {
        return json({ error: 'That signature has expired. Try again.' }, 400, cors);
      }

      const bytes = decodeDataUrl(image);
      if (!bytes) return json({ error: 'That image could not be decoded.' }, 400, cors);
      if (bytes.length > MAX_IMAGE_BYTES) {
        return json({ error: 'That image is too large.' }, 413, cors);
      }
      const type = imageType(bytes);
      if (!type) return json({ error: 'Adverts must be JPEG, PNG, or WebP.' }, 415, cors);

      // The signature authorises *this* image, not merely this wallet.
      const hash = await sha256Hex(bytes);
      if (!(await verifySignature(owner, challenge(owner, hash, issued), signature))) {
        return json({ error: 'That signature does not match the wallet.' }, 401, cors);
      }

      const cooldownKey = `cooldown:${owner}`;
      if (await env.BANNERS.get(cooldownKey)) {
        return json({ error: 'Slow down a moment, then try again.' }, 429, cors);
      }

      if (!(await holdsToken(env, owner))) {
        return json({ error: 'That wallet does not hold the token.' }, 403, cors);
      }

      const key = `banners/${hash.slice(0, 32)}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
      // One timestamp, used for both the record and the URL's version, so
      // what the publisher is handed back is the same URL the wall will serve.
      const updated = new Date().toISOString();
      const image_url = await storeImage(env, request, key, bytes, type, updated);
      const stored: StoredBanner = { key, alt, href, updated };
      await env.BANNERS.put(`banner:${owner}`, JSON.stringify(stored));
      await addToWall(env, owner, stored);
      await env.BANNERS.put(cooldownKey, '1', { expirationTtl: COOLDOWN_SECONDS });
      try { await caches.default.delete(new Request(new URL('/banners', request.url).toString())); } catch { /* best effort */ }

      return json({ image: image_url }, 200, cors);
    }

    /* Serving the artwork. Only reachable without R2 — with it, images are
       read straight from the bucket and never touch the Worker.

       This used to send no CORS header at all, on the reasoning that an
       <img> source is not an API and does not need one. That is true of the
       seat map, and false of the cabin: the adverts on the seat-back screens
       are WebGL textures, and three.js asks for every texture with
       crossOrigin="anonymous". A cross-origin image answered without
       access-control-allow-origin is discarded by the browser, so every
       screen in the aeroplane fell back to the airline's mark and nothing
       said why — TextureLoader's failures are silent.

       Wide open rather than the allowlist above, and deliberately so. These
       are public bytes served with no cookies and no credentials, and `*` is
       the header that says exactly that; echoing a single allowed origin
       would hand a cached response to the wrong one. The content type is
       still the one sniffed from the bytes at upload rather than anything a
       request can influence, with nosniff on top.

       HEAD is answered too, because link unfurlers and CDN health checks use
       it, and a 404 to HEAD on a URL that GETs fine reads as a broken image. */
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/images/')) {
      const key = decodeURIComponent(url.pathname.slice('/images/'.length));
      const hit = await env.BANNERS.getWithMetadata<{ type: string }>(`image:${key}`, 'arrayBuffer');
      if (!hit.value) return json({ error: 'No such image.' }, 404, cors);
      const type = hit.metadata?.type === 'image/png' ? 'image/png' : hit.metadata?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      return new Response(request.method === 'HEAD' ? null : hit.value, {
        headers: {
          'content-type': type,
          'content-length': String(hit.value.byteLength),
          'cache-control': /^banners\/[0-9a-f]{32}\./.test(key) ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
          'x-content-type-options': 'nosniff',
          'access-control-allow-origin': '*',
        },
      });
    }

    return json({ error: 'No such route.' }, 404, cors);
}
