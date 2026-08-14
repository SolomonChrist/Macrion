/**
 * Macrion — combat. Owned by the Combat builder.
 *
 * createCombat(ctx) -> { name:'combat', update(ctx), onMode(m,ctx) }
 *
 * Scope (docs/SHOWCASE.md mandate): player sword combo + real swept hit
 * detection, hit feedback (hitstop, camera shake, flash, knockback, sound),
 * enemy AI state machine, player health/i-frames/death/respawn, and events
 * on the game bus so audio + HUD react without further wiring.
 *
 * Integration contracts consumed (all optional-chained — see docs/SHOWCASE.md
 * "Integration contracts"; every sibling system may be missing or partial):
 *   engine.systems.character  { root|object3D, spawn, setPose? }
 *   engine.systems.player     { teleport(x,z) }
 *   engine.systems.enemies    { list():Enemy[], object3D?, update?, spawn?, despawn? }
 *     Enemy: { id, type, position:{x,y,z}, health, setPose(name), hitbox? }
 *     No takeDamage() is specified in the contract, so enemy.health and
 *     enemy.position are mutated directly (duck-typed: works whether
 *     position is a THREE.Vector3 or a plain {x,y,z}).
 *     `enemy.type === 'boss'` is this module's own convention (undocumented
 *     elsewhere) for gating boss:enter / boss:death — a best-effort guess
 *     until a real boss contract exists.
 *   engine.systems.game        { emit(evt, payload) }
 *   engine.systems.audio       { play(id, {position}) }
 *   engine.systems.hud         { setHealth(cur, max) }
 *
 * Camera authority + capture safety: this module only acts while
 * engine.mode === 'play', exactly like player/controller.js. Captures never
 * send input and stay in 'shot' mode, so this module's body never executes
 * during a capture run.
 *
 * Hitstop mechanism: there is no global time-scale primitive in engine.js
 * (lead-owned, not editable), so hitstop is implemented by toggling the
 * engine's own `_pinned` flag — the exact flag the capture harness already
 * uses (via engine.installContract's setClock) to freeze ctx.time. Pinning
 * it for a handful of wall-clock milliseconds freezes every ctx.time-driven
 * system in the game (character animation included) for a genuine freeze-
 * frame, not just a local pause of this module's own state. This is bounded
 * defensively: the FIRST thing update() does, every frame, unconditionally
 * (before the play-mode gate), is check whether the hitstop's wall-clock
 * timer has elapsed or engine.mode has left 'play', and if so clears the
 * pin. So a pin can never survive past its intended duration or leak across
 * a mode change into a capture — captures run exclusively in 'shot' mode,
 * which this module never touches at all.
 *
 * No Math.random() at runtime: camera shake uses deterministic layered sine
 * waves, not noise sampled from an RNG.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------- tuning --
// Combo stages. `active` window is a fraction of `duration` — the swept hit
// test only runs while inside it, matching "real hit detection ... during
// the active frames of the swing, not a raycast on keypress."
const STAGES = [
  { duration: 0.42, activeStart: 0.16, activeEnd: 0.30, arcDeg: 110, reach: 1.80, damage: 10, knockback: 3.0, hitstopMs: 70, shakeAmp: 0.10, shakeMs: 140 },
  { duration: 0.46, activeStart: 0.18, activeEnd: 0.34, arcDeg: 120, reach: 1.85, damage: 13, knockback: 3.6, hitstopMs: 90, shakeAmp: 0.14, shakeMs: 170 },
  { duration: 0.62, activeStart: 0.22, activeEnd: 0.46, arcDeg: 160, reach: 2.05, damage: 22, knockback: 6.0, hitstopMs: 140, shakeAmp: 0.24, shakeMs: 240 },
];
const COMBO_RESET_S = 0.85;      // no chained input within this after a swing ends -> back to stage 1
const BLADE_RADIUS = 0.28;       // added to enemy hit radius for the sweep test
const DEFAULT_ENEMY_RADIUS = 0.6;

// Player survivability.
const PLAYER_MAX_HP = 100;
const PLAYER_IFRAME_S = 0.8;
const PLAYER_HIT_KNOCKBACK = 2.6;
const PLAYER_HIT_SHAKE_AMP = 0.07;
const PLAYER_HIT_SHAKE_MS = 160;
const RESPAWN_DELAY_S = 2.0;
const RESPAWN_IFRAME_S = 1.2;

// Enemy AI.
const PERCEPTION_RADIUS = 11.0;
const DEAGGRO_RADIUS = 16.0;
const APPROACH_SPEED = 3.0;      // m/s while chasing
const ATTACK_RANGE = 1.9;
const ATTACK_WINDUP_S = 0.55;    // telegraph — the window the player can read and react to
const ATTACK_ACTIVE_S = 0.15;
const ATTACK_RECOVER_S = 0.45;
const ENEMY_DAMAGE = 12;
const STAGGER_S = 0.5;
const DEATH_DESPAWN_S = 1.8;     // grace period so a death pose/anim can play before despawn

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Deterministic camera shake — layered sines, decaying. No RNG. */
function shakeOffset(elapsedS, amp) {
  const s =
    Math.sin(elapsedS * 53.0) * 0.5 +
    Math.sin(elapsedS * 97.0 + 1.3) * 0.3 +
    Math.sin(elapsedS * 193.0 + 2.7) * 0.2;
  return s * amp;
}

export function createCombat(ctx) {
  const _tmp = new THREE.Vector3();
  const _bladeTip = new THREE.Vector3();
  const _prevBladeTip = new THREE.Vector3();
  const _segDir = new THREE.Vector3();
  const _toEnemy = new THREE.Vector3();
  const _closest = new THREE.Vector3();
  const _epos = new THREE.Vector3();

  // ---- player combo state --------------------------------------------
  let comboStage = -1;           // -1: idle, 0..2: STAGES index of the active swing
  let swingT = 0;                // seconds elapsed in current swing
  let swingSinceEnd = 999;       // seconds since last swing fully finished (for combo chain grace)
  let lastStageIndex = -1;       // stage just finished, for the chain-after-recovery case
  let queuedAttack = false;      // buffered input for the next stage (mid-swing)
  let hitThisSwing = null;       // Set of enemy ids already hit this swing

  // ---- player survivability --------------------------------------------
  let hp = PLAYER_MAX_HP;
  let iframeT = 0;               // seconds remaining of invulnerability
  let dead = false;
  let respawnT = 0;              // seconds remaining until respawn
  let hudInit = false;

  // ---- hit feedback state -------------------------------------------------
  let hitstopActive = false;
  let hitstopUntil = 0;          // performance.now() ms
  let shakeAmp = 0;
  let shakeUntil = 0;            // performance.now() ms
  let shakeDurMs = 1;
  let shakeStart = 0;

  // ---- combat/music-state bookkeeping -------------------------------------
  let inCombat = false;
  let bossSeen = new Set();
  let bossDeadSeen = new Set();

  // ---- per-enemy AI state, keyed by enemy.id -----------------------------
  const ai = new Map(); // id -> { state, timer, staggerT }

  let lastNow = performance.now();

  const dom = ctx.engine.renderer.domElement;

  function attackKeyDown(e) {
    if (ctx.engine.mode !== 'play') return;
    const k = e.key.toLowerCase();
    if (k === 'f' || k === 'j') requestAttack();
  }
  function mouseDown(e) {
    if (ctx.engine.mode !== 'play') return;
    if (e.button !== 0) return;
    requestAttack();
  }
  addEventListener('keydown', attackKeyDown);
  dom.addEventListener('mousedown', mouseDown);

  function requestAttack() {
    if (dead) return;
    if (comboStage !== -1) {
      // Mid-swing: buffer the input, consumed when the current stage ends.
      queuedAttack = true;
      return;
    }
    // Idle: chain onward if we're still inside the grace window after the
    // previous stage finished ("chained by input timing"); otherwise a
    // fresh combo starts from stage 1.
    if (swingSinceEnd <= COMBO_RESET_S && lastStageIndex >= 0 && lastStageIndex < STAGES.length - 1) {
      startStage(lastStageIndex + 1);
    } else {
      startStage(0);
    }
  }

  function startStage(i) {
    comboStage = i;
    swingT = 0;
    hitThisSwing = new Set();
    queuedAttack = false;
    // Play the swing sound directly (mandate: "Sound — audio?.play('swordHit'/...)").
    // Deliberately NOT emitting a 'player:attack' bus event here — audio.js's own
    // wireGameEvents() already listens for that event and would double-fire this
    // exact sound; direct-call is the single source of truth for swing audio.
    ctx.engine.systems?.audio?.play?.('swordSwing', playerPositionForAudio());
  }

  function playerPositionForAudio() {
    const node = playerNode();
    if (!node) return {};
    node.getWorldPosition(_tmp);
    return { position: { x: _tmp.x, y: _tmp.y, z: _tmp.z } };
  }

  function playerNode() {
    const char = ctx.engine.systems?.character;
    return char?.root ?? char?.object3D ?? null;
  }

  function beginHitstop(ms) {
    const engine = ctx.engine;
    if (!hitstopActive) { engine._pinned = true; hitstopActive = true; }
    hitstopUntil = Math.max(hitstopUntil, performance.now() + ms);
  }

  function beginShake(amp, ms) {
    // Take the larger, don't stack additively — a flurry of small hits
    // shouldn't out-shake one big hit that's already ringing down.
    if (amp >= shakeAmp) {
      shakeAmp = amp;
      shakeDurMs = ms;
      shakeStart = performance.now();
      shakeUntil = shakeStart + ms;
    }
  }

  function enemyRadius(enemy) {
    const hb = enemy.hitbox;
    if (typeof hb?.radius === 'number') return hb.radius;
    if (typeof hb === 'number') return hb;
    return DEFAULT_ENEMY_RADIUS;
  }

  function enemyPos(enemy, out) {
    const p = enemy.position;
    return out.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  }

  /** Closest point on segment ab to point p. */
  function closestPointOnSegment(a, b, p, out) {
    _segDir.subVectors(b, a);
    const len2 = _segDir.lengthSq();
    if (len2 < 1e-8) return out.copy(a);
    let t = _toEnemy.subVectors(p, a).dot(_segDir) / len2;
    t = clamp(t, 0, 1);
    return out.copy(a).addScaledVector(_segDir, t);
  }

  function applyDamageToEnemy(enemy, dmg, dirX, dirZ, knockback) {
    enemy.health = (enemy.health ?? 1) - dmg;
    const p = enemy.position;
    if (p) {
      p.x = (p.x ?? 0) + dirX * knockback;
      p.z = (p.z ?? 0) + dirZ * knockback;
    }
    const st = getAI(enemy);
    st.staggerT = STAGGER_S;
    st.state = 'stagger';
    // 'stagger' pose is both the flash/recoil cue AND held for STAGGER_S — the
    // Enemies module owns what that pose actually looks like.
    enemy.setPose?.('stagger');

    // Direct call for the weapon-impact sound (mandate requirement). Do NOT
    // also directly play 'enemyHit' here — emitting 'enemy:hit' below already
    // triggers it via audio.js's own wireGameEvents() bridge, so both SFX
    // ids layer (clang + enemy reaction) without either being double-fired.
    ctx.engine.systems?.game?.emit?.('enemy:hit', { id: enemy.id, damage: dmg, position: { ...p } });
    ctx.engine.systems?.audio?.play?.('swordHit', { position: { ...p } });

    if (enemy.health <= 0 && st.state !== 'dead') {
      st.state = 'dead';
      st.timer = DEATH_DESPAWN_S;
      enemy.setPose?.('death');
      // 'enemyDeath' SFX comes from audio.js's bridge on this same event —
      // no direct play() call here, to avoid double-firing the sound.
      ctx.engine.systems?.game?.emit?.('enemy:death', { id: enemy.id, position: { ...p } });
      if (enemy.type === 'boss' && !bossDeadSeen.has(enemy.id)) {
        bossDeadSeen.add(enemy.id);
        ctx.engine.systems?.game?.emit?.('boss:death', { id: enemy.id, position: { ...p } });
      }
    }
  }

  function getAI(enemy) {
    let st = ai.get(enemy.id);
    if (!st) {
      st = { state: 'idle', timer: 0, staggerT: 0 };
      ai.set(enemy.id, st);
    }
    return st;
  }

  // -------------------------------------------------------------- update --
  return {
    name: 'combat',

    onMode(m) {
      if (m !== 'play') {
        // Reset transient input/combo state so re-entering play starts clean.
        comboStage = -1;
        queuedAttack = false;
        hitThisSwing = null;
      }
    },

    update(c) {
      const engine = c.engine;

      // ---- hitstop safety valve: unconditional, runs even outside play ----
      // so a pin can never survive a mode change or outlive its duration.
      if (hitstopActive && (performance.now() >= hitstopUntil || engine.mode !== 'play')) {
        engine._pinned = false;
        hitstopActive = false;
      }

      if (engine.mode !== 'play') return;

      const now = performance.now();
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      if (!hudInit) {
        hudInit = true;
        engine.systems?.hud?.setHealth?.(hp, PLAYER_MAX_HP);
      }

      const node = playerNode();
      if (!node) { applyCameraShake(c, now); return; }

      node.getWorldPosition(_tmp);
      const px = _tmp.x, py = _tmp.y, pz = _tmp.z;
      const facing = node.rotation?.y ?? 0;

      // ---- player death / respawn -----------------------------------------
      if (dead) {
        respawnT -= dt;
        if (respawnT <= 0) {
          dead = false;
          hp = PLAYER_MAX_HP;
          iframeT = RESPAWN_IFRAME_S;
          const spawn = engine.systems?.character?.spawn ?? { x: px, z: pz };
          engine.systems?.player?.teleport?.(spawn.x, spawn.z);
          engine.systems?.hud?.setHealth?.(hp, PLAYER_MAX_HP);
        }
        applyCameraShake(c, now);
        return;
      }
      if (iframeT > 0) iframeT = Math.max(0, iframeT - dt);

      const enemies = engine.systems?.enemies?.list?.() ?? [];

      // ---- player attack: advance swing + swept hit test -------------------
      if (comboStage === -1) swingSinceEnd += dt;
      updatePlayerAttack(dt, px, py, pz, facing, enemies);

      // ---- enemy AI + damage-to-player ------------------------------------
      let anyEngaged = false;
      for (const enemy of enemies) {
        const engaged = updateEnemy(c, dt, enemy, px, py, pz);
        if (engaged) anyEngaged = true;
      }
      if (anyEngaged && !inCombat) {
        inCombat = true;
        engine.systems?.game?.emit?.('combat:start', {});
      } else if (!anyEngaged && inCombat) {
        inCombat = false;
      }

      applyCameraShake(c, now);
    },
  };

  // ------------------------------------------------------------ attack -----
  function updatePlayerAttack(dt, px, py, pz, facing, enemies) {
    if (comboStage === -1) return;
    const stage = STAGES[comboStage];
    const prevT = swingT;
    swingT += dt;

    const activeStartT = stage.duration * stage.activeStart;
    const activeEndT = stage.duration * stage.activeEnd;
    const isActive = swingT >= activeStartT && swingT <= activeEndT;

    if (isActive) {
      // Sweep the blade tip through the stage's arc as a function of progress
      // through the active window — a genuine swept check, not a single point.
      const activeProgress = clamp((swingT - activeStartT) / Math.max(1e-6, activeEndT - activeStartT), 0, 1);
      const prevProgress = clamp((prevT - activeStartT) / Math.max(1e-6, activeEndT - activeStartT), 0, 1);
      const arcRad = (stage.arcDeg * Math.PI) / 180;
      // Alternate slash direction by stage parity for visual/legibility variety.
      const sign = comboStage % 2 === 0 ? 1 : -1;
      const angleFor = (t) => facing + sign * (-arcRad / 2 + arcRad * t);

      bladeTipAt(px, py, pz, angleFor(prevProgress), stage.reach, _prevBladeTip);
      bladeTipAt(px, py, pz, angleFor(activeProgress), stage.reach, _bladeTip);

      const hitRadius = BLADE_RADIUS;
      for (const enemy of enemies) {
        if (hitThisSwing.has(enemy.id)) continue;
        const st = getAI(enemy);
        if (st.state === 'dead') continue;
        const epos = enemyPos(enemy, _epos);
        closestPointOnSegment(_prevBladeTip, _bladeTip, epos, _closest);
        const r = enemyRadius(enemy) + hitRadius;
        if (_closest.distanceToSquared(epos) <= r * r) {
          hitThisSwing.add(enemy.id);
          const dirX = epos.x - px, dirZ = epos.z - pz;
          const len = Math.hypot(dirX, dirZ) || 1;
          applyDamageToEnemy(enemy, stage.damage, dirX / len, dirZ / len, stage.knockback);
          beginHitstop(stage.hitstopMs);
          beginShake(stage.shakeAmp, stage.shakeMs);
        }
      }
    }

    if (swingT >= stage.duration) {
      // Swing finished. Chain if input was buffered during the tail of the
      // swing (from active-end through duration acts as the chain window);
      // otherwise fall back to idle and start the reset-to-stage-1 timer.
      if (queuedAttack && comboStage < STAGES.length - 1) {
        startStage(comboStage + 1);
      } else {
        lastStageIndex = comboStage;
        comboStage = -1;
        swingSinceEnd = 0;
        queuedAttack = false;
      }
    }
  }

  function bladeTipAt(px, py, pz, angle, reach, out) {
    out.set(px + Math.sin(angle) * reach, py + 1.05, pz + Math.cos(angle) * reach);
  }

  // -------------------------------------------------------------- enemy AI -
  /** Returns true if this enemy is actively engaged (notice/approach/attack). */
  function updateEnemy(c, dt, enemy, px, py, pz) {
    const st = getAI(enemy);
    const epos = enemyPos(enemy, _epos);
    const dx = px - epos.x, dz = pz - epos.z;
    const dist = Math.hypot(dx, dz);

    if (st.state === 'dead') {
      st.timer -= dt;
      if (st.timer <= 0) ctx.engine.systems?.enemies?.despawn?.(enemy.id);
      return false;
    }

    if (st.state === 'stagger') {
      st.staggerT -= dt;
      if (st.staggerT <= 0) {
        st.state = dist <= DEAGGRO_RADIUS ? 'approach' : 'idle';
        enemy.setPose?.(st.state);
      }
      return st.state !== 'idle';
    }

    if (st.state === 'idle') {
      enemy.setPose?.('idle');
      if (dist <= PERCEPTION_RADIUS) {
        st.state = 'notice';
        st.timer = 0.3; // brief reaction beat before the chase starts
        enemy.setPose?.('notice');
        if (enemy.type === 'boss' && !bossSeen.has(enemy.id)) {
          bossSeen.add(enemy.id);
          ctx.engine.systems?.game?.emit?.('boss:enter', { id: enemy.id });
        }
      }
      return false;
    }

    if (st.state === 'notice') {
      st.timer -= dt;
      if (st.timer <= 0) { st.state = 'approach'; enemy.setPose?.('approach'); }
      return true;
    }

    if (dist > DEAGGRO_RADIUS) {
      st.state = 'idle';
      enemy.setPose?.('idle');
      return false;
    }

    if (st.state === 'approach') {
      if (dist <= ATTACK_RANGE) {
        st.state = 'windup';
        st.timer = ATTACK_WINDUP_S;
        enemy.setPose?.('windup'); // the readable telegraph
      } else if (dist > 1e-4) {
        const nx = dx / dist, nz = dz / dist;
        const p = enemy.position;
        p.x = (p.x ?? 0) + nx * APPROACH_SPEED * dt;
        p.z = (p.z ?? 0) + nz * APPROACH_SPEED * dt;
        enemy.setPose?.('approach');
      }
      return true;
    }

    if (st.state === 'windup') {
      st.timer -= dt;
      if (st.timer <= 0) { st.state = 'attack'; st.timer = ATTACK_ACTIVE_S; enemy.setPose?.('attack'); }
      return true;
    }

    if (st.state === 'attack') {
      st.timer -= dt;
      if (st.timer > 0) {
        // Active damage window.
        if (dist <= ATTACK_RANGE + 0.3) damagePlayer(c, ENEMY_DAMAGE, epos);
      } else {
        st.state = 'recover';
        st.timer = ATTACK_RECOVER_S;
      }
      return true;
    }

    if (st.state === 'recover') {
      st.timer -= dt;
      if (st.timer <= 0) {
        st.state = dist <= ATTACK_RANGE ? 'windup' : 'approach';
        if (st.state === 'windup') st.timer = ATTACK_WINDUP_S;
        enemy.setPose?.(st.state);
      }
      return true;
    }

    return false;
  }

  function damagePlayer(c, dmg, sourcePos) {
    if (dead || iframeT > 0) return;
    hp = Math.max(0, hp - dmg);
    iframeT = PLAYER_IFRAME_S;
    c.engine.systems?.hud?.setHealth?.(hp, PLAYER_MAX_HP);
    // No dedicated "player was hit" SFX id exists in the audio contract
    // (swordHit/enemyHit are both about the *enemy* end of a hit), so this
    // relies on shake + knockback + i-frames + HUD for feedback rather than
    // misusing an enemy-flavoured sound.
    c.engine.systems?.game?.emit?.('player:hit', { damage: dmg, hp });
    beginShake(PLAYER_HIT_SHAKE_AMP, PLAYER_HIT_SHAKE_MS);

    // Knock the player back away from the source.
    const node = playerNode();
    if (node && sourcePos) {
      node.getWorldPosition(_tmp);
      const dx = _tmp.x - sourcePos.x, dz = _tmp.z - sourcePos.z;
      const len = Math.hypot(dx, dz) || 1;
      node.position.x += (dx / len) * PLAYER_HIT_KNOCKBACK * 0.15;
      node.position.z += (dz / len) * PLAYER_HIT_KNOCKBACK * 0.15;
    }

    if (hp <= 0) {
      dead = true;
      respawnT = RESPAWN_DELAY_S;
      comboStage = -1;
    }
  }

  // ---------------------------------------------------------------- camera -
  function applyCameraShake(c, now) {
    if (shakeAmp <= 0) return;
    if (now >= shakeUntil) { shakeAmp = 0; return; }
    const elapsed = (now - shakeStart) / 1000;
    const decay = 1 - (now - shakeStart) / shakeDurMs;
    const amp = shakeAmp * Math.max(0, decay);
    const ox = shakeOffset(elapsed, amp);
    const oy = shakeOffset(elapsed * 1.3 + 10, amp * 0.6);
    const oz = shakeOffset(elapsed * 0.9 + 20, amp);
    c.camera.position.x += ox;
    c.camera.position.y += oy;
    c.camera.position.z += oz;
    c.camera.updateMatrixWorld(true);
  }
}
