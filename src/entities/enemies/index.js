/**
 * Macrion — the SNAGULAS.  Owned by the Enemies builder.
 *
 *   enemies/species.js   the parameter table — three types, one generator
 *   enemies/build.js     SDF + explicit-geometry creature generator
 *   enemies/material.js  the hide shader AND the instanced-skinning vertex path
 *   enemies/index.js     this file: the instancer, the animation driver, the API
 *
 * PUBLIC API (the combat builder codes against exactly this):
 *
 *   const enemies = createEnemies(ctx);           // register as an engine module
 *   enemies.spawn('grunt', x, z) -> enemy
 *   enemies.list() -> enemy[]                     // living ones, spawn order
 *   enemies.get(id) -> enemy | null
 *   enemies.despawn(id) -> boolean
 *   enemies.despawnAll()
 *   enemies.types -> ['grunt','stalker','brute']
 *
 *   enemy = {
 *     id, type,
 *     position,        // THREE.Vector3 — WRITE x and z freely; y is snapped to
 *                      // the terrain every frame unless you set enemy.fly=true
 *     rotationY,       // facing, radians. Set it, or leave it and the module
 *                      // faces the enemy along its own motion
 *     health, maxHealth, alive,
 *     setPose(name),   // 'idle' | 'walk' | 'lope' | 'attack' | 'stagger' | 'die'
 *     getPose(),
 *     hitbox,          // THREE.Box3, refreshed every frame, world space
 *     radius, height, headY,        // capsule-ish hint for cheap hit tests
 *     speed, damage, reach,         // per-species combat hints
 *     species,                      // the whole parameter dictionary
 *   }
 *
 * Nothing here emits on the game bus and nothing here runs AI — that is the
 * combat builder's job and this module deliberately stays out of it.
 *
 * PERFORMANCE. One `THREE.InstancedMesh` per (species, LOD) — six colour draws
 * and six shadow draws for the whole enemy population, plus one for every
 * contact shadow on the ground. Skinning is instanced through a bone-palette
 * DataTexture (see material.js). Animation is a pure function of `ctx.time`
 * and each enemy's spawn time, so determinism holds.
 */
import * as THREE from 'three';
import { makeRNG, SEED } from '../../core/engine.js';
import { makeAnimator } from '../character/rig.js';
import { SPECIES, TYPES } from './species.js';
import { buildSnagula } from './build.js';
import { createSnagulaMaterial, createSnagulaDepthMaterial, BONE_COUNT } from './material.js';

/** Hard cap on simultaneously live Snagulas — sizes the bone texture. */
export const MAX_ENEMIES = 32;
/** Metres. Beyond this an enemy draws from the coarse mesh. */
const LOD_DIST = 17;
/** Metres. Beyond this it is not drawn at all. */
const CULL_DIST = 170;

const D = Math.PI / 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Soft radial darkening for the ground contact, same idea as the character's. */
function contactTexture() {
  const N = 96;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const core = Math.pow(Math.max(0, 1 - d / 0.46), 2.0);
      const pool = Math.pow(Math.max(0, 1 - d), 2.4);
      const occ = Math.min(1, core * 0.58 + pool * 0.42);
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(255 * (1 - occ));
      img.data[i + 1] = Math.round(255 * (1 - occ * 0.95));
      img.data[i + 2] = Math.round(255 * (1 - occ * 0.86));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

// ------------------------------------------------------------- animation --
/**
 * The creature layer, applied ON TOP of the reused human animator.
 *
 * `rig.js` writes every bone rotation absolutely from zero each frame, so this
 * has to run after `animator.apply()` — it adds to what the animator wrote
 * rather than replacing it. That is what turns a human walk cycle into a
 * hunched, arms-forward, head-low lope without a second animation system.
 *
 * Everything is a pure function of (t, poseAge). No accumulators.
 */
function creatureLayer(byName, sp, t, phase, pose, poseAge) {
  const add = (n, rx, ry, rz) => {
    const b = byName.get(n);
    if (!b) return;
    b.rotation.x += rx || 0; b.rotation.y += ry || 0; b.rotation.z += rz || 0;
  };
  const lean = sp.hunch;

  // --- constant carriage: head down and forward, arms held ready
  add('neck', 6 * D + lean * 0.20);
  add('head', 4 * D);
  add('armL', -16 * D, 0, -7 * D);
  add('armR', -16 * D, 0, 7 * D);
  add('foreL', -34 * D, 0, 0);
  add('foreR', -34 * D, 0, 0);
  add('handL', -14 * D); add('handR', -14 * D);

  // --- a slow menacing sway that never lines up with the breathing
  const sway = Math.sin(t * 0.83 + phase) * 0.55 + Math.sin(t * 0.37 + phase * 1.7) * 0.45;
  add('spine', 0, sway * 1.6 * D, sway * 1.1 * D);
  add('head', 0, sway * 5.0 * D, -sway * 2.0 * D);

  if (pose === 'walk' || pose === 'lope') {
    // heavier shoulder roll than a human gait, and the head tracks the target
    const f = (pose === 'lope' ? 1.62 : 0.92) * sp.gait.speedMul;
    const ph = t * f * Math.PI * 2 + phase;
    add('chest', 0, Math.sin(ph) * 4 * D, 0);
    add('head', Math.cos(ph * 2) * 2.5 * D, -Math.sin(ph) * 4 * D, 0);
    add('neck', -4 * D);
  }

  if (pose === 'attack') {
    // 0.62 s: wind up, snap, recover. A single readable telegraph.
    const u = Math.min(1, poseAge / 0.62);
    const wind = Math.max(0, Math.sin(Math.min(u, 0.34) / 0.34 * Math.PI * 0.5));
    const snap = u < 0.34 ? 0 : Math.sin(Math.min(1, (u - 0.34) / 0.30) * Math.PI);
    const rec = u < 0.64 ? 0 : (u - 0.64) / 0.36;
    const k = (1 - rec);
    add('spine', (-16 * wind + 20 * snap) * D * k, (10 * wind - 14 * snap) * D * k);
    add('chest', (-10 * wind + 14 * snap) * D * k, (14 * wind - 20 * snap) * D * k);
    add('neck', (-14 * wind + 16 * snap) * D * k);
    add('head', (-10 * wind + 22 * snap) * D * k);
    add('armR', (-52 * wind + 74 * snap) * D * k, 0, (26 * wind - 30 * snap) * D * k);
    add('foreR', (-40 * wind + 34 * snap) * D * k);
    add('armL', (-18 * wind + 26 * snap) * D * k, 0, (-14 * wind + 12 * snap) * D * k);
    add('thighL', (10 * snap) * D * k); add('thighR', (-8 * snap) * D * k);
  }

  if (pose === 'stagger') {
    const u = Math.min(1, poseAge / 0.45);
    const k = Math.sin(u * Math.PI) * Math.exp(-u * 1.2);
    add('spine', -22 * D * k, 8 * D * k, 6 * D * k);
    add('chest', -16 * D * k, 10 * D * k);
    add('neck', -20 * D * k); add('head', -18 * D * k, -12 * D * k);
    add('armL', -34 * D * k, 0, -22 * D * k);
    add('armR', -30 * D * k, 0, 24 * D * k);
    add('foreL', 24 * D * k); add('foreR', 20 * D * k);
  }

  if (pose === 'die') {
    // limp: everything relaxes toward hanging while the root pitches forward
    const u = Math.min(1, poseAge / 1.05);
    const k = u;
    add('spine', 26 * D * k, 0, 8 * D * k);
    add('chest', 18 * D * k);
    add('neck', 24 * D * k); add('head', 26 * D * k, 16 * D * k);
    add('armL', 30 * D * k, 0, -16 * D * k);
    add('armR', 28 * D * k, 0, 18 * D * k);
    add('foreL', 20 * D * k); add('foreR', 22 * D * k);
    add('thighL', -34 * D * k); add('thighR', -28 * D * k);
    add('shinL', -46 * D * k); add('shinR', -40 * D * k);
  }
}

const BASE_POSE = { idle: 'idle', walk: 'walk', lope: 'run', attack: 'idle', stagger: 'idle', die: 'idle' };

// --------------------------------------------------------------- factory --
export function createEnemies(ctx) {
  const t0 = performance.now();
  const rng = makeRNG(SEED + 4241);

  // ---- shared bone palette texture: row = instance slot, 4 texels = one mat4
  const texW = BONE_COUNT * 4, texH = MAX_ENEMIES;
  const boneData = new Float32Array(texW * texH * 4);
  const boneTex = new THREE.DataTexture(boneData, texW, texH, THREE.RGBAFormat, THREE.FloatType);
  boneTex.minFilter = boneTex.magFilter = THREE.NearestFilter;
  boneTex.generateMipmaps = false;
  boneTex.needsUpdate = true;
  const boneUniforms = {
    uBoneTex: { value: boneTex },
    uBoneTexSize: { value: new THREE.Vector2(texW, texH) },
  };

  const object3D = new THREE.Group();
  object3D.name = 'enemies';

  const depthMat = createSnagulaDepthMaterial(boneUniforms);

  // ---- build every species at every LOD
  const kinds = {};
  let totalTris = 0, totalVerts = 0;
  for (const type of TYPES) {
    const sp = SPECIES[type];
    const lods = sp.lod.map((_, i) => buildSnagula(sp, i));
    const material = createSnagulaMaterial(sp, boneUniforms);

    // the LOD0 rig drives the animation; LOD1 is authored on identical rest
    // positions so the same bone palette skins it correctly
    const { bones, byName, root } = lods[0];
    const skeleton = new THREE.Skeleton(bones);
    const animator = makeAnimator(byName);

    const meshes = lods.map((L, i) => {
      const geo = L.geometry;
      geo.setAttribute('aInstIndex',
        new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMIES), 1));
      geo.setAttribute('aInstTint',
        new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMIES * 3), 3));
      const m = new THREE.InstancedMesh(geo, material, MAX_ENEMIES);
      m.name = `snagula-${type}-lod${i}`;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.customDepthMaterial = depthMat;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      object3D.add(m);
      totalTris += L.tris; totalVerts += L.verts;
      return m;
    });

    kinds[type] = { sp, lods, meshes, skeleton, bones, byName, root, animator, material, buckets: [[], []] };
  }

  // ---- one instanced contact shadow for the whole population
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  decalGeo.rotateX(-Math.PI / 2);
  const decalMat = new THREE.MeshBasicMaterial({
    map: contactTexture(),
    blending: THREE.MultiplyBlending,
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
  });
  decalMat.__macrionOptOut = true;
  const decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_ENEMIES);
  decals.name = 'snagula-contacts';
  decals.renderOrder = 4;
  decals.frustumCulled = false;
  decals.castShadow = false;
  decals.receiveShadow = false;
  decals.count = 0;
  decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  object3D.add(decals);

  // ---- population
  const enemies = [];
  const byId = new Map();
  const freeSlots = [];
  for (let i = MAX_ENEMIES - 1; i >= 0; i--) freeSlots.push(i);
  let nextId = 1;

  function groundAt(x, z) {
    return ctx.terrain?.heightAt ? ctx.terrain.heightAt(x, z) : 0;
  }

  function spawn(type, x, z) {
    const sp = SPECIES[type] ?? SPECIES[TYPES[0]];
    if (!SPECIES[type]) console.warn(`[enemies] unknown type "${type}", using ${TYPES[0]}`);
    if (!freeSlots.length) { console.warn('[enemies] population cap reached'); return null; }
    const slot = freeSlots.pop();
    const jitter = sp.hueJitter;
    const r1 = rng(), r2 = rng(), r3 = rng();
    const e = {
      id: nextId++,
      type: SPECIES[type] ? type : TYPES[0],
      species: sp,
      slot,
      position: new THREE.Vector3(x, groundAt(x, z), z),
      rotationY: (r3 - 0.5) * Math.PI * 2,
      health: sp.combat.health,
      maxHealth: sp.combat.health,
      alive: true,
      fly: false,
      speed: sp.combat.speed,
      damage: sp.combat.damage,
      reach: sp.combat.reach,
      radius: 0.34 * sp.torsoW * (sp.height / 1.78) + 0.10,
      height: sp.height,
      headY: sp.height * 0.86,
      hitbox: new THREE.Box3(),
      // per-instance hue spread so no two of a type are the same creature
      tint: new THREE.Vector3(
        1 + (r1 - 0.5) * jitter * 1.6,
        1 + (r2 - 0.5) * jitter,
        1 + (r1 * 0.5 + r2 * 0.5 - 0.5) * jitter * 1.9
      ),
      phase: r1 * Math.PI * 2,
      scaleVar: 0.94 + r2 * 0.13,
      _pose: 'idle',
      _poseT: ctx.time ?? 0,
      _prev: new THREE.Vector3(x, 0, z),
      setPose(name) {
        if (!(name in BASE_POSE)) return;
        if (this._pose === name) return;
        this._pose = name;
        this._poseT = ctx.engine?.clock ?? 0;
      },
      getPose() { return this._pose; },
    };
    e.position.y = groundAt(x, z);
    enemies.push(e);
    byId.set(e.id, e);
    return e;
  }

  function despawn(id) {
    const e = byId.get(id);
    if (!e) return false;
    e.alive = false;
    byId.delete(id);
    freeSlots.push(e.slot);
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    return true;
  }

  function despawnAll() { for (const e of [...enemies]) despawn(e.id); }

  // ----------------------------------------------------------- per frame --
  function update(c) {
    const t = c.time ?? 0;
    const cam = c.camera;
    for (const k of TYPES) { kinds[k].buckets[0].length = 0; kinds[k].buckets[1].length = 0; }

    let nDecal = 0;
    for (const e of enemies) {
      const K = kinds[e.type];
      const sp = K.sp;

      // ---- ground snap + facing from motion (the combat builder may override)
      if (!e.fly) e.position.y = groundAt(e.position.x, e.position.z);
      const dx = e.position.x - e._prev.x, dz = e.position.z - e._prev.z;
      if (dx * dx + dz * dz > 1e-6 && e.autoFace !== false) {
        e.rotationY = Math.atan2(dx, dz);
      }
      e._prev.set(e.position.x, 0, e.position.z);

      // ---- hitbox
      const r = e.radius, h = e.height;
      e.hitbox.min.set(e.position.x - r, e.position.y, e.position.z - r);
      e.hitbox.max.set(e.position.x + r, e.position.y + h, e.position.z + r);

      const d = cam ? cam.position.distanceTo(e.position) : 0;
      if (d > CULL_DIST) continue;
      const lod = d < LOD_DIST ? 0 : 1;

      // ---- pose. Pure function of clock time and the pose start time.
      const age = Math.max(0, t - e._poseT);
      const local = t * sp.gait.speedMul + e.phase;
      K.animator.setWind(c.weather?.wind ?? 0.35);
      K.animator.setPose(BASE_POSE[e._pose]);
      K.animator.apply(local);
      creatureLayer(K.byName, sp, t, e.phase, e._pose, age);
      K.root.updateMatrixWorld(true);
      K.skeleton.update();
      boneData.set(K.skeleton.boneMatrices, e.slot * BONE_COUNT * 16);

      // ---- world transform. Death pitches the whole body forward and sinks it.
      let pitch = 0, sink = 0;
      if (e._pose === 'die') {
        const u = Math.min(1, age / 1.05);
        pitch = u * u * (78 * D);
        sink = u * 0.16 * (sp.height / 1.78);
      }
      _q.setFromAxisAngle(_up, e.rotationY);
      if (pitch !== 0) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
      _p.set(e.position.x, e.position.y - 0.012 - sink, e.position.z);
      _s.setScalar(e.scaleVar);
      _m.compose(_p, _q, _s);

      const bucket = K.buckets[lod];
      bucket.push({ e, m: _m.clone() });

      // ---- contact shadow at the feet
      const cr = (e.radius + 0.55) * (e._pose === 'die' ? 1.35 : 1.0);
      _q.identity();
      _p.set(e.position.x, e.position.y + 0.035, e.position.z);
      _s.set(cr * 2, 1, cr * 2);
      _m.compose(_p, _q, _s);
      decals.setMatrixAt(nDecal++, _m);
    }

    // ---- flush the instance buffers
    for (const type of TYPES) {
      const K = kinds[type];
      for (let l = 0; l < K.meshes.length; l++) {
        const mesh = K.meshes[l];
        const bucket = K.buckets[l];
        const idx = mesh.geometry.getAttribute('aInstIndex');
        const tin = mesh.geometry.getAttribute('aInstTint');
        for (let i = 0; i < bucket.length; i++) {
          mesh.setMatrixAt(i, bucket[i].m);
          idx.array[i] = bucket[i].e.slot;
          tin.array[i * 3] = bucket[i].e.tint.x;
          tin.array[i * 3 + 1] = bucket[i].e.tint.y;
          tin.array[i * 3 + 2] = bucket[i].e.tint.z;
        }
        mesh.count = bucket.length;
        if (bucket.length) {
          mesh.instanceMatrix.needsUpdate = true;
          idx.needsUpdate = true;
          tin.needsUpdate = true;
        }
      }
      K.material.userData.uniforms.uTime.value = t;
    }
    decals.count = nDecal;
    if (nDecal) decals.instanceMatrix.needsUpdate = true;
    if (enemies.length) boneTex.needsUpdate = true;
  }

  console.info(
    `[enemies] ${TYPES.length} species x ${SPECIES[TYPES[0]].lod.length} LODs  ` +
    `${(totalTris / 1000).toFixed(1)}k tris  ${totalVerts} verts  ` +
    `${TYPES.length * 2 + 1} draw calls max  build ${(performance.now() - t0) | 0}ms`
  );

  return {
    name: 'enemies',
    object3D,
    update,
    spawn,
    despawn,
    despawnAll,
    list: () => enemies.slice(),
    get: (id) => byId.get(id) ?? null,
    types: TYPES,
    species: SPECIES,
    max: MAX_ENEMIES,

    onWeather(c) {
      for (const type of TYPES) {
        kinds[type].material.userData.uniforms.uWet.value = c.weather?.wet ?? 0;
      }
    },
    onSun() { /* lighting and env map come from the Atmosphere module */ },

    stats() {
      const per = {};
      for (const type of TYPES) per[type] = kinds[type].buckets.map((b) => b.length);
      return { live: enemies.length, perTypePerLod: per, tris: totalTris };
    },
  };
}

export { SPECIES, TYPES };
