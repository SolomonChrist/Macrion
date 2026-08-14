/**
 * Macrion — character skeleton, skinning and animation.
 *
 * BIND POSE IS NOT A T-POSE. The whole mesh is authored in a relaxed standing
 * pose with the arms already down and the elbows already carrying a few
 * degrees of bend. That single decision removes most of the deformation risk:
 * every animated joint rotation is small (idle is under 6 degrees anywhere),
 * so linear-blend skinning never has to fight the candy-wrapper failure that
 * shows up when you rotate a shoulder 90 degrees off bind.
 *
 * Every bone rests with an identity quaternion, so a bone's local axes are the
 * world axes at bind time. `rotation.x` on a thigh is pitch, `.z` is splay,
 * `.y` is twist — everywhere, on every bone. That is what makes the animation
 * table below readable instead of a pile of quaternion products.
 *
 * Weights are painted programmatically from distance to bone *segments* with a
 * high inverse power, top four, normalized. Primitives may declare a bone mask
 * (`bones: { hips: 1, thighL: 0.35 }`) to override that where anatomy and
 * distance disagree — the coat skirt is the obvious case: it hangs off the
 * hips even though its cloth is nearest the thighs.
 */
import * as THREE from 'three';
import { clamp, clamp01, lerp } from './geom.js';

/** [name, parent, worldRestPosition] — authored in the relaxed standing pose. */
export const BONE_DEF = [
  ['root', null, [0, 0.0, 0]],
  ['hips', 'root', [0, 0.985, 0.002]],
  ['spine', 'hips', [0, 1.105, 0.006]],
  ['chest', 'spine', [0, 1.258, 0.008]],
  ['neck', 'chest', [0, 1.452, -0.004]],
  ['head', 'neck', [0, 1.548, 0.004]],
  ['headEnd', 'head', [0, 1.760, 0.010]],

  ['shoulderL', 'chest', [0.046, 1.424, 0.002]],
  ['armL', 'shoulderL', [0.174, 1.412, 0.000]],
  ['foreL', 'armL', [0.212, 1.160, 0.020]],
  ['handL', 'foreL', [0.234, 0.900, 0.112]],
  ['handEndL', 'handL', [0.241, 0.786, 0.150]],

  ['shoulderR', 'chest', [-0.046, 1.424, 0.002]],
  ['armR', 'shoulderR', [-0.174, 1.412, 0.000]],
  ['foreR', 'armR', [-0.212, 1.160, 0.020]],
  ['handR', 'foreR', [-0.234, 0.900, 0.112]],
  ['handEndR', 'handR', [-0.241, 0.786, 0.150]],

  ['thighL', 'hips', [0.094, 0.945, 0.004]],
  ['shinL', 'thighL', [0.100, 0.522, 0.022]],
  ['footL', 'shinL', [0.104, 0.108, -0.014]],
  ['toeL', 'footL', [0.104, 0.038, 0.108]],
  ['toeEndL', 'toeL', [0.104, 0.028, 0.180]],

  ['thighR', 'hips', [-0.094, 0.945, 0.004]],
  ['shinR', 'thighR', [-0.100, 0.522, 0.022]],
  ['footR', 'shinR', [-0.104, 0.108, -0.014]],
  ['toeR', 'footR', [-0.104, 0.038, 0.108]],
  ['toeEndR', 'toeR', [-0.104, 0.028, 0.180]],

  // cloth chain: drives the mantle and the sash so they lag the body
  ['mantleA', 'chest', [0.010, 1.330, -0.115]],
  ['mantleB', 'mantleA', [0.020, 1.040, -0.150]],
  ['mantleC', 'mantleB', [0.030, 0.760, -0.150]],
];

/** Bones excluded from automatic weighting (tips / helpers). */
const NO_WEIGHT = new Set(['root', 'headEnd', 'handEndL', 'handEndR', 'toeEndL', 'toeEndR']);

export function buildSkeleton() {
  const bones = [];
  const byName = new Map();
  for (const [name, parent, wp] of BONE_DEF) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? byName.get(parent).__world : [0, 0, 0];
    b.position.set(wp[0] - pp[0], wp[1] - pp[1], wp[2] - pp[2]);
    b.__world = wp;
    b.__parentName = parent;
    if (parent) byName.get(parent).add(b);
    byName.set(name, b);
    bones.push(b);
  }
  // segment endpoints for weighting: bone -> mean of children, or a stub
  for (const b of bones) {
    const kids = BONE_DEF.filter((d) => d[1] === b.name);
    if (kids.length) {
      const e = [0, 0, 0];
      for (const k of kids) for (let i = 0; i < 3; i++) e[i] += k[2][i] / kids.length;
      b.__end = e;
    } else {
      b.__end = [b.__world[0], b.__world[1] - 0.04, b.__world[2]];
    }
  }
  return { bones, byName, root: bones[0] };
}

function distToSegment(x, y, z, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = x - a[0], apy = y - a[1], apz = z - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = clamp01(t);
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Paint skin weights for one part.
 * `maskFor(v)` may return a { boneName: scale } object restricting the search.
 */
export function paintWeights(bones, positions, count, maskFor) {
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const usable = bones.map((b, i) => ({ b, i })).filter((o) => !NO_WEIGHT.has(o.b.name));
  const cand = [];
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const mask = maskFor ? maskFor(v, x, y, z) : null;
    cand.length = 0;
    for (const o of usable) {
      let scale = 1;
      if (mask) {
        if (!(o.b.name in mask)) continue;
        scale = mask[o.b.name];
        if (scale <= 0) continue;
      }
      const d = distToSegment(x, y, z, o.b.__world, o.b.__end);
      // inverse power falloff: tight enough that a joint blends over ~4 cm
      const w = scale / Math.pow(d + 0.018, 5.5);
      cand.push([w, o.i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    let sum = 0;
    const n = Math.min(4, cand.length);
    for (let i = 0; i < n; i++) sum += cand[i][0];
    if (sum <= 0) { skinIndex[v * 4] = 1; skinWeight[v * 4] = 1; continue; }
    for (let i = 0; i < n; i++) {
      skinIndex[v * 4 + i] = cand[i][1];
      skinWeight[v * 4 + i] = cand[i][0] / sum;
    }
  }
  return { skinIndex, skinWeight };
}

// -------------------------------------------------------------- animation --
/**
 * Pose evaluation. Every function here is a pure function of `t` seconds —
 * no accumulators, no performance.now(), no random. The capture harness pins
 * the clock at 120.0 and expects bit-identical frames.
 *
 * Idle is layered on purpose:
 *   - a 0.24 Hz breathing wave (chest, shoulders, a little in the head)
 *   - a 0.085 Hz weight shift between the feet, which tilts and yaws the hips
 *     and counter-rotates the spine so the shoulders stay roughly level
 *   - phase-lagged limb follow-through: arms sample the driver 0.16 s in the
 *     past, forearms 0.30 s, cloth 0.38-0.62 s. That lag is what stops the
 *     whole body reading as one rigid object being wobbled.
 *   - two slow incommensurate head drifts so the gaze never visibly loops
 */
const D = Math.PI / 180;

function breath(t) { return Math.sin(t * 2 * Math.PI * 0.24); }
function breath2(t) { return Math.sin(t * 2 * Math.PI * 0.24 - 0.9); }
function shift(t) { return Math.sin(t * 2 * Math.PI * 0.085); }
function shift2(t) { return Math.sin(t * 2 * Math.PI * 0.085 - 1.1); }
function drift(t) { return 0.62 * Math.sin(t * 2 * Math.PI * 0.071 + 0.7) + 0.38 * Math.sin(t * 2 * Math.PI * 0.113 + 2.1); }
function micro(t) { return 0.5 * Math.sin(t * 2 * Math.PI * 0.53 + 1.3) + 0.5 * Math.sin(t * 2 * Math.PI * 0.37); }

/**
 * The standing base pose: contrapposto. Weight on the +X leg, that hip high,
 * the far knee soft, shoulders counter-tilted. Applied on top of bind, then
 * animated around.
 */
function idlePose(P, t, wind) {
  const b = breath(t), b2 = breath2(t);
  const s = shift(t), s2 = shift2(t);
  const dr = drift(t), mi = micro(t);

  P.hips = {
    px: 0.014 + 0.011 * s,
    py: -0.012 - 0.006 * b - 0.004 * Math.abs(s),
    pz: 0.002,
    rx: 1.4 * D + 0.5 * D * b,
    ry: (-2.0 + 1.5 * s) * D,
    rz: (-2.6 - 1.6 * s) * D,
  };
  P.spine = { rx: (-0.6 + 0.55 * b) * D, ry: (1.1 - 0.9 * s2) * D, rz: (1.5 + 1.0 * s2) * D };
  P.chest = { rx: (-0.4 + 1.5 * b) * D, ry: (0.9 - 0.7 * s2) * D, rz: (1.0 + 0.8 * s2) * D };
  P.neck = { rx: (1.2 - 0.9 * b2) * D, ry: (1.6 * dr) * D, rz: (-0.5 - 0.4 * s2) * D };
  P.head = {
    rx: (-1.4 - 0.6 * b2 + 0.7 * mi) * D,
    ry: (5.0 * dr + 0.8 * mi) * D,
    rz: (-1.2 - 0.5 * s2) * D,
  };

  // arms lag the torso
  const la = shift(t - 0.16), lb = breath(t - 0.16);
  const lf = shift(t - 0.30), lf2 = breath(t - 0.30);
  P.shoulderL = { rx: (0.6 * lb) * D, rz: (-1.6 - 1.0 * la) * D };
  P.shoulderR = { rx: (0.6 * lb) * D, rz: (1.4 + 1.0 * la) * D };
  P.armL = { rx: (-2.2 + 1.5 * lb) * D, ry: (1.2 * la) * D, rz: (-2.4 - 1.8 * la) * D };
  P.armR = { rx: (-1.4 + 1.5 * lb) * D, ry: (-1.2 * la) * D, rz: (2.8 + 1.8 * la) * D };
  P.foreL = { rx: (-4.0 + 1.3 * lf2) * D, ry: (1.6 * lf) * D };
  P.foreR = { rx: (-5.5 + 1.3 * lf2) * D, ry: (-1.6 * lf) * D };
  P.handL = { rx: (-3.0 + 1.0 * lf2) * D, rz: (-2.0) * D };
  P.handR = { rx: (-3.0 + 1.0 * lf2) * D, rz: (2.0) * D };

  // contrapposto legs: +X leg is the support leg
  P.thighL = { rx: (-0.8 - 0.6 * s) * D, rz: (-1.0) * D };
  P.shinL = { rx: (1.2 + 0.5 * s) * D };
  P.footL = { rx: (-0.4) * D };
  P.thighR = { rx: (2.4 + 1.2 * s) * D, ry: (-4.0) * D, rz: (2.2) * D };
  P.shinR = { rx: (-6.5 - 1.5 * s) * D };
  P.footR = { rx: (3.5) * D, ry: (-3.0) * D };

  // cloth chain, heavily lagged, and pushed by wind
  const w = 0.5 + wind * 1.6;
  P.mantleA = { rx: (1.6 * shift(t - 0.38) + 1.0 * breath(t - 0.38)) * w * D, rz: (0.9 * shift2(t - 0.38)) * w * D };
  P.mantleB = { rx: (2.6 * shift(t - 0.62) + 1.2 * breath(t - 0.62)) * w * D, rz: (1.6 * shift2(t - 0.62)) * w * D };
  P.mantleC = { rx: (3.4 * shift(t - 0.86)) * w * D, rz: (2.2 * shift2(t - 0.86)) * w * D };
}

/** Locomotion cycles. Rough but structurally correct — Interaction drives them. */
function gaitPose(P, t, run, wind, speed) {
  // Cadence must come from ground speed, or the feet slide. Stride length grows
  // with speed (people lengthen their step before they quicken it), so
  // frequency = speed / stride rather than a constant. Falls back to the old
  // fixed cadence when no speed is supplied.
  const stride = run ? 1.40 + 0.35 * speed : 0.85 + 0.28 * speed;
  const f = speed > 0.05
    ? Math.min(Math.max(speed / stride, 0.35), 3.0)
    : (run ? 1.62 : 0.92);                          // cycles / second
  const ph = t * f * Math.PI * 2;
  const A = run ? 1.0 : 0.55;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  const lean = run ? 11 : 3.5;
  const bob = run ? 0.055 : 0.022;

  P.hips = {
    px: 0.012 * Math.sin(ph),
    py: -bob * (0.5 - 0.5 * Math.cos(ph * 2)),
    pz: 0,
    rx: lean * 0.35 * D,
    ry: (run ? -7 : -4) * sw * D,
    rz: (run ? 5 : 3) * cw * D,
  };
  P.spine = { rx: lean * 0.3 * D, ry: (run ? 4 : 2.4) * sw * D, rz: 0 };
  P.chest = { rx: lean * 0.35 * D, ry: (run ? 6 : 3.4) * -sw * D, rz: 0 };
  P.neck = { rx: -lean * 0.35 * D };
  P.head = { rx: -lean * 0.4 * D + 1.5 * Math.cos(ph * 2) * D, ry: 1.5 * sw * D };

  const swing = (run ? 42 : 22) * A / 0.55 * 0.55;
  P.armL = { rx: (-swing * sw - (run ? 10 : 2)) * D, rz: (-4 - (run ? 6 : 0)) * D };
  P.armR = { rx: (swing * sw - (run ? 10 : 2)) * D, rz: (4 + (run ? 6 : 0)) * D };
  P.foreL = { rx: (-(run ? 62 : 16) - (run ? 16 : 8) * (0.5 + 0.5 * sw)) * D };
  P.foreR = { rx: (-(run ? 62 : 16) - (run ? 16 : 8) * (0.5 - 0.5 * sw)) * D };
  P.handL = { rx: -6 * D }; P.handR = { rx: -6 * D };
  P.shoulderL = { rz: -2 * D }; P.shoulderR = { rz: 2 * D };

  const thigh = run ? 38 : 24, knee = run ? 74 : 42;
  const legL = ph, legR = ph + Math.PI;
  const flex = (p) => Math.max(0, -Math.sin(p - 0.6));
  P.thighL = { rx: (thigh * Math.sin(legL) - (run ? 6 : 0)) * D, rz: -1 * D };
  P.thighR = { rx: (thigh * Math.sin(legR) - (run ? 6 : 0)) * D, rz: 1 * D };
  P.shinL = { rx: (-knee * flex(legL) - 4) * D };
  P.shinR = { rx: (-knee * flex(legR) - 4) * D };
  P.footL = { rx: (14 * Math.sin(legL + 2.2) + 4) * D };
  P.footR = { rx: (14 * Math.sin(legR + 2.2) + 4) * D };

  const w = 0.6 + wind * 1.4;
  const lg = (o) => Math.sin(ph - o);
  P.mantleA = { rx: (4 + 3 * lg(0.9)) * w * D, rz: 2 * lg(0.9) * w * D };
  P.mantleB = { rx: (7 + 5 * lg(1.5)) * w * D, rz: 3 * lg(1.5) * w * D };
  P.mantleC = { rx: (9 + 7 * lg(2.1)) * w * D, rz: 4 * lg(2.1) * w * D };
}

export function makeAnimator(byName) {
  const P = Object.create(null);
  const names = [...byName.keys()];
  const rest = new Map();
  for (const n of names) {
    const b = byName.get(n);
    rest.set(n, [b.position.x, b.position.y, b.position.z]);
  }
  let pose = 'idle';
  let wind = 0.35;
  let speed = 0;

  return {
    setPose(name) { if (name === 'idle' || name === 'walk' || name === 'run') pose = name; },
    getPose() { return pose; },
    setWind(w) { wind = clamp(w, 0, 1); },
    /** Ground speed in m/s. Drives gait cadence so the feet do not slide. */
    setSpeed(v) { speed = Math.max(0, v || 0); },
    getSpeed() { return speed; },
    /** Pure function of t. Writes bone local transforms. */
    apply(t) {
      for (const k in P) delete P[k];
      if (pose === 'idle') idlePose(P, t, wind);
      else gaitPose(P, t, pose === 'run', wind, speed);
      for (const n of names) {
        const b = byName.get(n);
        const p = P[n];
        const r0 = rest.get(n);
        if (!p) {
          b.rotation.set(0, 0, 0);
          b.position.set(r0[0], r0[1], r0[2]);
          continue;
        }
        b.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
        b.position.set(r0[0] + (p.px ?? 0), r0[1] + (p.py ?? 0), r0[2] + (p.pz ?? 0));
      }
    },
  };
}

export { lerp };
