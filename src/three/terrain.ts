import * as THREE from 'three';
import { periodicNoise } from './noise';

/**
 * The ground, as a texture rather than geometry.
 *
 * From a cruising altitude the interesting thing about land is its pattern —
 * field boundaries, a coastline, roads — not its relief. Painting that into a
 * repeating texture and laying it on a single large plane costs one draw call
 * and reads correctly from every altitude the flight reaches, where a
 * displaced mesh dense enough to hold up would cost hundreds of thousands of
 * vertices for detail nobody can see from 30,000 feet.
 */


/** Metres to one repeat of the ground tile: the plate is 120 km at 40 repeats. */
export const TILE_METRES = 3000;
/** Metres from the lowest valley floor to the highest hilltop. */
export const HILL_HEIGHT = 280;

const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};


/**
 * Farmland: irregular fields, woodland, water and the lanes between them.
 *
 * The fields are cut by recursive subdivision rather than laid on a grid. A
 * grid was the tell — from altitude it read as one tile repeated, because it
 * was, and the eye finds a regular lattice long before it finds a pattern in
 * field colour. Splitting a rectangle at a jittered line, again and again,
 * gives what enclosure actually produced: a few large fields, many small ones,
 * and boundaries that run for a while and then stop.
 */
export interface GroundTextures {
  /** What the land looks like lit. */
  day: THREE.CanvasTexture;
  /** What of it is still visible once the sun has gone: an emissive map. */
  night: THREE.CanvasTexture;
  /** Transparent low-altitude water bodies that sit over the land tile. */
  water: THREE.CanvasTexture;
  /**
   * The relief: grey, 0 at the valley floors to 1 at the tops, scaled by
   * `HILL_HEIGHT`. Smooth enough to be sampled every hundred metres or so
   * by a displaced mesh without crawling as it scrolls.
   */
  height: THREE.CanvasTexture;
  /** The same relief, with finer detail, as a tangent-space normal map. */
  normal: THREE.CanvasTexture;
}

export function farmlandTextures(size = 2048): GroundTextures {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  /* The night map is painted in the same pass, in the same coordinates, as
     the day one — which is the whole reason they are generated together: a
     town's lights have to be where the town is. Two passes over two
     independent random streams would put a city's glow in a field. */
  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const n = nc.getContext('2d') as CanvasRenderingContext2D;
  n.fillStyle = '#000000';
  n.fillRect(0, 0, size, size);

  const wc = document.createElement('canvas');
  wc.width = wc.height = size;
  const w = wc.getContext('2d') as CanvasRenderingContext2D;

  g.fillStyle = '#4a5c3a';
  g.fillRect(0, 0, size, size);

  /* A working landscape is pasture next to plough next to rape in flower next
     to stubble. That variety is the only thing that makes the ground legible
     enough to see moving underneath you from six thousand feet. */
  const greens = [
    '#4c6b34', '#3d5a2b', '#628040', '#7d9048', // pasture and cereal
    '#8a6f42', '#6d5334', '#9c8354',            // ploughed and fallow
    '#c9bd52', '#b8a94a',                       // rape and stubble
    '#2f4a26', '#56743a', '#455f30',
  ];

  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };

  /* ── The lie of the land ────────────────────────────────────────────────
     One height field for the tile, shared by everything that should follow
     the relief: the displaced ground mesh, the normal map that lights its
     slopes, the lakes that settle in its hollows, the river that runs down
     its valley and the woods that climb its high ground. Two resolutions
     of it: `heights`, smooth enough for geometry, and `detail`, the finer
     undulation only the light is shown. */
  const HR = 256;
  /** The river's course, in tile units: v along the tile, for u across it. */
  const riverAt = (u: number) => 0.62 + Math.sin(u * Math.PI * 2) * 0.1;
  const heights = new Float32Array(HR * HR);
  const detail = new Float32Array(HR * HR);
  {
    const o1 = periodicNoise(HR, 4, 0x51ed);
    const o2 = periodicNoise(HR, 8, 0x2bd1);
    const o3 = periodicNoise(HR, 16, 0x7a3c);
    const o4 = periodicNoise(HR, 32, 0x1e97);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const v = o1[i] + o2[i] * 0.45;
      heights[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      detail[i] = (o3[i] - 0.5) * 0.2 + (o4[i] - 0.5) * 0.08;
    }
    for (let y = 0; y < HR; y++) {
      const v = y / HR;
      for (let x = 0; x < HR; x++) {
        const i = y * HR + x;
        // Normalised, then shaped: broad valley floors, rounded tops.
        const h = Math.pow((heights[i] - lo) / (hi - lo), 1.3);
        // The river owns its valley: the ground falls to it from ~600 m out.
        let d = Math.abs(v - riverAt(x / HR));
        d = Math.min(d, 1 - d);
        const valley = smooth01((d - 0.025) / 0.18);
        heights[i] = h * valley;
        detail[i] *= valley;
      }
    }
  }
  const heightAt = (u: number, v: number) => {
    const x = ((Math.floor(u * HR) % HR) + HR) % HR;
    const y = ((Math.floor(v * HR) % HR) + HR) % HR;
    return heights[y * HR + x];
  };

  /* Lakes settle where water would: in the hollows, clear of the river and
     of each other. Each gets a flat basin carved well past its shore — wide
     enough that a mesh sampling the ground every hundred metres still lays
     the lake bed flat, rather than burying the water under a slope. */
  interface Lake { u: number; v: number; r: number; aspect: number }
  const lakes: Lake[] = [];
  const wrapped = (a: number) => Math.min(Math.abs(a), 1 - Math.abs(a));
  for (let tries = 0; tries < 600 && lakes.length < 9; tries++) {
    const u = rand();
    const v = rand();
    if (heightAt(u, v) > 0.2) continue;
    if (wrapped(v - riverAt(u)) < 0.08) continue;
    if (lakes.some((l) => Math.hypot(wrapped(l.u - u), wrapped(l.v - v)) < 0.16)) continue;
    lakes.push({ u, v, r: 0.012 + rand() * 0.03, aspect: 0.42 + rand() * 0.92 });
  }
  for (const lake of lakes) {
    const flat = lake.r + 0.05;
    const reach = flat + 0.1;
    const span = Math.ceil(reach * HR);
    const cx = lake.u * HR;
    const cy = lake.v * HR;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const dist = Math.hypot(dx, dy) / HR;
        if (dist > reach) continue;
        const x = ((Math.round(cx + dx) % HR) + HR) % HR;
        const y = ((Math.round(cy + dy) % HR) + HR) % HR;
        const k = smooth01((dist - flat) / 0.1);
        heights[y * HR + x] *= k;
        detail[y * HR + x] *= k;
      }
    }
  }

  interface Field { x: number; y: number; w: number; h: number }
  const fields: Field[] = [];

  /* Split until a rectangle is small enough to be a field. Splitting the
     longer side keeps them broadly squarish; the jitter keeps them from
     being halves. */
  const split = (f: Field, depth: number) => {
    const small = size / 22;
    if (depth > 7 || (f.w < small && f.h < small) || (f.w < small * 0.6 || f.h < small * 0.6)) {
      fields.push(f);
      return;
    }
    // Some fields simply stop dividing, which is where the big ones come from.
    if (depth > 3 && rand() < 0.28) {
      fields.push(f);
      return;
    }
    const cut = 0.32 + rand() * 0.36;
    if (f.w > f.h) {
      const w = f.w * cut;
      split({ x: f.x, y: f.y, w, h: f.h }, depth + 1);
      split({ x: f.x + w, y: f.y, w: f.w - w, h: f.h }, depth + 1);
    } else {
      const h = f.h * cut;
      split({ x: f.x, y: f.y, w: f.w, h }, depth + 1);
      split({ x: f.x, y: f.y + h, w: f.w, h: f.h - h }, depth + 1);
    }
  };
  split({ x: 0, y: 0, w: size, h: size }, 0);

  for (const f of fields) {
    g.fillStyle = greens[Math.floor(rand() * greens.length)];
    g.fillRect(f.x, f.y, f.w + 1, f.h + 1);

    /* A field is not one flat colour: crops ripen unevenly, ground drains
       unevenly, and from altitude that reads as a soft gradient across each
       field rather than as noise. One corner-to-corner wash per field is the
       cheapest thing that stops the patchwork reading as printed. */
    const washed = g.createLinearGradient(f.x, f.y, f.x + f.w, f.y + f.h);
    const wash = 0.05 + rand() * 0.07;
    if (rand() > 0.5) {
      washed.addColorStop(0, `rgba(255,244,214,${wash})`);
      washed.addColorStop(1, `rgba(24,32,18,${wash})`);
    } else {
      washed.addColorStop(0, `rgba(24,32,18,${wash})`);
      washed.addColorStop(1, `rgba(255,244,214,${wash})`);
    }
    g.fillStyle = washed;
    g.fillRect(f.x, f.y, f.w + 1, f.h + 1);

    // Plough lines: the corduroy that tells you which way a field was worked.
    if (rand() < 0.42) {
      const along = f.w > f.h;
      const step = 5 + rand() * 7;
      g.save();
      g.beginPath();
      g.rect(f.x, f.y, f.w, f.h);
      g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.10)';
      g.lineWidth = 1.4;
      g.beginPath();
      if (along) {
        for (let y = f.y; y < f.y + f.h; y += step) { g.moveTo(f.x, y); g.lineTo(f.x + f.w, y); }
      } else {
        for (let x = f.x; x < f.x + f.w; x += step) { g.moveTo(x, f.y); g.lineTo(x, f.y + f.h); }
      }
      g.stroke();
      g.restore();
    }

    // An orchard, occasionally: rows of trees on a grid, unmistakable from
    // the air and different in kind from any plough line.
    if (rand() < 0.05 && f.w > size / 40 && f.h > size / 40) {
      g.fillStyle = 'rgba(30,48,24,0.75)';
      const step = 8 + rand() * 4;
      for (let y = f.y + step / 2; y < f.y + f.h - 2; y += step) {
        for (let x = f.x + step / 2; x < f.x + f.w - 2; x += step) {
          g.beginPath();
          g.arc(x + (rand() - 0.5) * 1.5, y + (rand() - 0.5) * 1.5, 1.7, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // Hedgerow along the boundary — what actually makes farmland read as farmland.
    g.strokeStyle = 'rgba(28,40,22,0.42)';
    g.lineWidth = 2;
    g.strokeRect(f.x, f.y, f.w, f.h);

    /* Hedgerow trees: the lone oaks that stand along old boundaries. Dotted
       down one side of a third of the fields, they give the lattice the
       irregular punctuation a real one has. */
    if (rand() < 0.34) {
      g.fillStyle = 'rgba(24,38,19,0.8)';
      const along = rand() > 0.5;
      const run = along ? f.w : f.h;
      for (let d = 4 + rand() * 10; d < run - 3; d += 9 + rand() * 16) {
        const x = along ? f.x + d : f.x + (rand() > 0.5 ? f.w : 0);
        const y = along ? f.y + (rand() > 0.5 ? f.h : 0) : f.y + d;
        g.beginPath();
        g.arc(x, y, 1.3 + rand() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /* ── The land's shape, in its colours ─────────────────────────────────
     The tops read a shade paler and drier than the valleys under them, and
     woods climb the high ground, where the plough gives up first. Both come
     off the same height field the mesh is displaced by, so the woods really
     are on the hills and the lushest fields really are in the valleys. */
  {
    const tint = document.createElement('canvas');
    tint.width = tint.height = HR;
    const tg = tint.getContext('2d') as CanvasRenderingContext2D;
    const img = tg.createImageData(HR, HR);
    for (let i = 0; i < heights.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, 0.5 + (heights[i] + detail[i] - 0.3) * 0.9)) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.save();
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = 0.36;
    g.drawImage(tint, 0, 0, size, size);
    g.restore();

    const GRID = 64;
    g.fillStyle = '#243d1d';
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const u = (gx + rand()) / GRID;
        const v = (gy + rand()) / GRID;
        if (rand() > smooth01((heightAt(u, v) - 0.45) / 0.3) * 0.8) continue;
        const r = size * (0.005 + rand() * 0.011);
        g.beginPath();
        for (let a = 0; a < 9; a++) {
          const t = (a / 9) * Math.PI * 2;
          const rr = r * (0.65 + rand() * 0.7);
          const px = u * size + Math.cos(t) * rr;
          const py = v * size + Math.sin(t) * rr;
          if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }
  }

  /* Water is a separate transparent layer so it can disappear with altitude
     instead of staining the farmland when the aircraft climbs above the
     low-level detail range. Seeded basins keep every flight consistent while
     still breaking the regular field pattern with natural silhouettes. */
  const water = ['#2f7792', '#286b87', '#3b8ca0', '#245e7b'];
  w.lineJoin = 'round';
  w.lineCap = 'round';
  for (const [i, lake] of lakes.entries()) {
    const x = size * lake.u;
    const y = size * lake.v;
    const rx = size * lake.r;
    const ry = rx * lake.aspect;
    const points = 13;
    w.beginPath();
    for (let p = 0; p < points; p++) {
      const a = (p / points) * Math.PI * 2;
      const wobble = 0.78 + rand() * 0.42;
      const px = x + Math.cos(a) * rx * wobble;
      const py = y + Math.sin(a) * ry * wobble;
      if (p === 0) w.moveTo(px, py); else w.lineTo(px, py);
    }
    w.closePath();
    w.fillStyle = water[i % water.length];
    w.globalAlpha = 0.78;
    w.fill();
    w.globalAlpha = 1;
    w.strokeStyle = 'rgba(171,224,228,0.62)';
    w.lineWidth = Math.max(1.5, size / 900);
    w.stroke();
    w.strokeStyle = 'rgba(205,242,241,0.38)';
    w.lineWidth = Math.max(1, size / 1500);
    w.beginPath();
    w.moveTo(x - rx * 0.45, y - ry * 0.12);
    w.quadraticCurveTo(x, y - ry * 0.32, x + rx * 0.46, y - ry * 0.08);
    w.stroke();
  }

  // Woodland, in the corners the plough cannot reach.
  for (let i = 0; i < 54; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.006 + rand() * 0.016);
    g.fillStyle = '#26401f';
    g.beginPath();
    for (let a = 0; a < 11; a++) {
      const t = (a / 11) * Math.PI * 2;
      const rr = r * (0.66 + rand() * 0.66);
      const px = x + Math.cos(t) * rr;
      const py = y + Math.sin(t) * rr;
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  /* A river, and lanes that do not follow it. Both wrap at the tile edge, so
     they carry across the repeat instead of stopping dead at it. */
  g.strokeStyle = '#2d5f86';
  g.lineWidth = size / 150;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, size * 0.62);
  for (let x = 0; x <= size; x += size / 24) {
    g.lineTo(x, size * 0.62 + Math.sin((x / size) * Math.PI * 2) * size * 0.1);
  }
  g.stroke();

  /* Tributaries. A river with nothing feeding it is a canal; two thinner
     streams wandering in from up-tile, each ending exactly on the river's
     own curve, make the drainage read as a system. */
  g.lineWidth = size / 340;
  for (const [x0, jitter] of [[0.31, 3], [0.79, 7]] as const) {
    const xEnd = size * x0;
    const yEnd = size * 0.62 + Math.sin(x0 * Math.PI * 2) * size * 0.1;
    g.beginPath();
    g.moveTo(xEnd + size * (0.1 + rand() * 0.1) * (jitter > 4 ? -1 : 1), 0);
    const bend = size * (0.06 + rand() * 0.1);
    g.bezierCurveTo(
      xEnd + bend, yEnd * 0.3,
      xEnd - bend, yEnd * 0.72,
      xEnd, yEnd,
    );
    g.stroke();
  }

  g.strokeStyle = 'rgba(206,198,178,0.5)';
  g.lineWidth = size / 420;
  for (const [x0, x1] of [[0.18, 0.34], [0.72, 0.58]] as const) {
    g.beginPath();
    g.moveTo(size * x0, 0);
    g.bezierCurveTo(size * (x0 + 0.08), size * 0.4, size * (x1 - 0.06), size * 0.7, size * x1, size);
    g.stroke();
  }

  /* ── Settlements ──────────────────────────────────────────────────
     At the scale this tile is laid down — three kilometres across, so
     roughly a metre and a half to the pixel — a building is about eight
     pixels. Small, but not sub-pixel, which means the honest way to draw a
     town here is to draw its buildings rather than to suggest a grey smudge
     where one would be.

     Sizes are kept deliberately modest. The tile repeats every three
     kilometres, and a landmark city would announce that repeat far more
     loudly than any field boundary: one distinctive silhouette arriving
     over and over is exactly the tell the field generator above was written
     to avoid. A market town and a scatter of villages read as countryside.
     A skyline reads as wallpaper. */
  const settlements: { x: number; y: number; r: number; core: number }[] = [];

  // One market town, kept off the tile edges so it is not cut in half.
  settlements.push({
    x: size * (0.24 + rand() * 0.42),
    y: size * (0.2 + rand() * 0.4),
    r: size * (0.075 + rand() * 0.03),
    core: 0.42,
  });

  /* Two hamlets, and no more. Six settlements to a three-kilometre tile put
     a glowing shape every few hundred metres, and at that density the eye
     stops reading them as towns and starts reading the lattice they repeat
     on — the tile, advertised. Sparse is both truer to real countryside and
     the only way the repeat stays hidden. */
  for (let i = 0; i < 2; i++) {
    settlements.push({
      x: rand() * size,
      y: rand() * size,
      r: size * (0.014 + rand() * 0.016),
      core: 0.3,
    });
  }

  for (const t of settlements) drawSettlement(g, n, t, rand, size);

  /* Rural light: farmsteads, and the odd vehicle on a lane. Scattered single
     points are what sells the dark between towns — an unlit countryside
     reads as a hole in the map rather than as land. */
  n.fillStyle = 'rgba(255,214,150,0.55)';
  for (let i = 0; i < 140; i++) {
    n.fillRect(rand() * size, rand() * size, 1.6, 1.6);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;

  const nightTex = new THREE.CanvasTexture(nc);
  nightTex.wrapS = nightTex.wrapT = THREE.RepeatWrapping;
  nightTex.anisotropy = 16;
  nightTex.colorSpace = THREE.SRGBColorSpace;

  const waterTex = new THREE.CanvasTexture(wc);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.anisotropy = 16;
  waterTex.colorSpace = THREE.SRGBColorSpace;

  /* The relief, as textures. Grey for the displacement; for the light, a
     tangent-space normal map from central differences over the fine field.
     The canvas is uploaded flipped, so +v runs up the image: the green
     channel takes +dh/dy where the red takes −dh/dx. */
  const hc = document.createElement('canvas');
  hc.width = hc.height = HR;
  const hg = hc.getContext('2d') as CanvasRenderingContext2D;
  const himg = hg.createImageData(HR, HR);
  const ncv = document.createElement('canvas');
  ncv.width = ncv.height = HR;
  const ng = ncv.getContext('2d') as CanvasRenderingContext2D;
  const nimg = ng.createImageData(HR, HR);
  const slope = HILL_HEIGHT / (TILE_METRES / HR) / 2;
  const fine = (x: number, y: number) => {
    const i = ((y + HR) % HR) * HR + ((x + HR) % HR);
    return heights[i] + detail[i];
  };
  for (let y = 0; y < HR; y++) {
    for (let x = 0; x < HR; x++) {
      const i = y * HR + x;
      const hv = Math.round(Math.min(1, Math.max(0, heights[i])) * 255);
      himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = hv;
      himg.data[i * 4 + 3] = 255;
      const nx = -(fine(x + 1, y) - fine(x - 1, y)) * slope;
      const ny = (fine(x, y + 1) - fine(x, y - 1)) * slope;
      const len = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = Math.round((nx / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nimg.data[i * 4 + 3] = 255;
    }
  }
  hg.putImageData(himg, 0, 0);
  ng.putImageData(nimg, 0, 0);
  const heightTex = new THREE.CanvasTexture(hc);
  heightTex.wrapS = heightTex.wrapT = THREE.RepeatWrapping;
  heightTex.generateMipmaps = false;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  const normalTex = new THREE.CanvasTexture(ncv);
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.anisotropy = 8;

  return { day: tex, night: nightTex, water: waterTex, height: heightTex, normal: normalTex };
}

/**
 * Open water, for the legs of the flight that cross it.
 *
 * The sea's pattern is nothing like land's, which is exactly why it earns a
 * texture of its own rather than a blue filter over the farmland: no lattice,
 * no boundaries — instead depth (broad patches where the bottom falls away),
 * swell (long parallel bands, one direction, because wind has one), current
 * lines (the bright streaks where two bodies of water shear past each other)
 * and the odd fleck of white where a crest breaks.
 *
 * The glint map is the part that moves: a transparent field of elongated
 * sparkle laid over the plate on its own drifting offset, so the surface
 * shimmers against the water under it — two layers sliding at slightly
 * different rates being the entire optical recipe for "liquid".
 */
export interface OceanTextures {
  day: THREE.CanvasTexture;
  /** Ships' lights, for after dark. Almost all of it is honestly black. */
  night: THREE.CanvasTexture;
  /** Transparent sparkle, drifted at its own rate over the plate. */
  glint: THREE.CanvasTexture;
}

export function oceanTextures(size = 1024): OceanTextures {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  let seed = 0x1f83d9ab;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };

  g.fillStyle = '#16496b';
  g.fillRect(0, 0, size, size);

  /* Depth. Broad, soft, and darker — the sea's only "fields". Doubled at the
     edges so the patches carry across the tile join. */
  for (let i = 0; i < 14; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.09 + rand() * 0.22);
    const deep = rand() > 0.4;
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grd.addColorStop(0, deep ? 'rgba(8,38,58,0.42)' : 'rgba(58,126,150,0.3)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill();
    }
  }

  /* Swell: one wind, one direction, many long soft bands. Drawn on a rotated
     frame big enough that every stroke crosses the whole tile, and stroked
     twice — a lit face and a shaded back — so each band reads as a wave and
     not as a scratch. */
  const SWELL = -0.42;
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(SWELL);
  const reach = size * 0.75;
  for (let y = -reach; y < reach; y += 9 + rand() * 14) {
    const wobble = (rand() - 0.5) * 4;
    g.strokeStyle = `rgba(196,232,240,${0.028 + rand() * 0.035})`;
    g.lineWidth = 1.6 + rand() * 1.8;
    g.beginPath(); g.moveTo(-reach, y); g.bezierCurveTo(-reach / 3, y + wobble, reach / 3, y - wobble, reach, y); g.stroke();
    g.strokeStyle = `rgba(4,22,36,${0.03 + rand() * 0.04})`;
    g.beginPath(); g.moveTo(-reach, y + 2.4); g.bezierCurveTo(-reach / 3, y + 2.4 - wobble, reach / 3, y + 2.4 + wobble, reach, y + 2.4); g.stroke();
  }
  g.restore();

  /* Current lines: a handful of brighter ribbons shearing across the swell. */
  for (let i = 0; i < 4; i++) {
    const y = rand() * size;
    g.strokeStyle = `rgba(158,214,224,${0.1 + rand() * 0.08})`;
    g.lineWidth = 2.4 + rand() * 3.2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(size * 0.3, y + (rand() - 0.5) * size * 0.24, size * 0.7, y + (rand() - 0.5) * size * 0.24, size, y);
    g.stroke();
  }

  /* Whitecaps. Sparse, tiny, aligned with the swell — a sea entirely covered
     in them is a gale, and this is an airline. */
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(SWELL);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineCap = 'round';
  for (let i = 0; i < 210; i++) {
    const x = (rand() - 0.5) * size * 1.4;
    const y = (rand() - 0.5) * size * 1.4;
    g.lineWidth = 0.8 + rand() * 1.1;
    g.globalAlpha = 0.25 + rand() * 0.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2 + rand() * 5, y); g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();

  /* ── Night: ships ─────────────────────────────────────────────────────
     A dozen for the whole tile, each a point with a fainter stern light and
     a short wake. The dark between them is the picture. */
  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const n = nc.getContext('2d') as CanvasRenderingContext2D;
  n.fillStyle = '#000000';
  n.fillRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const wake = 8 + rand() * 18;
    const grd = n.createLinearGradient(x, y, x - Math.cos(a) * wake, y - Math.sin(a) * wake);
    grd.addColorStop(0, 'rgba(140,190,220,0.3)');
    grd.addColorStop(1, 'rgba(140,190,220,0)');
    n.strokeStyle = grd;
    n.lineWidth = 1.4;
    n.beginPath(); n.moveTo(x, y); n.lineTo(x - Math.cos(a) * wake, y - Math.sin(a) * wake); n.stroke();
    n.fillStyle = 'rgba(255,240,210,0.95)';
    n.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    n.fillStyle = 'rgba(180,220,255,0.6)';
    n.fillRect(x + Math.cos(a) * 2.6 - 0.6, y + Math.sin(a) * 2.6 - 0.6, 1.2, 1.2);
  }

  /* ── Glint ────────────────────────────────────────────────────────────
     Transparent elongated sparkle, denser in loose bands so the shimmer has
     structure. It rides over the plate on its own offset. */
  const wc = document.createElement('canvas');
  wc.width = wc.height = size;
  const w = wc.getContext('2d') as CanvasRenderingContext2D;
  w.save();
  w.translate(size / 2, size / 2);
  w.rotate(SWELL);
  w.lineCap = 'round';
  for (let i = 0; i < 620; i++) {
    const x = (rand() - 0.5) * size * 1.42;
    const y = (rand() - 0.5) * size * 1.42;
    // Banded: sparkle gathers along the swell every so often.
    const band = 0.5 + 0.5 * Math.sin(y * 0.055 + rand() * 0.8);
    if (rand() > 0.28 + band * 0.6) continue;
    w.strokeStyle = `rgba(255,255,255,${0.1 + rand() * 0.26})`;
    w.lineWidth = 0.8 + rand() * 1.3;
    w.beginPath(); w.moveTo(x, y); w.lineTo(x + 3 + rand() * 9, y); w.stroke();
  }
  w.restore();

  const finish = (canvas: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 16;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { day: finish(c), night: finish(nc), glint: finish(wc) };
}

/**
 * One town, painted into the day and night canvases at once.
 *
 * A town is its street plan first and its buildings second: cut a grid,
 * rotate it off the tile's axes so no two towns line up with each other or
 * with the field boundaries, then fill the blocks with footprints that grow
 * larger and denser toward the middle. Building *colour* does most of the
 * work at altitude — a town is warm grey-brown against green fields, and
 * that contrast is what makes it read long before any single roof does.
 *
 * The night pass lights the same streets and a fraction of the same
 * buildings. Only a fraction: a town with every window lit reads as a
 * stadium. Sodium along the streets, a colder white in the few big central
 * roofs, and a glow over the whole thing — which is most of what you
 * actually see of a distant town at night.
 */
function drawSettlement(
  g: CanvasRenderingContext2D,
  n: CanvasRenderingContext2D,
  t: { x: number; y: number; r: number; core: number },
  rand: () => number,
  size: number,
) {
  const { r } = t;
  const angle = rand() * Math.PI;
  /* Slate, tile, tar and the occasional pale industrial roof. Kept close in
     value so the town reads as one mass at altitude and only resolves into
     separate buildings when you are near it. */
  const roofs = ['#7f766b', '#6b635a', '#8a7d6e', '#5f584f', '#94856f', '#776b5f', '#a09384'];

  g.save();
  n.save();
  for (const ctx of [g, n]) {
    ctx.translate(t.x, t.y);
    ctx.rotate(angle);
  }

  /* The outline, worked out once and then used three times: as the made
     ground, as the clip the streets are cut to, and as the shape of the
     glow above it. Clipping the streets to a circle instead — which is what
     this did first — turned every village into a perfectly round disc of
     crosshatch, and a field of those reads as a textile print rather than
     as land. */
  const blob: [number, number][] = [];
  for (let a = 0; a < 14; a++) {
    const th = (a / 14) * Math.PI * 2;
    const rr = r * (0.72 + rand() * 0.56);
    blob.push([Math.cos(th) * rr, Math.sin(th) * rr]);
  }
  const tracePath = (ctx: CanvasRenderingContext2D, scale = 1) => {
    ctx.beginPath();
    blob.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px * scale, py * scale);
      else ctx.lineTo(px * scale, py * scale);
    });
    ctx.closePath();
  };

  g.fillStyle = 'rgba(104,97,86,0.62)';
  tracePath(g);
  g.fill();

  const street = Math.max(6, r * 0.16);

  /* Streets, clipped to the blob, so the outline stays organic while the
     interior stays rectilinear — which is how a town that grew around a
     crossroads looks from the air. */
  g.save();
  n.save();
  for (const ctx of [g, n]) {
    tracePath(ctx);
    ctx.clip();
  }

  /* Narrow, and a warm grey rather than white. At six pixels of a
     twenty-nine pixel block the streets were a fifth of the town's area and
     it read as white netting over a field — roads are the gaps between
     buildings, not the subject. */
  g.strokeStyle = 'rgba(176,170,157,0.62)';
  g.lineWidth = Math.max(1, r * 0.021);
  n.strokeStyle = 'rgba(255,186,92,0.5)';
  n.lineWidth = Math.max(1, r * 0.03);
  for (let i = -7; i <= 7; i++) {
    const o = i * street;
    if (Math.abs(o) > r) continue;
    for (const ctx of [g, n]) {
      ctx.beginPath(); ctx.moveTo(-r, o); ctx.lineTo(r, o); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o, -r); ctx.lineTo(o, r); ctx.stroke();
    }
  }

  /* Buildings, block by block. Footprint and the chance of there being a
     building at all both fall off with distance from the centre, which is
     the difference between a town and a housing estate. */
  for (let i = -7; i <= 7; i++) {
    for (let j = -7; j <= 7; j++) {
      const bx = i * street;
      const by = j * street;
      const d = Math.hypot(bx, by) / r;
      if (d > 1) continue;
      if (rand() > 1.05 - d * 0.75) continue;

      const central = d < t.core;
      const pad = street * 0.16;
      const w = street * (central ? 0.54 + rand() * 0.28 : 0.3 + rand() * 0.3);
      const h = street * (central ? 0.54 + rand() * 0.28 : 0.3 + rand() * 0.3);
      const ox = bx + pad + rand() * Math.max(0, street - w - pad * 2) * 0.6;
      const oy = by + pad + rand() * Math.max(0, street - h - pad * 2) * 0.6;

      g.fillStyle = roofs[Math.floor(rand() * roofs.length)];
      g.fillRect(ox, oy, w, h);

      if (rand() < (central ? 0.55 : 0.26)) {
        n.fillStyle = central ? 'rgba(255,236,200,0.92)' : 'rgba(255,206,140,0.7)';
        n.fillRect(ox, oy, Math.max(1, w * 0.8), Math.max(1, h * 0.8));
      }
    }
  }
  g.restore();
  n.restore();

  /* The lit air over a town. Additive, so it stacks on the streets and
     windows already there rather than washing them out. */
  n.globalCompositeOperation = 'lighter';
  const glow = n.createRadialGradient(0, 0, 0, 0, 0, r * 1.15);
  glow.addColorStop(0, 'rgba(255,178,86,0.20)');
  glow.addColorStop(0.55, 'rgba(255,160,70,0.07)');
  glow.addColorStop(1, 'rgba(255,150,60,0)');
  n.fillStyle = glow;
  /* Poured into the town's own outline rather than a circle, and blurred,
     so the halo has the shape of the place under it. */
  n.filter = `blur(${Math.max(2, r * 0.18)}px)`;
  tracePath(n, 1.25);
  n.fill();
  n.filter = 'none';
  n.globalCompositeOperation = 'source-over';

  /* Roads out. A town nobody can reach is a model village, and a lit ribbon
     leaving one is the clearest thing in a night landscape. */
  const spokes = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < spokes; i++) {
    const a = rand() * Math.PI * 2;
    const len = size * (0.14 + rand() * 0.3);
    const ex = Math.cos(a) * len;
    const ey = Math.sin(a) * len;
    const bend = (rand() - 0.5) * len * 0.4;
    const cpx = ex * 0.5 - bend;
    const cpy = ey * 0.5 + bend;

    g.strokeStyle = 'rgba(198,190,172,0.36)';
    g.lineWidth = Math.max(0.9, r * 0.028);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(cpx, cpy, ex, ey);
    g.stroke();

    n.strokeStyle = 'rgba(255,170,80,0.16)';
    n.lineWidth = Math.max(0.8, r * 0.03);
    n.beginPath();
    n.moveTo(0, 0);
    n.quadraticCurveTo(cpx, cpy, ex, ey);
    n.stroke();
  }

  g.restore();
  n.restore();
}

/**
 * A cumulus lump, for the cloud billboards.
 *
 * A single radial gradient reads as a smoke puff, not a cloud: real cumulus is
 * a cluster of bulges with a cauliflower top and a base flat enough to make a
 * deck when a few hundred of them line up at one altitude. This composites
 * nine overlapping lobes into that silhouette, then bakes the lighting in —
 * bright along the top where the sun lands, blue-shadowed underneath, which is
 * the cue that tells you a cloud is solid and which way is up.
 *
 * Baking the shade into the texture rather than lighting the billboards keeps
 * them on an unlit material: five hundred of these cost one draw call, and the
 * sun's colour is applied to the whole deck as a tint instead.
 */
export function cloudTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  /* The lobes, in texture units: x, y, radius. Wider than tall, weighted to
     the upper half so the base stays flat and the crown piles up. */
  const lobes: [number, number, number][] = [
    [0.50, 0.46, 0.30],
    [0.30, 0.56, 0.23],
    [0.70, 0.56, 0.23],
    [0.40, 0.36, 0.21],
    [0.61, 0.38, 0.19],
    [0.50, 0.28, 0.16],
    [0.17, 0.62, 0.15],
    [0.83, 0.62, 0.15],
    [0.50, 0.62, 0.26],
  ];

  for (const [lx, ly, lr] of lobes) {
    const x = lx * size;
    const y = ly * size;
    const r = lr * size;
    // Each lobe is lit from above: the gradient's centre is offset upward, so
    // the bright core sits on the lobe's crown rather than in its middle.
    const grd = g.createRadialGradient(x, y - r * 0.35, r * 0.05, x, y, r);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.98)');
    grd.addColorStop(0.45, 'rgba(246,249,255,0.80)');
    grd.addColorStop(0.78, 'rgba(226,236,250,0.30)');
    grd.addColorStop(1.00, 'rgba(214,228,248,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /* The underside. Cumulus bases are grey-blue and nearly flat — that shadow
     is most of what separates a cloud from a cotton ball. */
  g.globalCompositeOperation = 'source-atop';
  const base = g.createLinearGradient(0, size * 0.42, 0, size * 0.80);
  base.addColorStop(0, 'rgba(150,172,205,0)');
  base.addColorStop(1, 'rgba(96,120,158,0.62)');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  /* And the crown, catching the sun. */
  const crown = g.createLinearGradient(0, size * 0.10, 0, size * 0.46);
  crown.addColorStop(0, 'rgba(255,252,244,0.55)');
  crown.addColorStop(1, 'rgba(255,252,244,0)');
  g.fillStyle = crown;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A radial falloff, for the sun's disc and the bloom around it.
 *
 * `hardness` is where the gradient is still fully opaque: near 1 it is a disc
 * with a clean limb, near 0 it is all halo. A sprite with no map at all is a
 * square, which is a surprisingly easy way to put a box in the sky.
 */
export function radialTexture(hardness = 0.5, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.min(0.96, hardness), 'rgba(255,255,255,1)');
  // A short shoulder past the hard edge keeps the limb from aliasing.
  grd.addColorStop(Math.min(0.98, hardness + (1 - hardness) * 0.35), 'rgba(255,255,255,0.42)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
