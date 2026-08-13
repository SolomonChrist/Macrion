/**
 * Macrion — clustered instanced ground scatter (rock / boulder / debris / scrub).
 *
 * Placement rules, in order of how much they matter:
 *
 *  1. CLUSTERED, never uniform. Density is the product of two noise fields at
 *     different scales (~70 m formations and ~14 m clumps) pushed through a
 *     hard threshold, so the map has genuine bare ground between groups —
 *     2-5 m gaps inside a clump, tens of metres between formations. Uniform
 *     scatter density is the single most obvious tell of procedural
 *     generation, so the acceptance test is deliberately harsh.
 *  2. Slope- and altitude-aware. Debris collects on shallow ground and at the
 *     foot of steep faces; boulders avoid cliffs; scrub avoids rock and snow.
 *  3. Aligned to the terrain normal, blended toward vertical by mass, so big
 *     boulders sit upright and small debris lies with the slope.
 *  4. Contact darkened. Every instance splats a soft footprint into the shared
 *     contact map that the terrain shader multiplies into its occlusion term,
 *     plus baked-in vertex darkening at the base of each prop. Without this
 *     props read as pasted on, which is a hard fail on R2.3.
 *
 * LOD is a hard geometry swap at ~95 m (a prop is under ~12 px there, so the
 * swap is invisible) followed by a smooth scale fade to zero at the cull
 * radius, so nothing ever pops in or out.
 *
 * Everything is seeded from makeRNG — no bare Math.random anywhere.
 */
import * as THREE from 'three';
import { makeRNG, SEED } from '../core/engine.js';
import { createNoise2D, fbm, clamp01, smoothstep } from './terrain/noise.js';
import { GLSL_NOISE } from './terrain/shader.js';
import { applyAtmosphere } from './sky.js';

/* --------------------------------------------------------------- */
/* Procedural prop geometry                                         */
/* --------------------------------------------------------------- */

/** Weld an unindexed geometry so computeVertexNormals gives smooth shading. */
function weld(geo) {
  const p = geo.getAttribute('position');
  const map = new Map();
  const pos = [];
  const idx = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${Math.round(x * 4096)},${Math.round(y * 4096)},${Math.round(z * 4096)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(x, y, z); }
    idx.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A rock. Deformed icosphere: two octaves of pseudo-3D noise for the mass,
 * a squash for bedding, and a flattened base so it reads as half-buried.
 */
function makeRock(rng, detail, opts = {}) {
  const g = weld(new THREE.IcosahedronGeometry(1, detail));
  const p = g.getAttribute('position');
  const nA = createNoise2D(SEED + 3000 + Math.floor(rng() * 10000));
  const nB = createNoise2D(SEED + 4000 + Math.floor(rng() * 10000));
  const n3 = (x, y, z) => 0.5 * (nA(x + y * 0.73, z - y * 0.41) + nB(z + y * 0.29, x + y * 0.87));

  const squash = opts.squash ?? (0.52 + rng() * 0.28);
  const rough = opts.rough ?? (0.30 + rng() * 0.18);
  const sx = 0.75 + rng() * 0.5, sz = 0.75 + rng() * 0.5;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1
      + rough * n3(x * 1.9, y * 1.9, z * 1.9)
      + rough * 0.42 * n3(x * 4.6 + 13, y * 4.6, z * 4.6 - 7)
      + rough * 0.18 * n3(x * 10.5 - 4, y * 10.5, z * 10.5 + 9);
    x *= r * sx; y *= r * squash; z *= r * sz;
    // flatten and bury the base
    if (y < -0.28) y = -0.28 + (y + 0.28) * 0.35;
    p.setXYZ(i, x, y, z);
    // baked contact darkening: the underside of the prop is occluded
    const k = clamp01((y + 0.35) / 0.85);
    const d = 0.42 + 0.58 * k * k;
    col.push(d, d, d);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A scrub tuft: three crossed blades-cards, tapered, anchored at the base. */
function makeTuft(rng) {
  // Four cards, wider than they are tall, splayed and offset from the centre.
  // Tall narrow cards read as agave spikes rather than a clump of dry grass.
  const cards = 4;
  const pos = [], uv = [], idx = [], col = [], bend = [];
  for (let c = 0; c < cards; c++) {
    const a = (c / cards) * Math.PI + rng() * 0.4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const w = 0.52 + rng() * 0.26;
    const h = 0.34 + rng() * 0.26;
    const lean = (rng() - 0.5) * 0.55;
    const ox = (rng() - 0.5) * 0.30, oz = (rng() - 0.5) * 0.30;
    const base = pos.length / 3;
    const pts = [
      [ox - w * ca, 0, oz - w * sa, 0, 0],
      [ox + w * ca, 0, oz + w * sa, 1, 0],
      [ox + w * ca + lean * h, h, oz + w * sa + lean * h, 1, 1],
      [ox - w * ca + lean * h, h, oz - w * sa + lean * h, 0, 1],
    ];
    for (const [x, y, z, u, v] of pts) {
      pos.push(x, y, z); uv.push(u, v); bend.push(v * v);
      const d = 0.46 + 0.54 * v;         // dark at the root
      col.push(d, d, d);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Canvas-drawn scrub alpha: a fan of tapered dry blades. No downloaded art. */
function makeTuftTexture(rng) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 64; i++) {
    const x0 = S * (0.06 + 0.88 * rng());
    const lean = (rng() - 0.5) * S * 0.70;
    const w = S * (0.010 + 0.020 * rng());
    const top = S * (0.06 + 0.56 * rng());
    const shade = 150 + Math.floor(rng() * 100);
    g.beginPath();
    g.moveTo(x0 - w, S);
    g.quadraticCurveTo(x0 - w * 0.5 + lean * 0.5, (S + top) * 0.5, x0 + lean, top);
    g.quadraticCurveTo(x0 + w * 0.5 + lean * 0.5, (S + top) * 0.5, x0 + w, S);
    g.closePath();
    g.fillStyle = `rgb(${shade},${Math.floor(shade * 0.92)},${Math.floor(shade * 0.7)})`;
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* --------------------------------------------------------------- */
/* Prop material — shared fog + micro detail + LOD fade             */
/* --------------------------------------------------------------- */

function createPropMaterial(uniforms, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.95,
    metalness: 0,
    vertexColors: true,
    dithering: true,
    map: opts.map ?? null,
    alphaTest: opts.alphaTest ?? 0,
    side: opts.side ?? THREE.FrontSide,
  });
  mat.fog = true;                // Atmosphere module keys its aerial term off this
  const isFoliage = !!opts.foliage;
  const local = {
    uLodNear: { value: opts.lodNear ?? -1 },     // <0 = no near cut
    uLodFar: { value: opts.lodFar ?? 1e9 },
    uFade0: { value: opts.fade0 ?? 1e8 },
    uFade1: { value: opts.fade1 ?? 1e9 },
    uTrans: { value: opts.translucency ?? 0 },  // subsurface strength
  };
  Object.assign(mat.userData, { macrionLocal: local });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWorldPos;
        uniform float uLodNear, uLodFar, uFade0, uFade1;
        uniform float uTime, uWind;
        uniform vec2 uWindDir;
        ${isFoliage ? 'attribute float aBend;\n        varying float vBend;' : ''}
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 macInst = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          macInst = (modelMatrix * vec4(macInst, 1.0)).xyz;
        #else
          vec3 macInst = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float macD = distance(macInst, cameraPosition);
        float macVis = step(uLodNear, macD) * step(macD, uLodFar)
                     * (1.0 - smoothstep(uFade0, uFade1, macD));
        ${isFoliage ? /* glsl */`
        {
          // COHERENT wind. r1 multiplied two sinusoids in x and z, which flips
          // sign every half period — neighbouring tufts leaned opposite ways and
          // the field read as static sculpture. Here every tuft leans DOWNWIND
          // and the only variation is gust strength, carried as a wave that
          // travels along uWindDir. Purely a function of uTime, so captures that
          // pin the clock with MACRION.setClock stay bit-identical.
          vBend = aBend;
          float ph   = dot(macInst.xz, uWindDir) * 0.052 - uTime * 1.25;
          float gust = 0.58 + 0.30 * sin(ph) + 0.12 * sin(ph * 2.37 + 1.7);
          // per-clump flutter rides on top but can never reverse the lean
          float flut = sin(uTime * 4.6 + macInst.x * 1.9 + macInst.z * 1.3) * 0.16;
          float amp  = uWind * aBend * gust;
          vec2 cross = vec2(-uWindDir.y, uWindDir.x);
          transformed.xz += uWindDir * (amp * 0.62) + cross * (amp * flut);
          transformed.y  -= aBend * amp * 0.22;      // a leaning blade is shorter
        }` : ''}
        transformed *= macVis;
        vec4 macWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          macWP = instanceMatrix * macWP;
        #endif
        vWorldPos = (modelMatrix * macWP).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWorldPos;
        ${GLSL_NOISE}
        uniform float uWet;
        uniform float uWarmth;
        uniform float uTrans;
        ${isFoliage ? 'varying float vBend;' : ''}
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        float macCd = distance(vWorldPos, cameraPosition);
        float macNear = 1.0 - smoothstep(4.0, 46.0, macCd);
        float macG = macNear * 0.16 * mac_snoise(vWorldPos.xz * 5.5 + vWorldPos.y * 2.0);
        diffuseColor.rgb *= 1.0 + macG * 2.0;
        // Track the terrain's warm/cold swing. Neutral grey props against warm
        // ground read as foreign objects dropped into the scene.
        diffuseColor.rgb *= mix(vec3(0.90, 0.97, 1.09), vec3(1.16, 1.00, 0.78), uWarmth);
        diffuseColor.rgb *= mix(1.0, ${isFoliage ? '0.42' : '0.52'}, uWet);
        // Foliage does not pool water — a wet blade of grass is darker, not
        // glossy. Letting it fall to 0.13 roughness lit every flat card with a
        // uniform sky highlight, which read as scattered white litter.
        roughnessFactor = clamp(mix(roughnessFactor - macG, ${isFoliage ? '0.62' : '0.13'}, uWet * 0.85), 0.06, 1.0);
      `)
      // ---- wrapped transmission (the FFXV backlit money shot).
      // Dry scrub is thin enough to light through. Standard N.L shading can only
      // ever return black when the sun is behind a leaf, which is why r1's
      // backlit.png reads as flat opaque silhouettes. This adds the light that
      // travelled THROUGH the blade: a lobe about the light's onward direction,
      // deliberately NOT shadow-masked, because a backlit leaf is by definition
      // in its own shadow. Thickness falls off toward the root (vBend), so tips
      // glow and the base stays dark and grounded.
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        if (uTrans > 0.0) {
          vec3 macV = normalize(vViewPosition);
          vec3 macL = directionalLights[0].direction;
          vec3 macT = -normalize(macL + normal * 0.35);
          float macBack = pow(max(dot(macT, macV), 0.0), 3.4);
          // rim: grazing view through the blade edge picks up extra path length
          float macRim = 1.0 - abs(dot(normal, macV));
          float macThick = ${isFoliage ? '0.30 + 0.70 * vBend' : '0.6'};
          reflectedLight.directDiffuse += diffuseColor.rgb
            * directionalLights[0].color
            * (uTrans * macThick * macBack * (0.55 + 0.85 * macRim));
        }
        #endif
      `);
  };
  return applyAtmosphere(mat);
}

/* --------------------------------------------------------------- */
/* Placement                                                        */
/* --------------------------------------------------------------- */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Linear albedos. Rock in daylight is 0.10-0.22 linear, nowhere near white —
 * leaving these at the material default of 0xffffff is what turned the first
 * pass of props into blown-out white pills.
 */
const ALB_ROCK = new THREE.Color(0.098, 0.092, 0.082);
const ALB_BOULDER = new THREE.Color(0.106, 0.099, 0.088);
const ALB_DEBRIS = new THREE.Color(0.102, 0.097, 0.089);
const ALB_SCRUB = new THREE.Color(0.430, 0.340, 0.148);

/**
 * Per-instance tint. Drawing R, G and B independently produces saturated
 * random hues (pastel confetti); a shared value multiplier with a small
 * correlated warm/cool shift is what real mineral variation looks like.
 */
function mineralTint(r, spread = 0.52, hue = 0.10) {
  const v = 1 - spread * 0.5 + r() * spread;
  const w = (r() - 0.5) * hue;
  return _c.setRGB(v * (1 + w), v, v * (1 - w * 0.7));
}

/**
 * Build all scatter layers.
 * @param {object} field   height field (from terrain/field.js)
 * @param {object} uniforms shared terrain uniforms
 * @param {object} contact  contact map (from terrain/shader.js)
 */
export function createScatter(field, uniforms, contact) {
  const group = new THREE.Group();
  group.name = 'scatter';
  const rng = makeRNG(SEED ^ 0x5c47);
  const nClusterA = createNoise2D(SEED + 5101);
  const nClusterB = createNoise2D(SEED + 5203);
  const nType = createNoise2D(SEED + 5309);
  const nBowl = createNoise2D(SEED + 5417);

  /** Terrain normal from central differences of the height field. */
  function normalAt(x, z, e = 1.0) {
    const hL = field.heightAt(x - e, z), hR = field.heightAt(x + e, z);
    const hD = field.heightAt(x, z - e), hU = field.heightAt(x, z + e);
    return _n.set((hL - hR) / (2 * e), 1, (hD - hU) / (2 * e)).normalize();
  }

  /**
   * Density in [0,1]. Product of a formation-scale and a clump-scale field,
   * each thresholded, so the result is genuinely patchy with bare ground.
   */
  function density(x, z, formWl, clumpWl, bias) {
    const a = clamp01(0.5 + 1.05 * fbm(nClusterA, x, z, formWl, 3, 0));
    const b = clamp01(0.5 + 1.15 * fbm(nClusterB, x + 913, z - 271, clumpWl, 3, 0));
    const fa = smoothstep(clamp01((a - 0.34) / 0.30));
    const fb = smoothstep(clamp01((b - 0.28) / 0.34));
    return fa * fb * bias;
  }

  const layers = [];
  const counts = {};

  /**
   * Generic jittered-grid placement pass with rejection.
   * `slope` is sin(angle) so thresholds are linear in degrees.
   */
  function place(cfg) {
    const out = [];
    const n = Math.ceil((cfg.half * 2) / cfg.step);
    // Level-1 bowl. BUILD_PLAN pins the playable zone at ~250 m across, so
    // density is spent inside `bowl` metres of the origin and thinned outside.
    // Two things stop this reading as a disc from the air, which the first
    // attempt very much did: the fade is long (>= the radius itself), and the
    // radius is warped by a 320 m noise field so the boundary is a lobed,
    // organic edge that never closes into a circle.
    const bR = cfg.bowl ?? 0;
    const bF = cfg.bowlFade ?? 150;
    const bO = cfg.bowlOuter ?? 1;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -cfg.half + (i + rng()) * cfg.step;
        const z = -cfg.half + (j + rng()) * cfg.step;
        let bowlW = 1;
        if (bR > 0) {
          const r = Math.hypot(x, z) + 55 * fbm(nBowl, x, z, 320, 2, 0);
          bowlW = bO + (1 - bO) * (1 - smoothstep(clamp01((r - bR) / bF)));
        }
        const d = density(x, z, cfg.formWl, cfg.clumpWl, cfg.bias * bowlW);
        if (rng() > d) continue;
        const y = field.heightAt(x, z);
        if (y < cfg.minY || y > cfg.maxY) continue;
        const nrm = normalAt(x, z, cfg.probe ?? 1.0);
        const slope = Math.sqrt(Math.max(0, 1 - nrm.y * nrm.y));
        if (slope > cfg.maxSlope) continue;
        if (cfg.slopeBias && rng() > cfg.slopeBias(slope)) continue;
        const s = cfg.sizeMin + (cfg.sizeMax - cfg.sizeMin) * Math.pow(rng(), cfg.sizePow ?? 2);
        out.push({ x, z, y, s, nx: nrm.x, ny: nrm.y, nz: nrm.z, slope });
      }
    }
    return out;
  }

  /**
   * Turn placements into InstancedMeshes.
   *
   * `cfg.build(v)` returns { hi, lo } geometry for shape variant v. Items are
   * split across variants, because one rock silhouette repeated three thousand
   * times reads as instancing even when the placement is perfect.
   */
  function instance(name, items, cfg) {
    const N = items.length;
    counts[name] = N;
    if (!N) return;
    const V = cfg.variants ?? 1;
    const buckets = [];
    for (let v = 0; v < V; v++) buckets.push([]);
    for (const it of items) buckets[(rng() * V) | 0].push(it);

    for (let v = 0; v < V; v++) {
      const bucket = buckets[v];
      if (!bucket.length) continue;
      const geo = cfg.build(v);
      const pairs = [[geo.hi, cfg.matHi], [geo.lo, cfg.matLo]];
      const meshes = [];
      for (const [g, m] of pairs) {
        if (!g || !m) continue;
        // Only the hi-LOD mesh casts. The shadow depth material does not carry
        // our LOD-collapse injection, so letting both cast would double every
        // shadow; the hi mesh covers the range shadows actually reach.
        // Shadows come from the LO mesh where one exists. The shadow depth
        // material has no LOD-collapse injection, so it renders every instance
        // at full size regardless of distance — which is what a shadow caster
        // wants — and the lo silhouette is indistinguishable in a shadow map at
        // a quarter of the triangles. Letting both cast would double-shadow.
        const isLo = meshes.length > 0;
        const im = new THREE.InstancedMesh(g, m, bucket.length);
        im.name = `scatter-${name}-${isLo ? 'lo' : 'hi'}-${v}`;
        im.castShadow = cfg.castShadow !== false && (isLo || !geo.lo);
        im.receiveShadow = true;
        im.frustumCulled = false;      // instances span the whole play area
        meshes.push(im);
      }
      for (let i = 0; i < bucket.length; i++) {
        const it = bucket[i];
        _n.set(it.nx, it.ny, it.nz);
        // heavier props stand more upright than the slope they sit on
        _n.lerp(_up, cfg.uprightBias ?? 0).normalize();
        _q.setFromUnitVectors(_up, _n);
        _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, rng() * Math.PI * 2));
        const sy = it.s * (cfg.squashY ?? 1) * (0.78 + rng() * 0.44);
        _s.set(it.s * (0.8 + rng() * 0.4), sy, it.s * (0.8 + rng() * 0.4));
        _p.set(it.x, it.y - it.s * (cfg.sink ?? 0.24), it.z);
        _m.compose(_p, _q, _s);
        const hue = cfg.tint ? cfg.tint(rng, it) : null;
        for (const im of meshes) {
          im.setMatrixAt(i, _m);
          if (hue) im.setColorAt(i, hue);
        }
        contact.splat(it.x, it.z, it.s * (cfg.contactRadius ?? 1.35), cfg.contactStrength ?? 0.55);
      }
      for (const im of meshes) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        group.add(im);
        layers.push(im);
      }
    }
  }

  /* ---- 1. boulders: rare, large, gathered at the foot of steep ground ---- */
  instance('boulder', place({
    half: 380, step: 15, formWl: 240, clumpWl: 62, bias: 1.0,
    bowl: 150, bowlFade: 190, bowlOuter: 0.62,
    minY: -60, maxY: 230, maxSlope: 0.66, probe: 3,
    sizeMin: 1.3, sizeMax: 3.8, sizePow: 2.1,
    slopeBias: (s) => 0.28 + 1.15 * s,
  }), {
    variants: 3,
    build: (v) => ({
      hi: makeRock(rng, 2, { rough: 0.26 + v * 0.05, squash: 0.62 + v * 0.09 }),
      lo: makeRock(rng, 1, { rough: 0.26 + v * 0.05, squash: 0.62 + v * 0.09 }),
    }),
    matHi: createPropMaterial(uniforms, { color: ALB_BOULDER, roughness: 0.92, lodFar: 135 }),
    matLo: createPropMaterial(uniforms, { color: ALB_BOULDER, roughness: 0.92, lodNear: 135, fade0: 780, fade1: 920 }),
    uprightBias: 0.55, sink: 0.30,
    contactRadius: 1.45, contactStrength: 0.82,
    tint: (r) => mineralTint(r, 0.48, 0.11),
  });

  /* ---- 2. rocks: the main scatter layer ---- */
  instance('rock', place({
    half: 330, step: 3.1, formWl: 78, clumpWl: 15, bias: 0.46,
    bowl: 140, bowlFade: 180, bowlOuter: 0.52,
    minY: -60, maxY: 300, maxSlope: 0.84, probe: 1.5,
    sizeMin: 0.22, sizeMax: 1.85, sizePow: 2.4,
  }), {
    variants: 3,
    build: (v) => ({
      hi: makeRock(rng, 1, { rough: 0.32 + v * 0.06, squash: 0.50 + v * 0.12 }),
      lo: makeRock(rng, 0, { rough: 0.32 + v * 0.06, squash: 0.50 + v * 0.12 }),
    }),
    matHi: createPropMaterial(uniforms, { color: ALB_ROCK, roughness: 0.95, lodFar: 95 }),
    matLo: createPropMaterial(uniforms, { color: ALB_ROCK, roughness: 0.95, lodNear: 95, fade0: 300, fade1: 400 }),
    uprightBias: 0.2, sink: 0.34,
    contactRadius: 1.75, contactStrength: 0.66,
    tint: (r) => mineralTint(r, 0.60, 0.13),
  });

  /* ---- 3. debris: real gravel underfoot. The single biggest near-field
     legibility win available — at 1.7 m eye height the ground has to be made
     of countable objects, not of shader noise pretending to be them. ---- */
  instance('debris', place({
    half: 190, step: 0.85, formWl: 34, clumpWl: 7.5, bias: 0.62,
    bowl: 120, bowlFade: 150, bowlOuter: 0.26,
    minY: -60, maxY: 240, maxSlope: 0.88, probe: 0.8,
    sizeMin: 0.075, sizeMax: 0.38, sizePow: 1.9,
  }), {
    variants: 3,
    build: (v) => ({ hi: makeRock(rng, 0, { rough: 0.38 + v * 0.10, squash: 0.40 + v * 0.14 }), lo: null }),
    // Long fade band. A short one (r1: 62->88 m) draws a hard circle on the
    // ground at the cull radius, which is glaringly obvious from any elevated
    // camera — the fade sphere around the camera intersects the ground as a
    // ring. Wide enough and it never resolves into an edge.
    matHi: createPropMaterial(uniforms, { color: ALB_DEBRIS, roughness: 0.97, fade0: 55, fade1: 145 }),
    matLo: null,
    uprightBias: 0.0, sink: 0.42, castShadow: false,
    contactRadius: 1.30, contactStrength: 0.30,
    tint: (r) => mineralTint(r, 0.70, 0.14),
  });

  /* ---- 4. dry scrub tufts (accent vegetation, clustered) ---- */
  {
    const tex = makeTuftTexture(rng);
    instance('scrub', place({
      half: 210, step: 0.85, formWl: 56, clumpWl: 10, bias: 0.60,
      bowl: 130, bowlFade: 170, bowlOuter: 0.34,
      minY: -60, maxY: 170, maxSlope: 0.62, probe: 1.0,
      sizeMin: 0.38, sizeMax: 1.32, sizePow: 1.5,
    }), {
      variants: 3,
      build: () => ({ hi: makeTuft(rng), lo: null }),
      matHi: createPropMaterial(uniforms, {
        color: ALB_SCRUB, map: tex, alphaTest: 0.40, side: THREE.DoubleSide,
        roughness: 0.88, foliage: true, fade0: 92, fade1: 132,
        translucency: 1.35,
      }),
      matLo: null,
      uprightBias: 0.80, sink: 0.05,
      contactRadius: 1.20, contactStrength: 0.40,
      // per-clump hue drift between dead straw and darker living scrub
      tint: (r, it) => {
        const t = clamp01(0.5 + 0.9 * nType(it.x * 0.05, it.z * 0.05));
        return _c.setRGB(0.58 + 0.52 * t + r() * 0.18, 0.55 + 0.40 * t + r() * 0.15, 0.46 + 0.22 * t + r() * 0.11);
      },
    });
  }

  contact.commit();

  return { object3D: group, layers, counts };
}
