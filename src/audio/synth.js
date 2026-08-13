/**
 * Macrion audio synthesis toolkit — OWNED BY AUDIO builder.
 *
 * Everything here is generated at runtime with the Web Audio API: oscillator
 * voices, ADSR envelopes, filters, noise buffers we fill ourselves, and a
 * convolution reverb whose impulse response is procedurally synthesized
 * (no recorded IRs, no samples, no files).
 *
 * This module is pure DSP plumbing — no music theory, no world-state logic.
 * See score.js for composition data and music.js/ambience.js/sfx.js for the
 * systems that use this toolkit.
 */
import * as THREE from 'three';
import { makeRNG } from '../core/engine.js';

/** Deterministic RNG dedicated to audio synthesis (buffer fills, humanization). */
const audioRNG = makeRNG(0xA0D10 ^ 1337);

export function rng() { return audioRNG(); }

/** rng() shifted to roughly Gaussian via a 3-tap sum — cheap, avoids Box-Muller edge cases. */
export function rngGauss() {
  return ((audioRNG() + audioRNG() + audioRNG()) / 3 - 0.5) * 2;
}

// ---------------------------------------------------------------------------
// Noise buffers
// ---------------------------------------------------------------------------

/**
 * Fill and return a mono AudioBuffer of noise.
 * kind: 'white' | 'pink' | 'brown'
 */
export function createNoiseBuffer(actx, seconds, kind = 'white') {
  const len = Math.max(1, Math.floor(actx.sampleRate * seconds));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = audioRNG() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet pink noise approximation.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = audioRNG() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      d[i] = pink * 0.11;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = audioRNG() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/**
 * Procedurally synthesized stereo convolution impulse response — a generated
 * "space", not a recorded one. Exponential-decay noise with a short diffuse
 * pre-tail and a longer basin-scale tail, decorrelated per channel for width.
 */
export function createImpulseResponse(actx, seconds = 3.2, decay = 3.0) {
  const len = Math.max(1, Math.floor(actx.sampleRate * seconds));
  const buf = actx.createBuffer(2, len, actx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      d[i] = (audioRNG() * 2 - 1) * env;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Master bus — gain staging + limiter + reverb send
// ---------------------------------------------------------------------------

/**
 * Builds the shared output bus: dry path and a reverb send, both through a
 * brick-wall-ish compressor before destination, plus a master trim so the
 * sum of all layers can never realistically clip.
 */
export function createMasterBus(actx) {
  const dry = actx.createGain();
  dry.gain.value = 1.0;

  const sendGain = actx.createGain();
  sendGain.gain.value = 1.0;

  const convolver = actx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = createImpulseResponse(actx, 3.4, 2.6);

  const wetReturn = actx.createGain();
  wetReturn.gain.value = 0.55;

  const trim = actx.createGain();
  trim.gain.value = 0.7; // headroom: sum of layers is kept well under 1.0 pre-compressor

  const limiter = actx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  const masterGain = actx.createGain();
  masterGain.gain.value = 0.85;

  dry.connect(trim);
  sendGain.connect(convolver);
  convolver.connect(wetReturn);
  wetReturn.connect(trim);
  trim.connect(limiter);
  limiter.connect(masterGain);
  masterGain.connect(actx.destination);

  return {
    dry,        // connect voices here for direct signal
    send: sendGain, // connect voices here (or a per-voice send gain) for reverb
    masterGain,
    setVolume(v) { masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), actx.currentTime, 0.05); },
  };
}

/** Convenience: connect a node to both dry and a reverb send at a given send level (0..1). */
export function toBus(node, bus, sendAmount = 0.25) {
  node.connect(bus.dry);
  if (sendAmount > 0) {
    const send = node.context.createGain();
    send.gain.value = sendAmount;
    node.connect(send);
    send.connect(bus.send);
  }
}

/**
 * Build a 3D PannerNode (HRTF) for a world-space one-shot. Kept as a plain
 * helper (not a persistent wrapper) so callers can fold it into a voice's own
 * disposal timer instead of leaking a node per play — see tone()/noiseHit()/
 * toneSweep() `position` option below, which is the supported path. The
 * standalone createPositional() export remains for callers that manage their
 * own node lifetime.
 */
function make3DPanner(actx, pos = {}) {
  const p = actx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 2;
  p.maxDistance = 200;
  p.rolloffFactor = 1.1;
  if (p.positionX) {
    p.positionX.value = pos.x ?? 0;
    p.positionY.value = pos.y ?? 0;
    p.positionZ.value = pos.z ?? 0;
  } else if (p.setPosition) {
    p.setPosition(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

/**
 * Schedule an ADSR envelope on a GainNode's gain param starting at `start`.
 * If `sustainSeconds` is finite, decay->sustain->release happens automatically;
 * pass Infinity for a held note and call `release(gainNode, t)` later.
 */
export function scheduleEnvelope(gainParam, {
  start, attack = 0.01, decay = 0.15, sustain = 0.6, release = 0.4,
  peak = 1, sustainSeconds = 1.0,
}) {
  const a = Math.max(0.002, attack);
  const d = Math.max(0.001, decay);
  const r = Math.max(0.01, release);
  gainParam.cancelScheduledValues(start);
  gainParam.setValueAtTime(0.0001, start);
  gainParam.linearRampToValueAtTime(peak, start + a);
  const sustainLevel = Math.max(0.0001, peak * sustain);
  gainParam.linearRampToValueAtTime(sustainLevel, start + a + d);
  if (Number.isFinite(sustainSeconds)) {
    const relStart = start + a + d + Math.max(0, sustainSeconds);
    gainParam.setValueAtTime(sustainLevel, relStart);
    gainParam.exponentialRampToValueAtTime(0.0001, relStart + r);
    return relStart + r;
  }
  return null; // caller must release() manually
}

export function releaseEnvelope(gainParam, at, release = 0.5) {
  const now = at;
  gainParam.cancelScheduledValues(now);
  const cur = Math.max(0.0001, gainParam.value);
  gainParam.setValueAtTime(cur, now);
  gainParam.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, release));
}

// ---------------------------------------------------------------------------
// Oscillator voice (tone) — melodic / pad / drone material
// ---------------------------------------------------------------------------

/**
 * Play a tone. Supports extra inharmonic/harmonic partials for bell/metallic
 * timbres. Auto-disposes all nodes on envelope completion.
 *
 * spec: {
 *   type, freq, detune=0, start, attack, decay, sustain, release, sustainSeconds,
 *   gain=0.3, filterType='lowpass', filterFreq=2000, filterQ=0.4,
 *   pan=0, position={x,y,z} (3D — overrides pan, HRTF), partials=[{ratio,gainMul,type}],
 *   vibrato={rate=5,depth=6,delay=0.25} (cents of detune modulation, for expressive/vocal
 *     lines — used sparingly; most SFX and pads omit it), bus, send=0.25,
 * }
 * Returns { stop(atTime), gainNode, endTime }.
 */
export function tone(actx, spec) {
  const {
    type = 'sine', freq = 220, detune = 0, start = actx.currentTime,
    attack = 0.02, decay = 0.2, sustain = 0.6, release = 0.6, sustainSeconds = 0.6,
    gain = 0.25, filterType = 'lowpass', filterFreq = 4000, filterQ = 0.3,
    pan = 0, position = null, partials = [], vibrato = null, bus, send = 0.25,
  } = spec;

  const g = actx.createGain();
  g.gain.value = 0.0001;

  const filter = actx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  const panner = position
    ? make3DPanner(actx, position)
    : (actx.createStereoPanner ? actx.createStereoPanner() : null);
  if (!position && panner) panner.pan.value = Math.max(-1, Math.min(1, pan));

  // Optional vibrato LFO: one shared low-frequency oscillator modulating every
  // partial's detune (cents) after a short delay (real vibrato eases in, it
  // doesn't start on the attack). Cleaned up alongside the rest of the voice.
  let lfo = null, lfoGain = null;
  const oscs = [];
  const mkOsc = (f, det, oscType, ampMul) => {
    const o = actx.createOscillator();
    o.type = oscType;
    o.frequency.value = f;
    o.detune.value = det;
    const og = actx.createGain();
    og.gain.value = ampMul;
    o.connect(og);
    og.connect(filter);
    o.start(start);
    oscs.push(o);
    return o;
  };

  mkOsc(freq, detune, type, 1.0);
  for (const p of partials) {
    mkOsc(freq * (p.ratio ?? 2), (p.detune ?? 0), p.type ?? type, p.gainMul ?? 0.3);
  }

  if (vibrato) {
    const { rate = 5, depth = 6, delay = 0.25 } = vibrato;
    lfo = actx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = rate;
    lfoGain = actx.createGain();
    lfoGain.gain.setValueAtTime(0, start);
    lfoGain.gain.linearRampToValueAtTime(depth, start + Math.max(0.02, delay));
    lfo.connect(lfoGain);
    for (const o of oscs) lfoGain.connect(o.detune);
    lfo.start(start);
  }

  filter.connect(g);
  if (panner) { g.connect(panner); toBus(panner, bus, send); }
  else { toBus(g, bus, send); }

  const endTime = scheduleEnvelope(g.gain, {
    start, attack, decay, sustain, release, peak: gain, sustainSeconds,
  });

  const stopAt = endTime ?? (start + 30);
  for (const o of oscs) o.stop(stopAt + 0.05);
  lfo?.stop(stopAt + 0.05);
  const cleanupDelay = Math.max(0, (stopAt + 0.1 - actx.currentTime)) * 1000;
  setTimeout(() => {
    try {
      filter.disconnect(); g.disconnect(); panner?.disconnect();
      lfo?.disconnect(); lfoGain?.disconnect();
    } catch { /* already gone */ }
  }, cleanupDelay + 50);

  return {
    gainNode: g,
    endTime,
    stop(atTime = actx.currentTime, releaseTime = 0.3) {
      releaseEnvelope(g.gain, atTime, releaseTime);
      for (const o of oscs) { try { o.stop(atTime + releaseTime + 0.05); } catch { /* already stopped */ } }
      try { lfo?.stop(atTime + releaseTime + 0.05); } catch { /* already stopped */ }
    },
  };
}

/**
 * A short pitch-swept tone — birdsong, cricket chirps, UI whooshes.
 * spec: { type, freqStart, freqEnd, start, dur=0.25, attack, release, gain,
 *   filterFreq, filterQ, pan, position={x,y,z}, bus, send }
 */
export function toneSweep(actx, spec) {
  const {
    type = 'sine', freqStart = 2000, freqEnd = 3000, start = actx.currentTime,
    dur = 0.25, attack = 0.015, release = 0.15, gain = 0.15,
    filterFreq = 6000, filterQ = 0.5, pan = 0, position = null, bus, send = 0.15,
  } = spec;

  const osc = actx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freqStart), start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + dur);

  const filter = actx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  const g = actx.createGain();
  g.gain.value = 0.0001;

  const panner = position
    ? make3DPanner(actx, position)
    : (actx.createStereoPanner ? actx.createStereoPanner() : null);
  if (!position && panner) panner.pan.value = Math.max(-1, Math.min(1, pan));

  osc.connect(filter);
  filter.connect(g);
  if (panner) { g.connect(panner); toBus(panner, bus, send); }
  else { toBus(g, bus, send); }

  const a = Math.max(0.005, attack);
  const r = Math.max(0.01, release);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + a);
  g.gain.setValueAtTime(gain, Math.max(start + a, start + dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur + r * 0.2);

  osc.start(start);
  const stopAt = start + dur + r * 0.2 + 0.05;
  osc.stop(stopAt);
  const cleanupDelay = Math.max(0, (stopAt + 0.05 - actx.currentTime)) * 1000;
  setTimeout(() => {
    try { osc.disconnect(); filter.disconnect(); g.disconnect(); panner?.disconnect(); } catch { /* gone */ }
  }, cleanupDelay + 50);

  return { endTime: stopAt };
}

// ---------------------------------------------------------------------------
// Noise-burst voice — footsteps, percussion, thunder, wind gusts
// ---------------------------------------------------------------------------

/**
 * spec: { buffer, start, attack, decay(=release), gain, filterType, filterFreq,
 *   filterQ, pan, position={x,y,z}, playbackRate=1, bus, send }
 */
export function noiseHit(actx, spec) {
  const {
    buffer, start = actx.currentTime, attack = 0.002, decay = 0.12,
    gain = 0.4, filterType = 'bandpass', filterFreq = 1200, filterQ = 0.8,
    pan = 0, position = null, playbackRate = 1, bus, send = 0.2,
  } = spec;

  const src = actx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;

  const filter = actx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  const g = actx.createGain();
  g.gain.value = 0.0001;

  const panner = position
    ? make3DPanner(actx, position)
    : (actx.createStereoPanner ? actx.createStereoPanner() : null);
  if (!position && panner) panner.pan.value = Math.max(-1, Math.min(1, pan));

  src.connect(filter);
  filter.connect(g);
  if (panner) { g.connect(panner); toBus(panner, bus, send); }
  else { toBus(g, bus, send); }

  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

  const offset = audioRNG() * Math.max(0, buffer.duration - (attack + decay + 0.05));
  src.start(start, Math.min(offset, Math.max(0, buffer.duration - 0.05)));
  const stopAt = start + attack + decay + 0.08;
  src.stop(stopAt);

  const cleanupDelay = Math.max(0, (stopAt + 0.05 - actx.currentTime)) * 1000;
  setTimeout(() => {
    try { src.disconnect(); filter.disconnect(); g.disconnect(); panner?.disconnect(); } catch { /* gone */ }
  }, cleanupDelay + 50);

  return { endTime: stopAt };
}

/**
 * 3D positional wrapper: routes a mono source through a PannerNode (HRTF).
 * Prefer the `position` option on tone()/noiseHit()/toneSweep() instead — that
 * path folds the panner into the voice's own disposal timer. This standalone
 * version returns a persistent node the caller must disconnect itself; kept
 * only for callers that genuinely need a long-lived positional bus.
 */
export function createPositional(actx, bus, send = 0.15) {
  const panner = actx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2;
  panner.maxDistance = 200;
  panner.rolloffFactor = 1.1;
  const g = actx.createGain();
  panner.connect(g);
  toBus(g, bus, send);
  return panner; // caller connects a source into this panner
}

/** Keep the WebAudio listener glued to the Three.js camera. Cheap; call every frame. */
export function updateListenerFromCamera(actx, camera) {
  if (!actx || !camera) return;
  const l = actx.listener;
  const p = camera.position;
  const fwd = _fwd, up = _up;
  fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  if (l.positionX) {
    const t = actx.currentTime;
    l.positionX.setTargetAtTime(p.x, t, 0.05);
    l.positionY.setTargetAtTime(p.y, t, 0.05);
    l.positionZ.setTargetAtTime(p.z, t, 0.05);
    l.forwardX.setTargetAtTime(fwd.x, t, 0.05);
    l.forwardY.setTargetAtTime(fwd.y, t, 0.05);
    l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
    l.upX.setTargetAtTime(up.x, t, 0.05);
    l.upY.setTargetAtTime(up.y, t, 0.05);
    l.upZ.setTargetAtTime(up.z, t, 0.05);
  } else if (l.setPosition) {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}
// Scratch vectors reused across frames — avoid per-frame allocation.
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
