/**
 * Macrion — Sarah's motif. The emotional spine of the score (docs/STORY.md).
 *
 * "Oz hears haunting, beautiful music from an apparition — Sarah, held
 * captive. He falls in love instantly. That music is the player's emotional
 * compass for the entire game." One melodic idea (SARAH_THEME in score.js),
 * four arrangements of it:
 *
 *   apparition — first hearing. Slow, fragile, high reverb, solo voice.
 *   memory     — returns, transformed, at major story beats. A little fuller.
 *   ghost      — a half-heard fragment woven into the `explore` bed near
 *                story locations. Buried, filtered, almost imagined.
 *   wedding    — the ending. Full, warm, harmonized resolution.
 *
 * The voice itself is a soft sine core with breathy upper partials and a
 * slow vibrato that eases in after the note has already spoken — the
 * synthesized equivalent of a held, wordless vocal line or a distant flute
 * (Oz's own flute, unknowingly answered).
 */
import { SARAH_THEME, SARAH_WEDDING_HARMONY, SARAH_TEMPO, degreeToFreq } from './score.js';
import { tone, toBus, rng } from './synth.js';

export function createSarahMotif(actx, bus) {
  // Dedicated layer with a much larger reverb send than anything else in the
  // score — she is an apparition; her voice should sound like it is arriving
  // from somewhere else, not standing in the room with the rest of the mix.
  const layer = actx.createGain();
  layer.gain.value = 1.0;
  toBus(layer, bus, 0.55);

  let storyProximity = 0; // 0..1 — set via setStoryProximity(); drives ghost frequency in explore
  let nextGhostCheck = -Infinity;

  function voiceSpec(freq, start, dur, vel, { breathy = true, filterFreq = 3200, gainMul = 1 } = {}) {
    return {
      type: 'sine', freq, start,
      attack: 0.35, decay: 0.4, sustain: 0.75, release: 1.4,
      sustainSeconds: Math.max(0.1, dur - 0.9),
      gain: vel * 0.3 * gainMul,
      filterType: 'lowpass', filterFreq, filterQ: 0.3,
      partials: breathy
        ? [{ ratio: 2, gainMul: 0.14, type: 'triangle' }, { ratio: 3, gainMul: 0.05, type: 'sine' }]
        : [{ ratio: 2, gainMul: 0.22, type: 'sine' }],
      vibrato: { rate: 4.6, depth: 7, delay: 0.5 },
      pan: 0,
      bus: { dry: layer }, send: 0,
    };
  }

  /** Play the full theme once. Returns its duration in seconds. */
  function playTheme({ tempo, gainMul = 1, filterFreq = 3200, harmonize = false, breathy = true, startDelay = 0.05 }) {
    const start0 = actx.currentTime + startDelay;
    const secPerBeat = 60 / tempo;
    let t = start0;
    for (const note of SARAH_THEME) {
      const dur = note.dur * secPerBeat;
      tone(actx, voiceSpec(degreeToFreq(note.deg, note.oct), t, dur, note.vel, { breathy, filterFreq, gainMul }));
      t += dur;
    }
    const totalDur = t - start0;
    if (harmonize) {
      // Warm open-position pad sustained under the whole phrase — the "full
      // arrangement" that only plays at the wedding.
      for (const deg of SARAH_WEDDING_HARMONY) {
        tone(actx, {
          type: 'triangle', freq: degreeToFreq(deg, 0), start: start0,
          attack: 1.5, decay: 1.0, sustain: 0.7, release: 3.0,
          sustainSeconds: Math.max(0.5, totalDur - 2.0),
          gain: 0.14 * gainMul, filterType: 'lowpass', filterFreq: 1600, filterQ: 0.25,
          pan: (deg % 3 - 1) * 0.3,
          bus: { dry: layer }, send: 0,
        });
      }
    }
    return totalDur;
  }

  /** First hearing — the apparition on the mainland. Sparse, fragile, quiet. */
  function playApparition() {
    return playTheme({ tempo: SARAH_TEMPO.apparition, gainMul: 0.85, filterFreq: 2600, breathy: true });
  }

  /** Returns, transformed, at a major story beat. `intensity` (0..1) — later
   * beats can play it a little fuller/louder than earlier ones. */
  function playMemory(intensity = 0.7) {
    const amt = Math.max(0, Math.min(1, intensity));
    return playTheme({ tempo: SARAH_TEMPO.memory, gainMul: 0.6 + 0.5 * amt, filterFreq: 3600, breathy: true });
  }

  /** The wedding — full, warm, harmonized resolution. The theme's answer. */
  function playWedding() {
    return playTheme({ tempo: SARAH_TEMPO.wedding, gainMul: 1.15, filterFreq: 5200, harmonize: true, breathy: false });
  }

  /** A ghost of the motif: 2-4 consecutive notes from a random point in the
   * phrase (always a contiguous slice, so it still reads as "part of" the
   * theme), an octave down, heavily filtered and quiet. Never the whole tune. */
  function playGhostFragment() {
    const start0 = actx.currentTime + 0.05;
    const secPerBeat = 60 / SARAH_TEMPO.ghost;
    const len = 2 + Math.floor(rng() * 3);
    const startIdx = Math.floor(rng() * Math.max(1, SARAH_THEME.length - len));
    let t = start0;
    for (let i = 0; i < len; i++) {
      const note = SARAH_THEME[(startIdx + i) % SARAH_THEME.length];
      const dur = note.dur * secPerBeat;
      const freq = degreeToFreq(note.deg, note.oct - 1); // an octave down — distant, half-remembered
      tone(actx, voiceSpec(freq, t, dur, note.vel * 0.4, { breathy: true, filterFreq: 900, gainMul: 0.5 }));
      t += dur;
    }
    return t - start0;
  }

  function setStoryProximity(v) { storyProximity = Math.max(0, Math.min(1, v)); }
  function getStoryProximity() { return storyProximity; }

  /** Call every frame while state === 'explore'. Cheap — a timer check on
   * most frames, an actual phrase only every 20-70s and only near story
   * locations (storyProximity > 0). */
  function update(isExploreState) {
    if (!isExploreState || storyProximity <= 0.02) return;
    const now = actx.currentTime;
    if (now < nextGhostCheck) return;
    nextGhostCheck = now + (18 + rng() * 40) / Math.max(0.15, storyProximity);
    if (rng() < 0.35 + 0.4 * storyProximity) playGhostFragment();
  }

  return {
    playApparition, playMemory, playWedding, playGhostFragment,
    setStoryProximity, getStoryProximity,
    update, layer,
  };
}
