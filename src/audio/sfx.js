/**
 * Macrion sound effects — short, synthesized, one-shot cues.
 *
 * Physical/UI/combat sounds live here: footstep, landing, interact,
 * dialogueAdvance, swordSwing, swordHit, enemyHit, enemyDeath, levelUp.
 * Musical stings (quest accept / quest complete) are dispatched by audio.js
 * into music.js instead, since they're built from the score's scale/motif
 * data rather than raw synthesis — see score.ACCEPT_CUE / RESOLVE_CUE.
 *
 * Any handler here accepts `opts.position = {x,y,z}` for 3D placement (routed
 * through a PannerNode against ctx.camera as listener — see
 * synth.updateListenerFromCamera, called every frame from audio.js) and
 * `opts.volume` as a 0..1 multiplier.
 */
import { createNoiseBuffer, noiseHit, tone, toneSweep, toBus, rng, rngGauss } from './synth.js';

const SURFACES = {
  gravel: { freq: 2200, q: 2.2, decay: 0.07 },
  dirt: { freq: 850, q: 1.1, decay: 0.09 },
  grass: { freq: 2600, q: 1.6, decay: 0.06 },
  rock: { freq: 1500, q: 3.0, decay: 0.05 },
};

export function createSfxEngine(actx, bus) {
  const sfxLayer = actx.createGain();
  sfxLayer.gain.value = 1.0;
  toBus(sfxLayer, bus, 0.18);

  const stepBuf = createNoiseBuffer(actx, 0.4, 'white');
  const thumpBuf = createNoiseBuffer(actx, 0.5, 'brown');
  const tickBuf = createNoiseBuffer(actx, 0.15, 'white');
  const swingBuf = createNoiseBuffer(actx, 0.3, 'white');   // sword swing whoosh
  const clangBuf = createNoiseBuffer(actx, 0.4, 'white');   // metal hit
  const impactBuf = createNoiseBuffer(actx, 0.35, 'brown'); // flesh/body hit

  let footToggle = 1;

  /** 3D placement is handled by tone()/noiseHit()/toneSweep() themselves via
   * their `position` option (see synth.js) — that folds the panner into each
   * voice's own disposal timer so nothing leaks. This just picks the bus:
   * a positional voice still lands on the shared sfxLayer's single reverb
   * send, it just also carries a `position` for the caller to pass through. */
  function busFor() { return { dry: sfxLayer }; }

  function footstep(opts = {}) {
    const surface = SURFACES[opts.surface] ?? SURFACES.gravel;
    const speed = Math.max(0.2, Math.min(2.0, opts.speed ?? 1.0)); // 1.0 = walk, >1 = run
    const bus_ = busFor();
    footToggle *= -1;

    const jitter = rngGauss();
    const freq = surface.freq * (1 + jitter * 0.18);
    const decay = surface.decay * (1.15 - 0.25 * speed) * (1 + rng() * 0.15);
    const gain = (0.22 + 0.14 * (speed - 0.5)) * (opts.volume ?? 1);

    noiseHit(actx, {
      buffer: stepBuf, start: actx.currentTime, attack: 0.002, decay,
      gain: Math.max(0.05, gain), filterType: 'bandpass', filterFreq: Math.max(200, freq),
      filterQ: surface.q, playbackRate: 0.9 + rng() * 0.25,
      pan: opts.position ? 0 : footToggle * (0.12 + rng() * 0.1), position: opts.position,
      bus: bus_, send: 0,
    });
    // A faint low knock layered under harder/faster steps sells weight without a sample.
    if (speed > 1.1) {
      noiseHit(actx, {
        buffer: thumpBuf, start: actx.currentTime, attack: 0.002, decay: decay * 1.4,
        gain: 0.08 * speed, filterType: 'lowpass', filterFreq: 220, filterQ: 0.6,
        pan: opts.position ? 0 : footToggle * 0.1, position: opts.position, bus: bus_, send: 0,
      });
    }
  }

  function landing(opts = {}) {
    const hard = opts.hard ?? false;
    const bus_ = busFor();
    noiseHit(actx, {
      buffer: thumpBuf, start: actx.currentTime, attack: 0.003, decay: hard ? 0.22 : 0.14,
      gain: (hard ? 0.55 : 0.38) * (opts.volume ?? 1), filterType: 'lowpass',
      filterFreq: hard ? 180 : 240, filterQ: 0.6, pan: 0, position: opts.position, bus: bus_, send: 0,
    });
    tone(actx, {
      type: 'sine', freq: hard ? 80 : 110, start: actx.currentTime,
      attack: 0.002, decay: 0.12, sustain: 0.3, release: hard ? 0.35 : 0.2,
      sustainSeconds: 0.02, gain: (hard ? 0.3 : 0.18) * (opts.volume ?? 1),
      filterType: 'lowpass', filterFreq: 400, filterQ: 0.3, pan: 0, position: opts.position, bus: bus_, send: 0,
    });
  }

  function interact(opts = {}) {
    toneSweep(actx, {
      type: 'triangle', freqStart: 520, freqEnd: 880, start: actx.currentTime,
      dur: 0.08, attack: 0.006, release: 0.09, gain: 0.22 * (opts.volume ?? 1),
      filterFreq: 3200, pan: 0, position: opts.position, bus: busFor(), send: 0,
    });
  }

  function dialogueAdvance(opts = {}) {
    noiseHit(actx, {
      buffer: tickBuf, start: actx.currentTime, attack: 0.001, decay: 0.025,
      gain: 0.14 * (opts.volume ?? 1), filterType: 'highpass', filterFreq: 2800,
      filterQ: 0.5, pan: 0, bus: busFor(), send: 0,
    });
  }

  /** Sword swing — a pitch-swept noise whoosh, direction/speed varies the sweep. */
  function swordSwing(opts = {}) {
    const speed = Math.max(0.5, Math.min(2.0, opts.speed ?? 1.0));
    const dur = 0.16 / speed;
    noiseHit(actx, {
      buffer: swingBuf, start: actx.currentTime, attack: 0.004, decay: dur,
      gain: 0.3 * (opts.volume ?? 1), filterType: 'bandpass',
      filterFreq: 1800 + rng() * 600, filterQ: 1.4, playbackRate: 0.85 + speed * 0.3 + rng() * 0.15,
      pan: opts.position ? 0 : (rng() - 0.5) * 0.4, position: opts.position, bus: busFor(), send: 0,
    });
  }

  /** Sword striking an enemy — bright metallic clang (inharmonic partials) + a
   * short noise transient. Distinct timbre from swordSwing and from enemyHit
   * (flesh) so the player can tell a parry/block from a solid hit by ear. */
  function swordHit(opts = {}) {
    const bus_ = busFor();
    noiseHit(actx, {
      buffer: clangBuf, start: actx.currentTime, attack: 0.001, decay: 0.09,
      gain: 0.32 * (opts.volume ?? 1), filterType: 'bandpass', filterFreq: 2600,
      filterQ: 2.0, position: opts.position, bus: bus_, send: 0,
    });
    tone(actx, {
      type: 'square', freq: 1400 + rng() * 300, start: actx.currentTime,
      attack: 0.001, decay: 0.18, sustain: 0.15, release: 0.25, sustainSeconds: 0.01,
      gain: 0.16 * (opts.volume ?? 1), filterType: 'bandpass', filterFreq: 3200, filterQ: 3.5,
      partials: [{ ratio: 1.78, gainMul: 0.4, type: 'square' }, { ratio: 2.41, gainMul: 0.22, type: 'sine' }],
      position: opts.position, bus: bus_, send: 0,
    });
  }

  /** Enemy takes a hit — dull impact, no metal ring, a short pained pitch-drop. */
  function enemyHit(opts = {}) {
    const bus_ = busFor();
    noiseHit(actx, {
      buffer: impactBuf, start: actx.currentTime, attack: 0.002, decay: 0.15,
      gain: 0.34 * (opts.volume ?? 1), filterType: 'lowpass', filterFreq: 900,
      filterQ: 0.7, position: opts.position, bus: bus_, send: 0,
    });
    toneSweep(actx, {
      type: 'sawtooth', freqStart: 320 + rng() * 80, freqEnd: 140, start: actx.currentTime,
      dur: 0.12, attack: 0.004, release: 0.08, gain: 0.14 * (opts.volume ?? 1),
      filterFreq: 900, position: opts.position, bus: bus_, send: 0,
    });
  }

  /** Enemy death — heavier impact + a longer descending groan, more reverb-forward. */
  function enemyDeath(opts = {}) {
    const bus_ = busFor();
    noiseHit(actx, {
      buffer: impactBuf, start: actx.currentTime, attack: 0.003, decay: 0.35,
      gain: 0.42 * (opts.volume ?? 1), filterType: 'lowpass', filterFreq: 600,
      filterQ: 0.6, position: opts.position, bus: bus_, send: 0,
    });
    toneSweep(actx, {
      type: 'sawtooth', freqStart: 260, freqEnd: 70, start: actx.currentTime + 0.02,
      dur: 0.5, attack: 0.02, release: 0.3, gain: 0.2 * (opts.volume ?? 1),
      filterFreq: 700, position: opts.position, bus: bus_, send: 0,
    });
  }

  /** Level up — bright ascending arpeggio with a bell-like shimmer, celebratory
   * and distinct from the score's own RESOLVE/ACCEPT cues (this is a player-
   * stat event, not a story beat, so it stays out of the music engine). */
  function levelUp(opts = {}) {
    const bus_ = busFor();
    const start = actx.currentTime;
    const steps = [0, 4, 7, 12, 16]; // semitone offsets — major-flavored, triumphant
    let t = start;
    for (let i = 0; i < steps.length; i++) {
      const freq = 440 * Math.pow(2, steps[i] / 12);
      tone(actx, {
        type: 'triangle', freq, start: t,
        attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.9,
        sustainSeconds: 0.05, gain: (0.22 - i * 0.02) * (opts.volume ?? 1),
        filterType: 'lowpass', filterFreq: 6000, filterQ: 0.3,
        partials: i === steps.length - 1
          ? [{ ratio: 2.0, gainMul: 0.3, type: 'sine' }, { ratio: 3.0, gainMul: 0.15, type: 'sine' }]
          : [],
        pan: (i / steps.length - 0.5) * 0.5, bus: bus_, send: 0,
      });
      t += 0.075;
    }
  }

  const HANDLERS = {
    footstep, landing, interact, confirm: interact, dialogueAdvance,
    swordSwing, swordHit, enemyHit, enemyDeath, levelUp,
  };

  function play(id, opts) {
    const fn = HANDLERS[id];
    if (fn) fn(opts);
  }

  return { play, ids: () => Object.keys(HANDLERS) };
}
