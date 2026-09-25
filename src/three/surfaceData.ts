import { noise2, periodicNoise } from './noise';

/**
 * The ground of the other worlds, and the sea of cloud over this one.
 *
 * Each is built the way the farmland is: one periodic height field per tile,
 * in metres, from which come the displacement that pushes the near mesh up,
 * the normal map that lights every slope out to the horizon, and an albedo
 * for the light to fall on. The light itself is never painted in. A crater's
 * far wall is bright because it faces the scene's real sun, so the relief
 * reads correctly from any heading, at any hour, and moves the right way as
 * the aircraft turns.
 *
 * All of it is generated rather than fetched, and off the main thread: this
 * module is plain arithmetic into byte arrays, with no three.js and no
 * browser in it, so a worker can run it while the flight carries on
 * (`surfaceWorker.ts`), and `surfaces.ts` turns what comes back into
 * textures.
 */

/** One image: RGBA bytes, row by row, +v running with the rows. */
export interface Plane {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface SurfaceData {
  /** Albedo. The cloud sea keeps its coverage in the alpha. */
  day: Plane;
  /** 0 at the lowest point of the tile to 1 at the highest; smooth enough for geometry. */
  height: Plane;
  /** The same relief at full resolution, as a tangent-space normal map. */
  normal: Plane;
  /** Metres from the lowest to the highest point: the displacement scale. */
  relief: number;
  /** Where the ground lies on average, as a fraction of `relief` above the lowest point. */
  level: number;
  /** Metres across one repeat of the tile. */
  tile: number;
}

/** A seeded stream of 0–1, for placing things. */
function stream(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a: number, b: number, t: number) => {
  const c = clamp01((t - a) / (b - a));
  return c * c * (3 - 2 * c);
};

/** Octaves of periodic noise, as [cells, weight], summed to 0–1. */
function fbm(res: number, octaves: [number, number][], seed: number): Float32Array {
  const out = new Float32Array(res * res);
  let total = 0;
  octaves.forEach(([cells, weight], k) => {
    const n = periodicNoise(res, cells, seed + k * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * weight;
    total += weight;
  });
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** A periodic field read between its samples. */
function sample(f: Float32Array, res: number, x: number, y: number): number {
  const fx = ((x % res) + res) % res;
  const fy = ((y % res) + res) % res;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = (x0 + 1) % res;
  const y1 = (y0 + 1) % res;
  const a = f[y0 * res + x0] + (f[y0 * res + x1] - f[y0 * res + x0]) * tx;
  const b = f[y1 * res + x0] + (f[y1 * res + x1] - f[y1 * res + x0]) * tx;
  return a + (b - a) * ty;
}

/** Run `each` over every texel within `reach` of a point, wrapping at the edges. */
function around(res: number, cx: number, cy: number, reach: number, each: (i: number, dx: number, dy: number) => void) {
  const x0 = Math.floor(cx - reach);
  const x1 = Math.ceil(cx + reach);
  const y0 = Math.floor(cy - reach);
  const y1 = Math.ceil(cy + reach);
  for (let y = y0; y <= y1; y++) {
    const row = (((y % res) + res) % res) * res;
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      each(row + (((x % res) + res) % res), x - cx, dy);
    }
  }
}

/**
 * A crater, pressed into a height field in metres: the bowl, the raised rim,
 * an apron of ejecta beyond it and, once it is big enough, a flat floor and
 * a central peak — the profile every impact leaves, on any world. `wear`
 * runs 0 for a fresh one to 1 for one eroded nearly flat.
 */
function crater(h: Float32Array, res: number, cx: number, cy: number, r: number, depth: number, wear: number) {
  const rimWidth = 0.14 + wear * 0.22;
  const rimHeight = (0.26 - wear * 0.14) * depth;
  const complex = r > 40;
  const floor = complex ? 0.72 : 1;
  const peak = complex ? depth * 0.34 * (1 - wear) : 0;
  const bowlDepth = depth * (1 - wear * 0.55);
  // The wall, running into a flat floor where there is one. The floor meets
  // the wall in a curve, not a crease: a crease reads as a drawn ring under
  // a low sun.
  const bowl = (wall: number) => (wall - floor + Math.sqrt((wall + floor) ** 2 + 0.02)) / 2;
  const lip = bowl(0);
  around(res, cx, cy, r * 1.9, (i, dx, dy) => {
    const d = Math.sqrt(dx * dx + dy * dy) / r;
    if (d >= 1.9) return;
    let dh = rimHeight * Math.exp(-(((d - 1) / rimWidth) ** 2));
    // The apron of ejecta runs under the bowl as well as round it, and the
    // bowl starts from exactly nothing at the rim, so inside and outside
    // meet without a step. A step there is a texel wide in the normal map,
    // and a circle crossing the texel grid drew every rim as a dotted line.
    dh += depth * 0.05 * (1 - smooth(1, 1.9, d));
    if (d < 1) {
      dh += bowlDepth * (bowl(d * d - 1) - lip);
      if (peak) dh += peak * Math.exp(-((d / 0.16) ** 2));
    }
    h[i] += dh;
  });
}

/** A Gaussian blur of a square field that wraps at its edges; `sigma` in texels. */
function blur(f: Float32Array, res: number, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const w: number[] = [];
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    total += w[w.length - 1];
  }
  const across = new Float32Array(f.length);
  const out = new Float32Array(f.length);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let a = 0;
      for (let i = -radius; i <= radius; i++) a += f[y * res + ((x + i + res) % res)] * w[i + radius];
      across[y * res + x] = a / total;
    }
  }
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let a = 0;
      for (let i = -radius; i <= radius; i++) a += across[((y + i + res) % res) * res + x] * w[i + radius];
      out[y * res + x] = a / total;
    }
  }
  return out;
}

/** How smooth the ground's shape is, as a blur in metres: see `reliefMaps`. */
const SHAPE_BLUR = 75;

/**
 * The height field as the two textures the scene reads: displacement for
 * the shape, and a normal map at full resolution for the light.
 *
 * The shape is box-filtered down to `geoRes`, then blurred to about the
 * spacing of the mesh that reads it. A vertex every hundred-odd metres
 * cannot carry a crater rim fifty metres wide: sampled anyway, the rim came
 * out as a chain of spikes and the slope under it as a staircase, and both
 * crawled as the ground scrolled. The light keeps every rim, because the
 * normal map is cut from the full-resolution field.
 *
 * Data textures are not flipped on upload, so +v runs with the rows and both
 * slopes take the same sign.
 */
function reliefMaps(h: Float32Array, res: number, tile: number, geoRes = 256): Pick<SurfaceData, 'height' | 'normal' | 'relief' | 'level'> {
  const step = res / geoRes;
  let shape = new Float32Array(geoRes * geoRes);
  for (let y = 0; y < geoRes; y++) {
    for (let x = 0; x < geoRes; x++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        for (let k = 0; k < step; k++) sum += h[(y * step + j) * res + x * step + k];
      }
      shape[y * geoRes + x] = sum / (step * step);
    }
  }
  shape = blur(shape, geoRes, SHAPE_BLUR / (tile / geoRes));
  let lo = Infinity;
  let hi = -Infinity;
  let mean = 0;
  for (const v of shape) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    mean += v / shape.length;
  }
  const relief = Math.max(1, hi - lo);
  const hd = new Uint8Array(geoRes * geoRes * 4);
  for (let i = 0; i < shape.length; i++) {
    const v = Math.round(((shape[i] - lo) / relief) * 255);
    hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = v;
    hd[i * 4 + 3] = 255;
  }

  const texel = tile / res;
  const nd = new Uint8Array(res * res * 4);
  /* Dithered by half a step either way. Eight bits a channel is coarse
     for a smooth slope under a low sun: undithered, the steps between one
     value and the next show as contour lines drawn across every hill. */
  const dither = (x: number, y: number, c: number) => noise2(x, y, 0x9e37 + c) - 0.5;
  const at = (x: number, y: number) => h[(((y + res) % res) * res) + ((x + res) % res)];
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) / (2 * texel);
      const ny = -(at(x, y + 1) - at(x, y - 1)) / (2 * texel);
      const len = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * res + x) * 4;
      nd[o] = Math.round((nx / len * 0.5 + 0.5) * 255 + dither(x, y, 0));
      nd[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255 + dither(x, y, 1));
      nd[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255 + dither(x, y, 2));
      nd[o + 3] = 255;
    }
  }
  return {
    height: { data: hd, width: geoRes, height: geoRes },
    normal: { data: nd, width: res, height: res },
    relief,
    level: (mean - lo) / relief,
  };
}

/** Albedo from a per-texel colour function, 0–1 linear-ish sRGB values. */
function albedo(res: number, colour: (i: number, out: number[]) => void, alpha?: Float32Array): Plane {
  const d = new Uint8Array(res * res * 4);
  const c = [0, 0, 0];
  for (let i = 0; i < res * res; i++) {
    colour(i, c);
    d[i * 4] = Math.round(clamp01(c[0]) * 255);
    d[i * 4 + 1] = Math.round(clamp01(c[1]) * 255);
    d[i * 4 + 2] = Math.round(clamp01(c[2]) * 255);
    d[i * 4 + 3] = alpha ? Math.round(clamp01(alpha[i]) * 255) : 255;
  }
  return { data: d, width: res, height: res };
}

/* ── The moon ─────────────────────────────────────────────────────────────
   Highlands pocked to saturation, a few flooded basins — the maria, darker
   and smoother because the lava drowned what was there — and craters at
   every scale, laid down oldest first so the young cut into the old. The
   youngest large ones throw bright rays, the one lunar feature you can pick
   out from any distance. Sizes follow the real distribution: a great many
   small, a few large. */

export function lunarData(): SurfaceData {
  const RES = 1024;
  const TILE = 12000;
  const m = TILE / RES;
  const rand = stream(0x51f15eed);
  const n = RES * RES;

  const basin = fbm(RES, [[3, 1], [6, 0.5], [12, 0.25]], 11);
  const mare = new Float32Array(n);
  for (let i = 0; i < n; i++) mare[i] = smooth(0.53, 0.6, basin[i]);

  // Rolling highland, and the maria sunk and flattened into it.
  const roll = fbm(RES, [[4, 1], [8, 0.5], [16, 0.28], [32, 0.14]], 23);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = (roll[i] - 0.5) * 170 * (1 - mare[i] * 0.75) - mare[i] * 70;

  const bright = new Float32Array(n);
  const CRATERS = 620;
  for (let k = 0; k < CRATERS; k++) {
    const r = (30 + 1400 * rand() ** 4) / m;
    const cx = rand() * RES;
    const cy = rand() * RES;
    // Oldest first: the order is the age.
    const wear = clamp01(1 - k / CRATERS + (rand() - 0.5) * 0.3);
    const inMare = mare[(Math.floor(cy) % RES) * RES + (Math.floor(cx) % RES)];
    const depth = r * m * (0.2 - 0.07 * Math.min(1, r * m / 1000)) * (1 - inMare * 0.3);
    crater(h, RES, cx, cy, r, depth, wear);
    const fresh = 1 - wear;
    if (fresh > 0.45) {
      // Fresh ejecta is bright: it has not had time to weather dark.
      around(RES, cx, cy, r * 2.2, (i, dx, dy) => {
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d < 2.2) bright[i] += (fresh - 0.45) * 0.55 * (d < 1 ? 0.6 : 1 - smooth(1, 2.2, d));
      });
    }
    if (fresh > 0.92 && r * m > 250) {
      const rays = 10 + Math.floor(rand() * 8);
      for (let j = 0; j < rays; j++) {
        const t = rand() * Math.PI * 2;
        const len = r * (5 + rand() * 7);
        const w = r * (0.1 + rand() * 0.12);
        // Stepped closer than the streak is wide, so it reads as a streak and not a dotted line.
        for (let s = r * 1.1; s < len; s += w * 0.25) {
          const fade = 1 - s / len;
          around(RES, cx + Math.cos(t) * s, cy + Math.sin(t) * s, w, (i, dx, dy) => {
            const q = (dx * dx + dy * dy) / (w * w);
            if (q < 1) bright[i] += 0.022 * fade * (1 - q);
          });
        }
      }
    }
  }
  // The small stuff: regolith churned by a hail of tiny impacts, for the light only.
  for (let k = 0; k < 5200; k++) {
    const r = 0.7 + rand() ** 2 * 2.6;
    crater(h, RES, rand() * RES, rand() * RES, r, r * m * 0.16, rand() * 0.6);
  }

  const mottle = fbm(RES, [[32, 1], [64, 0.6], [128, 0.4]], 37);
  const HIGHLAND = [0.5, 0.485, 0.46];
  const MARE = [0.25, 0.245, 0.235];
  const day = albedo(RES, (i, c) => {
    const k = (0.88 + mottle[i] * 0.24) * (1 + Math.min(0.6, bright[i]));
    for (let j = 0; j < 3; j++) c[j] = (HIGHLAND[j] + (MARE[j] - HIGHLAND[j]) * mare[i]) * k;
  });
  return { day, ...reliefMaps(h, RES, TILE), tile: TILE };
}

/* ── Mars ─────────────────────────────────────────────────────────────────
   Rust and butterscotch dust over darker basalt; mesas stepped out of the
   plains in layers, their cliffs banded where the strata show; old craters
   softened by a few billion years of wind, their floors filled with dark
   sand; and dune fields in the low ground, ridged across the prevailing
   wind — gentle on the windward side, steep on the lee. */

export function marsData(): SurfaceData {
  const RES = 1024;
  const TILE = 12000;
  const m = TILE / RES;
  const rand = stream(0x3a45c0de);
  const n = RES * RES;

  const lay = fbm(RES, [[2, 1], [4, 0.6], [8, 0.36], [16, 0.2], [32, 0.1]], 71);
  // Terraced: flat benches and steep risers, the way layered rock erodes.
  const LEVELS = 5;
  const h = new Float32Array(n);
  const cliff = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = lay[i] * LEVELS;
    const f = t - Math.floor(t);
    const riser = smooth(0.62, 0.9, f);
    h[i] = ((Math.floor(t) + riser) / LEVELS) * 560;
    cliff[i] = riser * (1 - riser) * 4;
  }

  // Sand gathers in the low ground; that is where the dunes are.
  const sand = new Float32Array(n);
  for (let i = 0; i < n; i++) sand[i] = smooth(0.46, 0.34, lay[i]);

  const streak = new Float32Array(n);
  const floors = new Float32Array(n);
  for (let k = 0; k < 240; k++) {
    const r = (40 + 1100 * rand() ** 3.5) / m;
    const cx = rand() * RES;
    const cy = rand() * RES;
    const wear = 0.35 + rand() * 0.6;
    crater(h, RES, cx, cy, r, r * m * 0.16, wear);
    around(RES, cx, cy, r * 0.8, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d < 0.8) floors[i] = Math.max(floors[i], 1 - smooth(0.4, 0.8, d));
    });
    // A wind streak downwind of it: pale where dust settled in its lee.
    const len = r * (3 + rand() * 3);
    for (let s = r; s < len; s += r * 0.4) {
      around(RES, cx + s, cy + (rand() - 0.5) * r * 0.2, r * 0.7, (i, dx, dy) => {
        const q = (dx * dx + dy * dy) / (r * r * 0.49);
        if (q < 1) streak[i] = Math.max(streak[i], (1 - q) * (1 - s / len));
      });
    }
  }
  for (let k = 0; k < 3200; k++) {
    const r = 0.7 + rand() ** 2 * 2.2;
    crater(h, RES, rand() * RES, rand() * RES, r, r * m * 0.12, 0.3 + rand() * 0.6);
  }

  // Dunes: transverse ridges across a slowly turning wind.
  const wind = fbm(RES, [[2, 1], [4, 0.5]], 83);
  const warp = fbm(RES, [[8, 1], [16, 0.5]], 89);
  const WAVE = 150 / m;
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const i = y * RES + x;
      if (sand[i] < 0.01) continue;
      const a = 0.5 + (wind[i] - 0.5) * 1.4;
      const s = (x * Math.cos(a) + y * Math.sin(a)) / WAVE + warp[i] * 6;
      const f = s - Math.floor(s);
      const profile = f < 0.78 ? (f / 0.78) ** 1.4 : (1 - f) / 0.22;
      h[i] += profile * 14 * sand[i];
    }
  }

  const mottle = fbm(RES, [[24, 1], [48, 0.6], [96, 0.45], [192, 0.3]], 97);
  const DUST = [0.8, 0.56, 0.38];
  const RUST = [0.6, 0.35, 0.22];
  const BASALT = [0.3, 0.21, 0.17];
  const day = albedo(RES, (i, c) => {
    const high = smooth(0.35, 0.7, lay[i]);
    // Strata: the cliffs show their layers.
    const band = 0.5 + 0.5 * Math.sin(h[i] / 9);
    const dark = Math.max(sand[i] * 0.85, floors[i] * 0.7);
    const k = (0.86 + mottle[i] * 0.28) * (1 + cliff[i] * (band - 0.5) * 0.5) * (1 + streak[i] * 0.22);
    for (let j = 0; j < 3; j++) {
      const ground = RUST[j] + (DUST[j] - RUST[j]) * high;
      c[j] = (ground + (BASALT[j] - ground) * dark) * k;
    }
  });
  return { day, ...reliefMaps(h, RES, TILE), tile: TILE };
}

/* ── The cloud sea ───────────────────────────────────────────────────────
   What you break out on top of at $1M: a floor of cumulus to the horizon.
   Cover comes from low-frequency noise, and the tops from cauliflower
   billows — thousands of domes of every size merged by taking the highest,
   packed where the cover is thick and thinning to nothing at the gaps. The
   alpha keeps the raw cover, so the scene can open or close the gaps with
   the weather instead of baking one sky in. */

export function cloudSeaData(): SurfaceData {
  const RES = 512;
  const TILE = 8000;
  const m = TILE / RES;
  const rand = stream(0xc10d5ea5);
  const n = RES * RES;

  const cover = fbm(RES, [[3, 1], [6, 0.6], [12, 0.34], [24, 0.18], [48, 0.08]], 131);
  const billow = new Float32Array(n);
  for (let k = 0; k < 5200; k++) {
    const cx = rand() * RES;
    const cy = rand() * RES;
    const c = sample(cover, RES, cx, cy);
    if (c < 0.38) continue;
    const r = (2.5 + rand() ** 2 * 20) * (0.55 + c * 0.9);
    const top = r * m * (0.55 + rand() * 0.35);
    around(RES, cx, cy, r, (i, dx, dy) => {
      const q = 1 - (dx * dx + dy * dy) / (r * r);
      if (q > 0) {
        // Soft at the foot as well as the top: a dome that meets its
        // surroundings at a cliff draws a ring round itself, and a sea of
        // rings reads as craters rather than cloud.
        const z = q * Math.sqrt(q) * top;
        // Merged softly: a hard maximum leaves a crease between every pair of domes.
        const b = billow[i];
        billow[i] = (z + b + Math.sqrt((z - b) * (z - b) + 1600)) / 2 - 20;
      }
    });
  }
  const h = new Float32Array(n);
  let peak = 1;
  for (let i = 0; i < n; i++) {
    h[i] = (billow[i] + cover[i] * 140) * smooth(0.36, 0.5, cover[i]);
    if (billow[i] > peak) peak = billow[i];
  }
  // Crevices between the domes take less of the sky: a touch of grey in them.
  const day = albedo(RES, (i, c) => {
    const lift = 0.88 + 0.12 * Math.min(1, billow[i] / (peak * 0.55));
    c[0] = 0.97 * lift;
    c[1] = 0.98 * lift;
    c[2] = 1.0 * lift;
  }, cover);
  return { day, ...reliefMaps(h, RES, TILE, 256), tile: TILE };
}

/* ── Earth, from above ────────────────────────────────────────────────────
   One set of fields for the planet wherever it is seen whole or nearly so:
   continents with ragged, warped coasts; swirled weather; and the dry
   belts. `macro` keeps them raw — land, cloud and aridity in three channels
   — for the space band, which mixes them over its own farmland detail in
   the shader. `globe` bakes them into colour for the Earth hanging in the
   moon's sky. */

export interface EarthData {
  macro: Plane;
  globe: Plane;
}

export function earthData(): EarthData {
  const RES = 1024;
  const n = RES * RES;
  const warpA = fbm(RES, [[4, 1], [8, 0.5]], 211);
  const warpB = fbm(RES, [[4, 1], [8, 0.5]], 223);
  const land0 = fbm(RES, [[3, 1], [6, 0.62], [12, 0.38], [24, 0.2], [48, 0.1]], 227);
  const cloud0 = fbm(RES, [[6, 1], [12, 0.62], [24, 0.4], [48, 0.24], [96, 0.12]], 229);
  const arid = fbm(RES, [[4, 1], [8, 0.5]], 233);
  const land = new Float32Array(n);
  const cloud = new Float32Array(n);
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const i = y * RES + x;
      land[i] = sample(land0, RES, x + (warpA[i] - 0.5) * RES * 0.16, y + (warpB[i] - 0.5) * RES * 0.16);
      // Weather is swirled harder than coastlines are.
      const sw = (warpA[i] - 0.5) * RES * 0.3;
      cloud[i] = sample(cloud0, RES, x + sw, y - sw * 0.6 + (warpB[i] - 0.5) * RES * 0.2);
    }
  }

  const md = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    md[i * 4] = Math.round(clamp01(land[i]) * 255);
    md[i * 4 + 1] = Math.round(clamp01(cloud[i]) * 255);
    md[i * 4 + 2] = Math.round(clamp01(arid[i]) * 255);
    md[i * 4 + 3] = 255;
  }
  const macro = { data: md, width: RES, height: RES };

  // The globe: 2:1 for the sphere's own mapping, the tile laid twice round.
  const W = RES * 2;
  const gd = new Uint8Array(W * RES * 4);
  for (let y = 0; y < RES; y++) {
    const lat = Math.abs(y / RES - 0.5) * 2;
    const desertBelt = Math.exp(-(((lat - 0.3) / 0.12) ** 2));
    for (let x = 0; x < W; x++) {
      const i = y * RES + (x % RES);
      const l = smooth(0.52, 0.56, land[i]);
      const shelf = smooth(0.44, 0.53, land[i]);
      const dry = clamp01(arid[i] * 0.8 + desertBelt * 0.55 - 0.15);
      let r = 0.02 + shelf * 0.05;
      let g = 0.08 + shelf * 0.12;
      let b = 0.2 + shelf * 0.1;
      const lr = 0.18 + (0.68 - 0.18) * dry;
      const lg = 0.3 + (0.55 - 0.3) * dry;
      const lb = 0.12 + (0.33 - 0.12) * dry;
      r += (lr - r) * l; g += (lg - g) * l; b += (lb - b) * l;
      const ice = smooth(0.78, 0.86, lat);
      r += (0.94 - r) * ice; g += (0.96 - g) * ice; b += (0.98 - b) * ice;
      const c = smooth(0.52, 0.72, cloud[i]) * 0.92;
      r += (0.96 - r) * c; g += (0.97 - g) * c; b += (0.98 - b) * c;
      const o = (y * W + x) * 4;
      gd[o] = Math.round(clamp01(r) * 255);
      gd[o + 1] = Math.round(clamp01(g) * 255);
      gd[o + 2] = Math.round(clamp01(b) * 255);
      gd[o + 3] = 255;
    }
  }
  return { macro, globe: { data: gd, width: W, height: RES } };
}
