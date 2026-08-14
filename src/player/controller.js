/**
 * Macrion — player controller. Owned by the Player Controller builder.
 *
 * createController(ctx) -> { name:'player', update(ctx), onMode(m,ctx), teleport(x,z) }
 *
 * Camera authority: engine.mode decides who drives the camera. This module
 * only acts while ctx.engine.mode === 'play' — update() returns immediately
 * otherwise, so it is completely invisible to the capture harness (which
 * never sends input and therefore never leaves 'shot' mode).
 *
 * Controls (bound only while the canvas has focus):
 *   P            enter / exit play mode
 *   W A S D      move relative to camera facing
 *   Shift        sprint
 *   Space        jump
 *   mouse (drag when pointer-locked) — orbit the third-person camera
 *   scroll wheel — adjust camera boom distance
 *
 * The dev fly-cam (src/core/devcam.js, lead-owned) already yields on keys by
 * checking engine.mode itself. Its one gap is that its global `mousemove`
 * listener unconditionally hijacks the camera whenever the pointer is locked,
 * with no mode check at all — that would steal the camera on the player's
 * very first mouselook. We neutralise that without touching devcam.js: our
 * own mousemove listener is registered on `document` in the CAPTURE phase,
 * which always runs before devcam's bubble-phase listener, and we call
 * stopImmediatePropagation() while (and only while) we are in 'play' mode.
 * In every other mode we get out of the way entirely.
 */
import * as THREE from 'three';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing toward `to` at rate `k` (1/s). */
const damp = (from, to, k, dt) => lerp(from, to, 1 - Math.exp(-k * dt));

// Movement tuning. Keyboard input is binary (no analog stick), so "walk" is
// reached only as a transient while accelerating/decelerating through
// POSE_WALK_MAX — default unmodified movement is a jog, shift sprints.
const RUN_SPEED = 5.6;
const SPRINT_SPEED = 8.2;
const POSE_IDLE_MAX = 0.35;  // below this: idle
const POSE_WALK_MAX = 3.2;   // below this: walk; above: run
const IDLE_HOLD_FRAMES = 8;  // frames of genuine stillness before dropping to idle   // below this: walk: above: run
const ACCEL = 22;          // m/s^2 toward target speed
const DECEL = 26;          // m/s^2 toward zero when no input
const TURN_RATE = 11;      // smoothing rate for facing yaw
const GRAVITY = 22;        // m/s^2
const JUMP_SPEED = 7.2;
const MAX_SLOPE_DEG = 42;  // steeper than this cannot be climbed
const GROUND_SNAP = 0.06;  // small step tolerance before treating as airborne

// Camera rig tuning — over-the-shoulder third person.
const CAM_DIST_DEFAULT = 4.4;
const CAM_DIST_MIN = 1.6;
const CAM_DIST_MAX = 8.0;
const CAM_HEIGHT = 1.6;       // boom pivot height above character root (roughly shoulder)
const CAM_LOOK_HEIGHT = 1.5;  // look-target height above character root
const CAM_SHOULDER = 0.42;    // lateral offset so the character sits off-center, not dead center
const CAM_PITCH_MIN = -0.62;  // radians — camera swings HIGH and tilts down (bird's-eye-ish)
const CAM_PITCH_MAX = 1.15;   // radians — camera swings LOW and tilts up (worm's-eye-ish)
const CAM_PITCH_DEFAULT = -0.12; // small default down-tilt: camera sits a touch above the pivot
const MOUSE_SENS = 0.0026;
const CAM_POS_SPRING = 14;    // spring-follow rate for camera boom position
const CAM_LOOK_SPRING = 20;   // spring-follow rate for look target
const CAM_COLLIDE_SKIN = 0.35;

// Footstep cadence is distance-based (not time-based), so it naturally speeds
// up with actual ground speed instead of drifting out of sync with it.
const FOOTSTEP_STRIDE = 0.82; // meters of horizontal travel between footfalls

export function createController(ctx) {
  const { engine, camera } = ctx;
  const dom = engine.renderer.domElement;

  // ---- input state -------------------------------------------------------
  const keys = new Set();
  let yaw = 0;      // camera orbit yaw, radians
  let pitch = CAM_PITCH_DEFAULT;
  let camDist = CAM_DIST_DEFAULT;
  let locked = false;

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'p') {
      togglePlay();
      return;
    }
    if (engine.mode !== 'play') return;
    keys.add(k);
    if (k === ' ') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  // Losing window focus mid-press must not leave a key "stuck" held.
  addEventListener('blur', () => keys.clear());

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === dom;
  });

  // Capture-phase: runs before devcam's bubble-phase mousemove listener.
  // Only intervenes while we actually own play mode.
  document.addEventListener('mousemove', (e) => {
    if (engine.mode !== 'play' || !locked) return;
    yaw -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = clamp(pitch, CAM_PITCH_MIN, CAM_PITCH_MAX);
    e.stopImmediatePropagation();
  }, true);

  // Capture-phase + stopImmediatePropagation while playing, same reasoning as
  // the mousemove listener above: devcam's own wheel handler (fly-speed) has
  // no mode check either, and we don't want its "speed N m/s" toast popping
  // up over normal play-mode camera zoom.
  dom.addEventListener('wheel', (e) => {
    if (engine.mode !== 'play') return;
    camDist = clamp(camDist * (e.deltaY < 0 ? 0.9 : 1.1), CAM_DIST_MIN, CAM_DIST_MAX);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { passive: false, capture: true });

  function togglePlay() {
    if (engine.mode === 'play') {
      exitPlay();
    } else {
      enterPlay();
    }
  }

  function enterPlay() {
    // Seed the orbit yaw from wherever the camera is currently looking so the
    // transition into play doesn't snap. Requesting pointer lock here is a
    // direct response to the 'p' keydown, which is a valid user gesture.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    yaw = Math.atan2(fwd.x, fwd.z);
    velocity.set(0, 0, 0);
    grounded = true;
    engine.setMode('play');
    dom.requestPointerLock?.();
  }

  function exitPlay() {
    if (document.pointerLockElement === dom) document.exitPointerLock?.();
    engine.setMode('free');
  }

  // ---- movement state -----------------------------------------------------
  const velocity = new THREE.Vector3(); // horizontal velocity, world space
  let vy = 0;                            // vertical velocity
  let grounded = true;
  let stillFrames = 0;
  let facing = 0;                        // character yaw, radians (smoothed)
  let facingInit = false;
  let pose = 'idle';

  // camera smoothing state
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camInit = false;

  // ctx carries no dt (only a pinned/free-running clock), so we derive our
  // own wall-clock delta the same way devcam does. This never runs unless
  // mode === 'play', so it cannot desync capture determinism.
  let lastNow = performance.now();

  const moveDir = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const desiredVel = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const rayPos = new THREE.Vector3();
  const footPos = new THREE.Vector3();

  let strideDist = 0;   // accumulated horizontal travel since last footfall
  let wasGrounded = true;

  function terrainHeight(x, z) {
    return ctx.terrain?.heightAt?.(x, z) ?? 0;
  }

  /** Sample slope (radians from horizontal) via a small central-difference probe. */
  function slopeAt(x, z, e = 0.6) {
    const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
    const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
    const gx = (hR - hL) / (2 * e), gz = (hU - hD) / (2 * e);
    return Math.atan(Math.sqrt(gx * gx + gz * gz));
  }

  function teleport(x, z) {
    const char = engine.systems?.character;
    const node = char?.root ?? char?.object3D;
    const h = terrainHeight(x, z);
    if (node) node.position.set(x, h, z);
    velocity.set(0, 0, 0);
    vy = 0;
    grounded = true;
    camInit = false;
  }

  const maxSlopeRad = (MAX_SLOPE_DEG * Math.PI) / 180;

  return {
    name: 'player',

    onMode(m) {
      if (m !== 'play') {
        // Something else (a shot, cutscene, or devcam's F key) reclaimed the
        // camera. Release pointer lock cleanly and drop held keys so nothing
        // is stuck when the player returns.
        keys.clear();
        if (document.pointerLockElement === dom) document.exitPointerLock?.();
      }
    },

    teleport,

    update(c) {
      if (c.engine.mode !== 'play') return;

      const char = c.engine.systems?.character;
      const node = char?.root ?? char?.object3D;
      if (!node) return;

      const now = performance.now();
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      if (!facingInit) { facing = node.rotation?.y ?? 0; facingInit = true; }

      // ---- camera-relative movement axes -----------------------------------
      // camFwd is "into the screen" (the direction the orbit camera looks,
      // see updateCamera). camRight = cross(camFwd, worldUp) — verified
      // against three.js's own convention (matches camera.getWorldDirection
      // + up for an unrotated camera), so D strafes to the on-screen right.
      camFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      camRight.set(-camFwd.z, 0, camFwd.x);

      moveDir.set(0, 0, 0);
      if (keys.has('w')) moveDir.add(camFwd);
      if (keys.has('s')) moveDir.sub(camFwd);
      if (keys.has('d')) moveDir.add(camRight);
      if (keys.has('a')) moveDir.sub(camRight);
      const hasInput = moveDir.lengthSq() > 1e-6;
      if (hasInput) moveDir.normalize();

      const sprinting = keys.has('shift') && hasInput;
      const targetSpeed = hasInput ? (sprinting ? SPRINT_SPEED : RUN_SPEED) : 0;
      desiredVel.copy(moveDir).multiplyScalar(targetSpeed);

      const rate = hasInput ? ACCEL : DECEL;
      velocity.x = damp(velocity.x, desiredVel.x, rate, dt);
      velocity.z = damp(velocity.z, desiredVel.z, rate, dt);
      // Snap out tiny residuals so idle is truly idle, not a slow creep.
      if (!hasInput && velocity.lengthSq() < 0.0009) velocity.set(0, 0, 0);

      // ---- horizontal integration with slope clamp ---------------------
      let stepX = velocity.x * dt;
      let stepZ = velocity.z * dt;
      if (stepX !== 0 || stepZ !== 0) {
        const nx = node.position.x + stepX;
        const nz = node.position.z + stepZ;
        if (slopeAt(nx, nz) > maxSlopeRad) {
          // Too steep to climb. Do NOT zero the velocity outright — that dead-
          // stops the character the instant it touches any steep ground and,
          // because the input is still held, re-triggers every frame. The gait
          // then falls to idle and locomotion silently stops existing.
          // Instead, remove only the component heading INTO the slope and keep
          // the tangential part, so the character slides along the wall.
          const e = 0.6;
          const gx = terrainHeight(nx + e, nz) - terrainHeight(nx - e, nz);
          const gz = terrainHeight(nx, nz + e) - terrainHeight(nx, nz - e);
          const gl = Math.hypot(gx, gz);
          if (gl > 1e-6) {
            const ux = gx / gl, uz = gz / gl;             // uphill direction
            const into = velocity.x * ux + velocity.z * uz;
            if (into > 0) { velocity.x -= into * ux; velocity.z -= into * uz; }
            stepX = velocity.x * dt;
            stepZ = velocity.z * dt;
            // If sliding still lands somewhere unclimbable, give up on this step
            // only — leave the velocity alone so the next frame can retry.
            if (slopeAt(node.position.x + stepX, node.position.z + stepZ) > maxSlopeRad) {
              stepX = 0; stepZ = 0;
            }
          } else {
            stepX = 0; stepZ = 0;
          }
        }
      }
      node.position.x += stepX;
      node.position.z += stepZ;

      // ---- vertical: gravity, ground snap, jump --------------------------
      const groundH = terrainHeight(node.position.x, node.position.z);
      if (grounded && keys.has(' ')) {
        vy = JUMP_SPEED;
        grounded = false;
      }
      vy -= GRAVITY * dt;
      node.position.y += vy * dt;
      if (node.position.y <= groundH + GROUND_SNAP) {
        node.position.y = groundH;
        vy = 0;
        grounded = true;
      } else {
        grounded = false;
      }

      // ---- footstep / landing audio ---------------------------------------
      const audio = c.engine.systems?.audio;
      if (grounded && !wasGrounded) {
        // Just touched down (landing from a jump/fall) — one-shot, resets the
        // stride counter so the next footstep isn't a leftover fraction.
        node.getWorldPosition(footPos);
        audio?.play?.('landing', { position: { x: footPos.x, y: footPos.y, z: footPos.z } });
        strideDist = 0;
      } else if (grounded && hasInput) {
        strideDist += Math.hypot(stepX, stepZ);
        if (strideDist >= FOOTSTEP_STRIDE) {
          strideDist -= FOOTSTEP_STRIDE;
          node.getWorldPosition(footPos);
          audio?.play?.('footstep', { position: { x: footPos.x, y: footPos.y, z: footPos.z } });
        }
      } else if (!grounded || !hasInput) {
        strideDist = 0;
      }
      wasGrounded = grounded;

      // ---- character facing: smoothly turn toward movement direction ----
      if (hasInput) {
        const targetFacing = Math.atan2(moveDir.x, moveDir.z);
        let d = targetFacing - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest angular path
        facing += d * (1 - Math.exp(-TURN_RATE * dt));
      }
      if (node.rotation) node.rotation.y = facing;
      else if (node.quaternion) node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);

      // ---- pose ----------------------------------------------------------
      const speed = Math.hypot(velocity.x, velocity.z);
      // Hysteresis on the drop to idle. A hard stop — running into terrain, or
      // a single frame of blocked movement — otherwise snaps the whole body to
      // the idle pose in one frame: lean vanishes, arms drop, cape goes
      // vertical. Only fall to idle once the character has genuinely been still
      // for a moment, and never while the player is still asking to move.
      let nextPose = speed < POSE_IDLE_MAX ? 'idle' : speed < POSE_WALK_MAX ? 'walk' : 'run';
      if (nextPose === 'idle') {
        stillFrames++;
        if (stillFrames < IDLE_HOLD_FRAMES || hasInput) nextPose = pose === 'idle' ? 'idle' : pose;
      } else {
        stillFrames = 0;
      }
      // Speed goes across EVERY frame, not just on pose changes — the gait
      // derives its cadence from it, so a stale value is exactly the foot-slide
      // this is meant to remove.
      char?.setSpeed?.(speed);
      if (nextPose !== pose) {
        pose = nextPose;
        char.setPose?.(pose);
      }

      // ---- third-person camera rig ----------------------------------------
      updateCamera(c, node, dt);
    },
  };

  function updateCamera(c, node, dt) {
    const pivotX = node.position.x;
    const pivotY = node.position.y + CAM_HEIGHT;
    const pivotZ = node.position.z;

    // Orbit the camera on a sphere around the pivot: it sits behind the
    // character (opposite camFwd) at a horizontal distance that shrinks as
    // |pitch| grows, plus a vertical term so pitching down raises the boom
    // (tilts the view down at the character) and pitching up lowers it
    // (tilts the view up). A shoulder offset along camRight keeps the
    // character off-center — classic over-the-shoulder framing.
    const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
    const rightX = -fwdZ, rightZ = fwdX;
    const horiz = camDist * Math.cos(pitch);
    const vert = -camDist * Math.sin(pitch);

    desiredPos.set(
      pivotX - fwdX * horiz + rightX * CAM_SHOULDER,
      pivotY + vert,
      pivotZ - fwdZ * horiz + rightZ * CAM_SHOULDER
    );

    // ---- camera collision: sample terrain along the boom, pull in if blocked
    const dx = desiredPos.x - pivotX, dy = desiredPos.y - pivotY, dz = desiredPos.z - pivotZ;
    const fullLen = Math.hypot(dx, dy, dz) || 1e-6;
    const steps = 10;
    let safeLen = fullLen;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      rayPos.set(pivotX + dx * t, pivotY + dy * t, pivotZ + dz * t);
      const h = terrainHeight(rayPos.x, rayPos.z);
      if (rayPos.y < h + CAM_COLLIDE_SKIN) {
        safeLen = fullLen * (Math.max(0, i - 1) / steps);
        break;
      }
    }
    if (safeLen < fullLen) {
      const t = safeLen / fullLen;
      desiredPos.set(pivotX + dx * t, pivotY + dy * t, pivotZ + dz * t);
    }
    // Hard floor: never let the camera itself sink below ground + skin.
    const floorH = terrainHeight(desiredPos.x, desiredPos.z) + CAM_COLLIDE_SKIN;
    if (desiredPos.y < floorH) desiredPos.y = floorH;

    desiredLook.set(pivotX, node.position.y + CAM_LOOK_HEIGHT, pivotZ);

    if (!camInit) {
      camPos.copy(desiredPos);
      camLook.copy(desiredLook);
      camInit = true;
    } else {
      camPos.x = damp(camPos.x, desiredPos.x, CAM_POS_SPRING, dt);
      camPos.y = damp(camPos.y, desiredPos.y, CAM_POS_SPRING, dt);
      camPos.z = damp(camPos.z, desiredPos.z, CAM_POS_SPRING, dt);
      camLook.x = damp(camLook.x, desiredLook.x, CAM_LOOK_SPRING, dt);
      camLook.y = damp(camLook.y, desiredLook.y, CAM_LOOK_SPRING, dt);
      camLook.z = damp(camLook.z, desiredLook.z, CAM_LOOK_SPRING, dt);
    }

    // Re-clamp the smoothed position too, so the spring can never overshoot
    // through the ground even mid-lerp.
    const smoothedFloor = terrainHeight(camPos.x, camPos.z) + CAM_COLLIDE_SKIN;
    if (camPos.y < smoothedFloor) camPos.y = smoothedFloor;

    c.camera.position.copy(camPos);
    c.camera.lookAt(camLook);
    c.camera.updateMatrixWorld(true);
  }
}
