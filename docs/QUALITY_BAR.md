# Macrion Quality Bar — the "PS4-native" rubric

## Why this file exists instead of reference screenshots

The goal names Final Fantasy XV and God of War as the visual tier. Those frames are
copyrighted, so this project does **not** ship, embed, or compare against captured frames
from either game. Instead, the visual tier is encoded here as a **measurable rubric** derived
from the publicly-documented rendering techniques those engines used (Luminous Engine and
Santa Monica's engine both have published GDC/SIGGRAPH talks). Critics grade against this
rubric, not against pixels from a shipped game. Everything Macrion renders is generated
from scratch in code — no external asset packs, no scanned textures, no ripped models.

"Beats the bar" therefore means: **a rendering engineer looking at the frame would place it
in the PS4 generation**, not "it is pixel-similar to a specific FFXV screenshot."

---

## R1 — Lighting & tonemapping (weight: 25)

The single biggest tell of pre-PS4 rendering is flat, LDR, gamma-space lighting.

| # | Criterion | Fail looks like | Pass looks like |
|---|---|---|---|
| 1.1 | Physically-based direct light with real-world-scale intensities | `DirectionalLight(0xffffff, 1)` | Sun ~2–6 lux-scaled, `useLegacyLights=false` |
| 1.2 | Filmic tonemapping, not linear/clamped | Blown-out white sky, crushed blacks | ACESFilmic or AgX, exposure tuned per time-of-day |
| 1.3 | Correct color space | Muddy, washed albedo | `outputColorSpace = SRGBColorSpace`, textures tagged |
| 1.4 | Image-based ambient (sky-driven), not constant ambient | `AmbientLight` flat fill | Procedural sky → PMREM env map, ambient reads directional |
| 1.5 | Sky is a real scattering model, driven by sun elevation | Flat gradient / solid color | Rayleigh+Mie, horizon warms as sun drops, zenith stays deep |

## R2 — Shadows & contact (weight: 20)

| # | Criterion | Fail | Pass |
|---|---|---|---|
| 2.1 | Cascaded shadow maps (≥3 cascades) covering 200m+ | Single 50m shadow frustum, popping | CSM with stable texel snapping |
| 2.2 | Soft, non-shimmering shadow edges | Hard aliased jaggies, crawling | PCF/PCSS, normal-bias tuned |
| 2.3 | Contact darkening where geometry meets ground | Objects float, appear pasted on | AO term (SSAO or baked) grounds every object |
| 2.4 | Shadows on foliage/grass, not just hero props | Grass unlit slab | Grass receives + casts (or fakes) shadow |

## R3 — Terrain & world scale (weight: 20)

| # | Criterion | Fail | Pass |
|---|---|---|---|
| 3.1 | Visible draw distance ≥ 1.5 km with readable silhouettes | Fog wall at 100m | Layered distance: mid-ground, ridgeline, far peaks |
| 3.2 | Multi-octave terrain with erosion-like character | Single sine bump / flat plane | fBm + ridged noise, slope-aware |
| 3.3 | Slope/height-based material blending, ≥3 layers | One green material everywhere | Grass→dirt→rock by slope, blended not stepped |
| 3.4 | Aerial perspective / height fog that reads as *distance*, not haze | Uniform gray fog | Depth+height fog tinted by sun direction |
| 3.5 | Ground detail near camera holds up at eye height | Smeared low-res plane | Detail normal/texture breakup within 15m |

## R4 — Foliage & density (weight: 20)

The FFXV "grass field" look is fundamentally a **density + wind + lighting-response** problem.

| # | Criterion | Fail | Pass |
|---|---|---|---|
| 4.1 | ≥150k grass blades visible, instanced | Sparse quads, visible grid | GPU instancing, jittered placement, no lattice pattern |
| 4.2 | Wind animation with coherent gusts, not per-blade jitter | Everything wiggling in sync/noise | Directional gust field, blade-scale secondary motion |
| 4.3 | Translucency / backlit scatter on foliage | Grass reads as opaque plastic | Sun-behind grass glows at rim |
| 4.4 | Density falloff + LOD without visible pop | Blades pop in at fixed radius | Smooth scale/alpha fade to horizon |
| 4.5 | Color variation across the field | Uniform single green | Per-instance hue/value variance, patchy clustering |

## R5 — Post & atmosphere (weight: 15)

| # | Criterion | Fail | Pass |
|---|---|---|---|
| 5.1 | Bloom on genuinely-HDR pixels only | Whole image glowing/hazy | Threshold above 1.0, tight falloff |
| 5.2 | Temporal or high-quality AA | Crawling stair-step edges on grass | TAA/SMAA; FXAA is the floor, not the target |
| 5.3 | Subtle grade: contrast curve + slight desaturation in shadows | Raw sRGB | LUT or curve, cinematic shadow tint |
| 5.4 | No banding in sky gradients | Visible bands at horizon | Dither/noise applied post-tonemap |

## R6 — Time-of-day & weather range (weight: 20)

The zone is one terrain that must convincingly span both reference art directions —
FFXV golden-hour arid scrubland and God of War cold misty highland — as world state, not as
two different levels. This section is graded across the `dawn` / `overcast` / `storm` /
`night` shots.

| # | Criterion | Fail | Pass |
|---|---|---|---|
| 6.1 | Each preset reads as a genuinely different condition, not a colour filter | Same frame, tinted | Light direction, contrast, haze depth and material response all shift |
| 6.2 | Sky-dominant lighting carries the scene when the sun is suppressed | Overcast/storm go flat and dead | Env-map ambient is directional enough to model form at `sunMul` 0.12–0.28 |
| 6.3 | Surface wetness responds to `weather.wet` | Albedo unchanged in storm | Darkened albedo, lowered roughness, pooling in concavities by mask — not uniform |
| 6.4 | Night is authored, not just dark | Pure black, or flat blue mud | Cool moon key, visible stars, lifted tinted blacks, terrain layers still legible |
| 6.5 | Golden hour survives the added range | Hero shot diluted to serve the average | `backlit` at 17.4 remains the strongest frame in the set |
| 6.6 | Transitions are continuous | Presets snap between unrelated states | Dials interpolate; intermediate values produce plausible intermediate weather |

## Performance gate (hard fail if missed)

- **≥ 55 FPS at 1920×1080** on integrated-class GPU budget, measured over a 3s window.
- **≤ 400 draw calls** in the default shot.
- No frame-time spike > 50ms after warmup.

A frame that scores well on R1–R5 but misses the performance gate **does not pass**. PS4-tier
means PS4-tier *at frame rate*.

---

## Scoring

Each criterion is scored 0–4:
- **0** — absent
- **1** — attempted, reads as wrong
- **2** — present, reads as last-gen
- **3** — reads as PS4-tier
- **4** — reads as PS4-tier and is a highlight of the frame

Rubric score = weighted mean, normalized to 100.
**Ship gate for a system: ≥ 78/100 with no criterion below 2.**

## Critic protocol

1. Never read the builder's source before scoring. Score the **image** first.
2. Score all criteria in the assigned rubric sections, with a one-line justification each.
3. Then, and only then, open the source to diagnose.
4. Report exactly **one** highest-leverage gap — the change that moves the most rubric weight
   for the least work. Not a list. One.
5. State the gap as a concrete engineering directive, not an aesthetic wish.
