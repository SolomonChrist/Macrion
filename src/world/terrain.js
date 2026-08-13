/**
 * Macrion — terrain module. Owned by the Terrain builder.
 *
 *   terrain/noise.js   seeded gradient noise, band-limited fBm, ridged MF
 *   terrain/field.js   the authored height field (silhouette bands, basin)
 *   terrain/mesh.js    7-ring clipmap tessellation + skirts + baked AO
 *   terrain/shader.js  layered procedural surface + contact map
 *   scatter.js         clustered instanced rock / boulder / debris / scrub
 *
 * Contract: { name, object3D, heightAt(x,z), update, onSun, onWeather }.
 * `heightAt` uses the same band limit as ring 0 (L0_MIN_WL), so it agrees with
 * the rendered mesh to within linear-interpolation error over a 0.5 m cell —
 * a couple of centimetres. That is what the engine places `ground: true`
 * cameras with.
 *
 * Weather response lives here rather than in the shader constants:
 *   wet    -> darkens albedo toward 0.55x, collapses roughness, pools by
 *             terrain concavity so puddles gather in hollows
 *   cloud  -> drives `warmth`, swinging the palette from FFXV arid ochre to
 *             cold GoW highland grey-green without touching the mineral base
 *   wind   -> scrub motion
 *   haze   -> owned by the Atmosphere module; we only feed it geometry that
 *             has genuinely separated silhouette bands to work with
 *
 * Determinism: every random draw comes from makeRNG(SEED). The only clocked
 * value is scrub wind, driven by ctx.time (pinnable via MACRION.setClock).
 */
import * as THREE from 'three';
import { SEED } from '../core/engine.js';
import { createField } from './terrain/field.js';
import { buildTerrain, L0_MIN_WL } from './terrain/mesh.js';
import { createTerrainMaterial, createTerrainUniforms, createContactMap } from './terrain/shader.js';
import { createScatter } from './scatter.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createTerrain(ctx) {
  const t0 = performance.now();

  const field = createField(SEED);
  const contact = createContactMap(340, 2048);
  const uniforms = createTerrainUniforms(contact);
  const material = createTerrainMaterial(uniforms);

  const { group, tris, meshes } = buildTerrain(field, material);
  const tMesh = performance.now();

  const scatter = createScatter(field, uniforms, contact);
  group.add(scatter.object3D);

  const root = new THREE.Group();
  root.name = 'terrain';
  root.add(group);

  console.info(
    `[terrain] ${meshes} chunks / ${(tris / 1000) | 0}k tris  ` +
    `mesh ${(tMesh - t0) | 0}ms  scatter ${(performance.now() - tMesh) | 0}ms  ` +
    JSON.stringify(scatter.counts)
  );

  function applyWeather(c) {
    const w = c.weather ?? {};
    const cloud = w.cloud ?? 0;
    const wet = w.wet ?? 0;
    // Mineral layers stay neutral; warmth swings clay + vegetation hue only.
    uniforms.uWarmth.value = clamp01(1 - cloud * 0.85 - wet * 0.45);
    uniforms.uWet.value = wet;
    uniforms.uWind.value = w.wind ?? 0.35;
    // colder, wetter weather brings the frost line down the ranges
    uniforms.uSnowLine.value = 250 - 70 * cloud - 30 * wet;
  }

  applyWeather(ctx);

  return {
    name: 'terrain',
    object3D: root,

    /** Exact height query — must agree with the rendered ring-0 mesh. */
    heightAt(x, z) { return field.height(x, z, L0_MIN_WL); },

    /** Surface normal, for anything that needs to sit on the ground. */
    normalAt(x, z, e = 1) {
      const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
      const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
      return new THREE.Vector3((hL - hR) / (2 * e), 1, (hD - hU) / (2 * e)).normalize();
    },

    update(c) { uniforms.uTime.value = c.time; },
    onWeather(c) { applyWeather(c); },
    onSun() { /* lighting + aerial perspective are the Atmosphere module's */ },

    field,
    contact,
    uniforms,
    scatterLayers: scatter.layers,
    scatterCounts: scatter.counts,
  };
}
