/**
 * Macrion — CPU noise kit for the terrain heightfield.
 * Hand-rolled 2D gradient (Perlin) noise seeded from the engine RNG.
 * No external noise libraries, no Math.random().
 */
import { makeRNG } from '../../core/engine.js';

/** 8-way gradient dot, scaled so the result lands in roughly [-1, 1]. */
function grad2(h, x, y) {
  switch (h & 7) {
    case 0: return  0.7071 * (x + y);
    case 1: return  0.7071 * (-x + y);
    case 2: return  0.7071 * (x - y);
    case 3: return  0.7071 * (-x - y);
    case 4: return  x;
    case 5: return -x;
    case 6: return  y;
    default: return -y;
  }
}

/** Deterministic 2D gradient noise in [-1, 1]. */
export function createNoise2D(seed) {
  const rng = makeRNG(seed >>> 0);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  return function noise2(x, y) {
    const fx = Math.floor(x), fy = Math.floor(y);
    const X = fx & 255, Y = fy & 255;
    const xf = x - fx, yf = y - fy;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const A = p[X] + Y, B = p[X + 1] + Y;
    const n00 = grad2(p[A], xf, yf);
    const n10 = grad2(p[B], xf - 1, yf);
    const n01 = grad2(p[A + 1], xf, yf - 1);
    const n11 = grad2(p[B + 1], xf - 1, yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  };
}

/**
 * Band-limited fBm. `wl` is the wavelength (world units) of octave 0.
 * Octaves whose wavelength falls below `minWl` are dropped — this is the
 * LOD anti-aliasing mechanism: coarse mesh rings simply lose the detail they
 * could not represent, instead of aliasing it into shimmering garbage.
 * Amplitude normalisation stays constant so the result is continuous in scale.
 */
export function fbm(n, x, z, wl, octaves, minWl = 0, gain = 0.5, lac = 2.0) {
  let sum = 0, amp = 1, norm = 0, w = wl;
  for (let i = 0; i < octaves; i++) {
    norm += amp;
    if (w >= minWl) sum += amp * n(x / w, z / w);
    amp *= gain;
    w /= lac;
  }
  return sum / norm;
}

/**
 * Ridged multifractal — the crest generator. Returns roughly [0, 1] with
 * ridge lines and eroded flanks (each octave is weighted by the previous one,
 * so detail concentrates on the crests, not in the valleys).
 *
 * `soft` rounds the |n| kink into sqrt(n^2 + soft). Plain ridged noise has a
 * derivative discontinuity exactly on every crest, which renders as a hard
 * crease between two smooth sheets — the terrain ends up looking like crumpled
 * cloth rather than eroded rock. A small soft term removes the crease while
 * keeping the ridge; mountains can use a smaller value than valley relief
 * because sharp summit crests are correct up there.
 */
export function ridged(n, x, z, wl, octaves, minWl = 0, gain = 0.58, soft = 0.02) {
  let sum = 0, amp = 1, norm = 0, w = wl, prev = 1;
  // renormalise: softening the kink also lowers the peak, and without this the
  // whole landform flattens as `soft` rises
  const pk = 1 - Math.sqrt(soft);
  const inv = 1 / (pk * pk);
  for (let i = 0; i < octaves; i++) {
    norm += amp;
    if (w >= minWl) {
      const s = n(x / w, z / w);
      let v = 1 - Math.sqrt(s * s + soft);
      v = v * v * inv;
      sum += amp * v * prev;
      prev = 0.30 + 0.70 * v;
    }
    amp *= gain;
    w /= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Polynomial smooth-min — used to cap terrain without leaving a flat table. */
export function smin(a, b, k) {
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return b * (1 - h) + a * h - k * h * (1 - h);
}
