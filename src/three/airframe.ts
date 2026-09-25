import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CABIN, rowZ } from './cabin';
import { MARK_PATH } from '../components/Mark';
import { BEACON_CYCLE, createLampRig, type LampSpec, type WindowSpot } from './lamps';

/**
 * The aircraft, from outside.
 *
 * The exterior view used to be a separate hand-drawn SVG: its own sky, its own
 * ground, its own aeroplane, none of which were the ones the cabin windows
 * looked out on. It could be polished but not fixed — flat vector fills have a
 * ceiling, and past a certain point more gradients only make a flatter drawing
 * more elaborate.
 *
 * So the aeroplane is built here instead, in metres, in the same scene the
 * cabin already lives in. It gets the real sun, the real scattering sky, the
 * real cloud deck and the real ground for free, and the aircraft you orbit is
 * literally the tube whose seats you are booking — same radius, same thirty
 * rows at the same pitch, windows punched where the rows actually are.
 *
 * Dimensions are an A320's: 37.6 m long, 34 m span, 1.85 m body radius.
 */

/** Nose tip and tail tip, in the cabin's own z (row 1 sits at z = 0). */
const NOSE_Z = -7.6;
const TAIL_Z = 31.8;

/* Where the wing sits on the fuselage.
 *
 * The wing, the winglet raked off its tip, the lights at that tip, the
 * flap-track fairings under it and the engines hanging from it
 * are one assembly that has to move as one. Each of them used to carry its
 * own copy of the wing's fore-and-aft numbers, so shifting the wing meant
 * finding five sets of literals and getting every one of them right —
 * and missing one left the engines hanging in the air where the wing used
 * to be. Everything below derives from this.
 *
 * `rootZ` is the station of the root leading edge: the nose is at NOSE_Z,
 * the tail at TAIL_Z, so a smaller number is further forward. `tipZ` is the
 * tip's leading edge, aft of the root's — that difference is the sweep. */
const WING = {
  rootZ: 7.6,
  rootChord: 6.4,
  tipZ: 14.7,
  tipChord: 1.9,
  span: 15.6,
  /** Root underside, and how far the tip rises above it: the dihedral. */
  rootY: -1.15,
  rise: 1.7,
  /** The engine hangs this far aft of the root leading edge. */
  engineZ: 1.6,
  /** The winglet's own chord-wise extent, off the tip. */
  wingletRun: 1.1,
};
const R = CABIN.radius;

/* ── Fuselage ─────────────────────────────────────────────────────────────
   A body of revolution swept along z, which is the only honest way to get the
   three things that make an airliner readable in silhouette: an ogive nose
   that is round rather than conical, a long constant-section tube, and a tail
   that both tapers and *lifts* — the upsweep that clears the runway on
   rotation, and the single most recognisable line on the aeroplane. */

/** Body radius at a station. */
function radiusAt(z: number): number {
  if (z <= NOSE_Z) return 0.001;
  if (z < -2.2) {
    // Ogive: fast at the tip, flattening into the barrel.
    const t = (z - NOSE_Z) / (-2.2 - NOSE_Z);
    return R * Math.pow(t, 0.42);
  }
  if (z < 23.5) return R;
  const t = (z - 23.5) / (TAIL_Z - 23.5);
  // Tapers to a blade rather than a point — a tail cone ends in a fairing.
  return R * (1 - 0.86 * Math.pow(t, 1.5));
}

/** How far the centreline has lifted at a station. */
function riseAt(z: number): number {
  if (z < 21) return 0;
  const t = (z - 21) / (TAIL_Z - 21);
  return 2.15 * t * t;
}

function fuselageGeometry(): THREE.BufferGeometry {
  const RINGS = 96;
  const SEG = 44;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const z = NOSE_Z + (TAIL_Z - NOSE_Z) * t;
    const r = radiusAt(z);
    const y0 = riseAt(z);
    // Slope of the surface along z, so the normals stay honest on the cones.
    const dz = 0.05;
    const dr = (radiusAt(z + dz) - radiusAt(z - dz)) / (2 * dz);

    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(ca * r, y0 + sa * r, z);
      const n = new THREE.Vector3(ca, sa, -dr).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(t, j / SEG);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      const b = a + SEG + 1;
      // Counter-clockwise seen from outside, or the skin is culled and the
      // tube renders as its own dark interior.
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ── Lifting surfaces ─────────────────────────────────────────────────────
   Wings, fin and tailplane share a tapered aerofoil. The old eight-corner
   wedge put a hard diagonal through every wing and made a quarter-view read
   like a folded paper aeroplane. A handful of profile stations is inexpensive
   but gives the leading edge, camber and trailing edge somewhere for light to
   travel — the difference between a silhouette and an aircraft. */

interface Panel {
  /** Root and tip, as [spanwise, leading-edge z, chord, thickness]. */
  rootZ: number;
  rootChord: number;
  rootThick: number;
  tipZ: number;
  tipChord: number;
  tipThick: number;
  span: number;
  /** Tip rise, for dihedral (or the fin's height). */
  rise: number;
  /** Where the root sits. */
  originX: number;
  originY: number;
}

function panelGeometry(p: Panel): THREE.BufferGeometry {
  // chord position, camber as a fraction of thickness, and thickness. The
  // outline intentionally has a blunt leading edge and a fine trailing edge.
  const profile: [number, number, number][] = [
    [0.00, 0.00, 0.00], [0.045, 0.04, 0.52], [0.13, 0.06, 0.88],
    [0.34, 0.07, 1.00], [0.62, 0.045, 0.74], [0.84, 0.018, 0.36], [1.00, 0.00, 0.045],
    [0.84, -0.012, -0.23], [0.62, -0.025, -0.43], [0.34, -0.035, -0.60],
    [0.13, -0.026, -0.52], [0.045, -0.012, -0.28],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const t of [0, 1]) {
    const x = p.originX + p.span * t;
    const y = p.originY + p.rise * t;
    const z = THREE.MathUtils.lerp(p.rootZ, p.tipZ, t);
    const chord = THREE.MathUtils.lerp(p.rootChord, p.tipChord, t);
    const thick = THREE.MathUtils.lerp(p.rootThick, p.tipThick, t) / 2;
    for (const [at, camber, shape] of profile) {
      pos.push(x, y + (camber + shape) * thick, z + at * chord);
    }
  }

  const count = profile.length;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const a = i;
    const b = next;
    const c = count + i;
    const d = count + next;
    // The left-hand surfaces reverse their span direction, so their winding
    // must reverse too or their lit top surface is culled.
    if (p.span >= 0) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }

  // Cap the exposed tip. The root disappears cleanly into the fuselage.
  const tipCentre = pos.length / 3;
  pos.push(p.originX + p.span, p.originY + p.rise, p.tipZ + p.tipChord * 0.42);
  for (let i = 0; i < count; i++) {
    const a = count + i;
    const b = count + ((i + 1) % count);
    if (p.span >= 0) idx.push(tipCentre, a, b);
    else idx.push(tipCentre, b, a);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── Reading a point off a lifting surface ────────────────────────────────
   The aerofoil above is a table of chord stations, so anything that has to
   sit *on* a wing — a hinge line, a flap track, a panel seam — can be placed
   by interpolating the same table rather than by guessing a height and
   hoping. `t` runs root to tip, `f` runs leading edge to trailing edge. */
function upperSurface(p: Panel, t: number, f: number, lift = 0.01): THREE.Vector3 {
  const profile: [number, number][] = [
    [0.00, 0.00], [0.045, 0.56], [0.13, 0.94], [0.34, 1.07],
    [0.62, 0.785], [0.84, 0.378], [1.00, 0.045],
  ];
  let shape = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [a0, v0] = profile[i];
    const [a1, v1] = profile[i + 1];
    if (f >= a0 && f <= a1) {
      shape = THREE.MathUtils.lerp(v0, v1, (f - a0) / (a1 - a0));
      break;
    }
  }
  const thick = THREE.MathUtils.lerp(p.rootThick, p.tipThick, t) / 2;
  const chord = THREE.MathUtils.lerp(p.rootChord, p.tipChord, t);
  return new THREE.Vector3(
    p.originX + p.span * t,
    p.originY + p.rise * t + shape * thick + lift,
    THREE.MathUtils.lerp(p.rootZ, p.tipZ, t) + f * chord,
  );
}

/**
 * The seams around a control surface.
 *
 * What actually reads as detail on a wing at any distance worth drawing one
 * is not rivets or panel lines — it is the hinge line, because a control
 * surface is a different shape from the wing it hangs off and the gap
 * between them catches light. One spanwise line at the hinge and a tick at
 * each end of every surface gives ailerons, flaps and spoilers for a few
 * dozen vertices, and turns a smooth slab into something with moving parts.
 */
function controlSeams(
  p: Panel,
  hinge: number,
  runs: [number, number][],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  for (const [t0, t1] of runs) {
    // The hinge itself, walked in a few steps so it follows the dihedral
    // instead of cutting a chord through it.
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const ta = THREE.MathUtils.lerp(t0, t1, i / steps);
      const tb = THREE.MathUtils.lerp(t0, t1, (i + 1) / steps);
      seg(upperSurface(p, ta, hinge), upperSurface(p, tb, hinge));
    }
    // The ends: where one surface stops and the next begins.
    for (const t of [t0, t1]) {
      seg(upperSurface(p, t, hinge), upperSurface(p, t, 0.995));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/* ── Cutting control surfaces out of the panels ───────────────────────────
   The ailerons, elevators and rudder used to be seam lines drawn on solid
   panels — fine until one is supposed to move. So those panels are now
   lofted in pieces: the fixed surface with the control surface's chord cut
   away over its span, and the control surface itself as a separate solid,
   hung on its true hinge line. Same aerofoil as `panelGeometry`, split into
   its two skins so any chord range can be cut out of it. */
type Station = readonly [number, number];
const UPPER: readonly Station[] = [
  [0, 0], [0.045, 0.56], [0.13, 0.94], [0.34, 1.07], [0.62, 0.785], [0.84, 0.378], [1, 0.045],
];
const LOWER: readonly Station[] = [
  [0, 0], [0.045, -0.292], [0.13, -0.546], [0.34, -0.635], [0.62, -0.455], [0.84, -0.242], [1, 0.045],
];

function surfaceAt(table: readonly Station[], f: number): number {
  for (let i = 0; i < table.length - 1; i++) {
    const [a0, v0] = table[i];
    const [a1, v1] = table[i + 1];
    if (f >= a0 && f <= a1) return THREE.MathUtils.lerp(v0, v1, (f - a0) / (a1 - a0));
  }
  return table[table.length - 1][1];
}

/** Either skin's height, as a fraction of half-thickness. A fin or a
    tailplane is a symmetric section; only the wing is cambered. */
function surfaceY(f: number, upper: boolean, symmetric: boolean): number {
  if (!symmetric) return surfaceAt(upper ? UPPER : LOWER, f);
  const half = (surfaceAt(UPPER, f) - surfaceAt(LOWER, f)) / 2;
  return upper ? half : -half;
}

function panelPoint(p: Panel, t: number, f: number, yf: number): THREE.Vector3 {
  const chord = THREE.MathUtils.lerp(p.rootChord, p.tipChord, t);
  const half = THREE.MathUtils.lerp(p.rootThick, p.tipThick, t) / 2;
  return new THREE.Vector3(
    p.originX + p.span * t,
    p.originY + p.rise * t + yf * half,
    THREE.MathUtils.lerp(p.rootZ, p.tipZ, t) + f * chord,
  );
}

/**
 * One piece of a lifting surface — span t0 to t1, chord f0 to f1 — as a
 * closed solid. Each face group (the two skins, the cut faces, the end
 * caps) gets its own vertices, so the aerofoil shades smooth while its cut
 * edges stay crisp. Wound like `panelGeometry`: along the upper skin, back
 * along the lower.
 */
function panelSection(p: Panel, t0: number, t1: number, f0: number, f1: number, symmetric: boolean): THREE.BufferGeometry {
  const stations = [f0, ...UPPER.map(([f]) => f).filter((f) => f > f0 + 1e-6 && f < f1 - 1e-6), f1];
  const upperRun: Station[] = stations.map((f) => [f, surfaceY(f, true, symmetric)]);
  const lowerRun: Station[] = [...stations].reverse().map((f) => [f, surfaceY(f, false, symmetric)]);
  const pos: number[] = [];
  const idx: number[] = [];
  const flip = p.span < 0;

  const loft = (run: readonly Station[]) => {
    const base = pos.length / 3;
    for (const [f, yf] of run) {
      const a = panelPoint(p, t0, f, yf);
      const b = panelPoint(p, t1, f, yf);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i < run.length - 1; i++) {
      const a = base + i * 2;
      const c = a + 1;
      const b = a + 2;
      const d = a + 3;
      if (!flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  };
  loft(upperRun);
  loft(lowerRun);
  // The cut faces, wherever a chord range stops short of the nose or tail.
  const same = (a: Station, b: Station) => Math.abs(a[1] - b[1]) < 1e-6;
  const aftUp = upperRun[upperRun.length - 1];
  const aftLow = lowerRun[0];
  if (!same(aftUp, aftLow)) loft([aftUp, aftLow]);
  const foreLow = lowerRun[lowerRun.length - 1];
  const foreUp = upperRun[0];
  if (!same(foreLow, foreUp)) loft([foreLow, foreUp]);

  // The end caps, fanned from the section's centre.
  let low = lowerRun;
  if (same(aftUp, aftLow)) low = low.slice(1);
  if (same(foreLow, foreUp)) low = low.slice(0, -1);
  const ring = [...upperRun, ...low];
  for (const [t, outer] of [[t0, false], [t1, true]] as const) {
    const pts = ring.map(([f, yf]) => panelPoint(p, t, f, yf));
    const centre = pts.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(pts.length);
    const base = pos.length / 3;
    pos.push(centre.x, centre.y, centre.z);
    for (const v of pts) pos.push(v.x, v.y, v.z);
    const faceOut = outer !== flip;
    for (let i = 0; i < pts.length; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % pts.length);
      if (faceOut) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A panel with a control surface's chord cut away between t0 and t1. */
function cutPanel(p: Panel, t0: number, t1: number, hinge: number, symmetric: boolean): THREE.BufferGeometry {
  const parts = [
    panelSection(p, 0, t0, 0, 1, symmetric),
    panelSection(p, t0, t1, 0, hinge, symmetric),
    panelSection(p, t1, 1, 0, 1, symmetric),
  ];
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('control surface cut-out did not merge');
  return merged;
}

/** The hinge: mid-thickness at the hinge chord, from inboard to outboard. */
function hingeLine(p: Panel, t0: number, t1: number, f: number, symmetric: boolean) {
  const mid = (surfaceY(f, true, symmetric) + surfaceY(f, false, symmetric)) / 2;
  const pivot = panelPoint(p, t0, f, mid);
  const axis = panelPoint(p, t1, f, mid).sub(pivot).normalize();
  return { pivot, axis };
}

/**
 * The outline of a cut-out control surface, drawn on both skins of the
 * fixed panel: the hinge line and the two ends. It is what makes a surface
 * legible as a separate part at a glance, even at rest — and it stays put
 * on the fixed panel while the surface moves, so the movement reads
 * against it.
 */
function hingeSeams(p: Panel, t0: number, t1: number, f: number, symmetric: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const LIFT = 0.012;
  const on = (t: number, ff: number, upper: boolean) => {
    const yf = surfaceY(ff, upper, symmetric);
    const v = panelPoint(p, t, ff, yf);
    v.y += upper ? LIFT : -LIFT;
    return v;
  };
  for (const upper of [true, false]) {
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const a = on(THREE.MathUtils.lerp(t0, t1, i / steps), f, upper);
      const b = on(THREE.MathUtils.lerp(t0, t1, (i + 1) / steps), f, upper);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (const t of [t0, t1]) {
      const a = on(t, f, upper);
      const b = on(t, 0.995, upper);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Where the ailerons are: outboard, spanwise, and their hinge chord. */
const AILERON = { t0: 0.72, t1: 0.95, hinge: 0.74 };

/** A separate trailing-edge surface that can rotate around its hinge. */
function flapGeometry(
  p: Panel,
  t0: number,
  t1: number,
  hinge: number,
  trail: number,
): { geometry: THREE.BufferGeometry; pivot: THREE.Vector3 } {
  const pivot = upperSurface(p, t0, hinge, 0.025);
  const points = [
    upperSurface(p, t0, hinge, 0.025),
    upperSurface(p, t1, hinge, 0.025),
    upperSurface(p, t1, trail, 0.025),
    upperSurface(p, t0, trail, 0.025),
  ];
  const thickness = 0.065;
  const pos: number[] = [];
  for (const point of points) pos.push(point.x - pivot.x, point.y - pivot.y, point.z - pivot.z);
  for (const point of points) pos.push(point.x - pivot.x, point.y - pivot.y - thickness, point.z - pivot.z);
  const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  return { geometry, pivot };
}

/** The belly fairing: a scaled sphere, centred under the wing box. */
const FAIRING = {
  y: -R * 0.66,
  z: WING.rootZ + WING.rootChord * 0.52,
  rx: R * 1.02,
  ry: R * 0.74,
  rz: WING.rootChord * 1.42,
};

/**
 * The wing-root fairing.
 *
 * An airliner does not have a wing that stops at the skin: it has a wing box
 * running through the fuselage, and a long blister underneath covering it,
 * the main gear bays and the air-conditioning packs. Without it the wing
 * reads as having been pushed into the side of a tube, which is exactly what
 * it was. It is the single largest thing missing from the silhouette, and
 * from below it is most of what there is to see.
 */
function bellyFairing(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 24);
  g.scale(FAIRING.rx, FAIRING.ry, FAIRING.rz);
  g.translate(0, FAIRING.y, FAIRING.z);
  return g;
}

/** The centre of the mark on the fin's starboard face; the port one mirrors it. */
const FIN_MARK_AT = { x: 0.2, y: R * 0.72 + 2.45, z: 28.5 };

/** The underside of the fairing at a station. */
function fairingBottom(z: number): number {
  const u = (z - FAIRING.z) / FAIRING.rz;
  return FAIRING.y - FAIRING.ry * Math.sqrt(Math.max(0, 1 - u * u));
}

/**
 * The dorsal fillet ahead of the fin.
 *
 * A fin that meets the fuselage at a hard line looks glued on. Real ones run
 * forward into a fillet that blends the join over several metres — a wedge,
 * thick at the bottom where it meets the crown and vanishing at the top.
 */
function dorsalFillet(): THREE.BufferGeometry {
  const z0 = 21.4;
  const z1 = 26.8;
  const halfWidth = 0.22;
  const steps = 18;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = THREE.MathUtils.lerp(z0, z1, t);
    // Sits on the crown, and climbs into the fin root as it goes aft.
    const base = riseAt(z) + radiusAt(z) * 0.98;
    const top = base + Math.pow(t, 2.1) * 1.55;
    const w = halfWidth * (1 - Math.pow(t, 1.6)) + 0.02;
    pos.push(-w, base, z, w, base, z, 0, top, z);
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    // Two flanks and an underside, so it is a solid wedge from every angle.
    idx.push(a, b, a + 2, b, b + 2, a + 2);
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface EngineMaterials {
  cowl: THREE.Material;
  intake: THREE.Material;
  fan: THREE.Material;
  spinner: THREE.Material;
  nozzle: THREE.Material;
  pylon: THREE.Material;
}

/** A swept, tapered pylon rather than a rectangular block under the wing. */
function pylonGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.10, 1.75);
  shape.lineTo(0.95, 1.52);
  shape.lineTo(1.55, 0.45);
  shape.lineTo(0.42, 0.22);
  shape.lineTo(-0.78, 0.52);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.38,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    curveSegments: 3,
  });
  // Shape x is longitudinal z; extrude depth becomes the narrow spanwise x.
  g.rotateY(-Math.PI / 2);
  g.translate(0.19, 0, 0);
  return g;
}

/** One engine: rolled intake, fan, spinner, cowling and a shaped pylon. */
function engine(
  mirror: number,
  mat: EngineMaterials,
  track: <T extends { dispose(): void }>(x: T) => T,
  fans: THREE.Group[],
): THREE.Group {
  const g = new THREE.Group();
  // Cylinder y becomes the aircraft's z. RadiusBottom is therefore the
  // forward (negative-z) intake, which must be the larger end.
  const nacelle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.90, 1.07, 3.9, 48, 4, true)), mat.cowl);
  nacelle.rotation.x = Math.PI / 2;
  nacelle.castShadow = nacelle.receiveShadow = true;
  g.add(nacelle);

  // The intake is a real face-on assembly. The original torus and spinner
  // were left in their default vertical orientation, making the engine read
  // as a collection of unrelated primitives at any three-quarter angle.
  const lip = new THREE.Mesh(track(new THREE.TorusGeometry(1.02, 0.09, 12, 48)), mat.cowl);
  lip.position.z = -1.95;
  lip.castShadow = lip.receiveShadow = true;
  g.add(lip);

  const duct = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.74, 0.94, 0.86, 40, 2, true)),
    mat.intake,
  );
  duct.rotation.x = Math.PI / 2;
  duct.position.z = -1.53;
  g.add(duct);

  const fan = new THREE.Group();
  fan.position.z = -1.78;
  fans.push(fan);
  const fanDisc = new THREE.Mesh(track(new THREE.CircleGeometry(0.92, 48)), mat.intake);
  fanDisc.rotation.y = Math.PI;
  fan.add(fanDisc);
  const bladeGeo = track(new THREE.PlaneGeometry(0.105, 0.66));
  for (let i = 0; i < 18; i++) {
    const blade = new THREE.Mesh(bladeGeo, mat.fan);
    const a = (i / 18) * Math.PI * 2;
    blade.position.set(Math.sin(a) * 0.46, Math.cos(a) * 0.46, -0.008);
    blade.rotation.z = -a + 0.22;
    fan.add(blade);
  }
  g.add(fan);

  const spinner = new THREE.Mesh(track(new THREE.ConeGeometry(0.31, 0.62, 28)), mat.spinner);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -1.49;
  spinner.castShadow = spinner.receiveShadow = true;
  g.add(spinner);

  const nozzle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.52, 0.63, 0.96, 32, 2, true)), mat.nozzle);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 2.2;
  nozzle.castShadow = nozzle.receiveShadow = true;
  g.add(nozzle);

  /* The exhaust plug. A turbofan's hot nozzle is an annulus with a cone
     filling the middle of it, not an open pipe — and since the aeroplane is
     seen from behind more often than from anywhere else, an open pipe is
     the error most on screen. */
  const plug = new THREE.Mesh(track(new THREE.ConeGeometry(0.34, 1.1, 28)), mat.spinner);
  plug.rotation.x = Math.PI / 2;
  plug.position.z = 2.75;
  plug.castShadow = true;
  g.add(plug);

  const pylon = new THREE.Mesh(track(pylonGeometry()), mat.pylon);
  pylon.position.set(0, 0.05, 0.35);
  pylon.castShadow = pylon.receiveShadow = true;
  g.add(pylon);

  // Hung from the wing, so it moves with it rather than being left behind.
  g.position.set(6.6 * mirror, -2.25, WING.rootZ + WING.engineZ);
  return g;
}

/** Navy livery ribbons that follow the barrel rather than cutting through it. */
function liveryRibbon(side: number): THREE.BufferGeometry {
  const sections = 44;
  const pos: number[] = [];
  const idx: number[] = [];
  const point = (z: number, localY: number) => {
    const r = radiusAt(z);
    const x = side * Math.sqrt(Math.max(0.001, r * r - localY * localY)) * 1.003;
    return [x, riseAt(z) + localY, z] as const;
  };
  for (let i = 0; i <= sections; i++) {
    const z = THREE.MathUtils.lerp(-2.3, 24.1, i / sections);
    pos.push(...point(z, 0.26), ...point(z, -0.04));
  }
  for (let i = 0; i < sections; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    if (side > 0) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ── Livery ───────────────────────────────────────────────────────────────
   An aeroplane with no mark on its fin is a model kit somebody forgot to
   decal. The fin is the single most valuable surface an airline owns, and it
   is the one the exterior camera is parked to see, so the mark goes on it —
   both sides, facing forward on each, as it would be applied.

   Both decals are drawn to a canvas rather than modelled, which is the only
   way type stays type at every zoom, and both wait on the web fonts: a
   texture baked before Archivo arrives would keep a fallback face for the
   life of the page. */

/** Repaint once the display face has actually arrived. */
function whenFontsReady(redraw: () => void, tex: THREE.CanvasTexture) {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.ready) return;
  void fonts.ready.then(() => {
    redraw();
    tex.needsUpdate = true;
  });
}

/** The mark, on transparent, for the fin. */
function finMarkTexture(fill: string): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const k = size / 1536;
  g.scale(k, k);
  g.fillStyle = fill;
  g.fill(new Path2D(MARK_PATH), 'evenodd');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** `SEAT AIRLINES`, on transparent, for the forward fuselage. */
function titleTexture(fill: string): THREE.CanvasTexture {
  const w = 1024, h = 192;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const draw = () => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = fill;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    // Titles are letterspaced on every aircraft that carries them; canvas has
    // no tracking, so the string is set a glyph at a time.
    const text = 'SEAT AIRLINES';
    const track = 7;

    /* Fit the name to the canvas rather than trusting it to fit.
       The texture is stretched onto a decal of fixed proportions, so the
       canvas cannot simply grow with a longer name — it has to be the type
       that gives way. Measured at the nominal size and scaled down only if
       it would run off the end, which leaves a short name untouched. */
    const nominal = 128;
    const measure = (size: number) => {
      g.font = `800 ${size}px Montserrat, "Helvetica Neue", Arial, sans-serif`;
      let total = 0;
      for (const ch of text) total += g.measureText(ch).width + track;
      return total;
    };
    const usable = w * 0.94;
    const full = measure(nominal);
    const size = full > usable ? Math.floor(nominal * (usable / full)) : nominal;
    const width = measure(size);

    let x = (w - width) / 2;
    for (const ch of text) {
      g.fillText(ch, x, h / 2 + 4);
      x += g.measureText(ch).width + track;
    }
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  whenFontsReady(draw, tex);
  return tex;
}

/**
 * A decal that lies on the barrel rather than through it.
 *
 * Same construction as the cheatline — every vertex put on the body of
 * revolution at its own station — but carrying UVs, so artwork stretched over
 * it curves with the fuselage instead of floating off it at the shoulders.
 */
function barrelDecal(side: number, z0: number, z1: number, yTop: number, yBot: number): THREE.BufferGeometry {
  const cols = 40, rows = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const z = THREE.MathUtils.lerp(z0, z1, u);
    const r = radiusAt(z);
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const localY = THREE.MathUtils.lerp(yTop, yBot, v);
      const x = side * Math.sqrt(Math.max(0.0001, r * r - localY * localY)) * 1.0025;
      pos.push(x, riseAt(z) + localY, z);
      /* u runs aft with z, and the nose is at −z, so the texture's left edge
         has to land at the *low* z end. On the port side the surface is seen
         from the other hand and the mapping flips again, which is what makes
         titles read nose-forward on both sides rather than mirrored on one. */
      uv.push(side > 0 ? 1 - u : u, 1 - v);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Crisp door seams make the smooth fuselage feel manufactured, not toy-like. */
function doorFrame(side: number, z: number): THREE.BufferGeometry {
  const top = 0.77;
  const bottom = -0.61;
  const halfWidth = 0.34;
  const xAt = (y: number) => side * Math.sqrt(R * R - y * y) * 1.005;
  const corners: [number, number, number][] = [
    [xAt(top), top, z - halfWidth], [xAt(top), top, z + halfWidth],
    [xAt(top), top, z + halfWidth], [xAt(bottom), bottom, z + halfWidth],
    [xAt(bottom), bottom, z + halfWidth], [xAt(bottom), bottom, z - halfWidth],
    [xAt(bottom), bottom, z - halfWidth], [xAt(top), top, z - halfWidth],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  return g;
}

/** A softly rounded cabin window, extruded out of the skin. */
function windowGeometry(): THREE.ExtrudeGeometry {
  const halfZ = 0.115;
  const halfY = 0.155;
  const r = 0.045;
  const shape = new THREE.Shape();
  shape.moveTo(-halfZ + r, -halfY);
  shape.lineTo(halfZ - r, -halfY);
  shape.quadraticCurveTo(halfZ, -halfY, halfZ, -halfY + r);
  shape.lineTo(halfZ, halfY - r);
  shape.quadraticCurveTo(halfZ, halfY, halfZ - r, halfY);
  shape.lineTo(-halfZ + r, halfY);
  shape.quadraticCurveTo(-halfZ, halfY, -halfZ, halfY - r);
  shape.lineTo(-halfZ, -halfY + r);
  shape.quadraticCurveTo(-halfZ, -halfY, -halfZ + r, -halfY);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.052,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.008,
    bevelThickness: 0.008,
    curveSegments: 6,
  });
}

/** What the scene tells the aeroplane, each frame. */
export interface AirframeFrame {
  /** Contrail strength: 0 where the air is too warm to hold one, 1 in the cold above the deck. */
  contrail: number;
  /** How fast the air goes past, m/s. The contrails stream at it. */
  stream: number;
  /** The bank being flown, degrees. The control surfaces fly it. */
  bank: number;
  /** 0 by day to 1 after dark. The lights come up with it. */
  night: number;
  /** How far up the cabin lights are: what the windows show. */
  cabin: number;
  /** How far the cabin has gone over to its night blue. */
  mood: number;
  /** The visitor asked for less motion: the flashers breathe instead. */
  calm: boolean;
}

export interface AirframeHandles {
  group: THREE.Group;
  /** Light the windows of the rows somebody has actually booked. */
  setRowsLit(isLit: (row: number) => boolean): void;
  /** Smoothly deploy the trailing-edge flaps from 0 (retracted) to 1. */
  setFlapDeployment(target: number): void;
  /**
   * Advance the parts of the aeroplane that live: the fans turn, the
   * strobes and beacons flash, the contrails stream, and the control
   * surfaces fly the bank.
   */
  update(dt: number, frame: AirframeFrame): void;
  /**
   * Put its lights where `camera` sees them. Call once the aeroplane and
   * the camera are posed for the frame, just before it is drawn.
   */
  place(camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * A contrail's cross-tile: repeating lobes of vapour with the fade to clear
 * air baked across the narrow axis. The fade *along* the trail cannot live
 * in the texture — it scrolls, that is the point — so it is stepped by the
 * segments that wear it.
 */
function contrailTexture(): THREE.CanvasTexture {
  const w = 256, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  let seed = 0xb5c0fbcf;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 42; i++) {
    const x = rand() * w;
    const y = h / 2 + (rand() - 0.5) * h * 0.34;
    const r = 7 + rand() * 15;
    for (const dx of [0, -w, w]) {
      const grd = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grd.addColorStop(0, `rgba(255,255,255,${0.16 + rand() * 0.2})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAirframe(): AirframeHandles {
  const group = new THREE.Group();
  const dispose: (() => void)[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (dispose.push(() => x.dispose()), x);
  const flapGroups: THREE.Group[] = [];
  const fans: THREE.Group[] = [];

  /* A control surface: its own solid, in a group sitting on its hinge line
     and turned about it. */
  interface Hinge { group: THREE.Group; axis: THREE.Vector3 }
  const hinged = (
    p: Panel, t0: number, t1: number, f: number, symmetric: boolean,
    material: THREE.Material, parent: THREE.Object3D,
  ): Hinge => {
    const { pivot, axis } = hingeLine(p, t0, t1, f, symmetric);
    const geo = track(panelSection(p, t0, t1, f, 1, symmetric));
    geo.translate(-pivot.x, -pivot.y, -pivot.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = mesh.receiveShadow = true;
    const hinge = new THREE.Group();
    hinge.position.copy(pivot);
    hinge.add(mesh);
    parent.add(hinge);
    return { group: hinge, axis };
  };
  const ailerons: Hinge[] = [];
  const elevators: { hinge: Hinge; side: number }[] = [];
  let flapDeployment = 0;

  // Airline white is barely off-white and only gently glossy. A restrained
  // clearcoat gives the barrel a moving specular highlight without turning it
  // into chrome when the sun falls low.
  const skin = track(new THREE.MeshPhysicalMaterial({
    color: 0xfbfcfe, roughness: 0.34, metalness: 0.02, clearcoat: 0.2, clearcoatRoughness: 0.42,
  }));
  const navy = track(new THREE.MeshPhysicalMaterial({
    color: 0x11386f, roughness: 0.31, metalness: 0.08, clearcoat: 0.16, clearcoatRoughness: 0.38,
  }));
  const wingMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xeef2f7, roughness: 0.3, metalness: 0.1, clearcoat: 0.1, clearcoatRoughness: 0.45,
  }));
  const flapMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xd8e0eb, roughness: 0.26, metalness: 0.16, clearcoat: 0.16, clearcoatRoughness: 0.34,
  }));
  const intake = track(new THREE.MeshStandardMaterial({ color: 0x080d16, roughness: 0.82, metalness: 0.15, side: THREE.DoubleSide }));
  const fanMat = track(new THREE.MeshStandardMaterial({ color: 0x5b6676, roughness: 0.42, metalness: 0.72, side: THREE.DoubleSide }));
  const spinnerMat = track(new THREE.MeshStandardMaterial({ color: 0xd9dfe8, roughness: 0.22, metalness: 0.76 }));
  const nozzleMat = track(new THREE.MeshStandardMaterial({ color: 0x3c4553, roughness: 0.48, metalness: 0.7 }));
  const pylonMat = track(new THREE.MeshStandardMaterial({ color: 0xe0e7f0, roughness: 0.36, metalness: 0.1 }));
  const windshieldFrameMat = track(new THREE.MeshStandardMaterial({ color: 0x63728a, roughness: 0.32, metalness: 0.55 }));
  const seamMat = track(new THREE.LineBasicMaterial({ color: 0x536071, transparent: true, opacity: 0.7 }));

  const body = new THREE.Mesh(track(fuselageGeometry()), skin);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  /* Livery and the handful of seams visible at an exterior viewing distance. */
  for (const side of [1, -1]) {
    const ribbon = new THREE.Mesh(track(liveryRibbon(side)), navy);
    group.add(ribbon);
    for (const z of [-0.55, 10.9, 22.15]) {
      group.add(new THREE.LineSegments(track(doorFrame(side, z)), seamMat));
    }
  }

  /* The lights, gathered as each part that carries them is built. What they
     do is lamps.ts; where they are is here, because it is the airframe's
     geometry that says where a wingtip or a tail cone actually is. */
  const lampSpecs: LampSpec[] = [];

  /* Wings: 34 m span, swept 25°, with dihedral. */
  for (const side of [1, -1]) {
    /* One panel description, used by the wing and by everything that has to
       sit on it. Re-typing these numbers for the seams is how a hinge line
       ends up floating half a metre above the wing it belongs to. */
    const wingPanel: Panel = {
      originX: side * R * 0.6, originY: WING.rootY, span: side * WING.span, rise: WING.rise,
      rootZ: WING.rootZ, rootChord: WING.rootChord, rootThick: 0.86,
      tipZ: WING.tipZ, tipChord: WING.tipChord, tipThick: 0.16,
    };
    const wing = new THREE.Mesh(track(cutPanel(wingPanel, AILERON.t0, AILERON.t1, AILERON.hinge, false)), wingMat);
    wing.castShadow = wing.receiveShadow = true;
    group.add(wing);

    /* Flaps inboard, aileron outboard, and the spoiler run ahead of the
       flaps — the three things that move on a wing, and the three lines
       that stop it reading as a slab. */
    group.add(new THREE.LineSegments(
      track(controlSeams(wingPanel, 0.74, [[0.1, 0.42], [0.46, 0.66]])),
      seamMat,
    ));

    /* Two independently hinged trailing-edge panels. They are real meshes,
       rather than another seam, so deployment changes the silhouette and
       catches a separate highlight from the wing. */
    for (const [t0, t1] of [[0.1, 0.42], [0.46, 0.66]] as const) {
      const flap = new THREE.Group();
      const built = flapGeometry(wingPanel, t0, t1, 0.74, 0.98);
      flap.position.copy(built.pivot);
      const surface = new THREE.Mesh(track(built.geometry), flapMat);
      surface.castShadow = surface.receiveShadow = true;
      flap.add(surface);
      const actuator = new THREE.Mesh(track(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8)), pylonMat);
      actuator.rotation.x = Math.PI / 2;
      actuator.position.set(0, -0.16, 0.34);
      actuator.castShadow = true;
      flap.add(actuator);
      flapGroups.push(flap);
      group.add(flap);
    }

    // The aileron: a real surface now, cut out of the wing and hinged.
    ailerons.push(hinged(wingPanel, AILERON.t0, AILERON.t1, AILERON.hinge, false, flapMat, group));
    group.add(new THREE.LineSegments(track(hingeSeams(wingPanel, AILERON.t0, AILERON.t1, AILERON.hinge, false)), seamMat));

    // Winglet, raked up off the tip.
    const winglet = new THREE.Mesh(
      track(panelGeometry({
        originX: side * 16.2, originY: 0.5, span: side * 0.35, rise: 1.9,
        rootZ: WING.tipZ, rootChord: WING.tipChord, rootThick: 0.16,
        tipZ: WING.tipZ + WING.wingletRun, tipChord: 0.9, tipThick: 0.09,
      })),
      navy,
    );
    winglet.castShadow = winglet.receiveShadow = true;
    group.add(winglet);

    /* The wingtip's lights. The position lamp sits in the leading edge —
       red to port, green to starboard — and is seen from dead ahead round
       to 110° on its own side and no further, which is how anybody outside
       tells which way an aeroplane is pointing. The strobe is out on the
       tip itself, where it can be seen from everywhere. */
    const tipX = side * (R * 0.6 + WING.span);
    const tipY = WING.rootY + WING.rise;
    lampSpecs.push({
      kind: 'nav',
      at: new THREE.Vector3(tipX - side * 0.1, tipY + 0.03, WING.tipZ - 0.06),
      colour: side > 0 ? 0x2bff6a : 0xff2a1c,
      seen: { axis: new THREE.Vector3(side * 0.819, 0, -0.574), edge: 0.574 },
      bead: 0.1,
      lens: side > 0 ? 0x48f38b : 0xff4b45,
    });
    lampSpecs.push({
      kind: 'strobe',
      at: new THREE.Vector3(tipX + side * 0.05, tipY + 0.02, WING.tipZ + 0.4),
      colour: 0xf4f8ff,
      bead: 0.075,
      lens: 0xe6ecf4,
    });

    // Three flap-track fairings under each wing break the huge smooth slab
    // into credible manufactured surfaces without adding noisy panel lines.
    for (const t of [0.33, 0.53, 0.71]) {
      const fairing = new THREE.Mesh(track(new THREE.SphereGeometry(1, 16, 10)), pylonMat);
      const chord = THREE.MathUtils.lerp(WING.rootChord, WING.tipChord, t);
      fairing.position.set(
        side * (R * 0.6 + WING.span * t),
        WING.rootY + WING.rise * t - 0.17,
        THREE.MathUtils.lerp(WING.rootZ, WING.tipZ, t) + chord * 0.72,
      );
      fairing.scale.set(0.16, 0.11, 0.72 - t * 0.25);
      fairing.castShadow = fairing.receiveShadow = true;
      group.add(fairing);
    }

    // Tailplane
    const stabPanel: Panel = {
      originX: side * 0.5, originY: 0.9, span: side * 5.9, rise: 0.5,
      rootZ: 28.0, rootChord: 3.2, rootThick: 0.4,
      tipZ: 30.2, tipChord: 1.1, tipThick: 0.1,
    };
    const stab = new THREE.Mesh(track(cutPanel(stabPanel, 0.08, 0.94, 0.68, true)), wingMat);
    stab.castShadow = stab.receiveShadow = true;
    group.add(stab);
    // The elevator: one surface, most of the span.
    elevators.push({ hinge: hinged(stabPanel, 0.08, 0.94, 0.68, true, flapMat, group), side });
    group.add(new THREE.LineSegments(track(hingeSeams(stabPanel, 0.08, 0.94, 0.68, true)), seamMat));

    /* A logo light, set flush into the tailplane and aimed up at the fin,
       so the mark is lit from below after dark — the light pooling at its
       foot and fading toward the tip. */
    const logoLens = upperSurface(stabPanel, 0.25, 0.3, 0.02);
    lampSpecs.push({
      kind: 'logo',
      at: logoLens,
      colour: 0xfff1dc,
      seen: { axis: new THREE.Vector3(0, 1, 0), edge: -0.2 },
      beam: {
        axis: new THREE.Vector3(side * FIN_MARK_AT.x, FIN_MARK_AT.y, FIN_MARK_AT.z).sub(logoLens).normalize(),
        edge: 0.78,
      },
      bead: 0.05,
      lens: 0xf2f4f7,
    });

    group.add(engine(side, {
      cowl: skin,
      intake,
      fan: fanMat,
      spinner: spinnerMat,
      nozzle: nozzleMat,
      pylon: pylonMat,
    }, track, fans));
  }

  /* ── Contrails ──────────────────────────────────────────────────────────
     One per engine, streaming aft. The vapour texture repeats and scrolls —
     which is what makes the trail the loudest speed cue in the frame — and
     since a scrolling texture cannot also carry the fade to clear air along
     its own length, the fade is stepped: a bright near segment off the
     nozzle, a wide faint far one dissolving toward the horizon. */
  const nearTex = track(contrailTexture());
  const farTex = track(nearTex.clone());
  const CONTRAIL: { z0: number; z1: number; w: number; o: number; tex: THREE.Texture; tiles: number }[] = [
    { z0: 4.2, z1: 150, w: 1.5, o: 0.42, tex: nearTex, tiles: 4.5 },
    { z0: 150, z1: 470, w: 3.8, o: 0.15, tex: farTex, tiles: 4 },
  ];
  const contrailMats = CONTRAIL.map((seg) => {
    seg.tex.repeat.set(seg.tiles, 1);
    return track(new THREE.MeshBasicMaterial({
      map: seg.tex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
    }));
  });
  for (const side of [1, -1]) {
    for (const [i, seg] of CONTRAIL.entries()) {
      const len = seg.z1 - seg.z0;
      const geo = track(new THREE.PlaneGeometry(len, seg.w));
      // Laid flat and turned to run aft, in the geometry rather than the
      // mesh, so the mesh's own transform stays a plain position.
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI / 2);
      const trail = new THREE.Mesh(geo, contrailMats[i]);
      trail.position.set(6.6 * side, -2.3, WING.rootZ + WING.engineZ + seg.z0 + len / 2);
      trail.renderOrder = 2;
      group.add(trail);
    }
  }

  /* The control surfaces' state: the last bank seen, the roll rate read off
     it, and where each surface has got to. */
  let lastBank: number | null = null;
  let rollRate = 0;
  let aileronDeg = 0;
  let rudderDeg = 0;
  let elevatorDeg = 0;

  /* The fin: the same panel, stood on its edge so its span axis is height. */
  const finPanel: Panel = {
    originX: 0, originY: 0, span: 6.1, rise: 0,
    rootZ: 25.6, rootChord: 5.4, rootThick: 0.5,
    tipZ: 29.1, tipChord: 2.2, tipThick: 0.22,
  };
  const finFrame = new THREE.Group();
  finFrame.rotation.z = Math.PI / 2;
  finFrame.position.y = R * 0.72;
  group.add(finFrame);
  const fin = new THREE.Mesh(track(cutPanel(finPanel, 0.05, 0.95, 0.7, true)), navy);
  fin.castShadow = fin.receiveShadow = true;
  finFrame.add(fin);
  // The rudder, hung on the fin's own frame.
  const rudder = hinged(finPanel, 0.05, 0.95, 0.7, true, navy, finFrame);
  finFrame.add(new THREE.LineSegments(track(hingeSeams(finPanel, 0.05, 0.95, 0.7, true)), seamMat));

  /* The blister under the wing box, and the fillet that runs the fin into
     the crown. Both are silhouette rather than surface detail, which is why
     they do more for the aeroplane than any amount of panel lining. */
  const belly = new THREE.Mesh(track(bellyFairing()), skin);
  belly.castShadow = belly.receiveShadow = true;
  group.add(belly);

  const fillet = new THREE.Mesh(track(dorsalFillet()), skin);
  fillet.castShadow = fillet.receiveShadow = true;
  group.add(fillet);

  /* The APU exhaust, right at the tip of the tail cone. A tail that simply
     tapers to nothing is the one part of an airliner nobody draws, and the
     dark port at the end of it is the tell that somebody did. */
  const apu = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 20, 1, true)),
    nozzleMat,
  );
  apu.rotation.x = Math.PI / 2;
  apu.position.set(0, riseAt(TAIL_Z - 0.3), TAIL_Z - 0.05);
  group.add(apu);

  /* The mark on the fin, one decal per side, sitting just proud of the
     panel's own half-thickness at that height so it never punches through. */
  const finMarkTex = track(finMarkTexture('#F4F7FB'));
  const finMarkMat = track(new THREE.MeshStandardMaterial({
    map: finMarkTex, transparent: true, roughness: 0.34, metalness: 0.04,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  /* Kept forward of the rudder hinge, on the fixed fin: a mark straddling
     the hinge would tear in half every time the rudder moved. */
  const FIN_MARK = 2.5;
  for (const side of [1, -1]) {
    const decal = new THREE.Mesh(track(new THREE.PlaneGeometry(FIN_MARK, FIN_MARK)), finMarkMat);
    decal.position.set(side * FIN_MARK_AT.x, FIN_MARK_AT.y, FIN_MARK_AT.z);
    decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(decal);
  }

  /* Titles on the forward fuselage, above the window line, where an airline
     puts them and where the exterior camera looks straight at them. */
  const titleTex = track(titleTexture('#0E2E5E'));
  const titleMat = track(new THREE.MeshStandardMaterial({
    map: titleTex, transparent: true, roughness: 0.36, metalness: 0.03,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  for (const side of [1, -1]) {
    group.add(new THREE.Mesh(track(barrelDecal(side, 0.4, 9.6, 1.06, 0.42)), titleMat));
  }

  /* ── Windows ────────────────────────────────────────────────────────────
     One per row per side, punched at the same height and pitch the cabin
     uses, so a lit window really is a row somebody has booked. Instanced:
     sixty of them cost one draw call. */
  const WINDOW_Y = 0.139;
  const winGeo = track(windowGeometry());
  // Dark glass. The cabin's light comes through it as emission: lamps.ts.
  const winMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x1a2231, roughness: 0.12, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.16,
  }));
  const windows = new THREE.InstancedMesh(winGeo, winMat, CABIN.rows * 2);
  const dummy = new THREE.Object3D();
  const unlit = new THREE.Color(0x000000);
  const spots: WindowSpot[] = [];
  let n = 0;
  for (let row = 1; row <= CABIN.rows; row++) {
    for (const side of [1, -1] as const) {
      // On the skin, at the window line, lying along the tube.
      const a = Math.asin(WINDOW_Y / R) * side;
      // Extrusion points outward from the sidewall; the plane of the shape is
      // longitudinal/vertical, so this gives each aperture a proper rounded
      // bezel instead of a sharp black rectangle pasted onto the fuselage.
      dummy.position.set(Math.cos(a) * R * side * 1.004, WINDOW_Y, rowZ(row));
      dummy.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.updateMatrix();
      windows.setMatrixAt(n, dummy.matrix);
      windows.setColorAt(n, unlit);
      // The face of the glass, a bezel's depth proud of the skin.
      spots.push({ row, side, at: new THREE.Vector3(dummy.position.x + side * 0.07, WINDOW_Y, rowZ(row)), out: new THREE.Vector3(side, 0, 0) });
      n++;
    }
  }
  windows.instanceMatrix.needsUpdate = true;
  group.add(windows);

  /* Flight-deck glass.
     A sphere cap was the wrong solid for this: the nose is already tapering,
     so any cap big enough to read poked out through the skin as a black wedge.
     A band wrapped round the nose at its own local radius sits *on* the
     surface, which is what a windscreen does. */
  const glassZ = -4.7;
  // Dark, with the instruments' faint glow behind it after dark.
  const deckGlass = track(new THREE.MeshStandardMaterial({
    color: 0x0b1220, roughness: 0.07, metalness: 0.55, emissive: 0x1f3a44, emissiveIntensity: 0,
  }));
  const glass = new THREE.Mesh(
    track(new THREE.CylinderGeometry(
      radiusAt(glassZ) * 1.004, radiusAt(glassZ - 1.1) * 1.004, 1.5, 32, 1, true,
      // CylinderGeometry's radial z maps to -y after the rotation below.
      // This interval is centred on the crown of the nose, not its flank.
      Math.PI * 0.68, Math.PI * 0.64,
    )),
    deckGlass,
  );
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, 0.12, glassZ - 0.55);
  group.add(glass);

  // Three slim mullions make the windscreen read as individual panes rather
  // than a single dark band across the nose.
  const windscreenRadius = radiusAt(glassZ - 0.55) * 1.013;
  for (const theta of [Math.PI * 0.84, Math.PI, Math.PI * 1.16]) {
    const frame = new THREE.Mesh(track(new THREE.BoxGeometry(0.055, 0.045, 1.58)), windshieldFrameMat);
    frame.position.set(
      Math.sin(theta) * windscreenRadius,
      0.12 - Math.cos(theta) * windscreenRadius,
      glassZ - 0.55,
    );
    frame.rotation.z = theta + Math.PI;
    group.add(frame);
  }

  /* ── Lights ─────────────────────────────────────────────────────────────
     The wingtips and tailplane have hung theirs already. The tail cone
     carries a white position lamp shining aft and the third strobe; the
     red beacons sit on the crown over the wing box and under the belly
     fairing, and take turns.

     The lamps cast no shadows, so a lamp mounted on the skin is given the
     half of the world it can actually reach: a beacon on the crown lights
     the crown and not, through the fuselage, the wing root beneath it. */
  const tailZ = TAIL_Z - 0.3;
  lampSpecs.push(
    {
      kind: 'nav',
      at: new THREE.Vector3(0, riseAt(tailZ) + radiusAt(tailZ) + 0.03, tailZ),
      colour: 0xfff4e6,
      // Dead astern, seventy degrees either side.
      seen: { axis: new THREE.Vector3(0, 0, 1), edge: 0.34 },
      beam: { axis: new THREE.Vector3(0, 0.3, 1).normalize(), edge: -0.3 },
      bead: 0.07,
      lens: 0xf6f7fb,
    },
    {
      kind: 'strobe',
      at: new THREE.Vector3(0, riseAt(tailZ) - radiusAt(tailZ) - 0.03, tailZ),
      colour: 0xf4f8ff,
      beam: { axis: new THREE.Vector3(0, -0.5, 1).normalize(), edge: -0.4 },
      bead: 0.065,
      lens: 0xe6ecf4,
    },
    {
      kind: 'beacon',
      at: new THREE.Vector3(0, R + 0.04, 10.4),
      colour: 0xff1a0e,
      beam: { axis: new THREE.Vector3(0, 1, 0), edge: -0.55 },
      bead: 0.1,
      lens: 0xff4b45,
    },
    {
      kind: 'beacon',
      at: new THREE.Vector3(0, fairingBottom(12.4) - 0.04, 12.4),
      colour: 0xff1a0e,
      beam: { axis: new THREE.Vector3(0, -1, 0), edge: -0.55 },
      phase: BEACON_CYCLE / 2,
      bead: 0.1,
      lens: 0xff4b45,
    },
  );

  /* What can stand between the camera and a lamp: the fuselage and the
     belly fairing, tested as the shapes they are built from. The wings and
     the tail are thin enough to leave to the depth test. */
  const probe = new THREE.Vector3();
  const insideBody = (p: THREE.Vector3) => {
    if (p.z > NOSE_Z && p.z < TAIL_Z) {
      const r = radiusAt(p.z) * 0.96;
      const y = p.y - riseAt(p.z);
      if (p.x * p.x + y * y < r * r) return true;
    }
    const fx = p.x / FAIRING.rx;
    const fy = (p.y - FAIRING.y) / FAIRING.ry;
    const fz = (p.z - FAIRING.z) / FAIRING.rz;
    return fx * fx + fy * fy + fz * fz < 0.94;
  };
  const blocked = (from: THREE.Vector3, to: THREE.Vector3) => {
    // Stepped finer than the fuselage is wide, stopping short of the lamp.
    for (let k = 1; k < 48; k++) {
      if (insideBody(probe.lerpVectors(from, to, k / 48))) return true;
    }
    return false;
  };

  const windowRow = (side: 1 | -1) => ({
    from: new THREE.Vector3(side * (R + 0.05), WINDOW_Y, rowZ(1) - CABIN.pitch / 2),
    to: new THREE.Vector3(side * (R + 0.05), WINDOW_Y, rowZ(CABIN.rows) + CABIN.pitch / 2),
    out: new THREE.Vector3(side, 0, 0),
  });
  const lamps = createLampRig(lampSpecs, spots, [windowRow(1), windowRow(-1)], windows, blocked);
  group.add(lamps.group);
  /* Everything the lamps can fall on. Not the lenses, which are the lamps,
     and not the cabin windows, which are lit from the other side. */
  for (const material of [
    skin, navy, wingMat, flapMat, intake, fanMat, spinnerMat, nozzleMat, pylonMat,
    windshieldFrameMat, deckGlass, finMarkMat, titleMat,
  ]) lamps.light(material);

  const setRowsLit = (isLit: (row: number) => boolean) => lamps.setRowsLit(isLit);
  const update = (dt: number, { contrail, stream, bank, night, cabin, mood, calm }: AirframeFrame) => {
    /* The fans. Slow enough not to strobe against the frame rate, fast
       enough that the intake plainly holds a turning machine — and each
       engine a hair off its neighbour's speed, which is true of real pairs
       and is what keeps them from reading as mirrored copies. */
    for (const [i, fan] of fans.entries()) fan.rotation.z -= dt * (13 + i * 0.9);
    lamps.update(dt, { night, cabin, mood, calm });
    // Instruments, faintly, behind the flight-deck glass once it is dark.
    deckGlass.emissiveIntensity = 0.55 * night;
    /* The contrails stream aft at a fixed rate. Whether they exist at all is
       the air's decision, passed in from the scene: none in the warm air
       down low, solid ribbons in the cold above the deck. After dark there
       is no sun on them, and they go from white to a moonlit grey. */
    for (const [i, seg] of CONTRAIL.entries()) {
      contrailMats[i].opacity = seg.o * contrail;
      contrailMats[i].visible = contrail > 0.02;
      contrailMats[i].color.setScalar(THREE.MathUtils.lerp(1, 0.28, night));
      seg.tex.offset.x += (dt * stream) / ((seg.z1 - seg.z0) / seg.tiles);
    }
    /* The control surfaces, flown the way a pilot flies a turn: aileron
       while the bank is changing and neutral again once it is held, rudder
       into the turn, and a touch of up-elevator for the height a bank
       costs. Rate-driven ailerons are both the realistic choice and the
       legible one — they move exactly when the wings do. */
    if (dt > 0) {
      const raw = lastBank === null ? 0 : (bank - lastBank) / dt;
      lastBank = bank;
      rollRate += (raw - rollRate) * (1 - Math.exp(-6 * dt));
      const ease = 1 - Math.exp(-7 * dt);
      const clamp = THREE.MathUtils.clamp;
      // A little aileron is held into the turn as well — enough to read.
      aileronDeg += (clamp(rollRate * 2.4 + bank * 0.35, -20, 20) - aileronDeg) * ease;
      rudderDeg += (clamp(bank * 0.75, -14, 14) - rudderDeg) * ease;
      elevatorDeg += (clamp(Math.abs(bank) * 0.45, 0, 8) - elevatorDeg) * ease;
      const rad = THREE.MathUtils.degToRad;
      /* Each aileron's hinge axis points outboard, so one signed angle is
         trailing edge up on one wing and down on the other — which is
         exactly what a pair of ailerons does. */
      for (const aileron of ailerons) aileron.group.quaternion.setFromAxisAngle(aileron.axis, rad(-aileronDeg));
      for (const { hinge, side } of elevators) hinge.group.quaternion.setFromAxisAngle(hinge.axis, rad(-side * elevatorDeg));
      rudder.group.quaternion.setFromAxisAngle(rudder.axis, rad(rudderDeg));
    }
  };
  const setFlapDeployment = (target: number) => {
    flapDeployment = THREE.MathUtils.lerp(flapDeployment, THREE.MathUtils.clamp(target, 0, 1), 0.14);
    // Flaps are detail, not a second attitude indicator: keep their response
    // to a small trim-like movement rather than a full landing deployment.
    for (const flap of flapGroups) flap.rotation.x = -flapDeployment * 0.16;
  };
  setRowsLit(() => false);

  return {
    group,
    setRowsLit,
    setFlapDeployment,
    update,
    place: (camera) => lamps.place(camera, group),
    dispose: () => {
      lamps.dispose();
      dispose.forEach((d) => d());
      windows.dispose();
    },
  };
}
