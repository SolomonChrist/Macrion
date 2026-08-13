/**
 * Macrion — aerial perspective + CSM material injection.
 *
 * WHY IT LOOKS LIKE THIS
 * ----------------------
 * Three applies `<fog_fragment>` *after* tonemapping and colour-space encode,
 * which makes physically-shaped fog impossible. So instead we:
 *
 *   - override `<fog_pars_vertex>` / `<fog_vertex>` to carry a world position,
 *   - override `<fog_pars_fragment>` to declare our uniforms + helpers,
 *   - append the aerial term to `<opaque_fragment>`, which runs in linear HDR
 *     *before* tonemapping,
 *   - blank `<fog_fragment>` so three's flat mix() never runs.
 *
 * The scattering colour comes from a 128x64 LUT rendered from the very same
 * atmosphere shader the sky dome uses, indexed by (angle-to-key-light,
 * elevation). That guarantees a distant ridge dissolves into *exactly* the sky
 * pixel behind it — no seam, no grey fog wall — and it is inscattering-weighted
 * by sun angle for free, because the sky itself is brighter and warmer toward
 * the sun. Extinction is per-channel (blue extincts ~4x faster than red) plus a
 * second ground-hugging haze layer with its own scale height, so valleys pool.
 *
 * Materials opt in through `applyAtmosphere(material)`. Sky's update() also
 * walks the scene every frame and patches anything new, so other builders get
 * aerial perspective + cascaded shadows with zero code on their side. Calling
 * `applyAtmosphere` yourself is still cheaper and is the documented path:
 *
 *     import { applyAtmosphere } from '../world/sky.js';
 *     applyAtmosphere( myMaterial );
 *
 * It chains onto any onBeforeCompile you already set, and is idempotent.
 */
import * as THREE from 'three';

export const CASCADES = 3;

// --------------------------------------------------------------- uniforms --
const fallback = new THREE.DataTexture(
  new Uint8Array([120, 150, 190, 255]), 1, 1, THREE.RGBAFormat
);
fallback.needsUpdate = true;

/** One shared object, referenced (not cloned) by every patched material. */
export const atmoUniforms = {
  // aerial perspective
  uAerialLUT: { value: fallback },
  uAerialKeyAz: { value: new THREE.Vector2(0, 1) },
  uAerialBetaAir: { value: new THREE.Vector3(0.00042, 0.00098, 0.00230) },
  uAerialAirH: { value: 1100 },
  uAerialBetaHaze: { value: new THREE.Vector3(0.0016, 0.0017, 0.0018) },
  uAerialHazeH: { value: 95 },
  uAerialHazeBase: { value: -6 },
  // cascaded shadow maps
  CSM_cascades: { value: [] },
  cameraNear: { value: 0.25 },
  shadowFar: { value: 340 },
};

for (let i = 0; i < CASCADES; i++) atmoUniforms.CSM_cascades.value.push(new THREE.Vector2());

// ------------------------------------------------------------ shader glue --
const FOG_PARS_VERT = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;

const FOG_VERT = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = cameraPosition + ( mvPosition.xyz * mat3( viewMatrix ) );
#endif
`;

const FOG_PARS_FRAG = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;

  uniform sampler2D uAerialLUT;
  uniform vec2  uAerialKeyAz;
  uniform vec3  uAerialBetaAir;
  uniform float uAerialAirH;
  uniform vec3  uAerialBetaHaze;
  uniform float uAerialHazeH;
  uniform float uAerialHazeBase;

  vec3 macSampleSkyLUT( vec3 V ) {
    float vy = sign( V.y ) * sqrt( abs( V.y ) );
    float v = clamp( vy * 0.5 + 0.5, 0.004, 0.996 );
    vec2 vxz = V.xz;
    float l = length( vxz );
    vec2 nv = l > 1e-5 ? vxz / l : vec2( 0.0, 1.0 );
    float u = acos( clamp( dot( nv, uAerialKeyAz ), -1.0, 1.0 ) ) * 0.31830988618;
    return texture2D( uAerialLUT, vec2( u, v ) ).rgb;
  }

  float macHeightInt( float h0, float dh, float dist, float H, float base ) {
    float a = exp( clamp( -( h0 - base ) / H, -18.0, 6.0 ) );
    if ( abs( dh ) < 0.5 ) return dist * a;
    float b = exp( clamp( -( h0 + dh - base ) / H, -18.0, 6.0 ) );
    return abs( dist * H * ( a - b ) / dh );
  }

  vec3 macrionAerial( vec3 color, vec3 wp ) {
    vec3 d = wp - cameraPosition;
    float dist = length( d );
    if ( dist < 0.05 ) return color;
    vec3 V = d / dist;
    float ia = macHeightInt( cameraPosition.y, d.y, dist, uAerialAirH, 0.0 );
    float ih = macHeightInt( cameraPosition.y, d.y, dist, uAerialHazeH, uAerialHazeBase );
    vec3 tau = uAerialBetaAir * ia + uAerialBetaHaze * ih;
    vec3 T = exp( - min( tau, vec3( 24.0 ) ) );
    return color * T + macSampleSkyLUT( V ) * ( 1.0 - T );
  }
#endif
`;

const AERIAL_APPLY = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = macrionAerial( gl_FragColor.rgb, vFogWorldPos );
#endif
`;

let injected = false;

/** Idempotent global ShaderChunk surgery. Safe across vite HMR. */
export function injectAerialChunks() {
  if (injected || THREE.ShaderChunk.__macrionAerial) return;
  injected = true;
  THREE.ShaderChunk.__macrionAerial = true;
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERT;
  THREE.ShaderChunk.fog_vertex = FOG_VERT;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAG;
  THREE.ShaderChunk.fog_fragment = '';
  THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment + AERIAL_APPLY;
}

// ------------------------------------------------------------- patching ----
/**
 * Give a material Macrion aerial perspective + cascaded shadow map support.
 * Idempotent, chains onto an existing onBeforeCompile, and re-applies itself if
 * someone overwrites onBeforeCompile later.
 */
export function applyAtmosphere(material) {
  if (!material || material.isShaderMaterial === true && material.__macrionOptOut) return material;
  if (material.__macrionFn && material.onBeforeCompile === material.__macrionFn) return material;

  const prev = material.onBeforeCompile && material.onBeforeCompile !== material.__macrionFn
    ? material.onBeforeCompile
    : null;

  material.defines = material.defines || {};
  if (!material.defines.USE_CSM) {
    material.defines.USE_CSM = 1;
    material.defines.CSM_CASCADES = CASCADES;
  }

  const fn = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, atmoUniforms);
  };
  material.onBeforeCompile = fn;
  material.__macrionFn = fn;
  material.needsUpdate = true;
  return material;
}

/** Walk a scene graph and patch every material that isn't opted out. */
export function patchScene(root) {
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) { for (const mm of m) if (!mm.__macrionOptOut) applyAtmosphere(mm); }
    else if (!m.__macrionOptOut) applyAtmosphere(m);
  });
}
