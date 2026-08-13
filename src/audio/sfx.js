/**
 * Macrion sound effects — short, synthesized, one-shot cues.
 *
 * Physical/UI sounds live here (footsteps, landing, interact, dialogue tick).
 * Musical stings (quest accept / quest complete) are dispatched by audio.js
 * into music.js instead, since they're built from the score's scale/motif
 * data rather than raw synthesis — see score.ACCEPT_CUE / RESOLVE_CUE.
 */
import { createNoiseBuffer, noiseHit, tone, toneSweep, toBus, createPositional, rng, rngGauss } from './synth.js';

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

  let footToggle = 1;

  /** Resolve where a one-shot should output: positional panner if opts gives a
   * world position, otherwise straight into the shared SFX layer (with a small
   * stereo pan for variety). */
  function destFor(opts) {
    if (opts?.position) {
      // send=0: the panner's dry output still lands on sfxLayer, which already
      // owns a single shared reverb send to the master bus (set up above) —
      // no need for a second send path per positional voice.
      const panner = createPositional(actx, { dry: sfxLayer }, 0);
      const p = opts.position;
      if (panner.positionX) {
        panner.positionX.value = p.x ?? 0;
        panner.positionY.value = p.y ?? 0;
        panner.positionZ.value = p.z ?? 0;
      } else if (panner.setPosition) {
        panner.setPosition(p.x ?? 0, p.y ?? 0, p.z ?? 0);
      }
      return { dry: panner, isPanner: true };
    }
    return { dry: sfxLayer };
  }

  function footstep(opts = {}) {
    const surface = SURFACES[opts.surface] ?? SURFACES.gravel;
    const speed = Math.max(0.2, Math.min(2.0, opts.speed ?? 1.0)); // 1.0 = walk, >1 = run
    const dest = destFor(opts);
    footToggle *= -1;

    const jitter = rngGauss();
    const freq = surface.freq * (1 + jitter * 0.18);
    const decay = surface.decay * (1.15 - 0.25 * speed) * (1 + rng() * 0.15);
    const gain = (0.22 + 0.14 * (speed - 0.5)) * (opts.volume ?? 1);

    noiseHit(actx, {
      buffer: stepBuf, start: actx.currentTime, attack: 0.002, decay,
      gain: Math.max(0.05, gain), filterType: 'bandpass', filterFreq: Math.max(200, freq),
      filterQ: surface.q, playbackRate: 0.9 + rng() * 0.25,
      pan: dest.isPanner ? 0 : footToggle * (0.12 + rng() * 0.1),
      bus: dest, send: 0,
    });
    // A faint low knock layered under harder/faster steps sells weight without a sample.
    if (speed > 1.1) {
      noiseHit(actx, {
        buffer: thumpBuf, start: actx.currentTime, attack: 0.002, decay: decay * 1.4,
        gain: 0.08 * speed, filterType: 'lowpass', filterFreq: 220, filterQ: 0.6,
        pan: dest.isPanner ? 0 : footToggle * 0.1, bus: dest, send: 0,
      });
    }
  }

  function landing(opts = {}) {
    const hard = opts.hard ?? false;
    const dest = destFor(opts);
    noiseHit(actx, {
      buffer: thumpBuf, start: actx.currentTime, attack: 0.003, decay: hard ? 0.22 : 0.14,
      gain: (hard ? 0.55 : 0.38) * (opts.volume ?? 1), filterType: 'lowpass',
      filterFreq: hard ? 180 : 240, filterQ: 0.6, pan: 0, bus: dest, send: 0,
    });
    tone(actx, {
      type: 'sine', freq: hard ? 80 : 110, start: actx.currentTime,
      attack: 0.002, decay: 0.12, sustain: 0.3, release: hard ? 0.35 : 0.2,
      sustainSeconds: 0.02, gain: (hard ? 0.3 : 0.18) * (opts.volume ?? 1),
      filterType: 'lowpass', filterFreq: 400, filterQ: 0.3, pan: 0, bus: dest, send: 0,
    });
  }

  function interact(opts = {}) {
    const dest = destFor(opts);
    toneSweep(actx, {
      type: 'triangle', freqStart: 520, freqEnd: 880, start: actx.currentTime,
      dur: 0.08, attack: 0.006, release: 0.09, gain: 0.22 * (opts.volume ?? 1),
      filterFreq: 3200, pan: 0, bus: dest, send: 0,
    });
  }

  function dialogueAdvance(opts = {}) {
    const dest = destFor(opts);
    noiseHit(actx, {
      buffer: tickBuf, start: actx.currentTime, attack: 0.001, decay: 0.025,
      gain: 0.14 * (opts.volume ?? 1), filterType: 'highpass', filterFreq: 2800,
      filterQ: 0.5, pan: 0, bus: dest, send: 0,
    });
  }

  const HANDLERS = { footstep, landing, interact, confirm: interact, dialogueAdvance };

  function play(id, opts) {
    const fn = HANDLERS[id];
    if (fn) fn(opts);
  }

  return { play, ids: () => Object.keys(HANDLERS) };
}
