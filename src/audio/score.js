/**
 * Macrion score — DATA, not code. Scales, motifs, chord movement live here as
 * plain arrays/objects so a later level is authored (new data file) rather
 * than re-engineered (new player logic). music.js is the only thing that
 * interprets this data.
 *
 * Key: D Dorian. Dorian (minor with a natural 6th) reads as modal/folk and
 * open rather than sad-minor — a good fit for "vast arid highland, sense of
 * solitude" without tipping into film-score melodrama.
 */

export const ROOT_HZ = 73.416; // D2
export const SCALE = [0, 2, 3, 5, 7, 9, 10]; // Dorian semitone offsets

/** degree -> Hz. degree/octave both wrap correctly for negative values. */
export function degreeToFreq(degree, octave = 0, root = ROOT_HZ, scale = SCALE) {
  const len = scale.length;
  const idx = ((degree % len) + len) % len;
  const octShift = Math.floor(degree / len) + octave;
  const semitone = scale[idx] + octShift * 12;
  return root * Math.pow(2, semitone / 12);
}

/**
 * Slow harmonic movement shared by drone + pad. Each chord is a list of scale
 * degrees (root/3rd/5th-ish, modal so "3rd" is loose) and a hold length in bars.
 * Cycles. This is the one progression the whole score breathes around.
 */
export const PROGRESSION = [
  { degrees: [0, 2, 4], bars: 8 },   // i  (Dm9-ish)
  { degrees: [-3, -1, 2], bars: 6 }, // subdominant below tonic — open, wide
  { degrees: [3, 5, 0], bars: 8 },   // iv
  { degrees: [4, 6, 1], bars: 6 },   // v (modal, unresolved — no leading tone)
];

/** Fixed harmonic tempo — chord changes are independent of the melodic BPM
 * (which shifts with adaptive state) so harmony never lurches on a state change. */
export const HARMONY_BAR_SECONDS = 9;

/**
 * Sparse melodic figures per adaptive state. Each entry:
 *   deg   — absolute scale degree (Dorian degree index, wraps octaves)
 *   oct   — octave passed straight to degreeToFreq
 *   dur   — length in beats
 *   vel   — 0..1 velocity (peak gain multiplier)
 *   prob  — chance [0..1] this step actually sounds; otherwise it's a rest
 * Beats are consumed by music.js's sequencer at the current state's BPM.
 */
export const MOTIFS = {
  explore: [
    { deg: 0, oct: 1, dur: 4, vel: 0.55, prob: 0.9 },
    { deg: 2, oct: 1, dur: 3, vel: 0.4, prob: 0.6 },
    { deg: 4, oct: 1, dur: 5, vel: 0.5, prob: 0.75 },
    { deg: 2, oct: 1, dur: 2, vel: 0.35, prob: 0.4 },
    { deg: -1, oct: 1, dur: 4, vel: 0.42, prob: 0.55 },
    { deg: 0, oct: 2, dur: 6, vel: 0.5, prob: 0.65 },
    { deg: 4, oct: 0, dur: 4, vel: 0.38, prob: 0.35 },
    { deg: 7, oct: 1, dur: 5, vel: 0.45, prob: 0.5 },
  ],
  tension: [
    { deg: 0, oct: 1, dur: 2, vel: 0.5, prob: 0.85 },
    { deg: 1, oct: 1, dur: 1.5, vel: 0.55, prob: 0.6 }, // minor 2nd against root — unsettled
    { deg: 0, oct: 1, dur: 1, vel: 0.4, prob: 0.7 },
    { deg: 6, oct: 0, dur: 2, vel: 0.5, prob: 0.55 },
    { deg: 3, oct: 1, dur: 1.5, vel: 0.45, prob: 0.6 },
    { deg: 1, oct: 1, dur: 1, vel: 0.5, prob: 0.45 },
    { deg: -2, oct: 1, dur: 2, vel: 0.4, prob: 0.5 },
  ],
  combat: [
    { deg: 0, oct: 1, dur: 0.75, vel: 0.7, prob: 0.95 },
    { deg: 3, oct: 1, dur: 0.5, vel: 0.6, prob: 0.85 },
    { deg: 0, oct: 1, dur: 0.5, vel: 0.65, prob: 0.9 },
    { deg: 6, oct: 1, dur: 0.75, vel: 0.62, prob: 0.75 },
    { deg: 4, oct: 1, dur: 0.5, vel: 0.58, prob: 0.8 },
    { deg: 0, oct: 2, dur: 1, vel: 0.68, prob: 0.7 },
    { deg: 1, oct: 1, dur: 0.5, vel: 0.55, prob: 0.6 },
    { deg: 3, oct: 1, dur: 0.5, vel: 0.6, prob: 0.85 },
  ],
  resolve: [
    { deg: 0, oct: 1, dur: 1.5, vel: 0.6, prob: 1.0 },
    { deg: 2, oct: 1, dur: 1.5, vel: 0.58, prob: 1.0 },
    { deg: 4, oct: 1, dur: 1.5, vel: 0.6, prob: 1.0 },
    { deg: 7, oct: 1, dur: 3, vel: 0.65, prob: 1.0 },
    { deg: 4, oct: 1, dur: 2, vel: 0.5, prob: 0.8 },
    { deg: 0, oct: 2, dur: 4, vel: 0.55, prob: 0.9 },
  ],
};

/** Tempo per state, in BPM (beats consumed from MOTIFS above). */
export const STATE_BPM = {
  explore: 46,
  tension: 58,
  combat: 108,
  resolve: 52,
};

/** Target layer gains per state. music.js smooths toward these on setState(). */
export const STATE_LAYER_GAINS = {
  explore: { drone: 0.5, pad: 0.34, melody: 0.4, perc: 0.0, resolve: 0.0 },
  tension: { drone: 0.62, pad: 0.24, melody: 0.32, perc: 0.16, resolve: 0.0 },
  combat: { drone: 0.5, pad: 0.06, melody: 0.18, perc: 0.55, resolve: 0.0 },
  resolve: { drone: 0.4, pad: 0.46, melody: 0.34, perc: 0.0, resolve: 0.55 },
};

/** One-shot resolve/quest-complete cue: a short rising arpeggio + bell tone. */
export const RESOLVE_CUE = [
  { deg: 0, oct: 1, dur: 0.5, vel: 0.5 },
  { deg: 2, oct: 1, dur: 0.5, vel: 0.55 },
  { deg: 4, oct: 1, dur: 0.5, vel: 0.6 },
  { deg: 7, oct: 1, dur: 1.5, vel: 0.7 },
];

/** Quest-accept sting: short, two notes, brighter register. */
export const ACCEPT_CUE = [
  { deg: 4, oct: 1, dur: 0.4, vel: 0.5 },
  { deg: 7, oct: 1, dur: 0.9, vel: 0.6 },
];

/** Combat percussion pattern — one 4-beat bar, looped. `type` picks the timbre in music.js. */
export const PERC_PATTERN = [
  { at: 0, type: 'low', vel: 0.9 },
  { at: 1, type: 'hi', vel: 0.4 },
  { at: 2, type: 'low', vel: 0.7 },
  { at: 2.5, type: 'hi', vel: 0.5 },
  { at: 3, type: 'hi', vel: 0.35 },
];
export const PERC_BAR_BEATS = 4;

/**
 * Piecewise key-framed curve sampled over the 24h clock, wrapping at 24->0.
 * Used for night/dawn/dusk amounts. Points must be sorted by hour.
 */
export function sampleDayCurve(hour, points) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < points.length; i++) {
    const [h0, v0] = points[i];
    const [h1, v1] = points[(i + 1) % points.length];
    const span = (h1 - h0 + 24) % 24 || 24;
    const dh = (h - h0 + 24) % 24;
    if (dh <= span) return v0 + (v1 - v0) * (dh / span);
  }
  return points[0][1];
}

/** 1 at deep night, 0 in full day. */
export const NIGHT_CURVE = [
  [0, 1], [4, 1], [6, 0.55], [8, 0.05], [17, 0.05], [19, 0.35], [21, 0.8], [23, 1],
];

/** Bell curve of "dawn" presence for birdsong, peaking ~6:30. */
export const DAWN_CURVE = [
  [0, 0], [4.5, 0], [5.5, 0.4], [6.5, 1], [7.5, 0.6], [9, 0.05], [24, 0],
];

/** Bell curve of "dusk" presence for insects, peaking ~19:30. */
export const DUSK_CURVE = [
  [0, 0], [17.5, 0], [18.5, 0.5], [19.5, 1], [20.5, 0.6], [22, 0.05], [24, 0],
];
