/**
 * Macrion — the first boss encounter. OWNED BY CINEMATICS/BOSS BUILDER.
 *
 * Distinct from the Snagulas (docs/STORY.md: Snagulas are man-sized, green,
 * sharp-toothed, red-eyed). This is a Sand Warden — a hulking rock-and-sand
 * guardian roughly 4.5m tall, tan/grey stone silhouette, broad and blocky
 * where the Snagulas read as slight and quick. It keeps the red-eye motif
 * (every enemy is sent by Sallenties per STORY.md) as the one family cue,
 * everything else is deliberately a different shape language.
 *
 * SEAM: src/entities/enemies/* does not exist yet at the time this was
 * written (Enemies builder hasn't landed a shared Snagula generator), so
 * this boss carries its own procedural geometry rather than the instructed
 * "reuse the generator" path. buildBossGeometry() below is the only place
 * that would need to change if/when a shared generator lands — the state
 * machine, health API, and event-bus contract below don't care how the
 * mesh is built.
 *
 * NOT WIRED INTO main.js. Exported factory only:
 *   import { createBoss } from './game/boss.js';
 *   engine.systems.boss = engine.registerModule(createBoss(engine.ctx));
 * The lead decides where/when enter() is called (arena trigger volume).
 *
 * Contract for Combat/Player builders (all optional-chained on their side):
 *   boss.enter()                      — activate the boss, arena music, 'boss:enter'
 *   boss.applyDamage(amount, source?) — damage the boss; 'enemy:hit'; triggers the
 *                                        victory sequence at 0 HP
 *   boss.getHealth() / boss.getMaxHealth() / boss.isDefeated()
 *   boss.getAttackWindow() -> null | { name, phase: 'telegraph'|'active'|'recover', t: 0..1 }
 *     Read `phase` to know when the boss is safe to punish: 'recover' is the
 *     intended punish window. 'telegraph' is the intended dodge/read window.
 *   boss.object3D, boss.update(ctx)
 *
 * Attack pattern — three attacks in a fixed seeded rotation (no Math.random
 * anywhere; makeRNG(SEED) picks the rotation once, deterministically):
 *   slam     — short-range AOE stomp, long telegraph (arms raise, chest glows)
 *   charge   — long-range dash, short telegraph (crouch, dust kicks up)
 *   sandWave — mid-range ranged wave, medium telegraph (arms sweep up, sand gathers)
 * Telegraphs are generous (0.9-1.2s) and recovers are real punish windows
 * (1.1-1.4s) — tuned toward docs/GAME_DESIGN.md's flow channel: readable
 * enough to learn, not so long it's boring to wait out.
 *
 * On defeat: grants the exact key the road ahead needs, not a stat bump.
 * The vista bossVictory reveals (src/cinematics/cutscene-data.js) shows
 * three distant paths the player must be able to reach — so the power is
 * `stormDash`, a traversal ability. That mapping is a judgment call made in
 * the absence of the real Combat/Movement lock design; flag it as such.
 *
 * Determinism: all timing keyed off ctx.time (never performance.now()), all
 * randomness seeded via makeRNG(SEED).
 */
import * as THREE from 'three';
import { makeRNG, SEED } from '../core/engine.js';

/** World-space arena center. Matches the coordinates the bossVictory
 * cutscene's camera beats are authored around (cutscene-data.js). */
export const ARENA = { x: 40, z: -170 };

export const BOSS_MAX_HP = 300;

/** Fixed attack definitions. Order is shuffled once (seeded) at construction
 * so different sessions of the same seed still play identically. */
const ATTACK_DEFS = [
  { name: 'slam', telegraph: 1.2, active: 0.35, recover: 1.3, range: 9, damage: 22 },
  { name: 'charge', telegraph: 0.9, active: 0.55, recover: 1.4, range: 22, damage: 18 },
  { name: 'sandWave', telegraph: 1.1, active: 0.5, recover: 1.2, range: 16, damage: 15 },
];

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic per-vertex rock noise — same technique family as the
 * character builder's seeded value noise, kept local and lightweight here. */
function roughen(geometry, rng, amount) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = (rng() - 0.5) * 2 * amount;
    v.addScaledVector(v.clone().normalize(), n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function buildBossGeometry(rng) {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x8d7a5c, roughness: 0.94, metalness: 0.02, flatShading: true,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: 0x5c4f3a, roughness: 0.96, metalness: 0.02, flatShading: true,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1.6, roughness: 0.4,
  });

  // Torso — broad, blocky, roughened icosahedron. ~4.5m tall figure overall.
  const torsoGeo = new THREE.IcosahedronGeometry(1.7, 1);
  torsoGeo.scale(1.25, 1.5, 1.0);
  roughen(torsoGeo, rng, 0.16);
  const torso = new THREE.Mesh(torsoGeo, stoneMat);
  torso.position.y = 2.6;
  torso.castShadow = torso.receiveShadow = true;
  group.add(torso);

  // Head — smaller, sits low into the shoulders (no neck) for a hulking read.
  const headGeo = new THREE.IcosahedronGeometry(0.75, 1);
  roughen(headGeo, rng, 0.09);
  const head = new THREE.Mesh(headGeo, darkStoneMat);
  head.position.y = 4.15;
  head.castShadow = true;
  group.add(head);

  // Eyes — the one Snagula-family cue, deliberately small against the huge
  // silhouette so the read stays "guardian", not "monster face".
  const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.28, 4.2, 0.62);
  eyeR.position.set(0.28, 4.2, 0.62);
  group.add(eyeL, eyeR);

  // Arms — thick cylinders with boulder fists, offset out from the torso.
  const arms = {};
  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.6, 7), stoneMat);
    upper.position.set(side * 1.9, 3.0, 0);
    upper.rotation.z = side * 0.35;
    upper.castShadow = true;
    const fistGeo = new THREE.IcosahedronGeometry(0.62, 0);
    roughen(fistGeo, rng, 0.12);
    const fist = new THREE.Mesh(fistGeo, darkStoneMat);
    fist.position.set(side * 2.75, 1.95, 0);
    fist.castShadow = true;
    group.add(upper, fist);
    arms[side < 0 ? 'L' : 'R'] = { upper, fist };
  }

  // Legs — squat, wide stance for a grounded, immovable read.
  const legs = {};
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.7, 7), darkStoneMat);
    leg.position.set(side * 0.85, 0.85, 0);
    leg.castShadow = true;
    group.add(leg);
    legs[side < 0 ? 'L' : 'R'] = leg;
  }

  group.userData.parts = { torso, head, eyeL, eyeR, arms, legs };
  group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return group;
}

export function createBoss(ctx) {
  const engine = ctx.engine;
  const fresh = () => engine.ctx;
  const rng = makeRNG(SEED + 7331); // distinct stream from world-gen, still deterministic

  const object3D = new THREE.Group();
  object3D.name = 'boss-sandWarden';
  object3D.position.set(ARENA.x, 0, ARENA.z);

  const mesh = buildBossGeometry(rng);
  object3D.add(mesh);
  const parts = mesh.userData.parts;

  const rotation = shuffled(ATTACK_DEFS, rng);

  const state = {
    entered: false,
    defeated: false,
    hp: BOSS_MAX_HP,
    attackIndex: 0,
    phase: 'dormant',        // dormant | telegraph | active | recover
    phaseStart: 0,
    entryTime: 0,
    defeatTime: null,
    playerHitThisAttack: false,
  };

  const _playerPos = new THREE.Vector3();
  function getPlayerWorldXZ() {
    const char = engine.systems?.character;
    const node = char?.root ?? char?.object3D;
    if (!node) return null;
    node.getWorldPosition(_playerPos);
    return _playerPos;
  }

  function currentAttack() { return rotation[state.attackIndex % rotation.length]; }

  function enter() {
    if (state.entered) return;
    state.entered = true;
    const c = fresh();
    state.entryTime = c.time;
    state.phase = 'telegraph';
    state.phaseStart = c.time;
    state.attackIndex = 0;
    state.playerHitThisAttack = false;

    engine.systems?.audio?.setMusicState?.('boss');
    engine.systems?.game?.emit?.('boss:enter', { boss: 'sandWarden' });
    engine.systems?.hud?.toast?.('The Sand Warden rises.');
  }

  function applyDamage(amount, source) {
    if (!state.entered || state.defeated) return;
    const dmg = Math.max(0, amount || 0);
    state.hp = Math.max(0, state.hp - dmg);
    engine.systems?.game?.emit?.('enemy:hit', { target: 'boss', amount: dmg, source: source ?? null });
    engine.systems?.audio?.play?.('enemyHit', { position: worldFistPos() });
    if (state.hp <= 0) defeat();
  }

  function worldFistPos() {
    const p = new THREE.Vector3();
    object3D.getWorldPosition(p);
    return { x: p.x, y: p.y + 3, z: p.z };
  }

  function defeat() {
    if (state.defeated) return;
    state.defeated = true;
    state.defeatTime = fresh().time;
    state.phase = 'defeated';

    engine.systems?.audio?.play?.('enemyDeath', { position: worldFistPos() });
    engine.systems?.audio?.setMusicState?.('resolve');
    engine.systems?.game?.emit?.('boss:death', { boss: 'sandWarden' });
    engine.systems?.game?.emit?.('boss:defeat', { boss: 'sandWarden' }); // audio.js bridge listens for this name too
    engine.systems?.cutscene?.play?.('bossVictory');
  }

  function advancePhase(c) {
    const atk = currentAttack();
    const elapsed = c.time - state.phaseStart;

    if (state.phase === 'telegraph' && elapsed >= atk.telegraph) {
      state.phase = 'active';
      state.phaseStart = c.time;
      state.playerHitThisAttack = false;
    } else if (state.phase === 'active' && elapsed >= atk.active) {
      state.phase = 'recover';
      state.phaseStart = c.time;
    } else if (state.phase === 'recover' && elapsed >= atk.recover) {
      state.attackIndex = (state.attackIndex + 1) % rotation.length;
      state.phase = 'telegraph';
      state.phaseStart = c.time;
      state.playerHitThisAttack = false;
    }
  }

  function checkPlayerHit(c) {
    if (state.phase !== 'active' || state.playerHitThisAttack) return;
    const p = getPlayerWorldXZ();
    if (!p) return;
    const bossPos = new THREE.Vector3();
    object3D.getWorldPosition(bossPos);
    const dx = p.x - bossPos.x, dz = p.z - bossPos.z;
    const dist = Math.hypot(dx, dz);
    const atk = currentAttack();
    if (dist <= atk.range) {
      state.playerHitThisAttack = true;
      engine.systems?.game?.emit?.('player:hit', { amount: atk.damage, attack: atk.name });
    }
  }

  /** Cheap readable animation per phase — no skeleton needed, this is a
   * blocky golem, not a rigged character. */
  function animate(c) {
    const t = c.time;
    const idle = Math.sin(t * 1.1) * 0.03;
    parts.torso.position.y = 2.6 + idle;

    const eyeGlow = state.phase === 'telegraph'
      ? 1.6 + 2.0 * Math.min(1, (t - state.phaseStart) / (currentAttack().telegraph || 1))
      : state.phase === 'active' ? 4.0 : 1.6;
    parts.eyeL.material.emissiveIntensity = eyeGlow;
    parts.eyeR.material.emissiveIntensity = eyeGlow;

    const armLift = state.phase === 'telegraph'
      ? Math.min(1, (t - state.phaseStart) / (currentAttack().telegraph || 1))
      : state.phase === 'active' ? 1 - Math.min(1, (t - state.phaseStart) / (currentAttack().active || 1))
      : 0;
    for (const side of ['L', 'R']) {
      const arm = parts.arms[side];
      const sign = side === 'L' ? -1 : 1;
      arm.upper.rotation.x = -armLift * 1.1;
      arm.fist.position.y = 1.95 + armLift * 0.9;
      arm.fist.position.x = sign * (2.75 - armLift * 0.4);
    }

    if (state.phase === 'recover') {
      const rt = Math.min(1, (t - state.phaseStart) / (currentAttack().recover || 1));
      mesh.rotation.z = Math.sin(rt * Math.PI) * 0.06; // stagger sway — reads as the punish window
    } else {
      mesh.rotation.z *= 0.85;
    }

    if (state.defeated) {
      const dt = t - (state.defeatTime ?? t);
      const sink = Math.min(1.4, dt * 0.8);
      object3D.position.y = -sink;
      mesh.traverse((o) => {
        if (o.isMesh) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - dt / 2.2); }
      });
    }
  }

  function update(c) {
    if (!state.entered || state.defeated) { animate(c); return; }
    advancePhase(c);
    checkPlayerHit(c);
    animate(c);
  }

  return {
    name: 'boss',
    object3D,
    update,

    enter,
    applyDamage,
    getHealth: () => state.hp,
    getMaxHealth: () => BOSS_MAX_HP,
    isDefeated: () => state.defeated,
    isEntered: () => state.entered,
    getAttackWindow() {
      if (!state.entered || state.defeated) return null;
      const atk = currentAttack();
      const dur = atk[state.phase] || 1;
      const t = Math.min(1, (fresh().time - state.phaseStart) / dur);
      return { name: atk.name, phase: state.phase, t };
    },

    // Debug/console helper — not used by any capture path.
    debugDefeat: () => defeat(),
  };
}
