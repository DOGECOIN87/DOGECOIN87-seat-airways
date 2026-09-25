import * as THREE from 'three';
import { noise3 } from './noise';
import { cloudSeaData, earthData, lunarData, marsData, type EarthData, type Plane, type SurfaceData } from './surfaceData';

/**
 * The other worlds, as the scene takes them: textures, arriving when ready.
 *
 * `surfaceData.ts` does the arithmetic and `surfaceWorker.ts` runs it off
 * the main thread. The bank here starts the worker a moment after the page
 * settles and has it build every world in the order the flight is likely to
 * need them — the cloud sea is only $1M away, Mars a hundred — so by the
 * time the market climbs to one, it is waiting. Asking for a world that is
 * not ready yet moves it to the front of the queue, and the scene makes do
 * until it arrives. Without workers, each is built in place on first need.
 */

export interface SurfaceTextures {
  /** Albedo. The cloud sea keeps its coverage in the alpha. */
  day: THREE.DataTexture;
  /** 0 at the lowest point of the tile to 1 at the highest; smooth enough for geometry. */
  height: THREE.DataTexture;
  /** The same relief at full resolution, as a tangent-space normal map. */
  normal: THREE.DataTexture;
  /** Metres from the lowest to the highest point: the displacement scale. */
  relief: number;
  /** Metres across one repeat of the tile. */
  tile: number;
}

export interface EarthMaps {
  /** Land, cloud and aridity in three channels, for the space band's planet. */
  macro: THREE.DataTexture;
  /** The same, baked to colour, for the Earth in the moon's sky. */
  globe: THREE.DataTexture;
}

export type SurfaceKind = 'clouds' | 'earth' | 'moon' | 'mars';

export interface SurfaceBank {
  /** A world's ground, or null while it is still being built. */
  surface(kind: 'clouds' | 'moon' | 'mars'): SurfaceTextures | null;
  /** Earth from above, or null while it is still being built. */
  earth(): EarthMaps | null;
  dispose(): void;
}

function texture(p: Plane, srgb: boolean, mipmaps = true): THREE.DataTexture {
  const tex = new THREE.DataTexture(p.data, p.width, p.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const surfaceTextures = (d: SurfaceData): SurfaceTextures => ({
  day: texture(d.day, true),
  height: texture(d.height, false, false),
  normal: texture(d.normal, false),
  relief: d.relief,
  tile: d.tile,
});

function earthTextures(d: EarthData): EarthMaps {
  const globe = texture(d.globe, true);
  // Round the sphere, not over the poles.
  globe.wrapT = THREE.ClampToEdgeWrapping;
  return { macro: texture(d.macro, false), globe };
}

const LOCAL = { clouds: cloudSeaData, earth: earthData, moon: lunarData, mars: marsData } as const;

export function createSurfaceBank(): SurfaceBank {
  const ready = new Map<SurfaceKind, SurfaceTextures | EarthMaps>();
  const queue: SurfaceKind[] = ['clouds', 'earth', 'moon', 'mars'];
  let busy: SurfaceKind | null = null;
  let worker: Worker | null = null;

  const accept = (kind: SurfaceKind, out: SurfaceData | EarthData) => {
    ready.set(kind, 'macro' in out ? earthTextures(out) : surfaceTextures(out));
  };
  const next = () => {
    if (!worker || busy || queue.length === 0) return;
    busy = queue.shift() as SurfaceKind;
    worker.postMessage(busy);
  };
  try {
    worker = new Worker(new URL('./surfaceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ kind: SurfaceKind; out: SurfaceData | EarthData }>) => {
      accept(event.data.kind, event.data.out);
      busy = null;
      next();
    };
    // A worker that cannot start is no worker: fall back to building in place.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (busy) queue.unshift(busy);
      busy = null;
    };
  } catch {
    worker = null;
  }
  // Not while the page is still arriving.
  const start = setTimeout(next, 2500);

  const want = (kind: SurfaceKind) => {
    const have = ready.get(kind);
    if (have) return have;
    const at = queue.indexOf(kind);
    if (!worker) {
      if (at >= 0) queue.splice(at, 1);
      accept(kind, LOCAL[kind]());
      return ready.get(kind) ?? null;
    }
    if (at > 0) {
      queue.splice(at, 1);
      queue.unshift(kind);
    }
    if (!busy) {
      clearTimeout(start);
      next();
    }
    return null;
  };

  return {
    surface: (kind) => want(kind) as SurfaceTextures | null,
    earth: () => want('earth') as EarthMaps | null,
    dispose: () => {
      clearTimeout(start);
      worker?.terminate();
      for (const made of ready.values()) {
        for (const tex of Object.values(made)) if (tex instanceof THREE.Texture) tex.dispose();
      }
    },
  };
}

/* ── The moons of Mars ────────────────────────────────────────────────────
   Phobos and Deimos are not spheres; they are rubble too small to have
   pulled itself round. A subdivided icosahedron pushed in and out by noise,
   with Phobos's great crater, Stickney, pressed into one end. */

export function potatoGeometry(seed: number, stickney = false): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 5);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const crater = new THREE.Vector3(1, 0.15, 0.2).normalize();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const [f, a] of [[1.6, 0.16], [3.5, 0.06], [8, 0.025]] as const) {
      r += (noise3(v.x * f + 9, v.y * f + 9, v.z * f + 9, seed + f * 10) - 0.5) * a * 2;
    }
    if (stickney) {
      const d = v.distanceTo(crater);
      if (d < 0.55) r -= 0.16 * (1 - (d / 0.55) ** 2);
    }
    v.multiplyScalar(r);
    v.x *= 1.3;
    v.z *= 0.9;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
