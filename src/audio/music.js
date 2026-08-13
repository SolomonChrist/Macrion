/**
 * Macrion adaptive music engine.
 *
 * Reads composition DATA from score.js and plays it with the toolkit in
 * synth.js. Five always-alive layers (drone, pad, melody, perc, resolve) are
 * mixed by a per-layer gain node whose target value is set by the current
 * adaptive state and smoothly approached — states cross-fade, they never cut.
 *
 * The score also responds continuously to ctx.hour and ctx.weather: night
 * darkens the filter and thins the texture, storm brightens/thickens it and
 * speeds the pulse. These are continuous multipliers on top of the state
 * targets, recomputed every update() so day/night and weather sweep smoothly.
 */
import {
  ROOT_HZ, degreeToFreq, PROGRESSION, HARMONY_BAR_SECONDS,
  MOTIFS, STATE_BPM, STATE_LAYER_GAINS, RESOLVE_CUE, ACCEPT_CUE,
  PERC_PATTERN, PERC_BAR_BEATS, NIGHT_CURVE, sampleDayCurve,
} from './score.js';
import { tone, noiseHit, toBus, createNoiseBuffer, rng, rngGauss } from './synth.js';

const STATES = ['explore', 'tension', 'combat', 'resolve'];
const CROSSFADE_TC = 2.2; // seconds, setTargetAtTime time constant

function makeLayer(actx, bus, sendAmount) {
  const g = actx.createGain();
  g.gain.value = 0.0001;
  toBus(g, bus, sendAmount);
  return g;
}

export function createMusicEngine(actx, bus) {
  const layers = {
    drone: makeLayer(actx, bus, 0.30),
    pad: makeLayer(actx, bus, 0.45),
    melody: makeLayer(actx, bus, 0.32),
    perc: makeLayer(actx, bus, 0.10),
    resolve: makeLayer(actx, bus, 0.42),
  };

  let state = 'explore';
  let resolveHoldUntil = -Infinity; // resolve is a cue, auto-returns to explore after this

  // ---- Drone: persistent oscillators, re-pitched (not retriggered) on chord change ----
  const droneFilter = actx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 900;
  droneFilter.Q.value = 0.2;
  droneFilter.connect(layers.drone);

  function makeDroneVoice(type, ampMul, detune) {
    const osc = actx.createOscillator();
    osc.type = type;
    osc.frequency.value = ROOT_HZ;
    osc.detune.value = detune;
    const g = actx.createGain();
    g.gain.value = ampMul;
    osc.connect(g);
    g.connect(droneFilter);
    osc.start();
    return osc;
  }
  const droneVoices = {
    sub: makeDroneVoice('sine', 0.9, -3),
    root: makeDroneVoice('triangle', 0.55, 4),
    fifth: makeDroneVoice('triangle', 0.4, -5),
  };

  // ---- Harmony scheduler (progression) ----
  let chordIndex = 0;
  let nextChordTime = null;
  let currentChord = PROGRESSION[0];

  function retuneDrone(chord, when) {
    const glide = 2.5;
    const sub = degreeToFreq(chord.degrees[0], -1);
    const root = degreeToFreq(chord.degrees[0], 0);
    const fifth = degreeToFreq(chord.degrees[0] + 4, 0);
    droneVoices.sub.frequency.exponentialRampToValueAtTime(Math.max(20, sub), when + glide);
    droneVoices.root.frequency.exponentialRampToValueAtTime(Math.max(20, root), when + glide);
    droneVoices.fifth.frequency.exponentialRampToValueAtTime(Math.max(20, fifth), when + glide);
  }

  function playPadSwell(chord, start, holdSeconds) {
    // Skip if pad layer is essentially silent (combat) — saves a handful of nodes.
    for (const deg of chord.degrees) {
      const f = degreeToFreq(deg, 1);
      tone(actx, {
        type: 'triangle', freq: f, detune: rngGauss() * 5,
        start, attack: 2.6, decay: 1.2, sustain: 0.7, release: 3.0,
        sustainSeconds: Math.max(0.5, holdSeconds - 4.5),
        gain: 0.22, filterType: 'lowpass', filterFreq: 1400, filterQ: 0.25,
        pan: (deg % 3 - 1) * 0.25,
        bus: { dry: layers.pad }, send: 0,
      });
    }
  }

  // ---- Melody sequencer ----
  let melodyNextTime = null;
  let melodyStep = 0;
  const MELODY_LOOKAHEAD = 0.4;

  function scheduleMelodyStep(now) {
    const motif = MOTIFS[state === 'resolve' ? 'resolve' : state] ?? MOTIFS.explore;
    const step = motif[melodyStep % motif.length];
    const bpm = currentBPM();
    const secPerBeat = 60 / bpm;
    const dur = step.dur * secPerBeat;

    const rest = worldMod.melodyRestBoost;
    const willPlay = rng() < Math.max(0.05, Math.min(1, step.prob - rest));
    if (willPlay) {
      const f = degreeToFreq(step.deg, step.oct);
      tone(actx, {
        type: state === 'combat' ? 'sawtooth' : 'triangle',
        freq: f, detune: rngGauss() * 4,
        start: melodyNextTime, attack: state === 'combat' ? 0.01 : 0.04,
        decay: 0.25, sustain: 0.4, release: state === 'combat' ? 0.15 : 0.5,
        sustainSeconds: Math.max(0.05, dur - (state === 'combat' ? 0.2 : 0.6)),
        gain: step.vel * (state === 'combat' ? 0.32 : 0.24) * worldMod.melodyGainMul,
        filterType: 'lowpass', filterFreq: worldMod.brightness, filterQ: 0.4,
        pan: (rng() - 0.5) * 0.6,
        bus: { dry: layers.melody }, send: 0,
      });
    }
    melodyNextTime += dur;
    melodyStep++;
  }

  // ---- Percussion sequencer (combat) ----
  const percNoiseBuf = createNoiseBuffer(actx, 0.6, 'brown');
  let percNextTime = null;
  let percBeatCursor = 0;

  function schedulePercBar(now) {
    const bpm = currentBPM();
    const secPerBeat = 60 / bpm;
    for (const hit of PERC_PATTERN) {
      const t = percNextTime + hit.at * secPerBeat;
      if (hit.type === 'low') {
        noiseHit(actx, {
          buffer: percNoiseBuf, start: t, attack: 0.004, decay: 0.28,
          gain: hit.vel * 0.5, filterType: 'lowpass', filterFreq: 220, filterQ: 0.9,
          pan: 0, bus: { dry: layers.perc }, send: 0,
        });
      } else {
        tone(actx, {
          type: 'square', freq: 420 + rng() * 60, start: t,
          attack: 0.002, decay: 0.08, sustain: 0.01, release: 0.06, sustainSeconds: 0.02,
          gain: hit.vel * 0.16, filterType: 'highpass', filterFreq: 800, filterQ: 0.6,
          pan: (rng() - 0.5) * 0.5, bus: { dry: layers.perc }, send: 0,
        });
      }
    }
    percNextTime += PERC_BAR_BEATS * secPerBeat;
  }

  // ---- World modulation (hour + weather -> continuous DSP params) ----
  const worldMod = { brightness: 4200, melodyGainMul: 1, melodyRestBoost: 0, tempoMul: 1, droneDetuneMul: 1 };

  function currentBPM() {
    const base = STATE_BPM[state] ?? STATE_BPM.explore;
    return base * worldMod.tempoMul;
  }

  function applyWorldModulation(ctx) {
    const hour = ctx.hour ?? 12;
    const weather = ctx.weather ?? {};
    const night = sampleDayCurve(hour, NIGHT_CURVE); // 0..1
    const wind = weather.wind ?? 0.35;
    const storm = Math.max(0, Math.min(1, (wind - 0.35) / 0.65));

    const t = actx.currentTime;
    // Night: cooler (darker filter), sparser (more rests, lower gain), slightly slower.
    // Storm: brighter/denser, more detune/beating in the drone, slightly faster.
    const cutoff = 5200 * (1 - 0.55 * night) * (1 + 0.35 * storm);
    droneFilter.frequency.setTargetAtTime(Math.max(300, cutoff * 0.55), t, 3);
    worldMod.brightness = Math.max(600, cutoff);
    worldMod.melodyGainMul = (1 - 0.3 * night) * (1 + 0.15 * storm);
    worldMod.melodyRestBoost = 0.35 * night - 0.2 * storm;
    worldMod.tempoMul = (1 - 0.12 * night) * (1 + 0.22 * storm);
    worldMod.droneDetuneMul = 1 + storm * 3;

    droneVoices.root.detune.setTargetAtTime(4 * worldMod.droneDetuneMul, t, 2);
    droneVoices.fifth.detune.setTargetAtTime(-5 * worldMod.droneDetuneMul, t, 2);

    // Overall bed presence: night thins everything a little; storm thickens the drone.
    const nightTrim = 1 - 0.25 * night;
    const stormBoost = 1 + 0.2 * storm;
    layerTrim.night = nightTrim;
    layerTrim.storm = stormBoost;
  }
  const layerTrim = { night: 1, storm: 1 };

  // ---- State targets ----
  function applyStateTargets() {
    const targets = STATE_LAYER_GAINS[state] ?? STATE_LAYER_GAINS.explore;
    const t = actx.currentTime;
    const trim = layerTrim.night * layerTrim.storm;
    layers.drone.gain.setTargetAtTime(targets.drone * trim, t, CROSSFADE_TC);
    layers.pad.gain.setTargetAtTime(targets.pad * trim, t, CROSSFADE_TC);
    layers.melody.gain.setTargetAtTime(targets.melody, t, CROSSFADE_TC);
    layers.perc.gain.setTargetAtTime(targets.perc, t, CROSSFADE_TC);
    layers.resolve.gain.setTargetAtTime(targets.resolve, t, CROSSFADE_TC);
  }

  function setState(name) {
    if (!STATES.includes(name)) return;
    state = name;
    if (name === 'resolve') resolveHoldUntil = actx.currentTime + 7.0;
    applyStateTargets();
  }

  function playResolveCue() {
    const start = actx.currentTime + 0.05;
    let t = start;
    for (const step of RESOLVE_CUE) {
      const dur = step.dur; // fixed ~60bpm feel for the cue, independent of the current state's tempo
      tone(actx, {
        type: 'sine', freq: degreeToFreq(step.deg, step.oct), start: t,
        attack: 0.02, decay: 0.3, sustain: 0.6, release: 1.2, sustainSeconds: Math.max(0.2, dur - 0.3),
        gain: step.vel * 0.4, filterType: 'lowpass', filterFreq: 5000, filterQ: 0.3,
        partials: [{ ratio: 2.41, gainMul: 0.18, type: 'sine' }, { ratio: 3.9, gainMul: 0.08, type: 'sine' }],
        pan: 0, bus: { dry: layers.resolve }, send: 0,
      });
      t += dur;
    }
    setState('resolve');
  }

  function playAcceptCue() {
    const start = actx.currentTime + 0.05;
    let t = start;
    for (const step of ACCEPT_CUE) {
      tone(actx, {
        type: 'triangle', freq: degreeToFreq(step.deg, step.oct), start: t,
        attack: 0.015, decay: 0.2, sustain: 0.5, release: 0.6, sustainSeconds: Math.max(0.15, step.dur - 0.2),
        gain: step.vel * 0.32, filterType: 'lowpass', filterFreq: 4200, filterQ: 0.3,
        pan: 0.15, bus: { dry: layers.resolve }, send: 0,
      });
      t += step.dur;
    }
  }

  function update(ctx) {
    const now = actx.currentTime;
    applyWorldModulation(ctx);

    // Harmony
    if (nextChordTime === null) nextChordTime = now + 0.1;
    if (now + 0.5 >= nextChordTime) {
      currentChord = PROGRESSION[chordIndex % PROGRESSION.length];
      retuneDrone(currentChord, nextChordTime);
      if (state !== 'combat') playPadSwell(currentChord, nextChordTime, currentChord.bars * HARMONY_BAR_SECONDS);
      nextChordTime += currentChord.bars * HARMONY_BAR_SECONDS;
      chordIndex++;
    }

    // Melody
    if (melodyNextTime === null) melodyNextTime = now + 0.2;
    while (melodyNextTime < now + MELODY_LOOKAHEAD) scheduleMelodyStep(now);

    // Percussion — only run the scheduler while combat is actually audible.
    const percAudible = layers.perc.gain.value > 0.02 || state === 'combat';
    if (percAudible) {
      if (percNextTime === null || percNextTime < now - 1) percNextTime = now + 0.1;
      while (percNextTime < now + MELODY_LOOKAHEAD) schedulePercBar(now);
    } else {
      percNextTime = null;
    }

    // Auto-return from resolve back to explore once the cue has had its moment.
    if (state === 'resolve' && now > resolveHoldUntil) setState('explore');

    applyStateTargets();
  }

  return {
    update,
    setState,
    getState: () => state,
    cueResolve: playResolveCue,
    cueAccept: playAcceptCue,
    layers,
    states: STATES,
  };
}
