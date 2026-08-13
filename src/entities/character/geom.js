/**
 * Macrion — character geometry toolkit.  Owned by the Character builder.
 *
 * Everything the character is made of comes out of this file. There are two
 * construction paths and they exist for different reasons:
 *
 *  1. `Field` + `surfaceNets` — an implicit-surface path. The body, head and
 *     hair are authored as a signed distance field (ellipsoids, tapered
 *     anisotropic capsules, rounded boxes, arbitrary callbacks) combined with
 *     *smooth* min/max, then polygonized. This is the whole reason the mesh has
 *     continuous topology across shoulders, elbows, hips and knees: there is no
 *     "join" to get wrong, the blend is in the field. Normals come from the
 *     analytic gradient, so shading is exact rather than averaged from facets,
 *     and ambient occlusion can be traced through the same field.
 *
 *  2. `loft` — a swept-section path for hard surfaces (belt, straps, pauldron
 *     lames, mantle, sash, hair strands). These want *crisp* edges, which is
 *     exactly what an SDF with a smooth union cannot give you.
 *
 * Both paths emit the same attribute set so everything merges into one
 * BufferGeometry and therefore one draw call:
 *     position, normal, aMatAo (material id, baked AO), aTint, and later
 *     skinIndex / skinWeight from rig.js.
 *
 * Determinism: the only randomness is `makeRNG(SEED)`-seeded value noise,
 * evaluated at authoring time. Nothing here reads a clock.
 */
import * as THREE from 'three';
import { makeRNG, SEED } from '../../core/engine.js';

// ---------------------------------------------------------------- scalars --
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Quadratic polynomial smooth minimum — C1, cheap, no exp(). */
export function smin(a, b, k) {
  if (k <= 1e-6) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

// ------------------------------------------------------------ value noise --
/** Seeded 3D value noise, tileable enough for authoring-time detail. */
export function makeNoise3(seed = SEED) {
  const rng = makeRNG(seed);
  const P = new Uint8Array(512);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const s = t[i]; t[i] = t[j]; t[j] = s;
  }
  for (let i = 0; i < 512; i++) P[i] = t[i & 255];
  const g = (i, j, k) => P[(P[(P[i & 255] + (j & 255)) & 255] + (k & 255)) & 255] / 255;
  return function noise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const c000 = g(ix, iy, iz), c100 = g(ix + 1, iy, iz);
    const c010 = g(ix, iy + 1, iz), c110 = g(ix + 1, iy + 1, iz);
    const c001 = g(ix, iy, iz + 1), c101 = g(ix + 1, iy, iz + 1);
    const c011 = g(ix, iy + 1, iz + 1), c111 = g(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  };
}

// ------------------------------------------------------------------ Field --
/**
 * A signed distance field assembled from tagged primitives.
 *
 * Primitives carry a `part` tag so the same authored body can be polygonized
 * in pieces at different resolutions (coarse body, fine head, fine hair) while
 * ambient occlusion still traces the *whole* field — which is what puts real
 * shadow under the jaw, inside the collar and beneath the mantle.
 *
 * Evaluation is accelerated by a uniform bin grid: each bin holds the indices
 * of primitives whose AABB (expanded by their blend radius) overlaps it. A
 * typical bin holds 4-7 primitives instead of the ~120 in the full list.
 */
export class Field {
  constructor() {
    this.prims = [];
    this._bins = null;
  }

  _push(dist, aabb, o) {
    this.prims.push({
      dist, aabb,
      op: o.op ?? 'add',
      k: o.k ?? 0.03,
      mat: o.mat ?? 0,
      part: o.part ?? 'body',
      bones: o.bones ?? null,
      tint: o.tint ?? null,
      aoOnly: o.aoOnly === true,
    });
    return this;
  }

  ellipsoid(c, r, o = {}) {
    const [cx, cy, cz] = c, [rx, ry, rz] = r;
    const rmin = Math.min(rx, ry, rz);
    const f = (x, y, z) => {
      const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
      const k0 = Math.sqrt(px * px + py * py + pz * pz);
      if (k0 < 1e-5) return -rmin;
      const qx = px / rx, qy = py / ry, qz = pz / rz;
      const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      return (k0 * (k0 - 1)) / k1;
    };
    return this._push(f, [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz], o);
  }

  /**
   * Tapered capsule with an anisotropic cross-section.
   * `scale` squashes the whole primitive in world axes, which is how the torso
   * gets an oval section and the hand gets a flat one.
   */
  capsule(a, b, ra, rb, o = {}) {
    const [sx, sy, sz] = o.scale ?? [1, 1, 1];
    const [ax, ay, az] = a;
    const bax = (b[0] - ax) / sx, bay = (b[1] - ay) / sy, baz = (b[2] - az) / sz;
    const bb = bax * bax + bay * bay + baz * baz || 1e-9;
    const sm = Math.min(sx, sy, sz);
    const f = (x, y, z) => {
      const px = (x - ax) / sx, py = (y - ay) / sy, pz = (z - az) / sz;
      let t = (px * bax + py * bay + pz * baz) / bb;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const dx = px - bax * t, dy = py - bay * t, dz = pz - baz * t;
      return (Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t)) * sm;
    };
    const rm = Math.max(ra, rb);
    const aabb = [
      Math.min(ax, b[0]) - rm * sx, Math.min(ay, b[1]) - rm * sy, Math.min(az, b[2]) - rm * sz,
      Math.max(ax, b[0]) + rm * sx, Math.max(ay, b[1]) + rm * sy, Math.max(az, b[2]) + rm * sz,
    ];
    return this._push(f, aabb, o);
  }

  /** Rounded box, optionally yaw-rotated about its own centre. */
  box(c, h, o = {}) {
    const [cx, cy, cz] = c;
    const rd = o.round ?? 0;
    const [hx, hy, hz] = h;
    const ry = o.ry ?? 0;
    const cs = Math.cos(-ry), sn = Math.sin(-ry);
    const f = (x, y, z) => {
      let px = x - cx, py = y - cy, pz = z - cz;
      if (ry !== 0) { const t = px * cs - pz * sn; pz = px * sn + pz * cs; px = t; }
      const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy, qz = Math.abs(pz) - hz;
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
      const out = Math.sqrt(mx * mx + my * my + mz * mz);
      return out + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - rd;
    };
    const e = Math.hypot(hx, hz) + rd;
    return this._push(f, [cx - e, cy - hy - rd, cz - e, cx + e, cy + hy + rd, cz + e], o);
  }

  /** Arbitrary callback, for things like a hem line that varies with azimuth. */
  custom(f, aabb, o = {}) { return this._push(f, aabb, o); }

  // ----------------------------------------------------------------- bins --
  build(margin = 0.05) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of this.prims) {
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], p.aabb[i]);
        mx[i] = Math.max(mx[i], p.aabb[i + 3]);
      }
    }
    for (let i = 0; i < 3; i++) { mn[i] -= 0.2; mx[i] += 0.2; }
    const cell = 0.08;
    const dim = [
      Math.max(1, Math.ceil((mx[0] - mn[0]) / cell)),
      Math.max(1, Math.ceil((mx[1] - mn[1]) / cell)),
      Math.max(1, Math.ceil((mx[2] - mn[2]) / cell)),
    ];
    const lists = new Array(dim[0] * dim[1] * dim[2]);
    for (let i = 0; i < lists.length; i++) lists[i] = [];
    this.prims.forEach((p, pi) => {
      const pad = p.k + margin;
      const i0 = clamp(Math.floor((p.aabb[0] - pad - mn[0]) / cell), 0, dim[0] - 1);
      const i1 = clamp(Math.floor((p.aabb[3] + pad - mn[0]) / cell), 0, dim[0] - 1);
      const j0 = clamp(Math.floor((p.aabb[1] - pad - mn[1]) / cell), 0, dim[1] - 1);
      const j1 = clamp(Math.floor((p.aabb[4] + pad - mn[1]) / cell), 0, dim[1] - 1);
      const k0 = clamp(Math.floor((p.aabb[2] - pad - mn[2]) / cell), 0, dim[2] - 1);
      const k1 = clamp(Math.floor((p.aabb[5] + pad - mn[2]) / cell), 0, dim[2] - 1);
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) lists[i + dim[0] * (j + dim[1] * k)].push(pi);
    });
    this._bins = { mn, cell, dim, lists };
    return this;
  }

  _binAt(x, y, z) {
    const b = this._bins;
    const i = Math.floor((x - b.mn[0]) / b.cell);
    const j = Math.floor((y - b.mn[1]) / b.cell);
    const k = Math.floor((z - b.mn[2]) / b.cell);
    if (i < 0 || j < 0 || k < 0 || i >= b.dim[0] || j >= b.dim[1] || k >= b.dim[2]) return null;
    return b.lists[i + b.dim[0] * (j + b.dim[1] * k)];
  }

  /**
   * Build a distance function restricted to a set of `part` tags.
   * `includeAoOnly` pulls in the invisible proxies that stand in for the
   * lofted pieces so AO knows the mantle and belt are there.
   */
  sampler(parts, includeAoOnly = false) {
    if (!this._bins) this.build();
    const want = parts === null ? null : new Set(parts);
    const prims = this.prims;
    const ok = prims.map((p) => (
      (p.aoOnly ? includeAoOnly : true) && (want === null || want.has(p.part))
    ));
    const self = this;
    return function sample(x, y, z) {
      const list = self._binAt(x, y, z);
      let d = 0.6;
      if (!list) return d;
      for (let n = 0; n < list.length; n++) {
        const pi = list[n];
        if (!ok[pi]) continue;
        const p = prims[pi];
        const di = p.dist(x, y, z);
        if (p.op === 'add') d = smin(d, di, p.k);
        else d = smax(d, -di, p.k);
      }
      return d;
    };
  }

  /** Nearest additive primitive at a point — drives per-vertex material id. */
  nearestPrim(x, y, z, parts) {
    const list = this._binAt(x, y, z);
    let best = null, bd = 1e9;
    const scan = list ?? this.prims.map((_, i) => i);
    for (let n = 0; n < scan.length; n++) {
      const p = this.prims[scan[n]];
      if (p.op !== 'add' || p.aoOnly) continue;
      if (parts && !parts.includes(p.part)) continue;
      const di = p.dist(x, y, z);
      if (di < bd) { bd = di; best = p; }
    }
    return best;
  }
}

// ------------------------------------------------------------ surface nets --
const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Naive surface nets. Chosen over marching cubes because it produces a far
 * more uniform vertex distribution (better for distance-falloff skinning and
 * for the screen-space bump detail), needs no 256-case table, and its output
 * responds well to the smooth + reproject polish below.
 *
 * The reprojection step is what removes the staircase: after two constrained
 * Laplacian passes the vertices are pushed back onto the exact zero level set
 * using the field gradient, so the silhouette is the *field's* silhouette and
 * not the grid's.
 */
export function surfaceNets(sample, bmin, bmax, res, opts = {}) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / res) + 1;
  const ny = Math.ceil((bmax[1] - bmin[1]) / res) + 1;
  const nz = Math.ceil((bmax[2] - bmin[2]) / res) + 1;
  const vals = new Float32Array(nx * ny * nz);
  let w = 0;
  for (let k = 0; k < nz; k++) {
    const z = bmin[2] + k * res;
    for (let j = 0; j < ny; j++) {
      const y = bmin[1] + j * res;
      for (let i = 0; i < nx; i++) vals[w++] = sample(bmin[0] + i * res, y, z);
    }
  }
  const at = (i, j, k) => vals[i + nx * (j + ny * k)];

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const px = [], py = [], pz = [];
  const v8 = new Float32Array(8);

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2]);
          v8[c] = v;
          if (v < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const va = v8[a], vb = v8[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          ax += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t;
          ay += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t;
          az += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t;
          n++;
        }
        cellVert[i + cx * (j + cy * k)] = px.length;
        px.push(bmin[0] + (i + ax / n) * res);
        py.push(bmin[1] + (j + ay / n) * res);
        pz.push(bmin[2] + (k + az / n) * res);
      }
    }
  }
  if (px.length === 0) return null;

  const tris = [];
  const cv = (i, j, k) => cellVert[i + cx * (j + cy * k)];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        if ((at(i, j, k) < 0) !== (at(i + 1, j, k) < 0))
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k));
      }
    }
  }
  for (let k = 1; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        if ((at(i, j, k) < 0) !== (at(i, j + 1, k) < 0))
          quad(cv(i - 1, j, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i - 1, j, k));
      }
    }
  }
  for (let j = 1; j < cy; j++) {
    for (let k = 0; k < cz; k++) {
      for (let i = 1; i < cx; i++) {
        if ((at(i, j, k) < 0) !== (at(i, j, k + 1) < 0))
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k));
      }
    }
  }

  const nv = px.length;
  // ---- constrained Laplacian smoothing
  const adjSum = new Float32Array(nv * 3);
  const adjN = new Float32Array(nv);
  const passes = opts.smooth ?? 2;
  for (let s = 0; s < passes; s++) {
    adjSum.fill(0); adjN.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
        adjSum[a * 3] += px[b]; adjSum[a * 3 + 1] += py[b]; adjSum[a * 3 + 2] += pz[b]; adjN[a]++;
        adjSum[b * 3] += px[a]; adjSum[b * 3 + 1] += py[a]; adjSum[b * 3 + 2] += pz[a]; adjN[b]++;
      }
    }
    const l = 0.55;
    for (let v = 0; v < nv; v++) {
      if (adjN[v] < 3) continue;
      px[v] += l * (adjSum[v * 3] / adjN[v] - px[v]);
      py[v] += l * (adjSum[v * 3 + 1] / adjN[v] - py[v]);
      pz[v] += l * (adjSum[v * 3 + 2] / adjN[v] - pz[v]);
    }
  }

  // ---- reproject onto the exact zero level set
  const eps = res * 0.35;
  const proj = opts.project ?? 3;
  for (let s = 0; s < proj; s++) {
    for (let v = 0; v < nv; v++) {
      const x = px[v], y = py[v], z = pz[v];
      const d = sample(x, y, z);
      if (Math.abs(d) < 1e-5) continue;
      const gx = sample(x + eps, y, z) - sample(x - eps, y, z);
      const gy = sample(x, y + eps, z) - sample(x, y - eps, z);
      const gz = sample(x, y, z + eps) - sample(x, y, z - eps);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-12) continue;
      const s2 = (2 * eps * d) / g2;
      const step = clamp(s2, -res * 0.9, res * 0.9);
      px[v] -= gx * step; py[v] -= gy * step; pz[v] -= gz * step;
    }
  }

  // ---- analytic normals
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const ne = res * 0.30;
  for (let v = 0; v < nv; v++) {
    const x = px[v], y = py[v], z = pz[v];
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    let gx = sample(x + ne, y, z) - sample(x - ne, y, z);
    let gy = sample(x, y + ne, z) - sample(x, y - ne, z);
    let gz = sample(x, y, z + ne) - sample(x, y, z - ne);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / l; normals[v * 3 + 1] = gy / l; normals[v * 3 + 2] = gz / l;
  }

  // ---- winding: majority vote against the analytic normal, flip once
  let agree = 0, disagree = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const e1x = positions[b * 3] - positions[a * 3];
    const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
    const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3];
    const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
    const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const d = fx * normals[a * 3] + fy * normals[a * 3 + 1] + fz * normals[a * 3 + 2];
    if (d > 0) agree++; else disagree++;
  }
  if (disagree > agree) {
    for (let t = 0; t < tris.length; t += 3) {
      const s = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = s;
    }
  }

  return {
    positions, normals,
    indices: nv > 65535 ? new Uint32Array(tris) : new Uint16Array(tris),
    count: nv,
  };
}

/**
 * Ambient occlusion traced through the field.
 *
 * Four cone directions tilted off the normal, three radii each. This is what
 * puts a real darkening in the neck under the collar, the armpit, the crease
 * where the coat meets the belt and the hollow of the eye socket — none of
 * which the screen-space AO pass can resolve at these scales.
 */
export function bakeAO(sample, positions, normals, opts = {}) {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const radii = opts.radii ?? [0.022, 0.055, 0.115];
  const strength = opts.strength ?? 1.0;
  const rng = makeRNG(SEED + 77);
  // fixed tilted basis directions (deterministic)
  const cone = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.31;
    const tilt = i === 0 ? 0 : 0.85;
    cone.push([Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)]);
  }
  void rng;
  const tx = [0, 0, 0], ty = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    // orthonormal basis around the normal
    let ax = 0, ay = 0, az = 1;
    if (Math.abs(nz) > 0.9) { ax = 1; az = 0; }
    tx[0] = ny * az - nz * ay; tx[1] = nz * ax - nx * az; tx[2] = nx * ay - ny * ax;
    let l = Math.hypot(tx[0], tx[1], tx[2]) || 1;
    tx[0] /= l; tx[1] /= l; tx[2] /= l;
    ty[0] = ny * tx[2] - nz * tx[1]; ty[1] = nz * tx[0] - nx * tx[2]; ty[2] = nx * tx[1] - ny * tx[0];

    let occ = 0, wsum = 0;
    for (let c = 0; c < cone.length; c++) {
      const cd = cone[c];
      const dx = tx[0] * cd[0] + nx * cd[1] + ty[0] * cd[2];
      const dy = tx[1] * cd[0] + ny * cd[1] + ty[1] * cd[2];
      const dz = tx[2] * cd[0] + nz * cd[1] + ty[2] * cd[2];
      const cw = c === 0 ? 1.6 : 1.0;
      for (let r = 0; r < radii.length; r++) {
        const d = radii[r];
        const s = sample(x + dx * d + nx * 0.002, y + dy * d + ny * 0.002, z + dz * d + nz * 0.002);
        const w = cw / (1 + r * 0.9);
        occ += w * clamp01((d - s) / d);
        wsum += w;
      }
    }
    out[v] = clamp01(1 - strength * (occ / wsum) * 1.35);
  }
  return out;
}

// ------------------------------------------------------------------- loft --
/**
 * Sweep a closed cross-section polyline along a set of sections.
 * `sections` is an array of equal-length arrays of [x,y,z].
 * Used for every hard-surface part: belt, harness, pauldron lames, mantle,
 * sash, boot straps, hair strands.
 */
export function loft(sections, opts = {}) {
  const ns = sections.length, np = sections[0].length;
  const closedU = opts.closedU !== false;      // cross-section is a loop
  const capStart = opts.capStart !== false;
  const capEnd = opts.capEnd !== false;
  const pos = new Float32Array(ns * np * 3);
  for (let s = 0; s < ns; s++) {
    for (let p = 0; p < np; p++) {
      const q = sections[s][p];
      const o = (s * np + p) * 3;
      pos[o] = q[0]; pos[o + 1] = q[1]; pos[o + 2] = q[2];
    }
  }
  const idx = [];
  const lim = closedU ? np : np - 1;
  for (let s = 0; s < ns - 1; s++) {
    for (let p = 0; p < lim; p++) {
      const p1 = (p + 1) % np;
      const a = s * np + p, b = s * np + p1, c = (s + 1) * np + p1, d = (s + 1) * np + p;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (closedU && capStart && np > 2) {
    for (let p = 1; p < np - 1; p++) idx.push(0, p + 1, p);
  }
  if (closedU && capEnd && np > 2) {
    const o = (ns - 1) * np;
    for (let p = 1; p < np - 1; p++) idx.push(o, o + p, o + p + 1);
  }
  const g = { positions: pos, indices: new Uint32Array(idx), count: ns * np };
  g.normals = computeNormals(g.positions, g.indices);
  if (opts.flipped) {
    for (let i = 0; i < g.indices.length; i += 3) {
      const s = g.indices[i + 1]; g.indices[i + 1] = g.indices[i + 2]; g.indices[i + 2] = s;
    }
    for (let i = 0; i < g.normals.length; i++) g.normals[i] = -g.normals[i];
  }
  return g;
}

export function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    n[a] += fx; n[a + 1] += fy; n[a + 2] += fz;
    n[b] += fx; n[b + 1] += fy; n[b + 2] += fz;
    n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Make a geometry flat-shaded (crisp plate edges on armour and buckles). */
export function faceted(g) {
  const nT = g.indices.length;
  const pos = new Float32Array(nT * 3);
  const nrm = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t += 3) {
    const ai = g.indices[t] * 3, bi = g.indices[t + 1] * 3, ci = g.indices[t + 2] * 3;
    for (let e = 0; e < 3; e++) {
      pos[(t + 0) * 3 + e] = g.positions[ai + e];
      pos[(t + 1) * 3 + e] = g.positions[bi + e];
      pos[(t + 2) * 3 + e] = g.positions[ci + e];
    }
    const e1x = pos[(t + 1) * 3] - pos[t * 3], e1y = pos[(t + 1) * 3 + 1] - pos[t * 3 + 1], e1z = pos[(t + 1) * 3 + 2] - pos[t * 3 + 2];
    const e2x = pos[(t + 2) * 3] - pos[t * 3], e2y = pos[(t + 2) * 3 + 1] - pos[t * 3 + 1], e2z = pos[(t + 2) * 3 + 2] - pos[t * 3 + 2];
    let fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(fx, fy, fz) || 1;
    fx /= l; fy /= l; fz /= l;
    for (let v = 0; v < 3; v++) {
      nrm[(t + v) * 3] = fx; nrm[(t + v) * 3 + 1] = fy; nrm[(t + v) * 3 + 2] = fz;
    }
  }
  const indices = new Uint32Array(nT);
  for (let i = 0; i < nT; i++) indices[i] = i;
  return { positions: pos, normals: nrm, indices, count: nT };
}

/** Merge parts (each already carrying matAo + tint) into one BufferGeometry. */
export function mergeParts(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.count; ni += p.indices.length; }
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const matAo = new Float32Array(nv * 2);
  const tint = new Float32Array(nv * 3);
  const index = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    position.set(p.positions, vo * 3);
    normal.set(p.normals, vo * 3);
    matAo.set(p.matAo, vo * 2);
    tint.set(p.tint, vo * 3);
    for (let i = 0; i < p.indices.length; i++) index[io + i] = p.indices[i] + vo;
    vo += p.count; io += p.indices.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('aMatAo', new THREE.BufferAttribute(matAo, 2));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

/** Fill matAo / tint for a lofted (non-SDF) part. */
export function tagPart(g, matId, tintFn) {
  const n = g.count;
  g.matAo = new Float32Array(n * 2);
  g.tint = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    g.matAo[v * 2] = matId;
    g.matAo[v * 2 + 1] = 1;
    let t = [1, 1, 1];
    if (tintFn) t = tintFn(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]) ?? t;
    g.tint[v * 3] = t[0]; g.tint[v * 3 + 1] = t[1]; g.tint[v * 3 + 2] = t[2];
  }
  return g;
}
