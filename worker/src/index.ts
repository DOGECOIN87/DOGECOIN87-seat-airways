/**
 * The advert server, and the cabin directory.
 *
 * The wall, keyed by wallet:
 *
 *   GET  /banners   the published wall, keyed by wallet
 *   POST /banner    put an advert up, if you can prove the wallet is yours
 *   GET  /holders   who is aboard, and the supply their bags are shares of
 *   GET  /holding   one wallet's balance, so no page has to carry an RPC key
 *
 * The directory, behind a session that same wallet signature opens:
 *
 *   POST   /session    prove the key, get a bearer token for a day
 *   DELETE /session    hand it back
 *   GET    /directory  every published card
 *   PUT    /profile    publish or amend your own
 *   GET    /messages   your introductions, both directions
 *   POST   /messages   send one, to your own section or one behind it
 *
 * ── What this service knows about seats ───────────────────────────────────
 * For the wall, nothing, and it needs nothing: an advert is stored against
 * the wallet that published it and the page decides where it hangs. That
 * leaves the wall exactly one question — is this request really from the
 * wallet it names? — and the first half of this file answers it.
 *
 * For the directory that is not enough. "Your own section and everything
 * behind it" is a rule about who may read somebody's email address and who
 * may write into their inbox, and a rule enforced in the browser is a
 * suggestion the network tab ignores. So this side works the seating out as
 * well. Not a second copy of it — the drift that would cause is what the
 * refusal was always about — but the page's own module, imported from
 * `src/lib/seating.ts` and fed the page's own holder feed by `ladder.ts`.
 */

import {
  challenge, decodeDataUrl, imageType, readStoredBanner, sha256Hex, verifySignature,
  MAX_AGE_MS, MAX_IMAGE_BYTES, COOLDOWN_SECONDS, type StoredBanner,
} from './verify';
import {
  bearerToken, isAddress, messageId, mintToken, readMessageBody, readProfileInput,
  signInChallenge, tokenHash,
  ANNOUNCEMENTS_PER_DAY, ANNOUNCEMENT_PAGE,
  MESSAGES_PER_HOUR, MESSAGE_PAGE, SESSION_TTL_MS, SIGNIN_MAX_AGE_MS,
} from './networking';
import { cabinSize, canSeat, readLadder, rpcUrl } from './ladder';
import { CABIN_ZONES } from '../../src/content/cabin';
import {
  ANNOUNCEMENT, canAnnounce, canMessage, canPostToChannel, canReadChannel, canViewContact,
  channelFor, zoneOfChannel,
} from '../../src/lib/seating';

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
   * the two seating charts identical. Optional in the same way it is optional
   * for the page: without it the ladder falls back to the twenty largest
   * accounts from `RPC_URL`, which fills the front of the aircraft and leaves
   * the rest empty. With neither, the directory cannot tell one cabin from
   * another and withholds everything but your own card.
   */
  HOLDERS_URL?: string;
  /**
   * Must match the page's `VITE_MANIFEST_SIZE`. Unset, both sides default to
   * the whole aircraft out of the shared seating, which is the one way they
   * cannot disagree.
   */
  MANIFEST_SIZE?: string;
  /** How long seating is cached, in milliseconds. Defaults to a minute. */
  LADDER_CACHE_MS?: string;
  /** Solana RPC, used only to check the publisher holds the token at all. */
  RPC_URL?: string;
  /** The token this aircraft is flying. */
  TOKEN_MINT?: string;
  /** How long a holder check is cached, in milliseconds. Defaults to 45s. */
  OWNER_CACHE_MS?: string;
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
async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T | null> {
  const url = rpcUrl(env);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    // Rate limited, out of credit, misconfigured, down: not an answer.
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T; error?: unknown };
    // A JSON-RPC error carries no `result` at all.
    if (body.error || body.result === undefined) return null;
    return body.result;
  } catch {
    return null;
  }
}

interface TokenAmount { amount: string; decimals: number; uiAmount: number | null }

/** What a wallet holds, and what share of the aircraft that is. */
interface Holding { balance: number; supply: number; share: number }

/**
 * What a wallet holds of the token, in whole tokens.
 *
 * Null is "could not ask", and it is a different answer from zero — which is
 * the whole reason this returns a number or nothing rather than a number that
 * might be a shrug. Telling a holder they hold nothing because an RPC was
 * busy is the failure this shape exists to make impossible.
 *
 * A wallet can hold the same mint across several token accounts, so they are
 * summed: a person with two bags has one bag, of the total size.
 */
async function readBalance(env: Env, owner: string): Promise<number | null> {
  if (!env.TOKEN_MINT) return null;
  const accounts = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: TokenAmount } } } } }[] }>(
    env, 'getTokenAccountsByOwner', [owner, { mint: env.TOKEN_MINT }, { encoding: 'jsonParsed' }],
  );
  if (!accounts || !Array.isArray(accounts.value)) return null;
  return accounts.value.reduce((sum, a) => {
    const t = a.account.data.parsed.info.tokenAmount;
    return sum + (t.uiAmount ?? Number(t.amount) / 10 ** t.decimals);
  }, 0);
}

async function holdsToken(env: Env, owner: string): Promise<boolean> {
  /* Unconfigured means "do not check" rather than "refuse everybody", so the
     service is usable before a mint exists.

     That used to cover a second and much less deliberate case: a deployment
     with a mint but no `RPC_URL`, because the secret is set by hand and
     nobody had. The door stood open and nothing said so. `rpcUrl` answers
     with the public endpoint now, so this reads as it always claimed to —
     there is no token yet. */
  const url = rpcUrl(env);
  if (!url || !env.TOKEN_MINT) return true;
  const cachedUntil = ownerCache.get(owner) ?? 0;
  if (cachedUntil > Date.now()) return true;

  const balance = await readBalance(env, owner);
  /* Null is every way of not getting an answer — a 429, an outage, a JSON-RPC
     error — and a wallet this cannot judge is let through. An empty result is
     a real answer, and means no. */
  if (balance === null) return true;
  if (balance > 0) ownerCache.set(owner, Date.now() + ownerTtl(env));
  return balance > 0;
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
/**
 * How long one wallet's balance is reused.
 *
 * The page re-reads a connected wallet every two minutes, so this is not
 * about staleness — it is about a reload, a second tab, or a wallet switched
 * back and forth not each costing a call.
 */
const HOLDING_CACHE_MS = 20_000;
const holdingCache = new Map<string, { value: Holding; expiresAt: number }>();
/**
 * How long a wallet stays believed to hold the token.
 *
 * Also how long a wallet that has sold everything keeps a session it already
 * opened, which is why it is settable: the route suite has to watch a holder
 * stop being one without sitting through three quarters of a minute.
 */
const OWNER_CACHE_MS = 45_000;
const ownerTtl = (env: Env) => Number(env.OWNER_CACHE_MS || OWNER_CACHE_MS) || OWNER_CACHE_MS;
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

   This service used not to know which seat anybody was in, and this comment
   used to say so: the page decided that, as it does for adverts, and the
   section perks were the page's reading of a manifest it already held. That
   is no longer true, because a perk that is only the page's reading is one
   the network tab helps itself to. The seating is worked out on this side as
   well — from the page's own module rather than a second copy of it — and
   the perks are decided where the rows are.

   The lines this service draws:

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
       copy of the seating.
     · An introduction goes wherever a card can be read — your own section
       and every seated one behind it — and nowhere forward. So a card you can
       read is a card you can answer, and the further forward somebody sits
       the fewer people can write to them at all. The flight deck's inbox
       reaches only the flight deck. */

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

/** The wallet a bearer token stands for, or null if it stands for nobody. */
async function sessionAddress(db: D1Database, token: string): Promise<string | null> {
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
      /* `sections` is the field somebody curls this route to read, and it
         used to answer a different question than the one being asked.
         `canSeat` is true the moment a mint is set, so a deployment whose
         endpoint refuses the holder scan reported `sections: true` while
         withholding every contact detail from everybody and refusing every
         introduction with a 503. A health check that reports the healthy
         answer during precisely the failure it exists to surface is worse
         than not having one, because it is believed.

         So the seating is read here rather than assumed. `readLadder` is the
         same cached call the directory already makes on every request: a warm
         isolate answers from memory, and a cold one pays for one read per
         `LADDER_CACHE_MS` — the read the next visitor would have paid for
         anyway. If that read is slow then the directory is slow, which is a
         thing to learn from a health check rather than have hidden by one.

         `ok` stays a statement about the Worker itself, so "up but seating
         nobody" and "down" remain different answers to different questions. */
      const ladder = await readLadder(env);
      return json({
        ok: true,
        service: 'seat-airlines-banners',
        storage: usingR2(env) ? 'r2' : 'kv',
        directory: Boolean(env.DIRECTORY),
        // Whether the cabins can be told apart *right now* — the thing that
        // decides whether a card shows contact details or an introduction
        // sends, asked of the ladder that decides it.
        sections: ladder.live,
        // And whether anything was ever configured to tell them apart, which
        // is what separates "nobody set a mint or a feed" from "the endpoint
        // refused". Two causes, two fixes, so they are two fields.
        configured: canSeat(env),
        /* How much of the aircraft actually filled. `sections: true` with
           `seated: 20` out of `cabin: 178` is the quiet failure this pair
           exists to make loud: a directory that works perfectly for the
           twenty largest holders and does not exist for anybody else. It is
           what a deployment falling back to `getTokenLargestAccounts` looks
           like, which is what an unset `RPC_URL` looks like. */
        seated: ladder.seated().length,
        cabin: cabinSize(env),
      }, 200, { ...cors, 'cache-control': 'no-store' });
    }

    /* Who is aboard, as an indexer would put it.

       The page reads the same list this side seats people from, which is the
       thing that has mattered most all along: two readings of "who is aboard"
       are two aircraft, and this one decides who may read whose card.

       It is also what keeps the chain scan affordable. Getting the whole
       holder list out of a plain RPC means asking the token program for every
       account it owns for this mint — not capped at twenty, and not cheap —
       and doing that in the page would mean one scan per visitor every ninety
       seconds. Done here it is one scan a minute for everybody, already
       cached, already filtered of contracts.

       Public, and nothing is given away by it: these are the wallets the seat
       map draws on screen. Empty when this deployment cannot read holders at
       all, which the page reads as "no indexer" and falls back to its own RPC
       for, exactly as it did before there was one. */
    if (request.method === 'GET' && url.pathname === '/holders') {
      const ladder = await readLadder(env);
      /* The supply rides along because the page needs both in the same breath
         — a bag is only interesting as a share of something — and because it
         is the second thing the page used to open an RPC of its own for. */
      return json({ holders: ladder.holders, supply: ladder.supply }, 200, {
        ...cors,
        'cache-control': 'public, max-age=30, stale-while-revalidate=120',
      });
    }

    /* One wallet's balance.

       ── Why the page does not read this itself ────────────────────────────
       It used to, and that is why `VITE_RPC_URL` existed. Vite inlines every
       VITE_ value into the bundle it ships, so an endpoint carrying an API
       key — which is what a paid RPC is — was readable by anyone who opened
       the site. The documented defence was to restrict the key by domain at
       the provider, and that defence is the `Origin` header: a string anybody
       with curl can type. It stops a copy-paste, not a script.

       The key lives here instead, where it is a Worker secret and never
       leaves. What the browser gets is this: a balance, a supply, and a
       share, all of them public on-chain facts about a wallet the page is
       already drawing on a seat map.

       It is also cheaper by the same argument as `/holders`. One reload of
       the page is no longer one RPC call; a hundred visitors are not a
       hundred callers of somebody's metered endpoint.

       A failure answers 503 rather than a zero balance. Telling a holder
       they hold nothing because an endpoint was busy would reseat them into
       the hold, announce it over the PA, and close every card in the cabin
       to them — all of it wrong, and all of it silent. */
    if (request.method === 'GET' && url.pathname === '/holding') {
      const address = url.searchParams.get('address') ?? '';
      if (!isAddress(address)) return json({ error: 'That is not a wallet address.' }, 400, cors);

      const cached = holdingCache.get(address);
      if (cached && cached.expiresAt > Date.now()) {
        return json(cached.value, 200, { ...cors, 'cache-control': 'public, max-age=20' });
      }

      const balance = await readBalance(env, address);
      if (balance === null) {
        return json({ error: 'The chain could not be asked just now.' }, 503, { ...cors, 'cache-control': 'no-store' });
      }

      /* The supply the seating was read with, rather than a second call for a
         number that changes about as often as the mint does. */
      const ladder = await readLadder(env);
      const supply = ladder.supply
        || (await rpc<{ value: TokenAmount }>(env, 'getTokenSupply', [env.TOKEN_MINT]))?.value.uiAmount
        || 0;

      const value: Holding = { balance, supply, share: supply > 0 ? balance / supply : 0 };
      holdingCache.set(address, { value, expiresAt: Date.now() + HOLDING_CACHE_MS });
      return json(value, 200, { ...cors, 'cache-control': 'public, max-age=20' });
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

      const token = bearerToken(request.headers.get('authorization'));
      const me = token ? await sessionAddress(db, token) : null;
      if (!token || !me) return json({ error: 'Sign in to read the cabin directory.' }, 401, priv);

      /* Still aboard?

         A session lasts a day, and a bag can be gone in a minute. Most of
         what selling up should cost somebody the seating already takes care
         of: drop off the manifest and the ladder puts you in the hold within
         its cache, so contact details close, conversations stop carrying,
         and no introduction will send. But the door itself was checked once,
         at sign-in, and never again — so a wallet that sold everything kept
         the roster for up to twenty-four hours, and the roster is most of
         what the room is for.

         So the door's own check is made again here, against the same cache
         that keeps it from being an RPC call per request. It stands aside
         when the chain cannot answer, exactly as it does at sign-in — an
         outage should not empty the cabin — and when it does answer no, the
         session row goes too, so the page is told to sign in again rather
         than left retrying a token that will never work again.

         Being out-held is not selling. A holder who still holds anything
         keeps their session, their card, and their inbox; they are in the
         hold, which is part of this aeroplane. */
      if (!(await holdsToken(env, me))) {
        await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
        return json({ error: 'That wallet no longer holds the token.' }, 401, priv);
      }

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
        /* `sent` is the outbox of *introductions*, so the rooms are kept out
           of it: a line said in your own section is not a letter you wrote,
           and it comes back in `channels` already, with everyone else's. */
        const [inbox, sent] = await db.batch<MessageRow>([
          db.prepare(`${columns} WHERE recipient = ? ORDER BY sent_at DESC LIMIT ?`).bind(me, MESSAGE_PAGE),
          db.prepare(
            `${columns} WHERE sender = ? AND recipient NOT LIKE 'section:%' AND recipient <> ?` +
            ' ORDER BY sent_at DESC LIMIT ?',
          ).bind(me, ANNOUNCEMENT, MESSAGE_PAGE),
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

        /* The rooms.

           One channel per cabin, and a holder reads their own and every one
           behind it — the same line as a contact card. Asked as one statement
           per channel rather than one for all of them, so a busy Economy
           cannot crowd the flight deck's own room out of its own page. At
           most five of them, and each is an index seek on
           `messages_by_recipient`.

           Cabins with somebody in them, not cabins the aircraft has. An empty
           cabin's room is necessarily empty — there is nobody seated there to
           have said anything — so asking after it is a query whose answer is
           known in advance, and handing the page back `economy: []` on a
           five-person aeroplane is a room it would draw and nobody could ever
           be in. The same reasoning the roster and the header already use.

           The PA is not one of these: it is one line from the flight deck
           that the whole aeroplane hears, the hold included. Being aboard is
           the only qualification for hearing it. */
        const occupied = new Set(ladder.seated().map((address) => ladder.zoneOf(address)));
        const readable = ladder.live && mine
          ? CABIN_ZONES.map((z) => z.key).filter((zone) => canReadChannel(mine, zone) && occupied.has(zone))
          : [];

        const roomRows = readable.length
          ? await db.batch<MessageRow>(readable.map((zone) => db
            .prepare(`${columns} WHERE recipient = ? ORDER BY sent_at DESC LIMIT ?`)
            .bind(channelFor(zone), MESSAGE_PAGE)))
          : [];
        const channels: Record<string, ReturnType<typeof asMessage>[]> = {};
        readable.forEach((zone, i) => {
          channels[zone] = (roomRows[i]?.results ?? []).map(asMessage);
        });

        const pa = await db
          .prepare(`${columns} WHERE recipient = ? ORDER BY sent_at DESC LIMIT ?`)
          .bind(ANNOUNCEMENT, ANNOUNCEMENT_PAGE)
          .all<MessageRow>();

        return json({
          inbox: (inbox.results ?? []).map(asMessage),
          sent: (sent.results ?? []).map(asMessage),
          overheard: overheard.map(asMessage),
          channels,
          announcements: (pa.results ?? []).map(asMessage),
        }, 200, priv);
      }

      if (request.method === 'POST' && url.pathname === '/messages') {
        let body: { to?: unknown; body?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: 'That request was not JSON.' }, 400, priv);
        }

        /* Three things can be written to: a person, a section's room, and the
           PA. They share this route because they share a table and a rule —
           the seating decides all three — and splitting them into three
           routes would be three places for that rule to drift. */
        const to = typeof body.to === 'string' ? body.to : '';
        const room = zoneOfChannel(to);
        const announcing = to === ANNOUNCEMENT;
        if (!room && !announcing) {
          if (!isAddress(to)) return json({ error: 'That is not a wallet address or a cabin.' }, 400, priv);
          if (to === me) return json({ error: 'That message is addressed to you.' }, 400, priv);
        }

        const parsed = readMessageBody(body.body);
        if ('error' in parsed) return json({ error: parsed.error }, 400, priv);

        /* Who may say this, asked of the seating rather than of the composer.

           The page hides a composer it knows would be refused, and for a
           while that was the whole of the rule: this route took an
           introduction from anybody holding a session, so one fetch wrote a
           note into an inbox the sender could not otherwise reach. Reads were
           enforced here; writes were on trust.

           Every one of these is a function out of the file both sides import,
           so what the composer offers and what this accepts cannot come
           apart. Asked after the message has been read and before the rate
           limit, which is the first thing here that costs a query. */
        const ladder = await readLadder(env);
        if (!ladder.live) {
          /* With no holder feed every wallet reads as unseated, so the rules
             below would refuse everybody — correctly, but for a reason that
             is about this deployment rather than about them. Say the true
             one. It fails closed, as the rest of the directory does when it
             cannot tell the cabins apart: `HOLDERS_URL`, or `RPC_URL` with
             `TOKEN_MINT`, is what turns any of this on. */
          return json({ error: 'The cabin cannot tell which section you are in right now.' }, 503, priv);
        }
        const mine = ladder.zoneOf(me);

        if (announcing && !canAnnounce(mine)) {
          return json({ error: 'The PA belongs to the flight deck.' }, 403, priv);
        }
        if (room && !canPostToChannel(mine, room)) {
          /* Readable is not the same as postable here, and this is the one
             place those two come apart. A cabin's conversation belongs to the
             people sitting in it; the rows in front can listen, and can write
             to anybody in it personally, but cannot talk in the room. */
          return json({
            error: canReadChannel(mine, room)
              ? 'You can read that cabin, but its conversation belongs to the people sitting in it.'
              : 'That cabin is ahead of yours.',
          }, 403, priv);
        }
        if (!room && !announcing && !canMessage(mine, ladder.zoneOf(to), me, to)) {
          return json({ error: 'That cabin is ahead of yours. Introductions carry aft, never forward.' }, 403, priv);
        }

        /* The PA is rationed by the day rather than by the hour, because a
           thing said once a day is listened to and a thing said twenty times
           is weather. The boarding pass has promised exactly this since
           before the directory existed. */
        if (announcing) {
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const already = await db
            .prepare('SELECT COUNT(*) AS said FROM messages WHERE sender = ? AND recipient = ? AND sent_at > ?')
            .bind(me, ANNOUNCEMENT, dayAgo)
            .first<{ said: number }>();
          if ((already?.said ?? 0) >= ANNOUNCEMENTS_PER_DAY) {
            return json({ error: 'One announcement a day. Use it well.' }, 429, priv);
          }
        }

        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await db
          .prepare('SELECT COUNT(*) AS sent FROM messages WHERE sender = ? AND sent_at > ?')
          .bind(me, hourAgo)
          .first<{ sent: number }>();
        if ((recent?.sent ?? 0) >= MESSAGES_PER_HOUR) {
          return json({ error: 'That is enough for one hour.' }, 429, priv);
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
