/**
 * Macrion — SNAGULA generator.  Owned by the Enemies builder.
 *
 * ONE generator, N species. Everything here reads `species.js` and nothing is
 * hard-coded to a particular Snagula: proportions, mass, jaw, teeth, spines and
 * hue are all dials. Adding a type is a dictionary entry.
 *
 * Reuse, not duplication:
 *   - the SDF / surface-nets / loft toolkit is `character/geom.js` verbatim
 *   - the skeleton is `character/rig.js`'s `buildSkeleton()` verbatim, with the
 *     bone REST POSITIONS re-proportioned afterwards (see `deriveRig`)
 *   - skin weights are `character/rig.js`'s `paintWeights()` verbatim
 *
 * Two traps from `heartbeats/oz-repair.md` are load-bearing here:
 *
 *  1. Any SDF feature smaller than ~2 cells of the surface-nets grid breaks up
 *     into speckle. Teeth (8-12 mm), claws, eye globes, dorsal spines and horns
 *     are ALL under that at any sane head resolution, so none of them are SDF
 *     primitives — they are explicit faceted geometry, merged into the same
 *     buffer. That is also why they read CRISP, which is what "sharp teeth"
 *     needs. Fine body primitives (fingers) are dropped at LOD1, whose grid is
 *     twice as coarse.
 *  2. Procedural detail frequency is a function of on-screen footprint, not of
 *     taste. That fix lives in `material.js`.
 *
 * The bind pose is a hunched forward carriage, and it is baked into the bone
 * REST POSITIONS rather than into bind rotations, because `rig.js`'s animator
 * writes every bone rotation absolutely from zero each frame — a bind rotation
 * would be wiped on the first update. Positions survive.
 */
import * as THREE from 'three';
import {
  Field, surfaceNets, bakeAO, mergeParts, tagPart,
  makeNoise3, clamp, clamp01, lerp, smoothstep,
} from '../character/geom.js';
import { BONE_DEF, buildSkeleton, paintWeights } from '../character/rig.js';
import { SEED } from '../../core/engine.js';

/** Material ids — resolved in `material.js`'s fragment shader. */
export const EMAT = {
  HIDE: 0, BELLY: 1, PLATE: 2, TOOTH: 3, CLAW: 4, EYE: 5, MOUTH: 6, HORN: 7,
};

const noise = makeNoise3(SEED + 911);

const LEG_BONES = ['thighL', 'shinL', 'footL', 'toeL', 'toeEndL', 'thighR', 'shinR', 'footR', 'toeR', 'toeEndR'];
const UPPER_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head', 'headEnd',
  'shoulderL', 'armL', 'foreL', 'handL', 'handEndL',
  'shoulderR', 'armR', 'foreR', 'handR', 'handEndR',
  'mantleA', 'mantleB', 'mantleC',
];
/** The rig's three cloth bones are re-purposed as the tail chain. */
const TAIL_BONES = ['mantleA', 'mantleB', 'mantleC'];

function rotX(p, pivot, a) {
  const y = p[1] - pivot[1], z = p[2] - pivot[2];
  const c = Math.cos(a), s = Math.sin(a);
  p[1] = pivot[1] + y * c - z * s;
  p[2] = pivot[2] + y * s + z * c;
}

/**
 * Reuse `buildSkeleton()` and re-proportion it for a species.
 *
 * Returns the same {bones, byName, root} plus `P`, a name -> world rest
 * position map that the field authoring below builds its masses around. Because
 * the geometry is authored on exactly the positions the weights are painted
 * from, skinning cannot drift off the mesh.
 */
export function deriveRig(sp) {
  const { bones, byName, root } = buildSkeleton();
  const P = new Map(BONE_DEF.map((d) => [d[0], d[2].slice()]));

  const s = sp.height / 1.78;
  for (const p of P.values()) { p[0] *= s; p[1] *= s; p[2] *= s; }

  // ---- legs: length, stance width, and a permanently loaded knee
  const thighY = P.get('thighL')[1];
  const dHip = thighY * (sp.legLen - 1);
  const kneeFwd = (sp.kneeFwd ?? 0.062) * s;
  for (const n of LEG_BONES) {
    const p = P.get(n);
    p[1] *= sp.legLen;
    p[0] *= sp.stance;
  }
  for (const n of ['shinL', 'shinR']) P.get(n)[2] += kneeFwd;
  for (const n of ['footL', 'footR', 'toeL', 'toeR', 'toeEndL', 'toeEndR']) P.get(n)[2] -= kneeFwd * 0.45;
  for (const n of UPPER_BONES) P.get(n)[1] += dHip;

  // ---- torso width and arm length
  for (const n of ['shoulderL', 'armL', 'foreL', 'handL', 'handEndL',
    'shoulderR', 'armR', 'foreR', 'handR', 'handEndR']) {
    P.get(n)[0] *= sp.shoulderW;
  }
  for (const side of ['L', 'R']) {
    const a = P.get(`arm${side}`);
    for (const n of [`fore${side}`, `hand${side}`, `handEnd${side}`]) {
      const p = P.get(n);
      for (let i = 0; i < 3; i++) p[i] = a[i] + (p[i] - a[i]) * sp.armLen;
    }
  }

  // ---- the hunch: pitch the whole upper body forward about the hips
  const hips = P.get('hips').slice();
  for (const n of UPPER_BONES) if (n !== 'hips') rotX(P.get(n), hips, sp.hunch);

  // ---- skull: counter-pitch about the neck so the muzzle levels out again
  const neck = P.get('neck').slice();
  for (const n of ['head', 'headEnd']) rotX(P.get(n), neck, sp.headPitch);
  for (const n of ['neck', 'head', 'headEnd']) {
    const p = P.get(n);
    p[2] += sp.neckFwd * s;
    p[1] -= sp.neckDrop * s;
  }

  // ---- tail chain, re-seated off the hips going back and down
  {
    const t = sp.tail;
    const base = [0, hips[1] - 0.02 * s, hips[2] - 0.09 * s];
    for (let i = 0; i < 3; i++) {
      const u = (i + 1) / 3;
      P.set(TAIL_BONES[i], [
        base[0],
        base[1] - t.drop * u * u * s - 0.02 * s * u,
        base[2] - t.len * u * s,
      ]);
    }
  }

  // ---- push the new rest positions back into the bone hierarchy
  for (const b of bones) {
    const w = P.get(b.name);
    const pw = b.__parentName ? P.get(b.__parentName) : [0, 0, 0];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    b.__world = w;
  }
  for (const b of bones) {
    const kids = BONE_DEF.filter((d) => d[1] === b.name);
    if (kids.length) {
      const e = [0, 0, 0];
      for (const k of kids) {
        const kp = P.get(k[0]);
        for (let i = 0; i < 3; i++) e[i] += kp[i] / kids.length;
      }
      b.__end = e;
    } else {
      b.__end = [b.__world[0], b.__world[1] - 0.04, b.__world[2]];
    }
  }
  root.updateMatrixWorld(true);
  return { bones, byName, root, P };
}

// ------------------------------------------------------------------ field --
/**
 * The creature's masses. `fine` gates primitives that cannot survive the
 * coarse LOD1 grid.
 */
function buildField(sp, P, fine) {
  const F = new Field();
  const g = (n) => P.get(n);
  const s = sp.height / 1.78;
  const tw = sp.torsoW, td = sp.torsoD, ag = sp.armGirth, lg = sp.legGirth;

  const hips = g('hips'), spine = g('spine'), chest = g('chest'), neck = g('neck'), head = g('head');

  // ------------------------------------------------------------ torso ----
  F.ellipsoid([hips[0], hips[1], hips[2]],
    [0.128 * tw * s, 0.104 * s, 0.112 * td * s], { mat: EMAT.HIDE, k: 0.07 });
  F.capsule(hips, chest, 0.150 * s, 0.176 * s,
    { scale: [tw, 1, td * 0.86], mat: EMAT.HIDE, k: 0.08 });
  // slabbed pectoral / shoulder yoke — the mass that makes a Snagula top-heavy
  F.ellipsoid([0, chest[1] + 0.020 * s, chest[2] + 0.030 * s],
    [0.216 * tw * s, 0.126 * s, 0.132 * td * s], { mat: EMAT.HIDE, k: 0.09 });
  // gut, hanging forward and low
  F.ellipsoid([0, lerp(hips[1], spine[1], 0.35), lerp(hips[2], spine[2], 0.35) + 0.030 * s * sp.belly],
    [0.140 * tw * sp.belly * s, 0.122 * sp.belly * s, 0.132 * td * sp.belly * s],
    { mat: EMAT.HIDE, k: 0.08 });

  // ------------------------------------------------------------- neck ----
  F.capsule([chest[0], chest[1] + 0.05 * s, chest[2] + 0.01 * s], head,
    0.084 * s * tw, 0.072 * s, { mat: EMAT.HIDE, k: 0.07 });

  // ------------------------------------------------------------- arms ----
  for (const side of ['L', 'R']) {
    const sh = g(`arm${side}`), fo = g(`fore${side}`), ha = g(`hand${side}`), he = g(`handEnd${side}`);
    F.ellipsoid(sh, [0.092 * ag * s, 0.090 * ag * s, 0.088 * ag * s], { mat: EMAT.HIDE, k: 0.07 });
    F.capsule(sh, fo, 0.066 * ag * s, 0.052 * ag * s, { mat: EMAT.HIDE, k: 0.055 });
    F.capsule(fo, ha, 0.058 * ag * s, 0.040 * ag * s, { mat: EMAT.HIDE, k: 0.05 });
    F.ellipsoid([ha[0], ha[1] - 0.005 * s, ha[2] + 0.008 * s],
      [0.052 * ag * s, 0.040 * ag * s, 0.058 * ag * s], { mat: EMAT.HIDE, k: 0.04 });
    if (fine) {
      // three thick clawed fingers; the claws themselves are explicit geometry
      for (let i = 0; i < 3; i++) {
        const u = (i - 1) / 1;
        const dir = [he[0] - ha[0], he[1] - ha[1], he[2] - ha[2]];
        const tip = [
          ha[0] + dir[0] * 1.05 + u * 0.030 * s * (side === 'L' ? 1 : -1),
          ha[1] + dir[1] * 1.05,
          ha[2] + dir[2] * 1.05 + Math.abs(u) * -0.012 * s,
        ];
        F.capsule(ha, tip, 0.026 * ag * s, 0.020 * ag * s, { mat: EMAT.HIDE, k: 0.03 });
      }
    }
  }

  // ------------------------------------------------------------- legs ----
  for (const side of ['L', 'R']) {
    const th = g(`thigh${side}`), sn = g(`shin${side}`), ft = g(`foot${side}`), to = g(`toe${side}`);
    F.capsule(th, sn, 0.098 * lg * s, 0.068 * lg * s, { mat: EMAT.HIDE, k: 0.07 });
    F.capsule(sn, ft, 0.068 * lg * s, 0.044 * lg * s, { mat: EMAT.HIDE, k: 0.05 });
    F.capsule([ft[0], ft[1] - 0.020 * s, ft[2] - 0.020 * s],
      [to[0], to[1] - 0.012 * s, to[2] + 0.055 * s],
      0.050 * lg * s, 0.038 * lg * s, { scale: [0.92, 0.62, 1], mat: EMAT.HIDE, k: 0.04 });
  }

  // ------------------------------------------------------------- tail ----
  {
    const t = sp.tail;
    const a = g('mantleA'), b = g('mantleB'), c = g('mantleC');
    const root0 = [0, hips[1], hips[2] - 0.06 * s];
    F.capsule(root0, a, t.thick * 1.25 * s, t.thick * s, { mat: EMAT.HIDE, k: 0.05 });
    F.capsule(a, b, t.thick * s, t.thick * 0.62 * s, { mat: EMAT.HIDE, k: 0.04 });
    if (fine) F.capsule(b, c, t.thick * 0.62 * s, t.thick * 0.22 * s, { mat: EMAT.HIDE, k: 0.03 });
  }

  // ------------------------------------------------------------- head ----
  // HEAD UNITS: every number below is head-local and is multiplied by `hs`
  // (head scale in metres) exactly once, by `hp()` for positions and
  // explicitly for radii. Mixing the two is what buries features inside a mass.
  const hs = sp.headScale * s;
  const H = head;
  const hp = (dx, dy, dz) => [H[0] + dx * hs, H[1] + dy * hs, H[2] + dz * hs];
  const hr = (a, b, c) => [a * hs, b * hs, c * hs];
  const jw = sp.jawW, sl = sp.skullLen, jo = sp.jawOpen;

  // cranium + occipital shelf
  F.ellipsoid(hp(0, 0.046, -0.020), hr(0.090 * jw, 0.078, 0.094), { mat: EMAT.HIDE, k: 0.045, part: 'head' });
  F.ellipsoid(hp(0, 0.006, -0.052), hr(0.078 * jw, 0.068, 0.070), { mat: EMAT.HIDE, k: 0.05, part: 'head' });
  // jaw muscle wedges
  for (const sx of [1, -1]) {
    F.ellipsoid(hp(sx * 0.062 * jw, 0.004, 0.006), hr(0.044 * jw, 0.052, 0.058), { mat: EMAT.HIDE, k: 0.045, part: 'head' });
  }
  // brow: a single heavy bar. It is the shadow over the eye that makes the red
  // read as a glow rather than a dot, so it is deliberately over-scaled.
  F.box(hp(0, 0.066, 0.050), [0.086 * jw * hs, 0.019 * sp.browHeavy * hs, 0.022 * hs],
    { round: 0.012 * hs, mat: EMAT.PLATE, k: 0.026, part: 'head' });
  // upper muzzle
  F.capsule(hp(0, 0.014, 0.026), hp(0, -0.004, 0.026 + 0.108 * sl),
    0.062 * jw * hs, 0.036 * jw * hs,
    { scale: [1, 0.80, 1], mat: EMAT.HIDE, k: 0.030, part: 'head' });
  // lower jaw, hanging open — the permanent snarl
  F.capsule(hp(0, -0.040 - jo, 0.024), hp(0, -0.056 - jo, 0.024 + 0.098 * sl),
    0.054 * jw * hs, 0.032 * jw * hs,
    { scale: [1, 0.72, 1], mat: EMAT.HIDE, k: 0.030, part: 'head' });
  // throat, blending the jaw back into the neck
  F.ellipsoid(hp(0, -0.052 - jo * 0.55, -0.030), hr(0.062 * jw, 0.050, 0.062),
    { mat: EMAT.HIDE, k: 0.05, part: 'head' });
  // eye sockets carved under the brow
  for (const sx of [1, -1]) {
    F.ellipsoid(hp(sx * sp.eye.sep, sp.eye.y, sp.eye.z),
      hr(0.034, 0.030, 0.034), { op: 'sub', k: 0.020, part: 'head' });
  }
  // neck stub inside the head pass so the two resolutions overlap
  F.capsule(hp(0, -0.02, -0.05), [H[0], H[1] - 0.20 * s, H[2] - 0.10 * s],
    0.070 * s, 0.086 * s, { mat: EMAT.HIDE, k: 0.05, part: 'head' });

  return F;
}

// ----------------------------------------------------------- explicit bits --
/**
 * A faceted spike. Teeth, claws, dorsal spines and horns are all this: a cone
 * of `sides` faces from a base ring to an apex, flat-shaded so the edges stay
 * razor sharp at any distance. An SDF cannot give you this at 8 mm.
 */
function spike(base, apex, r, sides, bend) {
  const ax = [apex[0] - base[0], apex[1] - base[1], apex[2] - base[2]];
  const L = Math.hypot(ax[0], ax[1], ax[2]) || 1e-6;
  const n = [ax[0] / L, ax[1] / L, ax[2] / L];
  let up = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const t1 = [
    n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0],
  ];
  const l1 = Math.hypot(t1[0], t1[1], t1[2]) || 1;
  for (let i = 0; i < 3; i++) t1[i] /= l1;
  const t2 = [
    n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0],
  ];
  const pos = [];
  const idx = [];
  // base ring, a mid ring (so the spike can curve), then the apex
  const rings = bend ? 2 : 1;
  for (let ri = 0; ri <= rings; ri++) {
    const u = ri / rings;
    const rr = r * (1 - u) ** 0.85;
    const cx = base[0] + ax[0] * u + (bend ? bend[0] * u * u : 0);
    const cy = base[1] + ax[1] * u + (bend ? bend[1] * u * u : 0);
    const cz = base[2] + ax[2] * u + (bend ? bend[2] * u * u : 0);
    if (ri === rings) { pos.push(cx, cy, cz); break; }
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + 0.4;
      const c = Math.cos(a) * rr, sn = Math.sin(a) * rr;
      pos.push(cx + t1[0] * c + t2[0] * sn, cy + t1[1] * c + t2[1] * sn, cz + t1[2] * c + t2[2] * sn);
    }
  }
  const apexI = rings * sides;
  for (let ri = 0; ri < rings; ri++) {
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      if (ri === rings - 1) idx.push(ri * sides + k, ri * sides + k2, apexI);
      else idx.push(ri * sides + k, ri * sides + k2, (ri + 1) * sides + k2,
        ri * sides + k, (ri + 1) * sides + k2, (ri + 1) * sides + k);
    }
  }
  for (let k = 1; k < sides - 1; k++) idx.push(0, k + 1, k);   // base cap

  // flat shading: expand to per-face vertices
  const nT = idx.length;
  const P2 = new Float32Array(nT * 3), N2 = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    for (let e = 0; e < 3; e++) {
      P2[(t + 0) * 3 + e] = pos[a + e];
      P2[(t + 1) * 3 + e] = pos[b + e];
      P2[(t + 2) * 3 + e] = pos[c + e];
    }
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    let fx = e1[1] * e2[2] - e1[2] * e2[1];
    let fy = e1[2] * e2[0] - e1[0] * e2[2];
    let fz = e1[0] * e2[1] - e1[1] * e2[0];
    const ln = Math.hypot(fx, fy, fz) || 1;
    fx /= ln; fy /= ln; fz /= ln;
    for (let v = 0; v < 3; v++) {
      N2[(t + v) * 3] = fx; N2[(t + v) * 3 + 1] = fy; N2[(t + v) * 3 + 2] = fz;
    }
  }
  const indices = new Uint32Array(nT);
  for (let i = 0; i < nT; i++) indices[i] = i;
  return { positions: P2, normals: N2, indices, count: nT };
}

function fromGeo(geo) {
  const g2 = geo.index ? geo.toNonIndexed() : geo;
  const positions = new Float32Array(g2.attributes.position.array);
  const normals = new Float32Array(g2.attributes.normal.array);
  const count = positions.length / 3;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  geo.dispose(); g2.dispose();
  return { positions, normals, indices, count };
}

/** Merge a list of same-material spikes into one part. */
function mergeSpikes(list) {
  let nv = 0;
  for (const g of list) nv += g.count;
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const indices = new Uint32Array(nv);
  let o = 0;
  for (const g of list) {
    positions.set(g.positions, o * 3);
    normals.set(g.normals, o * 3);
    o += g.count;
  }
  for (let i = 0; i < nv; i++) indices[i] = i;
  return { positions, normals, indices, count: nv };
}

/**
 * Everything sharp, plus the eyes. All of it explicit geometry for the reason
 * in the file header.
 */
function buildPieces(sp, P, lodIdx) {
  const parts = [];
  const s = sp.height / 1.78;
  const hs = sp.headScale * s;
  const H = P.get('head');
  const hp = (dx, dy, dz) => [H[0] + dx * hs, H[1] + dy * hs, H[2] + dz * hs];
  const sides = lodIdx === 0 ? 4 : 3;
  const push = (g, mat, mask, tint) => {
    tagPart(g, mat, () => tint ?? [1, 1, 1]);
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = 0.90;
    g.mask = mask;
    parts.push(g);
  };

  // -------------------------------------------------------------- teeth ----
  {
    const T = sp.teeth;
    const jw = sp.jawW, sl = sp.skullLen, jo = sp.jawOpen;
    const upper = [], lower = [];
    const tl = T.len * hs, tw = T.w * hs, tk = T.tusk * hs;
    // the mouth line: an arc running forward along the muzzle, in head units
    const arcPoint = (u, lowerJaw) => {
      const a = u * T.arc;                       // u in [-1, 1]
      const x = Math.sin(a) * 0.050 * jw;
      const zf = lowerJaw ? 0.024 + 0.092 * sl : 0.026 + 0.100 * sl;
      const zb = lowerJaw ? 0.020 : 0.022;
      const z = lerp(zf, zb, Math.abs(u) ** 1.35);
      const y = lowerJaw
        ? (-0.050 - jo) + Math.abs(u) * 0.010
        : (-0.014) - Math.abs(u) * 0.006;
      return hp(x, y, z);
    };
    const nU = lodIdx === 0 ? T.upper : Math.max(4, T.upper - 2);
    const nL = lodIdx === 0 ? T.lower : Math.max(3, T.lower - 2);
    for (let i = 0; i < nU; i++) {
      const u = nU === 1 ? 0 : (i / (nU - 1)) * 2 - 1;
      const b = arcPoint(u, false);
      const len = tl * (1.0 - 0.28 * Math.abs(u)) * (i % 2 ? 0.78 : 1.0);
      upper.push(spike(b, [b[0], b[1] - len, b[2]], tw * (i % 2 ? 0.82 : 1), sides,
        [0, 0, len * 0.16]));
    }
    for (let i = 0; i < nL; i++) {
      const u = nL === 1 ? 0 : (i / (nL - 1)) * 2 - 1;
      const b = arcPoint(u, true);
      const len = tl * 0.88 * (1.0 - 0.25 * Math.abs(u)) * (i % 2 ? 0.80 : 1.0);
      lower.push(spike(b, [b[0], b[1] + len, b[2]], tw * (i % 2 ? 0.82 : 1), sides,
        [0, 0, len * 0.10]));
    }
    // tusks: the lower canines, long enough to clear the upper lip
    if (tk > 0.001) {
      for (const sx of [1, -1]) {
        const b = hp(sx * 0.046 * jw, -0.046 - jo, 0.052 + 0.030 * sl);
        lower.push(spike(b, [b[0] + sx * tk * 0.15, b[1] + tk, b[2] + tk * 0.18],
          tw * 1.9, sides + 1, [sx * tk * 0.25, 0, -tk * 0.30]));
      }
    }
    push(mergeSpikes([...upper, ...lower]), EMAT.TOOTH, { head: 1 }, [1, 1, 1]);
  }

  // --------------------------------------------------------------- eyes ----
  {
    const E = sp.eye;
    const geos = [];
    for (const sx of [1, -1]) {
      const g = new THREE.SphereGeometry(E.r * hs, lodIdx === 0 ? 12 : 6, lodIdx === 0 ? 9 : 5);
      const c = hp(sx * E.sep, E.y, E.z - E.sink);
      g.translate(c[0], c[1], c[2]);
      geos.push(fromGeo(g));
    }
    push(mergeSpikes(geos), EMAT.EYE, { head: 1 }, [1, 1, 1]);
  }

  // -------------------------------------------------------------- claws ----
  {
    const C = sp.claw;
    const list = [];
    for (const side of ['L', 'R']) {
      const ha = P.get(`hand${side}`), he = P.get(`handEnd${side}`);
      const dir = [he[0] - ha[0], he[1] - ha[1], he[2] - ha[2]];
      const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      for (let i = 0; i < C.count; i++) {
        const u = (i - (C.count - 1) / 2) / Math.max(1, (C.count - 1) / 2);
        const b = [
          ha[0] + dir[0] * 1.05 + u * 0.032 * s * (side === 'L' ? 1 : -1),
          ha[1] + dir[1] * 1.05,
          ha[2] + dir[2] * 1.05,
        ];
        const tip = [b[0] + dir[0] / dl * C.len * 0.35, b[1] + dir[1] / dl * C.len, b[2] + dir[2] / dl * C.len * 0.35];
        list.push(spike(b, tip, C.w, sides, [0, -C.len * 0.30, C.len * 0.20]));
      }
      // toe claws
      for (const foot of [`toe${side}`]) {
        const ft = P.get(foot);
        for (let i = -1; i <= 1; i++) {
          const b = [ft[0] + i * 0.034 * s, ft[1] - 0.006 * s, ft[2] + 0.048 * s];
          list.push(spike(b, [b[0], b[1] - 0.006 * s, b[2] + C.len * 0.62], C.w * 0.9, sides,
            [0, -C.len * 0.10, 0]));
        }
      }
    }
    push(mergeSpikes(list), EMAT.CLAW, null, [1, 1, 1]);
  }

  // ------------------------------------------------- dorsal spines, horns --
  {
    const S = sp.spines;
    const list = [];
    const chain = [P.get('hips'), P.get('spine'), P.get('chest'), P.get('neck'), P.get('head')];
    const along = (u) => {
      const f = clamp01(u) * (chain.length - 1);
      const i = Math.min(chain.length - 2, Math.floor(f));
      const t = f - i;
      return [
        lerp(chain[i][0], chain[i + 1][0], t),
        lerp(chain[i][1], chain[i + 1][1], t),
        lerp(chain[i][2], chain[i + 1][2], t),
      ];
    };
    const n = lodIdx === 0 ? S.count : Math.max(3, S.count >> 1);
    for (let i = 0; i < n; i++) {
      const u = lerp(S.from, S.to, n === 1 ? 0.5 : i / (n - 1));
      const p = along(u);
      const rise = Math.sin(Math.PI * clamp01((u - S.from) / (S.to - S.from))) * 0.55 + 0.45;
      const back = 0.130 * s * (1 - 0.25 * u) * sp.torsoD;
      const b = [p[0], p[1], p[2] - back];
      const h = S.h * rise * s;
      list.push(spike(b, [b[0], b[1] + h * 0.80, b[2] - h * 0.55], S.r * s * rise, sides,
        [0, 0, -h * 0.35]));
    }
    push(mergeSpikes(list), EMAT.PLATE, null, [1, 1, 1]);

    // horns, sweeping back off the skull
    const Hn = sp.horn;
    const hl = [];
    const hL = Hn.len * hs;
    for (const sx of [1, -1]) {
      const b = hp(sx * 0.072 * sp.jawW, 0.070, -0.040);
      hl.push(spike(b, [b[0] + sx * hL * 0.34, b[1] + hL * 0.62, b[2] - hL * 0.72],
        Hn.r * hs, sides + 1, [sx * hL * 0.18, -hL * 0.22, -hL * 0.24]));
    }
    push(mergeSpikes(hl), EMAT.HORN, { head: 1 }, [1, 1, 1]);
  }

  return parts;
}

// ---------------------------------------------------------------- meshing --
/** Ventral/dorsal material split and the dark mouth interior, by position. */
function matOverride(sp, P, x, y, z, nx, ny, nz) {
  const s = sp.height / 1.78;
  const hs = sp.headScale * s;
  const H = P.get('head');
  // inside the open mouth: between the jaw planes, forward of the cheeks
  const my = H[1] - (0.030 + sp.jawOpen * 0.5) * hs;
  const inSlot = z > H[2] + 0.010 * hs
    && Math.abs(y - my) < (0.030 + sp.jawOpen * 0.8) * hs
    && Math.abs(x - H[0]) < 0.078 * hs * sp.jawW;
  // only the surfaces that actually FACE INTO the gap: the underside of the
  // upper jaw and the top of the lower one. Everything else there is lip.
  if (inSlot && ((y > my && ny < 0.25) || (y <= my && ny > -0.25))) return EMAT.MOUTH;
  // belly / throat: downward- or forward-facing on the ventral centreline
  const hips = P.get('hips');
  const ventral = z > hips[2] - 0.02 && ny < 0.30 && nz > -0.10
    && Math.abs(x) < 0.24 * s * sp.torsoW && y < P.get('chest')[1] + 0.06 * s && y > hips[1] - 0.30 * s;
  if (ventral) return EMAT.BELLY;
  return null;
}

function meshPart(field, sp, P, parts, bmin, bmax, res, aoSample, opts) {
  const sample = field.sampler(parts);
  const g = surfaceNets(sample, bmin, bmax, res, opts);
  if (!g) return null;
  g.ao = bakeAO(aoSample, g.positions, g.normals, opts.ao ?? {});
  g.matAo = new Float32Array(g.count * 2);
  g.tint = new Float32Array(g.count * 3);
  g.masks = new Array(g.count);
  for (let v = 0; v < g.count; v++) {
    const x = g.positions[v * 3], y = g.positions[v * 3 + 1], z = g.positions[v * 3 + 2];
    const nx = g.normals[v * 3], ny = g.normals[v * 3 + 1], nz = g.normals[v * 3 + 2];
    const p = field.nearestPrim(x, y, z, parts);
    let m = p ? p.mat : EMAT.HIDE;
    if (m === EMAT.HIDE) m = matOverride(sp, P, x, y, z, nx, ny, nz) ?? m;
    g.matAo[v * 2] = m;
    g.matAo[v * 2 + 1] = g.ao[v];
    g.masks[v] = p ? p.bones : null;
    // authoring-time mottling: big irregular patches so no two Snagulas of the
    // same type read as the same paint job once the per-instance tint lands
    const b = 0.86 + 0.30 * noise(x * 5.3 + 11, y * 4.1, z * 5.3 + 4);
    const b2 = 0.92 + 0.18 * noise(x * 17.0, y * 13.0 + 7, z * 17.0);
    g.tint[v * 3] = b * b2 * 0.98;
    g.tint[v * 3 + 1] = b * b2;
    g.tint[v * 3 + 2] = b * b2 * 0.94;
  }
  return g;
}

/**
 * Build one species at one LOD.
 * Returns { geometry, skeleton pieces, tris } ready for the instancer.
 */
export function buildSnagula(sp, lodIdx) {
  const t0 = performance.now();
  const L = sp.lod[lodIdx];
  const fine = lodIdx === 0;
  const { bones, byName, root, P } = deriveRig(sp);
  const field = buildField(sp, P, fine);
  field.build();

  const s = sp.height / 1.78;
  const hs = sp.headScale * s;
  const H = P.get('head');
  const aoSample = field.sampler(null, true);

  // bounds
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of field.prims) {
    for (let i = 0; i < 3; i++) {
      mn[i] = Math.min(mn[i], p.aabb[i] - p.k);
      mx[i] = Math.max(mx[i], p.aabb[i + 3] + p.k);
    }
  }
  const pad = 0.04;
  const headMin = [H[0] - 0.20 * hs - pad, H[1] - 0.22 * hs - sp.jawOpen - pad, H[2] - 0.20 * hs - pad];
  const headMax = [H[0] + 0.20 * hs + pad, H[1] + 0.20 * hs + pad, H[2] + (0.06 + 0.16 * sp.skullLen) * hs + pad];

  const parts = [];
  const body = meshPart(field, sp, P, ['body'], [mn[0] - pad, mn[1] - pad, mn[2] - pad],
    [mx[0] + pad, mx[1] + pad, mx[2] + pad], L.bodyRes, aoSample,
    { smooth: L.smooth, project: L.project, ao: { radii: [0.03, 0.07, 0.14] } });
  if (body) parts.push(body);
  const head = meshPart(field, sp, P, ['head'], headMin, headMax, L.headRes, aoSample,
    { smooth: L.smooth, project: L.project, ao: { radii: [0.014, 0.038, 0.085] } });
  if (head) parts.push(head);
  for (const p of buildPieces(sp, P, lodIdx)) parts.push(p);

  // ------------------------------------------------------------ skinning --
  let total = 0;
  for (const p of parts) total += p.count;
  const skinIndex = new Uint16Array(total * 4);
  const skinWeight = new Float32Array(total * 4);
  let off = 0;
  for (const p of parts) {
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

  const geometry = mergeParts(parts);
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius *= 1.4;

  return {
    geometry,
    bones, byName, root, P,
    verts: total,
    tris: geometry.index.count / 3,
    ms: performance.now() - t0,
  };
}

export { clamp, clamp01, lerp, smoothstep };
