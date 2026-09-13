import * as THREE from 'three';
import { CABIN, rowZ } from './cabin';

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

  const pylon = new THREE.Mesh(track(pylonGeometry()), mat.pylon);
  pylon.position.set(0, 0.05, 0.35);
  pylon.castShadow = pylon.receiveShadow = true;
  g.add(pylon);

  g.position.set(6.6 * mirror, -2.25, 11.4);
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
  dispose(): void;
}

export function createAirframe(): AirframeHandles {
  const group = new THREE.Group();
  const dispose: (() => void)[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (dispose.push(() => x.dispose()), x);

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
    const wing = new THREE.Mesh(
      track(panelGeometry({
        originX: side * R * 0.6, originY: -1.15, span: side * 15.6, rise: 1.7,
        rootZ: 9.8, rootChord: 6.4, rootThick: 0.86,
        tipZ: 16.9, tipChord: 1.9, tipThick: 0.16,
      })),
      wingMat,
    );
    wing.castShadow = wing.receiveShadow = true;
    group.add(wing);

    // Winglet, raked up off the tip.
    const winglet = new THREE.Mesh(
      track(panelGeometry({
        originX: side * 16.2, originY: 0.5, span: side * 0.35, rise: 1.9,
        rootZ: 16.9, rootChord: 1.9, rootThick: 0.16,
        tipZ: 18.0, tipChord: 0.9, tipThick: 0.09,
      })),
      navy,
    );
    winglet.castShadow = winglet.receiveShadow = true;
    group.add(winglet);

    // Navigation lamps sit at the actual winglet tips: starboard is green,
    // port is red. The tiny colour accents make the scale legible at dusk.
    const nav = new THREE.Mesh(track(new THREE.SphereGeometry(0.105, 16, 10)), side > 0 ? starboardLamp : portLamp);
    nav.position.set(side * 16.57, 2.42, 18.02);
    group.add(nav);

    // Three flap-track fairings under each wing break the huge smooth slab
    // into credible manufactured surfaces without adding noisy panel lines.
    for (const t of [0.33, 0.53, 0.71]) {
      const fairing = new THREE.Mesh(track(new THREE.SphereGeometry(1, 16, 10)), pylonMat);
      const chord = THREE.MathUtils.lerp(6.4, 1.9, t);
      fairing.position.set(
        side * (R * 0.6 + 15.6 * t),
        -1.15 + 1.7 * t - 0.17,
        THREE.MathUtils.lerp(9.8, 16.9, t) + chord * 0.72,
      );
      fairing.scale.set(0.16, 0.11, 0.72 - t * 0.25);
      fairing.castShadow = fairing.receiveShadow = true;
      group.add(fairing);
    }

    // Tailplane
    const stab = new THREE.Mesh(
      track(panelGeometry({
        originX: side * 0.5, originY: 0.9, span: side * 5.9, rise: 0.5,
        rootZ: 27.2, rootChord: 3.2, rootThick: 0.4,
        tipZ: 29.4, tipChord: 1.1, tipThick: 0.1,
      })),
      wingMat,
    );
    stab.castShadow = stab.receiveShadow = true;
    group.add(stab);

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
  const fin = new THREE.Mesh(
    track(panelGeometry({
      originX: 0, originY: 0, span: 6.1, rise: 0,
      rootZ: 24.4, rootChord: 5.4, rootThick: 0.5,
      tipZ: 27.9, tipChord: 2.2, tipThick: 0.22,
    })),
    navy,
  );
  fin.rotation.z = Math.PI / 2;
  fin.position.y = R * 0.72;
  fin.castShadow = fin.receiveShadow = true;
  group.add(fin);

  const topBeacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 14, 10)), beaconLamp);
  topBeacon.position.set(0, R * 0.72 + 6.12, 28.65);
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
  setRowsLit(() => false);

  return {
    group,
    setRowsLit,
    dispose: () => {
      dispose.forEach((d) => d());
      windows.dispose();
    },
  };
}
