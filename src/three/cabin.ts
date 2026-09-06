import * as THREE from 'three';
import { MARK_NAVY, MARK_PATH } from '../components/Mark';

/**
 * The cabin, as geometry.
 *
 * The drawn cabin could only ever approximate what a seat sees, because the
 * perspective was hand-authored per view — which is why turning your head gave
 * you a different picture rather than a different angle on the same room. This
 * builds the room: a fuselage tube with windows punched through it, a dropped
 * ceiling and bins tucked into the shoulders, rows of seats at real pitch, and
 * passengers in the ones that are sold. The camera then simply sits where the
 * seat is, and looking around is looking around.
 *
 * Dimensions are a 737's, in metres. The numbers that matter, measured from
 * the cabin floor: 2.06 m to the crown of the ceiling, 1.09 m to the centre of
 * a window, 1.20 m to a seated eye, 0.79 m between rows. Getting the first of
 * those wrong is what made earlier passes read as a hangar — a bare fuselage
 * tube is 2.8 m tall inside, and the ceiling you actually sit under is a
 * separate shell most of a metre below it.
 */

export const CABIN = {
  /** Fuselage radius. The windows are punched in this, so it sets their height. */
  radius: 1.85,
  /** Floor height below the tube's axis. */
  floorY: -0.95,
  /** Distance between rows. */
  pitch: 0.79,
  rows: 30,
  /** Seat centres across the cabin: three, aisle, three. */
  seatX: [-1.32, -0.82, -0.32, 0.32, 0.82, 1.32],
  eyeHeight: 1.2,
  /** Crown of the dropped ceiling, in tube coordinates. */
  ceilingY: 1.12,
  /** Where the bins hang: bottom edge and top edge. */
  binBottomY: 0.4,
  binTopY: 0.95,
} as const;

export const cabinLength = CABIN.rows * CABIN.pitch + 6;
/** Aft end of the tube, so everything can share one centre. */
const MID = cabinLength / 2 - 3;

/** Where a row sits along the tube. Row 1 is forward; +z is aft. */
export const rowZ = (row: number) => (row - 1) * CABIN.pitch;

/** Window centre height, in tube coordinates — see wallTexture for the why. */
const WINDOW_Y = 0.139;

/* ────────────────────────────────────────────────────────────────────────
   Textures
   ──────────────────────────────────────────────────────────────────────── */

function ctx(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c.getContext('2d') as CanvasRenderingContext2D;
}

function finish(g: CanvasRenderingContext2D, rx: number, ry: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(rx, ry);
  return tex;
}

/**
 * The inner wall, with the windows punched out of it.
 *
 * One tile is one row, so the texture repeats down the fuselage and the
 * windows land between the seat rows the way they really do. The holes are
 * true alpha, so what shows through them is the world, not a painted sky.
 */
function wallTexture(): THREE.CanvasTexture {
  const w = 512, h = 512;
  const g = ctx(w, h);

  // u wraps around the tube, so the shading that makes it read as curved has
  // to run across the canvas, not down it. Sidewall panels are a warm grey.
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0.00, '#5d5a53');
  grd.addColorStop(0.22, '#b3ac9d');
  grd.addColorStop(0.30, '#cbc4b3');
  grd.addColorStop(0.50, '#cfc8b7');
  grd.addColorStop(0.70, '#cbc4b3');
  grd.addColorStop(0.78, '#b3ac9d');
  grd.addColorStop(1.00, '#5d5a53');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);

  // Woven speckle, so the panels are not flat plastic.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(x, y, 1, 1);
  }

  /* Panel seams. v runs along the cabin, so a seam at constant v is a ring
     around the tube — one per row, where the real ones are. */
  g.strokeStyle = 'rgba(52,49,44,0.5)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 1); g.lineTo(w, 1); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.beginPath(); g.moveTo(0, 4); g.lineTo(w, 4); g.stroke();

  /* A window is 0.23 m along the cabin and 0.34 m tall. On this tile that is
     ~29% of the length (v, the canvas's y) and ~3% of the circumference
     (u, the canvas's x) — which is the opposite way round to how it looks. */
  const WW = 15;    // around the tube: the window's height
  const WH = 148;   // along the cabin: the window's width
  const R = 7;

  const rrect = (x: number, y: number, ww: number, hh: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + ww, y, x + ww, y + hh, r);
    g.arcTo(x + ww, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + ww, y, r);
    g.closePath();
  };

  const window = (cx: number, side: 1 | -1) => {
    const x = cx - WW / 2, y = h / 2 - WH / 2;

    // The reveal: the wall thickens toward the aperture, so paint a soft
    // shadow outside it and a lit lip on the cabin side.
    g.save();
    g.filter = 'blur(6px)';
    g.fillStyle = 'rgba(38,35,31,0.55)';
    rrect(x - 9, y - 9, WW + 18, WH + 18, R + 8); g.fill();
    g.restore();

    g.fillStyle = '#d9d2c2';
    rrect(x - 4, y - 5, WW + 8, WH + 10, R + 4); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1.5;
    rrect(x - 4 + side * 1.5, y - 5, WW + 8, WH + 10, R + 4); g.stroke();

    // The sill under the window, and the shadow it throws.
    g.fillStyle = 'rgba(60,56,50,0.32)';
    g.fillRect(cx + side * (WW / 2 + 5), y - 4, side * 7, WH + 8);

    g.save();
    g.globalCompositeOperation = 'destination-out';
    rrect(x, y, WW, WH, R);
    g.fill();
    g.restore();
  };

  /* u runs around the circumference, so a quarter turn either side is level
     with the tube's axis — which is 0.35 m below a seated eye. Nudging both
     toward the crown puts the window where it really is: just under eye
     level, so you look slightly down and out rather than at your own knee. */
  window(w * 0.262, -1);
  window(w * 0.738, 1);

  /* One tile is one row: repeat and offset are set where the tube is built,
     because they depend on where the tube sits. */
  return finish(g, 1, 1);
}

/** Seat fabric: a flecked weave, the way airline cloth hides wear. */
function fabricTexture(): THREE.CanvasTexture {
  const s = 128;
  const g = ctx(s, s);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.05 + (y % 4 === 0 ? 0.05 : 0)})`;
    g.fillRect(0, y, s, 1);
  }
  for (let x = 0; x < s; x += 2) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(x, 0, 1, s);
  }
  for (let i = 0; i < 1400; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${v * 0.3})` : `rgba(0,0,0,${v * 0.3})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
  }
  return finish(g, 6, 6);
}

/**
 * The airline's mark, painted onto a panel.
 *
 * Same path data the page header uses, rasterised through Path2D so there is
 * one source for the logo rather than a traced copy that drifts out of step
 * with it. Generous margin around it, because the panels clamp their edge
 * pixels — the margin is what gets smeared, so it has to be the panel colour.
 */
function markTexture(ground: string, ink: string, margin = 0.26): THREE.CanvasTexture {
  const s = 512;
  const g = ctx(s, s);
  g.fillStyle = ground;
  g.fillRect(0, 0, s, s);
  const box = s * (1 - margin * 2);
  g.save();
  g.translate(s * margin, s * margin);
  g.scale(box / 1536, box / 1536);
  g.fillStyle = ink;
  g.fill(new Path2D(MARK_PATH), 'evenodd');
  g.restore();
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The mark, stitched.
 *
 * Airlines embroider the logo onto the headrest cover rather than printing
 * it, and the difference is entirely in how it catches the light: satin
 * stitch is a bank of parallel threads, so it has a direction, a sheen and a
 * raised edge that a flat print does not. This draws that — thread strokes
 * clipped to the mark, a needle line where the thread meets the cloth — and
 * returns a height map alongside it so the material can actually stand the
 * stitching proud of the weave.
 *
 * The mark is square, so the panel it goes on is drawn square too and the
 * cloth is what fills the rest. Fitting a square logo into a wide patch is
 * what cropped it before.
 */
function stitchedMark(w: number, h: number, cloth: string, thread: string) {
  const face = ctx(w, h);
  const bump = ctx(w, h);
  const gloss = ctx(w, h);

  // Cloth, with a weave fine enough to sit under the stitching.
  face.fillStyle = cloth;
  face.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) {
    face.fillStyle = 'rgba(0,0,0,0.055)';
    face.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 3) {
    face.fillStyle = 'rgba(255,255,255,0.05)';
    face.fillRect(x, 0, 1, h);
  }
  bump.fillStyle = '#3a3a3a';
  bump.fillRect(0, 0, w, h);
  // White is rough in a roughness map, so the cloth starts matte.
  gloss.fillStyle = '#f2f2f2';
  gloss.fillRect(0, 0, w, h);

  // The mark, centred, at four fifths of the panel's height.
  const box = h * 0.8;
  const place = (g: CanvasRenderingContext2D) => {
    g.translate((w - box) / 2, (h - box) / 2);
    g.scale(box / 1536, box / 1536);
  };

  const mark = new Path2D(MARK_PATH);

  // Face: thread colour, then the stitches themselves running across it.
  face.save();
  place(face);
  face.fillStyle = thread;
  face.fill(mark, 'evenodd');
  face.clip(mark, 'evenodd');
  /* Satin stitch: parallel threads laid at a slant. Each one gets a dark
     valley and a lit crown, which is the whole reason embroidery reads as
     embroidery rather than as ink. */
  for (let i = -1800; i < 3400; i += 12) {
    face.lineWidth = 7;
    face.strokeStyle = 'rgba(0,0,0,0.3)';
    face.beginPath(); face.moveTo(i, 0); face.lineTo(i + 620, 1536); face.stroke();
    face.lineWidth = 3.5;
    face.strokeStyle = 'rgba(255,255,255,0.3)';
    face.beginPath(); face.moveTo(i + 3.5, 0); face.lineTo(i + 623.5, 1536); face.stroke();
  }
  face.restore();

  // The needle line: cloth pulled tight where the thread enters it.
  face.save();
  place(face);
  face.strokeStyle = 'rgba(0,0,0,0.24)';
  face.lineWidth = 6;
  face.stroke(mark);
  face.restore();

  // Height: the stitching stands proud, with the individual threads on top
  // of the mass so the surface is corrugated rather than merely raised.
  bump.save();
  place(bump);
  bump.filter = 'blur(6px)';
  bump.fillStyle = '#d0d0d0';
  bump.fill(mark, 'evenodd');
  bump.filter = 'none';
  bump.clip(mark, 'evenodd');
  bump.lineWidth = 5;
  for (let i = -1800; i < 3400; i += 12) {
    bump.strokeStyle = '#ffffff';
    bump.beginPath(); bump.moveTo(i + 3, 0); bump.lineTo(i + 623, 1536); bump.stroke();
    bump.strokeStyle = '#909090';
    bump.beginPath(); bump.moveTo(i + 8, 0); bump.lineTo(i + 628, 1536); bump.stroke();
  }
  bump.restore();

  // Thread is smoother than the cloth it sits on, so it catches the cabin
  // lights while the weave stays flat.
  gloss.save();
  place(gloss);
  gloss.fillStyle = '#4a4a4a';
  gloss.fill(mark, 'evenodd');
  gloss.restore();

  const map = new THREE.CanvasTexture(face.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  const height = new THREE.CanvasTexture(bump.canvas);
  height.anisotropy = 16;
  const rough = new THREE.CanvasTexture(gloss.canvas);
  rough.anisotropy = 16;
  return { map, height, rough };
}

/** Carpet: dark, flecked, with the aisle worn a shade lighter. */
function carpetTexture(): THREE.CanvasTexture {
  const s = 256;
  const g = ctx(s, s);
  g.fillStyle = '#2f3138';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 12000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.72 ? `rgba(150,160,180,${v * 0.35})` : `rgba(0,0,0,${v * 0.4})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  return finish(g, 8, 60);
}

/* ────────────────────────────────────────────────────────────────────────
   Geometry helpers
   ──────────────────────────────────────────────────────────────────────── */

/** A box with its edges taken off. Nothing in a cabin has a sharp corner. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const b = Math.min(0.018, d / 3);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d - b * 2, bevelEnabled: true, bevelSize: b, bevelThickness: b,
    bevelSegments: 2, curveSegments: 5,
  });
  g.translate(0, 0, -d / 2 + b);
  return g;
}

/** A prism from a hand-drawn cross-section, running the length of the cabin. */
function profile(points: [number, number][], depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

interface Part { g: THREE.BufferGeometry; c: number }

/**
 * Merge parts into one geometry, keeping each part's colour on its vertices.
 *
 * An instanced mesh draws one material, so a seat that wants a pale headrest
 * cover on navy cloth has to carry that difference in the mesh rather than in
 * the material. Thirty rows of six seats then cost one draw call and still
 * have a tray table, a pocket and a cover on every one.
 */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [];
  const col = new THREE.Color();
  for (const { g, c } of parts) {
    const n = g.index ? g.toNonIndexed() : g;
    const p = n.attributes.position.array as ArrayLike<number>;
    const nm = n.attributes.normal.array as ArrayLike<number>;
    const u = n.attributes.uv.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) position.push(p[i]);
    for (let i = 0; i < nm.length; i++) normal.push(nm[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    col.setHex(c);
    for (let i = 0; i < p.length / 3; i++) color.push(col.r, col.g, col.b);
    if (n !== g) n.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  return out;
}

const CLOTH = 0x36445c;
const CLOTH_DARK = 0x27324a;
const COVER = 0xc9cfd8;
const TRIM = 0x6d7482;

/**
 * One seat, seen from behind by whoever is in the row aft of it — which is
 * the view that matters, since that is what a passenger looks at for four
 * hours. So the back gets the tray table, the pocket and the cover.
 */
function seatGeometry(): THREE.BufferGeometry {
  const p: Part[] = [];

  // Cushion, tipped very slightly back into the pan.
  const pan = roundedBox(0.46, 0.13, 0.5, 0.05);
  pan.rotateX(-0.05); pan.translate(0, 0.46, -0.02);
  p.push({ g: pan, c: CLOTH });

  // Back, raked seven degrees, topping out just below a seated eye.
  const back = roundedBox(0.45, 0.56, 0.13, 0.05);
  back.rotateX(0.12); back.translate(0, 0.76, 0.21);
  p.push({ g: back, c: CLOTH });

  // The bolsters either side of it, which is what gives an airline seat its
  // shape from behind rather than reading as a slab.
  for (const x of [-0.2, 0.2]) {
    const b = roundedBox(0.07, 0.5, 0.19, 0.035);
    b.rotateX(0.12); b.translate(x, 0.78, 0.19);
    p.push({ g: b, c: CLOTH_DARK });
  }

  // Headrest, and the paper cover on it.
  const head = roundedBox(0.34, 0.2, 0.12, 0.05);
  head.rotateX(0.12); head.translate(0, 1.06, 0.16);
  p.push({ g: head, c: CLOTH_DARK });
  const cover = roundedBox(0.3, 0.13, 0.135, 0.03);
  cover.rotateX(0.12); cover.translate(0, 1.09, 0.157);
  p.push({ g: cover, c: COVER });

  // Tray table, stowed: a lighter panel let into the back.
  const tray = roundedBox(0.35, 0.26, 0.02, 0.02);
  tray.rotateX(0.12); tray.translate(0, 0.83, 0.278);
  p.push({ g: tray, c: TRIM });
  const latch = new THREE.BoxGeometry(0.05, 0.016, 0.02);
  latch.rotateX(0.12); latch.translate(0, 0.955, 0.283);
  p.push({ g: latch, c: 0x2b2f36 });

  // Literature pocket below it, its mouth open toward you.
  const pocket = roundedBox(0.37, 0.19, 0.035, 0.02);
  pocket.rotateX(0.12); pocket.translate(0, 0.62, 0.288);
  p.push({ g: pocket, c: CLOTH_DARK });

  // Armrests.
  for (const x of [-0.255, 0.255]) {
    const arm = roundedBox(0.07, 0.055, 0.46, 0.025);
    arm.translate(x, 0.62, -0.04);
    p.push({ g: arm, c: TRIM });
  }

  // Legs, so the seat stands on the floor instead of floating over it.
  for (const x of [-0.2, 0.2]) {
    const leg = new THREE.BoxGeometry(0.05, 0.4, 0.06);
    leg.translate(x, 0.2, 0.08);
    p.push({ g: leg, c: 0x4a4f58 });
  }

  return mergeParts(p);
}

export interface CabinHandles {
  group: THREE.Group;
  /** Repaint the passengers when occupancy changes. */
  setOccupancy: (taken: ReadonlySet<string>) => void;
  /** Leave the viewer's own seat empty — they are in it. */
  setViewer: (id: string) => void;
  dispose: () => void;
}

const SKIN = [0xc99a72, 0x8d5f3f, 0xe3b894, 0x6b4529, 0xa8724c, 0xd9a87e, 0x5a3a22];
const HAIR = [0x2b2118, 0x4a3524, 0x0f0c0a, 0x6b5238, 0x8a7a6a, 0x3a2418];
const CLOTHES = [0x2e3540, 0x6b2f2f, 0x2f4a3a, 0x40404a, 0x7a6a4a, 0x24303f, 0x53365a];

export function createCabin(): CabinHandles {
  const group = new THREE.Group();
  const kill: { dispose: () => void }[] = [];

  /* ── The tube ───────────────────────────────────────────────────────── */
  const wallTex = wallTexture();
  kill.push(wallTex);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(CABIN.radius, CABIN.radius, cabinLength, 96, 1, true),
    new THREE.MeshStandardMaterial({
      map: wallTex,
      side: THREE.BackSide,
      transparent: true,
      alphaTest: 0.45,
      roughness: 0.88,
      metalness: 0,
      // Cabins have bounce; without it the crown of the tube renders black.
      emissive: 0x2e2b26,
      emissiveIntensity: 0.16,
    }),
  );
  wall.rotation.x = Math.PI / 2;
  wall.position.z = MID;
  group.add(wall);

  /* Line the punched windows up with the seat rows.

     The tile has to be exactly one seat pitch, not a convenient fraction of
     the tube's length: tiling 38 times over 29.7 m gives 0.782 m tiles
     against a 0.79 m pitch, and the eight-millimetre error per row compounds
     until the holes are behind the wall panels and every window frame in the
     aft cabin is bolted to solid trim. Which is exactly what it did.

     v runs 0 to 1 from the forward end of the tube, and the hole sits at the
     middle of its tile, so the offset is whatever puts row 1's window at
     v = 0.5. */
  const zAtV0 = wall.position.z - cabinLength / 2;
  wallTex.repeat.set(1, cabinLength / CABIN.pitch);
  wallTex.offset.set(0, 0.5 - (((rowZ(1) - 0.06 - zAtV0) / CABIN.pitch) % 1));

  /* ── Floor ──────────────────────────────────────────────────────────── */
  const carpet = carpetTexture();
  kill.push(carpet);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, cabinLength),
    new THREE.MeshStandardMaterial({ map: carpet, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, CABIN.floorY, MID);
  group.add(floor);

  /* ── Ceiling ────────────────────────────────────────────────────────────
     Not the crown of the fuselage — a shell most of a metre below it, which
     is the difference between a cabin and a hangar. Emissive as well as lit,
     because an inward-facing surface with nothing above it to bounce off
     otherwise resolves to black however hard the lamps are driven. */
  const CEIL_R = 1.62;
  const CEIL_OFFSET = CABIN.ceilingY - CEIL_R;   // crown lands at ceilingY
  const half = Math.acos(-Math.sqrt(CEIL_R * CEIL_R - 0.8 * 0.8) / CEIL_R);
  const ceiling = new THREE.Mesh(
    new THREE.CylinderGeometry(CEIL_R, CEIL_R, cabinLength, 48, 1, true, half, 2 * (Math.PI - half)),
    new THREE.MeshStandardMaterial({
      color: 0xece7dc, side: THREE.BackSide, roughness: 0.95, metalness: 0,
      emissive: 0xd6cfbe, emissiveIntensity: 0.16,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, CEIL_OFFSET, MID);
  group.add(ceiling);

  /* ── Overhead bins ──────────────────────────────────────────────────────
     A wedge, not a box: the fuselage curves in above the window line, and the
     bin fills that shoulder. Drawn as a cross-section run the length of the
     cabin, with a seam at every row so it does not read as one plastic tube. */
  /* Boxes rather than an extruded cross-section. An extrusion is the tidier
     description of the shape, but ExtrudeGeometry decides the winding of the
     result itself, and the face that matters here — the underside a seated
     passenger spends the flight looking at — came out with its normal inside
     the solid and could not be lit by anything in the cabin. A box's normals
     are not up for negotiation. */
  const BIN_SLOPE = 0.13;
  const binMat = new THREE.MeshStandardMaterial({
    color: 0xd7d1c3, roughness: 0.68, metalness: 0.02,
    emissive: 0x5a564c, emissiveIntensity: 0.16,
  });
  for (const s of [1, -1]) {
    // The underside, tilted so it climbs toward the fuselage.
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, cabinLength), binMat);
    under.position.set(s * 1.31, CABIN.binBottomY + 0.13, MID);
    under.rotation.z = s * BIN_SLOPE;
    group.add(under);

    // The fascia facing into the cabin.
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, cabinLength), binMat);
    face.position.set(s * 0.845, CABIN.binBottomY + 0.35, MID);
    group.add(face);

    // The body, filling the shoulder up to the wall. Only its lower outboard
    // corner is ever in shot, so it is a plain block.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.46, cabinLength), binMat);
    body.position.set(s * 1.29, CABIN.binTopY - 0.14, MID);
    body.rotation.z = s * BIN_SLOPE;
    group.add(body);
  }

  /* The passenger service unit: one panel per row on the underside of each
     bin, tilted onto its slope, carrying the reading lights that give the
     shoulder of the cabin its rhythm. */
  const SLOPE = BIN_SLOPE;
  const psuGeo = new THREE.BoxGeometry(0.42, 0.014, 0.56);
  const psus = new THREE.InstancedMesh(
    psuGeo,
    new THREE.MeshStandardMaterial({ color: 0xbdb6a6, roughness: 0.6 }),
    (CABIN.rows + 8) * 2,
  );
  const lensGeo = new THREE.BoxGeometry(0.052, 0.012, 0.052);
  const lenses = new THREE.InstancedMesh(
    lensGeo,
    new THREE.MeshBasicMaterial({ color: 0xfff0d2 }),
    (CABIN.rows + 8) * 4,
  );
  const dummy = new THREE.Object3D();
  let k = 0, l = 0;
  for (let r = -3; r < CABIN.rows + 5; r++) {
    for (const s of [1, -1]) {
      const z = rowZ(r) - CABIN.pitch / 2;
      const y = CABIN.binBottomY + 0.1;
      dummy.rotation.set(0, 0, s * SLOPE);
      dummy.position.set(s * 1.24, y, z);
      dummy.updateMatrix(); psus.setMatrixAt(k++, dummy.matrix);
      for (const d of [-0.13, 0.13]) {
        dummy.position.set(s * 1.24, y - 0.012, z + d);
        dummy.updateMatrix(); lenses.setMatrixAt(l++, dummy.matrix);
      }
    }
  }
  psus.count = k; lenses.count = l;
  group.add(psus); group.add(lenses);

  /* ── Window reveals ─────────────────────────────────────────────────────
     The hole in the wall texture is what you see through; this is the frame
     around it, so the wall has thickness where a real one does. */
  const frameShape = new THREE.Shape();
  const fw = 0.288, fh = 0.412, fr = 0.082;
  frameShape.moveTo(-fw / 2 + fr, -fh / 2);
  frameShape.lineTo(fw / 2 - fr, -fh / 2);
  frameShape.quadraticCurveTo(fw / 2, -fh / 2, fw / 2, -fh / 2 + fr);
  frameShape.lineTo(fw / 2, fh / 2 - fr);
  frameShape.quadraticCurveTo(fw / 2, fh / 2, fw / 2 - fr, fh / 2);
  frameShape.lineTo(-fw / 2 + fr, fh / 2);
  frameShape.quadraticCurveTo(-fw / 2, fh / 2, -fw / 2, fh / 2 - fr);
  frameShape.lineTo(-fw / 2, -fh / 2 + fr);
  frameShape.quadraticCurveTo(-fw / 2, -fh / 2, -fw / 2 + fr, -fh / 2);
  const hole = new THREE.Path();
  const hw = 0.245, hh = 0.375, hr = 0.075;
  hole.moveTo(-hw / 2 + hr, -hh / 2);
  hole.lineTo(hw / 2 - hr, -hh / 2);
  hole.quadraticCurveTo(hw / 2, -hh / 2, hw / 2, -hh / 2 + hr);
  hole.lineTo(hw / 2, hh / 2 - hr);
  hole.quadraticCurveTo(hw / 2, hh / 2, hw / 2 - hr, hh / 2);
  hole.lineTo(-hw / 2 + hr, hh / 2);
  hole.quadraticCurveTo(-hw / 2, hh / 2, -hw / 2, hh / 2 - hr);
  hole.lineTo(-hw / 2, -hh / 2 + hr);
  hole.quadraticCurveTo(-hw / 2, -hh / 2, -hw / 2 + hr, -hh / 2);
  frameShape.holes.push(hole);
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
    depth: 0.034, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2,
  });
  frameGeo.rotateY(Math.PI / 2);

  const wallX = Math.sqrt(CABIN.radius * CABIN.radius - WINDOW_Y * WINDOW_Y);
  const frames = new THREE.InstancedMesh(
    frameGeo,
    new THREE.MeshStandardMaterial({ color: 0xc8c1b2, roughness: 0.6, metalness: 0.04 }),
    (CABIN.rows + 8) * 2,
  );
  /* Half the shades are pulled part-way down, the way half of them always
     are — and the light that comes through the rest is that much better for
     having something to contrast against. */
  const shadeGeo = new THREE.BoxGeometry(0.012, 0.4, 0.25);
  const shades = new THREE.InstancedMesh(
    shadeGeo,
    new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.85, emissive: 0x8f8a78, emissiveIntensity: 0.55 }),
    (CABIN.rows + 8) * 2,
  );
  let f = 0;
  for (let r = -3; r < CABIN.rows + 5; r++) {
    for (const s of [1, -1]) {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(s * (wallX - 0.021), WINDOW_Y, rowZ(r) - 0.06);
      dummy.updateMatrix();
      frames.setMatrixAt(f++, dummy.matrix);
    }
  }
  frames.count = f;
  group.add(frames); group.add(shades);

  /* About four windows in ten have the shade part-way down, which is what a
     cabin in daylight actually looks like — and the light through the rest is
     that much better for having something to contrast against.

     The exception is the window the viewer is sitting at, and its neighbours
     either side. Turning your head to look out and finding your own shade
     closed is not realism, it is a bug with an explanation. */
  const placeShades = (skipRow: number | null, skipSide: 1 | -1 | null) => {
    let sh = 0;
    for (let r = -3; r < CABIN.rows + 5; r++) {
      for (const s of [1, -1] as const) {
        if (skipRow !== null && s === skipSide && Math.abs(r - skipRow) <= 1) continue;
        // Deterministic, so a seat's outlook does not change between frames.
        const drop = ((r * 37 + (s > 0 ? 11 : 5)) % 100) / 100;
        if (drop >= 0.42) continue;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(s * (wallX - 0.05), WINDOW_Y + 0.2 - drop * 0.62, rowZ(r) - 0.06);
        dummy.updateMatrix();
        shades.setMatrixAt(sh++, dummy.matrix);
      }
    }
    shades.count = sh;
    shades.instanceMatrix.needsUpdate = true;
  };
  placeShades(null, null);

  /* The sill: the ledge under the window line that a elbow rests on. */
  for (const s of [1, -1]) {
    const sill = new THREE.Mesh(
      profile([
        [wallX - 0.005, -0.09], [wallX - 0.14, -0.115],
        [wallX - 0.15, -0.16], [wallX - 0.005, -0.155],
      ], cabinLength),
      new THREE.MeshStandardMaterial({ color: 0xb8b1a1, roughness: 0.7, side: THREE.DoubleSide }),
    );
    sill.position.z = MID;
    sill.scale.x = s;
    group.add(sill);
  }

  /* ── Lighting ───────────────────────────────────────────────────────────
     Two washes along the ceiling join, plus lamps close enough together that
     the cabin brightens and dims as you look down it. three's lights are
     physical, so intensity is candela: a value in the tens lights nothing at
     cabin distances. */
  for (const x of [-0.83, 0.83]) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.035, cabinLength),
      new THREE.MeshBasicMaterial({ color: 0xffe9c8 }),
    );
    strip.position.set(x, CABIN.binTopY - 0.01, MID);
    strip.rotation.z = x > 0 ? -0.2 : 0.2;
    group.add(strip);
  }
  for (let z = -3; z < cabinLength - 2; z += 2.6) {
    const lamp = new THREE.PointLight(0xffd9a8, 13, 9, 2);
    lamp.position.set(0, CABIN.ceilingY - 0.22, z);
    group.add(lamp);
    // Under the bins, where nothing above can reach.
    for (const x of [-0.95, 0.95]) {
      const wash = new THREE.PointLight(0xffe6c4, 4.5, 4.2, 2);
      wash.position.set(x, CABIN.binBottomY - 0.06, z);
      group.add(wash);
    }
  }

  /* ── Bulkhead ───────────────────────────────────────────────────────────
     The divider that closes the front of the cabin, and the one wall in an
     aircraft anybody actually looks at for a whole flight. Its shape is the
     fuselage section cut off at the floor, so it meets the tube exactly. */
  const R = CABIN.radius - 0.02;
  const a0 = Math.atan2(CABIN.floorY, Math.sqrt(R * R - CABIN.floorY * CABIN.floorY));
  const bulkShape = new THREE.Shape();
  bulkShape.absarc(0, 0, R, a0, Math.PI - a0, false);
  bulkShape.closePath();
  const bulkGeo = new THREE.ExtrudeGeometry(bulkShape, {
    depth: 0.09, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2,
  });
  /* ExtrudeGeometry gives the face UVs in metres, so the mark is placed by
     scale and offset rather than by unwrapping anything: 1.15 m across,
     centred a little above the window line where the eye already is. */
  const markTex = markTexture('#e6e0d2', MARK_NAVY);
  kill.push(markTex);
  const MARK_W = 1.15;
  markTex.repeat.set(1 / MARK_W, 1 / MARK_W);
  markTex.offset.set(0.5, 0.5 - 0.3 / MARK_W);
  const bulkhead = new THREE.Mesh(
    bulkGeo,
    new THREE.MeshStandardMaterial({
      map: markTex, roughness: 0.85, metalness: 0,
      emissive: 0x3b3830, emissiveIntensity: 0.35,
    }),
  );
  bulkhead.position.z = rowZ(1) - 1.35;
  group.add(bulkhead);

  /* ── Seats ──────────────────────────────────────────────────────────── */
  const fabric = fabricTexture();
  kill.push(fabric);
  const seatGeo = seatGeometry();
  const seatCount = CABIN.rows * CABIN.seatX.length;
  const seats = new THREE.InstancedMesh(
    seatGeo,
    new THREE.MeshStandardMaterial({ map: fabric, vertexColors: true, roughness: 0.94, metalness: 0 }),
    seatCount,
  );
  let i = 0;
  for (let row = 1; row <= CABIN.rows; row++) {
    for (const x of CABIN.seatX) {
      dummy.position.set(x, CABIN.floorY, rowZ(row));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      seats.setMatrixAt(i++, dummy.matrix);
    }
  }
  seats.instanceMatrix.needsUpdate = true;
  group.add(seats);

  /* The mark again on every headrest cover, which is where an airline puts it
     and the only branding a passenger sees for the whole flight. */
  const stitched = stitchedMark(1536, 680, '#c6ccd6', MARK_NAVY);
  kill.push(stitched.map, stitched.height, stitched.rough);
  const coverGeo = new THREE.PlaneGeometry(0.27, 0.12);
  const covers = new THREE.InstancedMesh(
    coverGeo,
    new THREE.MeshStandardMaterial({
      map: stitched.map,
      bumpMap: stitched.height,
      bumpScale: 9,
      roughnessMap: stitched.rough,
      roughness: 1,
      metalness: 0.06,
    }),
    seatCount,
  );
  let ci = 0;
  for (let row = 1; row <= CABIN.rows; row++) {
    for (const x of CABIN.seatX) {
      dummy.position.set(x, CABIN.floorY + 1.087, rowZ(row) + 0.226);
      dummy.rotation.set(-0.12, 0, 0);
      dummy.updateMatrix();
      covers.setMatrixAt(ci++, dummy.matrix);
    }
  }
  covers.instanceMatrix.needsUpdate = true;
  group.add(covers);

  /* ── Passengers, in the seats that are sold ─────────────────────────────
     Heads clear the headrests, because a cabin you are sitting in is mostly
     the backs of other people's heads. */
  const headGeo = new THREE.SphereGeometry(0.097, 18, 14);
  headGeo.scale(1, 1.14, 1.02);
  const hairGeo = new THREE.SphereGeometry(0.104, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72);
  hairGeo.scale(1, 1.16, 1.04);
  const bodyGeo = new THREE.CapsuleGeometry(0.18, 0.22, 5, 14);
  const mk = (g: THREE.BufferGeometry, rough: number) =>
    new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: rough }), seatCount);
  const heads = mk(headGeo, 0.7);
  const hairs = mk(hairGeo, 0.92);
  const bodies = mk(bodyGeo, 0.95);
  heads.count = hairs.count = bodies.count = 0;
  group.add(heads); group.add(hairs); group.add(bodies);

  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const HEAD_Y = CABIN.floorY + 1.19;

  let sold: ReadonlySet<string> = new Set();
  /* The seat the camera is in. Its occupant is the viewer, and rendering a
     head 20 cm in front of the lens fills the frame with the back of it. */
  let viewer = '';

  const rebuild = () => {
    const taken = sold;
    let n = 0;
    const colour = new THREE.Color();
    for (let row = 1; row <= CABIN.rows; row++) {
      for (let s = 0; s < CABIN.seatX.length; s++) {
        const id = `${row}${letters[s]}`;
        if (id === viewer || !taken.has(id)) continue;
        const x = CABIN.seatX[s];
        const z = rowZ(row);
        const seed = row * 7 + s * 13;
        // A little slouch and lean, so the rows are not a rank of dummies.
        const lean = (((seed * 29) % 100) / 100 - 0.5) * 0.13;
        const slouch = (((seed * 17) % 100) / 100) * 0.05;

        dummy.rotation.set(0, lean * 2.2, lean);

        dummy.position.set(x + lean * 0.16, HEAD_Y - slouch, z - 0.04);
        dummy.updateMatrix();
        heads.setMatrixAt(n, dummy.matrix);
        colour.setHex(SKIN[seed % SKIN.length]);
        heads.setColorAt(n, colour);

        dummy.position.set(x + lean * 0.16, HEAD_Y - slouch + 0.012, z - 0.04);
        dummy.updateMatrix();
        hairs.setMatrixAt(n, dummy.matrix);
        colour.setHex(HAIR[seed % HAIR.length]);
        hairs.setColorAt(n, colour);

        dummy.rotation.set(0, lean * 1.4, lean * 0.6);
        dummy.position.set(x + lean * 0.1, CABIN.floorY + 0.9 - slouch, z - 0.02);
        dummy.updateMatrix();
        bodies.setMatrixAt(n, dummy.matrix);
        colour.setHex(CLOTHES[seed % CLOTHES.length]);
        bodies.setColorAt(n, colour);
        n++;
      }
    }
    heads.count = hairs.count = bodies.count = n;
    for (const m of [heads, hairs, bodies]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  const setOccupancy = (taken: ReadonlySet<string>) => { sold = taken; rebuild(); };
  const setViewer = (id: string) => {
    if (id === viewer) return;
    viewer = id;
    rebuild();
    // A, B, C sit to port; D, E, F to starboard.
    const row = Number(id.replace(/\D/g, '')) || null;
    const letter = id.replace(/\d/g, '').toUpperCase();
    const side = 'ABC'.includes(letter) ? -1 : 'DEF'.includes(letter) ? 1 : null;
    placeShades(row, side as 1 | -1 | null);
  };

  const dispose = () => {
    kill.forEach((x) => x.dispose());
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  };

  return { group, setOccupancy, setViewer, dispose };
}
