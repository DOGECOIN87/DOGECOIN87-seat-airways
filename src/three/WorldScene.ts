import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cloudTexture, earthTexture, farmlandTexture, moonTexture, radialTexture } from './terrain';
import type { SkyState } from '../lib/sky';
import type { BandState } from '../lib/flightModel';
import type { Attitude } from '../lib/useAttitude';
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

const GROUND = 60000;

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
  /** Metres of ground covered since the view opened. */
  travelled: () => number;
  dispose: () => void;
}

export function createWorld(canvas: HTMLCanvasElement): WorldHandles {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // The scene spans a window a few centimetres from the camera through a
    // sky dome 160 km away. Log depth keeps window glass and the exterior
    // livery from z-fighting at that range.
    logarithmicDepthBuffer: true,
    // Lets the canvas be read back after a frame, which is how the view gets
    // captured for review; the cost is negligible at this scene's size.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  /* The aeroplane itself, for when the camera is outside it. */
  const airframe = createAirframe();
  airframe.group.visible = false;
  aircraft.add(airframe.group);

  /* Cabin lighting. A tube blocks the sun, and there is no bounce in here. */
  const cabinLight = new THREE.PointLight(0xffd8a8, 11, 10, 2);
  aircraft.add(cabinLight);
  const cabinFill = new THREE.HemisphereLight(0xdcebff, 0xd6c9b2, 0.45);
  const cabinAmbient = new THREE.AmbientLight(0xdfd6c4, 0.32);
  aircraft.add(cabinAmbient);
  aircraft.add(cabinFill);

  /* ── Sky ─────────────────────────────────────────────────────────────
     Preetham scattering. Turbidity and the Mie term carry the weather:
     clear air is thin and blue, overcast is thick and grey. */
  const sky = new Sky();
  sky.scale.setScalar(160000);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU.rayleigh.value = 2.2;
  skyU.mieCoefficient.value = 0.005;
  skyU.mieDirectionalG.value = 0.8;

  const sunPos = new THREE.Vector3();
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
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
    tmpStar.multiplyScalar(120000);
    starPos.set([tmpStar.x, Math.abs(tmpStar.y) * 0.9, tmpStar.z], i * 3);

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
    size: 300,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    vertexColors: true,
    // Additive, so overlapping stars in the galactic band build into a haze
    // rather than flatly occluding one another.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
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
  const farmland = farmlandTexture();
  const moon = moonTexture();
  farmland.repeat.set(11, 11);
  moon.repeat.set(12, 12);
  const groundMat = new THREE.MeshStandardMaterial({ map: farmland, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

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
  const CLOUDS = 520;
  const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, CLOUDS);
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cloudSeeds: { x: number; z: number; y: number; s: number }[] = [];
  for (let i = 0; i < CLOUDS; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 400 + Math.sqrt(Math.random()) * 22000;
    cloudSeeds.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      y: (Math.random() - 0.5) * 340,
      s: 900 + Math.random() * 2400,
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
  const cloudTint = new THREE.Color();
  const cloudLit = new THREE.Color();
  const NEUTRAL_CLOUD = new THREE.Color(0xb9c2cf);
  let cloudDeckY = 2400;
  let cloudCount = 0;

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
  const wrap = (v: number) => ((((v + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2;

  const render = (a: Attitude, skyState: SkyState, band: BandState, pose: ViewPose) => {
    const inSpace = band.band === 'space';
    const onMoon = band.band === 'moon';

    /* Camera height from the altitude band, log-spaced within it. */
    const [lo, hi] = ALTITUDE[band.band];
    const height = lerp(lo, hi, band.progress);

    /* Sun from the real solar position: elevation from the clock and the
       latitude, azimuth swung across the sky by the hour. */
    const elevation = onMoon || inSpace ? 14 : skyState.elevation;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(skyState.sunX * 80);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU.sunPosition.value.copy(sunPos);
    sun.position.copy(sunPos).multiplyScalar(100000);
    sun.intensity = onMoon || inSpace ? 3.4 : Math.max(0.05, Math.sin(THREE.MathUtils.degToRad(Math.max(elevation, -6))) * 3);

    /* Weather thickens the air; altitude thins it out again. */
    const overcast = skyState.weather === 'overcast' || skyState.weather === 'fog';
    const rain = skyState.weather === 'rain' || skyState.weather === 'storm';
    const thin = inSpace ? 1 - band.progress * 0.9 : 1;
    skyU.turbidity.value = (overcast ? 14 : rain ? 10 : 3.2) * thin;
    skyU.rayleigh.value = (overcast ? 0.6 : 2.4) * thin;
    skyU.mieCoefficient.value = (overcast ? 0.03 : 0.005) * thin;
    sky.visible = !onMoon;

    /* Above the atmosphere the sky is simply gone, and the stars arrive. */
    const starOpacity = onMoon ? 1 : inSpace ? Math.min(1, 0.25 + band.progress) : Math.max(0, skyState.palette.stars - 0.35);
    starMat.opacity = starOpacity;
    renderer.setClearColor(onMoon || (inSpace && band.progress > 0.5) ? 0x000000 : 0x000814, 1);

    /* The sun becomes an object once there is no air left to scatter it. The
       Sky shader draws its own below that, so showing both would double it. */
    const sunVisibility = onMoon ? 1 : inSpace ? Math.min(1, band.progress * 1.6) : 0;
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
       with distance so the horizon dissolves rather than ending. */
    if (onMoon && groundMat.map !== moon) { groundMat.map = moon; groundMat.needsUpdate = true; }
    if (!onMoon && groundMat.map !== farmland) { groundMat.map = farmland; groundMat.needsUpdate = true; }
    ground.visible = !inSpace || band.progress < 0.6;

    skyColour.setStyle(skyState.palette.horizon);
    fog.color.copy(onMoon ? new THREE.Color(0x000000) : skyColour);
    fog.density = onMoon ? 0.0000015 : inSpace ? 0.0000009 : overcast ? 0.00006 : 0.000016;
    ambient.intensity = onMoon || inSpace ? 0.12 : overcast ? 0.75 : 0.55;

    /* Advance along the heading. Airspeed is in knots; the altitude term
       keeps the angular rate — and so the sense of speed — constant. */
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const hRad = THREE.MathUtils.degToRad(a.heading);
    const metresPerSecond = a.speed * 0.5144 * 1.9 * Math.max(1, height / 900);
    shift.x += Math.sin(hRad) * metresPerSecond * dt;
    shift.z += Math.cos(hRad) * metresPerSecond * dt;

    /* The ground is one repeating plane, so flying over it is an offset. */
    const map = groundMat.map;
    if (map) {
      const tile = GROUND / map.repeat.x;
      map.offset.set(shift.x / tile, shift.z / tile);
    }

    /* The cloud deck sits at a fixed altitude; the aircraft climbs past it. */
    cloudDeckY = 2400;
    const cover = onMoon || inSpace ? 0 : Math.max(skyState.cloudCover, overcast ? 0.95 : 0.12);
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
    aircraft.position.set(0, height, 0);
    aircraft.rotation.set(
      THREE.MathUtils.degToRad(a.pitch),
      THREE.MathUtils.degToRad(-a.heading),
      THREE.MathUtils.degToRad(-a.bank),
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
      bounce.visible = true;
      cabin.group.visible = false;
      cabinLight.visible = false;
      cabinFill.intensity = 0;
      cabinAmbient.intensity = 0;
    } else {
      /* A seat is a place in the cabin, so looking around is looking around. */
      cabin.setViewer(pose.id);
      const x = pose.seatIndex === null ? 0 : CABIN.seatX[pose.seatIndex];
      const z = pose.seatIndex === null ? rowZ(1) - 4.2 : rowZ(pose.row);
      camera.position.set(x, CABIN.floorY + CABIN.eyeHeight, z + 0.02);
      cabinLight.position.set(x, CABIN.ceilingY - 0.3, z - 1.4);
      camera.rotation.set(0, THREE.MathUtils.degToRad(-pose.yaw), 0, 'YXZ');
      if (camera.fov !== 70) {
        camera.fov = 70;
        camera.updateProjectionMatrix();
      }
      renderer.toneMappingExposure = 0.85;

      airframe.group.visible = false;
      bounce.visible = false;
      cabin.group.visible = pose.seatIndex !== null;
      cabinLight.visible = pose.seatIndex !== null;
      cabinFill.intensity = pose.seatIndex !== null ? 0.45 : 0;
      cabinAmbient.intensity = pose.seatIndex !== null ? 0.32 : 0;
    }

    // Clouds are world objects while the camera rides in the rotating
    // aircraft. Billboard them from its *world* orientation only after the
    // pose is final; using camera.local quaternion here makes them turn edge
    // on during a bank or heading change.
    if (clouds.visible) {
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

    renderer.render(scene, camera);
  };

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

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
    farmland.dispose();
    moon.dispose();
    puff.dispose();
    ground.geometry.dispose();
    groundMat.dispose();
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

  return { render, resize, setOccupancy, travelled, dispose };
}
