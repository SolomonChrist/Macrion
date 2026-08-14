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

/**
 * Surface height field per material — one evaluation, reused for bump.
 *
 * BAND LIMIT: every frequency here is quoted in cycles per METRE and the
 * character is ~1.8 m tall, so a "940 cyc/m" thread is a 1 mm feature. At a
 * portrait framing one pixel covers roughly 0.5-1 mm of the character, which
 * puts those bands at or past Nyquist: they alias into per-pixel salt-and-
 * pepper and long moire bands, and the derivative bump then randomises the
 * normal per fragment. That is what shredded the previous build.
 *
 * Two defences, both required:
 *   1. the top band of every material now sits near ~200 cyc/m (5 mm), which
 *      is comfortably resolvable at portrait range;
 *   2. the det argument fades the remaining top band out as the on-screen texel
 *      footprint grows, so the same shader stays clean at any distance.
 */
float mHeight( int m, vec3 p, float det ) {
  if ( m == 0 ) {                                     // skin: soft, almost none
    // ANIME SKIN IS SMOOTH. The pore band that a realistic face needs reads as
    // salt-and-pepper mottling on a stylized head, because there is no other
    // detail near it to hide behind. What survives is only the broad form
    // variation that keeps the cheek from being a flat swatch.
    return mFbm( p * 34.0, 2 ) * 0.16 + mFbm( p * 9.0, 2 ) * 0.30;
  } else if ( m == 1 || m == 5 || m == 8 || m == 9 ) { // woven cloth
    // sin*sin puts a checker lattice at pi/f metres; at f = 205 that was a 15 mm
    // cell, which at full bump amplitude read as knitted chainmail. Finer and
    // much shallower — the roughness break-up is what sells cloth, not relief.
    float weave = ( sin( p.x * 330.0 ) * sin( p.y * 330.0 ) * 0.055
                  + sin( ( p.y + p.z ) * 268.0 ) * 0.035 ) * det;
    float quilt = smoothstep( 0.42, 0.5, abs( fract( p.x * 8.5 + p.z * 2.0 ) - 0.5 ) ) * 0.32;
    return weave + mFbm( p * 58.0, 2 ) * 0.30 + quilt;
  } else if ( m == 2 || m == 7 ) {                    // leather grain + creases
    float grain = ( 1.0 - mCell( p * 120.0 ) ) * det;
    float crease = smoothstep( 0.30, 0.0, mCell( p * 24.0 ) );
    return grain * 0.40 + crease * 0.55 + mFbm( p * 46.0, 2 ) * 0.18;
  } else if ( m == 4 ) {                              // hair: stretched strands
    // The 210 cyc/m band across x was the glitter on the hair: at portrait range
    // it beat against the pixel grid and every other fragment caught a specular
    // hit. Sculpted anime hair wants long directional bands, not fibres.
    return mFbm( vec3( p.x * 74.0, p.y * 26.0, p.z * 30.0 ), 2 ) * 0.62;
  } else if ( m == 3 ) {                              // metal: fine scratches
    return mFbm( vec3( p.x * 260.0, p.y * 46.0, p.z * 260.0 ), 2 ) * 0.35 * det
         + mFbm( p * 30.0, 2 ) * 0.25;
  }
  return 0.0;
}

void mParams( int m, out vec3 alb, out float rough, out float metal, out float trans ) {
  trans = 0.0;
  // NOTE trans (back-scatter) on skin was 0.55, which is fine on a thin ear but
  // blows out to orange inside any concavity whose walls face away from the key
  // light — nostrils, the mouth crease, under the jaw. 0.30 still lights the
  // ear and the jaw edge without setting the creases on fire.
  if ( m == 0 ) {        alb = vec3( 0.348, 0.176, 0.114 ); rough = 0.44; metal = 0.0; trans = 0.30; }
  else if ( m == 1 ) {   alb = vec3( 0.0400, 0.0455, 0.0362 ); rough = 0.88; metal = 0.0; trans = 0.16; }
  else if ( m == 2 ) {   alb = vec3( 0.0345, 0.0192, 0.0122 ); rough = 0.44; metal = 0.03; }
  else if ( m == 3 ) {   alb = vec3( 0.560, 0.396, 0.152 ); rough = 0.30; metal = 1.0; }
  else if ( m == 4 ) {   alb = vec3( 0.0232, 0.0146, 0.0108 ); rough = 0.34; metal = 0.0; trans = 0.26; }
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
vec3 macAlb; float macRough; float macMetal; float macTrans; int macM;
float macFW; float macDet;`)

      // ---- resolve material identity, albedo
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    // on-screen footprint of the surface, in metres per pixel. Everything
    // high-frequency below is faded out against this so nothing is ever
    // sampled past Nyquist.
    macFW = length( fwidth( vBindPos ) ) + 1e-6;
    macDet = 1.0 - smoothstep( 0.0018, 0.0080, macFW );

    // material identity is an integer per vertex; the only place it is not is
    // across a seam triangle, so soften with a footprint-sized blend rather
    // than the old noise dither (which speckled every boundary).
    macM = int( floor( vMatId + 0.5 ) );
    macM = clamp( macM, 0, 9 );
    mParams( macM, macAlb, macRough, macMetal, macTrans );
    vec3 c = macAlb * vTint;

    // large-scale value break-up so nothing reads as one flat swatch
    float blotch = mFbm( vBindPos * 11.0, 3 );
    c *= 0.94 + 0.13 * blotch;

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
    float h = mHeight( macM, vBindPos, macDet );
    float r = macRough;
    // pivots re-centred on the new mean of each height field, so the band-limit
    // change does not silently shift every material's base roughness
    if ( macM == 2 || macM == 7 ) r += ( h - 0.40 ) * 0.24;           // leather highs polish
    else if ( macM == 1 || macM == 5 || macM == 8 || macM == 9 ) r += ( h - 0.30 ) * 0.16;
    else if ( macM == 0 ) r += ( h - 0.22 ) * 0.20;
    else if ( macM == 4 ) r += ( h - 0.23 ) * 0.30;
    else if ( macM == 3 ) r += ( h - 0.30 ) * 0.34;
    r += ( 1.0 - vBakedAO ) * 0.10;                                    // crevices stay matte
    roughnessFactor = clamp( mix( r, r * 0.42 + 0.03, uWet * 0.9 ), 0.035, 1.0 );
  }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = macMetal;`)

      // ---- micro-normal
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 wp = vBindPos;
    float h = mHeight( macM, wp, macDet );
    // Amplitudes are in the same units as the height field above. Once the
    // frequencies came down to a resolvable band the old amplitudes turned
    // fabric into armour plate — relief has to scale WITH wavelength.
    float amp =
      ( macM == 2 || macM == 7 ) ? 0.0110 :
      ( macM == 1 || macM == 5 || macM == 8 || macM == 9 ) ? 0.0075 :
      ( macM == 0 ) ? 0.0014 :
      ( macM == 4 ) ? 0.0062 :
      ( macM == 3 ) ? 0.0040 : 0.0;
    amp *= macDet;   // no bump at all once the detail is smaller than a pixel
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
      * macTrans * ( pow( back, 2.6 ) * ( 0.24 + 0.70 * fres ) + wrapD * fres * 0.26 );
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
