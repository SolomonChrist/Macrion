/**
 * Macrion — the character.  "The Warden", an original design.
 *
 * DESIGN INTENT (why the silhouette is what it is)
 * ------------------------------------------------
 * Level 1's hero has to be readable as a *shape* at 40 m in `backlit` and hold
 * up at 1.6 m in `portrait`. Those two demands pull in opposite directions, so
 * the design is built out of large asymmetric masses that survive being
 * reduced to black, each of which happens to also carry a distinct material:
 *
 *   - a high closed collar and a single flared pauldron on the camera-side
 *     shoulder: the upper silhouette is a lopsided triangle, not a barrel
 *   - a knee-length coat cut short at the front and long at the back, with an
 *     irregular hem — the lower silhouette reads as motion even when standing
 *   - a mantle falling from the far shoulder across the back to the near hip,
 *     so the 3/4 view has a shape crossing behind the body
 *   - a diagonal chest harness and a waist belt that break the torso into
 *     bands at different roughnesses
 *   - bare forearms between cloth sleeve and leather bracer, because skin
 *     against leather against cloth is where the material response reads
 *
 * CONSTRUCTION
 * ------------
 * Body, head and hair are one authored signed distance field, polygonized in
 * three passes at three resolutions (13 mm / 5.5 mm / 6 mm) so the face gets
 * the detail the portrait shot needs without paying for it over the whole
 * body. The head pass includes the neck; the body pass includes the collar,
 * and the collar is closed and tall enough that the resolution seam between
 * the two passes is never visible from outside.
 *
 * Order in `prims` is load-bearing: subtractions only cut geometry declared
 * before them. The coat hem cut is declared between the coat and the legs,
 * which is what lets a single azimuth-varying plane carve a long-back /
 * short-front hem without also slicing the shins off.
 */
import * as THREE from 'three';
import { SEED } from '../../core/engine.js';
import {
  Field, surfaceNets, bakeAO, loft, faceted, tagPart, makeNoise3,
  clamp, clamp01, lerp, smoothstep,
} from './geom.js';
import { MAT } from './material.js';

const D = Math.PI / 180;
const noise = makeNoise3(SEED + 5);

/** Torso half-extents by height — the surface every strap has to lie on. */
const TORSO_R = [
  [0.90, 0.150, 0.116], [1.00, 0.152, 0.116], [1.08, 0.150, 0.124],
  [1.16, 0.156, 0.114], [1.24, 0.172, 0.116], [1.32, 0.170, 0.110],
  [1.40, 0.158, 0.102], [1.46, 0.112, 0.086],
];
function torsoR(y) {
  for (let i = 0; i < TORSO_R.length - 1; i++) {
    const a = TORSO_R[i], b = TORSO_R[i + 1];
    if (y <= b[0] || i === TORSO_R.length - 2) {
      const t = clamp01((y - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
  }
  return [0.15, 0.11];
}

// ------------------------------------------------------------ the field ----
export function buildField() {
  const F = new Field();
  const B = 'body', H = 'head', R = 'hair';

  const bodyBones = null;
  const skirtBones = { hips: 1.0, spine: 0.45, thighL: 0.30, thighR: 0.30 };
  const collarBones = { neck: 1.0, chest: 0.7, head: 0.15 };

  // ---------------------------------------------------------- torso ----
  F.ellipsoid([0, 0.972, 0.008], [0.148, 0.128, 0.112], { mat: MAT.CLOTH, k: 0.06, part: B });
  F.ellipsoid([0, 1.095, 0.010], [0.132, 0.098, 0.100], { mat: MAT.CLOTH, k: 0.06, part: B });
  F.ellipsoid([0, 1.252, 0.012], [0.170, 0.140, 0.113], { mat: MAT.CLOTH, k: 0.055, part: B });
  F.ellipsoid([0, 1.352, 0.004], [0.162, 0.078, 0.106], { mat: MAT.CLOTH, k: 0.05, part: B });
  // shoulder yoke + trapezius
  F.capsule([-0.152, 1.404, -0.004], [0.152, 1.404, -0.004], 0.076, 0.076,
    { scale: [1, 1, 0.95], mat: MAT.CLOTH, k: 0.05, part: B });
  F.capsule([-0.080, 1.432, -0.012], [0.080, 1.432, -0.012], 0.052, 0.052,
    { mat: MAT.CLOTH, k: 0.05, part: B });
  // scapular mass so the back is not a slab
  F.ellipsoid([0, 1.300, -0.062], [0.150, 0.120, 0.058], { mat: MAT.CLOTH, k: 0.06, part: B });
  // neck stub, deliberately thinner than the head pass's neck so it hides inside it
  F.capsule([0, 1.330, -0.006], [0, 1.440, 0.000], 0.042, 0.041,
    { mat: MAT.SKIN, k: 0.05, part: B, bones: collarBones });

  // ---------------------------------------------------------- coat -----
  F.capsule([0, 1.118, 0.008], [0, 0.735, 0.004], 0.150, 0.238,
    { scale: [1, 1, 0.80], mat: MAT.CLOTH, k: 0.055, part: B, bones: skirtBones });
  // hem: long at the back, short at the front, with a five-lobe irregularity.
  // Declared HERE so it only cuts the coat — the legs come after.
  F.custom((x, y, z) => {
    const th = Math.atan2(x, z);
    const hem = 0.700 + 0.108 * Math.cos(th) + 0.020 * Math.sin(th * 5 + 0.7)
      + 0.012 * Math.sin(th * 9 - 2.1);
    return y - hem;
  }, [-0.40, 0.40, -0.40, 0.40, 0.90, 0.40], { op: 'sub', k: 0.016, part: B });

  // NOTE: the high collar is NOT in the field. A collar is a ~15 mm shell, and
  // at the 14 mm body cell size an SDF shell that thin polygonizes into a torn
  // ribbon. It is built as a lofted piece in buildPieces() instead, where it
  // also gets the crisp top edge leather actually has.

  // ---------------------------------------------------------- legs -----
  for (const s of [1, -1]) {
    const T = s > 0 ? 'thighL' : 'thighR';
    const S = s > 0 ? 'shinL' : 'shinR';
    const FT = s > 0 ? 'footL' : 'footR';
    const TO = s > 0 ? 'toeL' : 'toeR';
    F.capsule([s * 0.094, 0.980, 0.006], [s * 0.100, 0.528, 0.022], 0.098, 0.069,
      { scale: [1, 1, 0.96], mat: MAT.PANT, k: 0.05, part: B, bones: { hips: 0.55, [T]: 1.0, [S]: 0.25 } });
    F.ellipsoid([s * 0.100, 0.524, 0.024], [0.068, 0.056, 0.072],
      { mat: MAT.PANT, k: 0.04, part: B, bones: { [T]: 1.0, [S]: 1.0 } });
    F.capsule([s * 0.100, 0.520, 0.020], [s * 0.104, 0.150, -0.008], 0.067, 0.050,
      { mat: MAT.PANT, k: 0.045, part: B, bones: { [T]: 0.3, [S]: 1.0 } });
    F.ellipsoid([s * 0.102, 0.400, -0.030], [0.060, 0.092, 0.066],
      { mat: MAT.PANT, k: 0.05, part: B, bones: { [S]: 1.0 } });
    // boot: shaft, heel, foot, toe, sole
    F.capsule([s * 0.104, 0.398, -0.014], [s * 0.105, 0.140, -0.010], 0.078, 0.067,
      { scale: [1, 1, 0.95], mat: MAT.BOOT, k: 0.03, part: B, bones: { [S]: 1.0, [FT]: 0.25 } });
    F.ellipsoid([s * 0.105, 0.098, -0.024], [0.058, 0.054, 0.062],
      { mat: MAT.BOOT, k: 0.03, part: B, bones: { [S]: 0.4, [FT]: 1.0 } });
    F.capsule([s * 0.105, 0.078, 0.006], [s * 0.105, 0.050, 0.132], 0.055, 0.041,
      { scale: [1, 0.9, 1], mat: MAT.BOOT, k: 0.03, part: B, bones: { [FT]: 1.0, [TO]: 0.5 } });
    F.ellipsoid([s * 0.105, 0.050, 0.152], [0.047, 0.034, 0.046],
      { mat: MAT.BOOT, k: 0.03, part: B, bones: { [FT]: 0.4, [TO]: 1.0 } });
    F.box([s * 0.105, 0.026, 0.048], [0.046, 0.011, 0.112],
      { round: 0.013, mat: MAT.BOOT, k: 0.014, part: B, bones: { [FT]: 1.0, [TO]: 0.6 } });
  }

  // ---------------------------------------------------------- arms -----
  for (const s of [1, -1]) {
    const SH = s > 0 ? 'shoulderL' : 'shoulderR';
    const AR = s > 0 ? 'armL' : 'armR';
    const FO = s > 0 ? 'foreL' : 'foreR';
    const HA = s > 0 ? 'handL' : 'handR';
    // deltoid + sleeve
    F.ellipsoid([s * 0.174, 1.406, 0.000], [0.076, 0.086, 0.080],
      { mat: MAT.CLOTH, k: 0.05, part: B, bones: { chest: 0.5, [SH]: 1.0, [AR]: 1.0 } });
    F.capsule([s * 0.176, 1.396, 0.000], [s * 0.198, 1.268, 0.010], 0.062, 0.055,
      { mat: MAT.CLOTH, k: 0.04, part: B, bones: { [SH]: 0.4, [AR]: 1.0 } });
    // sleeve cuff ring
    F.ellipsoid([s * 0.199, 1.264, 0.010], [0.060, 0.017, 0.060],
      { mat: MAT.CLOTH, k: 0.012, part: B, bones: { [AR]: 1.0 } });
    // bare upper forearm / elbow
    F.capsule([s * 0.198, 1.268, 0.010], [s * 0.212, 1.160, 0.020], 0.049, 0.046,
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 1.0, [FO]: 0.35 } });
    F.ellipsoid([s * 0.212, 1.158, 0.018], [0.047, 0.045, 0.047],
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 0.8, [FO]: 1.0 } });
    F.capsule([s * 0.212, 1.156, 0.020], [s * 0.223, 1.048, 0.062], 0.045, 0.038,
      { mat: MAT.SKIN, k: 0.03, part: B, bones: { [AR]: 0.3, [FO]: 1.0 } });
    // bracer
    F.capsule([s * 0.223, 1.052, 0.060], [s * 0.233, 0.916, 0.106], 0.047, 0.041,
      { mat: MAT.LEATHER, k: 0.014, part: B, bones: { [FO]: 1.0, [HA]: 0.15 } });
    F.capsule([s * 0.233, 0.916, 0.106], [s * 0.235, 0.888, 0.118], 0.035, 0.034,
      { mat: MAT.SKIN, k: 0.016, part: B, bones: { [FO]: 1.0, [HA]: 0.6 } });
    // hand: palm mass, fingers, thumb
    F.capsule([s * 0.236, 0.886, 0.120], [s * 0.240, 0.808, 0.146], 0.040, 0.036,
      { scale: [0.62, 1, 1.12], mat: MAT.SKIN, k: 0.02, part: B, bones: { [FO]: 0.3, [HA]: 1.0 } });
    F.capsule([s * 0.240, 0.810, 0.148], [s * 0.242, 0.748, 0.150], 0.033, 0.024,
      { scale: [0.60, 1, 1.18], mat: MAT.SKIN, k: 0.018, part: B, bones: { [HA]: 1.0 } });
    F.capsule([s * 0.222, 0.872, 0.128], [s * 0.212, 0.818, 0.152], 0.017, 0.014,
      { mat: MAT.SKIN, k: 0.016, part: B, bones: { [HA]: 1.0 } });
  }

  // ---------------------------------------------------------- head -----
  // neck (head pass) — fractionally fatter than the body's neck stub so it
  // always wins the overlap and there is never a coincident surface
  F.capsule([0, 1.398, -0.016], [0, 1.556, 0.002], 0.0625, 0.0505,
    { scale: [1, 1, 0.97], mat: MAT.SKIN, k: 0.04, part: H, bones: { neck: 1.0, chest: 0.35, head: 0.3 } });
  for (const s of [1, -1]) {
    F.capsule([s * 0.028, 1.542, 0.024], [s * 0.050, 1.436, 0.010], 0.011, 0.013,
      { mat: MAT.SKIN, k: 0.026, part: H, bones: { neck: 1.0, head: 0.5, chest: 0.2 } });
  }
  // Cranium and facial masses.
  //
  // DEPTH BUDGET — this is the thing the previous build got wrong and it is why
  // the face read as a featureless egg. The two mid-face masses were centred at
  // z = +0.030 with z-radii of 0.082 / 0.080, so their front surface sat at
  // z ~= 0.111. Every feature authored on top of them lives further back than
  // that: the eyelids front at 0.079, the eye aperture reaches only 0.087, the
  // brow ridge 0.072. All of them were therefore swallowed 20-30 mm INSIDE the
  // cheek mass and never reached the zero level set at all — no eyes, no brow,
  // no nose. Meanwhile the lips, at 0.098, were the only thing that cleared the
  // mass, so they protruded ~23 mm as a beak.
  //
  // The masses below are pulled back to put the face plane at:
  //     z ~= 0.072 at eye level, 0.074 at the cheek, 0.064 at the jaw
  // which leaves every feature its correct positive projection.
  F.ellipsoid([0, 1.672, -0.006], [0.0790, 0.0985, 0.0965], { mat: MAT.SKIN, k: 0.030, part: H });
  F.ellipsoid([0, 1.648, 0.010], [0.0735, 0.0525, 0.0700], { mat: MAT.SKIN, k: 0.028, part: H });
  F.ellipsoid([0, 1.606, 0.006], [0.0672, 0.0430, 0.0680], { mat: MAT.SKIN, k: 0.026, part: H });
  F.ellipsoid([0, 1.572, 0.000], [0.0590, 0.0400, 0.0640], { mat: MAT.SKIN, k: 0.026, part: H });
  F.ellipsoid([0, 1.5580, 0.040], [0.0285, 0.0235, 0.0290], { mat: MAT.SKIN, k: 0.020, part: H });
  for (const s of [1, -1]) {
    F.ellipsoid([s * 0.0605, 1.596, -0.004], [0.0175, 0.0400, 0.0380], { mat: MAT.SKIN, k: 0.024, part: H });
    F.ellipsoid([s * 0.0520, 1.632, 0.036], [0.0250, 0.0210, 0.0250], { mat: MAT.SKIN, k: 0.018, part: H });
  }
  // brow ridge + glabella — pushed out to clear the (now correct) face plane
  F.capsule([-0.0525, 1.6685, 0.0670], [0.0525, 1.6685, 0.0670], 0.0140, 0.0140,
    { scale: [1, 0.62, 0.80], mat: MAT.SKIN, k: 0.012, part: H });
  F.ellipsoid([0, 1.6660, 0.0700], [0.0135, 0.0125, 0.0120], { mat: MAT.SKIN, k: 0.010, part: H });
  // eye sockets, then lids, then the palpebral opening
  for (const s of [1, -1]) {
    F.ellipsoid([s * 0.0335, 1.6520, 0.0605], [0.0235, 0.0180, 0.0195],
      { op: 'sub', k: 0.009, part: H });
  }
  // RESOLUTION FLOOR. The head is polygonized on a 5.8 mm grid, so a primitive
  // whose smallest half-extent is under ~5 mm spans less than two cells: surface
  // nets then catches it in isolated cells, the Laplacian pass drags those
  // vertices somewhere else, and the reprojection pushes them onto a level set
  // that no longer exists there. The result is the speckled, half-carved
  // "scribble" the previous build put on the face. Every feature below is now
  // at least ~2 cells across; the eye aperture and brows are also read at a
  // stylized (larger than anatomical) scale, which is the target look anyway.
  for (const s of [1, -1]) {
    F.ellipsoid([s * 0.0335, 1.6600, 0.0625], [0.0232, 0.0125, 0.0165], { mat: MAT.SKIN, k: 0.006, part: H });
    F.ellipsoid([s * 0.0335, 1.6428, 0.0640], [0.0212, 0.0108, 0.0155], { mat: MAT.SKIN, k: 0.006, part: H });
  }
  for (const s of [1, -1]) {
    // palpebral opening: was 5.3 mm tall on a 5.8 mm grid — under one cell, so
    // it carved a ragged rim and the eyeball showed through it in fragments.
    F.ellipsoid([s * 0.0338, 1.6512, 0.0706], [0.0192, 0.0100, 0.0165],
      { op: 'sub', k: 0.005, part: H });
  }
  // nose — the old tip fronted at z 0.1105 against a 0.111 cheek mass, i.e. it
  // was flush with the face and invisible. Now ~20 mm of projection.
  F.capsule([0, 1.6720, 0.0690], [0, 1.6215, 0.0790], 0.0095, 0.0135,
    { scale: [0.88, 1, 1], mat: MAT.SKIN, k: 0.010, part: H });
  F.ellipsoid([0, 1.6135, 0.0800], [0.0142, 0.0125, 0.0145], { mat: MAT.SKIN, k: 0.008, part: H });
  for (const s of [1, -1]) {
    F.ellipsoid([s * 0.0150, 1.6090, 0.0700], [0.0100, 0.0100, 0.0118], { mat: MAT.SKIN, k: 0.007, part: H });
  }
  F.ellipsoid([0, 1.6060, 0.0700], [0.0120, 0.0075, 0.0120], { mat: MAT.SKIN, k: 0.007, part: H });
  // mouth — lips pushed apart so the parting groove between them can be two
  // cells wide. The old 2.4 mm groove and 3.8 mm philtrum were both far below
  // the grid and only ever produced speckle.
  F.ellipsoid([0, 1.5928, 0.0666], [0.0242, 0.0098, 0.0142], { mat: MAT.SKIN, k: 0.006, part: H });
  F.ellipsoid([0, 1.5716, 0.0640], [0.0214, 0.0112, 0.0140], { mat: MAT.SKIN, k: 0.006, part: H });
  // Both mouth grooves are pulled BACK rather than made thinner: a thin cutter
  // would drop back under the 5.8 mm grid, but sinking a fat one into the lip
  // mass gives the same shallow crease and stays resolvable. Cutting deep here
  // also carved a cavity whose walls face away from the key light, which set the
  // skin back-scatter term glowing orange — the mouth read as a lit gash.
  F.capsule([-0.0186, 1.5824, 0.0602], [0.0186, 1.5824, 0.0602], 0.0060, 0.0060,
    { scale: [1, 1, 0.70], op: 'sub', k: 0.005, part: H });
  F.capsule([-0.0148, 1.5606, 0.0540], [0.0148, 1.5606, 0.0540], 0.0060, 0.0060,
    { op: 'sub', k: 0.007, part: H });
  // ears
  for (const s of [1, -1]) {
    F.ellipsoid([s * 0.0755, 1.6410, -0.014], [0.0080, 0.0250, 0.0175], { mat: MAT.SKIN, k: 0.012, part: H });
    F.ellipsoid([s * 0.0815, 1.6380, -0.010], [0.0070, 0.0160, 0.0105], { op: 'sub', k: 0.005, part: H });
  }
  // brows — the old capsule was 6 mm x 0.55 = 3.3 mm of vertical half-extent,
  // i.e. barely half a cell, so it meshed as scattered hair-coloured chips
  // across the forehead instead of a brow.
  for (const s of [1, -1]) {
    F.capsule([s * 0.0135, 1.6730, 0.0740], [s * 0.0545, 1.6742, 0.0610], 0.0088, 0.0066,
      { scale: [1, 0.85, 0.85], mat: MAT.HAIR, k: 0.006, part: H });
  }

  // ---------------------------------------------------------- hair -----
  // A shell offset off the cranium, cut by a hairline plane and broken up by
  // noise so it reads as clumps rather than a moulded helmet.
  const hairShell = (x, y, z) => {
    const px = (x - 0) / 0.0895, py = (y - 1.679) / 0.1085, pz = (z + 0.010) / 0.1055;
    const k0 = Math.sqrt(px * px + py * py + pz * pz) || 1e-5;
    const qx = px / 0.0895, qy = py / 0.1085, qz = pz / 0.1055;
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    let d = (k0 * (k0 - 1)) / k1;
    // clump modulation, stretched front-to-back so it reads as swept strands
    d -= 0.0062 * (noise(x * 46 + 11, y * 21 + 3, z * 26 + 7) - 0.42);
    d -= 0.0038 * (noise(x * 105 + 2, y * 44, z * 58) - 0.5);
    return d;
  };
  F.custom(hairShell, [-0.115, 1.545, -0.135, 0.115, 1.805, 0.115],
    { mat: MAT.HAIR, k: 0.012, part: R, bones: { head: 1.0, neck: 0.25 } });
  F.ellipsoid([0, 1.674, -0.005], [0.0815, 0.1005, 0.0985], { op: 'sub', k: 0.006, part: R });
  // hairline: `sub` keeps f > 0, so f is the signed distance BEHIND the plane
  // through the forehead hairline, tilted up-and-back by ~24 degrees. The
  // ellipsoid narrowing at the temples makes the cut drop naturally into
  // sideburns without a second plane.
  F.custom((x, y, z) => (y - 1.7285) * 0.400 + (z - 0.0700) * (-0.916)
    + 0.006 * Math.sin(x * 44) - 0.010 * Math.abs(x) * 6.0,
  [-0.14, 1.50, -0.16, 0.14, 1.82, 0.16], { op: 'sub', k: 0.013, part: R });
  // nape: stop the hair before it runs down the back
  F.custom((x, y, z) => y - 1.582 - 0.011 * Math.sin(x * 58) - 0.010 * Math.max(0, z * 4),
    [-0.14, 1.45, -0.16, 0.14, 1.66, 0.16], { op: 'sub', k: 0.011, part: R });
  // swept crown tufts + a couple of loose front strands
  const tufts = [
    [[-0.052, 1.741, 0.030], [-0.070, 1.700, -0.062], 0.017, 0.011],
    [[0.052, 1.741, 0.030], [0.072, 1.698, -0.060], 0.017, 0.011],
    [[0.000, 1.756, 0.030], [0.004, 1.726, -0.078], 0.019, 0.012],
    [[-0.026, 1.750, 0.044], [-0.034, 1.714, -0.030], 0.014, 0.009],
    [[0.028, 1.749, 0.042], [0.038, 1.712, -0.028], 0.014, 0.009],
    [[0.016, 1.734, 0.062], [0.040, 1.704, 0.078], 0.010, 0.006],
    [[-0.020, 1.730, 0.060], [-0.046, 1.699, 0.070], 0.009, 0.006],
  ];
  for (const [a, b, ra, rb] of tufts) {
    F.capsule(a, b, ra, rb, { mat: MAT.HAIR, k: 0.014, part: R, bones: { head: 1.0 } });
  }

  return F;
}

// ---------------------------------------------------------------- tints ----
function tintFor(mat, x, y, z, nx, ny, nz) {
  let v = 0.90 + 0.22 * noise(x * 9.1 + 3, y * 9.1, z * 9.1 + 8);
  const t = [v, v, v];
  // sun-bleach on up-facing cloth, grime in the low creases
  const up = Math.max(0, ny);
  t[0] *= 1 + up * 0.05; t[1] *= 1 + up * 0.045; t[2] *= 1 + up * 0.03;
  // road dust rising up the boots and coat hem
  const dust = smoothstep(0.55, 0.03, y) * (mat === MAT.BOOT || mat === MAT.CLOTH || mat === MAT.PANT ? 1 : 0.3);
  t[0] *= 1 + dust * 0.85; t[1] *= 1 + dust * 0.70; t[2] *= 1 + dust * 0.42;
  // the back-left quadrant sits under the mantle: knock it down
  const shade = clamp01((-x * 1.4 - z * 2.2 - 0.10)) * clamp01((1.35 - y) * 2.2);
  const k = 1 - 0.30 * clamp01(shade);
  t[0] *= k; t[1] *= k; t[2] *= k;
  if (mat === MAT.SKIN) {
    // a little more blood in the ears, nose and knuckles
    const warm = smoothstep(0.055, 0.085, Math.abs(x)) * smoothstep(1.55, 1.66, y);
    t[0] *= 1 + warm * 0.16; t[2] *= 1 - warm * 0.07;
  }
  return t;
}

// -------------------------------------------------------------- meshing ----
function meshPart(field, parts, bmin, bmax, res, aoSample, opts = {}) {
  const sample = field.sampler(parts);
  const g = surfaceNets(sample, bmin, bmax, res, opts);
  if (!g) return null;
  g.ao = bakeAO(aoSample, g.positions, g.normals, opts.ao ?? {});
  g.matAo = new Float32Array(g.count * 2);
  g.tint = new Float32Array(g.count * 3);
  g.masks = new Array(g.count);
  for (let v = 0; v < g.count; v++) {
    const x = g.positions[v * 3], y = g.positions[v * 3 + 1], z = g.positions[v * 3 + 2];
    const p = field.nearestPrim(x, y, z, parts);
    const m = p ? p.mat : MAT.CLOTH;
    g.matAo[v * 2] = m;
    g.matAo[v * 2 + 1] = g.ao[v];
    g.masks[v] = p ? p.bones : null;
    const t = tintFor(m, x, y, z, g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]);
    g.tint[v * 3] = t[0]; g.tint[v * 3 + 1] = t[1]; g.tint[v * 3 + 2] = t[2];
  }
  return g;
}

// ------------------------------------------------------------- hardware ----
/** Rounded-rectangle cross-section in a (out, up) basis. */
function strapProfile(halfW, thick, inset) {
  const r = Math.min(thick * 0.6, halfW * 0.35);
  return [
    [-inset, halfW], [thick - r, halfW], [thick, halfW - r],
    [thick, -halfW + r], [thick - r, -halfW], [-inset, -halfW],
  ];
}

/** Sweep a strap along a path of {p, out, up}. */
function strap(path, halfW, thick, inset = 0.02) {
  const prof = strapProfile(halfW, thick, inset);
  const sections = path.map((s) => prof.map(([a, b]) => [
    s.p[0] + s.out[0] * a + s.up[0] * b,
    s.p[1] + s.out[1] * a + s.up[1] * b,
    s.p[2] + s.out[2] * a + s.up[2] * b,
  ]));
  return loft(sections, { closedU: true });
}

function fromThree(geo, matrix) {
  const g2 = geo.index ? geo : geo.toNonIndexed();
  if (matrix) g2.applyMatrix4(matrix);
  const positions = new Float32Array(g2.attributes.position.array);
  const normals = new Float32Array(g2.attributes.normal.array);
  const idx = g2.index ? g2.index.array : null;
  const count = positions.length / 3;
  const indices = idx ? new Uint32Array(idx) : new Uint32Array(count).map((_, i) => i);
  return { positions, normals, indices, count };
}

export function buildPieces() {
  const parts = [];
  const push = (g, mat, mask, tintScale = 1) => {
    tagPart(g, mat, (x, y, z) => {
      const t = tintFor(mat, x, y, z, 0, 0.3, 0);
      return [t[0] * tintScale, t[1] * tintScale, t[2] * tintScale];
    });
    // hard-surface parts get a mild ambient occlusion floor rather than a bake
    for (let v = 0; v < g.count; v++) g.matAo[v * 2 + 1] = 0.86;
    g.mask = mask;
    parts.push(g);
    return g;
  };

  // ---------------------------------------------------------- collar ----
  // A stand-up leather collar. It is the piece that hides the resolution seam
  // between the 14 mm body pass and the 6 mm head pass, so its inner surface
  // tracks the neck cone with only 4-6 mm of clearance and its bottom edge
  // sits below where the neck meets the trapezius.
  {
    const neckR = (y) => lerp(0.0625, 0.0505, clamp01((y - 1.398) / 0.158));
    const cz = -0.010;
    const yB = 1.391;
    const NS = 42;
    const sections = [];
    for (let i = 0; i <= NS; i++) {
      const th = (i / NS) * Math.PI * 2;
      const front = Math.max(0, Math.cos(th));
      const yT = 1.512 - 0.048 * front * front;
      const rIB = neckR(yB) + 0.007, rOB = rIB + 0.022;
      const rIT = neckR(yT) + 0.004, rOT = rIT + 0.021;
      const prof = [
        [rIB, yB + 0.005], [rIB + 0.007, yB], [rOB, yB + 0.007],
        [rOT, yT - 0.007], [rOT - 0.006, yT], [rIT + 0.005, yT], [rIT, yT - 0.006],
      ];
      sections.push(prof.map(([r, y]) => [r * Math.sin(th), y, cz + r * Math.cos(th)]));
    }
    push(loft(sections, { closedU: true }), MAT.LEATHER,
      { neck: 1.0, chest: 0.55, head: 0.18 });
  }

  // ------------------------------------------------------------ belt ----
  {
    const y = 1.074;
    const [rx, rz] = torsoR(y);
    const path = [];
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const sx = Math.sin(th), cz = Math.cos(th);
      const ox = sx / (rx + 0.012), oz = cz / (rz + 0.012);
      const l = Math.hypot(ox, oz);
      path.push({
        p: [(rx + 0.010) * sx, y + 0.004 * Math.cos(th * 2), (rz + 0.012) * cz],
        out: [ox / l, 0, oz / l], up: [0, 1, 0],
      });
    }
    push(strap(path, 0.031, 0.013, 0.030), MAT.LEATHER, { hips: 1.0, spine: 0.5 });
    // buckle
    const bk = new THREE.BoxGeometry(0.052, 0.048, 0.014);
    const m = new THREE.Matrix4().makeTranslation(0.008, 1.074, torsoR(1.074)[1] + 0.022);
    push(faceted(fromThree(bk, m)), MAT.METAL, { hips: 1.0, spine: 0.4 });
    const bk2 = new THREE.BoxGeometry(0.030, 0.026, 0.020);
    const m2 = new THREE.Matrix4().makeTranslation(0.008, 1.074, torsoR(1.074)[1] + 0.028);
    push(faceted(fromThree(bk2, m2)), MAT.LEATHER, { hips: 1.0, spine: 0.4 });
  }

  // -------------------------------------------------- chest harness ----
  {
    // over the near (+X) shoulder, down across the chest to the far hip
    const key = [
      [0.30, 1.430], [0.24, 1.352], [0.10, 1.270], [-0.08, 1.196], [-0.26, 1.124],
    ];
    const path = [];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const f = t * (key.length - 1);
      const i0 = Math.min(key.length - 2, Math.floor(f));
      const u = f - i0;
      const th = lerp(key[i0][0], key[i0 + 1][0], u) * Math.PI;
      const y = lerp(key[i0][1], key[i0 + 1][1], u);
      const [rx, rz] = torsoR(y);
      const sx = Math.sin(th), cz = Math.cos(th);
      const ox = sx / rx, oz = cz / rz;
      const l = Math.hypot(ox, oz);
      path.push({ p: [rx * sx, y, rz * cz], out: [ox / l, 0, oz / l], up: null, th });
    }
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)].p, b = path[Math.min(path.length - 1, i + 1)].p;
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      const o = path[i].out;
      // up = tangent x out, normalized -> lies on the surface, across the strap
      let ux = ty * o[2] - tz * o[1], uy = tz * o[0] - tx * o[2], uz = tx * o[1] - ty * o[0];
      const ul = Math.hypot(ux, uy, uz) || 1;
      path[i].up = [ux / ul, uy / ul, uz / ul];
    }
    push(strap(path, 0.028, 0.011, 0.024), MAT.LEATHER, { chest: 1.0, spine: 0.4, hips: 0.2 });
    // ring where the harness crosses the sternum
    const ring = new THREE.TorusGeometry(0.024, 0.0055, 8, 20);
    const mm = new THREE.Matrix4().makeRotationY(0.35)
      .premultiply(new THREE.Matrix4().makeTranslation(0.062, 1.290, torsoR(1.29)[1] + 0.006));
    push(fromThree(ring, mm), MAT.METAL, { chest: 1.0 });
  }

  // -------------------------------------------------------- pauldron ----
  {
    const C = [0.150, 1.402, 0.0];
    const lames = [[0.00, 0.38], [0.32, 0.70], [0.64, 1.00]];
    lames.forEach(([v0, v1], li) => {
      const NS = 5, NU = 22, th = 0.009;
      const sections = [];
      for (let s = 0; s < NS; s++) {
        const v = lerp(v0, v1, s / (NS - 1));
        const E = lerp(74, -34, v) * D;
        const Rr = lerp(0.086, 0.158, v) * (1 + li * 0.028);
        const A = lerp(76, 88, v) * D;
        const outer = [], inner = [];
        for (let u = 0; u < NU; u++) {
          const a = (-1 + (2 * u) / (NU - 1)) * A;
          const dx = Math.cos(E) * Math.cos(a), dy = Math.sin(E), dz = Math.cos(E) * Math.sin(a) * 1.15;
          const l = Math.hypot(dx, dy, dz);
          const ex = dx / l, ey = dy / l, ez = dz / l;
          outer.push([C[0] + ex * Rr, C[1] + ey * Rr, C[2] + ez * Rr]);
          inner.push([C[0] + ex * (Rr - th), C[1] + ey * (Rr - th), C[2] + ez * (Rr - th)]);
        }
        sections.push(outer.concat(inner.reverse()));
      }
      push(loft(sections, { closedU: true }), li === 2 ? MAT.LEATHER : MAT.LEATHER,
        { shoulderL: 1.0, chest: 0.45, armL: 0.35 });
    });
    // rivets along the lower lame edge
    for (let i = 0; i < 5; i++) {
      const a = (-0.72 + (i / 4) * 1.44) * 88 * D;
      const E = -30 * D, Rr = 0.160;
      const dx = Math.cos(E) * Math.cos(a), dy = Math.sin(E), dz = Math.cos(E) * Math.sin(a) * 1.15;
      const l = Math.hypot(dx, dy, dz);
      const s = new THREE.SphereGeometry(0.0058, 8, 6);
      const m = new THREE.Matrix4().makeTranslation(
        C[0] + (dx / l) * Rr, C[1] + (dy / l) * Rr, C[2] + (dz / l) * Rr);
      push(fromThree(s, m), MAT.METAL, { shoulderL: 1.0, chest: 0.4, armL: 0.35 });
    }
  }

  // ---------------------------------------------------------- mantle ----
  {
    const NV = 17, NU = 26, th = 0.011;
    const sections = [];
    for (let s = 0; s < NV; s++) {
      const v = s / (NV - 1);
      const th0 = lerp(-88, -80, v) * D;
      const th1 = lerp(-232, -308, v) * D;
      const Rr = lerp(0.180, 0.300, Math.pow(v, 1.25));
      const cz = -0.004 - 0.035 * v;
      const outer = [], inner = [];
      for (let u = 0; u < NU; u++) {
        const uu = u / (NU - 1);
        const a = lerp(th0, th1, uu);
        let y = 1.452 - 0.792 * v;
        // torn hem, only near the bottom
        const tearing = smoothstep(0.72, 1.0, v);
        y -= tearing * (0.052 * (0.5 + 0.5 * Math.sin(uu * 13.0 + 1.1))
          + 0.030 * noise(uu * 7.3, 2.1, 0.5));
        const rx = Rr, rz = Rr * 0.84;
        const sx = Math.sin(a), czz = Math.cos(a);
        const nx = sx / rx, nz = czz / rz;
        const nl = Math.hypot(nx, nz);
        outer.push([rx * sx, y, cz + rz * czz]);
        inner.push([rx * sx - (nx / nl) * th, y, cz + rz * czz - (nz / nl) * th]);
      }
      sections.push(outer.concat(inner.reverse()));
    }
    const g = loft(sections, { closedU: true });
    // mantle rides the cloth chain so it lags the body
    push(g, MAT.MANTLE, null, 1.0);
    g.mask = (x, y) => {
      const t = clamp01((1.452 - y) / 0.79);
      if (t < 0.25) return { chest: 1.0, shoulderR: 0.5, mantleA: 0.9, spine: 0.2 };
      if (t < 0.58) return { mantleA: 1.0, mantleB: 0.8, chest: 0.35, spine: 0.3 };
      if (t < 0.82) return { mantleB: 1.0, mantleC: 0.7, hips: 0.25 };
      return { mantleC: 1.0, mantleB: 0.5, hips: 0.15 };
    };
    // mantle clasp on the far shoulder
    const cl = new THREE.SphereGeometry(0.017, 12, 9);
    const m = new THREE.Matrix4().makeScale(1, 1, 0.6)
      .premultiply(new THREE.Matrix4().makeTranslation(-0.150, 1.418, 0.030));
    push(fromThree(cl, m), MAT.METAL, { chest: 1.0, shoulderR: 0.8 });
  }

  // ------------------------------------------------------------ sash ----
  {
    for (const [x0, z0, len, wob] of [[0.118, 0.108, 0.44, 1.0], [0.148, 0.070, 0.36, -1.3]]) {
      const NS = 14;
      const sections = [];
      const prof = strapProfile(0.030, 0.006, 0.006);
      for (let i = 0; i < NS; i++) {
        const t = i / (NS - 1);
        const y = 1.078 - len * t;
        const bend = 0.045 * t * t * wob;
        const p = [x0 + bend * 0.5, y, z0 + 0.035 * t + 0.02 * Math.sin(t * 3 + wob)];
        const out = [Math.sin(0.9 + bend * 4), 0, Math.cos(0.9 + bend * 4)];
        const up = [0, 1, 0];
        // width tapers to a point at the tip
        const w = 0.030 * (1 - 0.55 * t * t);
        sections.push(prof.map(([a, b]) => [
          p[0] + out[0] * a + up[0] * b * (w / 0.030),
          p[1] + up[1] * b * (w / 0.030),
          p[2] + out[2] * a,
        ]));
      }
      push(loft(sections, { closedU: true }), MAT.SASH, null);
      parts[parts.length - 1].mask = (x, y) => {
        const t = clamp01((1.078 - y) / len);
        return { hips: 1.0 - 0.4 * t, mantleB: 0.5 * t, mantleC: 0.4 * t * t, thighL: 0.15 };
      };
    }
  }

  // ---------------------------------------------------- boot straps ----
  for (const s of [1, -1]) {
    const SH = s > 0 ? 'shinL' : 'shinR';
    for (const [y, r] of [[0.352, 0.079], [0.196, 0.073]]) {
      const path = [];
      const N = 22;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        path.push({
          p: [s * 0.104 + r * Math.sin(th), y, -0.012 + r * 0.95 * Math.cos(th)],
          out: [Math.sin(th), 0, Math.cos(th)], up: [0, 1, 0],
        });
      }
      push(strap(path, 0.016, 0.008, 0.014), MAT.LEATHER, { [SH]: 1.0 });
      const bk = new THREE.BoxGeometry(0.020, 0.019, 0.010);
      const m = new THREE.Matrix4().makeTranslation(s * 0.104, y, -0.012 + r + 0.008);
      push(faceted(fromThree(bk, m)), MAT.METAL, { [SH]: 1.0 });
    }
  }

  // -------------------------------------------------- bracer straps ----
  for (const s of [1, -1]) {
    const FO = s > 0 ? 'foreL' : 'foreR';
    for (const t of [0.22, 0.72]) {
      const a = [s * 0.223, 1.052, 0.060], b = [s * 0.233, 0.916, 0.106];
      const c = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      const r = lerp(0.049, 0.043, t);
      let ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
      const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
      // basis perpendicular to the forearm axis
      let e1 = [1, 0, 0];
      let u1 = [ay * e1[2] - az * e1[1], az * e1[0] - ax * e1[2], ax * e1[1] - ay * e1[0]];
      let ul = Math.hypot(...u1); u1 = u1.map((q) => q / ul);
      const u2 = [ay * u1[2] - az * u1[1], az * u1[0] - ax * u1[2], ax * u1[1] - ay * u1[0]];
      const path = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const dx = u1[0] * Math.cos(th) + u2[0] * Math.sin(th);
        const dy = u1[1] * Math.cos(th) + u2[1] * Math.sin(th);
        const dz = u1[2] * Math.cos(th) + u2[2] * Math.sin(th);
        path.push({ p: [c[0] + dx * r, c[1] + dy * r, c[2] + dz * r], out: [dx, dy, dz], up: [ax, ay, az] });
      }
      push(strap(path, 0.011, 0.006, 0.010), MAT.LEATHER, { [FO]: 1.0 });
    }
  }

  // ------------------------------------------------------------ eyes ----
  // The eyeball must sit BEHIND the lid surface at every point of the aperture,
  // or it reads as a loose ball stuck on the face. The lids' front surface is
  // at z ~= 0.0785; a 13.2 mm ball centred at z = 0.0628 fronts at 0.0760, so
  // it stays 2.5 mm inside the lid line all the way round the (now resolvable)
  // palpebral opening.
  for (const s of [1, -1]) {
    const R = 0.0132;
    const c = [s * 0.0338, 1.6512, 0.0628];
    const sph = new THREE.SphereGeometry(R, 22, 16);
    const m = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]);
    const g = fromThree(sph, m);
    tagPart(g, MAT.EYE, null);
    // gaze: slightly toward the camera side and level
    const gaze = [s * 0.16, -0.02, 0.986];
    const gl = Math.hypot(...gaze);
    for (let v = 0; v < g.count; v++) {
      const dx = (g.positions[v * 3] - c[0]) / R;
      const dy = (g.positions[v * 3 + 1] - c[1]) / R;
      const dz = (g.positions[v * 3 + 2] - c[2]) / R;
      const d = (dx * gaze[0] + dy * gaze[1] + dz * gaze[2]) / gl;
      const ang = Math.acos(clamp(d, -1, 1));
      let col;
      // a larger iris than life — the stylized read, and it survives the
      // aperture instead of vanishing behind the lids
      if (ang < 0.30) col = [0.02, 0.017, 0.016];                        // pupil
      else if (ang < 0.78) {
        const q = smoothstep(0.30, 0.78, ang);
        col = [lerp(0.24, 0.46, q), lerp(0.30, 0.46, q), lerp(0.20, 0.31, q)];   // iris
        const limb = smoothstep(0.64, 0.78, ang);
        col = col.map((v2) => v2 * (1 - limb * 0.78));                   // limbal ring
      } else {
        const q = smoothstep(0.78, 1.6, ang);
        col = [lerp(0.86, 1.02, q), lerp(0.80, 0.98, q), lerp(0.78, 0.95, q)];   // sclera
      }
      g.tint[v * 3] = col[0]; g.tint[v * 3 + 1] = col[1]; g.tint[v * 3 + 2] = col[2];
      g.matAo[v * 2 + 1] = 0.72;
    }
    g.mask = { head: 1.0 };
    parts.push(g);
  }

  return parts;
}

// ------------------------------------------------------------- assemble ----
export function buildCharacterGeometry() {
  const t0 = performance.now();
  const field = buildField();
  field.build();
  const aoSample = field.sampler(null, true);

  const body = meshPart(field, ['body'], [-0.33, -0.012, -0.21], [0.33, 1.50, 0.25], 0.0146,
    aoSample, { smooth: 2, project: 3, ao: { strength: 1.0 } });
  const head = meshPart(field, ['head'], [-0.112, 1.366, -0.132], [0.112, 1.802, 0.128], 0.0058,
    aoSample, { smooth: 2, project: 3, ao: { radii: [0.010, 0.028, 0.070], strength: 0.95 } });
  const hair = meshPart(field, ['hair'], [-0.118, 1.550, -0.142], [0.118, 1.812, 0.120], 0.0064,
    aoSample, { smooth: 1, project: 3, ao: { radii: [0.012, 0.032, 0.075], strength: 0.9 } });

  const sdfParts = [body, head, hair].filter(Boolean);
  const pieces = buildPieces();
  const t1 = performance.now();
  return { field, sdfParts, pieces, ms: t1 - t0 };
}
