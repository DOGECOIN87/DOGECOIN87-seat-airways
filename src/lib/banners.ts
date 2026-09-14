/**
 * The advertising surface.
 *
 * Every seat on the map is a square, and a square somebody has paid for is a
 * billboard. A holder who has a seat can put a 1:1 image on it; the map then
 * reads as a mosaic of them, with the best-placed ads in the front rows —
 * which is the point. Position is earned by holding, not bought, so the
 * inventory prices itself.
 *
 * The aspect ratio is enforced rather than requested: anything dropped in is
 * centre-cropped to a square and re-encoded, so no upload can stretch the
 * grid or blow up the payload.
 *
 * ── Where these live ──────────────────────────────────────────────────────
 * Three sources, in increasing order of authority.
 *
 * `localStorage`, which is what an upload does when nothing else is
 * configured: the banner stays in the browser that set it, and the UI says
 * so rather than implying the wall has changed for anyone else.
 *
 *   VITE_BANNERS_API=https://…      self-serve, signed, keyed by wallet
 *   VITE_BANNERS_URL=https://….json curated, read-only, keyed by seat
 *
 * The API is the production path and the one holders use. Note what it is
 * keyed by: **the wallet, not the seat.**
 *
 * That is the decision this whole module turns on. Keying by seat would mean
 * the server had to know who holds seat 3A, which means re-deriving the
 * entire seat ladder server-side — the same ranking, the same cutoffs, the
 * same tie-breaks — and keeping that copy in step with this one forever.
 * Keyed by wallet, the server's only job is to prove you are the wallet you
 * claim to be. The page already knows which seat a wallet sits in, because
 * working that out is the thing the page does.
 *
 * It falls out better as product, too: get out-held and reseated from 3A to
 * 7C and your advert moves with you, because it was never attached to 3A.
 * Drop off the manifest entirely and it comes down on its own.
 */

import { MARK_PATH } from '../components/Mark';

export interface Banner {
  /** A square image: an https URL, or a data URI from a local upload. */
  image: string;
  /** What the advert says, for anyone who cannot see it. */
  alt: string;
  /** Where it points. Only http(s) is followed. */
  href?: string;
  /** True when it came from the published set rather than this browser. */
  published?: boolean;
  /** True for the airline's own creative, standing in until a holder buys it. */
  house?: boolean;
  /** The wallet that published it, when it came from the signed API. */
  owner?: string;
}

export type BannerSet = Readonly<Record<string, Banner>>;

const KEY = 'seat-airlines.banners.v1';
const REMOTE = import.meta.env.VITE_BANNERS_URL as string | undefined;
const API = (import.meta.env.VITE_BANNERS_API as string | undefined)?.replace(/\/$/, '');

/** True when holders can publish for themselves rather than only locally. */
export const canPublish = Boolean(API);

/** The longest side of a stored banner, and the JPEG quality it keeps. */
export const BANNER_SIZE = 384;
const QUALITY = 0.82;
/** Refuse anything that would bloat storage even after re-encoding. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** How long to wait for a browser to decode a chosen file before giving up. */
const DECODE_TIMEOUT_MS = 20_000;

function readLocal(): Record<string, Banner> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, Banner>;
  } catch {
    return {};
  }
}

function writeLocal(all: Record<string, Banner>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    // Quota. The caller tells the holder rather than failing silently.
    return false;
  }
}

/** Only http(s) — a banner is not a place to accept `javascript:`. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href, window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Centre-crop to a square and re-encode.
 *
 * The grid is square, so the image is made square here rather than being
 * squashed into shape by CSS: a cropped advert looks deliberate, a stretched
 * one looks broken.
 */
export async function toSquare(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 8 MB.');

  const source = await decode(file);
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const side = Math.min(width, height);
  if (!side) throw new Error('That image has no pixels.');

  const c = document.createElement('canvas');
  c.width = c.height = Math.min(BANNER_SIZE, side);
  const g = c.getContext('2d');
  if (!g) throw new Error('This browser cannot process images.');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, c.width, c.height);
  if ('close' in source) source.close();

  const url = c.toDataURL('image/jpeg', QUALITY);
  /* A canvas that could not be read back returns the string for a blank one.
     Publishing that would put an empty square on the seat and report success. */
  if (url.length < 64) throw new Error('That image could not be processed. Try a smaller one.');
  return url;
}

/**
 * File to something drawable.
 *
 * Two paths, and the order matters on a phone. `createImageBitmap` decodes
 * off the main thread and lets the browser release the full-size bitmap as
 * soon as it is drawn, which is the difference between working and not on a
 * 12-megapixel photo inside a wallet's in-app browser. Where it is missing,
 * or where it refuses a format it does not recognise, the `<img>` path still
 * works.
 *
 * Both are raced against a timer. An `<img>` given a file it cannot decode
 * can fire neither `load` nor `error` — the promise then never settles, the
 * dialog sits on "Working…" forever, and there is nothing to tell the person
 * because as far as the page is concerned it is still going.
 */
function decode(file: File): Promise<HTMLImageElement | ImageBitmap> {
  const guard = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('That image took too long to read. Try a smaller one.')), DECODE_TIMEOUT_MS),
  );

  const viaBitmap = async (): Promise<HTMLImageElement | ImageBitmap> => {
    if (typeof createImageBitmap !== 'function') return viaElement();
    try {
      return await createImageBitmap(file);
    } catch {
      return viaElement();
    }
  };

  const viaElement = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });

  return Promise.race([viaBitmap(), guard]);
}

export interface BannerStore {
  /** Everything on the wall right now. */
  all: BannerSet;
  /** True while the published set is still being fetched. */
  loading: boolean;
  /** Whether a published set is configured at all. */
  hasPublished: boolean;
}

/** The published wall, if one is configured. Failures are simply no banners. */
export async function fetchPublished(): Promise<Record<string, Banner>> {
  if (!REMOTE) return {};
  try {
    const res = await fetch(REMOTE);
    if (!res.ok) return {};
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return {};
    const out: Record<string, Banner> = {};
    for (const [seat, v] of Object.entries(body as Record<string, unknown>)) {
      const b = v as Partial<Banner>;
      if (typeof b?.image !== 'string') continue;
      out[seat] = {
        image: b.image,
        alt: typeof b.alt === 'string' ? b.alt : `Advert on seat ${seat}`,
        href: typeof b.href === 'string' ? b.href : undefined,
        published: true,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export const hasPublishedWall = Boolean(REMOTE || API);

/* ────────────────────────────────────────────────────────────────────────
   Publishing
   ────────────────────────────────────────────────────────────────────────
   Connecting a wallet proves nothing: an address is public and anybody can
   type one into a request. So every write to the wall carries a signature
   over a challenge that names the wallet, pins the exact image bytes, and is
   stamped with the time.

   Pinning the image matters as much as naming the wallet. Without the hash
   in the signed text, one captured signature would authorise any artwork at
   all for that wallet, forever — the holder signs "it's me", and whoever
   caught the signature chooses the picture. With it, a signature authorises
   exactly one image and nothing else. */

/**
 * The bytes behind a `data:` URL.
 *
 * This used to assume base64, because `toSquare` produces base64 and that was
 * the only thing anyone meant to publish. But the house adverts are
 * `data:image/svg+xml,` followed by *percent-encoded* markup, and the dialog
 * opens with whatever is already on the seat — so pressing publish without
 * choosing a file handed this function an SVG data URL and `atob` threw
 * "The string to be decoded is not correctly encoded" into the middle of the
 * page. Both encodings are legal in a data URL; the `;base64` marker is what
 * distinguishes them, so read it rather than guessing.
 */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) {
    throw new Error('That image is not one this page can publish. Choose a file.');
  }

  const payload = dataUrl.slice(comma + 1);

  if (!/;base64/i.test(dataUrl.slice(0, comma))) {
    return new TextEncoder().encode(decodeURIComponent(payload));
  }

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    /* A malformed data URL is not something to explain in the browser's
       words. `atob`'s DOMException names a function nobody clicked. */
    throw new Error('That image could not be read. Try choosing it again.');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * What the server will actually accept, checked before the wallet is asked.
 *
 * The Worker sniffs magic bytes and refuses anything that is not JPEG or PNG
 * — SVG most of all, since it carries script. Finding that out from a 415
 * means the holder has already approved a signature for an upload that was
 * never going to land. Better to know one step earlier, in words that say
 * what to do about it.
 */
function refusalReason(dataUrl: string): string | null {
  if (!dataUrl) return 'Choose an image first.';
  if (!dataUrl.startsWith('data:')) return 'Choose an image first.';
  if (/^data:image\/svg\+xml/i.test(dataUrl)) {
    return 'SVG cannot be published. Choose a JPEG or PNG.';
  }
  if (!/;base64/i.test(dataUrl.slice(0, dataUrl.indexOf(',')))) {
    return 'That image is not one this page can publish. Choose a file.';
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The text a holder signs. Human-readable on purpose — this appears in a
 * wallet popup, and somebody being asked to sign something ought to be able
 * to read what it says.
 */
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

export interface PublishResult {
  /** The stored image URL, once the server has it. */
  image: string;
}

/**
 * Put an advert on the wall for everybody.
 *
 * Throws with a message worth showing a person. The caller decides whether a
 * failure is worth falling back to a local-only banner.
 */
export async function publishBanner(opts: {
  owner: string;
  /** A square data URL, as produced by `toSquare`. */
  image: string;
  alt: string;
  href?: string;
  sign: (message: string) => Promise<string>;
}): Promise<PublishResult> {
  if (!API) throw new Error('This deployment has no advert server configured.');

  const refusal = refusalReason(opts.image);
  if (refusal) throw new Error(refusal);

  const bytes = dataUrlBytes(opts.image);
  const hash = await sha256Hex(bytes);
  const issued = new Date().toISOString();
  const signature = await opts.sign(challenge(opts.owner, hash, issued));

  const res = await fetch(`${API}/banner`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      owner: opts.owner,
      image: opts.image,
      alt: opts.alt,
      href: opts.href,
      issued,
      signature,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The advert server refused it (${res.status}).`);
  }
  const body = (await res.json()) as { image?: unknown };
  if (typeof body.image !== 'string') throw new Error('The advert server returned no image.');
  return { image: body.image };
}

/**
 * The published wall, keyed by the wallet that owns each advert.
 *
 * The caller maps these onto seats through the manifest it already has.
 */
export async function fetchOwnerBanners(): Promise<Record<string, Banner>> {
  if (!API) return {};
  try {
    const res = await fetch(`${API}/banners`);
    if (!res.ok) return {};
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return {};
    const out: Record<string, Banner> = {};
    for (const [owner, v] of Object.entries(body as Record<string, unknown>)) {
      const b = v as Partial<Banner>;
      const image = safeHref(typeof b?.image === 'string' ? b.image : undefined);
      if (!image) continue;
      out[owner] = {
        image,
        alt: typeof b.alt === 'string' ? b.alt : 'Advert',
        href: safeHref(typeof b.href === 'string' ? b.href : undefined),
        published: true,
        owner,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/* ────────────────────────────────────────────────────────────────────────
   House adverts
   ────────────────────────────────────────────────────────────────────────
   An empty grid does not show what the grid is for, and neither does a grid
   of grey rectangles labelled AD 1 through AD 14.

   Every airline in the world has this exact problem and every one of them
   solves it the same way: inventory nobody has bought yet carries the
   airline's own campaigns. So these are Seat Airlines' — eight layouts drawn
   from the same palette, mark and typography as the rest of the page, sized
   and weighted to be legible at the thirty pixels a seat tile actually gets.
   They are drawn rather than fetched, so they cost no request and cannot be
   mistaken for anybody's real advert, and each one says in its alt text that
   the seat's holder is who replaces it.

   The set is deliberately a *set*: one voice, one grid, one type scale. A
   wall of them has to read as a wall somebody art-directed, because that is
   what the holder buying into row 1 is buying into. */

const HOUSE_INK = {
  /* The names are the roles, not the hues, so re-liverying the airline is
     this block and nothing else. */
  navy: '#005FB8',   // the filled ground of a house advert
  night: '#1B2027',  // the dark one
  amber: '#0087EA',  // what a house advert shouts in
  cyan: '#00C9F1',   // and what it says the quiet half in
  bone: '#F2F3F5',   // the light ground
  cloth: '#8E939E',  // the neutral
} as const;

/** The mark, scaled and placed on the 200-square house-advert canvas. */
const houseMark = (x: number, y: number, size: number, fill: string) =>
  `<g transform="translate(${x} ${y}) scale(${size / 1536})">` +
  `<path d="${MARK_PATH}" fill="${fill}" fill-rule="evenodd"/></g>`;

/** Stacked display type. One line per entry, set tight, as a lockup would be. */
const stack = (
  lines: string[],
  opts: { x: number; y: number; size: number; fill: string; weight?: number; anchor?: string; spacing?: number },
) =>
  lines
    .map(
      (line, i) =>
        `<text x="${opts.x}" y="${opts.y + i * (opts.size * (opts.spacing ?? 1.02))}" ` +
        `font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-size="${opts.size}" ` +
        `font-weight="${opts.weight ?? 800}" fill="${opts.fill}" ` +
        `text-anchor="${opts.anchor ?? 'start'}" letter-spacing="-0.8">${line}</text>`,
    )
    .join('');

/** Small print, in the mono the rest of the page uses for figures. */
const micro = (text: string, x: number, y: number, fill: string, size = 9, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="${size}" ` +
  `font-weight="600" fill="${fill}" text-anchor="${anchor}" letter-spacing="1.6">${text}</text>`;

interface HouseAd {
  /** What the advert says, for anyone who cannot see it. */
  line: string;
  svg: string;
}

const HOUSE_ADS: HouseAd[] = [
  {
    line: 'Your bag is your seat',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.navy}"/>` +
      `<rect x="0" y="0" width="200" height="6" fill="${HOUSE_INK.amber}"/>` +
      stack(['YOUR', 'BAG IS', 'YOUR', 'SEAT'], { x: 18, y: 62, size: 32, fill: HOUSE_INK.bone }) +
      micro('SEAT AIRLINES', 18, 182, HOUSE_INK.cyan),
  },
  {
    line: 'Seat Airlines — SA350, nonstop',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.bone}"/>` +
      houseMark(58, 26, 84, HOUSE_INK.navy) +
      stack(['SEAT', 'AIRLINES'], { x: 100, y: 148, size: 26, fill: HOUSE_INK.navy, anchor: 'middle' }) +
      micro('SA350 · NONSTOP', 100, 182, HOUSE_INK.cloth, 9, 'middle'),
  },
  {
    line: 'This square is for sale — out-hold whoever is in it',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.amber}"/>` +
      stack(['THIS', 'SQUARE', 'IS FOR', 'SALE'], { x: 18, y: 58, size: 33, fill: HOUSE_INK.night }) +
      `<rect x="18" y="168" width="164" height="2" fill="${HOUSE_INK.night}" opacity="0.55"/>` +
      micro('OUT-HOLD ROW 1', 18, 188, HOUSE_INK.night),
  },
  {
    line: "One plane. Everyone's in it.",
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.night}"/>` +
      `<circle cx="100" cy="86" r="52" fill="none" stroke="${HOUSE_INK.cyan}" stroke-width="2" opacity="0.4"/>` +
      houseMark(66, 52, 68, HOUSE_INK.cyan) +
      stack(['ONE PLANE.', "EVERYONE'S IN IT."], {
        x: 100, y: 166, size: 15, fill: HOUSE_INK.bone, anchor: 'middle', spacing: 1.18,
      }),
  },
  {
    line: 'Row 1 is better — the front of the cabin is the front of the wall',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.cloth}"/>` +
      // The seat map itself, as a motif: the one square at the front is lit.
      [0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4, 5].map((c) => {
          const lit = r === 0 && c === 0;
          const x = 20 + c * 27 + (c > 2 ? 8 : 0);
          return `<rect x="${x}" y="${24 + r * 27}" width="21" height="21" fill="${
            lit ? HOUSE_INK.amber : 'rgba(237,230,216,0.16)'
          }"/>`;
        }).join(''),
      ).join('') +
      stack(['ROW 1', 'IS BETTER'], { x: 20, y: 160, size: 22, fill: HOUSE_INK.bone }),
  },
  {
    line: 'Market cap is altitude — $50M is the moon',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.night}"/>` +
      `<path d="M -20 178 A 150 150 0 0 1 220 178 Z" fill="${HOUSE_INK.navy}"/>` +
      `<circle cx="150" cy="46" r="17" fill="${HOUSE_INK.bone}" opacity="0.9"/>` +
      `<circle cx="144" cy="41" r="4" fill="${HOUSE_INK.cloth}" opacity="0.45"/>` +
      `<circle cx="156" cy="52" r="2.6" fill="${HOUSE_INK.cloth}" opacity="0.4"/>` +
      stack(['$50M', 'IS THE', 'MOON'], { x: 18, y: 74, size: 30, fill: HOUSE_INK.amber }) +
      micro('MARKET CAP = ALTITUDE', 18, 190, HOUSE_INK.cyan, 8),
  },
  {
    line: 'Cabin crew, arm doors and cross-check',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.bone}"/>` +
      `<rect x="0" y="0" width="200" height="42" fill="${HOUSE_INK.navy}"/>` +
      micro('CABIN CREW', 14, 27, HOUSE_INK.bone, 12) +
      stack(['ARM', 'DOORS', 'AND', 'CROSS-', 'CHECK'], {
        x: 14, y: 74, size: 24, fill: HOUSE_INK.navy, spacing: 1.06,
      }) +
      `<rect x="0" y="194" width="200" height="6" fill="${HOUSE_INK.amber}"/>`,
  },
  {
    line: 'Boarding pass — seats go to the top holders, in order',
    svg:
      `<rect width="200" height="200" fill="${HOUSE_INK.cyan}"/>` +
      `<rect x="0" y="120" width="200" height="80" fill="${HOUSE_INK.bone}"/>` +
      // The tear line, punched the way a real stub is.
      Array.from({ length: 13 }, (_, i) => `<circle cx="${8 + i * 16}" cy="120" r="3.4" fill="${HOUSE_INK.night}" opacity="0.16"/>`).join('') +
      micro('BOARDING PASS', 14, 30, HOUSE_INK.navy, 10) +
      stack(['SEATED', 'BY RANK'], { x: 14, y: 66, size: 25, fill: HOUSE_INK.navy, spacing: 1.08 }) +
      // A barcode: varied bar widths, so it reads as one rather than as stripes.
      Array.from({ length: 30 }, (_, i) => {
        const w = 1 + ((i * 37) % 5) * 0.9;
        return `<rect x="${14 + i * 5.9}" y="140" width="${w}" height="34" fill="${HOUSE_INK.night}"/>`;
      }).join('') +
      micro('TOP 40 ONLY', 14, 190, HOUSE_INK.cloth, 8),
  },
];

/**
 * A wall with something on it.
 *
 * Held seats with no advert on them yet carry the airline's own, so the page
 * opens on a working billboard wall rather than an argument that one could
 * exist. A holder's upload, and the published set, both beat them.
 */
export function houseAdverts(seats: readonly string[]): Record<string, Banner> {
  const out: Record<string, Banner> = {};
  seats.forEach((seat, i) => {
    const ad = HOUSE_ADS[i % HOUSE_ADS.length];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${ad.svg}</svg>`;
    out[seat] = {
      image: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      alt: `Seat Airlines house advert: ${ad.line}. This seat's holder can replace it.`,
      house: true,
    };
  });
  return out;
}

export const localBanners = {
  read: readLocal,
  /** Returns false if the browser refused to store it (quota). */
  put(seat: string, banner: Banner): boolean {
    const all = readLocal();
    all[seat] = banner;
    return writeLocal(all);
  },
  clear(seat: string): void {
    const all = readLocal();
    delete all[seat];
    writeLocal(all);
  },
};
