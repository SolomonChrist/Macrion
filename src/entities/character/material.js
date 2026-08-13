/**
 * Macrion — the character's single PBR material.
 *
 * ONE material, ONE draw call, nine surface types. Material identity travels
 * as a per-vertex id in `aMatAo.x` and is resolved *hard* in the fragment
 * shader (rounded, with a noise-dithered threshold so the boundary scallops
 * like a real edge instead of stair-stepping along the triangulation). That
 * buys crisp leather-against-cloth transitions without splitting the mesh.
 *
 * The thing the reference frames actually sell is not albedo, it is
 * ROUGHNESS CONTRAST plus micro-normal at the right spatial frequency:
 *
 *   leather   tight specular, ~0.42 rough, pebbled grain at ~260 cyc/m plus
 *             long creases; roughness drops in the worn highs
 *   cloth     broad and matte, ~0.86, a woven cross-hatch at ~430 cyc/m and
 *             quilt channels an order of magnitude coarser
 *   skin      ~0.42 with pore noise at ~700 cyc/m, and a back-scatter term so
 *             ears, nose and the jaw edge glow instead of going black
 *   hair      ~0.30 with strand streaks stretched along the flow direction
 *   metal     fully metallic, faint circumferential scratch anisotropy
 *
 * Detail is evaluated in BIND SPACE (the pre-skinning vertex position), so it
 * does not swim across the surface when the character breathes. Normals are
 * perturbed with the standard derivative bump trick, which needs no tangents
 * and therefore no UV set — this mesh has none, by design.
 */
import * as THREE from 'three';
import { applyAtmosphere } from '../../world/sky.js';

export const MAT = {
  SKIN: 0, CLOTH: 1, LEATHER: 2, METAL: 3, HAIR: 4,
  PANT: 5, EYE: 6, BOOT: 7, MANTLE: 8, SASH: 9,
};

const COMMON = /* glsl */ `
varying vec3 vBindPos;
varying vec3 vBindNrm;
varying float vMatId;
varying float vBakedAO;
varying vec3 vTint;
`;

const FRAG_HELPERS = /* glsl */ `
uniform float uWet;
uniform float uCharTime;

float mHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float mNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = mix( mix( mHash( i + vec3(0,0,0) ), mHash( i + vec3(1,0,0) ), f.x ),
                 mix( mHash( i + vec3(0,1,0) ), mHash( i + vec3(1,1,0) ), f.x ), f.y );
  float b = mix( mix( mHash( i + vec3(0,0,1) ), mHash( i + vec3(1,0,1) ), f.x ),
                 mix( mHash( i + vec3(0,1,1) ), mHash( i + vec3(1,1,1) ), f.x ), f.y );
  return mix( a, b, f.z );
}
float mFbm( vec3 p, int oct ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 5; i ++ ) {
    if ( i >= oct ) break;
    s += a * mNoise( p );
    p *= 2.03; a *= 0.5;
  }
  return s;
}
// cheap cellular: distance to the nearest of 8 jittered lattice points
float mCell( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  float d = 1.0;
  for ( int z = -1; z <= 1; z ++ )
  for ( int y = -1; y <= 1; y ++ )
  for ( int x = -1; x <= 1; x ++ ) {
    vec3 g = vec3( float(x), float(y), float(z) );
    vec3 o = vec3( mHash( i + g ), mHash( i + g + 31.7 ), mHash( i + g + 71.3 ) );
    d = min( d, length( g + o - f ) );
  }
  return d;
}

/** Derivative bump: perturb a normal from a scalar height, no tangents. */
vec3 mBump( vec3 N, vec3 wp, float h, float scale ) {
  vec3 dpdx = dFdx( wp ), dpdy = dFdy( wp );
  float dhdx = dFdx( h ), dhdy = dFdy( h );
  vec3 r1 = cross( dpdy, N );
  vec3 r2 = cross( N, dpdx );
  float det = dot( dpdx, r1 );
  vec3 grad = sign( det ) * ( dhdx * r1 + dhdy * r2 );
  return normalize( abs( det ) * N - scale * grad );
}

/** Surface height field per material — one evaluation, reused for bump. */
float mHeight( int m, vec3 p ) {
  if ( m == 0 ) {                                     // skin: pores + folds
    return mNoise( p * 620.0 ) * 0.35 + mFbm( p * 92.0, 3 ) * 0.55 + mFbm( p * 14.0, 2 ) * 0.5;
  } else if ( m == 1 || m == 5 || m == 8 || m == 9 ) { // woven cloth
    float weave = sin( p.x * 940.0 ) * sin( p.y * 940.0 ) * 0.28
                + sin( ( p.y + p.z ) * 780.0 ) * 0.16;
    float quilt = smoothstep( 0.42, 0.5, abs( fract( p.x * 8.5 + p.z * 2.0 ) - 0.5 ) ) * 0.5;
    return weave + mFbm( p * 190.0, 3 ) * 0.55 + quilt;
  } else if ( m == 2 || m == 7 ) {                    // leather grain + creases
    float grain = 1.0 - mCell( p * 260.0 );
    float crease = smoothstep( 0.35, 0.0, mCell( p * 34.0 ) );
    return grain * 0.85 + crease * 0.8 + mFbm( p * 130.0, 2 ) * 0.25;
  } else if ( m == 4 ) {                              // hair: stretched strands
    return mFbm( vec3( p.x * 520.0, p.y * 120.0, p.z * 150.0 ), 3 ) * 1.3;
  } else if ( m == 3 ) {                              // metal: fine scratches
    return mFbm( vec3( p.x * 900.0, p.y * 130.0, p.z * 900.0 ), 2 ) * 0.5
         + mFbm( p * 60.0, 2 ) * 0.4;
  }
  return 0.0;
}

void mParams( int m, out vec3 alb, out float rough, out float metal, out float trans ) {
  trans = 0.0;
  if ( m == 0 ) {        alb = vec3( 0.348, 0.176, 0.114 ); rough = 0.44; metal = 0.0; trans = 0.55; }
  else if ( m == 1 ) {   alb = vec3( 0.0400, 0.0455, 0.0362 ); rough = 0.88; metal = 0.0; trans = 0.16; }
  else if ( m == 2 ) {   alb = vec3( 0.0345, 0.0192, 0.0122 ); rough = 0.44; metal = 0.03; }
  else if ( m == 3 ) {   alb = vec3( 0.560, 0.396, 0.152 ); rough = 0.30; metal = 1.0; }
  else if ( m == 4 ) {   alb = vec3( 0.0168, 0.0110, 0.0080 ); rough = 0.31; metal = 0.0; trans = 0.30; }
  else if ( m == 5 ) {   alb = vec3( 0.0700, 0.0605, 0.0470 ); rough = 0.84; metal = 0.0; trans = 0.12; }
  else if ( m == 6 ) {   alb = vec3( 0.700, 0.660, 0.620 ); rough = 0.09; metal = 0.0; }
  else if ( m == 7 ) {   alb = vec3( 0.0205, 0.0139, 0.0105 ); rough = 0.40; metal = 0.02; }
  else if ( m == 8 ) {   alb = vec3( 0.1720, 0.0532, 0.0250 ); rough = 0.80; metal = 0.0; trans = 0.26; }
  else {                 alb = vec3( 0.1810, 0.1300, 0.0740 ); rough = 0.78; metal = 0.0; trans = 0.30; }
}
`;

export function createCharacterMaterial() {
  const uniforms = {
    uWet: { value: 0.0 },
    uCharTime: { value: 0.0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.0,
    envMapIntensity: 1.0,
    dithering: true,
  });
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aMatAo;
attribute vec3 aTint;
${COMMON}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  vBindNrm = objectNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vBindPos = position;
  vMatId = aMatAo.x;
  vBakedAO = aMatAo.y;
  vTint = aTint;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${COMMON}
${FRAG_HELPERS}
vec3 macAlb; float macRough; float macMetal; float macTrans; int macM;`)

      // ---- resolve material identity, albedo
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float dither = ( mNoise( vBindPos * 340.0 ) - 0.5 ) * 0.55;
    macM = int( floor( vMatId + 0.5 + dither ) );
    macM = clamp( macM, 0, 9 );
    mParams( macM, macAlb, macRough, macMetal, macTrans );
    vec3 c = macAlb * vTint;

    // large-scale value break-up so nothing reads as one flat swatch
    float blotch = mFbm( vBindPos * 11.0, 3 );
    c *= 0.86 + 0.30 * blotch;

    if ( macM == 0 ) {
      // skin: warm the high points, cool and desaturate the recessed skin
      float ao = vBakedAO;
      c *= mix( vec3( 0.72, 0.66, 0.70 ), vec3( 1.06, 1.00, 0.96 ), ao );
      c += vec3( 0.030, 0.008, 0.006 ) * ( 1.0 - ao );
    }
    // wet darkening — cloth soaks, leather beads
    float soak = ( macM == 1 || macM == 5 || macM == 8 || macM == 9 ) ? 0.55 : 0.28;
    c *= mix( 1.0, 1.0 - soak, uWet );
    diffuseColor.rgb *= c;
  }`)

      // ---- roughness / metalness
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  {
    float h = mHeight( macM, vBindPos );
    float r = macRough;
    if ( macM == 2 || macM == 7 ) r += ( h - 0.9 ) * 0.20;            // leather highs polish
    else if ( macM == 1 || macM == 5 || macM == 8 || macM == 9 ) r += ( h - 0.75 ) * 0.11;
    else if ( macM == 0 ) r += ( h - 0.75 ) * 0.16;
    else if ( macM == 4 ) r += ( h - 0.65 ) * 0.22;
    else if ( macM == 3 ) r += ( h - 0.45 ) * 0.30;
    r += ( 1.0 - vBakedAO ) * 0.10;                                    // crevices stay matte
    roughnessFactor = clamp( mix( r, r * 0.42 + 0.03, uWet * 0.9 ), 0.035, 1.0 );
  }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = macMetal;`)

      // ---- micro-normal
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 wp = vBindPos;
    float h = mHeight( macM, wp );
    float amp =
      ( macM == 2 || macM == 7 ) ? 0.055 :
      ( macM == 1 || macM == 5 || macM == 8 || macM == 9 ) ? 0.040 :
      ( macM == 0 ) ? 0.020 :
      ( macM == 4 ) ? 0.075 :
      ( macM == 3 ) ? 0.012 : 0.0;
    if ( amp > 0.0 ) normal = mBump( normal, - vViewPosition, h, amp * ( 1.0 - uWet * 0.6 ) );
  }`)

      // ---- back-scatter / sheen: the rim that makes cloth and skin read
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  if ( macTrans > 0.0 ) {
    vec3 Ld = directionalLights[ 0 ].direction;
    vec3 V = normalize( vViewPosition );
    float back = max( 0.0, dot( - normal, Ld ) );
    float wrapD = max( 0.0, ( dot( normal, Ld ) + 0.45 ) / 1.45 );
    float fres = pow( 1.0 - clamp( dot( normal, V ), 0.0, 1.0 ), 3.2 );
    vec3 tint = ( macM == 0 ) ? vec3( 1.0, 0.34, 0.22 )
              : ( macM == 4 ) ? vec3( 1.0, 0.66, 0.42 )
              : vec3( 1.0, 0.80, 0.66 );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * tint
      * macTrans * ( pow( back, 2.0 ) * ( 0.28 + 1.15 * fres ) + wrapD * fres * 0.30 );
  }
#endif`)

      // ---- baked cavity occlusion on the indirect terms
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    float bao = clamp( vBakedAO, 0.0, 1.0 );
    reflectedLight.indirectDiffuse *= mix( 0.30, 1.0, bao );
    reflectedLight.indirectSpecular *= mix( 0.42, 1.0, bao );
    reflectedLight.directDiffuse *= mix( 0.66, 1.0, bao );
  }`);
  };

  applyAtmosphere(mat);
  return mat;
}
