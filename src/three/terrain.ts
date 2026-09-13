import * as THREE from 'three';

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

function noise2(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

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
export function farmlandTexture(size = 2048): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

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

    // Hedgerow along the boundary — what actually makes farmland read as farmland.
    g.strokeStyle = 'rgba(28,40,22,0.42)';
    g.lineWidth = 2;
    g.strokeRect(f.x, f.y, f.w, f.h);
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

  g.strokeStyle = 'rgba(206,198,178,0.5)';
  g.lineWidth = size / 420;
  for (const [x0, x1] of [[0.18, 0.34], [0.72, 0.58]] as const) {
    g.beginPath();
    g.moveTo(size * x0, 0);
    g.bezierCurveTo(size * (x0 + 0.08), size * 0.4, size * (x1 - 0.06), size * 0.7, size * x1, size);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The lunar surface: grey regolith, mare, and craters. */
export function moonTexture(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  g.fillStyle = '#736e66';
  g.fillRect(0, 0, size, size);

  // Mare first, so craters sit on top of them.
  for (let i = 0; i < 7; i++) {
    const x = noise2(i, 1, 41) * size;
    const y = noise2(i, 2, 43) * size;
    const r = size * (0.08 + noise2(i, 3, 47) * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(58,55,50,0.85)');
    grd.addColorStop(1, 'rgba(58,55,50,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  for (let i = 0; i < 260; i++) {
    const x = noise2(i, 5, 53) * size;
    const y = noise2(i, 7, 59) * size;
    const r = 3 + noise2(i, 11, 61) ** 3 * size * 0.05;
    g.fillStyle = 'rgba(40,37,33,0.7)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(168,161,150,0.5)';
    g.beginPath(); g.arc(x - r * 0.12, y - r * 0.18, r * 0.82, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(30,28,25,0.55)';
    g.beginPath(); g.arc(x + r * 0.1, y + r * 0.14, r * 0.55, 0, Math.PI * 2); g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

/**
 * Earth, seen from the moon.
 *
 * The README has promised Earthrise off the port side since the first commit,
 * and the exterior view has always drawn one — but the cabin windows, which
 * are where somebody actually sits, looked out on an empty black sky. This is
 * the texture that fixes that: ocean, continents, ice, and a band of cloud,
 * all painted rather than fetched so the moon band still costs no network.
 *
 * It is not a map of anywhere. It is the *read* of Earth from a quarter of a
 * million miles — blue, mostly water, wrapped in white — which at the size it
 * appears in a cabin window is the whole of the information.
 */
export function earthTexture(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 2; // equirectangular: 2:1
  const w = c.width;
  const h = c.height;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  /* Ocean, deeper toward the poles the way the real one reads from orbit. */
  const sea = g.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0.00, '#123a63');
  sea.addColorStop(0.30, '#14538c');
  sea.addColorStop(0.50, '#1668ab');
  sea.addColorStop(0.70, '#14538c');
  sea.addColorStop(1.00, '#123a63');
  g.fillStyle = sea;
  g.fillRect(0, 0, w, h);

  /* Landmasses, as ragged blobs. Each is a ring of radii jittered by the hash,
     which gives a coastline that wanders instead of a circle. */
  const land: [number, number, number, number][] = [
    // x, y, radius, seed — roughly where the continents sit, no more than that
    [0.16, 0.30, 0.13, 3], [0.22, 0.52, 0.09, 7], [0.30, 0.66, 0.07, 11],
    [0.47, 0.26, 0.10, 13], [0.52, 0.40, 0.08, 17], [0.55, 0.62, 0.06, 19],
    [0.62, 0.30, 0.15, 23], [0.72, 0.44, 0.08, 29], [0.80, 0.66, 0.07, 31],
    [0.88, 0.32, 0.11, 37], [0.06, 0.44, 0.06, 41], [0.40, 0.20, 0.09, 43],
  ];

  const blob = (cx: number, cy: number, r: number, seed: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    const steps = 26;
    for (let a = 0; a <= steps; a++) {
      const t = (a / steps) * Math.PI * 2;
      // Two octaves of jitter: a lumpy outline, with smaller bays cut into it.
      const j =
        0.55 +
        noise2(a, seed, 71) * 0.7 +
        noise2(a * 3, seed, 83) * 0.28;
      const px = cx + Math.cos(t) * r * j * w;
      const py = cy + Math.sin(t) * r * j * h * 1.35;
      if (a === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  };

  for (const [lx, ly, lr, seed] of land) {
    const cx = lx * w;
    const cy = ly * h;
    // Green near the equator, sand through the desert latitudes.
    const equatorial = Math.abs(ly - 0.5) < 0.16;
    blob(cx, cy, lr, seed, equatorial ? '#2f6a37' : '#4e7a3e');
    // A drier interior, offset so it does not sit concentric.
    blob(cx + w * 0.012, cy - h * 0.01, lr * 0.55, seed + 101, equatorial ? '#3d7a3f' : '#8a7647');
  }

  /* Ice. The caps are the brightest thing on the disc and the easiest way to
     read which way up the planet is. */
  const cap = (top: boolean) => {
    const grd = g.createLinearGradient(0, top ? 0 : h, 0, top ? h * 0.17 : h * 0.83);
    grd.addColorStop(0, 'rgba(248,252,255,0.97)');
    grd.addColorStop(1, 'rgba(248,252,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, top ? 0 : h * 0.83, w, h * 0.17);
  };
  cap(true);
  cap(false);

  /* Weather. Banded rather than scattered — the trade cumulus along the
     equator and the frontal spirals in the mid-latitudes are the pattern the
     eye recognises as a living planet. */
  for (let i = 0; i < 150; i++) {
    const x = noise2(i, 5, 91) * w;
    const band = noise2(i, 9, 97);
    // Cluster toward the equator and the two storm-track latitudes.
    const y = (band < 0.4 ? 0.5 : band < 0.7 ? 0.24 : 0.76) * h + (noise2(i, 11, 101) - 0.5) * h * 0.16;
    const r = w * (0.012 + noise2(i, 13, 103) ** 2 * 0.05);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.82)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r * 1.9, r * 0.75, 0, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
