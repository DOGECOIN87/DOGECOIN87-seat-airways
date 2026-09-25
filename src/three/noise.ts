/**
 * The noise everything procedural here is grown from — shared by the page's
 * texture builders and the worker that builds the other worlds off the main
 * thread, so it carries no three.js and no browser.
 */

/** A hash of a lattice point: 0–1, the same every time for the same point and seed. */
export function noise2(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/**
 * Value noise that tiles: a lattice of `cells` × `cells` random heights,
 * wrapped at the edge and blended with a quintic, so the field joins itself
 * at the repeat exactly. Whole-number frequencies per tile are the whole
 * trick — a periodic lattice is periodic noise.
 */
export function periodicNoise(res: number, cells: number, seed: number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) lattice[j * cells + i] = noise2(i, j, seed);
  }
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    const fy = (y / res) * cells;
    const iy = Math.floor(fy);
    const ty = ease(fy - iy);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < res; x++) {
      const fx = (x / res) * cells;
      const ix = Math.floor(fx);
      const tx = ease(fx - ix);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const top = lattice[y0 + x0] + (lattice[y0 + x1] - lattice[y0 + x0]) * tx;
      const bottom = lattice[y1 + x0] + (lattice[y1 + x1] - lattice[y1 + x0]) * tx;
      out[y * res + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Smooth value noise in three dimensions, for shaping a body in the round. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const e = (t: number) => t * t * (3 - 2 * t);
  const u = e(x - xi);
  const v = e(y - yi);
  const w = e(z - zi);
  const at = (a: number, b: number, c: number) => noise2(xi + a, yi + b + (zi + c) * 131, seed);
  const lx = (b: number, c: number) => at(0, b, c) + (at(1, b, c) - at(0, b, c)) * u;
  const ly = (c: number) => lx(0, c) + (lx(1, c) - lx(0, c)) * v;
  return ly(0) + (ly(1) - ly(0)) * w;
}
