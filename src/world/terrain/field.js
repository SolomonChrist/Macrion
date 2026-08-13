/**
 * Macrion — the terrain height field.
 *
 * This is deliberately *composed*, not "fBm and hope". Along the `vista`
 * sightline (camera [-40,26,120] → [10,4,-320]) the field is authored to
 * produce four separated silhouette bands at increasing haze steps:
 *
 *   band          centre z    crest       distance from vista eye   apparent
 *   ------------  ---------   ---------   -----------------------   --------
 *   near ridge      -168       ~55 m            ~280 m               ~6.0 deg
 *   mid range       -625      ~175 m            ~720 m              ~11.7 deg
 *   far range      -1490      ~520 m           ~1620 m              ~16.9 deg
 *   backdrop       -2780      ~700 m           ~2820 m              ~13.5 deg
 *
 * The vista camera eye sits at y=26, so the frame runs -23.8 to +18.2 degrees:
 * every band lands inside it, ordered near-low to far-high, and the backdrop
 * falls *between* the mid and far bands in screen space so it shows through the
 * far range's saddles as a fourth, palest layer. Verified by walking the
 * sightline and recording where the visible horizon steps up.
 *
 * Flanking ranges close the world off to +X / -X / +Z so the `grazing`,
 * `overcast` and `topdown` poses never see a flat world edge.
 *
 * Everything is band-limited by `minWl` (minimum representable wavelength for
 * the LOD ring being built), which is what keeps distant rings from aliasing.
 */
import { createNoise2D, fbm, ridged, smoothstep, clamp01, smin } from './noise.js';
import { SEED } from '../../core/engine.js';

/** Half-extent of the generated world, metres. */
export const WORLD_EXTENT = 4096;

/**
 * Mountain bands. `axis` 0 = band measured along X (ridge line runs Z),
 * 1 = band measured along Z (ridge line runs X).
 */
const RANGES = [
  // ridge line runs east-west, in front of the vista camera
  { axis: 1, c: -168, w: 118, amp: 78, ex: 1.30, wob: 52, wobWl: 430, peakWl: 340, cwl: 300, cot: 5, base: 0.46, o: 11 },
  { axis: 1, c: -625, w: 275, amp: 215, ex: 1.45, wob: 115, wobWl: 950, peakWl: 640, cwl: 520, cot: 6, base: 0.40, o: 27 },
  { axis: 1, c: -1490, w: 480, amp: 720, ex: 1.55, wob: 195, wobWl: 1550, peakWl: 1020, cwl: 1050, cot: 6, base: 0.34, o: 43 },
  { axis: 1, c: -2780, w: 700, amp: 970, ex: 1.65, wob: 265, wobWl: 2050, peakWl: 1450, cwl: 1750, cot: 5, base: 0.34, o: 61 },
  // flanking walls
  { axis: 0, c: 1120, w: 500, amp: 540, ex: 1.45, wob: 210, wobWl: 1350, peakWl: 900, cwl: 880, cot: 6, base: 0.34, o: 79 },
  { axis: 0, c: -1180, w: 540, amp: 600, ex: 1.45, wob: 220, wobWl: 1450, peakWl: 960, cwl: 940, cot: 6, base: 0.34, o: 97 },
  // behind the camera
  { axis: 1, c: 1020, w: 440, amp: 430, ex: 1.45, wob: 185, wobWl: 1150, peakWl: 820, cwl: 780, cot: 5, base: 0.34, o: 113 },
];

/**
 * Poses whose Y is absolute world height. Terrain is soft-capped near these so
 * the camera can never end up buried, without stamping a flat table into the
 * landscape (see the smin below).
 */
const CLEARANCE = [
  { x: -40, z: 120, cap: 14, r: 45, slope: 0.44 },   // vista / dawn / night
  { x: -90, z: 60, cap: 5, r: 30, slope: 0.44 },     // grazing / overcast
  // ground-relative poses: the cap is not about burying the camera (their Y
  // follows the terrain) but about keeping an outcrop from growing up right in
  // front of the lens and eating the whole frame.
  { x: 12, z: 34, cap: 18, r: 30, slope: 0.50 },     // eye / storm
  { x: 0, z: 40, cap: 18, r: 30, slope: 0.50 },      // backlit
];

export function createField(seed = SEED) {
  const nWarpA = createNoise2D(seed + 101);
  const nWarpB = createNoise2D(seed + 211);
  const nBaseA = createNoise2D(seed + 307);
  const nBaseB = createNoise2D(seed + 401);
  const nBaseC = createNoise2D(seed + 509);
  const nCrest = createNoise2D(seed + 613);
  const nRelief = createNoise2D(seed + 727);
  const nWob = createNoise2D(seed + 829);
  const nPeak = createNoise2D(seed + 937);
  const nGully = createNoise2D(seed + 1049);
  const nMat = createNoise2D(seed + 1153);
  const nOut = createNoise2D(seed + 1289);

  /** Envelope of one band: 0 outside, 1 on the (meandering) crest line. */
  function bandEnvelope(r, u, along, minWl) {
    // cheap reject before touching noise
    if (Math.abs(u - r.c) > r.w + r.wob + 1) return 0;
    const wob = r.wob * nWob(along / r.wobWl + r.o, r.o * 0.37);
    const d = Math.abs(u - (r.c + wob)) / r.w;
    if (d >= 1) return 0;
    const t = smoothstep(1 - d);
    // summit / saddle modulation along the ridge so it isn't an extruded wall
    const pk = clamp01(0.22 + 1.05 * (0.5 + 0.5 * nPeak(along / r.peakWl + r.o * 1.7, r.o * 0.11)));
    void minWl;
    return Math.pow(t, r.ex) * pk;
  }

  /**
   * Terrain height in metres at world (x, z).
   * @param {number} minWl minimum feature wavelength to include (LOD band limit)
   */
  function height(x, z, minWl = 0.9) {
    // ---- domain warp: gives the fBm an eroded, flowing grain instead of blobs
    const wax = 150 * fbm(nWarpA, x, z, 1100, 3, minWl);
    const waz = 150 * fbm(nWarpB, x + 517, z - 231, 1100, 3, minWl);
    const wx = x + wax, wz = z + waz;

    // ---- broad landform. Kept deliberately gentle: the valley the cameras
    // stand in is a *floor*, and its job is to read as open ground with a
    // legible horizon. Piling ridged octaves in here turns the whole zone into
    // a uniform cone field, which reads as noise rather than landscape.
    let h = 19 * fbm(nBaseA, wx, wz, 1500, 3, minWl);
    h += 9.5 * fbm(nBaseB, wx, wz, 430, 4, minWl);
    // one broad ridged term for banks and shallow draws — 3 octaves only, so
    // its finest feature is ~65 m and it never becomes spiky
    h += 7.0 * (ridged(nRelief, wx + 2200, wz - 800, 260, 3, minWl, 0.58, 0.014) - 0.32);
    h += 2.4 * fbm(nBaseC, x - 3100, z + 2200, 62, 4, minWl);
    h += 0.85 * fbm(nBaseA, x + 8100, z - 6200, 9.5, 3, minWl);

    // ---- rock outcrops: deliberately *sparse* steep-sided knolls. These are
    // the only thing in the near field with a slope steep enough to expose the
    // rock layer, so they carry the material variety in the eye/storm shots —
    // but a high threshold keeps them occasional rather than a badlands.
    const oc = clamp01(ridged(nOut, x + 5000, z + 1200, 120, 3, minWl, 0.58, 0.010) * 2.4 - 1.30);
    h += oc * oc * 17;

    // ---- basin: the playable valley the cameras live in
    const bx = x + 25, bz = z - 45;
    const basin = Math.exp(-(bx * bx + bz * bz) / (2 * 260 * 260));
    h += 26 - 20 * basin;

    // ---- mountain bands
    for (let i = 0; i < RANGES.length; i++) {
      const r = RANGES[i];
      const u = r.axis === 0 ? x : z;
      const along = r.axis === 0 ? z : x;
      const env = bandEnvelope(r, u, along, minWl);
      if (env <= 0) continue;
      // each band gets its own crest wavelength so a 700 m range and a 90 m
      // ridge do not end up with identically-scaled crest detail
      let crest = ridged(nCrest, wx, wz, r.cwl, r.cot, minWl, 0.50, 0.006);
      crest = crest * (0.58 + 0.42 * crest);     // mild sharpen: deeper saddles
      h += r.amp * env * (r.base + (1 - r.base) * crest);
    }

    // ---- drainage. Two wavelengths: a broad one that separates massifs and a
    // finer one that cuts gullies into the flanks. Without the fine term the
    // ranges read as smooth symmetrical cones.
    if (h > 32) {
      const t = Math.min(1, (h - 32) / 110);
      const g1 = ridged(nGully, wx + 4000, wz - 1500, 300, 4, minWl, 0.55, 0.012);
      h -= (1 - g1) * t * (14 + 0.050 * h);
      const g2 = ridged(nGully, wx * 1.9 - 2600, wz * 1.9 + 700, 145, 4, minWl, 0.55, 0.012);
      h -= (1 - g2) * t * (7 + 0.022 * h);
    }

    // ---- clearance cap so the fixed-height cameras never end up inside a hill
    let cap = 1e9;
    for (let i = 0; i < CLEARANCE.length; i++) {
      const c = CLEARANCE[i];
      const dx = x - c.x, dz = z - c.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      const v = c.cap + c.slope * Math.max(0, dd - c.r);
      if (v < cap) cap = v;
    }
    h = smin(h, cap, 9);

    return h;
  }

  /** Low-frequency material/biome mask, 0..1 — used to break up layer blends. */
  function matMask(x, z) {
    return clamp01(0.5 + 0.75 * fbm(nMat, x, z, 240, 3, 0));
  }

  /** Exact, cheap sample used by the engine to place `ground: true` cameras. */
  function heightAt(x, z) { return height(x, z, 1.3); }

  return { height, heightAt, matMask, RANGES, WORLD_EXTENT };
}
