/**
 * Macrion — atmospheric scattering GLSL.
 *
 * A Nishita-style single-scattering model (Rayleigh + Mie) with a cheap
 * multiple-scattering fudge, a procedural cloud deck, a star field and a
 * sun/moon disc. Shared verbatim by three consumers so they can never drift:
 *
 *   1. the sky dome material            (full quality, per-pixel)
 *   2. the aerial-perspective LUT pass  (128x64, regenerated on state change)
 *   3. the PMREM cube render            (same dome material, different scene)
 *
 * Everything here is a pure function of direction + uniforms. No time term,
 * no random() — captures are bit-identical run to run.
 */

/** Uniform block shared by the dome + LUT shaders. */
export const ATMO_PARS = /* glsl */ `
#define MPI 3.141592653589793

uniform vec3  uKeyDir;       // direction toward the dominant scatterer (sun by day, moon by night)
uniform float uKeyLum;       // radiance scale for that scatterer
uniform vec3  uKeyTint;      // spectral tint of the key (already transmittance-shaped)
uniform float uMieScale;     // turbidity -> Mie coefficient multiplier
uniform float uMieG;         // Mie anisotropy
uniform float uMS;           // multiple-scattering fudge (whitens + lifts, grows with turbidity)
uniform vec3  uNightBase;    // airglow / light-pollution floor so night never hits 0
uniform float uStarAmt;      // 0 day .. 1 night
uniform float uCloud;        // 0..1 coverage
uniform vec3  uCloudLit;
uniform vec3  uCloudDark;
uniform float uCloudOpacity;
uniform vec2  uCloudShadowDir;
uniform vec3  uDiscDir;      // sun or moon disc direction
uniform vec3  uDiscColor;
uniform float uDiscSize;     // cos of angular radius
uniform float uDiscHalo;     // angular falloff of the glow around the disc, radians
uniform float uHaloK;        // glow strength relative to the disc
uniform vec3  uGroundTint;   // colour used below the horizon
uniform float uSkyKnee;      // radiance at which the highlight shoulder starts
uniform float uSkyMax;       // asymptote the shoulder compresses toward
uniform float uSkyWarm;      // how hard the compressed part re-tints to uSkyTint
uniform vec3  uSkyTint;      // normalised direct-beam colour (warm at low sun)

const float RG = 6360000.0;
const float RT = 6460000.0;
const vec3  BETA_R = vec3( 5.8e-6, 13.5e-6, 33.1e-6 );
const float BETA_M = 21e-6;
const float H_R = 8000.0;
const float H_M = 1200.0;

vec2 macRaySphere( vec3 o, vec3 d, float r ) {
  float b = dot( o, d );
  float c = dot( o, o ) - r * r;
  float h = b * b - c;
  if ( h < 0.0 ) return vec2( -1.0, -1.0 );
  h = sqrt( h );
  return vec2( -b - h, -b + h );
}

float macPhaseR( float mu ) { return 0.0596831 * ( 1.0 + mu * mu ); }

float macPhaseM( float mu, float g ) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * mu;
  return 0.1193662 * ( ( 1.0 - g2 ) * ( 1.0 + mu * mu ) ) / ( ( 2.0 + g2 ) * d * sqrt( max( d, 1e-4 ) ) );
}

/**
 * Single-scattering integral along rd from an observer 500 m above the ground.
 *
 * Steps are distributed quadratically, not uniformly. A horizon ray is ~1100 km
 * long while essentially all of the optical mass sits in the first 30 km, so
 * uniform stepping puts the entire near field inside sample 0 and the horizon
 * collapses to a dark brown band. t = tmax * x^2 fixes that for free.
 */
vec3 macScatter( vec3 rd ) {
  vec3 ro = vec3( 0.0, RG + 500.0, 0.0 );
  float betaM = BETA_M * uMieScale;

  vec2 ta = macRaySphere( ro, rd, RT );
  float tmax = max( ta.y, 0.0 );
  vec2 tg = macRaySphere( ro, rd, RG );
  if ( tg.x > 0.0 ) tmax = min( tmax, tg.x );
  if ( tmax <= 0.0 ) return vec3( 0.0 );

  const int STEPS = 14;
  const int LSTEPS = 5;

  vec3 sumR = vec3( 0.0 );
  vec3 sumM = vec3( 0.0 );
  float odR = 0.0;
  float odM = 0.0;
  float tPrev = 0.0;

  for ( int i = 0; i < STEPS; i ++ ) {
    float x = float( i + 1 ) / float( STEPS );
    float tNext = tmax * x * x;
    float ds = tNext - tPrev;
    vec3 p = ro + rd * ( tPrev + ds * 0.5 );
    tPrev = tNext;

    float h = length( p ) - RG;
    float hr = exp( -h / H_R ) * ds;
    float hm = exp( -h / H_M ) * ds;
    odR += hr;
    odM += hm;

    vec2 tl = macRaySphere( p, uKeyDir, RT );
    float lmax = max( tl.y, 0.0 );
    float odRl = 0.0;
    float odMl = 0.0;
    float lPrev = 0.0;
    bool blocked = false;
    for ( int j = 0; j < LSTEPS; j ++ ) {
      float lx = float( j + 1 ) / float( LSTEPS );
      float lNext = lmax * lx * lx;
      float dsl = lNext - lPrev;
      vec3 pl = p + uKeyDir * ( lPrev + dsl * 0.5 );
      lPrev = lNext;
      float hl = length( pl ) - RG;
      if ( hl < 0.0 ) { blocked = true; break; }
      odRl += exp( -hl / H_R ) * dsl;
      odMl += exp( -hl / H_M ) * dsl;
    }
    if ( ! blocked ) {
      vec3 att = exp( - ( BETA_R * ( odR + odRl ) + betaM * 1.1 * ( odM + odMl ) ) );
      sumR += hr * att;
      sumM += hm * att;
    }
  }

  float mu = dot( rd, uKeyDir );
  vec3 rayleigh = sumR * BETA_R;
  vec3 mie = sumM * betaM;

  // Single scattering is far too saturated; uMS folds in an isotropic
  // multiple-scattering term that whitens the zenith and lifts the horizon.
  vec3 col = rayleigh * macPhaseR( mu ) + mie * macPhaseM( mu, uMieG );
  col += ( rayleigh + mie * 0.7 ) * uMS;
  return col * uKeyLum * uKeyTint;
}

/**
 * Highlight shoulder for the sky's own radiance.
 *
 * The Mie forward-scatter lobe runs about 10x the rest of the dome, so on a
 * grazing shot an ~40 degree wedge of sky sits between 1.0 and 1.5 while the
 * blue sky away from the sun sits at 0.15. ACES maps everything past ~0.8 into
 * the last few percent of output range *and* desaturates it per channel, so
 * that whole wedge lands on the same neutral near-white: a flat plate with no
 * gradation, which is exactly what r1 was scored down for. Bloom then amplified
 * it, but the plate was already there before bloom ran.
 *
 * Two things happen here:
 *
 *   1. A hyperbolic shoulder on the max channel compresses the top end toward
 *      uSkyMax. Applied to the max channel rather than per channel so hue
 *      survives, and slope is exactly 1 at the knee so there is no visible seam
 *      where the shoulder engages.
 *   2. The compressed part is re-tinted toward the direct-beam colour, by an
 *      amount proportional to how much it was compressed. This is the part that
 *      matters visually: it means the brightest sky rolls off *warm* — gold into
 *      cream into blue — instead of bleaching to paper white. Compare the sky
 *      around the sun in the FFXV reference, which is bright cream-gold at every
 *      point and never neutral.
 *
 * Sun/moon disc is deliberately added AFTER this, so the disc keeps a genuinely
 * super-threshold core for bloom to find.
 */
vec3 macRolloff( vec3 c ) {
  float m = max( max( c.r, c.g ), c.b );
  if ( m <= uSkyKnee ) return c;
  float span = max( uSkyMax - uSkyKnee, 1e-3 );
  float e = ( m - uSkyKnee ) / span;
  float y = uSkyKnee + span * e / ( 1.0 + e );
  vec3 o = c * ( y / m );
  return mix( o, o * uSkyTint, clamp( e * uSkyWarm, 0.0, 1.0 ) );
}

// ---------------------------------------------------------------- noise ----
float macHash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float macHash31( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}

float macVNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = macHash21( i );
  float b = macHash21( i + vec2( 1.0, 0.0 ) );
  float c = macHash21( i + vec2( 0.0, 1.0 ) );
  float d = macHash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

/** damp fades the two highest octaves out; used as a cheap horizon LOD. */
float macFbm( vec2 p, float damp ) {
  float v = 0.0;
  float a = 0.52;
  float k = 1.0;
  for ( int i = 0; i < 5; i ++ ) {
    v += a * k * macVNoise( p );
    p = p * 2.07 + vec2( 17.1, 9.3 );
    a *= 0.5;
    if ( i >= 2 ) k *= damp;
  }
  return v;
}

// --------------------------------------------------------------- clouds ----
/** rgb = lit cloud colour, a = coverage alpha. */
vec4 macClouds( vec3 rd ) {
  if ( uCloudOpacity <= 0.001 ) return vec4( 0.0 );
  float ry = max( rd.y, 0.045 );
  float t = 3600.0 / ry;
  vec2 p = rd.xz * t * 0.00085;
  // The deck compresses to infinite frequency at the horizon. Fade the high
  // octaves out AND collapse the field toward its mean, or it aliases into
  // vertical streaks.
  float damp = smoothstep( 0.040, 0.34, rd.y );

  float n = macFbm( p, damp );
  n = mix( 0.5, n, mix( 0.10, 1.0, damp ) );

  float cov = clamp( uCloud, 0.0, 1.0 );
  float lo = 1.00 - cov * 0.88;
  float d = smoothstep( lo, lo + mix( 0.26, 0.06, cov ), n );

  // shadowed side: compare against the noise a step toward the key light
  float ns = macFbm( p + uCloudShadowDir * 0.30, damp );
  float lit = smoothstep( -0.16, 0.26, n - ns + 0.08 );
  lit = mix( lit, 0.62, cov * 0.78 );   // thick decks are low-contrast, not punchy

  vec3 col = mix( uCloudDark, uCloudLit, lit );
  // silver lining right around the key direction
  float fwd = pow( max( dot( rd, uKeyDir ), 0.0 ), 16.0 );
  col += uCloudLit * fwd * 0.8 * ( 1.0 - cov * 0.55 );

  return vec4( col, clamp( d * uCloudOpacity, 0.0, 1.0 ) );
}

// ---------------------------------------------------------------- stars ----
float macStars( vec3 rd ) {
  if ( uStarAmt <= 0.001 ) return 0.0;
  vec3 s = rd * 300.0;
  vec3 c = floor( s );
  float h = macHash31( c );
  if ( h < 0.9915 ) return 0.0;
  vec3 j = vec3( macHash31( c + 1.7 ), macHash31( c + 3.3 ), macHash31( c + 5.9 ) ) - 0.5;
  float dd = length( s - ( c + 0.5 + j * 0.55 ) );
  float mag = ( h - 0.9915 ) / 0.0085;
  return exp( -dd * dd * 34.0 ) * ( 0.05 + mag * mag * 0.62 );
}

// ------------------------------------------------------------ full sky -----
/**
 * withDetail = false is used for the aerial-perspective LUT: it swaps the
 * detailed cloud deck for a coverage-averaged grey so distant geometry fades
 * to the same value the sky actually shows.
 */
vec3 macrionSky( vec3 rdIn, bool withDetail ) {
  vec3 rd = normalize( rdIn );

  // below the horizon: mirror the sky and tint toward ground bounce
  float down = clamp( -rd.y * 5.0, 0.0, 1.0 );
  vec3 rs = normalize( vec3( rd.x, max( abs( rd.y ), 0.0012 ), rd.z ) );

  vec3 col = macScatter( rs );
  col += uNightBase * ( 0.22 + 0.78 * smoothstep( -0.05, 0.60, rs.y ) );

  // stars + milky-way band
  vec3 night = vec3( 0.0 );
  if ( uStarAmt > 0.001 ) {
    float band = smoothstep( 0.26, 0.0, abs( dot( rd, normalize( vec3( 0.42, 0.52, -0.74 ) ) ) ) );
    night = vec3( macStars( rd ) ) * vec3( 0.92, 0.96, 1.18 ) * uStarAmt;
    night += band * ( macFbm( rd.xz * 6.0 + rd.y * 3.0, 1.0 ) * 0.55 + 0.18 )
             * vec3( 0.010, 0.012, 0.022 ) * uStarAmt * smoothstep( 0.03, 0.40, rd.y );
    night *= 1.0 - down;
  }

  // disc (sun or moon) plus an analytic glow. Without the glow a tiny very
  // bright disc is the *only* bloom source and UnrealBloom's mip chain turns it
  // into a visible square.
  float cd = dot( rd, uDiscDir );
  float disc = smoothstep( uDiscSize, uDiscSize + ( 1.0 - uDiscSize ) * 0.20, cd );
  float ang = acos( clamp( cd, -1.0, 1.0 ) );
  float halo = exp( - ang / max( uDiscHalo, 1e-4 ) );
  vec3 discCol = uDiscColor * ( disc + halo * uHaloK );

  vec4 cl = withDetail
    ? macClouds( rd )
    : vec4( mix( uCloudDark, uCloudLit, 0.55 ), clamp( uCloud * uCloudOpacity, 0.0, 1.0 ) );

  // Clouds sit 3 km up, so they pick up aerial perspective toward the horizon.
  // Blending them into the sky colour there is also what removes the hard
  // terminator an alpha fade would leave behind.
  float ap = 1.0 - smoothstep( 0.0, 0.34, max( rd.y, 0.0 ) );
  cl.rgb = mix( cl.rgb, col, ap * 0.92 );
  cl.a *= smoothstep( -0.035, 0.030, rd.y );

  col = mix( col, cl.rgb, cl.a );
  // Shoulder the sky and cloud deck, THEN add the disc — the disc has to stay
  // above the shoulder or bloom loses the only feature it should be keying on.
  col = macRolloff( col );
  col += night + discCol * ( 1.0 - cl.a );

  // ground half-space
  col = mix( col, col * uGroundTint, down );
  return max( col, vec3( 0.0 ) );
}
`;

export const SKY_DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = ( modelMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export const SKY_DOME_FRAG = /* glsl */ `
varying vec3 vDir;
${ATMO_PARS}
void main() {
  gl_FragColor = vec4( macrionSky( vDir, true ), 1.0 );
}
`;

/**
 * LUT pass. u = azimuth angle to the key light (0..PI), v = warped elevation.
 * The warp (signed sqrt) puts most of the resolution near the horizon where
 * aerial perspective actually lives.
 */
export const AERIAL_LUT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

export const AERIAL_LUT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uKeyAzXZ;
${ATMO_PARS}
void main() {
  float vy = vUv.y * 2.0 - 1.0;
  float dy = sign( vy ) * vy * vy;
  float ce = sqrt( max( 1.0 - dy * dy, 0.0 ) );
  float phi = vUv.x * MPI;
  vec2 s = uKeyAzXZ;
  vec2 pp = vec2( -s.y, s.x );
  vec2 dxz = s * cos( phi ) + pp * sin( phi );
  vec3 dir = vec3( dxz.x * ce, dy, dxz.y * ce );
  vec3 c = macrionSky( dir, false );
  gl_FragColor = vec4( c, 1.0 );
}
`;
