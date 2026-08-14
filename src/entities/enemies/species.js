/**
 * Macrion — SNAGULA species table.  Owned by the Enemies builder.
 *
 * `docs/STORY.md`: the Snagulas are Sallenties' foot soldiers — man-sized,
 * GREEN, SHARP TEETH, RED EYES, several types. Everything below is data: one
 * generator (`build.js`) reads these dictionaries and produces the mesh, the
 * skeleton proportions and the shading. Adding a fourth type is a new entry
 * here, not new code.
 *
 * The family read comes from what is held CONSTANT: the hunched forward
 * carriage, the long forward-hanging arms, the wide fixed snarl with the same
 * tooth construction, the same recessed red eye under a heavy brow, and the
 * same hide shader. What varies is silhouette mass, height, limb ratio and hue.
 *
 * Colours are LINEAR albedos, not sRGB. Vegetation-grade green in linear space
 * is ~0.02-0.09 — anything near 0.5 renders as a glowing lime toy. The reason
 * the world's props file quotes 0.098 for rock is the same reason.
 */

/** Values every species inherits unless it overrides them. */
const BASE = {
  height: 1.74,          // crown-of-skull standing height, metres

  // ---- skeleton proportion dials (multipliers on the reused human rig) ----
  legLen: 0.88,          // <1 = squat, crouched carriage
  stance: 1.30,          // lateral leg separation
  shoulderW: 1.26,       // shoulder + arm lateral spread
  armLen: 1.20,          // arm chain length below the shoulder
  hunch: 0.32,           // radians the torso pitches forward about the hips
  headPitch: -0.26,      // radians the skull counter-pitches (lifts the muzzle)
  neckFwd: 0.055,        // metres the neck/head push forward of the spine
  neckDrop: 0.030,       // metres the neck/head drop (no upright human neck)
  tail: { len: 0.62, thick: 0.052, drop: 0.10 },

  // ---- mass dials (multipliers on the authored SDF) ----
  torsoW: 1.00, torsoD: 1.00,
  armGirth: 1.00, legGirth: 1.00,
  belly: 1.00,

  // ---- head ----
  headScale: 1.00,
  skullLen: 1.00,        // muzzle projection
  jawW: 1.00,
  jawOpen: 0.030,        // metres the lower jaw hangs — the permanent snarl
  browHeavy: 1.00,

  // ---- weapons ----
  teeth: { upper: 9, lower: 8, len: 0.034, w: 0.0070, tusk: 0.042, arc: 0.62 },
  claw: { len: 0.055, w: 0.011, count: 3 },
  spines: { count: 8, h: 0.090, r: 0.022, from: 0.26, to: 0.98 },
  horn: { len: 0.075, r: 0.022, sweep: 0.55 },

  // ---- eyes ----
  // Small, deep and only moderately hot. The first pass used r 0.024 with a
  // glow of 3.4 and ACES blew both eyes to a flat orange disc the size of a
  // fist — the brow shadow is what sells "glowing", not the emissive value.
  eye: { r: 0.0170, sep: 0.046, y: 0.044, z: 0.070, sink: 0.020, glow: 1.55 },

  // ---- shading ----
  hide:  [0.052, 0.086, 0.031],   // linear
  belly_c: [0.086, 0.098, 0.052],
  plate: [0.030, 0.036, 0.024],
  scaleFreq: 210,        // cycles/metre. See material.js — do not exceed ~330.
  hueJitter: 0.10,       // per-instance hue spread within the type

  // ---- animation / combat hints (the combat builder owns the actual AI) ----
  gait: { speedMul: 1.0, strideMul: 1.0, bob: 1.0 },
  combat: { health: 40, damage: 8, speed: 2.4, reach: 1.5 },

  // ---- meshing resolution per LOD (metres). Trap from heartbeats/oz-repair.md:
  // any SDF feature under ~2 cells disintegrates, so these bound the smallest
  // primitive the generator is allowed to author.
  lod: [
    { bodyRes: 0.0175, headRes: 0.0075, smooth: 2, project: 3, teethLOD: 1 },
    { bodyRes: 0.0360, headRes: 0.0165, smooth: 2, project: 2, teethLOD: 0 },
  ],
};

function derive(over) {
  const s = { ...BASE, ...over };
  for (const k of ['teeth', 'claw', 'spines', 'horn', 'eye', 'gait', 'combat', 'tail']) {
    s[k] = { ...BASE[k], ...(over[k] ?? {}) };
  }
  s.lod = BASE.lod.map((l) => ({ ...l }));
  return s;
}

export const SPECIES = {
  /**
   * GRUNT — the baseline foot soldier. Squat, barrel-chested, ape-armed.
   * The one the player meets first and fights most of.
   */
  grunt: derive({
    height: 1.66,
    legLen: 0.86, stance: 1.34, shoulderW: 1.30, armLen: 1.24,
    hunch: 0.46, headPitch: -0.22, neckDrop: 0.075, browHeavy: 0.85,
    torsoW: 1.08, torsoD: 1.06, armGirth: 1.06, legGirth: 1.04, belly: 1.12,
    headScale: 1.06, skullLen: 1.00, jawW: 1.06, jawOpen: 0.032,
    hide: [0.048, 0.082, 0.030], belly_c: [0.082, 0.094, 0.050],
    combat: { health: 40, damage: 8, speed: 2.5, reach: 1.5 },
  }),

  /**
   * STALKER — tall, starved and fast. Long shins, long claws, a narrow
   * elongated skull and a whipping tail. Reads instantly at silhouette
   * distance as "the quick one".
   */
  stalker: derive({
    height: 1.92,
    legLen: 1.06, stance: 1.14, shoulderW: 1.10, armLen: 1.34,
    hunch: 0.62, headPitch: -0.26, neckFwd: 0.105, neckDrop: 0.090,
    torsoW: 0.80, torsoD: 0.84, armGirth: 0.74, legGirth: 0.78, belly: 0.72,
    headScale: 0.92, skullLen: 1.34, jawW: 0.84, jawOpen: 0.040, browHeavy: 0.62,
    tail: { len: 0.92, thick: 0.040, drop: 0.06 },
    teeth: { upper: 11, lower: 10, len: 0.040, w: 0.0060, tusk: 0.030, arc: 0.70 },
    claw: { len: 0.082, w: 0.010, count: 3 },
    spines: { count: 11, h: 0.125, r: 0.020, from: 0.20, to: 1.00 },
    horn: { len: 0.105, r: 0.019, sweep: 0.75 },
    eye: { r: 0.0150, sep: 0.038, y: 0.040, z: 0.068, sink: 0.018, glow: 1.95 },
    hide: [0.062, 0.098, 0.026], belly_c: [0.098, 0.106, 0.044],
    scaleFreq: 250, hueJitter: 0.13,
    gait: { speedMul: 1.45, strideMul: 1.20, bob: 1.15 },
    combat: { health: 26, damage: 7, speed: 4.6, reach: 1.7 },
  }),

  /**
   * BRUTE — the heavy. Two metres of shoulder, almost no neck, tusks that
   * clear the upper lip, bone plates down the spine. Slow, and it should look
   * slow: the mass is in the top half so it reads top-heavy and dangerous.
   */
  brute: derive({
    height: 2.10,
    legLen: 0.80, stance: 1.52, shoulderW: 1.52, armLen: 1.30,
    hunch: 0.54, headPitch: -0.20, neckFwd: 0.030, neckDrop: 0.110,
    torsoW: 1.34, torsoD: 1.26, armGirth: 1.34, legGirth: 1.30, belly: 1.26,
    headScale: 1.22, skullLen: 0.92, jawW: 1.28, jawOpen: 0.036, browHeavy: 1.10,
    tail: { len: 0.46, thick: 0.070, drop: 0.14 },
    teeth: { upper: 8, lower: 7, len: 0.042, w: 0.0100, tusk: 0.078, arc: 0.58 },
    claw: { len: 0.066, w: 0.016, count: 3 },
    spines: { count: 9, h: 0.120, r: 0.034, from: 0.24, to: 0.96 },
    horn: { len: 0.130, r: 0.034, sweep: 0.40 },
    eye: { r: 0.0185, sep: 0.058, y: 0.046, z: 0.074, sink: 0.024, glow: 1.40 },
    hide: [0.036, 0.052, 0.028], belly_c: [0.060, 0.066, 0.044],
    plate: [0.052, 0.050, 0.038],
    scaleFreq: 170, hueJitter: 0.08,
    gait: { speedMul: 0.72, strideMul: 1.15, bob: 1.35 },
    combat: { health: 110, damage: 18, speed: 1.7, reach: 2.1 },
  }),
};

export const TYPES = Object.keys(SPECIES);
