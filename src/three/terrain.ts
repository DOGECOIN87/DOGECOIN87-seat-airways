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
export interface GroundTextures {
  /** What the land looks like lit. */
  day: THREE.CanvasTexture;
  /** What of it is still visible once the sun has gone: an emissive map. */
  night: THREE.CanvasTexture;
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

  return { day: tex, night: nightTex };
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
 * The lunar surface.
 *
 * Craters with their light baked in, which is the one decision that makes or
 * breaks a lunar plain.
 *
 * The tempting alternative is a height map and a bump shader, so the scene's
 * own sun casts the shadows. It does not survive contact with the geometry:
 * the ground here is one plate seen almost edge on, so a texel near the
 * horizon covers a whole screen pixel's worth of ground and the derivative
 * the bump shader differentiates swings from one pixel to the next. What
 * comes out is not relief, it is static — the surface rendered as charcoal
 * noise from every altitude worth being at.
 *
 * So the light is painted: one direction for the whole texture, upper-left,
 * matching where the scene's low sun is put. Every crater gets a lit outer
 * rim on that side, a shadowed inner wall under it, a lit far wall opposite,
 * and an ejecta apron. That is what a lunar photograph looks like, and it
 * holds at any angle and any distance.
 *
 * Craters follow the size distribution the real surface has — cubed uniform,
 * so a great many small, a few large, the occasional basin — and are laid
 * down oldest first, so later impacts cut into earlier ones.
 */

/** Where the light comes from, in texture space. Up and to the left. */
const MOON_LX = -0.62;
const MOON_LY = -0.78;

export function moonTexture(size = 2048): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const a = c.getContext('2d') as CanvasRenderingContext2D;
  const TAU = Math.PI * 2;

  // Highland regolith.
  a.fillStyle = '#9d968c';
  a.fillRect(0, 0, size, size);

  /* Anything within its own reach of an edge is drawn again on the far side,
     so the tile joins itself and the plain does not end in a seam. */
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    draw(x, y);
    const dx = x < r ? size : x > size - r ? -size : 0;
    const dy = y < r ? size : y > size - r ? -size : 0;
    if (dx) draw(x + dx, y);
    if (dy) draw(x, y + dy);
    if (dx && dy) draw(x + dx, y + dy);
  };

  /* ── Mare ──────────────────────────────────────────────────────────────
     Flood basalt: darker and smoother than the highlands it drowned, with a
     lobed outline, because lava went where the ground let it. */
  for (let i = 0; i < 5; i++) {
    const cx = noise2(i, 1, 41) * size;
    const cy = noise2(i, 2, 43) * size;
    const r = size * (0.1 + noise2(i, 3, 47) * 0.14);
    const lobes = (x: number, y: number) => {
      a.beginPath();
      const steps = 44;
      for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * TAU;
        const j = 0.72 + noise2(k, i, 71) * 0.42 + noise2(k * 2, i, 83) * 0.16;
        const px = x + Math.cos(t) * r * j;
        const py = y + Math.sin(t) * r * j;
        if (k === 0) a.moveTo(px, py); else a.lineTo(px, py);
      }
      a.closePath();
      a.fill();
    };
    a.fillStyle = 'rgba(62,59,56,0.9)';
    a.filter = `blur(${size * 0.004}px)`;
    wrapped(cx, cy, r * 1.4, lobes);
    a.filter = 'none';
  }

  /* ── Craters ─────────────────────────────────────────────────────────── */
  for (let i = 0; i < 700; i++) {
    const cx = noise2(i, 5, 53) * size;
    const cy = noise2(i, 7, 59) * size;
    const r = size * (0.0022 + noise2(i, 11, 61) ** 3 * 0.07);
    const fresh = noise2(i, 13, 67);
    const reach = r * 2.4;

    const paint = (x: number, y: number) => {
      // Ejecta, brightest on the youngest.
      const ej = a.createRadialGradient(x, y, r * 0.9, x, y, reach);
      ej.addColorStop(0, `rgba(206,200,190,${0.08 + fresh * 0.22})`);
      ej.addColorStop(1, 'rgba(206,200,190,0)');
      a.fillStyle = ej;
      a.beginPath(); a.arc(x, y, reach, 0, TAU); a.fill();

      // The bowl: shadow under the rim the light falls on, lit wall opposite.
      a.save();
      a.beginPath(); a.arc(x, y, r, 0, TAU); a.clip();
      const bowl = a.createLinearGradient(
        x + MOON_LX * r, y + MOON_LY * r,
        x - MOON_LX * r, y - MOON_LY * r,
      );
      bowl.addColorStop(0.00, 'rgba(14,13,12,0.72)');
      bowl.addColorStop(0.45, 'rgba(96,91,85,0.26)');
      bowl.addColorStop(1.00, 'rgba(248,244,236,0.34)');
      a.fillStyle = bowl;
      a.fillRect(x - r, y - r, r * 2, r * 2);
      a.restore();

      // The rim crest, catching the light on the near side.
      a.save();
      a.beginPath();
      a.arc(x, y, r * 1.16, 0, TAU);
      a.arc(x, y, r * 0.93, 0, TAU, true);
      a.clip('evenodd');
      const rim = a.createLinearGradient(
        x + MOON_LX * r, y + MOON_LY * r,
        x - MOON_LX * r, y - MOON_LY * r,
      );
      rim.addColorStop(0.00, 'rgba(255,252,244,0.42)');
      rim.addColorStop(0.5, 'rgba(190,184,175,0.06)');
      rim.addColorStop(1.00, 'rgba(24,22,20,0.34)');
      a.fillStyle = rim;
      a.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
      a.restore();
    };
    wrapped(cx, cy, reach, paint);

    /* Rays. Only the youngest large craters have them, and they are the one
       feature you can pick out of a lunar photograph from any distance. */
    if (fresh > 0.86 && r > size * 0.014) {
      const rays = 9 + Math.floor(noise2(i, 17, 73) * 7);
      for (let k = 0; k < rays; k++) {
        const t = noise2(i * 31 + k, 19, 79) * TAU;
        const len = r * (4 + noise2(i + k, 23, 89) * 9);
        const draw = (x: number, y: number) => {
          const gx = x + Math.cos(t) * len;
          const gy = y + Math.sin(t) * len;
          const ray = a.createLinearGradient(x, y, gx, gy);
          ray.addColorStop(0, 'rgba(214,209,200,0.3)');
          ray.addColorStop(1, 'rgba(214,209,200,0)');
          a.strokeStyle = ray;
          a.lineWidth = r * 0.17;
          a.lineCap = 'round';
          a.beginPath(); a.moveTo(x, y); a.lineTo(gx, gy); a.stroke();
        };
        wrapped(cx, cy, len, draw);
      }
    }
  }

  /* Undulation between the craters — soft, and low frequency, because a
     regolith plain is dust over rubble and not a lattice. */
  for (let i = 0; i < 900; i++) {
    const x = noise2(i, 29, 101) * size;
    const y = noise2(i, 31, 103) * size;
    const r = size * (0.004 + noise2(i, 37, 107) ** 2 * 0.03);
    const up = noise2(i, 41, 109) > 0.5;
    const g = a.createRadialGradient(
      x + MOON_LX * r * 0.4, y + MOON_LY * r * 0.4, 0, x, y, r,
    );
    g.addColorStop(0, up ? 'rgba(255,250,242,0.11)' : 'rgba(20,19,18,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g;
    a.beginPath(); a.arc(x, y, r, 0, TAU); a.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
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
