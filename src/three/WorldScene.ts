import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cloudTexture, farmlandTexture, moonTexture } from './terrain';
import type { SkyState } from '../lib/sky';
import type { BandState } from '../lib/flightModel';
import type { Attitude } from '../lib/useAttitude';
import { CABIN, createCabin, rowZ } from './cabin';

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
    // Lets the canvas be read back after a frame, which is how the view gets
    // captured for review; the cost is negligible at this scene's size.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200000);

  /* The aircraft carries the cabin and the camera; the world does not move. */
  const aircraft = new THREE.Group();
  aircraft.rotation.order = 'YXZ';
  scene.add(aircraft);

  const cabin = createCabin();
  aircraft.add(cabin.group);
  aircraft.add(camera);

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
  scene.add(sun);
  const ambient = new THREE.HemisphereLight(0xbfd8ff, 0x4a5c3a, 0.55);
  scene.add(ambient);

  /* ── Stars, for when the air runs out ── */
  const starGeo = new THREE.BufferGeometry();
  const starCount = 2200;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(120000);
    starPos.set([v.x, Math.abs(v.y) * 0.9, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 260, sizeAttenuation: true, transparent: true, opacity: 0 }),
  );
  scene.add(stars);

  /* ── Ground ── */
  const farmland = farmlandTexture();
  const moon = moonTexture();
  farmland.repeat.set(19, 19);
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
  const skyColour = new THREE.Color();
  let cloudDeckY = 2400;

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
    (stars.material as THREE.PointsMaterial).opacity = starOpacity;
    renderer.setClearColor(onMoon || (inSpace && band.progress > 0.5) ? 0x000000 : 0x000814, 1);

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
      const shown = Math.floor(CLOUDS * cover);
      clouds.count = shown;
      for (let i = 0; i < shown; i++) {
        const c = cloudSeeds[i];
        dummy.position.set(
          wrap(c.x - shift.x),
          cloudDeckY + c.y,
          wrap(c.z + shift.z),
        );
        dummy.scale.set(c.s, c.s * 0.55, 1);
        dummy.quaternion.copy(camera.quaternion); // billboard
        dummy.updateMatrix();
        clouds.setMatrixAt(i, dummy.matrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
    }

    /* Fly the aircraft. Pitch, bank and heading come from the flight model;
       height is the market cap. The camera then simply sits in it. */
    aircraft.position.set(0, height, 0);
    aircraft.rotation.set(
      THREE.MathUtils.degToRad(a.pitch),
      THREE.MathUtils.degToRad(-a.heading),
      THREE.MathUtils.degToRad(-a.bank),
    );

    /* A seat is a place in the cabin, so looking around is looking around. */
    cabin.setViewer(pose.id);
    const x = pose.seatIndex === null ? 0 : CABIN.seatX[pose.seatIndex];
    const z = pose.seatIndex === null ? rowZ(1) - 4.2 : rowZ(pose.row);
    camera.position.set(x, CABIN.floorY + CABIN.eyeHeight, z + 0.02);
    cabinLight.position.set(x, CABIN.ceilingY - 0.3, z - 1.4);
    camera.rotation.set(0, THREE.MathUtils.degToRad(-pose.yaw), 0, 'YXZ');

    cabin.group.visible = pose.seatIndex !== null;
    cabinLight.visible = pose.seatIndex !== null;
    cabinFill.intensity = pose.seatIndex !== null ? 0.45 : 0;
    cabinAmbient.intensity = pose.seatIndex !== null ? 0.32 : 0;

    renderer.render(scene, camera);
  };

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  const setOccupancy = (taken: ReadonlySet<string>) => cabin.setOccupancy(taken);

  /** Ground metres travelled, for the instrumentation the review pass reads. */
  const travelled = () => Math.hypot(shift.x, shift.z);

  const dispose = () => {
    cabin.dispose();
    farmland.dispose();
    moon.dispose();
    puff.dispose();
    ground.geometry.dispose();
    groundMat.dispose();
    clouds.geometry.dispose();
    cloudMat.dispose();
    starGeo.dispose();
    (stars.material as THREE.PointsMaterial).dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    renderer.dispose();
  };

  return { render, resize, setOccupancy, travelled, dispose };
}
