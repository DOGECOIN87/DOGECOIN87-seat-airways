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

/** Farmland: irregular fields, a river, and roads between them. */
export function farmlandTexture(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  g.fillStyle = '#4a5c3a';
  g.fillRect(0, 0, size, size);

  // Fields, on an irregular grid so no two are the same size.
  const cells = 14;
  const step = size / cells;
  /* Farmland from the air is not one green. A working landscape is pasture
     next to ploughed earth next to rape in flower next to stubble, and that
     variety is the only thing that makes the ground legible enough to see
     moving underneath you from six thousand feet. */
  const greens = [
    '#4c6b34', '#3d5a2b', '#628040', '#7d9048', // pasture and cereal
    '#8a6f42', '#6d5334', '#9c8354',            // ploughed and fallow
    '#c9bd52', '#b8a94a',                       // rape and stubble
    '#2f4a26', '#56743a',
  ];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const jx = (noise2(i, j, 11) - 0.5) * step * 0.5;
      const jy = (noise2(i, j, 29) - 0.5) * step * 0.5;
      g.fillStyle = greens[Math.floor(noise2(i, j, 7) * greens.length)];
      g.fillRect(i * step + jx, j * step + jy, step * (0.85 + noise2(i, j, 3) * 0.4), step * (0.85 + noise2(i, j, 5) * 0.4));
    }
  }

  // Woodland, in the corners the plough cannot reach.
  for (let i = 0; i < 26; i++) {
    const x = noise2(i, 91, 41) * size;
    const y = noise2(i, 17, 43) * size;
    const r = step * (0.18 + noise2(i, 5, 47) * 0.3);
    g.fillStyle = '#26401f';
    g.beginPath();
    for (let a = 0; a < 9; a++) {
      const t = (a / 9) * Math.PI * 2;
      const rr = r * (0.7 + noise2(i, a, 53) * 0.6);
      const px = x + Math.cos(t) * rr;
      const py = y + Math.sin(t) * rr;
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  // Hedgerows, which is what actually makes farmland read as farmland.
  g.strokeStyle = 'rgba(28,40,22,0.5)';
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    const o = (noise2(i, 0, 13) - 0.5) * step * 0.4;
    g.beginPath(); g.moveTo(i * step + o, 0); g.lineTo(i * step + o, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step + o); g.lineTo(size, i * step + o); g.stroke();
  }

  // A river, and a road that does not follow it.
  g.strokeStyle = '#2d5f86';
  g.lineWidth = 9;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, size * 0.62);
  for (let x = 0; x <= size; x += size / 12) {
    g.lineTo(x, size * 0.62 + Math.sin(x / size * 7) * size * 0.09 + (noise2(x, 3, 17) - 0.5) * 40);
  }
  g.stroke();

  g.strokeStyle = 'rgba(198,188,166,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(size * 0.18, 0);
  g.lineTo(size * 0.3, size);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
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

/** A soft round puff, for the cloud billboards. */
export function cloudTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.86)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.24)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
