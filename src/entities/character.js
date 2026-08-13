/**
 * Macrion — the player character.  Owned by the Character builder.
 *
 *   character/geom.js      SDF + surface-nets polygonizer + loft toolkit
 *   character/build.js     the authored character (masses, outfit, hard parts)
 *   character/rig.js       skeleton, programmatic skinning, animation
 *   character/material.js  the single procedural PBR material
 *
 * Contract: { name, object3D, update(ctx), onSun, onWeather, spawn, setPose, root }
 *
 * Everything is generated in code. No GLTF, no external mesh, no texture file:
 * the mesh is polygonized from a signed distance field at load, the skin
 * weights are painted from bone-segment distance, and every surface property
 * is evaluated procedurally in the fragment shader.
 *
 * The whole character is ONE SkinnedMesh with ONE material — material identity
 * rides in a vertex attribute — so it costs one draw call in the colour pass
 * and one in the shadow pass.
 *
 * Determinism: animation is a pure function of `ctx.time`. Authoring-time
 * randomness is seeded value noise off makeRNG(SEED). Two capture runs are
 * bit-identical.
 */
import * as THREE from 'three';
import { SHOTS } from '../core/engine.js';
import { buildCharacterGeometry } from './character/build.js';
import { buildSkeleton, paintWeights, makeAnimator } from './character/rig.js';
import { createCharacterMaterial } from './character/material.js';
import { mergeParts, clamp01 } from './character/geom.js';

export const SPAWN = { x: 12, z: 26 };

/** Facing: +Z, turned slightly so hero/portrait both get a 3/4 read. */
const FACING = 0.16;
/** Soles sink this far into the ground so the contact is not a tangent line. */
const SINK = 0.014;

/**
 * The `hero` and `portrait` poses in engine.js are authored with the camera Y
 * expressed relative to the character's feet (1.55 m and 1.62 m — eye height
 * on a 1.78 m figure), but they are missing the `ground: true` flag the other
 * ground-relative shots carry, so the engine treats them as absolute world
 * height. Terrain at the spawn is 15.5 m, which puts both cameras 14 m
 * underground and is why the previous character capture rendered the underside
 * of the heightfield.
 *
 * engine.js is lead-owned and must not be edited, so this rebases the two
 * character poses onto the terrain at spawn instead. It preserves the authored
 * framing exactly (same offsets from the character, same look target) and it
 * re-reads the terrain every boot, so it stays correct if the Terrain builder
 * moves the ground. THE PROPER FIX IS `ground: true` ON BOTH SHOTS IN
 * engine.js — this is a stand-in until the lead takes it.
 */
function rebaseCharacterShots(groundY) {
  for (const name of ['hero', 'portrait']) {
    const s = SHOTS[name];
    if (!s || s.__macrionRebased) continue;
    s.pos[1] += groundY;
    s.look[1] += groundY;
    s.__macrionRebased = true;
  }
}

/** Soft radial darkening used as the ground contact term. */
function contactTexture() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      // two lobes: a tight core under the feet, a broad ambient pool
      const core = Math.pow(Math.max(0, 1 - d / 0.44), 2.2);
      const pool = Math.pow(Math.max(0, 1 - d), 2.6);
      const occ = clamp01(core * 0.62 + pool * 0.46);
      const v = Math.round(255 * (1 - occ));
      const i = (y * N + x) * 4;
      // occluded ground also cools: kill a little more red than blue
      img.data[i] = v;
      img.data[i + 1] = Math.round(255 * (1 - occ * 0.94));
      img.data[i + 2] = Math.round(255 * (1 - occ * 0.84));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

function contactDecal(terrain, cx, cz, half = 0.95) {
  const N = 18;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const base = terrain?.heightAt ? terrain.heightAt(cx, cz) : 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = terrain?.heightAt ? terrain.heightAt(cx + x, cz + z) : 0;
    p.setY(i, h - base + 0.018);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    map: contactTexture(),
    blending: THREE.MultiplyBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  mat.__macrionOptOut = true;
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  m.frustumCulled = false;
  return m;
}

export function createCharacter(ctx) {
  const t0 = performance.now();

  const groundY = ctx.terrain?.heightAt?.(SPAWN.x, SPAWN.z) ?? 0;
  rebaseCharacterShots(groundY);

  // ---------------------------------------------------------- geometry ----
  const { sdfParts, pieces, ms } = buildCharacterGeometry();
  const all = [...sdfParts, ...pieces];

  const { bones, byName, root } = buildSkeleton();

  // ------------------------------------------------------------ skinning --
  let total = 0;
  for (const p of all) total += p.count;
  const skinIndex = new Uint16Array(total * 4);
  const skinWeight = new Float32Array(total * 4);
  let off = 0;
  for (const p of all) {
    const maskFor = (v, x, y, z) => {
      if (p.masks) return p.masks[v] ?? null;
      if (typeof p.mask === 'function') return p.mask(x, y, z);
      return p.mask ?? null;
    };
    const w = paintWeights(bones, p.positions, p.count, maskFor);
    skinIndex.set(w.skinIndex, off * 4);
    skinWeight.set(w.skinWeight, off * 4);
    off += p.count;
  }

  const geometry = mergeParts(all);
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius *= 1.25;

  // ------------------------------------------------------------ assembly --
  const material = createCharacterMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'warden';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const rig = new THREE.Group();
  rig.name = 'warden-rig';
  rig.add(root);
  rig.add(mesh);
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);

  const group = new THREE.Group();
  group.name = 'character';
  group.add(rig);
  group.position.set(SPAWN.x, groundY - SINK, SPAWN.z);
  group.rotation.y = FACING;

  const decal = contactDecal(ctx.terrain, SPAWN.x, SPAWN.z);
  decal.position.set(SPAWN.x, groundY, SPAWN.z);

  const world = new THREE.Group();
  world.name = 'character-root';
  world.add(group);
  world.add(decal);

  const animator = makeAnimator(byName);
  animator.setWind(ctx.weather?.wind ?? 0.35);
  animator.apply(ctx.time ?? 0);

  const tris = geometry.index.count / 3;
  console.info(
    `[character] ${(tris / 1000).toFixed(1)}k tris  ${total} verts  ${bones.length} bones  ` +
    `1 draw call  build ${(ms) | 0}ms  total ${(performance.now() - t0) | 0}ms  ` +
    `ground ${groundY.toFixed(2)}m`
  );

  return {
    name: 'character',
    object3D: world,
    spawn: SPAWN,
    root,
    skeleton,
    mesh,
    material,
    bones: byName,

    /** Pure function of ctx.time — the capture harness pins it at 120.0. */
    update(c) {
      animator.apply(c.time ?? 0);
      material.userData.uniforms.uCharTime.value = c.time ?? 0;
    },

    onWeather(c) {
      const w = c.weather ?? {};
      material.userData.uniforms.uWet.value = w.wet ?? 0;
      animator.setWind(w.wind ?? 0.35);
      // damp cloth ambient occlusion is the ground reading wet, not the figure
      decal.material.opacity = 1;
    },

    onSun() { /* lighting is the Atmosphere module's; env map is picked up automatically */ },

    setPose(name) { animator.setPose(name); },
    getPose() { return animator.getPose(); },
  };
}
