/**
 * Macrion ambience bed — continuous, evolving, driven entirely by world state.
 *
 * Wind (body + hiss) is always present and tracks weather.wind (0.35 clear to
 * 1.00 storm). Thunder rolls in under storm. Insects rise at dusk, birds at
 * dawn, and the whole bed thins to near-silence at night. Everything here is
 * generated noise/oscillators — no recordings.
 */
import { NIGHT_CURVE, DAWN_CURVE, DUSK_CURVE, sampleDayCurve } from './score.js';
import { createNoiseBuffer, toneSweep, noiseHit, toBus, rng } from './synth.js';

function makeLayer(actx, bus, sendAmount) {
  const g = actx.createGain();
  g.gain.value = 0.0001;
  toBus(g, bus, sendAmount);
  return g;
}

export function createAmbienceEngine(actx, bus) {
  const windLayer = makeLayer(actx, bus, 0.12);
  const lifeLayer = makeLayer(actx, bus, 0.28); // birds/insects
  const thunderLayer = makeLayer(actx, bus, 0.5);
  // These two aggregate voices that already carry their own amount in their per-note
  // gain — the layer node itself just needs to be open, not state-modulated.
  lifeLayer.gain.value = 1.0;
  thunderLayer.gain.value = 1.0;

  // ---- Wind: two looping noise beds through filters, always running ----
  const windBodyBuf = createNoiseBuffer(actx, 8, 'brown');
  const windHissBuf = createNoiseBuffer(actx, 8, 'pink');

  const bodySrc = actx.createBufferSource();
  bodySrc.buffer = windBodyBuf; bodySrc.loop = true;
  const bodyFilter = actx.createBiquadFilter();
  bodyFilter.type = 'lowpass'; bodyFilter.frequency.value = 260; bodyFilter.Q.value = 0.3;
  const bodyGain = actx.createGain(); bodyGain.gain.value = 0.5;
  bodySrc.connect(bodyFilter); bodyFilter.connect(bodyGain); bodyGain.connect(windLayer);
  bodySrc.start();

  const hissSrc = actx.createBufferSource();
  hissSrc.buffer = windHissBuf; hissSrc.loop = true;
  const hissFilter = actx.createBiquadFilter();
  hissFilter.type = 'bandpass'; hissFilter.frequency.value = 2200; hissFilter.Q.value = 0.6;
  const hissGain = actx.createGain(); hissGain.gain.value = 0.25;
  hissSrc.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(windLayer);
  hissSrc.start();

  // Slow, semi-random gust modulation computed per-frame (cheap; no extra graph nodes).
  const gustPhase1 = rng() * Math.PI * 2;
  const gustPhase2 = rng() * Math.PI * 2;

  // ---- Thunder: stochastic, gated by storm intensity ----
  const thunderBuf = createNoiseBuffer(actx, 2.6, 'brown');
  let nextThunderCheck = -Infinity;

  function triggerThunder(stormAmt) {
    const now = actx.currentTime;
    const distant = rng() < 0.6; // most rolls read as distant
    const predelay = distant ? 0.15 + rng() * 0.4 : 0.02;
    const gain = (distant ? 0.35 : 0.6) * (0.6 + 0.4 * stormAmt);
    noiseHit(actx, {
      buffer: thunderBuf, start: now + predelay, attack: distant ? 0.4 : 0.05,
      decay: distant ? 2.2 : 1.4, gain, filterType: 'lowpass',
      filterFreq: distant ? 140 : 220, filterQ: 0.4,
      pan: (rng() - 0.5) * 1.6, playbackRate: 0.7 + rng() * 0.3,
      bus: { dry: thunderLayer }, send: 0,
    });
  }

  // ---- Birds (dawn) / insects (dusk): stochastic short chirps ----
  let nextBirdCheck = -Infinity;
  let nextInsectCheck = -Infinity;

  function birdChirp(amount) {
    const now = actx.currentTime;
    const base = 2200 + rng() * 1400;
    let t = now;
    const notes = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < notes; i++) {
      const up = rng() > 0.4;
      toneSweep(actx, {
        type: 'sine', freqStart: up ? base : base * 1.3, freqEnd: up ? base * 1.35 : base * 0.85,
        start: t, dur: 0.08 + rng() * 0.07, attack: 0.008, release: 0.06,
        gain: (0.10 + rng() * 0.06) * amount, filterFreq: 6000,
        pan: (rng() - 0.5) * 1.2, bus: { dry: lifeLayer }, send: 0,
      });
      t += 0.06 + rng() * 0.08;
    }
  }

  function insectChirr(amount) {
    const now = actx.currentTime;
    const base = 4200 + rng() * 900;
    let t = now;
    const pulses = 5 + Math.floor(rng() * 6);
    for (let i = 0; i < pulses; i++) {
      toneSweep(actx, {
        type: 'triangle', freqStart: base, freqEnd: base * (0.97 + rng() * 0.06),
        start: t, dur: 0.03, attack: 0.004, release: 0.02,
        gain: (0.05 + rng() * 0.04) * amount, filterFreq: 7000,
        pan: (rng() - 0.5) * 1.0, bus: { dry: lifeLayer }, send: 0,
      });
      t += 0.045 + rng() * 0.02;
    }
  }

  function update(ctx) {
    const now = actx.currentTime;
    const hour = ctx.hour ?? 12;
    const weather = ctx.weather ?? {};
    const wind = weather.wind ?? 0.35;
    const precip = weather.precip ?? 0;
    const windAmt = Math.max(0, Math.min(1, (wind - 0.35) / 0.65)); // 0 clear .. 1 storm

    const night = sampleDayCurve(hour, NIGHT_CURVE);
    const dawn = sampleDayCurve(hour, DAWN_CURVE);
    const dusk = sampleDayCurve(hour, DUSK_CURVE);

    // Wind body/hiss track weather.wind directly (0.35 clear -> 1.0 storm).
    const t = now;
    const gust1 = Math.sin(now * 0.09 + gustPhase1) * 0.5 + 0.5;
    const gust2 = Math.sin(now * 0.031 + gustPhase2) * 0.5 + 0.5;
    const gust = 0.75 + 0.25 * gust1 * gust2;

    const windOverall = (0.16 + 0.85 * wind) * gust;
    windLayer.gain.setTargetAtTime(windOverall * (1 - 0.2 * night), t, 0.4);
    bodyFilter.frequency.setTargetAtTime(180 + 420 * windAmt, t, 1.0);
    hissFilter.frequency.setTargetAtTime(1400 + 2600 * windAmt, t, 1.0);
    hissGain.gain.setTargetAtTime(0.15 + 0.35 * windAmt, t, 0.6);

    // Thunder: only rolls under real storm weight, cadence scales with intensity.
    const stormAmt = Math.max(windAmt, precip);
    if (stormAmt > 0.35 && now >= nextThunderCheck) {
      nextThunderCheck = now + 2.0 + rng() * 4.0;
      if (rng() < 0.35 + 0.5 * stormAmt) triggerThunder(stormAmt);
    } else if (stormAmt <= 0.35) {
      nextThunderCheck = Math.max(nextThunderCheck, now + 1.0);
    }

    // Dawn birds / dusk insects — near-silent outside their windows, silent at night.
    if (dawn > 0.05 && now >= nextBirdCheck) {
      nextBirdCheck = now + (1.2 + rng() * 2.5) / Math.max(0.15, dawn);
      if (rng() < 0.5 * dawn) birdChirp(dawn);
    }
    if (dusk > 0.05 && now >= nextInsectCheck) {
      nextInsectCheck = now + (0.8 + rng() * 1.6) / Math.max(0.15, dusk);
      if (rng() < 0.6 * dusk) insectChirr(dusk);
    }
    // Insects also carry lightly through full night (basin nightlife), fading toward dawn.
    if (night > 0.6 && dusk < 0.05 && now >= nextInsectCheck) {
      nextInsectCheck = now + 2.5 + rng() * 3.5;
      if (rng() < 0.18 * night) insectChirr(night * 0.35);
    }
  }

  return { update, windLayer, lifeLayer, thunderLayer };
}
