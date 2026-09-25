import * as THREE from 'three';

/**
 * The aeroplane's own lights, and the light they throw.
 *
 * An airliner at night is not a lit object so much as a pattern of lights:
 * a row of warm windows, a steady red lamp on the left wingtip and a green
 * one on the right, a white one on the tail, white strobes double-flashing
 * at all three, a red beacon pulsing on the crown and another under the
 * belly, and the logo lights washing up the fin. Each of those is here,
 * where an A320 carries it and to its rhythm.
 *
 * Two halves:
 *
 *   The glare. What a camera records of a small bright source is mostly not
 *   the source but the bloom around it. One camera-facing sprite per lamp
 *   and per window, all in one draw call, sized in metres so it scales with
 *   distance — and dark when the source faces away (a navigation lamp is
 *   only visible from its own sector) or when the fuselage is in the way.
 *
 *   The light. The same lamps light the airframe: a strobe lights up its
 *   own wingtip, the beacon paints the crown red on every pulse, the logo
 *   lights pool up the fin, and the windows over the wing throw the cabin's
 *   light onto its root. They are added to the airframe's own materials and
 *   shaded by three's own physical BRDF, like any other light — but only
 *   there, so twelve kilometres of terrain never pays for a wingtip lamp.
 *
 * After dark the airframe also stops being lit like noon. The skylight and
 * the environment reflection that carry it by day fall away, and a cool
 * moonlight from overhead keeps its shape readable — so the lights have a
 * dark aeroplane to show up against, which is the whole look of one at night.
 */

export type LampKind = 'nav' | 'strobe' | 'beacon' | 'logo';

/** A direction, and the cosine of the angle off it where something stops. */
export interface Cone {
  axis: THREE.Vector3;
  edge: number;
}

export interface LampSpec {
  kind: LampKind;
  /** Where the lens is, in the airframe's own metres. */
  at: THREE.Vector3;
  /** The colour it throws, as a hex. */
  colour: number;
  /** Where the lens can be seen from. Omitted, everywhere. */
  seen?: Cone;
  /** Where its light goes, if it is a spot. Omitted, all round. */
  beam?: Cone;
  /** Seconds into its cycle: the two beacons take turns. */
  phase?: number;
  /** The lens: its radius, and its colour unlit. */
  bead: number;
  lens: number;
}

/** The hour, as the lights need it. */
export interface LampLight {
  /** 0 by day to 1 after dark, outside. */
  night: number;
  /** How far up the cabin lights are, from the cabin's `cabinLevel`. */
  cabin: number;
  /** How far the cabin has gone over to its night blue. */
  mood: number;
  /** The visitor asked for less motion. */
  calm: boolean;
}

/** A cabin window, as the outside world sees it. */
export interface WindowSpot {
  /** Centre of the glass, airframe space. */
  at: THREE.Vector3;
  /** The way it faces. */
  out: THREE.Vector3;
  row: number;
  side: 1 | -1;
}

/** The run of windows down one side, as a single strip of light. */
export interface WindowRow {
  from: THREE.Vector3;
  to: THREE.Vector3;
  out: THREE.Vector3;
}

export interface LampRig {
  /** The lenses and the glare, for the airframe to carry. */
  group: THREE.Group;
  /** Let the lamps, the windows and the moon light an airframe material. */
  light(material: THREE.Material): void;
  /** Light the rows somebody has booked. */
  setRowsLit(isLit: (row: number) => boolean): void;
  /** Advance the flashers and follow the hour. */
  update(dt: number, light: LampLight): void;
  /** Put the lights where the camera sees them. Call after the pose is final. */
  place(camera: THREE.Camera, airframe: THREE.Object3D): void;
  dispose(): void;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

/* ── Rhythm ───────────────────────────────────────────────────────────────
   The strobes are Airbus's: a double flash, two short bursts a beat apart,
   about fifty times a minute, all three lamps together. The beacons are a
   single softer pulse a little slower, top and bottom taking turns. */
export const STROBE_CYCLE = 1.2;
const strobe = (t: number) => {
  const p = mod(t, STROBE_CYCLE);
  return p < 0.05 || (p >= 0.13 && p < 0.18) ? 1 : 0;
};
export const BEACON_CYCLE = 1.1;
const beacon = (t: number) => {
  const p = mod(t, BEACON_CYCLE);
  if (p < 0.03) return p / 0.03;
  if (p < 0.11) return 1;
  if (p < 0.27) return 1 - (p - 0.11) / 0.16;
  return 0;
};
/* A 50 ms flash is shorter than a slow frame, so a flasher is read over the
   whole of the frame it falls in rather than at one instant — sampled finer
   than the flash is long, so no burst is ever stepped over. */
const across = (f: (t: number) => number, t: number, dt: number) =>
  Math.max(f(t), f(t - dt / 3), f(t - (2 * dt) / 3), f(t - dt));
/* Asked for less motion, the flashers keep their places and their colours
   but swell and fade on a slow breath instead of firing. */
const swell = (t: number, cycle: number) => Math.pow(Math.sin((Math.PI * mod(t, cycle)) / cycle), 8);

/* How strongly each kind lights the airframe, and how much of that survives
   daylight. By day the sun is doing the lighting and a lamp beside it is
   close to nothing, which is what the fraction stands in for. */
const POWER: Record<LampKind, { power: number; day: number }> = {
  nav: { power: 3.2, day: 0.3 },
  strobe: { power: 34, day: 0.5 },
  beacon: { power: 11, day: 0.4 },
  logo: { power: 30, day: 0 },
};
/* The glare, as [strength, size in metres], by day and after dark. Strobes
   are made to be seen in sunshine, so theirs stays; the rest mostly go. */
const GLARE: Record<LampKind, { day: [number, number]; night: [number, number] }> = {
  nav: { day: [0.35, 0.5], night: [1.3, 1.7] },
  strobe: { day: [1.8, 2.2], night: [3, 5.5] },
  beacon: { day: [0.9, 1], night: [2, 3] },
  logo: { day: [0, 0], night: [0.6, 0.55] },
};
/* The cabin's light, from outside: warm, a touch cooler late at night when
   the cabin itself has gone over to its mood lighting. */
const CABIN_WARM = new THREE.Color(0xffd8a8);
const MOOD = new THREE.Color(0xa9c6ea);
const READING = new THREE.Color(0xffc98a);
/** Where the moon hangs, in the world: high, and off the port quarter. */
const MOON_DIR = new THREE.Vector3(-0.42, 0.8, 0.43).normalize();
const MOON = new THREE.Color(0x8ea3c8);

const GLARE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 lampAt;
attribute vec4 lampGlow;
attribute vec4 lampAim;
varying vec3 vGlow;
varying vec2 vQuad;
void main() {
  vec4 mv = modelViewMatrix * vec4( lampAt, 1.0 );
  vec3 toEye = normalize( -mv.xyz );
  float facing = 1.0;
  if ( lampAim.w > -1.5 ) {
    vec3 axis = normalize( normalMatrix * lampAim.xyz );
    facing = smoothstep( lampAim.w - 0.1, lampAim.w + 0.15, dot( axis, toEye ) );
  }
  vGlow = lampGlow.rgb * facing;
  vQuad = position.xy;
  float size = facing > 0.001 ? lampGlow.a : 0.0;
  // Drawn a little toward the eye, so the skin a lamp is mounted on cannot
  // slice its glare in half. Anything really in the way is still in the way.
  mv.xyz += toEye * min( size * 0.35, 1.0 );
  mv.xy += position.xy * size * 0.5;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const GLARE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vGlow;
varying vec2 vQuad;
void main() {
  #include <logdepthbuf_fragment>
  float r2 = dot( vQuad, vQuad );
  if ( r2 >= 1.0 ) discard;
  // A hot core, which is the lens, in a wide soft skirt, which is the air
  // and the optics around it.
  float glare = exp( - r2 * 30.0 ) * 1.6 + pow( 1.0 - r2, 4.0 ) * 0.28;
  gl_FragColor = vec4( vGlow * glare, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* The lamps, the window strips and the moon, shaded as direct lights after
   three has done its own, and the skylight scaled back for the hour. */
function lampPars(count: number): string {
  return /* glsl */ `
#define AF_LAMPS ${count}
uniform vec3 afLampPos[ AF_LAMPS ];
uniform vec3 afLampRad[ AF_LAMPS ];
uniform vec4 afLampAim[ AF_LAMPS ];
uniform vec3 afRowA[ 2 ];
uniform vec3 afRowB[ 2 ];
uniform vec3 afRowOut[ 2 ];
uniform vec4 afRowLit[ 4 ];
uniform vec3 afRowRad;
uniform vec3 afMoonDir;
uniform vec3 afMoonRad;
uniform float afSkylight;
// How lit the windows are around a point along one side, 0 at the front row
// to 1 at the back: eight samples, blended.
float afRowDensity( int side, float t ) {
  float x = clamp( t, 0.0, 1.0 ) * 7.0;
  int i = int( floor( x ) );
  int j = min( i + 1, 7 );
  float a = afRowLit[ side * 2 + i / 4 ][ i - ( i / 4 ) * 4 ];
  float b = afRowLit[ side * 2 + j / 4 ][ j - ( j / 4 ) * 4 ];
  return mix( a, b, fract( x ) );
}
`;
}

const LAMP_LIGHTING = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= afSkylight;
reflectedLight.indirectSpecular *= afSkylight;
{
  IncidentLight afLight;
  afLight.visible = true;
  for ( int i = 0; i < AF_LAMPS; i ++ ) {
    vec3 rad = afLampRad[ i ];
    if ( rad.r + rad.g + rad.b < 1e-4 ) continue;
    vec3 toLamp = afLampPos[ i ] - geometryPosition;
    float d2 = dot( toLamp, toLamp );
    afLight.direction = toLamp * inversesqrt( d2 );
    vec4 aim = afLampAim[ i ];
    float beam = aim.w < -1.5 ? 1.0 : smoothstep( aim.w, aim.w + 0.1, dot( - afLight.direction, aim.xyz ) );
    afLight.color = rad * beam / ( d2 + 0.25 );
    RE_Direct( afLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
  if ( afRowRad.r + afRowRad.g + afRowRad.b > 1e-4 ) {
    for ( int s = 0; s < 2; s ++ ) {
      vec3 run = afRowB[ s ] - afRowA[ s ];
      float t = clamp( dot( geometryPosition - afRowA[ s ], run ) / dot( run, run ), 0.0, 1.0 );
      vec3 toRow = afRowA[ s ] + run * t - geometryPosition;
      float d2 = max( dot( toRow, toRow ), 1e-4 );
      afLight.direction = toRow * inversesqrt( d2 );
      // A window shines out of the side, not along the skin it is set in.
      float outward = max( dot( - afLight.direction, afRowOut[ s ] ), 0.0 );
      afLight.color = afRowRad * afRowDensity( s, t ) * outward / ( d2 + 0.35 );
      RE_Direct( afLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
  }
  if ( afMoonRad.r + afMoonRad.g + afMoonRad.b > 1e-4 ) {
    afLight.direction = afMoonDir;
    afLight.color = afMoonRad;
    RE_Direct( afLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
`;

/** A seeded 0–1 for a window, so the same window keeps its own glow. */
const hash = (row: number, side: number) => {
  const s = Math.sin(row * 127.1 + side * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function createLampRig(
  lamps: LampSpec[],
  windows: WindowSpot[],
  rows: [WindowRow, WindowRow],
  glass: THREE.InstancedMesh,
  blocked: (from: THREE.Vector3, to: THREE.Vector3) => boolean,
): LampRig {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const W = windows.length;
  const L = lamps.length;

  /* ── Lenses ──────────────────────────────────────────────────────────── */
  const beads = lamps.map((lamp) => {
    const lens = new THREE.Color(lamp.lens);
    const glow = new THREE.Color(lamp.colour);
    const material = new THREE.MeshStandardMaterial({
      color: lens, emissive: glow, emissiveIntensity: 0, roughness: 0.25,
    });
    const geometry = new THREE.SphereGeometry(lamp.bead, 14, 10);
    disposables.push(material, geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(lamp.at);
    group.add(mesh);
    return material;
  });

  /* ── Glare ───────────────────────────────────────────────────────────── */
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const at = new Float32Array((W + L) * 3);
  const aim = new Float32Array((W + L) * 4);
  const glow = new Float32Array((W + L) * 4);
  windows.forEach((w, i) => {
    at.set([w.at.x, w.at.y, w.at.z], i * 3);
    // Past about eighty degrees off its face a window is edge-on and gone.
    aim.set([w.out.x, w.out.y, w.out.z, 0.2], i * 4);
  });
  lamps.forEach((lamp, i) => {
    const n = W + i;
    at.set([lamp.at.x, lamp.at.y, lamp.at.z], n * 3);
    if (lamp.seen) aim.set([lamp.seen.axis.x, lamp.seen.axis.y, lamp.seen.axis.z, lamp.seen.edge], n * 4);
    else aim.set([0, 0, 0, -2], n * 4);
  });
  quad.setAttribute('lampAt', new THREE.InstancedBufferAttribute(at, 3));
  quad.setAttribute('lampAim', new THREE.InstancedBufferAttribute(aim, 4));
  const glowAttr = new THREE.InstancedBufferAttribute(glow, 4);
  glowAttr.setUsage(THREE.DynamicDrawUsage);
  quad.setAttribute('lampGlow', glowAttr);
  quad.instanceCount = W + L;
  const glareMat = new THREE.ShaderMaterial({
    vertexShader: GLARE_VERTEX,
    fragmentShader: GLARE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(quad, glareMat);
  const glare = new THREE.Mesh(quad, glareMat);
  // Its bounds are one small quad at the origin; the sprites are everywhere.
  glare.frustumCulled = false;
  glare.renderOrder = 3;
  group.add(glare);

  /* ── The light on the airframe ─────────────────────────────────────── */
  const uniforms = {
    afLampPos: { value: lamps.map(() => new THREE.Vector3()) },
    afLampRad: { value: lamps.map(() => new THREE.Vector3()) },
    afLampAim: { value: lamps.map(() => new THREE.Vector4(0, 0, 0, -2)) },
    afRowA: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    afRowB: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    afRowOut: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    afRowLit: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    afRowRad: { value: new THREE.Vector3() },
    afMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    afMoonRad: { value: new THREE.Vector3() },
    afSkylight: { value: 1 },
  };
  const pars = lampPars(L);
  const light = (material: THREE.Material) => {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${pars}`)
        .replace('#include <lights_fragment_end>', LAMP_LIGHTING);
    };
    material.customProgramCacheKey = () => `sa-lamps-${L}`;
    material.needsUpdate = true;
  };

  /* ── Windows ─────────────────────────────────────────────────────────
     The glass is lit from behind: its instance colour is the light coming
     through it, black where nobody is sitting, and it is emission rather
     than paint — so it glows at night and, by day, is dark glass with
     only a hint of the cabin behind it, as it is from outside. */
  const glassMat = glass.material as THREE.MeshStandardMaterial;
  glassMat.emissive.setRGB(1, 1, 1);
  glassMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
  };
  glassMat.customProgramCacheKey = () => 'sa-glazing';
  glassMat.needsUpdate = true;
  /* Every window its own: a little brighter or dimmer where a blind is half
     down, and one in five warmer, where somebody has a reading light on. */
  const tone = windows.map((w) => {
    const h = hash(w.row, w.side);
    return { bright: 0.72 + 0.28 * hash(w.row + 17, -w.side), reading: h < 0.2 };
  });
  let lit: boolean[] = windows.map(() => false);
  const rowLit = [new Float32Array(8), new Float32Array(8)];
  const cabinLight = new THREE.Color();
  const pane = new THREE.Color();
  let paneMood = -1;
  const paintPanes = (mood: number) => {
    paneMood = mood;
    cabinLight.copy(CABIN_WARM).lerp(MOOD, 0.3 * mood);
    windows.forEach((_, i) => {
      if (lit[i]) pane.copy(tone[i].reading ? READING : cabinLight).multiplyScalar(tone[i].bright);
      else pane.setRGB(0, 0, 0);
      glass.setColorAt(i, pane);
    });
    if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
  };
  const setRowsLit = (isLit: (row: number) => boolean) => {
    lit = windows.map((w) => isLit(w.row));
    /* The strip of light each side throws: the lit fraction of the windows
       around each of eight points down the cabin, so the wing root is lit
       by the rows actually beside it. */
    const first = Math.min(...windows.map((w) => w.row));
    const last = Math.max(...windows.map((w) => w.row));
    for (const [s, side] of ([[0, 1], [1, -1]] as const)) {
      for (let k = 0; k < 8; k++) {
        const centre = first + ((last - first) * k) / 7;
        let sum = 0;
        let weight = 0;
        windows.forEach((w, i) => {
          if (w.side !== side) return;
          const g = Math.exp(-(((w.row - centre) / 2.5) ** 2));
          sum += (lit[i] ? tone[i].bright : 0) * g;
          weight += g;
        });
        rowLit[s][k] = weight > 0 ? sum / weight : 0;
      }
    }
    uniforms.afRowLit.value.forEach((v, n) => {
      const s = n < 2 ? 0 : 1;
      const k = (n % 2) * 4;
      v.set(rowLit[s][k], rowLit[s][k + 1], rowLit[s][k + 2], rowLit[s][k + 3]);
    });
    paintPanes(Math.max(0, paneMood));
  };

  /* ── Time ──────────────────────────────────────────────────────────── */
  let clock = Math.random() * 10;
  let lastDt = 0;
  let dark = 0;
  /* How bright the glass is: the cabin's own level, over what the eye makes
     of it. By day the sky outshines any cabin and the windows read as dark
     glass; after dark even a cabin dimmed for the night glows. */
  let paneGlow = 0;
  const level = new Float32Array(L);
  const seen = new Float32Array(L).fill(1);
  const update = (dt: number, { night, cabin, mood, calm }: LampLight) => {
    clock += dt;
    lastDt = dt;
    dark = night;
    paneGlow = cabin * THREE.MathUtils.lerp(0.22, 4.6, night);
    // The logo lights go on as it gets dark, as a crew would switch them.
    const logoOn = THREE.MathUtils.smoothstep(night, 0.35, 0.75);
    lamps.forEach((lamp, i) => {
      const t = clock + (lamp.phase ?? 0);
      level[i] = lamp.kind === 'nav'
        ? 1
        : lamp.kind === 'logo'
          ? logoOn
          : calm
            ? 0.45 * swell(t, lamp.kind === 'strobe' ? STROBE_CYCLE * 2 : BEACON_CYCLE * 2)
            : across(lamp.kind === 'strobe' ? strobe : beacon, t, dt);
      const bead = beads[i];
      bead.emissiveIntensity = lamp.kind === 'nav'
        ? 2.6
        : lamp.kind === 'logo'
          ? 2.2 * logoOn
          : (lamp.kind === 'strobe' ? 0.02 : 0.16) + (lamp.kind === 'strobe' ? 7 : 3.6) * level[i];
    });
    if (Math.abs(mood - paneMood) > 0.01) paintPanes(mood);
    glassMat.emissiveIntensity = paneGlow;
  };

  /* ── Placing it all for the camera ─────────────────────────────────── */
  const view = new THREE.Matrix4();
  const toAirframe = new THREE.Matrix4();
  const turn = new THREE.Matrix3();
  const eye = new THREE.Vector3();
  const v = new THREE.Vector3();
  const colour = new THREE.Color();
  const place = (camera: THREE.Camera, airframe: THREE.Object3D) => {
    view.multiplyMatrices(camera.matrixWorldInverse, airframe.matrixWorld);
    turn.getNormalMatrix(view);
    toAirframe.copy(airframe.matrixWorld).invert();
    eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toAirframe);
    const ease = 1 - Math.exp(-12 * Math.max(lastDt, 1 / 60));
    const n = dark;

    lamps.forEach((lamp, i) => {
      uniforms.afLampPos.value[i].copy(lamp.at).applyMatrix4(view);
      if (lamp.beam) {
        v.copy(lamp.beam.axis).applyMatrix3(turn).normalize();
        uniforms.afLampAim.value[i].set(v.x, v.y, v.z, lamp.beam.edge);
      }
      const { power, day } = POWER[lamp.kind];
      colour.set(lamp.colour).multiplyScalar(power * level[i] * THREE.MathUtils.lerp(day, 1, n));
      uniforms.afLampRad.value[i].set(colour.r, colour.g, colour.b);

      // Glare only where the lens can actually be seen from.
      seen[i] += ((blocked(eye, lamp.at) ? 0 : 1) - seen[i]) * ease;
      const g = GLARE[lamp.kind];
      const strength = THREE.MathUtils.lerp(g.day[0], g.night[0], n) * level[i] * seen[i];
      const size = THREE.MathUtils.lerp(g.day[1], g.night[1], n);
      colour.set(lamp.colour).multiplyScalar(strength);
      glow.set([colour.r, colour.g, colour.b, strength > 0.002 ? size : 0], (W + i) * 4);
    });

    // Window glare: only once it is dark enough for the cabin to outshine the sky.
    const windowGlare = 0.36 * paneGlow * THREE.MathUtils.smoothstep(n, 0.15, 0.8);
    windows.forEach((_, i) => {
      if (lit[i] && windowGlare > 0.002) {
        colour.copy(tone[i].reading ? READING : cabinLight).multiplyScalar(windowGlare * tone[i].bright);
        glow.set([colour.r, colour.g, colour.b, 0.95], i * 4);
      } else {
        glow.set([0, 0, 0, 0], i * 4);
      }
    });
    glowAttr.needsUpdate = true;

    rows.forEach((row, s) => {
      uniforms.afRowA.value[s].copy(row.from).applyMatrix4(view);
      uniforms.afRowB.value[s].copy(row.to).applyMatrix4(view);
      uniforms.afRowOut.value[s].copy(row.out).applyMatrix3(turn).normalize();
    });
    colour.copy(cabinLight).multiplyScalar(1.8 * paneGlow * n);
    uniforms.afRowRad.value.set(colour.r, colour.g, colour.b);

    uniforms.afMoonDir.value.copy(MOON_DIR).transformDirection(camera.matrixWorldInverse);
    colour.copy(MOON).multiplyScalar(1.3 * n);
    uniforms.afMoonRad.value.set(colour.r, colour.g, colour.b);
    uniforms.afSkylight.value = THREE.MathUtils.lerp(1, 0.12, n);
  };

  return {
    group,
    light,
    setRowsLit,
    update,
    place,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
