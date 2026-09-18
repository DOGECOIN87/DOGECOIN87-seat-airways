/**
 * The checks that decide whether a write is genuine.
 *
 * Split out from the Worker deliberately: there is nothing Cloudflare-shaped
 * in here, so it can be run and tested directly — and this is the code that
 * decides whether a stranger can put an image on somebody else's seat. Code
 * like that should not only be reachable through a deployed service.
 */

/* ── base58, because Solana speaks it and nothing else here does ────────── */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58].map((c, i) => [c, i]));

export function fromBase58(str: string): Uint8Array | null {
  if (!str || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(str)) return null;
  const bytes: number[] = [];
  for (const ch of str) {
    let carry = B58_MAP.get(ch);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/* ── The checks ─────────────────────────────────────────────────────────── */

/** How far out of date a signature may be. Long enough to read the popup. */
export const MAX_AGE_MS = 5 * 60 * 1000;
/**
 * One publish per wallet per this long, so the wall cannot be flooded.
 * Sixty seconds is not a taste decision: KV refuses an `expirationTtl`
 * below it, so anything shorter throws at write time instead of rate
 * limiting anything.
 */
export const COOLDOWN_SECONDS = 60;
/** A 384px square JPEG is tens of kilobytes. This is generous. */
export const MAX_IMAGE_BYTES = 512 * 1024;

const enc = new TextEncoder();

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The exact text the client signs. Must match `challenge()` in the app. */
export function challenge(owner: string, imageHash: string, issued: string): string {
  return [
    'SEAT AIRLINES',
    'Publish this advert on my seat.',
    '',
    `wallet: ${owner}`,
    `image:  sha256:${imageHash}`,
    `issued: ${issued}`,
  ].join('\n');
}

/** A Solana address is an ed25519 public key, so this is a plain verify. */
export async function verifySignature(owner: string, message: string, signature: string): Promise<boolean> {
  const pub = fromBase58(owner);
  const sig = fromBase58(signature);
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', pub as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sig as BufferSource, enc.encode(message) as BufferSource);
  } catch {
    return false;
  }
}

/**
 * Sniff the real type from the bytes.
 *
 * The declared content type is the uploader's claim, not a fact. Only JPEG
 * and PNG are accepted, and SVG is refused specifically: an SVG is a document
 * that can carry script, and serving one from a domain the site trusts would
 * hand every visitor's session to whoever uploaded it.
 */
export function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

export function decodeDataUrl(value: string): Uint8Array | null {
  const comma = value.indexOf(',');
  if (!value.startsWith('data:') || comma < 0) return null;
  try {
    const binary = atob(value.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/* ── Reading a stored record back ───────────────────────────────────────── */

export interface StoredBanner {
  key: string;
  alt: string;
  href?: string;
  updated: string;
}

/**
 * One `banner:` record, or null if it is not one.
 *
 * The wall is every record read back in a single request, so this function
 * decides whether one bad record costs one advert or all of them. It used to
 * be `KV.get(name, 'json')` inside a `Promise.all`: a single value that was
 * not JSON threw, the throw escaped the route, and Cloudflare answered every
 * visitor with error 1101. The page treats a failed wall as an empty one, so
 * the symptom was every advert on the aircraft vanishing at once — and
 * publishing, which wrote perfectly good records, looking as if it had not
 * saved.
 *
 * So nothing here throws. Not JSON, not an object, no key pointing where the
 * artwork lives: skipped, and the rest of the wall stands.
 */
export function readStoredBanner(raw: string | null): StoredBanner | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== 'string' || !v.key.startsWith('banners/')) return null;
  return {
    key: v.key,
    alt: typeof v.alt === 'string' ? v.alt : '',
    ...(typeof v.href === 'string' ? { href: v.href } : {}),
    updated: typeof v.updated === 'string' ? v.updated : '',
  };
}
