/**
 * Macrion — concentric-ring (clipmap) terrain tessellation.
 *
 * Seven square rings, each 2x the extent of the previous. Cell size grows with
 * distance so triangle density tracks screen-space size instead of world area:
 * ~0.5 m under the camera, 32 m at the 4 km world edge.
 *
 * Two things keep the rings invisible:
 *   1. Band-limiting. Each ring evaluates the height field with `minWl` set to
 *      ~2.6x its cell size, so a coarse ring never carries detail it cannot
 *      represent. Without this the outer rings alias and the boundary reads as
 *      a roughness change.
 *   2. Skirts. Every ring gets a downward apron on its inner and outer
 *      perimeter that inherits the edge vertex normal, so LOD seams cannot
 *      leak sky and the apron shades identically to the surface above it.
 *
 * The rings are static and world-centred rather than camera-following: every
 * named shot lives inside a ~200 m box near the origin, so a following clipmap
 * would only ever add rebuild cost and a popping risk. `rebuild(cx, cz)` exists
 * for when that stops being true.
 */
import * as THREE from 'three';

/**
 * Ring table. BUILD_PLAN pins the playable zone at ~250 m, so the budget is
 * deliberately front-loaded: ring 0 runs at 0.4 m cells (r1: 0.5 m) and the
 * 512 m..2 km backdrop rings were halved in resolution to pay for it. A 4 m
 * cell at 600 m is under 2 screen pixels — it was carrying detail nobody could
 * see, at 300k triangles a ring.
 *
 * `inner` must always equal the previous ring's `outer`, and the chunk grid
 * requires inner == outer/2 (the hole is the centre 2x2 of a 4x4 grid), so
 * n * cell must equal 2 * outer for every row.
 */
export const RINGS = [
  { inner: 0,    outer: 64,   cell: 0.4, n: 320, shadow: true },
  { inner: 64,   outer: 128,  cell: 1,   n: 256, shadow: true },
  { inner: 128,  outer: 256,  cell: 2,   n: 256, shadow: true },
  // Shadow casting stops at 256 m. The Atmosphere module's cascades cover
  // ~340 m, and ring 3 alone is 400k triangles — re-rendering it once per
  // cascade cost more frame time than the sliver of shadow it bought.
  { inner: 256,  outer: 512,  cell: 2,   n: 512, shadow: false },
  { inner: 512,  outer: 1024, cell: 8,   n: 256, shadow: false },
  { inner: 1024, outer: 2048, cell: 16,  n: 256, shadow: false },
  { inner: 2048, outer: 4096, cell: 32,  n: 256, shadow: false },
];

/** Wavelength floor for the finest ring — heightAt() must use the same value. */
export const L0_MIN_WL = RINGS[0].cell * 2.6;

/* ------------------------------------------------------------------ */
/* Coarse world-scale ambient occlusion                                */
/* ------------------------------------------------------------------ */

/**
 * Horizon-angle AO over a 32 m grid of the whole world. Cheap (66k samples)
 * and it is what puts real darkening into valley floors and the shaded side of
 * every ridge — the large-scale term SSAO cannot reach.
 */
function buildCoarseAO(field) {
  const N = 256, EXT = 4096, C = (2 * EXT) / N;
  const S = N + 1;
  const H = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    const z = -EXT + j * C;
    for (let i = 0; i < S; i++) H[j * S + i] = field.height(-EXT + i * C, z, C * 2.6);
  }
  const AO = new Float32Array(S * S);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const STEPS = [1, 2, 4, 8, 16];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const h0 = H[j * S + i];
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0], dz = DIRS[d][1];
        const len = Math.hypot(dx, dz);
        let maxT = 0;
        for (let s = 0; s < STEPS.length; s++) {
          const k = STEPS[s];
          const ii = i + dx * k, jj = j + dz * k;
          if (ii < 0 || jj < 0 || ii >= S || jj >= S) break;
          const t = (H[jj * S + ii] - h0) / (k * C * len);
          if (t > maxT) maxT = t;
        }
        occ += maxT / Math.sqrt(1 + maxT * maxT);   // sin(atan(t))
      }
      AO[j * S + i] = 1 - (occ / 8) * 0.85;
    }
  }
  return {
    sample(x, z) {
      const fx = (x + EXT) / C, fz = (z + EXT) / C;
      const i = Math.min(N - 1, Math.max(0, Math.floor(fx)));
      const j = Math.min(N - 1, Math.max(0, Math.floor(fz)));
      const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
      const a = AO[j * S + i], b = AO[j * S + i + 1];
      const c = AO[(j + 1) * S + i], d = AO[(j + 1) * S + i + 1];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ring construction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Evaluate one ring's height / normal / AO / concavity grid.
 * Grid is (n+3)^2 samples with a one-cell border on every side so central
 * differences are exact right up to the ring edge.
 */
function buildRingGrid(field, ring, coarseAO, cx, cz) {
  const { n, cell, outer, inner } = ring;
  const S = n + 3;
  const minWl = cell * 2.6;
  const H = new Float32Array(S * S);
  const skipR = inner > 0 ? inner - cell * 2 : -1;

  const org = -outer - cell;
  for (let j = 0; j < S; j++) {
    const z = cz + org + j * cell;
    const azWorld = Math.abs(org + j * cell);
    for (let i = 0; i < S; i++) {
      const lx = org + i * cell;
      if (skipR > 0 && Math.abs(lx) < skipR && azWorld < skipR) continue;
      H[j * S + i] = field.height(cx + lx, z, minWl);
    }
  }

  // normals + local concavity from the grid
  const NRM = new Float32Array(S * S * 3);
  const CAV = new Float32Array(S * S);
  const inv = 1 / (2 * cell);
  for (let j = 1; j < S - 1; j++) {
    for (let i = 1; i < S - 1; i++) {
      const k = j * S + i;
      const hL = H[k - 1], hR = H[k + 1], hD = H[k - S], hU = H[k + S];
      let nx = (hL - hR) * inv, ny = 1, nz = (hD - hU) * inv;
      const l = Math.hypot(nx, ny, nz);
      NRM[k * 3] = nx / l; NRM[k * 3 + 1] = ny / l; NRM[k * 3 + 2] = nz / l;
      // concavity: how far below its neighbourhood mean this sample sits
      const mean = (hL + hR + hD + hU) * 0.25;
      CAV[k] = Math.min(1, Math.max(0, (mean - H[k]) / (cell * 0.9 + 0.35)));
    }
  }
  return { S, H, NRM, CAV, minWl, coarseAO };
}

/** One chunk mesh: [i0..i0+cs] x [j0..j0+cs] of the ring grid. */
function buildChunk(grid, ring, i0, j0, cs, cx, cz, material) {
  const { S, H, NRM, CAV, coarseAO } = grid;
  const { cell, outer } = ring;
  const org = -outer - cell;
  const w = cs + 1;
  const vcount = w * w;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Float32Array(vcount * 3);
  const ext = new Float32Array(vcount * 2);

  for (let j = 0; j <= cs; j++) {
    const gj = j0 + j;
    for (let i = 0; i <= cs; i++) {
      const gi = i0 + i;
      const k = gj * S + gi;
      const v = j * w + i;
      const lx = org + gi * cell, lz = org + gj * cell;
      pos[v * 3] = lx; pos[v * 3 + 1] = H[k]; pos[v * 3 + 2] = lz;
      nrm[v * 3] = NRM[k * 3]; nrm[v * 3 + 1] = NRM[k * 3 + 1]; nrm[v * 3 + 2] = NRM[k * 3 + 2];
      ext[v * 2] = coarseAO.sample(cx + lx, cz + lz);
      ext[v * 2 + 1] = CAV[k];
    }
  }

  const idx = new Uint16Array(cs * cs * 6);
  let t = 0;
  for (let j = 0; j < cs; j++) {
    for (let i = 0; i < cs; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      // flip diagonal on alternate cells so the tessellation has no directional grain
      if (((i ^ j) & 1) === 0) {
        idx[t++] = a; idx[t++] = c; idx[t++] = b;
        idx[t++] = b; idx[t++] = c; idx[t++] = d;
      } else {
        idx[t++] = a; idx[t++] = c; idx[t++] = d;
        idx[t++] = a; idx[t++] = d; idx[t++] = b;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aExtra', new THREE.BufferAttribute(ext, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();

  const m = new THREE.Mesh(g, material);
  m.position.set(cx, 0, cz);
  m.receiveShadow = true;
  m.castShadow = ring.shadow;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** Downward apron around a square perimeter of the ring grid. */
function buildSkirt(grid, ring, half, cx, cz, material) {
  const { S, H, NRM, coarseAO } = grid;
  const { cell, outer } = ring;
  const org = -outer - cell;
  const g0 = Math.round((outer - half) / cell) + 1;       // grid index of the perimeter
  const g1 = Math.round((outer + half) / cell) + 1;
  const span = g1 - g0;
  if (span <= 0 || g1 > S - 1) return null;
  const drop = ring.outer >= 4000 ? 900 : cell * 6 + 1.5;

  const ring4 = [];
  for (let i = g0; i <= g1; i++) ring4.push([i, g0]);
  for (let j = g0 + 1; j <= g1; j++) ring4.push([g1, j]);
  for (let i = g1 - 1; i >= g0; i--) ring4.push([i, g1]);
  for (let j = g1 - 1; j >= g0; j--) ring4.push([g0, j]);
  const P = ring4.length;

  const pos = new Float32Array(P * 2 * 3);
  const nrm = new Float32Array(P * 2 * 3);
  const ext = new Float32Array(P * 2 * 2);
  for (let p = 0; p < P; p++) {
    const [i, j] = ring4[p];
    const k = j * S + i;
    const lx = org + i * cell, lz = org + j * cell;
    const ao = coarseAO.sample(cx + lx, cz + lz);
    for (let r = 0; r < 2; r++) {
      const v = p * 2 + r;
      pos[v * 3] = lx; pos[v * 3 + 1] = H[k] - (r ? drop : 0); pos[v * 3 + 2] = lz;
      nrm[v * 3] = NRM[k * 3]; nrm[v * 3 + 1] = NRM[k * 3 + 1]; nrm[v * 3 + 2] = NRM[k * 3 + 2];
      ext[v * 2] = ao; ext[v * 2 + 1] = 0;
    }
  }
  const idx = new Uint16Array((P - 1) * 6);
  let t = 0;
  for (let p = 0; p < P - 1; p++) {
    const a = p * 2, b = a + 1, c = a + 2, d = a + 3;
    idx[t++] = a; idx[t++] = b; idx[t++] = c;
    idx[t++] = b; idx[t++] = d; idx[t++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aExtra', new THREE.BufferAttribute(ext, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.position.set(cx, 0, cz);
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * Build the whole clipmap.
 * @returns {{ group: THREE.Group, tris: number, meshes: number }}
 */
export function buildTerrain(field, material, cx = 0, cz = 0) {
  const group = new THREE.Group();
  group.name = 'terrain-clipmap';
  const coarseAO = buildCoarseAO(field);
  let tris = 0, meshes = 0;

  for (const ring of RINGS) {
    const grid = buildRingGrid(field, ring, coarseAO, cx, cz);
    const cs = ring.n / 4;                    // 4x4 chunk grid; hole = centre 2x2
    for (let cj = 0; cj < 4; cj++) {
      for (let ci = 0; ci < 4; ci++) {
        const isHole = ring.inner > 0 && ci >= 1 && ci <= 2 && cj >= 1 && cj <= 2;
        if (isHole) continue;
        const m = buildChunk(grid, ring, 1 + ci * cs, 1 + cj * cs, cs, cx, cz, material);
        group.add(m);
        tris += cs * cs * 2; meshes++;
      }
    }
    const outerSkirt = buildSkirt(grid, ring, ring.outer, cx, cz, material);
    if (outerSkirt) { group.add(outerSkirt); meshes++; }
    if (ring.inner > 0) {
      const innerSkirt = buildSkirt(grid, ring, ring.inner, cx, cz, material);
      if (innerSkirt) { group.add(innerSkirt); meshes++; }
    }
  }
  return { group, tris, meshes };
}
