/**
 * Macrion — post chain.  Owned by the Atmosphere builder.
 *
 * The engine renders through an EffectComposer, which means the scene lands in
 * a half-float render target.  Three skips `<tonemapping_fragment>` whenever the
 * destination is a render target, so the scene stays **linear HDR** all the way
 * to OutputPass.  That is what makes a >1.0 bloom threshold meaningful: only
 * pixels that are genuinely brighter than diffuse white (sun disc, specular
 * hits, sunlit haze) bloom at all.
 *
 *   RenderPass        scene -> linear HDR
 *   UnrealBloomPass   soft-knee prefilter (see installSoftKneeBloom), tight radius
 *   OutputPass        ACES filmic + sRGB encode (exposure driven by sky.js)
 *   GradePass         lift / split-tone / contrast / vignette / dither
 *   SMAAPass          AA (the renderer is created with antialias:false)
 *
 * The grade is weather-aware — warm split-tone at golden hour, cool cyan shadow
 * tone under overcast and storm, a deeper cool tone at night — because one fixed
 * grade cannot serve both reference art directions.
 *
 * MEASURED SCENE RANGE (1080p, r1 geometry, linear HDR at the composer input).
 * Peak radiance per shot, which is what the bloom threshold has to be set
 * against — re-measure before retuning, do not guess:
 *
 *   grazing 2.29 | overcast 0.74 | vista 0.57 | eye 0.52 | dawn 0.48
 *   storm/topdown 0.44 | backlit 0.40 | night 0.28 (at exposure 6.5)
 *
 * Sunlit diffuse white lands ~0.35-0.55. Only the sun/moon disc itself and the
 * forward-scatter lobe immediately around it go meaningfully above 1.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SceneDepthPass, AOCompositePass } from './ao.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFloor: { value: new THREE.Vector3(0.036, 0.043, 0.056) },
    uShadowTint: { value: new THREE.Vector3(0.006, 0.013, 0.028) },
    uHighTint: { value: new THREE.Vector3(1.04, 1.005, 0.945) },
    uShadowSat: { value: 0.80 },
    uSat: { value: 1.05 },
    uContrast: { value: 1.07 },
    uVignette: { value: 0.30 },
    uDither: { value: 0.0055 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3  uFloor;
    uniform vec3  uShadowTint;
    uniform vec3  uHighTint;
    uniform float uShadowSat;
    uniform float uSat;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uDither;
    varying vec2 vUv;

    float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = luma( c );
      float sw = 1.0 - smoothstep( 0.0, 0.44, l );   // shadow weight
      float hw = smoothstep( 0.50, 1.0, l );         // highlight weight

      // split toning
      c += uShadowTint * sw;
      c *= mix( vec3( 1.0 ), uHighTint, hw );

      // shadows lose a little saturation, then a global trim
      float l2 = luma( c );
      c = mix( c, mix( vec3( l2 ), c, uShadowSat ), sw );
      c = mix( vec3( luma( c ) ), c, uSat );

      // gentle S about a filmic pivot
      c = ( c - 0.40 ) * uContrast + 0.40;

      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * dot( q, q ) * 1.85;

      // Lifted, tinted black floor — applied AFTER the vignette, or the corners
      // sink back below it and the frame gets crushed corners.
      c = uFloor + max( c, vec3( 0.0 ) ) * ( 1.0 - uFloor );

      // hash dither after tonemapping — kills 8-bit banding in sky gradients
      float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      float n2 = fract( sin( dot( gl_FragCoord.yx, vec2( 39.3468, 11.135 ) ) ) * 24634.6345 );
      c += ( vec3( n, n2, n * 0.5 + n2 * 0.5 ) - 0.5 ) * uDither;

      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
    }
  `,
};

/**
 * Replace UnrealBloomPass's high-pass prefilter.
 *
 * three ships `LuminosityHighPassShader`, which does
 *     alpha = smoothstep( threshold, threshold + 0.01, luma );
 *     out   = mix( black, texel, alpha );
 * — i.e. wherever a pixel clears the threshold it contributes its **whole**
 * value to the blur chain, not the energy above the threshold. The composite
 * then sums five mips whose lerped factors always total 3.0, so the effective
 * gain on that region is 3 x strength.
 *
 * That is fine for a point highlight and catastrophic for a broad one. In r1
 * `grazing` had an 880 px band of forward-scattered sky sitting between 1.0 and
 * 1.5; every pixel of it injected its full radiance, bloom multiplied the band
 * by ~1.7, and ACES flattened the result into the featureless white plate the
 * critic flagged. Meanwhile the other eight shots peak at 0.28-0.74, so bloom
 * was doing nothing at all in them — the pass only ever fired to damage a frame.
 *
 * The replacement is the standard quadratic soft knee (Karis / COD):
 *   - only the energy ABOVE the threshold survives, so a pixel at 1.05 against a
 *     threshold of 1.0 contributes 0.05, not 1.05, and a broad just-over-the-line
 *     region stops behaving like a light source;
 *   - the knee makes the cutoff C1-continuous, so a moving highlight fades in
 *     instead of popping a hard-edged blob into the mip chain;
 *   - `uClamp` caps what any single texel may inject. The sun disc renders at
 *     ~40x diffuse white; without the cap it smears that across the whole mip
 *     pyramid. With it the disc blooms tightly and intensely rather than
 *     broadly and flatly, which is the actual brief.
 *
 * Tested on max-channel rather than luma so a saturated low-sun disc, whose blue
 * channel is nearly extinct, still reads as bright.
 */
function installSoftKneeBloom(bloom) {
  const u = bloom.highPassUniforms;
  u.uKnee = { value: 0.55 };   // knee half-width, as a fraction of the threshold
  u.uClamp = { value: 3.0 };   // ceiling on one texel's contribution to the blur
  const m = bloom.materialHighPassFilter;
  m.uniforms = u;
  m.fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float uKnee;
    uniform float uClamp;
    varying vec2 vUv;

    void main() {
      vec3 c = max( texture2D( tDiffuse, vUv ).rgb, vec3( 0.0 ) );
      float v = max( max( c.r, c.g ), c.b );
      float t = luminosityThreshold;
      float k = max( t * uKnee, 1e-4 );

      // quadratic soft knee over [t-k, t+k], linear excess above it
      float soft = clamp( v - t + k, 0.0, 2.0 * k );
      soft = soft * soft / ( 4.0 * k );
      vec3 o = c * ( max( soft, v - t ) / max( v, 1e-4 ) );

      float m = max( max( o.r, o.g ), o.b );
      gl_FragColor = vec4( o * min( 1.0, uClamp / max( m, 1e-4 ) ), 1.0 );
    }
  `;
  m.needsUpdate = true;
  return u;
}

export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  // The scene gets its own target so we keep a readable depth buffer without a
  // second geometry pass, and so the AO shader is never sampling a texture that
  // is still bound as the current framebuffer's depth attachment.
  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y);
  sceneRT.depthTexture.type = THREE.UnsignedIntType;
  sceneRT.depthTexture.minFilter = THREE.NearestFilter;
  sceneRT.depthTexture.magFilter = THREE.NearestFilter;

  composer.addPass(new SceneDepthPass(scene, camera, sceneRT));

  const ao = new AOCompositePass(sceneRT, camera);
  ao.setSize(size.x, size.y);
  composer.addPass(ao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.60, 0.16, 2.30);
  const bloomU = installSoftKneeBloom(bloom);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const smaa = new SMAAPass(size.x, size.y);
  composer.addPass(smaa);

  const G = grade.uniforms;

  function applyGrade(c) {
    const a = c.engine?.atmo;
    if (!a) return;
    const { lowSun, nightF, overF, dayF, hazeF = 0 } = a;
    const golden = clamp(lowSun * dayF * (1 - overF), 0, 1);

    // base: neutral daylight
    let shadowTint = [0.005, 0.011, 0.024];
    let highTint = [1.020, 1.000, 0.975];
    let sat = 1.06, contrast = 1.11, shadowSat = 0.82, vig = 0.28;
    let floorC = [0.030, 0.036, 0.048];

    // golden hour: warm highlights, only *slightly* cool shadows. FFXV's
    // golden-hour blacks measure warm-neutral, not video-game blue.
    shadowTint = mix3(shadowTint, [0.010, 0.012, 0.022], golden);
    highTint = mix3(highTint, [1.075, 0.998, 0.872], golden);
    sat = lerp(sat, 1.14, golden);
    contrast = lerp(contrast, 1.13, golden);
    floorC = mix3(floorC, [0.040, 0.036, 0.038], golden);

    // haze / mist: cold, low saturation, more contrast to claw back range
    shadowTint = mix3(shadowTint, [0.004, 0.014, 0.026], hazeF);
    highTint = mix3(highTint, [0.980, 0.998, 1.028], hazeF);
    sat = lerp(sat, 0.88, hazeF);
    contrast = lerp(contrast, 1.16, hazeF);
    shadowSat = lerp(shadowSat, 0.74, hazeF);
    floorC = mix3(floorC, [0.026, 0.034, 0.048], hazeF);

    // overcast / storm: cyan shadow tone, desaturated, heavier vignette
    shadowTint = mix3(shadowTint, [0.004, 0.015, 0.024], overF);
    highTint = mix3(highTint, [0.978, 1.000, 1.034], overF);
    sat = lerp(sat, 0.84, overF);
    contrast = lerp(contrast, 1.19, overF);
    shadowSat = lerp(shadowSat, 0.70, overF);
    vig = lerp(vig, 0.44, overF);
    floorC = mix3(floorC, [0.026, 0.034, 0.050], overF);

    // night: deep cool blue, low saturation, lifted so nothing crushes
    shadowTint = mix3(shadowTint, [0.006, 0.015, 0.042], nightF);
    highTint = mix3(highTint, [0.920, 0.975, 1.130], nightF);
    sat = lerp(sat, 0.84, nightF);
    contrast = lerp(contrast, 1.09, nightF);
    shadowSat = lerp(shadowSat, 0.70, nightF);
    vig = lerp(vig, 0.48, nightF);
    floorC = mix3(floorC, [0.026, 0.036, 0.060], nightF);

    G.uShadowTint.value.set(...shadowTint);
    G.uHighTint.value.set(...highTint);
    G.uFloor.value.set(...floorC);
    G.uSat.value = sat;
    G.uContrast.value = contrast;
    G.uShadowSat.value = shadowSat;
    G.uVignette.value = vig;
    G.uDither.value = 0.0055;

    // Bloom keys off the disc, NOT off bright sky. Measured peaks (see header)
    // put sunlit diffuse white near 0.5 and the near-sun forward-scatter lobe at
    // 1.0-1.5, so a threshold above that band leaves the sky alone and lets only
    // the disc and true speculars glow. Night runs at exposure 6.5 with a much
    // dimmer scene, so its threshold has to come down with it or the moon,
    // which peaks around 1.4, never blooms at all.
    bloom.threshold = lerp(lerp(2.30, 1.70, overF), 0.80, nightF);
    // Strength is against *excess* energy now, not total, so the nominal number
    // is higher than r1's while the delivered bloom is far smaller.
    bloom.strength = lerp(0.60, 0.42, overF) + golden * 0.22 + nightF * 0.16;
    // The five mip factors always sum to 3.0; radius only redistributes weight
    // between them. Low radius = weight on mip0 = tight kernel. r1 sat at
    // 0.30-0.42, which put ~half the energy in the 1/32-res mip — a 350 px
    // smear. Keep it tight and let the disc carry intensity instead.
    bloom.radius = lerp(0.15, 0.26, golden + nightF * 0.5);
    bloomU.uClamp.value = lerp(3.0, 2.0, nightF);

    // AO carries more of the shading when the sun is weak and the env map is
    // doing the work — which is exactly the overcast / storm / night case.
    const aoU = ao.material.uniforms;
    aoU.uIntensity.value = 0.80 + overF * 0.35 + nightF * 0.20;
    aoU.uRadius.value = lerp(1.1, 1.5, overF);
    aoU.uTint.value.set(
      lerp(0.66, 0.58, overF + nightF * 0.5),
      lerp(0.72, 0.66, overF + nightF * 0.5),
      lerp(0.86, 0.84, overF)
    );
  }

  applyGrade(ctx);

  // renderer.info resets at the top of every renderer.render(), and a composer
  // frame is many renders — so the engine's stats() would otherwise report the
  // final 1-quad pass. Take manual control and reset once per frame instead, so
  // drawCalls/triangles describe the whole frame (shadow cascades included).
  renderer.info.autoReset = false;

  return {
    name: 'post',
    composer,
    onSun(c) { applyGrade(c); },
    onWeather(c) { applyGrade(c); },
    update() { renderer.info.reset(); },
    onResize(w, h) {
      composer.setSize(w, h);
      sceneRT.setSize(w, h);
      ao.setSize(w, h);
      bloom.setSize(w, h);
      smaa.setSize(w, h);
    },
  };
}
