/**
 * Macrion — SNAGULA material, and the instanced-skinning vertex path.
 *
 * TWO jobs live in this file.
 *
 * 1. INSTANCED SKINNING. Three has no InstancedSkinnedMesh. A fight wants
 *    several Snagulas on screen inside a 400-draw-call budget, so they are
 *    drawn as `THREE.InstancedMesh` and the skinning is done here by hand: the
 *    per-instance bone palette is uploaded as a float DataTexture (row =
 *    instance slot, 4 texels = one mat4) and the vertex shader blends the top
 *    four bones out of it. The poses themselves are still computed on the CPU
 *    by `character/rig.js`'s animator, so the enemies and Oz share one
 *    animation implementation. Cost is one draw call per (species, LOD).
 *
 *    The same injection is applied to a custom depth material so the shadow
 *    pass deforms identically — without it the shadows would be cast by the
 *    undeformed bind pose, which is one of the most obvious tells there is.
 *
 * 2. THE HIDE. Green, scaled, wet-mouthed, with teeth and eyes that have to
 *    read at combat distance.
 *
 * BAND LIMIT (heartbeats/oz-repair.md #1, and it applies harder here than it
 * did to Oz): frequencies are quoted in cycles per METRE, and an enemy is
 * usually 3-10 m away, where one pixel covers 2-8 mm. A 4 mm scale pattern is
 * therefore AT Nyquist at combat range and past it beyond that. Two bands are
 * used: a fine scale band that `macDet` fades out as the on-screen footprint
 * grows, and a COARSE 60-90 cyc/m plate band that survives to silhouette
 * distance and is what actually makes the hide read as reptile.
 */
import * as THREE from 'three';
import { applyAtmosphere } from '../../world/sky.js';

export const BONE_COUNT = 30;      // BONE_DEF length in character/rig.js

/** Vertex-side declarations: attributes, the bone texture, and the blend. */
const SKIN_DECL = /* glsl */ `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float aInstIndex;
uniform highp sampler2D uBoneTex;
uniform vec2 uBoneTexSize;

mat4 macBoneMat( float bi, float row ) {
  vec2 inv = 1.0 / uBoneTexSize;
  float x = bi * 4.0;
  float v = ( row + 0.5 ) * inv.y;
  return mat4(
    texture2D( uBoneTex, vec2( ( x + 0.5 ) * inv.x, v ) ),
    texture2D( uBoneTex, vec2( ( x + 1.5 ) * inv.x, v ) ),
    texture2D( uBoneTex, vec2( ( x + 2.5 ) * inv.x, v ) ),
    texture2D( uBoneTex, vec2( ( x + 3.5 ) * inv.x, v ) )
  );
}
mat4 macSkinMat() {
  mat4 m = macBoneMat( skinIndex.x, aInstIndex ) * skinWeight.x;
  m += macBoneMat( skinIndex.y, aInstIndex ) * skinWeight.y;
  m += macBoneMat( skinIndex.z, aInstIndex ) * skinWeight.z;
  m += macBoneMat( skinIndex.w, aInstIndex ) * skinWeight.w;
  return m;
}
`;

/**
 * Inject the instanced skinning into any material's vertex shader.
 *
 * `beginnormal_vertex` is inside an `#ifdef USE_DISPLACEMENTMAP` in the depth
 * shader, so the normal branch is applied only when the chunk is actually
 * present. The matrix is evaluated twice rather than cached in a global,
 * because the two chunks are not adjacent in every shader and vertex ALU is
 * not the bottleneck at these vertex counts.
 */
export function injectInstancedSkinning(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>', `#include <common>\n${SKIN_DECL}`
  );
  if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\n  objectNormal = mat3( macSkinMat() ) * objectNormal;'
    );
  }
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  transformed = ( macSkinMat() * vec4( transformed, 1.0 ) ).xyz;'
  );
}

const VARYINGS = /* glsl */ `
varying vec3 vBindPos;
varying float vMatId;
varying float vBakedAO;
varying vec3 vTint;
varying vec3 vInstTint;
`;

const FRAG = /* glsl */ `
uniform vec3 uHide;
uniform vec3 uBelly;
uniform vec3 uPlate;
uniform vec3 uEyeColor;
uniform float uEyeGlow;
uniform float uScaleFreq;
uniform float uWet;
uniform float uTime;

float eHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float eNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = mix( mix( eHash( i + vec3(0,0,0) ), eHash( i + vec3(1,0,0) ), f.x ),
                 mix( eHash( i + vec3(0,1,0) ), eHash( i + vec3(1,1,0) ), f.x ), f.y );
  float b = mix( mix( eHash( i + vec3(0,0,1) ), eHash( i + vec3(1,0,1) ), f.x ),
                 mix( eHash( i + vec3(0,1,1) ), eHash( i + vec3(1,1,1) ), f.x ), f.y );
  return mix( a, b, f.z );
}
float eFbm( vec3 p, int oct ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    if ( i >= oct ) break;
    s += a * eNoise( p ); p *= 2.03; a *= 0.5;
  }
  return s;
}
float eCell( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  float d = 1.0;
  for ( int z = -1; z <= 1; z ++ )
  for ( int y = -1; y <= 1; y ++ )
  for ( int x = -1; x <= 1; x ++ ) {
    vec3 g = vec3( float(x), float(y), float(z) );
    vec3 o = vec3( eHash( i + g ), eHash( i + g + 31.7 ), eHash( i + g + 71.3 ) );
    d = min( d, length( g + o - f ) );
  }
  return d;
}
vec3 eBump( vec3 N, vec3 wp, float h, float scale ) {
  vec3 dpdx = dFdx( wp ), dpdy = dFdy( wp );
  float dhdx = dFdx( h ), dhdy = dFdy( h );
  vec3 r1 = cross( dpdy, N );
  vec3 r2 = cross( N, dpdx );
  float det = dot( dpdx, r1 );
  vec3 grad = sign( det ) * ( dhdx * r1 + dhdy * r2 );
  return normalize( abs( det ) * N - scale * grad );
}

/**
 * Height field per material. det fades the top band out with the on-screen
 * footprint; the coarse band below it is deliberately left in, because it is
 * the one still resolvable when the creature is 15 m away.
 */
float eHeight( int m, vec3 p, float det ) {
  if ( m == 0 ) {                               // hide: fine scales + coarse plates
    float fine = ( 1.0 - eCell( p * uScaleFreq ) ) * det;
    float plate = ( 1.0 - eCell( p * 74.0 ) );
    return fine * 0.34 + plate * 0.46 + eFbm( p * 15.0, 2 ) * 0.22;
  } else if ( m == 1 ) {                        // belly: transverse banding
    float band = smoothstep( 0.35, 0.5, abs( fract( p.y * 26.0 + p.z * 3.0 ) - 0.5 ) );
    return band * 0.55 + eFbm( p * 40.0, 2 ) * 0.28 * det;
  } else if ( m == 2 || m == 7 ) {              // bone plate / horn: ridged
    return eFbm( vec3( p.x * 30.0, p.y * 150.0, p.z * 30.0 ), 2 ) * 0.50 * det
         + eFbm( p * 22.0, 2 ) * 0.34;
  } else if ( m == 3 || m == 4 ) {              // tooth / claw: near polished
    return eFbm( vec3( p.x * 40.0, p.y * 190.0, p.z * 40.0 ), 2 ) * 0.24 * det;
  } else if ( m == 6 ) {                        // mouth: wet, soft
    return eFbm( p * 120.0, 2 ) * 0.30 * det;
  }
  return 0.0;
}

void eParams( int m, out vec3 alb, out float rough, out float metal, out float trans ) {
  trans = 0.0; metal = 0.0;
  if ( m == 0 )      { alb = uHide;  rough = 0.60; trans = 0.20; }
  else if ( m == 1 ) { alb = uBelly; rough = 0.70; trans = 0.30; }
  else if ( m == 2 ) { alb = uPlate; rough = 0.46; }
  else if ( m == 3 ) { alb = vec3( 0.560, 0.520, 0.410 ); rough = 0.17; trans = 0.34; }
  else if ( m == 4 ) { alb = vec3( 0.0250, 0.0225, 0.0195 ); rough = 0.22; }
  else if ( m == 5 ) { alb = vec3( 0.0300, 0.0040, 0.0030 ); rough = 0.10; }
  else if ( m == 6 ) { alb = vec3( 0.1150, 0.0220, 0.0230 ); rough = 0.26; trans = 0.45; }
  else               { alb = vec3( 0.0480, 0.0440, 0.0360 ); rough = 0.40; }
}
`;

/**
 * One material per species (the hide colours are uniforms, not attributes).
 * `uniforms` must be the SHARED bone-texture uniform object from the instancer.
 */
export function createSnagulaMaterial(sp, boneUniforms) {
  const uniforms = {
    ...boneUniforms,
    uHide: { value: new THREE.Vector3(...sp.hide) },
    uBelly: { value: new THREE.Vector3(...sp.belly_c) },
    uPlate: { value: new THREE.Vector3(...sp.plate) },
    uEyeColor: { value: new THREE.Vector3(1.0, 0.085, 0.030) },
    uEyeGlow: { value: sp.eye.glow },
    uScaleFreq: { value: sp.scaleFreq },
    uWet: { value: 0.0 },
    uTime: { value: 0.0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.7, metalness: 0.0,
    envMapIntensity: 1.0, dithering: true,
  });
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    injectInstancedSkinning(shader, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aMatAo;
attribute vec3 aTint;
attribute vec3 aInstTint;
${VARYINGS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vBindPos = position;
  vMatId = aMatAo.x;
  vBakedAO = aMatAo.y;
  vTint = aTint;
  vInstTint = aInstTint;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${VARYINGS}
${FRAG}
vec3 eAlb; float eRough; float eMetal; float eTrans; int eM;
float eFW; float eDet;`)

      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    eFW = length( fwidth( vBindPos ) ) + 1e-6;
    eDet = 1.0 - smoothstep( 0.0025, 0.0090, eFW );
    eM = clamp( int( floor( vMatId + 0.5 ) ), 0, 7 );
    eParams( eM, eAlb, eRough, eMetal, eTrans );
    vec3 c = eAlb;
    // per-instance and per-vertex variation, hide-family surfaces only, so a
    // pack of Snagulas is never three copies of one paint job
    if ( eM == 0 || eM == 1 || eM == 2 ) {
      c *= vTint * vInstTint;
      float blotch = eFbm( vBindPos * 8.5, 3 );
      c *= 0.88 + 0.26 * blotch;
      // sickly yellow-green in the raised scale tops, cold in the crevices
      float h = eHeight( eM, vBindPos, eDet );
      c = mix( c * vec3( 0.80, 0.86, 1.00 ), c * vec3( 1.22, 1.14, 0.72 ), clamp( h * 0.9, 0.0, 1.0 ) );
      c *= mix( 0.55, 1.06, clamp( vBakedAO, 0.0, 1.0 ) );
    } else if ( eM == 3 ) {
      // teeth yellow toward the gum and stay bone-white at the tip
      c *= 0.62 + 0.55 * clamp( eFbm( vBindPos * 60.0, 2 ), 0.0, 1.0 );
    }
    c *= mix( 1.0, 0.72, uWet * ( eM == 0 || eM == 1 ? 1.0 : 0.4 ) );
    diffuseColor.rgb *= c;
  }`)

      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  {
    float h = eHeight( eM, vBindPos, eDet );
    float r = eRough;
    if ( eM == 0 ) r += ( h - 0.48 ) * 0.34;
    else if ( eM == 1 ) r += ( h - 0.42 ) * 0.26;
    else if ( eM == 2 || eM == 7 ) r += ( h - 0.34 ) * 0.30;
    r += ( 1.0 - vBakedAO ) * 0.12;
    roughnessFactor = clamp( mix( r, r * 0.38 + 0.03, uWet * 0.9 ), 0.035, 1.0 );
  }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = eMetal;`)

      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float h = eHeight( eM, vBindPos, eDet );
    float amp =
      ( eM == 0 ) ? 0.0125 :
      ( eM == 1 ) ? 0.0075 :
      ( eM == 2 || eM == 7 ) ? 0.0090 :
      ( eM == 3 || eM == 4 ) ? 0.0022 :
      ( eM == 6 ) ? 0.0030 : 0.0;
    if ( amp > 0.0 ) normal = eBump( normal, - vViewPosition, h, amp * ( 1.0 - uWet * 0.6 ) );
  }`)

      // ---- the red eye. It has to survive shadow, backlight and 15 m.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if ( eM == 5 ) {
    vec3 V = normalize( vViewPosition );
    float face = clamp( dot( normal, V ), 0.0, 1.0 );
    // hot core, falling off to a darker ring so it reads as a lens, not a dot
    float core = pow( face, 1.6 );
    totalEmissiveRadiance += uEyeColor * uEyeGlow * ( 0.30 + 0.70 * core );
  } else if ( eM == 6 ) {
    totalEmissiveRadiance += vec3( 0.030, 0.004, 0.004 );
  }`)

      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  if ( eTrans > 0.0 ) {
    vec3 Ld = directionalLights[ 0 ].direction;
    vec3 V = normalize( vViewPosition );
    float back = max( 0.0, dot( - normal, Ld ) );
    float wrapD = max( 0.0, ( dot( normal, Ld ) + 0.40 ) / 1.40 );
    float fres = pow( 1.0 - clamp( dot( normal, V ), 0.0, 1.0 ), 3.0 );
    vec3 tint = ( eM == 6 ) ? vec3( 1.0, 0.26, 0.20 ) : vec3( 0.70, 1.0, 0.42 );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * tint
      * eTrans * ( pow( back, 2.6 ) * ( 0.22 + 0.66 * fres ) + wrapD * fres * 0.24 );
  }
#endif`)

      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    float bao = clamp( vBakedAO, 0.0, 1.0 );
    reflectedLight.indirectDiffuse *= mix( 0.28, 1.0, bao );
    reflectedLight.indirectSpecular *= mix( 0.40, 1.0, bao );
    reflectedLight.directDiffuse *= mix( 0.64, 1.0, bao );
  }`);
  };

  applyAtmosphere(mat);
  return mat;
}

/** Depth material for the shadow pass, deformed by the same bone palette. */
export function createSnagulaDepthMaterial(boneUniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => injectInstancedSkinning(shader, boneUniforms);
  mat.customProgramCacheKey = () => 'snagula-depth';
  return mat;
}
