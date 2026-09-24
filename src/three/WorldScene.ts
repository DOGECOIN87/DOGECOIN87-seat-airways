import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cloudTexture, earthTexture, farmlandTextures, HILL_HEIGHT, moonTexture, oceanTextures, radialTexture } from './terrain';
import type { SkyState } from '../lib/sky';
import type { BandState } from '../lib/flightModel';
import type { Attitude } from '../lib/useAttitude';
import { biomeAt } from '../lib/biome';
import { HANDS_OFF, type ManualControls } from '../lib/manualControls';
import { CABIN, createCabin, rowZ } from './cabin';
import { createAirframe } from './airframe';

/**
 * The world outside, rendered.
 *
 * A real scene rather than a drawing of one: a physical sky with Rayleigh and
 * Mie scattering, the sun placed from the visitor's actual solar elevation,
 * ground that recedes into its own haze, and a cloud deck you climb through.
 * Everything the flight model already computes — pitch, bank, heading, market
 * cap as altitude — drives a perspective camera, so the horizon behaves
 * because it is a horizon, not because it was drawn tilted.
 *
 * One scene covers every altitude band. Climbing is literally moving the
 * camera up: the cloud deck falls below you at $1M, the atmosphere thins to
 * black by $10M, and at $50M the ground is swapped for the moon.
 */

/** Metres of camera height per band, on a log scale so the climb reads. */
const ALTITUDE = {
  atmosphere: [900, 2600],
  'above-clouds': [3400, 9000],
  space: [16000, 60000],
  moon: [1200, 1200],
} as const;

/* The ground plate. Wide enough that its edge sits well past anything the
   haze still resolves at the bands that use it — an edge you can see is a
   horizon in the wrong place. */
const GROUND = 120000;

/** Where the camera is sitting, and which way it is looking. */
export interface ViewPose {
  /** Seat index across the cabin, 0–5, or null for the flight deck. */
  seatIndex: number | null;
  row: number;
  /** The seat's id, so its own occupant can be left out. */
  id: string;
  /** Head turn in degrees: negative left, positive right. */
  yaw: number;
  /**
   * Outside the aeroplane, looking at it.
   *
   * The camera rides the airframe rather than the world, so the aircraft
   * holds its place in the frame and the horizon rolls behind it — which is
   * what flying alongside something actually looks like.
   */
  exterior?: boolean;
  /** Orbit around the aircraft, in degrees, for the exterior view. */
  orbit?: number;
}

export interface WorldHandles {
  render: (a: Attitude, sky: SkyState, band: BandState, pose: ViewPose) => void;
  resize: (w: number, h: number) => void;
  setOccupancy: (taken: ReadonlySet<string>) => void;
  /** The adverts showing on the row ahead, by seat id. */
  setAdverts: (bySeat: Readonly<Record<string, string>>) => void;
  /**
   * Fly it by hand.
   *
   * Pushed in rather than passed to `render`, like the occupancy and the
   * adverts, because it is state the scene holds between frames: the roll
   * eases toward what it is told over the better part of a second, which
   * means the scene has to remember where it had got to.
   */
  setControls: (controls: ManualControls) => void;
  /** Metres of ground covered since the view opened. */
  travelled: () => number;
  dispose: () => void;
}

export function createWorld(canvas: HTMLCanvasElement): WorldHandles {
  const lowPower =
    (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4) ||
    (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowPower,
    powerPreference: lowPower ? 'low-power' : 'high-performance',
    // The scene spans a window a few centimetres from the camera through a
    // sky dome 160 km away. Log depth keeps window glass and the exterior
    // livery from z-fighting at that range.
    logarithmicDepthBuffer: true,
  });
  const maxPixelRatio = Math.min(window.devicePixelRatio, lowPower ? 1.25 : 1.5);
  const minPixelRatio = lowPower ? 0.8 : 1;
  let pixelRatio = maxPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200000);

  /* The aircraft carries the cabin and the camera; the world does not move. */
  const aircraft = new THREE.Group();
  aircraft.rotation.order = 'YXZ';
  scene.add(aircraft);

  const cabin = createCabin();
  aircraft.add(cabin.group);
  aircraft.add(camera);
  const cabinLamps: Array<{ light: THREE.PointLight; intensity: number; colour: THREE.Color }> = [];
  cabin.group.traverse(object => {
    if (object instanceof THREE.PointLight) {
      cabinLamps.push({ light: object, intensity: object.intensity, colour: object.color.clone() });
    }
  });

  /* The aeroplane itself, for when the camera is outside it. */
  const airframe = createAirframe();
  airframe.group.visible = false;
  aircraft.add(airframe.group);

  /* ── Environment ──────────────────────────────────────────────────────
     One soft equirectangular gradient — zenith blue through a bright horizon
     to a ground tone — prefiltered once at startup. It is not the live sky
     and does not try to be: what the physical materials want is *something*
     plausible to mirror, so the fuselage carries a moving sheen and the sea
     reflects a sky, for the price of a 64-pixel texture. Applied to the
     airframe and the water explicitly rather than to the whole scene, so
     the cabin's carefully balanced interior light is left alone. */
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 64;
  envCanvas.height = 32;
  const eg = envCanvas.getContext('2d') as CanvasRenderingContext2D;
  const egrad = eg.createLinearGradient(0, 0, 0, 32);
  egrad.addColorStop(0, '#4f88cf');
  egrad.addColorStop(0.48, '#cfe2f2');
  egrad.addColorStop(0.55, '#e4ecf1');
  egrad.addColorStop(1, '#5c6653');
  eg.fillStyle = egrad;
  eg.fillRect(0, 0, 64, 32);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(envTex);
  envTex.dispose();
  pmrem.dispose();
  airframe.group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if ('envMapIntensity' in mat) {
        mat.envMap = envRT.texture;
        mat.envMapIntensity = 0.55;
        mat.needsUpdate = true;
      }
    }
  });

  /* Cabin lighting. A tube blocks the sun, and there is no bounce in here. */
  const cabinLight = new THREE.PointLight(0xffd8a8, 11, 10, 2);
  aircraft.add(cabinLight);
  const cabinFill = new THREE.HemisphereLight(0xdcebff, 0xd6c9b2, 0.45);
  const cabinAmbient = new THREE.AmbientLight(0xdfd6c4, 0.32);
  aircraft.add(cabinAmbient);
  aircraft.add(cabinFill);

  /* ── Sky ─────────────────────────────────────────────────────────────
     Preetham scattering. Turbidity and the Mie term carry the weather:
     clear air is thin and blue, overcast is thick and grey.

     Leaving the atmosphere is *not* those coefficients going to zero. The
     Preetham model divides by them, so scaling them down does not thin the
     air, it blows the whole dome out to a flat white — which is what the
     space band used to look like. The air is instead taken away by dimming
     the dome's own output, from the zenith downward: `skyFade` runs 1 in
     atmosphere to 0 above it, and the limb term keeps a bright blue band
     hugging the horizon after the zenith has gone black. That band is the
     whole photograph of the edge of space, and it is the one part of the sky
     that genuinely survives up there. */
  const sky = new Sky();
  sky.scale.setScalar(160000);
  scene.add(sky);
  const skyU = sky.material.uniforms as typeof sky.material.uniforms & {
    skyFade: { value: number };
  };
  skyU.rayleigh.value = 2.2;
  skyU.mieCoefficient.value = 0.005;
  skyU.mieDirectionalG.value = 0.8;
  skyU.skyFade = { value: 1 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\n\t\tuniform float skyFade;')
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `// A fifth power, not a fraction. This sky runs to hundreds of units in
			// linear light near the sun, so three per cent of it still tone-maps
			// to white — which is exactly how a "dimmed" sky stayed a bright
			// void through two attempts at this. At the fifth power the dome is
			// genuinely gone by the time the band is entered, and the blue that
			// survives up there comes from the limb's own atmosphere shell,
			// seen edge on, which is where it comes from in a photograph.
			gl_FragColor = vec4( texColor * pow( skyFade, 5.0 ), 1.0 );`,
    );
  sky.material.needsUpdate = true;

  const sunPos = new THREE.Vector3();
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 256 : 512, lowPower ? 256 : 512);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 180000;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00008;
  scene.add(sun);
  scene.add(sun.target);
  const ambient = new THREE.HemisphereLight(0xbfd8ff, 0x4a5c3a, 0.55);
  scene.add(ambient);
  /* Light thrown back up off the ground, for the exterior view only. */
  const bounce = new THREE.DirectionalLight(0xdcd3bd, 0.5);
  bounce.position.set(0.2, -1, 0.3);
  bounce.visible = false;
  scene.add(bounce);

  /* ── Stars, for when the air runs out ──────────────────────────────────
     A uniform scatter of identical white dots reads as static. A real sky has
     a steep magnitude distribution — a handful you notice, a great many you
     only see once your eyes adjust — and its stars are not white: they run
     from blue-white through to orange by temperature. Both are per-vertex
     colour, which costs nothing and is most of the difference between a
     starfield and a screensaver.

     A third of them are pulled toward one great circle, because the Milky Way
     is the first thing anybody looks for and its absence is conspicuous. */
  /* The field's own radius, and the point size that goes with it. Both are
     scaled each frame so the field always sits beyond whatever the horizon is
     and inside whatever the far plane is — in space the limb's horizon is a
     quarter of a million metres away, and a star field parked closer than
     that draws in front of the planet. */
  const STAR_R = 120000;
  const STAR_SIZE = 300;
  const starGeo = new THREE.BufferGeometry();
  const starCount = 4200;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const galactic = new THREE.Vector3(0.34, 0.62, 0.71).normalize();
  const tmpStar = new THREE.Vector3();
  const starTint = new THREE.Color();
  for (let i = 0; i < starCount; i++) {
    tmpStar.randomDirection();
    // Flatten a third of the field onto the galactic plane.
    if (i % 3 === 0) {
      const along = tmpStar.dot(galactic);
      tmpStar.addScaledVector(galactic, -along * (0.82 + Math.random() * 0.16)).normalize();
    }
    /* A whole sphere, not a hemisphere. Below the horizon the ground — or, in
       space, the limb — is opaque and occludes them anyway, and between the
       curved horizon and eye level there is real sky that a hemisphere left
       as a starless wedge. */
    tmpStar.multiplyScalar(STAR_R);
    starPos.set([tmpStar.x, tmpStar.y, tmpStar.z], i * 3);

    // Magnitude: cubed, so most sit near the threshold of visibility and the
    // few bright ones actually stand out against them.
    const mag = Math.random() ** 3 * 0.85 + 0.15;
    // Temperature, from cool orange to hot blue-white.
    const t = Math.random();
    starTint.setHSL(t < 0.72 ? 0.58 - t * 0.1 : 0.09, t < 0.72 ? 0.22 : 0.45, 0.5);
    starCol.set([starTint.r * mag, starTint.g * mag, starTint.b * mag], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({
    size: STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    vertexColors: true,
    // Additive, so overlapping stars in the galactic band build into a haze
    // rather than flatly occluding one another.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Nothing between here and a star to scatter anything.
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* ── The sun, as an object ────────────────────────────────────────────
     In atmosphere the Sky shader draws its own sun and this stays hidden. Once
     the air thins out there is nothing left to scatter, and a sky with a
     directional light but no visible source looks wrong in a way that is hard
     to place. Two billboards: the disc, and a wide soft bloom around it. */
  const sunDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture(0.82),
      color: 0xfff6e2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
  );
  sunDisc.scale.setScalar(3400);
  scene.add(sunDisc);
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture(0.02),
      color: 0xffe9c4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  sunGlow.scale.setScalar(16000);
  scene.add(sunGlow);

  /* ── Earth ────────────────────────────────────────────────────────────
     Off the port side at the moon, which is what the aircraft has been
     promising since the first commit. Lit by the same directional light as
     everything else, so it carries a real terminator and shows a crescent or
     a full disc depending on where the sun has been put. The shell around it
     is the atmosphere: back faces only, additive, which is the cheap way to
     get a limb that glows without a shader. */
  const earthMap = earthTexture();
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshStandardMaterial({ map: earthMap, roughness: 0.92, metalness: 0 }),
  );
  earth.scale.setScalar(9000);
  earth.visible = false;
  // Parented to the aircraft, not the world: a heading change should not swing
  // Earth out of the only window it was composed for. Pitch and bank still
  // move it, which is the part that has to feel physical.
  aircraft.add(earth);
  const earthAir = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6ba8ee,
      transparent: true,
      opacity: 0.24,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  earthAir.scale.setScalar(9000 * 1.055);
  earthAir.visible = false;
  aircraft.add(earthAir);

  /* ── Ground ── */
  const farmland = farmlandTextures();
  const moon = moonTexture();
  /* Three-kilometre tiles, not five and a half.
  
     The plate is 120 km across and the aircraft covers a few hundred metres a
     second, so the only question that matters is how much detail there is to
     see that against. At the old scale one repeat of the pattern took the
     better part of a minute to cross the frame, and the ground read as a
     still photograph with a slow drift on it — which is what "not flying
     forward" actually looks like. Finer tiles put field boundaries at a few
     hundred metres, where real ones are, and the same speed becomes visible
     because there is something to measure it by. */
  farmland.day.repeat.set(40, 40);
  /* The lights repeat with the land, because they are the same land. */
  farmland.night.repeat.set(40, 40);
  farmland.water.repeat.set(40, 40);
  /* Bigger tiles than the farmland's. A crater is a landform, not a field:
     at five-kilometre tiles the largest one in the texture was a few hundred
     metres across and the plain read as flat grey from any altitude worth
     being at. */
  moon.repeat.set(9, 9);
  /* Towns after dark.

     The night map is emissive rather than a second lit surface: street
     lighting and lit windows are things that emit, and a diffuse map cannot
     be seen once the sun that lights it has set — which is precisely when a
     town is worth looking at. `emissiveIntensity` is driven from the real
     solar elevation each frame, so the lights come up through dusk and are
     gone by mid-morning, on the visitor's own clock. */
  const groundMat = new THREE.MeshStandardMaterial({
    map: farmland.day,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: farmland.night,
    emissiveIntensity: 0,
    roughness: 1,
    metalness: 0,
  });
  const groundGeometry = new THREE.PlaneGeometry(GROUND, GROUND);
  const ground = new THREE.Mesh(groundGeometry, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* ── Relief ─────────────────────────────────────────────────────────────
     The plate is flat, and from a kilometre up that read as a tablecloth.
     The hills live in a second, denser mesh laid over the middle of it —
     26 km across, a vertex every hundred-odd metres — displaced by the
     tile's own height field. The displacement map scrolls with the fields
     (same repeat, same offset), so the hills travel with the land on them
     rather than the land sliding over fixed bumps. Toward its rim the
     relief fades to nothing and the flat plate carries on to the horizon,
     two metres lower so the two never fight — invisible from up here. Both
     are lit through the normal map, so even the flat far country keeps the
     light and shade of its slopes. */
  const NEAR = 26000;
  const NEAR_SEG = lowPower ? 150 : 220;
  const nearGeometry = new THREE.PlaneGeometry(NEAR, NEAR, NEAR_SEG, NEAR_SEG);
  {
    // UVs matched to the plate's, so the same textures land in the same place.
    const uv = nearGeometry.attributes.uv;
    const k = NEAR / GROUND;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) - 0.5) * k + 0.5, (uv.getY(i) - 0.5) * k + 0.5);
    }
    // How much of the relief each vertex carries: all of it in the middle,
    // none at the rim.
    const pos = nearGeometry.attributes.position;
    const fade = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i)) / (NEAR / 2);
      fade[i] = 1 - THREE.MathUtils.smoothstep(r, 0.55, 0.95);
    }
    nearGeometry.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
  }
  farmland.height.repeat.set(40, 40);
  farmland.normal.repeat.set(40, 40);
  const nearMat = new THREE.MeshStandardMaterial({
    map: farmland.day,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: farmland.night,
    emissiveIntensity: 0,
    roughness: 1,
    metalness: 0,
    displacementMap: farmland.height,
    displacementScale: HILL_HEIGHT,
    normalMap: farmland.normal,
  });
  nearMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float fade;')
      .replace(
        '#include <displacementmap_vertex>',
        `#ifdef USE_DISPLACEMENTMAP
          transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale * fade + displacementBias );
        #endif`,
      );
  };
  const near = new THREE.Mesh(nearGeometry, nearMat);
  near.rotation.x = -Math.PI / 2;
  scene.add(near);
  ground.position.y = -2;
  groundMat.normalMap = farmland.normal;
  groundMat.needsUpdate = true;
  const waterMat = new THREE.MeshPhysicalMaterial({
    map: farmland.water,
    color: 0x9ed9e5,
    roughness: 0.18,
    metalness: 0.08,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const water = new THREE.Mesh(groundGeometry, waterMat);
  water.position.y = 0.025;
  water.rotation.x = -Math.PI / 2;
  water.visible = false;
  scene.add(water);
  waterMat.envMap = envRT.texture;
  waterMat.envMapIntensity = 0.7;

  /* ── The sea ──────────────────────────────────────────────────────────
     Every few minutes the flight crosses a coast (`biomeAt`, shared with the
     SVG views, so every window agrees). Two extra surfaces do the work, and
     both stand down when they are not needed: `sea` is the crossfade — open
     water dissolving in over the farmland as the coast goes by — and `sheen`
     is the glint, a sparkle field sliding just above the water at its own
     rate, which is the whole optical recipe for a liquid surface. Once the
     crossing completes, the plate itself takes the ocean maps and drops back
     to one opaque plane, so steady cruise over water costs what cruise over
     land does. */
  const ocean = oceanTextures();
  ocean.day.repeat.set(40, 40);
  ocean.night.repeat.set(40, 40);
  ocean.glint.repeat.set(52, 52);
  const seaMat = new THREE.MeshStandardMaterial({
    map: ocean.day,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: ocean.night,
    emissiveIntensity: 0,
    roughness: 0.6,
    metalness: 0.05,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const sea = new THREE.Mesh(groundGeometry, seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.02;
  sea.visible = false;
  scene.add(sea);
  const sheenMat = new THREE.MeshPhysicalMaterial({
    map: ocean.glint,
    color: 0xcfeaf4,
    roughness: 0.16,
    metalness: 0.1,
    clearcoat: 0.7,
    clearcoatRoughness: 0.14,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    envMap: envRT.texture,
    envMapIntensity: 0.8,
  });
  const sheen = new THREE.Mesh(groundGeometry, sheenMat);
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.035;
  sheen.visible = false;
  scene.add(sheen);

  /* ── The limb ─────────────────────────────────────────────────────────
     A flat plate is a fair model of the ground until you can see far enough
     along it to notice it is not flat. In the space band you can: the whole
     promise of that band is that the horizon starts to curve, and a plane
     cannot curve.

     So above the atmosphere the ground is swapped for a sphere whose north
     pole sits exactly where the plate did, at y = 0, and the horizon becomes
     its limb. The radius is not the Earth's — at a true 6,371 km the curve
     over this band's 16–60 km would be a couple of degrees and read as
     nothing. It is instead interpolated down as you climb, from nearly flat
     at the bottom of the band to a hard curve at the top, so the curvature
     itself is the thing the climb buys you. The shell around it is the
     atmosphere seen edge on: back faces, additive, so it lights the rim the
     way the real one does without costing a shader. */
  /* The same ground the lower bands fly over, seen from further up — which is
     both the honest answer and the legible one. A whole-Earth map at this
     scale put a single continent and one cloud across the entire visible cap:
     the camera sees a few hundred kilometres of a sphere thousands across, so
     planetary features arrive magnified into flat bands of colour. Farmland
     tiled to roughly a hundred kilometres gives what you actually see from
     the edge of space — texture, not geography. */
  /* A clone rather than a second generation: it shares the canvas already
     drawn, so the limb costs a uniform rather than another 2048-square pass
     over every field, town and building in the tile. No night map here —
     the space band forces the sun to 46 degrees to light the planet at all,
     and a daylit hemisphere has no city lights to show. */
  const planetTex = farmland.day.clone();
  planetTex.wrapS = planetTex.wrapT = THREE.RepeatWrapping;
  planetTex.repeat.set(240, 120);
  planetTex.needsUpdate = true;
  const limb = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.MeshStandardMaterial({ map: planetTex, roughness: 0.98, metalness: 0 }),
  );
  limb.visible = false;
  scene.add(limb);
  const limbAir = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5aa2ff,
      transparent: true,
      opacity: 0.45,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  limbAir.visible = false;
  scene.add(limbAir);
  /* Nearly flat where the band begins, and a real planet by the top of it. */
  const LIMB_R = { low: 4_200_000, high: 620_000 };

  /* ── Cloud deck ──────────────────────────────────────────────────────
     Billboarded puffs on one instanced mesh: cheap, and from inside they
     genuinely occlude the ground the way a real layer does. */
  const puff = cloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: puff,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    fog: true,
  });
  const CLOUDS = 620;
  const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, CLOUDS);
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cloudSeeds: { x: number; z: number; y: number; s: number }[] = [];
  for (let i = 0; i < CLOUDS; i++) {
    const a = Math.random() * Math.PI * 2;
    /* A square-root spread over the whole deck puts almost every cloud far
       away, where nothing appears to move. Ground twenty kilometres off
       barely shifts in a second; a cloud two hundred metres from the wingtip
       crosses the entire frame in one. So a third of the deck is seeded close
       in, and that third is what the speed reads off.

       They are the cue, not the ground: from two kilometres up the ground's
       angular rate is a few degrees a second no matter how fast the aircraft
       is genuinely going. */
    const near = i % 3 === 0;
    const r = near ? 260 + Math.random() * 4200 : 2000 + Math.sqrt(Math.random()) * 22000;
    cloudSeeds.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      /* The far deck is a layer; the near cloud is scattered well below it.

         Kept in a tight band at deck height, every near cloud sat above an
         exterior camera that looks thirteen degrees *down* at the aircraft —
         so the one thing fast enough to read as speed was always just off the
         top of the frame, and the deck only ever appeared as a line on the
         horizon. Scattered down through the band the aircraft actually flies
         in, they pass the wingtip, which is where you see them from. */
      y: near ? -1450 + Math.random() * 1850 : (Math.random() - 0.5) * 340,
      s: (near ? 380 : 900) + Math.random() * (near ? 1250 : 2400),
    });
  }
  scene.add(clouds);

  const fog = new THREE.FogExp2(0xa8c4e0, 0.00006);
  scene.fog = fog;

  const dummy = new THREE.Object3D();
  const extPos = new THREE.Vector3();
  const extTarget = new THREE.Vector3();
  const extDir = new THREE.Vector3();
  const skyColour = new THREE.Color();
  const skyTint = new THREE.Color();
  const groundTint = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  const EARTH = new THREE.Color(0x6f6a58);
  const SEA_TINT = new THREE.Color(0x27506b);
  const SEA_BOUNCE = new THREE.Color(0x9fc3d4);
  const LAND_BOUNCE = new THREE.Color(0xdcd3bd);
  const MOOD_BLUE = new THREE.Color(0x8fb8e8);
  const CABIN_WARM = new THREE.Color(0xffd8a8);
  const cloudTint = new THREE.Color();
  const cloudLit = new THREE.Color();
  const NEUTRAL_CLOUD = new THREE.Color(0xb9c2cf);
  let cloudDeckY = 2400;
  let cloudCount = 0;
  let cloudUpdateClock = 0;
  let frameClock = 0;
  let frameSamples = 0;
  let frameTimeTotal = 0;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  /* ── Travel ──────────────────────────────────────────────────────────
     The aircraft stays at the origin and the world moves under it, which is
     the only way this works: keeping the apparent ground speed readable from
     60,000 ft means a notional speed of kilometres per second, and an
     aircraft actually translated that far would leave the sky dome inside a
     minute. Shifting the ground's texture and recycling the cloud deck costs
     nothing and never runs out of world.

     The shift is scaled by altitude so the rate the ground slides past a
     window stays the same at every band — v/h constant, which is what the
     eye reads as speed. */
  const shift = { x: 0, z: 0 };
  let last = performance.now();
  const CLOUD_SPAN = 44000;
  /* v/h constant — for real this time. The old constant 18 m/s was honest
     physics for a cruise altitude and therefore read as a parked aeroplane:
     at 900 m it moved the ground one degree a second, which no eye calls
     flying. What the eye reads as speed is v/h, so the drift is a fraction
     of the camera's height per second, floored so the bottom of the first
     band still visibly goes, and capped so the space band's kilometres of
     height do not spin the limb. */
  const V_OVER_H = 0.15;
  const SPEED_FLOOR = 120;
  const SPEED_CAP = 2200;
  const wrap = (v: number) => ((((v + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2;

  const render = (a: Attitude, skyState: SkyState, band: BandState, pose: ViewPose) => {
    const inSpace = band.band === 'space';
    const onMoon = band.band === 'moon';

    /* Camera height from the altitude band, log-spaced within it. */
    const [lo, hi] = ALTITUDE[band.band];
    const height = lerp(lo, hi, band.progress);

    /* Sun from the real solar position: elevation from the clock and the
       latitude, azimuth swung across the sky by the hour.

       Above the atmosphere the visitor's local night is somebody else's noon,
       and a planet lit edge-on is a black disc with a rim. So the sun is put
       where it lights the thing you came up here to look at: high over the
       limb in space, low over the moon, where a grazing sun is what gives
       regolith its relief. */
    const elevation = onMoon ? 23 : inSpace ? 46 : skyState.elevation;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(skyState.sunX * 80);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU.sunPosition.value.copy(sunPos);
    sun.position.copy(sunPos).multiplyScalar(100000);
    /* The disc itself. It reddens and weakens as it goes down rather than
       simply switching off, which is the half of golden hour a plain
       intensity ramp misses. */
    sun.intensity = onMoon ? 4.6 : inSpace ? 3.4 : Math.max(0.04, Math.sin(THREE.MathUtils.degToRad(Math.max(elevation, -6))) * 3.2);
    if (!onMoon && !inSpace) sun.color.setStyle(skyState.palette.disc).lerp(WHITE, 0.3);
    else sun.color.setHex(0xffffff);

    /* Weather thickens the air. Altitude does not thin it — it takes it away;
       see the note on `skyFade` where the dome is built. The coefficients
       stay at the values the model is valid for at every band. */
    const overcast = skyState.weather === 'overcast' || skyState.weather === 'fog';
    const rain = skyState.weather === 'rain' || skyState.weather === 'storm';
    /* Above the cloud deck the air overhead is genuinely thinner and cleaner:
       less Mie haze, deeper blue. That is the whole look of that band. */
    const high = band.band === 'above-clouds' ? band.progress : 0;
    skyU.turbidity.value = overcast ? 14 : rain ? 10 : lerp(3.2, 1.6, high);
    skyU.rayleigh.value = overcast ? 0.6 : lerp(2.4, 3.1, high);
    skyU.mieCoefficient.value = (overcast ? 0.03 : 0.005) * lerp(1, 0.45, high);
    /* How much of the sky is left.
    
       $10M is *defined* as the sky going black, so by the time the band is
       entered almost all of it is gone — the announcement and the window have
       to agree, and a band called "space" that opens on navy does not keep
       that bargain. The last of it drains on the climb to the moon.
       
       The band above starts the job, so the threshold is a step down a slope
       rather than a cliff: the top of the cloud band is already a deep blue
       that has stopped being daylight. */
    const airless = inSpace
      ? 0.58 + 0.42 * THREE.MathUtils.smoothstep(band.progress, 0, 0.55)
      : band.band === 'above-clouds'
        ? 0.38 * THREE.MathUtils.smoothstep(band.progress, 0.45, 1)
        : 0;
    skyU.skyFade.value = 1 - airless;
    // Ground and cabin lighting follow the sky: an aeroplane in vacuum is not
    // lit by a dome that is no longer there.
    sky.visible = !onMoon;

    /* Above the atmosphere the sky is simply gone, and the stars arrive. */
    const starOpacity = onMoon ? 1 : inSpace ? Math.min(1, 0.2 + airless * 1.1) : Math.max(0, skyState.palette.stars - 0.35);
    starMat.opacity = starOpacity;
    stars.position.copy(aircraft.position);
    renderer.setClearColor(0x000000, 1);

    /* The sun becomes an object once there is no air left to scatter it. The
       Sky shader draws its own below that, so showing both would double it. */
    const sunVisibility = onMoon ? 1 : inSpace ? airless : 0;
    sunDisc.visible = sunGlow.visible = sunVisibility > 0.01;
    if (sunDisc.visible) {
      sunDisc.position.copy(sunPos).multiplyScalar(110000);
      sunGlow.position.copy(sunDisc.position);
      sunDisc.material.opacity = sunVisibility;
      sunGlow.material.opacity = sunVisibility * 0.5;
    }

    /* Earthrise. Off the port side, a little above the horizon, turning on its
       own axis — and lit by the same sun as everything else, so the phase it
       shows is the phase the geometry says it should. */
    earth.visible = earthAir.visible = onMoon;
    if (onMoon) {
      earth.position.set(-52000, 15000, -30000);
      earthAir.position.copy(earth.position);
      earth.rotation.y += 0.0006;
      earth.rotation.z = 0.41; // axial tilt, so the caps sit where they belong
    }

    /* Ground: farmland below, regolith at the moon, and haze that thickens
       with distance so the horizon dissolves rather than ending. Above the
       atmosphere the plate gives way to the limb, which is a sphere. */
    /* Which country is under the aircraft. The moon overrules the coast. */
    const seaBlend = onMoon ? 0 : biomeAt(Date.now()).ocean;
    const waterFade = band.band === 'atmosphere'
      ? (1 - THREE.MathUtils.smoothstep(height, 1450, 2150)) * (1 - seaBlend)
      : 0;
    waterMat.opacity = waterFade;
    water.visible = waterFade > 0.01;
    /* The plate takes whichever map the moment calls for; the crossfade mesh
       only exists while the coast is actually going by. */
    const plateMap = onMoon ? moon : seaBlend >= 0.999 ? ocean.day : farmland.day;
    if (groundMat.map !== plateMap) {
      groundMat.map = plateMap;
      // Nobody is home on the moon; ships are, at sea.
      groundMat.emissiveMap = onMoon ? null : seaBlend >= 0.999 ? ocean.night : farmland.night;
      groundMat.roughness = plateMap === ocean.day ? 0.62 : 1;
      groundMat.needsUpdate = true;
    }
    /* The relief belongs to the farmland: none on the moon, and the hills
       sink as the coast arrives, so the sea has somewhere flat to come in
       over. Normal map and displacement go down together. */
    const reliefOn = plateMap === farmland.day;
    const relief = reliefOn ? 1 - THREE.MathUtils.smoothstep(seaBlend, 0, 0.6) : 0;
    const wantNormal = reliefOn ? farmland.normal : null;
    if (groundMat.normalMap !== wantNormal) {
      groundMat.normalMap = wantNormal;
      groundMat.needsUpdate = true;
    }
    if (nearMat.map !== groundMat.map || nearMat.emissiveMap !== groundMat.emissiveMap || nearMat.normalMap !== wantNormal) {
      nearMat.map = groundMat.map;
      nearMat.emissiveMap = groundMat.emissiveMap;
      nearMat.normalMap = wantNormal;
      nearMat.roughness = groundMat.roughness;
      nearMat.needsUpdate = true;
    }
    groundMat.normalScale.setScalar(relief);
    nearMat.normalScale.setScalar(relief);
    nearMat.displacementScale = HILL_HEIGHT * relief;
    sea.visible = !onMoon && !inSpace && seaBlend > 0.001 && seaBlend < 0.999;
    seaMat.opacity = seaBlend;
    /* Lights up through dusk, out by mid-morning. Civil twilight is about
       six degrees below the horizon, so the ramp is hung either side of
       that rather than on sunset itself — which is when you can first see a
       town from the air, not when the sun clears the horizon. */
    groundMat.emissiveIntensity = onMoon
      ? 0
      : 1 - THREE.MathUtils.smoothstep(skyState.elevation, -8, 3);
    seaMat.emissiveIntensity = groundMat.emissiveIntensity;
    nearMat.emissiveIntensity = groundMat.emissiveIntensity;
    ground.visible = !inSpace;
    near.visible = !inSpace;
    limb.visible = limbAir.visible = inSpace;
    if (inSpace) {
      /* The radius shrinks as you climb, so the horizon bends further the
         higher the market cap goes — the curve is the altitude, read off the
         window rather than off a tape. */
      const r = lerp(LIMB_R.low, LIMB_R.high, THREE.MathUtils.smoothstep(band.progress, 0, 0.85));
      limb.scale.setScalar(r);
      limb.position.y = -r;
      /* The shell is the atmosphere seen edge on, and it only reads that way
         from outside it. Scaled as a fraction of the planet it swallowed the
         camera whole — 2% of four thousand kilometres is ninety, and the
         aircraft is at sixteen — and an additive shell seen from inside is not
         a glowing rim, it is a blue wash over the entire sky, which is what
         the space band looked like. So its top is pinned below the aircraft:
         the air you have climbed out of, not the air you are in. */
      limbAir.scale.setScalar(r + height * 0.55);
      limbAir.position.y = -r;
      /* Turn it under the aircraft rather than sliding a texture: on a sphere
         that is what travelling actually is, and it keeps the poles out of
         the frame. */
      /* Tilted a quarter turn so the point directly below the aircraft sits on
         the sphere's equator. Leave it at the pole and the equirectangular
         map converges exactly where you are looking hardest. */
      limb.rotation.y = -shift.x / r;
      limb.rotation.x = Math.PI / 2 + shift.z / r;
      /* With the dome gone, this shell is the only blue left in the sky, so
         it carries the whole band on the horizon. */
      (limbAir.material as THREE.MeshBasicMaterial).opacity = 0.3 + airless * 0.34;
      // The far side of a 4,200 km sphere is past any sane far plane; the
      // near cap and its horizon are not, so the frustum follows the radius.
      const far = Math.max(200000, Math.sqrt((r + height) * (r + height) - r * r) * 1.35);
      if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
      // Push the stars past the limb, and grow the points to match so they
      // stay the same size on screen.
      const k = (far * 0.82) / STAR_R;
      stars.scale.setScalar(k);
      starMat.size = STAR_SIZE * k;
    } else {
      stars.scale.setScalar(1);
      starMat.size = STAR_SIZE;
      if (camera.far !== 200000) {
        camera.far = 200000;
        camera.updateProjectionMatrix();
      }
    }

    skyColour.setStyle(skyState.palette.horizon);
    fog.color.copy(onMoon ? new THREE.Color(0x000000) : skyColour);
    /* Haze is air, so it goes with the air. On the moon there is none at all
       and the ground runs sharp all the way to a knife-edge horizon, which is
       the single thing that reads as vacuum. */
    fog.density = onMoon
      ? 0
      : inSpace
        ? lerp(0.0000045, 0.0000004, airless)
        : overcast
          ? 0.00006
          : lerp(0.000016, 0.0000075, high);
    /* Skylight.

       A directional sun on its own is a model of a world with no atmosphere,
       and at any elevation worth looking at — dawn, golden hour, dusk — it
       delivers almost nothing, which is why the farmland used to render as
       mud under a burning sky. What actually lights the ground at those hours
       is the whole dome above it. So the hemisphere light takes the sky's own
       colour and carries the load as the sun drops: warm and strong under a
       sunset, blue and low after dark, flat and bright under overcast. */
    const day = THREE.MathUtils.clamp((elevation + 5) / 22, 0, 1);
    if (onMoon) {
      // Vacuum. No sky, so no skylight: only the sun and what the regolith
      // bounces, which is the whole reason lunar shadows read as black.
      /* Vacuum: no sky, so the only fill is what the regolith bounces back at
         itself. Enough to keep a shadowed slope legible, not enough to stop
         lunar shadows reading as the hard-edged black they are. */
      ambient.intensity = 0.14;
      ambient.color.setHex(0x8e96a4);
      ambient.groundColor.setHex(0x6b6660);
    } else if (inSpace) {
      ambient.intensity = lerp(0.44, 0.2, airless);
      ambient.color.setHex(0x8fb6e8);
      ambient.groundColor.setHex(0x2c3a4e);
    } else {
      /* Pulled back toward neutral before it is used. A sunset tints what it
         lights; it does not dye it. Feeding the palette in at full chroma
         turned an airline-white fuselage the colour of the sky, which is the
         difference between golden hour and a colour cast. */
      skyTint.setStyle(skyState.palette.glow).lerp(WHITE, 0.52);
      groundTint.setStyle(skyState.palette.horizon).lerp(EARTH, 0.58);
      // Skylight bounced off open water is bluer than off stubble.
      if (seaBlend > 0) groundTint.lerp(SEA_TINT, seaBlend * 0.6);
      ambient.color.copy(skyTint);
      ambient.groundColor.copy(groundTint);
      ambient.intensity = overcast ? 0.95 : lerp(0.8, 0.46, day);
    }

    /* The exterior background moves as one slow, continuous diagonal toward
       the top-left. It is intentionally independent of the aircraft heading
       so banking or market movement cannot make the scenery reverse direction. */
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const groundSpeed = THREE.MathUtils.clamp(height * V_OVER_H, SPEED_FLOOR, SPEED_CAP);
    /* Nose to tail, whatever the heading. The aircraft is yawed by −heading,
       so its nose points along (sin h, 0, −cos h); the texture offsets and
       the cloud wrap below move features by −Δshift.x in x and +Δshift.z in
       z, so these signs send the ground the opposite way to the nose. Held
       fixed to the world instead, the flow only stayed nose-to-tail while
       the heading did — and the aircraft turns now, on purpose. */
    const hdg = THREE.MathUtils.degToRad(a.heading);
    shift.x += groundSpeed * Math.sin(hdg) * dt;
    shift.z += groundSpeed * Math.cos(hdg) * dt;

    /* The ground is one repeating plane, so flying over it is an offset. */
    const map = groundMat.map;
    if (map) {
      const tile = GROUND / map.repeat.x;
      map.offset.set(shift.x / tile, shift.z / tile);
      farmland.water.offset.copy(map.offset);
      /* The emissive map has to travel with the diffuse one to the pixel.
         Drifting them apart slides every town's lights off the town. */
      groundMat.emissiveMap?.offset.copy(map.offset);
      // The relief rides the same offset, so the hills go with their fields.
      farmland.height.offset.copy(map.offset);
      farmland.normal.offset.copy(map.offset);
      /* The sea rides the same shift — the coast must not slide against the
         fields while both are on screen mid-crossfade. */
      ocean.day.offset.copy(map.offset);
      ocean.night.offset.copy(map.offset);
      /* The glint slides a touch faster than the water it rides — two layers
         at two rates being the whole recipe for "liquid" — plus a slow
         breathing wobble so the sparkle lives even when the camera holds
         still. */
      const glintTile = GROUND / ocean.glint.repeat.x;
      ocean.glint.offset.set(
        (shift.x * 1.07) / glintTile + Math.sin(now * 0.00037) * 0.0006,
        (shift.z * 1.07) / glintTile + Math.cos(now * 0.00031) * 0.0006,
      );
      const sheenOn = seaBlend > 0.02 && !onMoon && !inSpace;
      sheen.visible = sheenOn;
      if (sheenOn) sheenMat.opacity = 0.4 * seaBlend * (0.2 + 0.8 * day);
    }

    /* The cloud deck sits at a fixed altitude; the aircraft climbs past it. */
    cloudDeckY = 2400;
    /* Even a clear day has fair-weather cumulus at this altitude, and without
       a few of them there is nothing between the aircraft and a horizon
       twenty kilometres off for the eye to clock movement against. */
    const cover = onMoon || inSpace ? 0 : Math.max(skyState.cloudCover, overcast ? 0.95 : 0.27);
    clouds.visible = cover > 0.05;
    if (clouds.visible) {
      cloudMat.opacity = 0.35 + cover * 0.55;
      /* Clouds are the most reflective thing in the scene, so they are the
         first thing to take the sun's colour: white at midday, furnace-orange
         on the deck at sunset, and barely blue after dark. Leaving them a flat
         white was the single loudest wrong note at golden hour — the ground
         and the sky both turned and the deck between them did not. */
      cloudTint.setStyle(skyState.palette.glow);
      const daylight = THREE.MathUtils.clamp((elevation + 6) / 26, 0, 1);
      cloudLit.setRGB(1, 1, 1).lerp(cloudTint, 1 - daylight * 0.72);
      // After sunset there is nothing lighting them at all.
      cloudLit.multiplyScalar(THREE.MathUtils.lerp(0.22, 1, daylight));
      // Overcast is its own flat grey, not a tinted cumulus deck.
      if (overcast) cloudLit.lerp(NEUTRAL_CLOUD, 0.55);
      cloudMat.color.copy(cloudLit);
      cloudCount = Math.floor(CLOUDS * cover);
      clouds.count = cloudCount;
    } else {
      cloudCount = 0;
    }

    /* Fly the aircraft. Pitch, bank and heading come from the flight model;
       height is the market cap. The camera then simply sits in it. */
    const lowSpeed = 1 - THREE.MathUtils.smoothstep(a.speed, 215, 245);
    const descent = THREE.MathUtils.smoothstep(-a.pitch, 6, 20);
    const climb = THREE.MathUtils.smoothstep(a.pitch, 8, 22) * 0.55;
    // Keep the control-surface cue visible but restrained; pitch and speed
    // should not make the exterior look as though the aircraft is landing.
    airframe.setFlapDeployment(
      manual.flaps ?? Math.max(lowSpeed, descent, climb) * 0.28,
    );

    /* Roll it by hand — and where that roll goes depends on where the camera
       is standing, because "the aeroplane is inverted" is two different
       pictures from two different places.

       From outside, it goes on the airframe alone. The exterior camera is a
       child of `aircraft`, so it rides the airframe: bank the whole group and
       the aeroplane sits still in frame while the horizon turns — which is
       what flying alongside something actually looks like, and exactly wrong
       for a switch labelled "invert". Rolling the model instead, which the
       camera is a sibling of rather than a passenger in, leaves the horizon
       where it was and turns the aeroplane over in front of it.

       From inside it goes on the camera, below, and the first attempt at that
       got it wrong in an instructive way. Rolling the whole `aircraft` group
       is what a passenger would actually experience — they go over *with* the
       cabin, so the seat in front is still in front and the only thing that
       changes is out of the window — and it is very nearly invisible: the
       cabin renders identically and the one thing that moves is a hand-sized
       rectangle of ground. Correct, and nobody would notice. Rolling the
       camera turns the whole shot over instead: the seat backs swing above
       the viewer, the ceiling comes up from below, and the ground still ends
       up over the sky outside.

       The market's own bank is deliberately not treated this way and stays on
       the group, which is why `useAttitude` keeps `bank` and `roll` apart: a
       two-degree lean should tilt the horizon past the window, not tip the
       furniture.

       Eased in `useAttitude` rather than here, so the horizon out of the
       cockpit and the lean of the hold — neither of which is a three.js
       scene — go over on exactly the same curve. */
    /* From outside, the bank goes on the model too — for the same reason
       the hand-flown roll always has. The exterior camera rides the
       aircraft group, so banking the group banked the camera with it: the
       aeroplane sat level in frame and only the horizon tilted, usually out
       of shot, and nobody could see the turn. With the group held level
       from out here, the wings visibly tip into every turn. */
    airframe.group.rotation.z = THREE.MathUtils.degToRad(pose.exterior ? a.roll - a.bank : 0);

    /* Fans, beacon, contrails. The contrail is the air's decision: none in
       the warm air low down, thin ones near the top of the weather, solid
       ribbons in the cold above the deck, thinning out again as the air
       itself runs out. */
    const contrail = onMoon
      ? 0
      : band.band === 'above-clouds'
        ? 1
        : inSpace
          ? Math.max(0, 1 - band.progress * 2.4) * 0.7
          : THREE.MathUtils.smoothstep(height, 2100, 2600) * 0.5;
    airframe.update(dt, contrail, groundSpeed, a.bank - a.roll);

    aircraft.position.set(0, height, 0);
    aircraft.rotation.set(
      THREE.MathUtils.degToRad(a.pitch),
      THREE.MathUtils.degToRad(-a.heading),
      THREE.MathUtils.degToRad(pose.exterior ? 0 : -a.bank),
    );
    // Keep the shadow camera centred on the aircraft rather than on ground
    // zero, so the wing, pylons and nacelles can shadow one another at every
    // altitude.
    sun.target.position.copy(aircraft.position);
    sun.target.updateMatrixWorld();

    if (pose.exterior) {
      /* Outside. The nose points down −z, so a camera out on +x looking back
         along −x puts the nose on the right of the frame, which is the way
         every side-on aircraft drawing has ever been oriented. The orbit
         swings that station around the aeroplane. */
      /* Parked off the starboard bow rather than dead abeam: side-on, a
         swept wing points straight at the camera and disappears, and the
         aeroplane reads as a tube with a fin. From the quarter the sweep,
         the dihedral and both engines are all in view, and the nose still
         leads to the right. */
      const a = THREE.MathUtils.degToRad((pose.orbit ?? 0) - 34);
      const radius = 38;
      // Raised to about sixteen degrees: level with the wing, a swept
      // planform is a line. From above it is a shape.
      extPos.set(Math.cos(a) * radius, 9.6, 11 + Math.sin(a) * radius);
      extTarget.set(0, 0.35, 10.8);
      extDir.copy(extTarget).sub(extPos);
      camera.position.copy(extPos);
      camera.rotation.set(
        Math.atan2(extDir.y, Math.hypot(extDir.x, extDir.z)),
        Math.atan2(-extDir.x, -extDir.z),
        0,
        'YXZ',
      );
      if (camera.fov !== 46) {
        camera.fov = 46;
        camera.updateProjectionMatrix();
      }
      renderer.toneMappingExposure = onMoon || inSpace ? 1.0 : 1.06;

      airframe.group.visible = true;
      // Sunlight from above, and the ground throwing light back at the belly —
      // without the bounce the underside goes black and the aeroplane reads as
      // a sticker rather than a solid.
      bounce.intensity = onMoon || inSpace ? 0.08 : overcast ? 0.85 : 0.5;
      bounce.color.copy(LAND_BOUNCE).lerp(SEA_BOUNCE, seaBlend);
      bounce.visible = true;
      cabin.group.visible = false;
      cabinLight.visible = false;
      cabinFill.intensity = 0;
      cabinAmbient.intensity = 0;
    } else {
      /* A seat is a place in the cabin, so looking around is looking around. */
      const interiorLightLevel = skyState.phase === 'night'
        ? 0.42
        : skyState.phase === 'astronomical'
          ? 0.58
          : skyState.phase === 'dusk' || skyState.phase === 'dawn'
            ? 0.82
            : 1;
      cabin.setViewer(pose.id);
      const x = pose.seatIndex === null ? 0 : CABIN.seatX[pose.seatIndex];
      const z = pose.seatIndex === null ? rowZ(1) - 4.2 : rowZ(pose.row);
      camera.position.set(x, CABIN.floorY + CABIN.eyeHeight, z + 0.02);
      cabinLight.position.set(x, CABIN.ceilingY - 0.3, z - 1.4);
      /* `YXZ`, so the roll is applied innermost — about the camera's own
         line of sight rather than about any world axis. Which is what makes
         it a roll of the shot and not a swing of the head. */
      camera.rotation.set(0, THREE.MathUtils.degToRad(-pose.yaw), THREE.MathUtils.degToRad(a.roll), 'YXZ');
      if (camera.fov !== 70) {
        camera.fov = 70;
        camera.updateProjectionMatrix();
      }
      renderer.toneMappingExposure = 0.85 * (skyState.phase === 'night' ? 0.78 : skyState.phase === 'astronomical' ? 0.88 : 1);

      airframe.group.visible = false;
      bounce.visible = false;
      cabin.group.visible = pose.seatIndex !== null;
      cabinLight.visible = pose.seatIndex !== null;
      cabinLight.intensity = 11 * interiorLightLevel;
      /* Mood lighting: after dark the cove washes toward the airline's calm
         blue, the way a night flight's cabin actually looks, and warms back
         up through dawn. */
      const nightMood = skyState.phase === 'night'
        ? 1
        : skyState.phase === 'astronomical'
          ? 0.7
          : skyState.phase === 'dusk' || skyState.phase === 'dawn'
            ? 0.35
            : 0;
      cabinLight.color.copy(CABIN_WARM).lerp(MOOD_BLUE, nightMood * 0.5);
      cabinLamps.forEach(({ light, intensity, colour }) => {
        light.intensity = intensity * interiorLightLevel;
        light.color.copy(colour).lerp(MOOD_BLUE, nightMood * 0.5);
      });
      cabinFill.intensity = pose.seatIndex !== null ? 0.45 * interiorLightLevel : 0;
      cabinAmbient.intensity = pose.seatIndex !== null ? 0.32 * interiorLightLevel : 0;
    }

    // Clouds are world objects while the camera rides in the rotating
    // aircraft. Billboard them from its *world* orientation only after the
    // pose is final; using camera.local quaternion here makes them turn edge
    // on during a bank or heading change.
    if (clouds.visible) {
      cloudUpdateClock += dt;
      if (cloudUpdateClock >= 1 / 30) {
        cloudUpdateClock = 0;
        aircraft.updateMatrixWorld(true);
        camera.getWorldQuaternion(dummy.quaternion);
        for (let i = 0; i < cloudCount; i++) {
          const c = cloudSeeds[i];
          dummy.position.set(
            wrap(c.x - shift.x),
            cloudDeckY + c.y,
            wrap(c.z + shift.z),
          );
          dummy.scale.set(c.s, c.s * 0.55, 1);
          dummy.updateMatrix();
          clouds.setMatrixAt(i, dummy.matrix);
        }
        clouds.instanceMatrix.needsUpdate = true;
      }
    }

    const frameStart = performance.now();
    renderer.render(scene, camera);
    frameTimeTotal += performance.now() - frameStart;
    frameSamples += 1;
    frameClock += dt;
    if (frameClock >= 1 && frameSamples >= 20) {
      const averageMs = frameTimeTotal / frameSamples;
      if (averageMs > 24 && pixelRatio > minPixelRatio) {
        pixelRatio = Math.max(minPixelRatio, pixelRatio - 0.1);
        renderer.setPixelRatio(pixelRatio);
      } else if (averageMs < 15 && pixelRatio < maxPixelRatio) {
        pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.1);
        renderer.setPixelRatio(pixelRatio);
      }
      frameClock = 0;
      frameSamples = 0;
      frameTimeTotal = 0;
    }
  };

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  /* Where the hand-flying switches are, and where the roll has got to.

     Both live out here rather than in `render`, because the easing above has
     to pick up between frames: an aeroplane halfway through a barrel roll is
     a number this scene is carrying, not one it can be handed. */
  let manual: ManualControls = HANDS_OFF;
  const setControls = (controls: ManualControls) => { manual = controls; };

  const setOccupancy = (taken: ReadonlySet<string>) => {
    cabin.setOccupancy(taken);
    // A window lit from outside is a row somebody has genuinely booked.
    const rows = new Set<number>();
    for (const id of taken) {
      const n = parseInt(id, 10);
      if (Number.isFinite(n)) rows.add(n);
    }
    airframe.setRowsLit((row) => rows.has(row));
  };

  /** Ground metres travelled, for the instrumentation the review pass reads. */
  const travelled = () => Math.hypot(shift.x, shift.z);

  const dispose = () => {
    cabin.dispose();
    airframe.dispose();
    farmland.day.dispose();
    farmland.night.dispose();
    farmland.water.dispose();
    farmland.height.dispose();
    farmland.normal.dispose();
    nearGeometry.dispose();
    nearMat.dispose();
    ocean.day.dispose();
    ocean.night.dispose();
    ocean.glint.dispose();
    seaMat.dispose();
    sheenMat.dispose();
    envRT.dispose();
    moon.dispose();
    puff.dispose();
    ground.geometry.dispose();
    groundMat.dispose();
    limb.geometry.dispose();
    (limb.material as THREE.Material).dispose();
    limbAir.geometry.dispose();
    (limbAir.material as THREE.Material).dispose();
    planetTex.dispose();
    clouds.geometry.dispose();
    cloudMat.dispose();
    starGeo.dispose();
    starMat.dispose();
    sunDisc.material.map?.dispose();
    sunDisc.material.dispose();
    sunGlow.material.map?.dispose();
    sunGlow.material.dispose();
    earth.geometry.dispose();
    (earth.material as THREE.Material).dispose();
    earthMap.dispose();
    earthAir.geometry.dispose();
    (earthAir.material as THREE.Material).dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    renderer.dispose();
  };

  return { render, resize, setOccupancy, setAdverts: cabin.setAdverts, setControls, travelled, dispose };
}
