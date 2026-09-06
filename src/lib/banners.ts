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
 * There is no server here yet, so a banner set by the browser stays in that
 * browser. That is a real limitation and the UI says so. A deployment that
 * wants everyone to see the same wall points
 *
 *   VITE_BANNERS_URL=https://…/banners.json
 *
 * at a document of `{ "<seat>": { "image": "<url>", "alt": "…", "href": "…" } }`.
 * Those are read-only and win over anything local, so the published wall is
 * the published wall; a holder's own upload is a preview of what they are
 * buying until it is accepted.
 */

export interface Banner {
  /** A square image: an https URL, or a data URI from a local upload. */
  image: string;
  /** What the advert says, for anyone who cannot see it. */
  alt: string;
  /** Where it points. Only http(s) is followed. */
  href?: string;
  /** True when it came from the published set rather than this browser. */
  published?: boolean;
}

export type BannerSet = Readonly<Record<string, Banner>>;

const KEY = 'seat-airways.banners.v1';
const REMOTE = import.meta.env.VITE_BANNERS_URL as string | undefined;

/** The longest side of a stored banner, and the JPEG quality it keeps. */
export const BANNER_SIZE = 384;
const QUALITY = 0.82;
/** Refuse anything that would bloat storage even after re-encoding. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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
export function toSquare(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('That file is not an image.'));
    if (file.size > MAX_UPLOAD_BYTES) return reject(new Error('That image is over 8 MB.'));

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) return reject(new Error('That image has no pixels.'));
      const c = document.createElement('canvas');
      c.width = c.height = Math.min(BANNER_SIZE, side);
      const g = c.getContext('2d');
      if (!g) return reject(new Error('This browser cannot process images.'));
      g.imageSmoothingQuality = 'high';
      g.drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, c.width, c.height,
      );
      resolve(c.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
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

export const hasPublishedWall = Boolean(REMOTE);

/**
 * A wall with something on it.
 *
 * An empty grid does not show what the grid is for. These are placeholders on
 * the first dozen seats so the page opens on a working billboard wall rather
 * than an argument that one could exist — drawn rather than fetched, so they
 * cost nothing and cannot be mistaken for anybody's real advert. Every one is
 * labelled, and a real banner replaces it the moment a holder puts one up.
 */
export function demoBanners(seats: readonly string[]): Record<string, Banner> {
  const palette = [
    ['#0F3B57', '#5FD0E8'], ['#3A1B4E', '#E4A0FF'], ['#4A2410', '#FFB300'],
    ['#123A26', '#6FE3A0'], ['#3D1220', '#FF7C9C'], ['#1B2A55', '#8FB2FF'],
    ['#4A3A0E', '#FFE07A'], ['#0E3F3B', '#5FE8D4'],
  ];
  const out: Record<string, Banner> = {};
  seats.forEach((seat, i) => {
    const [bg, fg] = palette[i % palette.length];
    const rot = (i * 37) % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
      `<rect width="120" height="120" fill="${bg}"/>` +
      `<g transform="rotate(${rot} 60 60)">` +
      `<circle cx="60" cy="60" r="34" fill="none" stroke="${fg}" stroke-width="7" opacity="0.55"/>` +
      `<rect x="42" y="42" width="36" height="36" fill="${fg}" opacity="0.9"/></g>` +
      `<text x="60" y="108" font-family="monospace" font-size="13" font-weight="700" ` +
      `fill="${fg}" text-anchor="middle" opacity="0.85">AD ${i + 1}</text></svg>`;
    out[seat] = {
      image: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      alt: `Example advert ${i + 1} — this seat's holder would put their own here`,
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
