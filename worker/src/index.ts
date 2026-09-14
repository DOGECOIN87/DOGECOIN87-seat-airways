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

import { challenge, decodeDataUrl, imageType, sha256Hex, verifySignature, MAX_AGE_MS, MAX_IMAGE_BYTES, COOLDOWN_SECONDS } from './verify';

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

/** Stored shape. `key` locates the bytes; `image` is rebuilt on read. */
interface StoredBanner {
  key: string;
  alt: string;
  href?: string;
  updated: string;
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
): Promise<string> {
  if (usingR2(env)) {
    await env.IMAGES!.put(key, bytes as BufferSource, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=300' },
    });
    return `${env.PUBLIC_IMAGE_BASE!.replace(/\/$/, '')}/${key}`;
  }
  // KV holds the bytes, and the content type rides along as metadata so the
  // read path does not have to sniff them again.
  await env.BANNERS.put(`image:${key}`, bytes as unknown as ArrayBuffer, { metadata: { type } });
  return new URL(`/images/${key}`, request.url).toString();
}

/** The URL an already-stored image is served from. */
function imageUrl(env: Env, request: Request, key: string): string {
  return usingR2(env)
    ? `${env.PUBLIC_IMAGE_BASE!.replace(/\/$/, '')}/${key}`
    : new URL(`/images/${key}`, request.url).toString();
}

/** Does this wallet hold the token at all? Storage is not free. */
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
    if (!res.ok) return false;
    const body = (await res.json()) as {
      result?: { value?: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] };
    };
    const accounts = body.result?.value ?? [];
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
    'access-control-allow-methods': 'GET,POST,OPTIONS',
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

/* ── Routes ─────────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get('origin'));

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method === 'GET' && url.pathname === '/banners') {
      const list = await env.BANNERS.list({ prefix: 'banner:' });
      const out: Record<string, { image: string; alt: string; href?: string }> = {};
      await Promise.all(
        list.keys.map(async ({ name }) => {
          const stored = await env.BANNERS.get<StoredBanner>(name, 'json');
          if (!stored) return;
          out[name.slice('banner:'.length)] = {
            image: imageUrl(env, request, stored.key),
            alt: stored.alt,
            ...(stored.href ? { href: stored.href } : {}),
          };
        }),
      );
      return json(out, 200, {
        ...cors,
        // The wall is read constantly and written rarely.
        'cache-control': 'public, max-age=30',
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
      if (!type) return json({ error: 'Adverts must be JPEG or PNG.' }, 415, cors);

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

      const key = `banners/${owner}.${type === 'image/png' ? 'png' : 'jpg'}`;
      const image_url = await storeImage(env, request, key, bytes, type);
      const stored: StoredBanner = { key, alt, href, updated: new Date().toISOString() };
      await env.BANNERS.put(`banner:${owner}`, JSON.stringify(stored));
      await env.BANNERS.put(cooldownKey, '1', { expirationTtl: COOLDOWN_SECONDS });

      return json({ image: image_url }, 200, cors);
    }

    /* Serving the artwork. Only reachable without R2 — with it, images are
       read straight from the bucket and never touch the Worker.

       Deliberately *not* CORS-wrapped: this is an <img> source, not an API,
       and the content type is the one sniffed from the bytes at upload
       rather than anything a request can influence. nosniff on top, so a
       browser cannot be talked into interpreting it as anything else. */
    if (request.method === 'GET' && url.pathname.startsWith('/images/')) {
      const key = decodeURIComponent(url.pathname.slice('/images/'.length));
      const hit = await env.BANNERS.getWithMetadata<{ type: string }>(`image:${key}`, 'arrayBuffer');
      if (!hit.value) return json({ error: 'No such image.' }, 404, cors);
      const type = hit.metadata?.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return new Response(hit.value, {
        headers: {
          'content-type': type,
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    return json({ error: 'No such route.' }, 404, cors);
  },
};
