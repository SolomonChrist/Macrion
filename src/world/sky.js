/**
 * Macrion — sky, sun/moon, cascaded shadows, image-based ambient and aerial
 * perspective.  Owned by the Atmosphere builder.
 *
 * ===========================================================================
 * FOR OTHER BUILDERS — how to get aerial perspective on your materials
 * ===========================================================================
 *
 *   import { applyAtmosphere } from '../world/sky.js';
 *   applyAtmosphere( myMaterial );
 *
 * That single call gives a material:
 *   - scattering-based aerial perspective (fog colour sampled from the sky in
 *     the view direction, inscattering-weighted by sun angle, with a
 *     ground-hugging haze layer so valleys pool), and
 *   - cascaded-shadow-map support (3 cascades, 300 m, texel-snapped).
 *
 * It is idempotent, chains onto any `onBeforeCompile` you already installed,
 * and re-applies itself if you replace `onBeforeCompile` later.  You do not
 * *have* to call it: sky's update() walks the scene every frame and patches any
 * material it has not seen.  Calling it explicitly just avoids one frame of
 * shader recompile.  Set `material.__macrionOptOut = true` to be left alone
 * (you then must also not set `material.fog`, or the shader will reference
 * uniforms that were never bound).
 *
 * Dials come from `ctx.weather` (see WEATHER in core/engine.js):
 *   turbidity -> Mie coefficient + multiple-scattering fudge in the sky model
 *   cloud     -> procedural cloud deck coverage/darkness
 *   haze      -> aerial perspective density multiplier (0.55 clear .. 2.40 storm)
 *   sunMul    -> direct sun intensity multiplier (0.12 at storm: env map carries the scene)
 *
 * Determinism: no time term anywhere in this module. All noise is hash-based on
 * world/view position. Same (shot, hour, weather) -> bit-identical frame.
 */
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import {
  SKY_DOME_VERT, SKY_DOME_FRAG, AERIAL_LUT_VERT, AERIAL_LUT_FRAG,
} from './sky/atmosphere.glsl.js';
import {
  atmoUniforms, applyAtmosphere, injectAerialChunks, patchScene, CASCADES,
} from './sky/aerial.js';

export { applyAtmosphere };

injectAerialChunks();

const SUN_BASE = 4.6;          // DirectionalLight intensity at zenith, clear
const MOON_BASE = 0.62;
const SKY_LUM = 11.0;          // radiance scale for the sun-lit sky
const MOON_LUM = SKY_LUM * 0.0055;
const SHADOW_FAR = 300;        // cascade coverage in metres
/**
 * Per-cascade shadow map size. Measured on this scene, shadow-map *fill* is the
 * single dominant cost of the whole frame (the depth pass runs an expensive
 * alpha-tested fragment shader): 3x2048 costs ~14 ms more than 3x512. Fill
 * scales with texel count and is independent of the world area a cascade
 * covers, so spending the texels on the near cascade is free quality.
 */
const SHADOW_RES = [2048, 1280, 1024];

// vertical optical depths (beta * scale height)
const TAU_R = [0.0464, 0.1080, 0.2648];
const TAU_M = 0.0252;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Kasten-Young relative air mass, clamped so it stays finite at the horizon. */
function airMass(elevRad) {
  const deg = Math.max(elevRad * 180 / Math.PI, 0.6);
  return 1 / (Math.sin(deg * Math.PI / 180) + 0.15 * Math.pow(deg + 3.885, -1.253));
}

/** Direct-beam transmittance through the atmosphere -> sun colour + strength. */
function beamTransmittance(elevRad, mieScale, out) {
  const am = airMass(elevRad);
  return out.setRGB(
    Math.exp(-(TAU_R[0] + TAU_M * mieScale) * am),
    Math.exp(-(TAU_R[1] + TAU_M * mieScale) * am),
    Math.exp(-(TAU_R[2] + TAU_M * mieScale) * am),
    THREE.LinearSRGBColorSpace
  );
}

export function createSky(ctx) {
  const { scene, renderer, camera } = ctx;
  const group = new THREE.Group();
  group.name = 'sky';

  // USE_FOG must be defined for our aerial-perspective chunks to compile in.
  // The values are ignored — our override never reads fogColor/fogDensity.
  scene.fog = new THREE.FogExp2(0x000000, 0.00001);

  // ------------------------------------------------------------- uniforms --
  const keyAz = new THREE.Vector2(0, 1);
  atmoUniforms.uAerialKeyAz.value = keyAz;

  const U = {
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyLum: { value: SKY_LUM },
    uKeyTint: { value: new THREE.Color(1, 1, 1) },
    uMieScale: { value: 1.7 },
    uMieG: { value: 0.76 },
    uMS: { value: 0.08 },
    uNightBase: { value: new THREE.Color(0, 0, 0) },
    uStarAmt: { value: 0 },
    uCloud: { value: 0.1 },
    uCloudLit: { value: new THREE.Color(1, 1, 1) },
    uCloudDark: { value: new THREE.Color(0.2, 0.24, 0.32) },
    uCloudOpacity: { value: 0.9 },
    uCloudShadowDir: { value: new THREE.Vector2(0, 1) },
    uDiscDir: { value: new THREE.Vector3(0, 1, 0) },
    uDiscColor: { value: new THREE.Color(0, 0, 0) },
    uDiscSize: { value: Math.cos(0.0085) },
    uDiscHalo: { value: 0.030 },
    uHaloK: { value: 0.05 },
    uGroundTint: { value: new THREE.Color(0.40, 0.38, 0.35) },
    uKeyAzXZ: { value: keyAz },
    // highlight shoulder — see macRolloff() in atmosphere.glsl.js
    uSkyKnee: { value: 0.42 },
    uSkyMax: { value: 1.90 },
    uSkyWarm: { value: 2.2 },
    uSkyTint: { value: new THREE.Color(1, 1, 1) },
  };

  // --------------------------------------------------------------- dome ----
  const domeGeo = new THREE.SphereGeometry(4200, 40, 24);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: SKY_DOME_VERT,
    fragmentShader: SKY_DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: true,
  });
  domeMat.__macrionOptOut = true;

  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = 1000;      // drawn last among opaques so terrain z-rejects it
  dome.frustumCulled = false;
  group.add(dome);

  // A second dome in its own scene, for PMREM. Shares geometry + material.
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(domeGeo, domeMat);
  envDome.frustumCulled = false;
  envScene.add(envDome);

  // ---------------------------------------------- aerial perspective LUT ----
  const lutRT = new THREE.WebGLRenderTarget(128, 64, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  lutRT.texture.wrapS = THREE.ClampToEdgeWrapping;
  lutRT.texture.wrapT = THREE.ClampToEdgeWrapping;
  lutRT.texture.colorSpace = THREE.NoColorSpace;
  atmoUniforms.uAerialLUT.value = lutRT.texture;

  const lutScene = new THREE.Scene();
  const lutMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: AERIAL_LUT_VERT,
    fragmentShader: AERIAL_LUT_FRAG,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  lutMat.__macrionOptOut = true;
  const lutQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lutMat);
  lutQuad.frustumCulled = false;
  lutScene.add(lutQuad);
  const lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------------------------------------------------------------- CSM ----
  const csm = new CSM({
    camera,
    parent: group,
    cascades: CASCADES,
    maxFar: SHADOW_FAR,
    mode: 'custom',
    customSplitsCallback: (amount, near, far, target) => {
      target.length = 0;
      target.push(18 / SHADOW_FAR, 72 / SHADOW_FAR, 1);
    },
    shadowMapSize: SHADOW_RES[0],
    shadowBias: -0.0004,
    lightIntensity: SUN_BASE,
    lightNear: 1,
    lightFar: 1600,
    lightMargin: 500,
    lightDirection: new THREE.Vector3(0, -1, 0),
  });
  for (let i = 0; i < csm.lights.length; i++) {
    const r = SHADOW_RES[i] ?? SHADOW_RES[SHADOW_RES.length - 1];
    csm.lights[i].shadow.mapSize.set(r, r);
    csm.lights[i].shadow.camera.updateProjectionMatrix();
  }
  tuneShadowBias();

  function tuneShadowBias() {
    for (let i = 0; i < csm.lights.length; i++) {
      const l = csm.lights[i];
      const c = l.shadow.camera;
      const res = SHADOW_RES[i] ?? SHADOW_RES[SHADOW_RES.length - 1];
      const texel = (c.right - c.left) / res;
      // Bias has to track texel size or the far cascade acnes while the near
      // cascade peter-pans. normalBias is in world units, so it scales directly.
      l.shadow.normalBias = Math.max(0.02, texel * 1.8);
      l.shadow.bias = -0.00016 - texel * 0.00022;
      l.shadow.radius = 2.0;
    }
  }

  // -------------------------------------------------------------- PMREM ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envCache = new Map();
  const envOrder = [];

  function envFor(key) {
    if (envCache.has(key)) return envCache.get(key);
    const rt = pmrem.fromScene(envScene, 0, 1, 20000);
    envCache.set(key, rt);
    envOrder.push(key);
    while (envOrder.length > 14) {
      const old = envOrder.shift();
      envCache.get(old)?.dispose();
      envCache.delete(old);
    }
    return rt;
  }

  // ----------------------------------------------------------- state -------
  const _t = new THREE.Color();
  const _moon = new THREE.Vector3();
  const sunLight = csm.lights[0];
  let lastFov = -1, lastAspect = -1;

  function applyState(c) {
    const w = c.weather ?? { cloud: 0.1, turbidity: 2.2, haze: 0.55, sunMul: 1 };
    const sun = c.sunDir;
    const el = sun.y;                                   // sin(elevation)
    const elRad = Math.asin(clamp(el, -1, 1));

    const dayF = smoothstep(-0.09, 0.13, el);          // 1 fully day
    const nightF = 1 - smoothstep(-0.16, 0.02, el);    // 1 fully night
    const lowSun = 1 - smoothstep(0.02, 0.45, el);     // 1 at the horizon
    const overF = smoothstep(0.55, 1.0, w.cloud);      // overcast / storm
    const hazeF = smoothstep(0.6, 1.9, w.haze);        // milky / cold-highland axis

    const mieScale = 0.35 + w.turbidity * 0.38;
    U.uMieScale.value = mieScale;
    U.uMS.value = 0.011 + w.turbidity * 0.0072;
    U.uMieG.value = lerp(0.78, 0.62, overF);

    // ---- key scatterer: sun by day, moon by night
    // The moon rides its own arc: it keeps the sun's azimuth but sits at a fixed
    // low elevation, so it is actually *in frame* at night and throws long,
    // readable shadows instead of a flat overhead wash.
    const isNight = nightF > 0.5;
    {
      const hz = Math.hypot(sun.x, sun.z) || 1;
      const ce = Math.cos(0.30), se = Math.sin(0.30);   // ~17 degrees
      _moon.set((sun.x / hz) * ce, se, (sun.z / hz) * ce).normalize();
    }
    const keyDir = isNight ? _moon : sun;
    U.uKeyDir.value.copy(keyDir);
    U.uKeyLum.value = isNight ? MOON_LUM : SKY_LUM * lerp(1.0, 0.55, overF);
    U.uKeyTint.value.setRGB(
      isNight ? 0.70 : 1.0, isNight ? 0.82 : 1.0, isNight ? 1.18 : 1.0,
      THREE.LinearSRGBColorSpace
    );

    const az = Math.hypot(keyDir.x, keyDir.z);
    if (az > 1e-4) keyAz.set(keyDir.x / az, keyDir.z / az); else keyAz.set(0, 1);
    U.uCloudShadowDir.value.copy(keyAz);

    // ---- airglow floor: night is never black
    const nb = nightF * 0.9;
    U.uNightBase.value.setRGB(0.0034 * nb, 0.0050 * nb, 0.0115 * nb, THREE.LinearSRGBColorSpace);
    U.uStarAmt.value = nightF * (1 - clamp(w.cloud, 0, 1) * 0.85);

    // ---- direct beam colour
    beamTransmittance(Math.max(elRad, 0.008), mieScale, _t);
    const tmax = Math.max(_t.r, _t.g, _t.b, 1e-4);

    // ---- clouds
    U.uCloud.value = w.cloud;
    U.uCloudOpacity.value = w.cloud < 0.03 ? 0 : lerp(0.80, 1.0, overF);
    const litK = lerp(2.1, 0.30, overF) * (0.06 + 1.6 * dayF) + nightF * 0.009;
    U.uCloudLit.value.setRGB(_t.r * litK, _t.g * litK, _t.b * litK, THREE.LinearSRGBColorSpace);
    // Underside is tied to the top, not authored independently — a 15:1 ratio
    // reads as a punchy cumulus field even when the dial says "overcast".
    const darkRatio = lerp(0.15, 0.52, overF);
    const amb = 0.010 * (0.05 + dayF) * lerp(1, 1.8, overF);
    U.uCloudDark.value.setRGB(
      _t.r * litK * darkRatio + amb * 0.60,
      _t.g * litK * darkRatio + amb * 0.78,
      _t.b * litK * darkRatio + amb * 1.15,
      THREE.LinearSRGBColorSpace
    );

    // ---- disc
    const cloudBlock = 1 - clamp(w.cloud * U.uCloudOpacity.value, 0, 1) * 0.97;
    if (isNight) {
      U.uDiscDir.value.copy(_moon);
      U.uDiscSize.value = Math.cos(0.0115);
      // Wide, soft halo carries the glow; the disc itself stays only just over
      // the bloom threshold, or ACES clamps a big region to flat white and the
      // bloom kernel's separable profile shows up as a rounded square.
      U.uDiscHalo.value = 0.130;
      U.uHaloK.value = 0.30;
      const m = 1.15 * cloudBlock;
      U.uDiscColor.value.setRGB(0.90 * m, 0.98 * m, 1.25 * m, THREE.LinearSRGBColorSpace);
    } else {
      U.uDiscDir.value.copy(sun);
      U.uDiscSize.value = Math.cos(0.0080);
      U.uDiscHalo.value = lerp(0.022, 0.055, lowSun);
      U.uHaloK.value = 0.035;
      const s = 40 * dayF * cloudBlock * lerp(1, 0.30, overF);
      U.uDiscColor.value.setRGB(_t.r * s, _t.g * s, _t.b * s, THREE.LinearSRGBColorSpace);
    }
    U.uGroundTint.value.setRGB(
      lerp(0.30, 0.15, nightF), lerp(0.29, 0.16, nightF), lerp(0.29, 0.21, nightF),
      THREE.LinearSRGBColorSpace
    );

    // ---- highlight shoulder on the sky (see macRolloff in atmosphere.glsl.js)
    // Measured: the forward-scatter wedge around the sun reaches ~1.5 while the
    // rest of the dome sits near 0.15. The knee has to sit below that wedge, or
    // ACES turns all of it into the same neutral white plate.
    if (isNight) {
      // Night peaks around 0.28 before an exposure of 6.5, so a knee above
      // anything in frame disables the shoulder rather than tinting starlight.
      U.uSkyKnee.value = 6.0;
      U.uSkyMax.value = 8.0;
      U.uSkyWarm.value = 0;
      U.uSkyTint.value.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    } else {
      U.uSkyKnee.value = lerp(0.42, 0.60, overF);
      U.uSkyMax.value = lerp(1.90, 1.55, overF);
      // Low sun already reddens the scattering integral on its own, and its
      // beam tint is extreme (blue down to ~0.28 of red at dawn), so ease off
      // there or the aureole goes to a flat orange poster.
      U.uSkyWarm.value = lerp(2.2, 0.7, lowSun) * lerp(1.0, 0.45, overF);
      U.uSkyTint.value.setRGB(_t.r / tmax, _t.g / tmax, _t.b / tmax,
        THREE.LinearSRGBColorSpace);
    }

    // ---- aerial perspective density
    const haze = w.haze;
    // Rayleigh-ish air: blue extincts ~4x faster than red -> distant desaturation
    const air = 0.00040 * haze;
    atmoUniforms.uAerialBetaAir.value.set(air * 0.42, air * 1.00, air * 2.30);
    atmoUniforms.uAerialAirH.value = lerp(1300, 800, smoothstep(0.5, 2.4, haze));
    // ground-hugging haze — pools in valleys, thickest at dawn and in storms
    const hz = 0.00085 * haze * lerp(1.0, 2.1, nightF * 0.0 + smoothstep(0.05, 0.28, lowSun) * 0.55 + overF * 0.45);
    atmoUniforms.uAerialBetaHaze.value.set(hz * 0.94, hz * 0.98, hz * 1.04);
    atmoUniforms.uAerialHazeH.value = lerp(70, 150, smoothstep(0.5, 2.4, haze));
    atmoUniforms.uAerialHazeBase.value = -8;

    // ---- key light
    csm.lightDirection.copy(keyDir).negate().normalize();
    let col, inten;
    if (isNight) {
      col = [0.48, 0.63, 1.0];
      inten = MOON_BASE * lerp(1, 0.25, overF) * nightF;
    } else {
      col = [_t.r / tmax, _t.g / tmax, _t.b / tmax];
      inten = SUN_BASE * tmax * (w.sunMul ?? 1) * smoothstep(-0.03, 0.10, el);
    }
    for (const l of csm.lights) {
      l.color.setRGB(col[0], col[1], col[2], THREE.LinearSRGBColorSpace);
      l.intensity = inten;
    }
    csm.update();

    // ---- LUT (must run before PMREM so the env sees the same state)
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(lutRT);
    renderer.render(lutScene, lutCam);
    renderer.setRenderTarget(prevRT);

    // ---- image-based ambient
    const key = `${Math.round(c.hour * 4) / 4}|${c.weatherName ?? 'clear'}`;
    scene.environment = envFor(key).texture;
    scene.environmentIntensity = lerp(1.0, 1.60, overF) * lerp(1.0, 2.6, nightF);

    // ---- exposure
    // Haze raises scene luminance on its own, so hazy/overcast/storm pull the
    // exposure *down* — otherwise they all converge on the same milky mid-grey
    // instead of separating into "bright dusty" vs "cold dark highland".
    const base = 1.05 * lerp(1.0, 1.22, overF) * lerp(1.0, 0.88, hazeF);
    // Golden hour opens up; hazy golden hour opens up less, or dawn goes milky.
    const gold = lowSun * dayF * (1 - 0.45 * hazeF);
    let exposure = base * lerp(1.0, 1.72, gold);
    exposure = lerp(exposure, 6.5, nightF);
    renderer.toneMappingExposure = exposure;

    // publish for the post module
    c.engine.atmo = {
      dayF, nightF, lowSun, overF, hazeF, exposure,
      sunColor: col, sunIntensity: inten, weather: w,
    };
  }

  applyState(ctx);

  // Safety net: any material that reaches a render without having been patched
  // would reference unbound uniforms and throw. Patch immediately pre-render.
  const prevOBR = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    patchScene(scene);
    prevOBR?.apply(this, args);
  };

  return {
    name: 'sky',
    object3D: group,
    sunLight,
    csm,

    onSun(c) { applyState(c); },
    onWeather(c) { applyState(c); },

    update(c) {
      dome.position.copy(c.camera.position);
      if (scene.fog === null) scene.fog = new THREE.FogExp2(0x000000, 0.00001);

      if (c.camera.fov !== lastFov || c.camera.aspect !== lastAspect) {
        lastFov = c.camera.fov;
        lastAspect = c.camera.aspect;
        csm.updateFrustums();
        tuneShadowBias();
      }
      csm.update();
      csm.getExtendedBreaks(atmoUniforms.CSM_cascades.value);
      atmoUniforms.cameraNear.value = c.camera.near;
      atmoUniforms.shadowFar.value = Math.min(c.camera.far, SHADOW_FAR);

      patchScene(scene);
    },

    onResize() {
      csm.updateFrustums();
      tuneShadowBias();
    },

    dispose() {
      csm.dispose();
      csm.remove();
      lutRT.dispose();
      pmrem.dispose();
      for (const rt of envCache.values()) rt.dispose();
    },
  };
}
