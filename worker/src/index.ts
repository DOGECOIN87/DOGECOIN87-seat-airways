/**
 * The advert server.
 *
 * Two routes, and a deliberately small job:
 *
 *   GET  /banners   the published wall, keyed by wallet
 *   POST /banner    put an advert up, if you can prove the wallet is yours
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

export interface Env {
  BANNERS: KVNamespace;
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
 * ── Why there is a version on the end ─────────────────────────────────────
 * The key is the wallet, so replacing an advert overwrites it in place and
 * the URL never changes. That is the right storage shape — one wallet, one
 * advert, nothing to sweep up — and it made publishing look broken.
 *
 * The bytes are served with `max-age=300`. A holder who put up a second
 * advert got back the URL their browser had cached five minutes ago, so the
 * page showed the *old* picture, on the seat, immediately after a successful
 * publish they had just signed for. Nothing had failed; there was simply no
 * way for the browser to know the image behind that URL had changed. So they
 * would try again, hit the sixty-second cooldown, and be told to slow down.
 *
 * The record already carries the time it was written, and that is exactly
 * the fact a cache needs: same advert, same URL, and a new advert is a URL
 * no cache has seen. Both storage backends ignore the query string when
 * looking the bytes up, and both cache on the whole URL including it.
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
    return accounts.some((a) => (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0) > 0);
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
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
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

   list() moves to the upload path, which is rare and rate limited, and only
   to heal the index: anything list() finds that the index is missing gets
   put back. If list() is over its cap too, the index still gains the upload
   that triggered it. Entries go through readStoredBanner on the way out, so
   one malformed entry costs one advert, as it did before. */
const WALL_KEY = 'wall';
type Wall = Record<string, StoredBanner>;

async function readWall(env: Env): Promise<Wall> {
  const raw = await env.BANNERS.get(WALL_KEY).catch(() => null);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const wall: Wall = {};
  for (const [owner, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const stored = readStoredBanner(JSON.stringify(entry));
    if (stored) wall[owner] = stored;
  }
  return wall;
}

async function addToWall(env: Env, owner: string, stored: StoredBanner): Promise<void> {
  const wall = await readWall(env);
  try {
    const list = await env.BANNERS.list({ prefix: 'banner:' });
    const missing = list.keys
      .map(({ name }) => name.slice('banner:'.length))
      .filter((o) => o !== owner && !wall[o]);
    const found = await Promise.all(
      missing.map(async (o) => readStoredBanner(await env.BANNERS.get(`banner:${o}`).catch(() => null))),
    );
    missing.forEach((o, i) => {
      const record = found[i];
      if (record) wall[o] = record;
    });
  } catch {
    // Over the daily list() cap. The index keeps what it had, plus this.
  }
  wall[owner] = stored;
  await env.BANNERS.put(WALL_KEY, JSON.stringify(wall));
}

function wallEtag(wall: Wall): string {
  const newest = Object.values(wall).reduce((max, item) => Math.max(max, Date.parse(item.updated) || 0), 0);
  return `"${Object.keys(wall).length}-${newest}"`;
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
