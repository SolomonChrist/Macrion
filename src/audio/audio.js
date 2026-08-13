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
 *                 adaptive state. music.js is the only thing that reads it.
 *   music.js    — adaptive score: five cross-faded layers (drone/pad/melody/
 *                 perc/resolve) that respond to setMusicState() and to
 *                 ctx.hour / ctx.weather continuously.
 *   ambience.js — wind/thunder/insects/birds bed driven by world state.
 *   sfx.js      — one-shot physical/UI cues (footsteps, landing, interact...).
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

const MUSIC_STATES = ['explore', 'tension', 'combat', 'resolve'];
const SFX_IDS = ['footstep', 'landing', 'interact', 'confirm', 'dialogueAdvance', 'questAccept', 'questComplete'];
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

export function createAudio(ctx) {
  let actx = null;
  let bus = null;
  let music = null;
  let ambience = null;
  let sfx = null;
  let unlocked = false;
  let gestureBound = false;

  function wireGameEvents() {
    // Guarded: game.js may still be the stub, or absent entirely, or land
    // later in the session. `on` is optional-chained at every step so a
    // missing/partial event bus never throws.
    const game = ctx.engine?.systems?.game;
    const onQuestPayload = (payload) => {
      const p = payload || {};
      const isComplete = p.complete === true || p.status === 'complete' || p.final === true || p.type === 'complete';
      try {
        if (isComplete) { play('questComplete'); }
        else { play('questAccept'); }
      } catch { /* never let a game-event handler throw into the caller */ }
    };
    try { game?.on?.('quest:advance', onQuestPayload); } catch { /* no-op */ }
    try { game?.on?.('quest:accept', () => play('questAccept')); } catch { /* no-op */ }
    try { game?.on?.('quest:complete', () => play('questComplete')); } catch { /* no-op */ }
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

    // --- Debug / audition surface, reachable as window.MACRION.systems.audio ---
    // Static — discoverable even before the AudioContext exists.
    sfxIds: SFX_IDS,
    musicStates: MUSIC_STATES,
    isUnlocked: () => unlocked,
    setVolume: (v) => { try { bus?.setVolume?.(v); } catch { /* no-op */ } },
    getMusicState: () => music?.getState?.() ?? '(locked)',
  };
}
