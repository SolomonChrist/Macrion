/**
 * Macrion audio system — music, ambience, and sound effects, all synthesized
 * at runtime with the Web Audio API. No audio files, no samples, no loops.
 *
 * createAudio(ctx) -> { name:'audio', update(ctx), play(id,opts), setMusicState(s), unlock() }
 *
 * Architecture (see the sibling files for detail):
 *   synth.js    — DSP toolkit: oscillator voices, noise buffers, ADSR, a
 *                 procedurally-generated convolution reverb, the master bus.
 *   score.js    — composition DATA: scale, chord progression, motifs per
 *                 adaptive state, Sarah's theme. music.js/sarah.js are the
 *                 only things that read it.
 *   music.js    — adaptive score: explore/alert/combat/boss/resolve, six
 *                 cross-faded layers (drone/pad/melody/perc/brass/resolve)
 *                 that respond to setMusicState() and to ctx.hour / ctx.weather
 *                 continuously. One-shot stingers ride on top of alert/boss
 *                 entry without ever hard-cutting the bed.
 *   sarah.js    — Sarah's motif: the emotional spine (docs/STORY.md). Same
 *                 melodic data, four arrangements — apparition/memory/ghost/
 *                 wedding. Owned by music.js, exposed through it.
 *   ambience.js — wind/thunder/insects/birds bed driven by world state.
 *   sfx.js      — one-shot physical/UI/combat cues (footsteps, landing,
 *                 sword swing/hit, enemy hit/death, level up, interact...).
 *
 * Autoplay policy: the AudioContext is created lazily, only from unlock(),
 * which this module wires to the page's first pointerdown/keydown/touchstart
 * (and can also be called explicitly by any other system). The capture
 * harness never sends input, so audio stays fully inert — no context, no
 * nodes, zero console output — for the whole lifetime of a headless run.
 */
import { createMasterBus, updateListenerFromCamera } from './synth.js';
import { createMusicEngine } from './music.js';
import { createAmbienceEngine } from './ambience.js';
import { createSfxEngine } from './sfx.js';

// Per docs/GAME_DESIGN.md §3: explore -> alert -> combat -> boss -> resolve.
const MUSIC_STATES = ['explore', 'alert', 'combat', 'boss', 'resolve'];
const SFX_IDS = [
  'footstep', 'landing', 'swordSwing', 'swordHit', 'enemyHit', 'enemyDeath',
  'interact', 'confirm', 'dialogueAdvance', 'questAccept', 'questComplete', 'levelUp',
];
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

export function createAudio(ctx) {
  let actx = null;
  let bus = null;
  let music = null;
  let ambience = null;
  let sfx = null;
  let unlocked = false;
  let gestureBound = false;

  /**
   * Wires the audio system to the game event bus. `game.js` is a stub as of
   * this writing (see src/game/game.js), so every one of these is a guess at
   * the eventual contract — each is independently optional-chained/try-caught
   * so a missing, partial, or differently-shaped bus never throws. When the
   * Game/Quest builder lands, wire emit() calls to these names, OR just call
   * the equivalent method directly on window.MACRION.systems.audio — both
   * paths work identically since this function only ever calls the same
   * public methods returned at the bottom of this file.
   *
   * Expected payloads (best-effort, all optional):
   *   'area:enter'      { hasEnemies: boolean }        -> alert if hasEnemies, else explore
   *   'boss:enter'                                     -> boss
   *   'combat:start' / 'combat:engage'                 -> combat
   *   'combat:end' / 'combat:disengage'                -> alert (still in the area) then explore
   *   'boss:defeat' / 'boss:complete'                  -> resolve
   *   'enemy:hit'        { position? }                 -> sfx enemyHit
   *   'enemy:death'      { position? }                 -> sfx enemyDeath
   *   'player:levelup'                                 -> sfx levelUp
   *   'quest:accept' / 'quest:advance' (non-final) / 'quest:complete' (or final:true) — as before
   *   'sarah:apparition'                                -> Sarah's theme, first hearing
   *   'story:beat' / 'sarah:memory' { intensity? }      -> Sarah's theme, memory arrangement
   *   'story:wedding' / 'sarah:wedding'                 -> Sarah's theme, full resolution + music resolve
   *   'story:proximity' { value: 0..1 }                 -> setStoryProximity (ghost motif in explore)
   */
  function wireGameEvents() {
    const game = ctx.engine?.systems?.game;
    const safe = (fn) => { try { fn(); } catch { /* a bad game-event handler must never break the frame */ } };
    const on = (evt, fn) => { try { game?.on?.(evt, (payload) => safe(() => fn(payload || {}))); } catch { /* no-op */ } };

    on('quest:advance', (p) => {
      const isComplete = p.complete === true || p.status === 'complete' || p.final === true || p.type === 'complete';
      play(isComplete ? 'questComplete' : 'questAccept');
    });
    on('quest:accept', () => play('questAccept'));
    on('quest:complete', () => play('questComplete'));

    on('area:enter', (p) => setMusicState(p.hasEnemies ? 'alert' : 'explore'));
    on('boss:enter', () => setMusicState('boss'));
    on('combat:start', () => setMusicState('combat'));
    on('combat:engage', () => setMusicState('combat'));
    on('combat:end', () => setMusicState('alert'));
    on('combat:disengage', () => setMusicState('alert'));
    on('boss:defeat', () => setMusicState('resolve'));
    on('boss:complete', () => setMusicState('resolve'));

    on('enemy:hit', (p) => play('enemyHit', p));
    on('enemy:death', (p) => play('enemyDeath', p));
    on('player:levelup', (p) => play('levelUp', p));
    on('player:attack', (p) => play('swordSwing', p));

    on('sarah:apparition', () => music?.cueSarahApparition?.());
    on('story:beat', (p) => music?.cueSarahMemory?.(p.intensity));
    on('sarah:memory', (p) => music?.cueSarahMemory?.(p.intensity));
    on('story:wedding', () => { music?.cueSarahWedding?.(); setMusicState('resolve'); });
    on('sarah:wedding', () => { music?.cueSarahWedding?.(); setMusicState('resolve'); });
    on('story:proximity', (p) => music?.setStoryProximity?.(p.value));
  }

  function init() {
    if (unlocked) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      bus = createMasterBus(actx);
      music = createMusicEngine(actx, bus);
      ambience = createAmbienceEngine(actx, bus);
      sfx = createSfxEngine(actx, bus);
      unlocked = true;
      wireGameEvents();
      return true;
    } catch {
      // Never throw from init — browsers may refuse context creation for all
      // sorts of policy reasons; audio simply stays off.
      actx = null; bus = null; music = null; ambience = null; sfx = null;
      unlocked = false;
      return false;
    }
  }

  function unlock() {
    try {
      const ok = init();
      if (ok && actx && actx.state === 'suspended') {
        actx.resume().catch(() => { /* still locked; try again next gesture */ });
      }
    } catch { /* swallow — unlock must never throw */ }
  }

  function bindGestureUnlock() {
    if (gestureBound) return;
    gestureBound = true;
    const handler = () => {
      unlock();
      for (const evt of GESTURE_EVENTS) window.removeEventListener(evt, handler);
    };
    for (const evt of GESTURE_EVENTS) window.addEventListener(evt, handler, { passive: true });
  }
  try { bindGestureUnlock(); } catch { /* headless/no-DOM edge case — stay inert */ }

  function play(id, opts) {
    try {
      if (!unlocked) return;
      if (id === 'questAccept') { music?.cueAccept?.(); sfx?.play?.('interact', opts); return; }
      if (id === 'questComplete') { music?.cueResolve?.(); return; }
      sfx?.play?.(id, opts);
    } catch { /* one bad sfx call must never break the frame */ }
  }

  function setMusicState(s) {
    try {
      if (!unlocked) return;
      music?.setState?.(s);
    } catch { /* swallow */ }
  }

  // --- Sarah's motif — direct audition/story-hook surface. ---
  function sarahApparition() { try { if (unlocked) music?.cueSarahApparition?.(); } catch { /* no-op */ } }
  function sarahMemory(intensity) { try { if (unlocked) music?.cueSarahMemory?.(intensity); } catch { /* no-op */ } }
  function sarahWedding() { try { if (unlocked) { music?.cueSarahWedding?.(); setMusicState('resolve'); } } catch { /* no-op */ } }
  function setStoryProximity(v) { try { if (unlocked) music?.setStoryProximity?.(v); } catch { /* no-op */ } }

  function update(c) {
    if (!unlocked || !actx) return;
    try {
      music?.update?.(c);
      ambience?.update?.(c);
      updateListenerFromCamera(actx, c.camera);
    } catch { /* a bad frame of audio must never break rendering */ }
  }

  return {
    name: 'audio',
    update,
    play,
    setMusicState,
    unlock,

    // Sarah's motif — see sarah.js. sarahMemory(intensity=0..1) plays the
    // "returns transformed" arrangement; setStoryProximity(0..1) controls how
    // often a ghost fragment of the theme surfaces inside the `explore` bed.
    sarahApparition,
    sarahMemory,
    sarahWedding,
    setStoryProximity,
    getStoryProximity: () => music?.getStoryProximity?.() ?? 0,

    // --- Debug / audition surface, reachable as window.MACRION.systems.audio ---
    // Static — discoverable even before the AudioContext exists.
    sfxIds: SFX_IDS,
    musicStates: MUSIC_STATES,
    isUnlocked: () => unlocked,
    setVolume: (v) => { try { bus?.setVolume?.(v); } catch { /* no-op */ } },
    getMusicState: () => music?.getState?.() ?? '(locked)',
  };
}
