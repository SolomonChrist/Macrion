/**
 * Macrion — the character.  "The Warden", an original design.
 *
 * DESIGN INTENT (why the silhouette is what it is)
 * ------------------------------------------------
 * Level 1's hero has to be readable as a *shape* at 40 m in `backlit` and hold
 * up at 1.6 m in `portrait`. Those two demands pull in opposite directions, so
 * the design is built out of large asymmetric masses that survive being
 * reduced to black, each of which happens to also carry a distinct material:
 *
 *   - a high closed collar and a single flared pauldron on the camera-side
 *     shoulder: the upper silhouette is a lopsided triangle, not a barrel
 *   - a knee-length coat cut short at the front and long at the back, with an
 *     irregular hem — the lower silhouette reads as motion even when standing
 *   - a mantle falling from the far shoulder across the back to the near hip,
 *     so the 3/4 view has a shape crossing behind the body
 *   - a diagonal chest harness and a waist belt that break the torso into
 *     bands at different roughnesses
 *   - bare forearms between cloth sleeve and leather bracer, because skin
 *     against leather against cloth is where the material response reads
 *
 * CONSTRUCTION
 * ------------
 * Body, head and hair are one authored signed distance field, polygonized in
 * three passes at three resolutions (13 mm / 5.5 mm / 6 mm) so the face gets
 * the detail the portrait shot needs without paying for it over the whole
 * body. The head pass includes the neck; the body pass includes the collar,
 * and the collar is closed and tall enough that the resolution seam between
 * the two passes is never visible from outside.
 *
 * Order in `prims` is load-bearing: subtractions only cut geometry declared
 * before them. The coat hem cut is declared between the coat and the legs,
 * which is what lets a single azimuth-varying plane carve a long-back /
 * short-front hem without also slicing the shins off.
 */
import * as THREE from 'three';
import { SEED } from '../../core/engine.js';
import {
  Field, surfaceNets, bakeAO, loft, faceted, tagPart, makeNoise3, computeNormals,
  clamp, clamp01, lerp, smoothstep,
} from './geom.js';
import { MAT } from './material.js';

const D = Math.PI / 180;
const noise = makeNoise3(SEED + 5);

/** Torso half-extents by height — the surface every strap has to lie on. */
const TORSO_R = [
  [0.90, 0.150, 0.116], [1.00, 0.152, 0.116], [1.08, 0.150, 0.124],
  [1.16, 0.156, 0.114], [1.24, 0.172, 0.116], [1.32, 0.170, 0.110],
  [1.40, 0.158, 0.102], [1.46, 0.112, 0.086],
];
function torsoR(y) {
  for (let i = 0; i < TORSO_R.length - 1; i++) {
    const a = TORSO_R[i], b = TORSO_R[i + 1];
    if (y <= b[0] || i === TORSO_R.length - 2) {
      const t = clamp01((y - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
  }
  return [0.15, 0.11];
}

// ------------------------------------------------------------ the field ----
export function buildField() {
  const F = new Field();
  const B = 'body';

  const bodyBones = null;
  const skirtBones = { hips: 1.0, spine: 0.45, thighL: 0.30, thighR: 0.30 };
  const collarBones = { neck: 1.0, chest: 0.7, head: 0.15 };

  // ---------------------------------------------------------- torso ----
  F.ellipsoid([0, 0.972, 0.008], [0.148, 0.128, 0.112], { mat: MAT.CLOTH, k: 0.06, part: B });
  F.ellipsoid([0, 1.095, 0.010], [0.132, 0.098, 0.100], { mat: MAT.CLOTH, k: 0.06, part: B });
  F.ellipsoid([0, 1.252, 0.012], [0.170, 0.140, 0.113], { mat: MAT.CLOTH, k: 0.055, part: B });
  F.ellipsoid([0, 1.352, 0.004], [0.162, 0.078, 0.106], { mat: MAT.CLOTH, k: 0.05, part: B });
  // shoulder yoke + trapezius
  F.capsule([-0.152, 1.404, -0.004], [0.152, 1.404, -0.004], 0.076, 0.076,
    { scale: [1, 1, 0.95], mat: MAT.CLOTH, k: 0.05, part: B });
  F.capsule([-0.080, 1.432, -0.012], [0.080, 1.432, -0.012], 0.052, 0.052,
    { mat: MAT.CLOTH, k: 0.05, part: B });
  // scapular mass so the back is not a slab
  F.ellipsoid([0, 1.300, -0.062], [0.150, 0.120, 0.058], { mat: MAT.CLOTH, k: 0.06, part: B });
  // neck stub, deliberately thinner than the head pass's neck so it hides inside it
  F.capsule([0, 1.330, -0.006], [0, 1.440, 0.000], 0.042, 0.041,
    { mat: MAT.SKIN, k: 0.05, part: B, bones: collarBones });

  // ---------------------------------------------------------- coat -----
  F.capsule([0, 1.118, 0.008], [0, 0.735, 0.004], 0.150, 0.238,
    { scale: [1, 1, 0.80], mat: MAT.CLOTH, k: 0.055, part: B, bones: skirtBones });
  // hem: long at the back, short at the front, with a five-lobe irregularity.
  // Declared HERE so it only cuts the coat — the legs come after.
  F.custom((x, y, z) => {
    const th = Math.atan2(x, z);
    const hem = 0.700 + 0.108 * Math.cos(th) + 0.020 * Math.sin(th * 5 + 0.7)
      + 0.012 * Math.sin(th * 9 - 2.1);
    return y - hem;
  }, [-0.40, 0.40, -0.40, 0.40, 0.90, 0.40], { op: 'sub', k: 0.016, part: B });

  // NOTE: the high collar is NOT in the field. A collar is a ~15 mm shell, and
  // at the 14 mm body cell size an SDF shell that thin polygonizes into a torn
  // ribbon. It is built as a lofted piece in buildPieces() instead, where it
  // also gets the crisp top edge leather actually has.

  // ---------------------------------------------------------- legs -----
  for (const s of [1, -1]) {
    const T = s > 0 ? 'thighL' : 'thighR';
    const S = s > 0 ? 'shinL' : 'shinR';
    const FT = s > 0 ? 'footL' : 'footR';
    const TO = s > 0 ? 'toeL' : 'toeR';
    F.capsule([s * 0.094, 0.980, 0.006], [s * 0.100, 0.528, 0.022], 0.098, 0.069,
      { scale: [1, 1, 0.96], mat: MAT.PANT, k: 0.05, part: B, bones: { hips: 0.55, [T]: 1.0, [S]: 0.25 } });
    F.ellipsoid([s * 0.100, 0.524, 0.024], [0.068, 0.056, 0.072],
      { mat: MAT.PANT, k: 0.04, part: B, bones: { [T]: 1.0, [S]: 1.0 } });
    F.capsule([s * 0.100, 0.520, 0.020], [s * 0.104, 0.150, -0.008], 0.067, 0.050,
      { mat: MAT.PANT, k: 0.045, part: B, bones: { [T]: 0.3, [S]: 1.0 } });
    F.ellipsoid([s * 0.102, 0.400, -0.030], [0.060, 0.092, 0.066],
      { mat: MAT.PANT, k: 0.05, part: B, bones: { [S]: 1.0 } });
    // boot: shaft, heel, foot, toe, sole
    F.capsule([s * 0.104, 0.398, -0.014], [s * 0.105, 0.140, -0.010], 0.078, 0.067,
      { scale: [1, 1, 0.95], mat: MAT.BOOT, k: 0.03, part: B, bones: { [S]: 1.0, [FT]: 0.25 } });
    F.ellipsoid([s * 0.105, 0.098, -0.024], [0.058, 0.054, 0.062],
      { mat: MAT.BOOT, k: 0.03, part: B, bones: { [S]: 0.4, [FT]: 1.0 } });
    F.capsule([s * 0.105, 0.078, 0.006], [s * 0.105, 0.050, 0.132], 0.055, 0.041,
      { scale: [1, 0.9, 1], mat: MAT.BOOT, k: 0.03, part: B, bones: { [FT]: 1.0, [TO]: 0.5 } });
    F.ellipsoid([s * 0.105, 0.050, 0.152], [0.047, 0.034, 0.046],
      { mat: MAT.BOOT, k: 0.03, part: B, bones: { [FT]: 0.4, [TO]: 1.0 } });
    F.box([s * 0.105, 0.026, 0.048], [0.046, 0.011, 0.112],
      { round: 0.013, mat: MAT.BOOT, k: 0.014, part: B, bones: { [FT]: 1.0, [TO]: 0.6 } });
  }

  // ---------------------------------------------------------- arms -----
  for (const s of [1, -1]) {
    const SH = s > 0 ? 'shoulderL' : 'shoulderR';
    const AR = s > 0 ? 'armL' : 'armR';
    const FO = s > 0 ? 'foreL' : 'foreR';
    const HA = s > 0 ? 'handL' : 'handR';
    // deltoid + sleeve
    F.ellipsoid([s * 0.174, 1.406, 0.000], [0.076, 0.086, 0.080],
      { mat: MAT.CLOTH, k: 0.05, part: B, bones: { chest: 0.5, [SH]: 1.0, [AR]: 1.0 } });
    F.capsule([s * 0.176, 1.396, 0.000], [s * 0.198, 1.268, 0.010], 0.062, 0.055,
      { mat: MAT.CLOTH, k: 0.04, part: B, bones: { [SH]: 0.4, [AR]: 1.0 } });
    // sleeve cuff ring
    F.ellipsoid([s * 0.199, 1.264, 0.010], [0.060, 0.017, 0.060],
      { mat: MAT.CLOTH, k: 0.012, part: B, bones: { [AR]: 1.0 } });
    // bare upper forearm / elbow
    F.capsule([s * 0.198, 1.268, 0.010], [s * 0.212, 1.160, 0.020], 0.049, 0.046,
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 1.0, [FO]: 0.35 } });
    F.ellipsoid([s * 0.212, 1.158, 0.018], [0.047, 0.045, 0.047],
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 0.8, [FO]: 1.0 } });
    F.capsule([s * 0.212, 1.156, 0.020], [s * 0.223, 1.048, 0.062], 0.045, 0.038,
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 0.3, [FO]: 1.0 } });
    // bracer
    F.capsule([s * 0.223, 1.052, 0.060], [s * 0.233, 0.916, 0.106], 0.047, 0.041,
      { mat: MAT.LEATHER, k: 0.014, part: B, bones: { [FO]: 1.0, [HA]: 0.15 } });
    F.capsule([s * 0.233, 0.916, 0.106], [s * 0.235, 0.888, 0.118], 0.035, 0.034,
      { mat: MAT.SKIN, k: 0.016, part: B, bones: { [FO]: 1.0, [HA]: 0.6 } });
    // hand: palm mass, fingers, thumb
    F.capsule([s * 0.236, 0.886, 0.120], [s * 0.240, 0.808, 0.146], 0.040, 0.036,
      { scale: [0.62, 1, 1.12], mat: MAT.SKIN, k: 0.02, part: B, bones: { [FO]: 0.3, [HA]: 1.0 } });
    F.capsule([s * 0.240, 0.810, 0.148], [s * 0.242, 0.748, 0.150], 0.033, 0.024,
      { scale: [0.60, 1, 1.18], mat: MAT.SKIN, k: 0.018, part: B, bones: { [HA]: 1.0 } });
    F.capsule([s * 0.222, 0.872, 0.128], [s * 0.212, 0.818, 0.152], 0.017, 0.014,
      { mat: MAT.SKIN, k: 0.016, part: B, bones: { [HA]: 1.0 } });
  }

  // ------------------------------------------------- head (AO proxy) -----
  //
  // THE HEAD IS NO LONGER AN SDF. It is lofted geometry (see `headLoft` and
  // `faceParts` below), for one reason: surface nets polygonized the head on a
  // 5.8 mm grid, and a stylized anime face is built out of ~1-2 mm crisp edges
  // — a lash line, a brow edge, a lip line. Those are a fifth of a cell. No
  // amount of re-seating primitives fixes that; the previous pass already
  // proved it by raising every feature above the two-cell floor and still
  // getting a muddy face. Raising the grid to reach a 1 mm lash line would cost
  // roughly 200x the head's cells.
  //
  // Lofted cross-sections give exact triangles at any scale, and — more
  // importantly — an ANALYTIC surface, so every face feature can be placed on
  // it by construction instead of hoping it clears a level set. `headPt()` is
  // that surface, and it is the single source of truth for the head, the eyes,
  // the brows, the mouth and the hair cap alike.
  //
  // What stays in the field is a coarse proxy tagged part 'ao'. It is never
  // meshed (nothing asks for that part), but `field.sampler(null, true)`
  // includes it, so the body still gets correct ambient occlusion in the
  // collar and the head/hair still cast into each other's AO bake.
  // CRITICAL: every proxy must sit strictly INSIDE the lofted surface it stands
  // in for. bakeAO marches the field from each vertex; a proxy even 1 mm proud
  // puts the real surface inside solid material and the whole head bakes black.
  const A = 'ao';
  F.ellipsoid([0, 1.6720, -0.006], [0.0745, 0.0975, 0.0790], { mat: MAT.SKIN, k: 0.03, part: A });
  F.ellipsoid([0, 1.6000, 0.0100], [0.0600, 0.0460, 0.0560], { mat: MAT.SKIN, k: 0.03, part: A });
  F.ellipsoid([0, 1.5620, 0.0170], [0.0330, 0.0260, 0.0380], { mat: MAT.SKIN, k: 0.03, part: A });
  F.ellipsoid([0, 1.7250, -0.012], [0.0850, 0.0780, 0.0900], { mat: MAT.HAIR, k: 0.03, part: A });
  F.capsule([0, 1.400, -0.014], [0, 1.560, 0.000], 0.0450, 0.0400,
    { mat: MAT.SKIN, k: 0.04, part: A });

  // ---------------------------------------------------- neck (body) -----
  // The visible neck belongs to the head loft; this is only the stub the collar
  // sits on, kept in the body pass so the collar has something to occlude.
  F.capsule([0, 1.398, -0.016], [0, 1.500, 0.002], 0.0500, 0.0470,
    { scale: [1, 1, 0.97], mat: MAT.SKIN, k: 0.04, part: B, bones: { neck: 1.0, chest: 0.35, head: 0.3 } });


  return F;
}

// ---------------------------------------------------------------- tints ----
function tintFor(mat, x, y, z, nx, ny, nz) {
  let v = 0.90 + 0.22 * noise(x * 9.1 + 3, y * 9.1, z * 9.1 + 8);
  const t = [v, v, v];
  // sun-bleach on up-facing cloth, grime in the low creases
  const up = Math.max(0, ny);
  t[0] *= 1 + up * 0.05; t[1] *= 1 + up * 0.045; t[2] *= 1 + up * 0.03;
  // road dust rising up the boots and coat hem
  const dust = smoothstep(0.55, 0.03, y) * (mat === MAT.BOOT || mat === MAT.CLOTH || mat === MAT.PANT ? 1 : 0.3);
  t[0] *= 1 + dust * 0.85; t[1] *= 1 + dust * 0.70; t[2] *= 1 + dust * 0.42;
  // the back-left quadrant sits under the mantle: knock it down
  const shade = clamp01((-x * 1.4 - z * 2.2 - 0.10)) * clamp01((1.35 - y) * 2.2);
  const k = 1 - 0.30 * clamp01(shade);
  t[0] *= k; t[1] *= k; t[2] *= k;
  if (mat === MAT.SKIN) {
    // a little more blood in the ears, nose and knuckles
    const warm = smoothstep(0.055, 0.085, Math.abs(x)) * smoothstep(1.55, 1.66, y);
    t[0] *= 1 + warm * 0.16; t[2] *= 1 - warm * 0.07;
  }
  return t;
}

// -------------------------------------------------------------- meshing ----
function meshPart(field, parts, bmin, bmax, res, aoSample, opts = {}) {
  const sample = field.sampler(parts);
  const g = surfaceNets(sample, bmin, bmax, res, opts);
  if (!g) return null;
  g.ao = bakeAO(aoSample, g.positions, g.normals, opts.ao ?? {});
  g.matAo = new Float32Array(g.count * 2);
  g.tint = new Float32Array(g.count * 3);
  g.masks = new Array(g.count);
  for (let v = 0; v < g.count; v++) {
    const x = g.positions[v * 3], y = g.positions[v * 3 + 1], z = g.positions[v * 3 + 2];
    const p = field.nearestPrim(x, y, z, parts);
    const m = p ? p.mat : MAT.CLOTH;
    g.matAo[v * 2] = m;
    g.matAo[v * 2 + 1] = g.ao[v];
    g.masks[v] = p ? p.bones : null;
    const t = tintFor(m, x, y, z, g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]);
    g.tint[v * 3] = t[0]; g.tint[v * 3 + 1] = t[1]; g.tint[v * 3 + 2] = t[2];
  }
  return g;
}

// ------------------------------------------------------------- hardware ----
/** Rounded-rectangle cross-section in a (out, up) basis. */
function strapProfile(halfW, thick, inset) {
  const r = Math.min(thick * 0.6, halfW * 0.35);
  return [
    [-inset, halfW], [thick - r, halfW], [thick, halfW - r],
    [thick, -halfW + r], [thick - r, -halfW], [-inset, -halfW],
  ];
}

/** Sweep a strap along a path of {p, out, up}. */
function strap(path, halfW, thick, inset = 0.02) {
  const prof = strapProfile(halfW, thick, inset);
  const sections = path.map((s) => prof.map(([a, b]) => [
    s.p[0] + s.out[0] * a + s.up[0] * b,
    s.p[1] + s.out[1] * a + s.up[1] * b,
    s.p[2] + s.out[2] * a + s.up[2] * b,
  ]));
  return loft(sections, { closedU: true });
}

function fromThree(geo, matrix) {
  const g2 = geo.index ? geo : geo.toNonIndexed();
  if (matrix) g2.applyMatrix4(matrix);
  const positions = new Float32Array(g2.attributes.position.array);
  const normals = new Float32Array(g2.attributes.normal.array);
  const idx = g2.index ? g2.index.array : null;
  const count = positions.length / 3;
  const indices = idx ? new Uint32Array(idx) : new Uint32Array(count).map((_, i) => i);
  return { positions, normals, indices, count };
}

// ============================================================== the head ====
//
// The head, the face and the hair are lofted geometry, not SDF. See the long
// note in buildField(). `headPt()` below is the analytic head surface and it is
// the single source of truth: the skull loft, every face feature and the hair
// cap are all evaluated from it, so nothing can end up buried inside anything.

const Y_CHIN = 1.5430;
const Y_TOP = 1.7860;
const Y_EYE = 1.6420;

// y, halfWidth, halfDepth, zCentre, frontFlatten, frontNarrow
//
// frontFlatten < 1 raises cos(theta) toward 1 over a wider arc, which turns the
// front of each ring from a circle into a plane — that flat frontal plane
// through the brow, the cheek and the jaw is what separates a stylized anime
// head from a realistic one. frontNarrow pinches the front of the lower rings
// so the chin comes to a point instead of a spade.
const HEAD_PROF = [
  [1.5430, 0.0135, 0.0230, 0.0330, 1.00, 0.00],
  [1.5490, 0.0250, 0.0330, 0.0270, 1.00, 0.00],
  [1.5570, 0.0380, 0.0430, 0.0200, 0.96, 0.05],
  [1.5670, 0.0490, 0.0520, 0.0140, 0.92, 0.08],
  [1.5790, 0.0570, 0.0600, 0.0090, 0.88, 0.10],
  [1.5930, 0.0632, 0.0665, 0.0045, 0.85, 0.10],
  [1.6080, 0.0678, 0.0715, 0.0010, 0.83, 0.09],
  [1.6250, 0.0716, 0.0752, -0.0015, 0.81, 0.07],
  [1.6420, 0.0745, 0.0778, -0.0035, 0.80, 0.05],
  [1.6600, 0.0768, 0.0797, -0.0055, 0.81, 0.03],
  [1.6800, 0.0784, 0.0812, -0.0080, 0.85, 0.00],
  [1.7000, 0.0786, 0.0818, -0.0100, 0.90, 0.00],
  [1.7220, 0.0760, 0.0796, -0.0118, 0.95, 0.00],
  [1.7440, 0.0692, 0.0730, -0.0132, 1.00, 0.00],
  [1.7640, 0.0560, 0.0600, -0.0140, 1.00, 0.00],
  [1.7780, 0.0355, 0.0390, -0.0145, 1.00, 0.00],
  [1.7860, 0.0110, 0.0125, -0.0148, 1.00, 0.00],
];

function headSec(y) {
  const P = HEAD_PROF;
  if (y <= P[0][0]) return P[0];
  for (let i = 0; i < P.length - 1; i++) {
    if (y <= P[i + 1][0]) {
      const t = (y - P[i][0]) / (P[i + 1][0] - P[i][0]);
      const o = new Array(P[i].length);
      for (let k = 0; k < P[i].length; k++) o[k] = lerp(P[i][k], P[i + 1][k], t);
      return o;
    }
  }
  return P[P.length - 1];
}

function headBase(y, th) {
  const s = headSec(y);
  const st = Math.sin(th), ct = Math.cos(th);
  const cc = ct >= 0 ? Math.pow(ct, s[4]) : -Math.pow(-ct, 1.0);
  const ss = (st >= 0 ? 1 : -1) * Math.pow(Math.abs(st), 0.92);
  return [s[1] * ss * (1 - s[5] * Math.max(0, cc)), y, s[3] + s[2] * cc];
}

function headNrm(y, th) {
  const p = headBase(y, th);
  const a = headBase(y, th + 0.02);
  const up = y + 0.0025 <= Y_TOP;
  const b = headBase(up ? y + 0.0025 : y - 0.0025, th);
  const sg = up ? 1 : -1;
  const t1 = [a[0] - p[0], 0, a[2] - p[2]];
  const t2 = [(b[0] - p[0]) * sg, (b[1] - p[1]) * sg, (b[2] - p[2]) * sg];
  const n = [
    t1[1] * t2[2] - t1[2] * t2[1],
    t1[2] * t2[0] - t1[0] * t2[2],
    t1[0] * t2[1] - t1[1] * t2[0],
  ];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

function headPt(y, th, out = 0) {
  const p = headBase(y, th);
  if (!out) return p;
  const n = headNrm(y, th);
  return [p[0] + n[0] * out, p[1] + n[1] * out, p[2] + n[2] * out];
}

/**
 * Face coordinates. `u` is signed horizontal distance across the face measured
 * at the surface (so u ~= x near the centreline and wraps correctly toward the
 * temple), `v` is height above the eye line, `out` is displacement along the
 * surface normal. Every feature below is authored in these three numbers, which
 * is why none of them can end up inside the skull.
 */
function faceP(u, v, out = 0) {
  const y = clamp(Y_EYE + v, Y_CHIN + 0.0005, Y_TOP - 0.0005);
  const s = headSec(y);
  return headPt(y, u / Math.max(0.020, s[1] * 0.97), out);
}

/** Flip a closed mesh if its signed volume came out negative. */
function orient(g) {
  let vol = 0;
  const P = g.positions, I = g.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
         - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
         + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) {
    for (let i = 0; i < I.length; i += 3) { const s = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = s; }
    g.normals = computeNormals(g.positions, g.indices);
  }
  return g;
}

/** Set every vertex tint from a callback on its position. */
function paint(g, fn) {
  for (let v = 0; v < g.count; v++) {
    const c = fn(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2], v);
    if (!c) continue;
    g.tint[v * 3] = c[0]; g.tint[v * 3 + 1] = c[1]; g.tint[v * 3 + 2] = c[2];
  }
  return g;
}

/** Ribbon: sweep a rectangle in (height, out) along a face curve. */
function faceRibbon(samples) {
  return orient(loft(samples.map((s) => [
    faceP(s.u, s.b0, s.o0), faceP(s.u, s.b1, s.o0),
    faceP(s.u, s.b1, s.o1), faceP(s.u, s.b0, s.o1),
  ]), { closedU: true }));
}

/** Lens/dome: an outline shrunk toward its centre while lifting off the face. */
function faceDome(outline, ctr, rings) {
  return orient(loft(rings.map(([sc, o]) => outline.map(([u, v]) =>
    faceP(ctr[0] + (u - ctr[0]) * sc, ctr[1] + (v - ctr[1]) * sc, o))), { closedU: true }));
}

function ellipseOutline(cx, cy, rx, ry, n) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return p;
}

// ---- the eye ---------------------------------------------------------------
// Anime eye geometry, top to bottom: a lash line (a thick, hard black band that
// thickens and flicks up toward the temple — this is the single feature that
// makes the read work), a bright sclera lens, a large iris with a limbal ring
// and a vertical value gradient, a pupil, two specular dots, and a thin lower
// lid. All of it is exact triangles, so it stays crisp at any distance.
const EYE_U = 0.0372;   // centre, distance from the face centreline
const EYE_W = 0.0180;   // half width
const EYE_HU = 0.0130;  // upper lid height
const EYE_HL = 0.0096;  // lower lid depth
const EYE_TILT = 0.20;  // outer corner rise

function eyeOutline(sgn, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let a, b;
    if (t < 0.5) {
      a = EYE_W * Math.cos(Math.PI * (t / 0.5));
      b = EYE_HU * Math.pow(Math.max(0, 1 - (a / EYE_W) ** 2), 0.42);
    } else {
      a = -EYE_W * Math.cos(Math.PI * ((t - 0.5) / 0.5));
      b = -EYE_HL * Math.pow(Math.max(0, 1 - (a / EYE_W) ** 2), 0.55);
    }
    pts.push([sgn * (EYE_U + a), b + EYE_TILT * a]);
  }
  return pts;
}

// ---- hair ------------------------------------------------------------------
const HAIR_RIM = [
  [0.00, 1.6975], [0.35, 1.6890], [0.70, 1.6800], [1.05, 1.6710], [1.40, 1.6630],
  [1.75, 1.6490], [2.20, 1.6230], [2.65, 1.5990], [3.15, 1.5910],
];
function hairRimY(th) {
  let a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
  a = Math.min(a, 3.15);
  let y = HAIR_RIM[HAIR_RIM.length - 1][1];
  for (let i = 0; i < HAIR_RIM.length - 1; i++) {
    if (a <= HAIR_RIM[i + 1][0]) {
      const t = (a - HAIR_RIM[i][0]) / (HAIR_RIM[i + 1][0] - HAIR_RIM[i][0]);
      y = lerp(HAIR_RIM[i][1], HAIR_RIM[i + 1][1], t);
      break;
    }
  }
  // widow's peak, then a scalloped edge so the hairline is not a drawn circle
  return y - 0.0085 * Math.exp(-((th / 0.26) ** 2)) + 0.0032 * Math.sin(th * 7.0);
}

const HAIR_OUT = [0.0018, 0.0090, 0.0165, 0.0215, 0.0250, 0.0272, 0.0282, 0.0282, 0.0270, 0.0250, 0.0230];

function bez(a, c, b, t) {
  const it = 1 - t;
  return [
    it * it * a[0] + 2 * it * t * c[0] + t * t * b[0],
    it * it * a[1] + 2 * it * t * c[1] + t * t * b[1],
    it * it * a[2] + 2 * it * t * c[2] + t * t * b[2],
  ];
}
function bezD(a, c, b, t) {
  const d = [
    2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]),
    2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]),
    2 * (1 - t) * (c[2] - a[2]) + 2 * t * (b[2] - c[2]),
  ];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * One hair clump: a quadratic sweep with a flattened cross-section that tapers
 * to a point. Flat rather than round because a clump of hair is a ribbon, and
 * because a flat spike keeps a hard edge in the backlit silhouette.
 */
function spike(a, c, b, w0, flat = 0.42, ns = 6, nu = 6) {
  const sections = [];
  for (let s = 0; s < ns; s++) {
    const t = s / (ns - 1);
    const p = bez(a, c, b, t);
    const d = bezD(a, c, b, t);
    const ref = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const e1 = norm3(cross3(d, ref));
    const e2 = norm3(cross3(e1, d));
    const w = w0 * Math.pow(1 - t, 0.85) + 0.0004;
    const sec = [];
    for (let u = 0; u < nu; u++) {
      const ang = (u / nu) * Math.PI * 2;
      const r1 = w * Math.cos(ang), r2 = w * flat * Math.sin(ang);
      sec.push([
        p[0] + e1[0] * r1 + e2[0] * r2,
        p[1] + e1[1] * r1 + e2[1] * r2,
        p[2] + e1[2] * r1 + e2[2] * r2,
      ]);
    }
    sections.push(sec);
  }
  return orient(loft(sections, { closedU: true }));
}

// Original silhouette: forward-falling bangs over the brow, a tall swept crown
// fan, and a long occipital sweep. Asymmetric on purpose — the near side reads
// heavier so the shape is not a mirrored ornament.
const HAIR_SPIKES = [
  // front bangs, tips down at brow height
  [[-0.012, 1.762, 0.052], [-0.032, 1.742, 0.086], [-0.042, 1.674, 0.084], 0.0170],
  [[0.014, 1.764, 0.050], [0.038, 1.744, 0.084], [0.050, 1.682, 0.078], 0.0160],
  [[0.001, 1.772, 0.038], [0.002, 1.754, 0.082], [0.005, 1.660, 0.076], 0.0130],
  [[-0.050, 1.744, 0.036], [-0.078, 1.718, 0.062], [-0.088, 1.656, 0.050], 0.0145],
  [[0.052, 1.742, 0.034], [0.082, 1.714, 0.060], [0.092, 1.648, 0.046], 0.0155],
  // crown fan, the tall part of the silhouette
  [[0.000, 1.796, -0.004], [0.004, 1.856, -0.040], [0.010, 1.894, -0.088], 0.0260],
  [[-0.038, 1.790, -0.010], [-0.062, 1.846, -0.048], [-0.070, 1.872, -0.102], 0.0230],
  [[0.040, 1.788, -0.012], [0.070, 1.842, -0.046], [0.084, 1.864, -0.098], 0.0230],
  [[-0.016, 1.796, 0.028], [-0.028, 1.858, 0.010], [-0.036, 1.900, -0.030], 0.0200],
  [[0.022, 1.794, 0.026], [0.042, 1.852, 0.008], [0.054, 1.886, -0.026], 0.0195],
  // occiput sweep
  [[-0.062, 1.744, -0.062], [-0.088, 1.742, -0.126], [-0.096, 1.716, -0.178], 0.0210],
  [[0.064, 1.740, -0.060], [0.092, 1.736, -0.124], [0.106, 1.708, -0.174], 0.0210],
  [[0.000, 1.752, -0.086], [0.004, 1.756, -0.148], [0.008, 1.734, -0.208], 0.0240],
  [[-0.034, 1.700, -0.086], [-0.052, 1.678, -0.146], [-0.058, 1.638, -0.192], 0.0200],
  [[0.036, 1.698, -0.084], [0.056, 1.674, -0.142], [0.064, 1.632, -0.188], 0.0200],
  // temple sweeps
  [[-0.078, 1.702, 0.002], [-0.106, 1.694, -0.052], [-0.112, 1.662, -0.100], 0.0160],
  [[0.080, 1.700, 0.000], [0.110, 1.690, -0.050], [0.120, 1.656, -0.098], 0.0165],
  // nape
  [[-0.024, 1.616, -0.078], [-0.030, 1.590, -0.110], [-0.030, 1.562, -0.126], 0.0155],
  [[0.026, 1.614, -0.076], [0.034, 1.588, -0.108], [0.036, 1.558, -0.124], 0.0155],
];

export function buildPieces(field = null, aoSample = null) {
  const parts = [];
  const push = (g, mat, mask, tintScale = 1) => {
    tagPart(g, mat, (x, y, z) => {
      const t = tintFor(mat, x, y, z, 0, 0.3, 0);
      return [t[0] * tintScale, t[1] * tintScale, t[2] * tintScale];
    });
    // hard-surface parts get a mild ambient occlusion floor rather than a bake
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = 0.86;
    g.mask = mask;
    parts.push(g);
    return g;
  };

  // ---------------------------------------------------------- collar ----
  // A stand-up leather collar. It is the piece that hides the resolution seam
  // between the 14 mm body pass and the 6 mm head pass, so its inner surface
  // tracks the neck cone with only 4-6 mm of clearance and its bottom edge
  // sits below where the neck meets the trapezius.
  {
    const neckR = (y) => lerp(0.0625, 0.0505, clamp01((y - 1.398) / 0.158));
    const cz = -0.010;
    const yB = 1.391;
    const NS = 42;
    const sections = [];
    for (let i = 0; i <= NS; i++) {
      const th = (i / NS) * Math.PI * 2;
      const front = Math.max(0, Math.cos(th));
      const yT = 1.512 - 0.048 * front * front;
      const rIB = neckR(yB) + 0.007, rOB = rIB + 0.022;
      const rIT = neckR(yT) + 0.004, rOT = rIT + 0.021;
      const prof = [
        [rIB, yB + 0.005], [rIB + 0.007, yB], [rOB, yB + 0.007],
        [rOT, yT - 0.007], [rOT - 0.006, yT], [rIT + 0.005, yT], [rIT, yT - 0.006],
      ];
      sections.push(prof.map(([r, y]) => [r * Math.sin(th), y, cz + r * Math.cos(th)]));
    }
    push(loft(sections, { closedU: true }), MAT.LEATHER,
      { neck: 1.0, chest: 0.55, head: 0.18 });
  }

  // ------------------------------------------------------------ belt ----
  {
    const y = 1.074;
    const [rx, rz] = torsoR(y);
    const path = [];
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const sx = Math.sin(th), cz = Math.cos(th);
      const ox = sx / (rx + 0.012), oz = cz / (rz + 0.012);
      const l = Math.hypot(ox, oz);
      path.push({
        p: [(rx + 0.010) * sx, y + 0.004 * Math.cos(th * 2), (rz + 0.012) * cz],
        out: [ox / l, 0, oz / l], up: [0, 1, 0],
      });
    }
    push(strap(path, 0.031, 0.013, 0.030), MAT.LEATHER, { hips: 1.0, spine: 0.5 });
    // buckle
    const bk = new THREE.BoxGeometry(0.052, 0.048, 0.014);
    const m = new THREE.Matrix4().makeTranslation(0.008, 1.074, torsoR(1.074)[1] + 0.022);
    push(faceted(fromThree(bk, m)), MAT.METAL, { hips: 1.0, spine: 0.4 });
    const bk2 = new THREE.BoxGeometry(0.030, 0.026, 0.020);
    const m2 = new THREE.Matrix4().makeTranslation(0.008, 1.074, torsoR(1.074)[1] + 0.028);
    push(faceted(fromThree(bk2, m2)), MAT.LEATHER, { hips: 1.0, spine: 0.4 });
  }

  // -------------------------------------------------- chest harness ----
  {
    // over the near (+X) shoulder, down across the chest to the far hip
    const key = [
      [0.30, 1.430], [0.24, 1.352], [0.10, 1.270], [-0.08, 1.196], [-0.26, 1.124],
    ];
    const path = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const f = t * (key.length - 1);
      const i0 = Math.min(key.length - 2, Math.floor(f));
      const u = f - i0;
      const th = lerp(key[i0][0], key[i0 + 1][0], u) * Math.PI;
      const y = lerp(key[i0][1], key[i0 + 1][1], u);
      const [rx, rz] = torsoR(y);
      const sx = Math.sin(th), cz = Math.cos(th);
      const ox = sx / rx, oz = cz / rz;
      const l = Math.hypot(ox, oz);
      path.push({ p: [rx * sx, y, rz * cz], out: [ox / l, 0, oz / l], up: null, th });
    }
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)].p, b = path[Math.min(path.length - 1, i + 1)].p;
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      const o = path[i].out;
      // up = tangent x out, normalized -> lies on the surface, across the strap
      let ux = ty * o[2] - tz * o[1], uy = tz * o[0] - tx * o[2], uz = tx * o[1] - ty * o[0];
      const ul = Math.hypot(ux, uy, uz) || 1;
      path[i].up = [ux / ul, uy / ul, uz / ul];
    }
    push(strap(path, 0.028, 0.011, 0.024), MAT.LEATHER, { chest: 1.0, spine: 0.4, hips: 0.2 });
    // ring where the harness crosses the sternum
    const ring = new THREE.TorusGeometry(0.024, 0.0055, 8, 20);
    const mm = new THREE.Matrix4().makeRotationY(0.35)
      .premultiply(new THREE.Matrix4().makeTranslation(0.062, 1.290, torsoR(1.29)[1] + 0.006));
    push(fromThree(ring, mm), MAT.METAL, { chest: 1.0 });
  }

  // -------------------------------------------------------- pauldron ----
  {
    const C = [0.150, 1.402, 0.0];
    const lames = [[0.00, 0.38], [0.32, 0.70], [0.64, 1.00]];
    lames.forEach(([v0, v1], li) => {
      const NS = 5, NU = 22, th = 0.009;
      const sections = [];
      for (let s = 0; s < NS; s++) {
        const v = lerp(v0, v1, s / (NS - 1));
        const E = lerp(74, -34, v) * D;
        const Rr = lerp(0.086, 0.158, v) * (1 + li * 0.028);
        const A = lerp(76, 88, v) * D;
        const outer = [], inner = [];
        for (let u = 0; u < NU; u++) {
          const a = (-1 + (2 * u) / (NU - 1)) * A;
          const dx = Math.cos(E) * Math.cos(a), dy = Math.sin(E), dz = Math.cos(E) * Math.sin(a) * 1.15;
          const l = Math.hypot(dx, dy, dz);
          const ex = dx / l, ey = dy / l, ez = dz / l;
          outer.push([C[0] + ex * Rr, C[1] + ey * Rr, C[2] + ez * Rr]);
          inner.push([C[0] + ex * (Rr - th), C[1] + ey * (Rr - th), C[2] + ez * (Rr - th)]);
        }
        sections.push(outer.concat(inner.reverse()));
      }
      push(loft(sections, { closedU: true }), li === 2 ? MAT.LEATHER : MAT.LEATHER,
        { shoulderL: 1.0, chest: 0.45, armL: 0.35 });
    });
    // rivets along the lower lame edge
    for (let i = 0; i < 5; i++) {
      const a = (-0.72 + (i / 4) * 1.44) * 88 * D;
      const E = -30 * D, Rr = 0.160;
      const dx = Math.cos(E) * Math.cos(a), dy = Math.sin(E), dz = Math.cos(E) * Math.sin(a) * 1.15;
      const l = Math.hypot(dx, dy, dz);
      const s = new THREE.SphereGeometry(0.0058, 8, 6);
      const m = new THREE.Matrix4().makeTranslation(
        C[0] + (dx / l) * Rr, C[1] + (dy / l) * Rr, C[2] + (dz / l) * Rr);
      push(fromThree(s, m), MAT.METAL, { shoulderL: 1.0, chest: 0.4, armL: 0.35 });
    }
  }

  // ---------------------------------------------------------- mantle ----
  {
    const NV = 17, NU = 26, th = 0.011;
    const sections = [];
    for (let s = 0; s < NV; s++) {
      const v = s / (NV - 1);
      const th0 = lerp(-88, -80, v) * D;
      const th1 = lerp(-232, -308, v) * D;
      const Rr = lerp(0.180, 0.300, Math.pow(v, 1.25));
      const cz = -0.004 - 0.035 * v;
      const outer = [], inner = [];
      for (let u = 0; u < NU; u++) {
        const uu = u / (NU - 1);
        const a = lerp(th0, th1, uu);
        let y = 1.452 - 0.792 * v;
        // torn hem, only near the bottom
        const tearing = smoothstep(0.72, 1.0, v);
        y -= tearing * (0.052 * (0.5 + 0.5 * Math.sin(uu * 13.0 + 1.1))
          + 0.030 * noise(uu * 7.3, 2.1, 0.5));
        const rx = Rr, rz = Rr * 0.84;
        const sx = Math.sin(a), czz = Math.cos(a);
        const nx = sx / rx, nz = czz / rz;
        const nl = Math.hypot(nx, nz);
        outer.push([rx * sx, y, cz + rz * czz]);
        inner.push([rx * sx - (nx / nl) * th, y, cz + rz * czz - (nz / nl) * th]);
      }
      sections.push(outer.concat(inner.reverse()));
    }
    const g = loft(sections, { closedU: true });
    // mantle rides the cloth chain so it lags the body
    push(g, MAT.MANTLE, null, 1.0);
    g.mask = (x, y) => {
      const t = clamp01((1.452 - y) / 0.79);
      if (t < 0.25) return { chest: 1.0, shoulderR: 0.5, mantleA: 0.9, spine: 0.2 };
      if (t < 0.58) return { mantleA: 1.0, mantleB: 0.8, chest: 0.35, spine: 0.3 };
      if (t < 0.82) return { mantleB: 1.0, mantleC: 0.7, hips: 0.25 };
      return { mantleC: 1.0, mantleB: 0.5, hips: 0.15 };
    };
    // mantle clasp on the far shoulder
    const cl = new THREE.SphereGeometry(0.017, 12, 9);
    const m = new THREE.Matrix4().makeScale(1, 1, 0.6)
      .premultiply(new THREE.Matrix4().makeTranslation(-0.150, 1.418, 0.030));
    push(fromThree(cl, m), MAT.METAL, { chest: 1.0, shoulderR: 0.8 });
  }

  // ------------------------------------------------------------ sash ----
  {
    for (const [x0, z0, len, wob] of [[0.118, 0.108, 0.44, 1.0], [0.148, 0.070, 0.36, -1.3]]) {
      const NS = 14;
      const sections = [];
      const prof = strapProfile(0.030, 0.006, 0.006);
      for (let i = 0; i < NS; i++) {
        const t = i / (NS - 1);
        const y = 1.078 - len * t;
        const bend = 0.045 * t * t * wob;
        const p = [x0 + bend * 0.5, y, z0 + 0.035 * t + 0.02 * Math.sin(t * 3 + wob)];
        const out = [Math.sin(0.9 + bend * 4), 0, Math.cos(0.9 + bend * 4)];
        const up = [0, 1, 0];
        // width tapers to a point at the tip
        const w = 0.030 * (1 - 0.55 * t * t);
        sections.push(prof.map(([a, b]) => [
          p[0] + out[0] * a + up[0] * b * (w / 0.030),
          p[1] + up[1] * b * (w / 0.030),
          p[2] + out[2] * a,
        ]));
      }
      push(loft(sections, { closedU: true }), MAT.SASH, null);
      parts[parts.length - 1].mask = (x, y) => {
        const t = clamp01((1.078 - y) / len);
        return { hips: 1.0 - 0.4 * t, mantleB: 0.5 * t, mantleC: 0.4 * t * t, thighL: 0.15 };
      };
    }
  }

  // ---------------------------------------------------- boot straps ----
  for (const s of [1, -1]) {
    const SH = s > 0 ? 'shinL' : 'shinR';
    for (const [y, r] of [[0.352, 0.079], [0.196, 0.073]]) {
      const path = [];
      const N = 22;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        path.push({
          p: [s * 0.104 + r * Math.sin(th), y, -0.012 + r * 0.95 * Math.cos(th)],
          out: [Math.sin(th), 0, Math.cos(th)], up: [0, 1, 0],
        });
      }
      push(strap(path, 0.016, 0.008, 0.014), MAT.LEATHER, { [SH]: 1.0 });
      const bk = new THREE.BoxGeometry(0.020, 0.019, 0.010);
      const m = new THREE.Matrix4().makeTranslation(s * 0.104, y, -0.012 + r + 0.008);
      push(faceted(fromThree(bk, m)), MAT.METAL, { [SH]: 1.0 });
    }
  }

  // -------------------------------------------------- bracer straps ----
  for (const s of [1, -1]) {
    const FO = s > 0 ? 'foreL' : 'foreR';
    for (const t of [0.22, 0.72]) {
      const a = [s * 0.223, 1.052, 0.060], b = [s * 0.233, 0.916, 0.106];
      const c = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      const r = lerp(0.049, 0.043, t);
      let ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
      const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
      // basis perpendicular to the forearm axis
      let e1 = [1, 0, 0];
      let u1 = [ay * e1[2] - az * e1[1], az * e1[0] - ax * e1[2], ax * e1[1] - ay * e1[0]];
      let ul = Math.hypot(...u1); u1 = u1.map((q) => q / ul);
      const u2 = [ay * u1[2] - az * u1[1], az * u1[0] - ax * u1[2], ax * u1[1] - ay * u1[0]];
      const path = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const dx = u1[0] * Math.cos(th) + u2[0] * Math.sin(th);
        const dy = u1[1] * Math.cos(th) + u2[1] * Math.sin(th);
        const dz = u1[2] * Math.cos(th) + u2[2] * Math.sin(th);
        path.push({ p: [c[0] + dx * r, c[1] + dy * r, c[2] + dz * r], out: [dx, dy, dz], up: [ax, ay, az] });
      }
      push(strap(path, 0.011, 0.006, 0.010), MAT.LEATHER, { [FO]: 1.0 });
    }
  }

  // ------------------------------------------------------------ eyes ----
  // The eyeball must sit BEHIND the lid surface at every point of the aperture,
  // or it reads as a loose ball stuck on the face. The lids' front surface is
  // at z ~= 0.0785; a 13.2 mm ball centred at z = 0.0628 fronts at 0.0760, so
  // it stays 2.5 mm inside the lid line all the way round the (now resolvable)
  // palpebral opening.
  for (const s of [1, -1]) {
    const R = 0.0132;
    const c = [s * 0.0338, 1.6512, 0.0628];
    const sph = new THREE.SphereGeometry(R, 22, 16);
    const m = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]);
    const g = fromThree(sph, m);
    tagPart(g, MAT.EYE, null);
    // gaze: slightly toward the camera side and level
    const gaze = [s * 0.16, -0.02, 0.986];
    const gl = Math.hypot(...gaze);
    for (let v = 0; v < g.count; v++) {
      const dx = (g.positions[v * 3] - c[0]) / R;
      const dy = (g.positions[v * 3 + 1] - c[1]) / R;
      const dz = (g.positions[v * 3 + 2] - c[2]) / R;
      const d = (dx * gaze[0] + dy * gaze[1] + dz * gaze[2]) / gl;
      const ang = Math.acos(clamp(d, -1, 1));
      let col;
      // a larger iris than life — the stylized read, and it survives the
      // aperture instead of vanishing behind the lids
      if (ang < 0.30) col = [0.02, 0.017, 0.016];                        // pupil
      else if (ang < 0.78) {
        const q = smoothstep(0.30, 0.78, ang);
        col = [lerp(0.24, 0.46, q), lerp(0.30, 0.46, q), lerp(0.20, 0.31, q)];   // iris
        const limb = smoothstep(0.64, 0.78, ang);
        col = col.map((v2) => v2 * (1 - limb * 0.78));                   // limbal ring
      } else {
        const q = smoothstep(0.78, 1.6, ang);
        col = [lerp(0.86, 1.02, q), lerp(0.80, 0.98, q), lerp(0.78, 0.95, q)];   // sclera
      }
      g.tint[v * 3] = col[0]; g.tint[v * 3 + 1] = col[1]; g.tint[v * 3 + 2] = col[2];
      g.matAo[v * 2 + 1] = 0.72;
    }
    g.mask = { head: 1.0 };
    parts.push(g);
  }

  // ======================================================== head + face ====
  // `pushFlat` skips the body's dust/shade tint field — a face feature's colour
  // is authored, not weathered — and takes an explicit AO floor.
  const pushFlat = (g, mat, mask, ao = 0.92) => {
    tagPart(g, mat, null);
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = ao;
    g.mask = mask;
    parts.push(g);
    return g;
  };
  const bake = (g, opts) => {
    if (!aoSample) return g;
    const ao = bakeAO(aoSample, g.positions, g.normals, opts);
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = ao[v];
    return g;
  };

  // ---- skull ----
  {
    const NU = 36;
    const ys = [];
    for (let i = 0; i < HEAD_PROF.length - 1; i++) {
      ys.push(HEAD_PROF[i][0]);
      ys.push((HEAD_PROF[i][0] + HEAD_PROF[i + 1][0]) * 0.5);
    }
    ys.push(HEAD_PROF[HEAD_PROF.length - 1][0]);
    const sections = ys.map((y) => {
      const sec = [];
      for (let u = 0; u < NU; u++) sec.push(headBase(y, -Math.PI + (u / NU) * Math.PI * 2));
      return sec;
    });
    const g = orient(loft(sections, { closedU: true }));
    pushFlat(g, MAT.SKIN, { head: 1.0 });
    // warmth into the ears, the nose and the lower lip; cool into the temples
    paint(g, (x, y) => {
      const warm = smoothstep(0.055, 0.078, Math.abs(x)) * 0.14
        + smoothstep(1.610, 1.560, y) * 0.10;
      return [1 + warm * 1.10, 1 - warm * 0.18, 1 - warm * 0.34];
    });
    bake(g, { radii: [0.012, 0.034, 0.080], strength: 0.85 });
  }

  // ---- neck (a separate tube, so the jaw can keep a hard underside) ----
  {
    const NECK = [
      [1.3920, 0.0500, 0.0465, -0.0140], [1.4400, 0.0490, 0.0450, -0.0120],
      [1.4900, 0.0475, 0.0440, -0.0080], [1.5300, 0.0455, 0.0430, -0.0020],
      [1.5600, 0.0430, 0.0420, 0.0040], [1.5850, 0.0390, 0.0400, 0.0090],
    ];
    const NU = 20;
    const sections = NECK.map(([y, rx, rz, cz]) => {
      const sec = [];
      for (let u = 0; u < NU; u++) {
        const a = (u / NU) * Math.PI * 2;
        sec.push([rx * Math.sin(a), y, cz + rz * Math.cos(a)]);
      }
      return sec;
    });
    const g = orient(loft(sections, { closedU: true }));
    pushFlat(g, MAT.SKIN, (x, y) => {
      const t = clamp01((y - 1.400) / 0.150);
      return { neck: 1.0, chest: 0.45 * (1 - t), head: 0.55 * t };
    });
    bake(g, { radii: [0.012, 0.034, 0.080], strength: 1.0 });
  }

  // ---- ears ----
  for (const s of [1, -1]) {
    const g = faceDome(ellipseOutline(s * 0.1055, 0.004, 0.0062, 0.0170, 16), [s * 0.1055, 0.004],
      [[1.0, 0.0010], [0.74, 0.0056], [0.38, 0.0074], [0.10, 0.0058]]);
    pushFlat(g, MAT.SKIN, { head: 1.0 }, 0.80);
    paint(g, () => [1.16, 0.90, 0.86]);
  }

  // ---- nose: a wedge, three points per section. Anime noses are a plane and
  // two side planes, and anything more turns to mush at portrait distance. ----
  {
    const NOSE = [
      [0.0060, 0.0032, 0.0009], [-0.0040, 0.0042, 0.0028], [-0.0130, 0.0055, 0.0052],
      [-0.0200, 0.0072, 0.0068], [-0.0245, 0.0086, 0.0050], [-0.0290, 0.0078, 0.0014],
    ];
    const g = orient(loft(NOSE.map(([v, hw, ao]) => [
      faceP(-hw, v, 0.0010), faceP(0, v, ao), faceP(hw, v, 0.0010),
    ]), { closedU: true }));
    pushFlat(g, MAT.SKIN, { head: 1.0 }, 0.90);
    paint(g, () => [1.10, 0.96, 0.94]);
  }

  // ---- mouth ----
  {
    const N = 20, MW = 0.0158;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const q = i / N;
      const a = lerp(-MW, MW, q);
      const r = a / MW;
      const base = -0.0600 + 0.0028 * r * r;
      const th = 0.0023 * Math.pow(Math.max(0, 1 - r * r), 0.35);
      samples.push({ u: a, b0: base - th * 0.55, b1: base + th * 0.45, o0: 0.0008, o1: 0.0027 });
    }
    const g = faceRibbon(samples);
    pushFlat(g, MAT.SKIN, { head: 1.0 }, 0.62);
    paint(g, () => [0.30, 0.155, 0.145]);
    // lower lip catch-light
    const lip = faceDome(ellipseOutline(0, -0.0668, 0.0128, 0.0034, 16), [0, -0.0668],
      [[1.0, 0.0005], [0.60, 0.0018], [0.10, 0.0022]]);
    pushFlat(lip, MAT.SKIN, { head: 1.0 }, 0.94);
    paint(lip, () => [1.30, 0.94, 0.90]);
  }

  // ---- eyes ----
  for (const s of [1, -1]) {
    const outline = eyeOutline(s, 26);
    // sclera
    const sc = faceDome(outline, [s * EYE_U, 0],
      [[1.0, 0.0009], [0.86, 0.0034], [0.62, 0.0048], [0.30, 0.0056], [0.06, 0.0058]]);
    pushFlat(sc, MAT.EYE, { head: 1.0 }, 1.0);
    paint(sc, (x, y) => {
      // the upper lid casts onto the eyeball — the thing that stops an anime eye
      // reading as a sticker
      const sh = smoothstep(0.0030, 0.0125, y - Y_EYE);
      return [lerp(1.10, 0.56, sh), lerp(1.08, 0.58, sh), lerp(1.06, 0.64, sh)];
    });
    // iris
    const IR = 0.0104, IC = [s * EYE_U, -0.0012];
    const ir = faceDome(ellipseOutline(IC[0], IC[1], IR, IR, 22), IC,
      [[1.0, 0.0050], [0.92, 0.0059], [0.72, 0.0065], [0.44, 0.0068], [0.16, 0.0069], [0.05, 0.0069]]);
    pushFlat(ir, MAT.EYE, { head: 1.0 }, 1.0);
    {
      const RC = [[0.05, 0.09, 0.15], [0.11, 0.30, 0.52], [0.20, 0.52, 0.80],
        [0.05, 0.08, 0.13], [0.018, 0.022, 0.030], [0.014, 0.017, 0.024]];
      const np = 22;
      for (let v = 0; v < ir.count; v++) {
        const r = Math.min(RC.length - 1, Math.floor(v / np));
        // vertical gradient: dark at the top of the iris, luminous at the bottom
        const grad = r < 3 ? lerp(1.32, 0.52, smoothstep(-0.009, 0.008, ir.positions[v * 3 + 1] - Y_EYE)) : 1;
        ir.tint[v * 3] = RC[r][0] * grad;
        ir.tint[v * 3 + 1] = RC[r][1] * grad;
        ir.tint[v * 3 + 2] = RC[r][2] * grad;
      }
    }
    // specular dots
    const h1 = faceDome(ellipseOutline(s * (EYE_U - 0.0040), 0.0044, 0.0035, 0.0035, 12),
      [s * (EYE_U - 0.0040), 0.0044], [[1.0, 0.0071], [0.5, 0.0076], [0.08, 0.0077]]);
    pushFlat(h1, MAT.EYE, { head: 1.0 }, 1.0);
    paint(h1, () => [2.05, 2.10, 2.15]);
    const h2 = faceDome(ellipseOutline(s * (EYE_U + 0.0052), -0.0062, 0.0018, 0.0018, 10),
      [s * (EYE_U + 0.0052), -0.0062], [[1.0, 0.0068], [0.5, 0.0071], [0.08, 0.0072]]);
    pushFlat(h2, MAT.EYE, { head: 1.0 }, 1.0);
    paint(h2, () => [1.25, 1.32, 1.40]);
    // upper lash line — thickens and flicks up toward the temple
    {
      const N = 22, samples = [];
      for (let i = 0; i <= N; i++) {
        const q = i / N;
        const a = lerp(-EYE_W - 0.0012, EYE_W + 0.0054, q);
        const ac = clamp(a, -EYE_W, EYE_W);
        const base = EYE_HU * Math.pow(Math.max(0, 1 - (ac / EYE_W) ** 2), 0.42) + EYE_TILT * a;
        const th = (0.0017 + 0.0031 * q) * Math.pow(Math.sin(Math.PI * q), 0.5);
        samples.push({ u: s * (EYE_U + a), b0: base - 0.0005, b1: base + th, o0: 0.0016, o1: 0.0047 });
      }
      const g = faceRibbon(samples);
      pushFlat(g, MAT.HAIR, { head: 1.0 }, 0.70);
      paint(g, () => [0.70, 0.70, 0.78]);
    }
    // lower lid line
    {
      const N = 14, samples = [];
      for (let i = 0; i <= N; i++) {
        const q = i / N;
        const a = lerp(-EYE_W * 0.52, EYE_W * 0.98, q);
        const base = -EYE_HL * Math.pow(Math.max(0, 1 - (a / EYE_W) ** 2), 0.55) + EYE_TILT * a;
        const th = (0.0008 + 0.0012 * q) * Math.pow(Math.sin(Math.PI * q), 0.5);
        samples.push({ u: s * (EYE_U + a), b0: base - th, b1: base + 0.0004, o0: 0.0012, o1: 0.0031 });
      }
      const g = faceRibbon(samples);
      pushFlat(g, MAT.SKIN, { head: 1.0 }, 0.66);
      paint(g, () => [0.42, 0.26, 0.24]);
    }
    // brow — thick at the nose, tapering to a point at the temple, angled down
    // toward the centreline for a level, determined read
    {
      const N = 16, samples = [];
      for (let i = 0; i <= N; i++) {
        const q = i / N;
        const a = lerp(-0.0205, 0.0212, q);
        const base = 0.0196 + 0.0082 * Math.sin(Math.PI * q) + 0.0030 * q;
        const th = (0.0054 - 0.0034 * q) * Math.pow(Math.sin(Math.PI * q), 0.18);
        samples.push({ u: s * (EYE_U + a), b0: base - th * 0.5, b1: base + th * 0.5, o0: 0.0012, o1: 0.0043 });
      }
      const g = faceRibbon(samples);
      pushFlat(g, MAT.HAIR, { head: 1.0 }, 0.82);
    }
  }

  // ============================================================== hair ====
  {
    const NS = HAIR_OUT.length, NU = 44;
    const sections = [];
    for (let s = 0; s < NS; s++) {
      const t = s / (NS - 1);
      const e = Math.pow(t, 0.72);
      const sec = [];
      for (let u = 0; u < NU; u++) {
        const th = -Math.PI + (u / NU) * Math.PI * 2;
        const y = lerp(hairRimY(th), Y_TOP - 0.0006, e);
        const lump = 1 + 0.16 * Math.sin(th * 7.0 + t * 2.2) + 0.10 * Math.sin(th * 3.0 - 1.1);
        sec.push(headPt(y, th, HAIR_OUT[s] * lump));
      }
      sections.push(sec);
    }
    const g = orient(loft(sections, { closedU: true }));
    pushFlat(g, MAT.HAIR, { head: 1.0 }, 0.90);
    bake(g, { radii: [0.014, 0.038, 0.085], strength: 0.85 });
    for (const [a, c, b, w] of HAIR_SPIKES) {
      const sp = spike(a, c, b, w);
      pushFlat(sp, MAT.HAIR, { head: 1.0 }, 0.90);
      bake(sp, { radii: [0.014, 0.038, 0.085], strength: 0.60 });
    }
  }

  // ============================================================= sword ====
  // Sheathed on the off-side hip, angled back and clear of the coat flare so it
  // is a silhouette element rather than a detail. buildSwordGeometry() below
  // returns the same weapon drawn, at the origin, for the combat rig.
  {
    const S0 = [-0.168, 1.082, -0.022];
    const S1 = [-0.222, 0.570, -0.196];
    const ax = norm3([S1[0] - S0[0], S1[1] - S0[1], S1[2] - S0[2]]);
    const e2 = [1, 0, 0];                       // scabbard thickness axis
    const e1 = norm3(cross3(ax, e2));           // width axis, in the flat plane
    const mask = { hips: 1.0, spine: 0.35, thighR: 0.22 };
    const at = (t, w, h, ang) => {
      const p = [S0[0] + (S1[0] - S0[0]) * t, S0[1] + (S1[1] - S0[1]) * t, S0[2] + (S1[2] - S0[2]) * t];
      const c = Math.cos(ang), sn = Math.sin(ang);
      const cw = (c >= 0 ? 1 : -1) * Math.pow(Math.abs(c), 0.78) * w;
      return [p[0] + e1[0] * cw + e2[0] * h * sn, p[1] + e1[1] * cw + e2[1] * h * sn, p[2] + e1[2] * cw + e2[2] * h * sn];
    };
    const tube = (t0, t1, ws, hs, n = 5) => {
      const secs = [];
      for (let i = 0; i < n; i++) {
        const t = lerp(t0, t1, i / (n - 1));
        const q = (t - t0) / Math.max(1e-6, t1 - t0);
        const sec = [];
        for (let u = 0; u < 12; u++) {
          sec.push(at(t, lerp(ws[0], ws[1], q), lerp(hs[0], hs[1], q), (u / 12) * Math.PI * 2));
        }
        secs.push(sec);
      }
      return orient(loft(secs, { closedU: true }));
    };
    pushFlat(tube(0.00, 0.965, [0.0300, 0.0180], [0.0140, 0.0082], 8), MAT.LEATHER, mask, 0.80);
    pushFlat(tube(0.965, 1.0, [0.0180, 0.0030], [0.0082, 0.0016], 3), MAT.METAL, mask, 0.86);
    pushFlat(tube(0.005, 0.055, [0.0322, 0.0318], [0.0158, 0.0154], 3), MAT.METAL, mask, 0.86);
    pushFlat(tube(0.455, 0.505, [0.0262, 0.0258], [0.0125, 0.0122], 3), MAT.METAL, mask, 0.86);
    // guard, grip, pommel
    const up = [-ax[0], -ax[1], -ax[2]];
    const G = [S0[0] + up[0] * 0.014, S0[1] + up[1] * 0.014, S0[2] + up[2] * 0.014];
    {
      const secs = [];
      for (const [d, w, h] of [[-0.064, 0.0060, 0.0090], [-0.030, 0.0105, 0.0150],
        [0.014, 0.0105, 0.0150], [0.052, 0.0060, 0.0090]]) {
        const c = [G[0] + e1[0] * d, G[1] + e1[1] * d, G[2] + e1[2] * d];
        const sec = [];
        for (let u = 0; u < 8; u++) {
          const a = (u / 8) * Math.PI * 2;
          sec.push([c[0] + up[0] * w * Math.cos(a) + e2[0] * h * Math.sin(a),
            c[1] + up[1] * w * Math.cos(a) + e2[1] * h * Math.sin(a),
            c[2] + up[2] * w * Math.cos(a) + e2[2] * h * Math.sin(a)]);
        }
        secs.push(sec);
      }
      pushFlat(faceted(orient(loft(secs, { closedU: true }))), MAT.METAL, mask, 0.84);
    }
    {
      const secs = [];
      for (const [d, r] of [[0.020, 0.0142], [0.060, 0.0132], [0.100, 0.0130], [0.126, 0.0140]]) {
        const c = [G[0] + up[0] * d, G[1] + up[1] * d, G[2] + up[2] * d];
        const sec = [];
        for (let u = 0; u < 10; u++) {
          const a = (u / 10) * Math.PI * 2;
          sec.push([c[0] + e1[0] * r * Math.cos(a) + e2[0] * r * 0.80 * Math.sin(a),
            c[1] + e1[1] * r * Math.cos(a) + e2[1] * r * 0.80 * Math.sin(a),
            c[2] + e1[2] * r * Math.cos(a) + e2[2] * r * 0.80 * Math.sin(a)]);
        }
        secs.push(sec);
      }
      pushFlat(orient(loft(secs, { closedU: true })), MAT.LEATHER, mask, 0.80);
      const pm = new THREE.SphereGeometry(0.0215, 6, 4);
      const m = new THREE.Matrix4().makeScale(1, 0.82, 1).premultiply(new THREE.Matrix4()
        .makeTranslation(G[0] + up[0] * 0.146, G[1] + up[1] * 0.146, G[2] + up[2] * 0.146));
      pushFlat(faceted(fromThree(pm, m)), MAT.METAL, mask, 0.86);
    }
  }

  // ============================================================= flute ====
  // Act 0's mechanic, so it is worn where it is legible: laid on the chest
  // across the harness diagonal, riding the torso surface.
  {
    const N = 26, NU = 8, R = 0.0106;
    const pathP = [], pathE1 = [], pathE2 = [];
    for (let i = 0; i < N; i++) {
      const q = i / (N - 1);
      const th = lerp(-0.42 * Math.PI, -0.10 * Math.PI, q);
      const y = lerp(1.152, 1.362, q);
      const [rx, rz] = torsoR(y);
      pathP.push([(rx + 0.013) * Math.sin(th), y, (rz + 0.017) * Math.cos(th)]);
    }
    for (let i = 0; i < N; i++) {
      const a = pathP[Math.max(0, i - 1)], b = pathP[Math.min(N - 1, i + 1)];
      const t = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const outw = norm3([pathP[i][0], 0, pathP[i][2]]);
      pathE1.push(outw);
      pathE2.push(norm3(cross3(outw, t)));
    }
    const holes = [0.28, 0.37, 0.46, 0.60, 0.69, 0.78];
    const secs = [], dark = [];
    for (let i = 0; i < N; i++) {
      const q = i / (N - 1);
      const isHole = holes.some((h) => Math.abs(q - h) < 0.018);
      const r = R * (1 - 0.10 * q);
      const sec = [];
      for (let u = 0; u < NU; u++) {
        const a = (u / NU) * Math.PI * 2;
        sec.push([pathP[i][0] + pathE1[i][0] * r * Math.cos(a) + pathE2[i][0] * r * Math.sin(a),
          pathP[i][1] + pathE1[i][1] * r * Math.cos(a) + pathE2[i][1] * r * Math.sin(a),
          pathP[i][2] + pathE1[i][2] * r * Math.cos(a) + pathE2[i][2] * r * Math.sin(a)]);
        dark.push(isHole && Math.cos((u / NU) * Math.PI * 2) > 0.55);
      }
      secs.push(sec);
    }
    const g = orient(loft(secs, { closedU: true }));
    const fmask = { chest: 1.0, spine: 0.45 };
    pushFlat(g, MAT.SASH, fmask, 0.86);
    paint(g, (x, y, z, v) => (dark[v] ? [0.10, 0.075, 0.055] : [0.92, 0.78, 0.58]));
    for (const [t0, t1] of [[0.02, 0.10], [0.90, 0.98]]) {
      const fs = [];
      for (const q of [t0, t1]) {
        const i = Math.round(q * (N - 1));
        const sec = [];
        for (let u = 0; u < NU; u++) {
          const a = (u / NU) * Math.PI * 2, r = R * 1.16;
          sec.push([pathP[i][0] + pathE1[i][0] * r * Math.cos(a) + pathE2[i][0] * r * Math.sin(a),
            pathP[i][1] + pathE1[i][1] * r * Math.cos(a) + pathE2[i][1] * r * Math.sin(a),
            pathP[i][2] + pathE1[i][2] * r * Math.cos(a) + pathE2[i][2] * r * Math.sin(a)]);
        }
        fs.push(sec);
      }
      pushFlat(orient(loft(fs, { closedU: true })), MAT.METAL, fmask, 0.86);
    }
  }

  return parts;
}

/**
 * The same sword, drawn, at the origin: grip centred on 0 and the blade running
 * up +Y, so the combat rig can parent it straight to a hand bone. Returns raw
 * parts in this file's format; use mergeParts() to get a BufferGeometry.
 */
export function buildSwordParts() {
  const parts = [];
  const add = (g, mat, tint) => {
    tagPart(g, mat, tint ? () => tint : null);
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = 0.88;
    g.mask = null;
    parts.push(g);
  };
  // blade: a lens cross-section that tapers to a point, with a shallow fuller
  const BL = [[0.000, 0.0245, 0.0056], [0.060, 0.0242, 0.0055], [0.400, 0.0228, 0.0046],
    [0.640, 0.0196, 0.0037], [0.780, 0.0148, 0.0029], [0.845, 0.0072, 0.0019],
    [0.870, 0.0012, 0.0006]];
  const secs = BL.map(([y, w, h]) => {
    const sec = [];
    for (let u = 0; u < 10; u++) {
      const a = (u / 10) * Math.PI * 2, c = Math.cos(a);
      sec.push([(c >= 0 ? 1 : -1) * Math.pow(Math.abs(c), 0.62) * w, 0.052 + y, h * Math.sin(a)]);
    }
    return sec;
  });
  add(orient(loft(secs, { closedU: true })), MAT.METAL, [1.12, 1.14, 1.18]);
  const guard = new THREE.BoxGeometry(0.148, 0.019, 0.030);
  add(faceted(fromThree(guard, new THREE.Matrix4().makeTranslation(0, 0.044, 0))), MAT.METAL, [0.94, 0.86, 0.62]);
  const grip = new THREE.CylinderGeometry(0.0128, 0.0142, 0.108, 10, 1);
  add(fromThree(grip, new THREE.Matrix4().makeTranslation(0, -0.020, 0)), MAT.LEATHER, [1, 1, 1]);
  const pom = new THREE.SphereGeometry(0.0215, 6, 4);
  add(faceted(fromThree(pom, new THREE.Matrix4().makeScale(1, 0.82, 1)
    .premultiply(new THREE.Matrix4().makeTranslation(0, -0.084, 0)))), MAT.METAL, [0.94, 0.86, 0.62]);
  return parts;
}

// ------------------------------------------------------------- assemble ----
export function buildCharacterGeometry() {
  const t0 = performance.now();
  const field = buildField();
  field.build();
  const aoSample = field.sampler(null, true);

  // Only the body is polygonized now. The head, the face, the hair, the sword
  // and the flute are all exact lofted geometry — see buildPieces().
  const body = meshPart(field, ['body'], [-0.33, -0.012, -0.21], [0.33, 1.50, 0.25], 0.0146,
    aoSample, { smooth: 2, project: 3, ao: { strength: 1.0 } });

  const sdfParts = [body].filter(Boolean);
  const pieces = buildPieces(field, aoSample);
  const t1 = performance.now();
  return { field, sdfParts, pieces, ms: t1 - t0 };
}
