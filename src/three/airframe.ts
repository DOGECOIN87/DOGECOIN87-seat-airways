import * as THREE from 'three';
import { CABIN, rowZ } from './cabin';
import { MARK_PATH } from '../components/Mark';

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
 * The wing, the winglet raked off its tip, the navigation lamp on that
 * winglet, the flap-track fairings under it and the engines hanging from it
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
  g.scale(R * 1.02, R * 0.74, WING.rootChord * 1.42);
  g.translate(0, -R * 0.66, WING.rootZ + WING.rootChord * 0.52);
  return g;
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
function engine(mirror: number, mat: EngineMaterials, track: <T extends { dispose(): void }>(x: T) => T): THREE.Group {
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

export interface AirframeHandles {
  group: THREE.Group;
  /** Light the windows of the rows somebody has actually booked. */
  setRowsLit(isLit: (row: number) => boolean): void;
  /** Smoothly deploy the trailing-edge flaps from 0 (retracted) to 1. */
  setFlapDeployment(target: number): void;
  dispose(): void;
}

export function createAirframe(): AirframeHandles {
  const group = new THREE.Group();
  const dispose: (() => void)[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (dispose.push(() => x.dispose()), x);
  const flapGroups: THREE.Group[] = [];
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
  const portLamp = track(new THREE.MeshStandardMaterial({ color: 0xff4b45, emissive: 0xff120d, emissiveIntensity: 2.7, roughness: 0.28 }));
  const starboardLamp = track(new THREE.MeshStandardMaterial({ color: 0x48f38b, emissive: 0x0ac54e, emissiveIntensity: 2.5, roughness: 0.28 }));
  const beaconLamp = track(new THREE.MeshStandardMaterial({ color: 0xff4b45, emissive: 0xff120d, emissiveIntensity: 3.1, roughness: 0.25 }));

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
    const wing = new THREE.Mesh(track(panelGeometry(wingPanel)), wingMat);
    wing.castShadow = wing.receiveShadow = true;
    group.add(wing);

    /* Flaps inboard, aileron outboard, and the spoiler run ahead of the
       flaps — the three things that move on a wing, and the three lines
       that stop it reading as a slab. */
    group.add(new THREE.LineSegments(
      track(controlSeams(wingPanel, 0.74, [[0.1, 0.42], [0.46, 0.66], [0.72, 0.95]])),
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

    // Navigation lamps sit at the actual winglet tips: starboard is green,
    // port is red. The tiny colour accents make the scale legible at dusk.
    const nav = new THREE.Mesh(track(new THREE.SphereGeometry(0.105, 16, 10)), side > 0 ? starboardLamp : portLamp);
    nav.position.set(side * 16.57, 2.42, WING.tipZ + WING.wingletRun + 0.02);
    group.add(nav);

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
    const stab = new THREE.Mesh(track(panelGeometry(stabPanel)), wingMat);
    stab.castShadow = stab.receiveShadow = true;
    group.add(stab);
    // The elevator: one surface, most of the span.
    group.add(new THREE.LineSegments(
      track(controlSeams(stabPanel, 0.68, [[0.08, 0.94]])),
      seamMat,
    ));

    group.add(engine(side, {
      cowl: skin,
      intake,
      fan: fanMat,
      spinner: spinnerMat,
      nozzle: nozzleMat,
      pylon: pylonMat,
    }, track));
  }

  /* The fin: the same panel, stood on its edge so its span axis is height. */
  const finPanel: Panel = {
    originX: 0, originY: 0, span: 6.1, rise: 0,
    rootZ: 25.6, rootChord: 5.4, rootThick: 0.5,
    tipZ: 29.1, tipChord: 2.2, tipThick: 0.22,
  };
  const fin = new THREE.Mesh(track(panelGeometry(finPanel)), navy);
  fin.rotation.z = Math.PI / 2;
  fin.position.y = R * 0.72;
  fin.castShadow = fin.receiveShadow = true;
  group.add(fin);

  // The rudder, hung on the same transform the fin is.
  const rudder = new THREE.LineSegments(
    track(controlSeams(finPanel, 0.7, [[0.05, 0.95]])),
    seamMat,
  );
  rudder.rotation.copy(fin.rotation);
  rudder.position.copy(fin.position);
  group.add(rudder);

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
  const FIN_MARK = 3.0;
  for (const side of [1, -1]) {
    const decal = new THREE.Mesh(track(new THREE.PlaneGeometry(FIN_MARK, FIN_MARK)), finMarkMat);
    // 42% up the fin, where the panel is still 0.38 m thick.
    decal.position.set(side * 0.2, R * 0.72 + 2.56, 28.95);
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

  const topBeacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 14, 10)), beaconLamp);
  topBeacon.position.set(0, R * 0.72 + 6.12, 29.85);
  group.add(topBeacon);
  const bellyBeacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.08, 14, 10)), beaconLamp);
  bellyBeacon.position.set(0, -R - 0.02, 13.7);
  group.add(bellyBeacon);

  /* ── Windows ────────────────────────────────────────────────────────────
     One per row per side, punched at the same height and pitch the cabin
     uses, so a lit window really is a row somebody has booked. Instanced:
     sixty of them cost one draw call. */
  const WINDOW_Y = 0.139;
  const winGeo = track(windowGeometry());
  const winMat = track(new THREE.MeshPhysicalMaterial({
    roughness: 0.12, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.16, vertexColors: true,
  }));
  const windows = new THREE.InstancedMesh(winGeo, winMat, CABIN.rows * 2);
  const dummy = new THREE.Object3D();
  const lit = new THREE.Color(0xffd79a);
  const dark = new THREE.Color(0x151b26);
  const seats: { row: number; i: number }[] = [];
  let n = 0;
  for (let row = 1; row <= CABIN.rows; row++) {
    for (const side of [1, -1]) {
      // On the skin, at the window line, lying along the tube.
      const a = Math.asin(WINDOW_Y / R) * side;
      // Extrusion points outward from the sidewall; the plane of the shape is
      // longitudinal/vertical, so this gives each aperture a proper rounded
      // bezel instead of a sharp black rectangle pasted onto the fuselage.
      dummy.position.set(Math.cos(a) * R * side * 1.004, WINDOW_Y, rowZ(row));
      dummy.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.updateMatrix();
      windows.setMatrixAt(n, dummy.matrix);
      windows.setColorAt(n, dark);
      seats.push({ row, i: n });
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
  const glass = new THREE.Mesh(
    track(new THREE.CylinderGeometry(
      radiusAt(glassZ) * 1.004, radiusAt(glassZ - 1.1) * 1.004, 1.5, 32, 1, true,
      // CylinderGeometry's radial z maps to -y after the rotation below.
      // This interval is centred on the crown of the nose, not its flank.
      Math.PI * 0.68, Math.PI * 0.64,
    )),
    track(new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.07, metalness: 0.55 })),
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

  const setRowsLit = (isLit: (row: number) => boolean) => {
    for (const s of seats) windows.setColorAt(s.i, isLit(s.row) ? lit : dark);
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
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
    dispose: () => {
      dispose.forEach((d) => d());
      windows.dispose();
    },
  };
}
