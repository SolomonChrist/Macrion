# Reference Analysis — what the six frames actually demand

Source frames live in `visuals/`. They are copyrighted screenshots from Final Fantasy XV
(Square Enix) and God of War / God of War Ragnarök (Sony Santa Monica), used **locally, as a
grading reference only**. Macrion ships none of them, copies no asset from them, and derives
every texture, mesh, and material procedurally in code. Do not embed these frames in any
published or shared output.

| File | What it teaches |
|---|---|
| `gotOfWar_View.jpg` | Aerial perspective, layered mountain silhouettes, bright sky, mist |
| `godOfWar_Battle.jpg` | Ground material variation, clustered foliage, contact AO, haze-blended treeline |
| `godOfWar_BossBattle.jpg` | Heavy volumetric mist, snow particulate, emissive materials, depth separation |
| `finalFantasy_XV_1.jpg` | Backlit foliage translucency, god rays, golden-hour grade, dry-scrub terrain |
| `finalFantasy_XV_2.jpg` | Rim lighting, HDR bloom on fire/magic, particulate embers |
| `finalFantasy_XV_3.jpg` | Close-up material response — leather, skin, cloth micro-detail |

---

## The seven traits that make all six read as AAA

Ranked by how much they move the needle for **Scene Foundation**.

### 1. Aerial perspective is the single strongest signal — and it's cheap

Every frame has it. Distant geometry does not merely fog out; it **desaturates toward the sky
color and loses contrast**, while retaining silhouette.

- `gotOfWar_View`: the hero mountain keeps a crisp silhouette but its interior contrast has
  collapsed to ~15% of the foreground's. Snow reads pale blue-gray, not white.
- `godOfWar_Battle`: the treeline ~80m back is roughly 60% blended to sky color, yet you can
  still count individual trunks.

**Engineering directive:** fog must be *scattering-based*, not `mix(color, fogColor, d)` with a
flat gray. Fog color must be sampled from the sky in the view direction, and must be
**inscattering-weighted by sun angle** — brighter and warmer toward the sun, cooler away.
Add a height-falloff term so valleys pool haze and peaks stay clear.

### 2. Lifted, tinted blacks — never crushed

None of these frames have pure black. GoW shadows sit around 8–14% luminance with a distinct
**cool blue-cyan cast**. FFXV_1 shadows are warm brown-black. This is a filmic curve plus
split-toning, and its absence is the #1 reason hobby Three.js scenes look like Three.js scenes.

**Engineering directive:** ACES or AgX tonemap, then a grade pass: lift shadows to ~0.04–0.06,
tint shadows cool (`+b, +g` slightly), tint highlights warm, slight saturation *reduction* in
shadows. Never let the shadow floor hit 0,0,0.

### 3. Depth is built from 3–5 discrete silhouette layers

`gotOfWar_View` reads: foreground characters → mid platform → near ridge → hero peak → far
range. Each layer separated by a haze step. This is *composition*, not just geometry.

**Engineering directive:** terrain must deliberately produce a near ridge, a mid range, and a
far range at increasing haze steps, not one uniform noise field. The `vista` shot must show at
least three separated silhouette bands.

### 4. Nothing is uniform — ground especially

`godOfWar_Battle` sand within one square meter: pale dry sand, darker damp patches, scattered
pebbles, green algae/moss, orange dead-grass tufts, small stones. `finalFantasy_XV_1` dirt:
cracked pale clay, rock debris, grass tufts **in clusters with bare ground between them**.

**Engineering directive:** ≥3 ground layers blended by slope *and* by a low-frequency noise
mask (so the blend is patchy, not a clean altitude band). Scatter must be **clustered** —
density driven by a noise field, not uniform random. Uniform scatter density is an instant tell.

### 5. Contact darkening on every single object

Look where anything meets the ground in `godOfWar_Battle` — there is a tight dark gradient.
Without it, objects look pasted onto the terrain.

**Engineering directive:** SSAO, or at minimum a per-object contact-shadow gradient. This
matters more than shadow-map resolution.

### 6. The sky is a light source, not a backdrop

In `gotOfWar_View` the sky is near-white at the horizon and deep blue at zenith, and the
ambient on the characters clearly reads that gradient — cool from above, warm bounce from the
sunlit ground below.

**Engineering directive:** procedural sky → PMREM → `scene.environment`. Ambient must come
from the env map. A flat `AmbientLight` fails this outright.

### 7. Backlit translucency is the money shot

`finalFantasy_XV_1` is built on it: sun behind the canopy, leaves glowing, bloom blooming off
the bright edges, god rays through gaps.

**Engineering directive:** foliage needs a wrapped/subsurface term — `pow(saturate(dot(-L, V)),
p)` scaled by a thickness value, added on top of standard lighting. Reserved for the foliage
round but the **`backlit` shot must already show the sun-facing haze glow** from Scene
Foundation.

---

## Explicit non-goals for Scene Foundation

Do not build characters, creatures, combat VFX, or UI this round. The frames show them; they
are later rounds. Round 1 is judged **only** on: sky, atmosphere, terrain, ground material,
lighting, shadow, grade, and the perf budget.

## Calibration targets pulled from the frames

| Quantity | Target | Source |
|---|---|---|
| Shadow luminance floor | 0.04–0.12, tinted | all GoW frames |
| Sky zenith / horizon luminance ratio | ~4:1 | `gotOfWar_View` |
| Far-layer contrast retention | 10–20% of foreground | `gotOfWar_View` |
| Visible draw distance | 1.5–4 km with readable silhouettes | `gotOfWar_View` |
| Ground albedo variation within 1 m² | ≥3 distinguishable tones | `godOfWar_Battle` |
| Scatter clustering | patchy — bare gaps of 2–5 m between clumps | `finalFantasy_XV_1` |
