/**
 * Macrion — terrain surface shading.
 *
 * Everything here is procedural: no textures are downloaded, sampled from
 * bitmaps, or authored by hand. The only texture involved is a small R8
 * contact map that `scatter.js` splats prop footprints into at build time.
 *
 * Five material layers (clay, dirt, scree, rock, vegetation) plus snow, blended
 * by slope AND by two independent low-frequency noise masks, so the boundaries
 * are patchy rather than clean altitude bands. Layer hue is driven by a
 * `uWarmth` dial so the same terrain reads as FFXV arid scrubland at one end
 * and cold GoW highland at the other — the mineral layers dominate and
 * vegetation is only an accent, which is what makes both ends reachable.
 *
 * Aerial perspective and cascaded shadows come from the Atmosphere module's
 * `applyAtmosphere()` (see the header of src/world/sky.js). We deliberately do
 * NOT roll our own fog: theirs samples the actual sky LUT in the view
 * direction, so a distant ridge dissolves into exactly the sky pixel behind it.
 * Our materials keep `fog = true` (that is the flag their injection keys off)
 * and everything below happens strictly before their term is applied.
 */
import * as THREE from 'three';
import { applyAtmosphere } from '../sky.js';

/* --------------------------------------------------------------- */
/* Shared GLSL                                                      */
/* --------------------------------------------------------------- */

export const GLSL_NOISE = /* glsl */`
vec3 mac_permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float mac_snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = mac_permute( mac_permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float mac_fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ if(i>=oct) break; s += a*mac_snoise(p); p *= 2.03; p += 17.3; a *= 0.5; }
  return s;
}
`;

/* --------------------------------------------------------------- */
/* Uniform block                                                    */
/* --------------------------------------------------------------- */

export function createTerrainUniforms(contactMap) {
  return {
    uWarmth:   { value: 0.9 },
    uWet:      { value: 0.0 },
    uSnowLine: { value: 245 },
    uContact:  { value: contactMap.texture },
    uContactOrigin: { value: new THREE.Vector2(-contactMap.half, -contactMap.half) },
    uContactScale:  { value: 1 / (contactMap.half * 2) },
    uTime:     { value: 0 },
    uWind:     { value: 0.35 },
    // Prevailing wind. A single shared direction is the whole point: per-instance
    // jitter reads as vibration, a shared lean reads as weather.
    uWindDir:  { value: new THREE.Vector2(0.8829, -0.4695) },
  };
}

/* --------------------------------------------------------------- */
/* Terrain material                                                 */
/* --------------------------------------------------------------- */

const SURFACE = /* glsl */`
  vec3  Nw = normalize(vWorldNormal);
  vec3  wp = vWorldPos;
  float camDist = length(wp - cameraPosition);

  // ---- SCREEN-SPACE band limit. This is the single most important line in the
  // file. \`px\` is how many world metres one pixel covers at this fragment; on
  // ground seen at a grazing angle it blows up far faster than camera distance
  // does, which is exactly the case a distance-only fade gets wrong. Every
  // detail octave below is weighted by macBand(wavelength, px) so an octave
  // switches off the moment its period approaches the pixel grid, instead of
  // aliasing into one dominant frequency (the r1 "corduroy" artifact).
  vec3  dwp = fwidth(wp);
  float px  = max(max(dwp.x, dwp.y), dwp.z);
  // sin(slope angle), not 1-N.y: 1-N.y is quadratic near flat and pushes every
  // useful threshold into the last few degrees before vertical.
  float slope = sqrt(clamp(1.0 - Nw.y * Nw.y, 0.0, 1.0));

  // ---- low-frequency masks. Three independent fields at different scales:
  // which mineral dominates, where vegetation clumps, and where the ground is
  // damp. They never share a boundary, which is what kills the "clean altitude
  // band" look the reference analysis calls out.
  // m0 is the biome-scale term (~700 m): whole hillsides swing between
  // vegetated and bare, which is the variation you read as "a place" rather
  // than as noise. m1/m2/m3 break that up at 160 m, 65 m and 19 m.
  float m0 = mac_snoise(wp.xz * 0.0026 + 3.0) * 0.7 + 0.5 * mac_snoise(wp.zx * 0.0071 - 12.0);
  float m1 = mac_fbm(wp.xz * 0.0062, 3);
  float m2 = mac_fbm(wp.zx * 0.0155 + 41.0, 2);
  float m3 = mac_fbm(wp.xz * 0.052 + 7.0, 2);
  float patchA = clamp(0.5 + 0.85*m1 + 0.35*m3 + 0.22*m0, 0.0, 1.0);
  float patchB = clamp(0.5 + 0.95*m2 - 0.25*m1 + 0.30*m3 + 0.34*m0, 0.0, 1.0);
  float patchC = clamp(0.5 + 0.80*m3 + 0.45*m1 - 0.30*m2 - 0.26*m0, 0.0, 1.0);

  float ao   = vExtra.x;
  float cav  = vExtra.y;

  // ---- near-field detail weights. Distance is now only a COST gate: the
  // visual gate is macBand() inside macRelief(). The windows are deliberately
  // short — the gravel and clod octaves are gone by 22 m and 48 m — because
  // beyond that they were never resolvable anyway, they were just aliasing.
  vec3 dw = vec3(
    1.0 - smoothstep(7.0, 22.0, camDist),
    1.0 - smoothstep(16.0, 48.0, camDist),
    1.0 - smoothstep(70.0, 260.0, camDist));
  float detailAmt = dw.x + dw.y + dw.z;
  // one more albedo-only octave that survives out to ~900 m. Normal-perturbing
  // that far is not worth the six extra noise taps, but without *some* tooth
  // the 200-900 m band renders as smeared sheets from above.
  float midW = 1.0 - smoothstep(300.0, 900.0, camDist);

  // ---- wetness. Pools by concavity and by its own noise field so puddles
  // gather in hollows instead of the whole world darkening uniformly.
  // \`wet\` is the damp-ground term; \`puddle\` is standing water, which needs a
  // FLAT normal and a mirror roughness or it just reads as a dark patch.
  float wet = 0.0, puddle = 0.0;
  if (uWet > 0.001) {
    float wetPatch = clamp(0.5 + 1.05*mac_fbm(wp.xz*0.026 + 91.0, 3), 0.0, 1.0);
    wet = clamp(uWet * (0.30 + 1.45*cav + 1.05*wetPatch - 1.45*slope), 0.0, 1.0);
    // Standing water. The mesh concavity term alone never fires on ground this
    // smooth (cav is ~0.1 almost everywhere), which is why the first attempt
    // produced no puddles at all. A dedicated ~9 m pooling field with a sharp
    // threshold gives discrete pools; slope still vetoes them hard, because
    // water on a hillside is a stain, not a puddle.
    float pf   = mac_fbm(wp.xz * 0.11 + 61.0, 2);
    float pool = 0.55*wetPatch + 1.9*cav + 0.95*pf - 2.6*slope;
    puddle = clamp(uWet * 1.25, 0.0, 1.0) * smoothstep(0.30, 0.62, pool);
  }

  // ---- perturbed normal (triplanar: up plane + dominant side plane).
  // The finite-difference step tracks the pixel footprint, so each pixel
  // measures the AVERAGE slope over its own footprint rather than sampling a
  // sub-pixel wavelength at a fixed 11 cm baseline. That fixed baseline was the
  // second half of the r1 ripple: it beat against the 0.95 m octave and turned
  // it into a regular interference pattern.
  vec3 Np = Nw;
  if (detailAmt > 0.004) {
    float e = clamp(px * 1.15, 0.055, 2.60);
    float upw = clamp(abs(Nw.y), 0.0, 1.0);
    float h0 = macRelief(wp.xz, dw, px);
    float hx = macRelief(wp.xz + vec2(e, 0.0), dw, px);
    float hz = macRelief(wp.xz + vec2(0.0, e), dw, px);
    vec3 gUp = vec3((hx - h0) / e, 0.0, (hz - h0) / e);

    // Most of the screen is near-horizontal ground, where the side projection
    // contributes almost nothing. Skipping it there halves the noise taps for
    // the majority of pixels and is worth ~15% of frame time on the wide shots.
    vec3 grad = gUp;
    if (upw < 0.94) {
      bool sideX = abs(Nw.x) > abs(Nw.z);
      vec2 sp = sideX ? wp.zy : wp.xy;
      float s0 = macRelief(sp, dw, px);
      float s1 = macRelief(sp + vec2(e, 0.0), dw, px);
      float s2 = macRelief(sp + vec2(0.0, e), dw, px);
      vec3 gSd = sideX
        ? vec3(0.0, (s2 - s0) / e, (s1 - s0) / e)
        : vec3((s1 - s0) / e, (s2 - s0) / e, 0.0);
      grad = mix(gSd, gUp, upw);
    }
    grad -= Nw * dot(Nw, grad);
    Np = normalize(Nw - grad * (0.90 * (1.0 - 0.75*wet)));
  }
  // standing water is level, whatever the dirt under it is doing
  if (puddle > 0.004) Np = normalize(mix(Np, vec3(0.0, 1.0, 0.0), puddle * 0.92));
  float slopeD = sqrt(clamp(1.0 - Np.y * Np.y, 0.0, 1.0));

  // ---- layer weights. Every threshold is offset by a patch mask so the
  // boundary meanders instead of following a contour line. The slope windows
  // are deliberately NARROW (r1 used 0.26->0.62, a 20-degree ramp, which meant
  // no pixel anywhere was fully rock and the whole valley averaged to one tan
  // grey). A steep mountain flank must reach rockW = 1.
  float alt = smoothstep(55.0, 165.0, wp.y);          // exposed bedrock uphill
  float rockW  = smoothstep(0.30, 0.50, slope + 0.20*(patchA - 0.5) + 0.14*alt);
  rockW = max(rockW, smoothstep(0.36, 0.62, slopeD) * 0.30);
  rockW = max(rockW, alt * smoothstep(0.16, 0.38, slope) * 0.85);
  float screeW = smoothstep(0.09, 0.26, slope) * (1.0 - 0.88*rockW) * (0.22 + 1.00*patchB);
  float dirtW  = smoothstep(0.38, 0.60, patchA) * (1.0 - 0.80*rockW);
  float vegW   = clamp(smoothstep(0.44, 0.66, patchB)
                     * (1.0 - rockW)
                     * (1.0 - smoothstep(0.24, 0.46, slope))
                     * (1.0 - 0.85*alt)
                     * (0.74 + 0.60*cav + 0.40*(patchC - 0.5)), 0.0, 1.0);
  vegW *= 1.0 - smoothstep(uSnowLine - 150.0, uSnowLine + 10.0, wp.y);

  // ---- palette, linear albedo. The spread between layers is what makes the
  // grass -> dirt -> scree -> rock progression legible at 1.7 m eye height, so
  // the value range is now ~4x from darkest (wet dirt) to lightest (dry sand)
  // and the hues genuinely diverge: vegetation is olive-green, rock is a cool
  // dark grey, scree is a pale warm grit. Mineral tones stay art-direction
  // neutral; clay and vegetation carry the warm/cold swing.
  float W = uWarmth;
  vec3 cSand  = mix(vec3(0.238, 0.244, 0.242), vec3(0.352, 0.268, 0.140), W);
  vec3 cClay  = mix(vec3(0.112, 0.119, 0.124), vec3(0.186, 0.126, 0.058), W);
  vec3 cDirt  = mix(vec3(0.030, 0.032, 0.032), vec3(0.052, 0.033, 0.016), W);
  vec3 cScree = mix(vec3(0.146, 0.154, 0.168), vec3(0.196, 0.160, 0.112), W);
  vec3 cRock  = mix(vec3(0.046, 0.052, 0.063), vec3(0.074, 0.062, 0.049), W);
  // Vegetation is olive, not lawn-green: the reference direction is FFXV arid
  // scrubland, where the living colour is a desaturated yellow-green sitting
  // barely above the dirt in value. Pushing G above R (the first r2 attempt)
  // turned the whole valley floor into a flat pea-green field.
  vec3 cVeg   = mix(vec3(0.029, 0.044, 0.031), vec3(0.086, 0.079, 0.031), W);
  vec3 cSnow  = vec3(0.50, 0.535, 0.600);

  vec3 alb = mix(cClay, cSand, smoothstep(0.44, 0.86, patchC));
  alb = mix(alb, cDirt,  dirtW);
  alb = mix(alb, cScree, screeW * 0.92);
  alb = mix(alb, cVeg,   vegW);
  alb = mix(alb, cRock,  rockW);

  // ---- per-square-metre variation: mineral streaks, damp stains, pebble
  // speckle. Uses a different frequency set from the relief field so the
  // colour breakup does not simply trace the bumps. Stain gets its OWN distance
  // window: the relief windows collapse by 48 m now, but albedo variation is
  // cheap and non-aliasing (macBand still guards it) and the mid ground needs
  // it out to a few hundred metres.
  vec3 sw = vec3(
    1.0 - smoothstep(10.0, 55.0, camDist),
    1.0 - smoothstep(40.0, 220.0, camDist),
    1.0 - smoothstep(160.0, 620.0, camDist));
  float stain = macStain(wp.xz, sw, midW, px);
  alb *= 1.0 + stain * 0.52;
  // Near-camera gravel speckle. Band limited and pulled in to 45 m: at 120 m
  // its 34 cm period was well under a pixel and just added grey mush.
  float near = (1.0 - smoothstep(9.0, 45.0, camDist)) * macBand(0.345, px);
  if (near > 0.01) {
    float speck = mac_snoise(wp.xz * 2.9 + 3.0);
    float fine  = mac_snoise(wp.xz * 7.4 - 11.0) * macBand(0.135, px);
    alb *= 1.0 + smoothstep(0.42, 0.94, speck) * 0.50 * near;
    alb *= 1.0 - smoothstep(0.32, 0.90, -speck) * 0.52 * near;
    alb *= 1.0 + fine * 0.26 * near;
  }

  // ---- snow / frost caps on the high ranges. Broken up by patch noise and
  // shed off anything steep, so the peaks keep visible rock ribs.
  float snowH = smoothstep(uSnowLine + 40.0 + 230.0*patchA, uSnowLine + 300.0, wp.y);
  float snowW = snowH * (1.0 - smoothstep(0.40, 0.78, slope)) * (0.20 + 0.80*patchB);
  alb = mix(alb, cSnow, snowW);

  // ---- wetness response.
  // Water does three things to dirt and r1 only did the first: it darkens the
  // albedo (light gets trapped between the grains), it collapses roughness so
  // the surface returns a real sky reflection, and where it stands it becomes a
  // separate specular surface. Standing water also shifts slightly cool-green
  // because you are looking THROUGH a film at the darkened ground.
  alb *= mix(1.0, 0.46, wet);
  alb = mix(alb, alb * vec3(0.62, 0.70, 0.78), puddle);
  float rough = mix(0.97, 0.68, rockW);
  rough = mix(rough, 0.92, vegW);
  rough = mix(rough, 0.84, snowW);
  rough = clamp(rough - stain * 0.22, 0.07, 1.0);
  // Damp dirt is smoother than dry dirt but nowhere near a mirror; only
  // standing water is. Collapsing the whole world to 0.16 made every wet pixel
  // sparkle at once, which reads as shimmer rather than water.
  rough = mix(rough, 0.42, wet);
  rough = mix(rough, 0.045, puddle);
  // F0. Dry dirt is a poor specular reflector; a wet film is water (F0 ~0.02)
  // over it, but the *visible* effect is a smooth interface, so lifting F0 with
  // wetness is what turns "darker" into "glossy". Consumed below.
  float macSpec = mix(0.028, 0.055, max(wet, puddle));

  // ---- occlusion: baked world-scale AO x local concavity x prop contact map
  vec2 cuv = (wp.xz - uContactOrigin) * uContactScale;
  float contact = 1.0;
  if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) {
    float edge = min(min(cuv.x, 1.0 - cuv.x), min(cuv.y, 1.0 - cuv.y));
    contact = mix(1.0, texture2D(uContact, cuv).r, smoothstep(0.0, 0.03, edge));
  }
  // Standing water reflects the open sky, so it must not inherit the hollow's
  // cavity darkening — a puddle in a dip is BRIGHTER than the dip, not darker.
  float occ = clamp(ao * (1.0 - 0.45*cav*(1.0 - puddle)) * contact, 0.05, 1.0);

  diffuseColor.rgb = alb;
  vec3 macNormalW = Np;
  float macRough = rough;
  float macOcc = occ;
  float macSpecF0 = macSpec;
  float macWater = puddle;
`;

export function createTerrainMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });
  mat.fog = true;                // Atmosphere module keys its aerial term off this
  mat.userData.macrionUniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec2 aExtra;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vExtra;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vExtra = aExtra;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vExtra;
        uniform float uWarmth;
        uniform float uWet;
        uniform float uSnowLine;
        uniform sampler2D uContact;
        uniform vec2 uContactOrigin;
        uniform float uContactScale;
        ${GLSL_NOISE}
        /**
         * Screen-space band limit. \`wl\` is the octave's world-space wavelength,
         * \`px\` the world size of one pixel here. Returns 0 once the octave is
         * finer than ~2.5 px and 1 once it spans ~6 px, so an octave fades out
         * BEFORE it can alias rather than after. Same idea as \`minWl\` in
         * noise.js's fbm(), moved from mesh LOD down into the fragment.
         */
        float macBand(float wl, float px){
          return smoothstep(2.5, 6.0, wl / max(px, 1e-5));
        }
        /**
         * Relief height, in metres. Amplitude ~ 1/frequency so every octave
         * contributes the same surface slope; each is independently band
         * limited, so whatever survives at a given distance is still broadband.
         *
         * The r1 version had a single 0.95 m tap at amplitude 0.105 — a surface
         * slope of ~0.7, four times any other octave — carried out to 130 m by
         * a world-space distance fade alone. That one octave IS the corduroy
         * both critics flagged. It is now a 2-octave pair at a third the
         * amplitude, spread over 1.2 m and 2.4 m.
         */
        float macRelief(vec2 p, vec3 w, float px){
          float r = 0.0;
          float a = w.x * macBand(0.238, px);       // grit, ~24 cm
          if (a > 0.003) r += a * 0.026 * mac_snoise(p * 4.2);
          if (w.y > 0.003) {                        // clods, 1.2 m + 2.4 m pair
            r += w.y * macBand(1.176, px) * 0.020 * mac_snoise(p * 0.85 + 21.0);
            r += w.y * macBand(2.381, px) * 0.045 * mac_snoise(p * 0.42 + 5.0);
          }
          float c = w.z * macBand(4.167, px);       // scree folds, ~4 m
          if (c > 0.003) r += c * 0.235 * mac_snoise(p * 0.24 + 19.0);
          return r;
        }
        // albedo stains: deliberately different frequencies from the relief.
        // The last octave has no distance gate but sits at a ~50 m wavelength,
        // which stays several pixels wide even on a 3 km ridge — the earlier
        // ungated 8 m octave aliased into visible mottling on the far peaks.
        float macStain(vec2 p, vec3 w, float mid, float px){
          return w.x * 0.30 * macBand(0.392, px) * mac_snoise(p * 2.55 + 31.0)
               + w.y * 0.22 * macBand(1.961, px) * mac_snoise(p * 0.51 - 13.0)
               + w.z * 0.28 * macBand(8.696, px) * mac_snoise(p * 0.115 + 47.0)
               + mid * 0.24 * mac_snoise(p * 0.070 - 5.0)
               + 0.30 * mac_snoise(p * 0.021 + 61.0);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = macRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(macNormalW, 0.0)).xyz);')
      // Raise F0 with wetness. Three fixes F0 at 0.04 for a standard material,
      // which is why a "wet" surface with low roughness still returned almost
      // no sheen — the roughness collapse had nothing to reflect with.
      .replace('#include <lights_physical_fragment>', /* glsl */`
        #include <lights_physical_fragment>
        material.specularColor = vec3(macSpecF0);
      `)
      .replace('#include <aomap_fragment>', /* glsl */`
        #include <aomap_fragment>
        reflectedLight.indirectDiffuse *= macOcc;
        // Specular occlusion is dropped over standing water: the whole point of
        // a puddle is that it mirrors the sky the AO term is trying to hide.
        reflectedLight.indirectSpecular *= mix(mix(1.0, macOcc, 0.7), 1.0, macWater);
        // Direct light gets a share of the occlusion too. Under a high sun the
        // direct term dominates, and an AO that only touches ambient leaves
        // every prop looking pasted on at midday.
        reflectedLight.directDiffuse *= mix(1.0, macOcc, 0.55);
      `);
  };
  return applyAtmosphere(mat);
}

/* --------------------------------------------------------------- */
/* Contact map — soft dark footprints where props meet the ground   */
/* --------------------------------------------------------------- */

export function createContactMap(half = 280, size = 1024) {
  const data = new Uint8Array(size * size).fill(255);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const px = size / (half * 2);
  return {
    texture, data, size, half,
    /** Splat a soft radial darkening at world (x, z). `strength` 0..1. */
    splat(x, z, radius, strength) {
      const cx = (x + half) * px, cy = (z + half) * px;
      const r = radius * px;
      if (r < 0.3) return;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
      const inv = 1 / r;
      for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5 - cy) * inv;
        for (let xi = x0; xi <= x1; xi++) {
          const dx = (xi + 0.5 - cx) * inv;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const t = 1 - Math.sqrt(d2);
          const f = 1 - strength * t * t * (3 - 2 * t);
          const k = y * size + xi;
          const v = data[k] * f;
          data[k] = v < 0 ? 0 : v;
        }
      }
    },
    commit() { texture.needsUpdate = true; },
  };
}
