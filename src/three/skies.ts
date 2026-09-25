import * as THREE from 'three';

/**
 * Air, seen from outside it — and another planet's air, seen from inside.
 *
 * Three pieces the upper bands share:
 *
 *   The atmosphere shell. Earth's air seen edge-on is a thin bright band
 *   hugging the limb, fading upward into black. An additive shell of
 *   triangles can only approximate that with its own silhouette, and at a
 *   planet's scale the facets show as steps. So the shell is only a canvas:
 *   each pixel works out, from the ray it sits on, how close that ray passes
 *   to the ground and how much air it crosses, and glows accordingly. From
 *   inside the band the same sum colours the sky overhead, so the black
 *   arrives with the climb rather than all at once.
 *
 *   The planet surface. The space band's sphere carries the farmland at a
 *   scale you can read fields in, with continents, seas and weather laid
 *   over it from `earthMaps().macro` — and the air between you and the far
 *   edge of it hazes the limb blue, which is what makes it a planet rather
 *   than a ball.
 *
 *   The sky of Mars. Butterscotch by day, from dust hanging in thin air,
 *   darker toward the zenith, pale around the sun — and close in to the sun
 *   itself, the faint blue the same dust scatters forward.
 */

const DEPTH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const SHELL_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 planetCentre;
uniform float planetRadius;
uniform float groundInset;
uniform float glowHeight;
uniform vec3 sunDirection;
uniform vec3 glowColour;
uniform float strength;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = cameraPosition - planetCentre;
  vec3 rd = normalize( vWorld - cameraPosition );
  // Where the ray passes closest to the planet, never behind the eye.
  float t = max( - dot( ro, rd ), 0.0 );
  vec3 closest = ro + rd * t;
  float b = length( closest );
  float alt = b - planetRadius;
  // A ray into the ground is the ground's to draw. Between its vertices the
  // ground's mesh sits a little inside the true sphere, so the air carries
  // on that far below the limb, or the gap shows as a dotted black line.
  if ( alt < - groundInset ) discard;
  float glow = exp( - max( alt, 0.0 ) / glowHeight );
  // The day side of the limb glows; the night side barely does.
  float lit = smoothstep( -0.3, 0.45, dot( closest / b, sunDirection ) );
  // And toward the sun the air scatters forward, brighter still.
  float forward = pow( max( dot( rd, sunDirection ), 0.0 ), 6.0 );
  vec3 colour = mix( glowColour, vec3( 0.78, 0.9, 1.0 ), glow * glow * 0.8 );
  gl_FragColor = vec4( colour * glow * strength * ( 0.08 + 0.92 * lit ) * ( 1.0 + forward ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface AtmosphereShell {
  mesh: THREE.Mesh;
  uniforms: {
    planetCentre: { value: THREE.Vector3 };
    planetRadius: { value: number };
    /** How far the planet's own mesh can sit inside `planetRadius`, in the same units. */
    groundInset: { value: number };
    glowHeight: { value: number };
    sunDirection: { value: THREE.Vector3 };
    glowColour: { value: THREE.Color };
    strength: { value: number };
  };
}

/** A glowing shell of air. Size the mesh to enclose whatever should see it. */
export function atmosphereShell(colour: number, strength: number): AtmosphereShell {
  const uniforms = {
    planetCentre: { value: new THREE.Vector3() },
    planetRadius: { value: 1 },
    groundInset: { value: 0 },
    glowHeight: { value: 0.02 },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    glowColour: { value: new THREE.Color(colour) },
    strength: { value: strength },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DEPTH_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uniforms };
}

/**
 * Lay continents, seas and weather over a planet material's own map, and
 * haze its limb. `repeat` is how many times the fields go round the sphere.
 */
export function planetSurface(material: THREE.MeshStandardMaterial, macro: THREE.Texture, repeat: THREE.Vector2, haze: THREE.Vector4) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.planetMacro = { value: macro };
    shader.uniforms.planetRepeat = { value: repeat };
    shader.uniforms.planetHaze = { value: haze };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlanetUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPlanetUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vPlanetUv;\nuniform sampler2D planetMacro;\nuniform vec2 planetRepeat;\nuniform vec4 planetHaze;',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
  vec4 planet = texture2D( planetMacro, vPlanetUv * planetRepeat );
  float pLand = smoothstep( 0.52, 0.56, planet.r );
  float pShelf = smoothstep( 0.44, 0.53, planet.r );
  float pCloud = smoothstep( 0.52, 0.72, planet.g ) * 0.9;
  vec3 pSea = mix( vec3( 0.006, 0.03, 0.09 ), vec3( 0.02, 0.1, 0.17 ), pShelf );
  vec3 pSoil = diffuseColor.rgb * mix( vec3( 1.0 ), vec3( 1.35, 1.12, 0.78 ), planet.b * 0.7 );
  diffuseColor.rgb = mix( pSea, pSoil, pLand );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.92, 0.95 ), pCloud );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // Open sea is glossy enough to carry the sun's glint; land and cloud are not.
        '#include <roughnessmap_fragment>\n\troughnessFactor = mix( 0.32, roughnessFactor, max( pLand, pCloud ) );',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `float pHaze = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 5.0 ) * planetHaze.w;
  outgoingLight = mix( outgoingLight, planetHaze.rgb, pHaze );
  #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'sa-planet-surface';
  material.needsUpdate = true;
}

/**
 * A glowing rim on a globe seen whole: brightest on its sunlit side.
 * `sunView` is the sun's direction in view space, updated each frame.
 */
export function globeRim(material: THREE.MeshStandardMaterial, rim: THREE.Vector4, sunView: THREE.Vector3) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.globeRim = { value: rim };
    shader.uniforms.globeSun = { value: sunView };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 globeRim;\nuniform vec3 globeSun;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `float gRim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 2.5 );
  outgoingLight += globeRim.rgb * gRim * globeRim.w * ( 0.12 + 0.88 * smoothstep( -0.3, 0.5, dot( normal, globeSun ) ) );
  #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'sa-globe-rim';
  material.needsUpdate = true;
}

const MARS_SKY_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 sunDirection;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 halo;
uniform vec3 blueHalo;
uniform float brightness;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize( vWorld - cameraPosition );
  float up = max( d.y, 0.0 );
  vec3 colour = mix( horizon, zenith, pow( up, 0.55 ) );
  float mu = max( dot( d, sunDirection ), 0.0 );
  colour += halo * pow( mu, 7.0 ) * 0.8;
  colour = mix( colour, blueHalo, pow( mu, 60.0 ) * 0.55 );
  gl_FragColor = vec4( colour * brightness, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface MarsSky {
  mesh: THREE.Mesh;
  uniforms: {
    sunDirection: { value: THREE.Vector3 };
    zenith: { value: THREE.Color };
    horizon: { value: THREE.Color };
    halo: { value: THREE.Color };
    blueHalo: { value: THREE.Color };
    brightness: { value: number };
  };
}

/** Mars's sky, as a dome to be centred on the camera. `horizon` doubles as its haze. */
export function marsSky(): MarsSky {
  const uniforms = {
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    zenith: { value: new THREE.Color(0x7a4a30) },
    horizon: { value: new THREE.Color(0xd6a277) },
    halo: { value: new THREE.Color(0xffe6cc) },
    blueHalo: { value: new THREE.Color(0xa7bfdc) },
    brightness: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DEPTH_VERTEX,
    fragmentShader: MARS_SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  return { mesh, uniforms };
}
