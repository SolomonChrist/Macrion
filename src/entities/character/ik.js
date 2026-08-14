/**
 * Two-bone foot IK + pelvis ground adaptation.
 *
 * The gait in rig.js is open-loop: it swings the legs on sine curves with no
 * knowledge of the ground. On anything but a flat plane that means feet sink
 * into slopes and hang in the air over dips. This pass runs AFTER
 * animator.apply() and corrects the legs against the real heightfield.
 *
 * Order matters and is the usual source of bugs:
 *   1. pelvis  — drop the hips so the lower foot can actually reach its target
 *   2. legs    — two-bone IK from hip through knee to the corrected foot
 *   3. ankle   — pitch/roll the foot onto the ground normal
 *
 * Determinism: this is a pure function of (bone pose, character transform,
 * terrain). Terrain is static and the pose is a pure function of ctx.time, so a
 * capture that pins the clock still renders identically every run.
 */
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

const ANKLE_H = 0.085;      // ankle bone height above the sole
const MAX_PELVIS_DROP = 0.18;
// Ignore tiny penetrations. Correcting every millimetre makes the legs chase
// terrain noise and read as a permanent crouch, which is worse than the sink.
const DEADZONE = 0.045;
const REACH_EPS = 0.995;    // never fully straighten — a locked knee looks wrong

/** Apply a world-space delta rotation to a bone, preserving its parent chain. */
function rotateWorld(bone, deltaWorldQuat) {
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  _qw.premultiply(deltaWorldQuat);            // desired world orientation
  bone.quaternion.copy(_qp.invert().multiply(_qw));
}

/**
 * Classic law-of-cosines two-bone solve.
 * `pole` biases which way the knee points when the chain is straight.
 */
function solveTwoBone(root, mid, end, targetWorld, pole) {
  root.getWorldPosition(_a);
  mid.getWorldPosition(_b);
  end.getWorldPosition(_c);

  const L1 = _a.distanceTo(_b);
  const L2 = _b.distanceTo(_c);
  if (L1 < 1e-5 || L2 < 1e-5) return;

  _t.copy(targetWorld);
  let at = _a.distanceTo(_t);
  const maxReach = (L1 + L2) * REACH_EPS;
  if (at > maxReach) {                        // out of reach — aim, don't stretch
    _t.sub(_a).multiplyScalar(maxReach / at).add(_a);
    at = maxReach;
  }
  at = Math.max(at, Math.abs(L1 - L2) + 1e-4);

  // Bend plane normal. Prefer the current plane; fall back to the pole when the
  // limb is straight and the cross product degenerates.
  _v1.copy(_b).sub(_a);
  _v2.copy(_c).sub(_a);
  _ax.crossVectors(_v1, _v2);
  if (_ax.lengthSq() < 1e-8) _ax.crossVectors(_v1, pole);
  if (_ax.lengthSq() < 1e-8) return;
  _ax.normalize();

  const clampC = (x) => Math.min(1, Math.max(-1, x));
  const curA = Math.acos(clampC(_v1.clone().normalize().dot(_v2.clone().normalize())));
  const wantA = Math.acos(clampC((L1 * L1 + at * at - L2 * L2) / (2 * L1 * at)));

  _v1.copy(_b).sub(_a).normalize();
  _v2.copy(_c).sub(_b).normalize();
  const curB = Math.PI - Math.acos(clampC(_v1.dot(_v2)));
  const wantB = Math.acos(clampC((L1 * L1 + L2 * L2 - at * at) / (2 * L1 * L2)));

  // 1. open/close the knee
  rotateWorld(mid, _q.setFromAxisAngle(_ax, wantB - curB));
  // 2. open/close the hip within the bend plane
  rotateWorld(root, _q.setFromAxisAngle(_ax, wantA - curA));
  // 3. aim the whole limb at the target
  root.updateWorldMatrix(true, true);
  root.getWorldPosition(_a);
  end.getWorldPosition(_c);
  _v1.copy(_c).sub(_a).normalize();
  _v2.copy(_t).sub(_a).normalize();
  rotateWorld(root, _q.setFromUnitVectors(_v1, _v2));
  root.updateWorldMatrix(true, true);
}

/**
 * @param {object} o
 * @param {Map<string,THREE.Bone>} o.bones      byName map from buildSkeleton()
 * @param {THREE.Object3D}         o.group      the character root transform
 * @param {(x:number,z:number)=>number} o.heightAt terrain sampler
 * @param {number} o.weight  0..1 blend, so it can be faded out in cutscenes
 */
export function applyFootIK({ bones, group, heightAt, weight = 1 }) {
  if (!heightAt || weight <= 0) return;
  const hips = bones.get('hips');
  if (!hips) return;

  const legs = [
    { thigh: bones.get('thighL'), shin: bones.get('shinL'), foot: bones.get('footL') },
    { thigh: bones.get('thighR'), shin: bones.get('shinR'), foot: bones.get('footR') },
  ];
  if (legs.some((l) => !l.thigh || !l.shin || !l.foot)) return;

  group.updateWorldMatrix(true, true);

  // --- 1. pelvis: drop the hips so the lower foot can reach the ground -------
  let worstDrop = 0;
  const want = [];
  for (const leg of legs) {
    leg.foot.getWorldPosition(_c);
    const gy = heightAt(_c.x, _c.z) + ANKLE_H;
    want.push(gy);
    // Only ever lower the hips. Raising them to meet a high foot makes the
    // character bob upward on every step, which reads far worse than a slightly
    // sunk stance.
    const drop = _c.y - gy;
    if (drop < -DEADZONE) worstDrop = Math.min(worstDrop, drop + DEADZONE);
  }
  if (worstDrop < 0) {
    const d = Math.max(worstDrop, -MAX_PELVIS_DROP) * weight;
    hips.position.y += d;
    hips.updateWorldMatrix(true, true);
    // hips moved, so the feet did too — resample their targets
    for (let i = 0; i < legs.length; i++) {
      legs[i].foot.getWorldPosition(_c);
      want[i] = heightAt(_c.x, _c.z) + ANKLE_H;
    }
  }

  // --- 2. legs: plant each foot at or above the ground -----------------------
  const pole = _v1.set(0, 0, 1).applyQuaternion(group.getWorldQuaternion(_q)).clone();
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    leg.foot.getWorldPosition(_c);
    const gy = want[i];
    // Never push a foot DOWN — during the swing phase it is meant to be airborne.
    if (_c.y >= gy - DEADZONE) continue;
    _t.set(_c.x, _c.y + (gy - DEADZONE - _c.y) * weight, _c.z);
    solveTwoBone(leg.thigh, leg.shin, leg.foot, _t, pole);
  }

  // --- 3. ankles: pitch the foot onto the local ground slope -----------------
  const e = 0.16;
  for (const leg of legs) {
    leg.foot.getWorldPosition(_c);
    const gy = heightAt(_c.x, _c.z);
    if (_c.y - (gy + ANKLE_H) > 0.12) continue;      // airborne, leave it alone
    const hx = heightAt(_c.x + e, _c.z) - heightAt(_c.x - e, _c.z);
    const hz = heightAt(_c.x, _c.z + e) - heightAt(_c.x, _c.z - e);
    _v2.set(-hx, 2 * e, -hz).normalize();            // ground normal
    _v1.set(0, 1, 0).applyQuaternion(leg.foot.getWorldQuaternion(_qw));
    _q.setFromUnitVectors(_v1, _v2);
    // Partial blend — a foot glued perfectly flat to the terrain reads stiff.
    _q.slerp(new THREE.Quaternion(), 1 - 0.45 * weight);
    rotateWorld(leg.foot, _q);
  }
}
