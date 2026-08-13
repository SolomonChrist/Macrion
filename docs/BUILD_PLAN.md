# Macrion Build Plan & Model Policy

## THE DIRECTIVE — build a perfect level 1

The user's call, verbatim: *"I want depth and breadth. You should do a smaller environment with
the character and props and movement roughed in so that we can always update it but the basics
are running at the highest quality (Ex. if there are 100 levels, build out the perfect level 1)."*

This is the governing constraint. It resolves every scope question below.

**What it means concretely:**

- **Shrink the playable world, not the quality.** The heightfield already spans 4 km. Do NOT
  keep building at that scale. Author a compact playable zone — roughly **250 m × 250 m** — and
  let the existing far terrain serve as backdrop. A bounded, dense, beautiful area beats a vast
  empty one, and it is what "level 1" means.
- **Every system must be present.** Character, props, movement, interaction, polish — all
  roughed in and running. Nothing gets skipped for time.
- **Quality bar does not drop.** Everything that exists must be at the bar. The way to fit the
  budget is *less world*, never *worse world*.
- **Build for replacement.** This is level 1 of a hypothetical 100. Keep systems modular and
  data-driven so a later zone is authored, not re-engineered. Zone content should be separable
  from zone machinery.

**Practical consequence for terrain:** the LOD budget currently spent on 4 km of distant detail
should be redirected into density and fidelity inside the 250 m playable bowl — more scatter,
finer materials, real gravel near camera, foliage that holds up at 1.7 m eye height.


## Model policy — match the model to the job

Agent spend is the dominant cost of this project. Captures, the progress page, and all
verification are local and effectively free. So: **spend model capability only where judgment
is actually load-bearing.**

| Work | Model | Why |
|---|---|---|
| Shader / rendering architecture (sky, scattering, CSM, post chain, AO, LOD) | **Opus** | Novel GLSL, numerical calibration, perf tradeoffs under a hard budget. This is where capability pays for itself. |
| Blind visual critic | **Sonnet** | Needs real image judgment and rubric discipline, but is not writing complex systems. Cheaper than Opus, materially better than Haiku at "does this read as PS4-tier". |
| Procedural asset generators (trees, rocks, props, debris, foliage variants) | **Haiku** | Bounded, well-specified geometry code against an existing contract. No architecture decisions. |
| Mesh/material variants on an established pattern | **Haiku** | Pattern already exists; this is filling it in. |
| Character rig, skinning, animation system | **Opus** | Skeletal systems are subtle and expensive to get wrong. |
| UI / HUD overlay | **Haiku** | Plain DOM/CSS against a spec. |
| Perf triage on an existing regression | **Sonnet** | Measurement-driven, bounded search space. |

**Rule of thumb:** if the task is "invent the approach", use Opus. If the task is "execute a
known approach inside an existing contract", use Haiku. If the task is "judge the result",
use Sonnet.

Always give Haiku agents: the exact module contract, the file they own, a worked example of
the pattern to follow, and the verification command. Haiku underperforms on vague briefs and
does fine on precise ones — the brief quality, not the model, is usually the limiting factor.

## Cost observed so far

| Agent | Model | Tokens | Tool calls |
|---|---|---|---|
| Terrain Builder (round 1) | Opus | 447k | 182 |
| Atmosphere Builder (round 1) | Opus | 394k | 149 |

Budget ~400k for an Opus builder round. Critics should come in well under that.

---

## Round plan

### Scene Foundation — round 2 (next)
Status after round 1: 91–117 fps, ≤212 draw calls, deterministic, all nine shots rendering.
Not yet at the bar.

1. **Two blind critics in parallel (Sonnet).** One on lighting/atmosphere (R1, R2, R5), one on
   terrain/materials (R3, R4, R6). Both score the nine images from
   `captures/2026-08-13T06-36-15_r1-integrated/` BEFORE opening any source. Each returns
   exactly one highest-leverage gap.
2. **Two refine builders (Opus)** against those gaps, same file ownership as round 1.
3. Re-capture, re-score, republish.

Known gaps already banked from round 1 self-reports — hand these to the critics as context,
but do not let them substitute for independent scoring:
- R2.4 foliage shadows: scrub has no translucency, almost no grounding shadow at high sun.
- R2.3 contact darkening: depth-only AO is subtle, no bent normals, weak on thin silhouettes.
- Mid-ground 200–900 m loses layer variation under `clear` haze.
- Boulders are smooth deformed spheres — no bedding planes, no stratification.
- Near-camera ground at 1.7 m is breakup, not believable gravel.
- Cloud deck is a single flat plane with no volume.

Banked perf win, not yet taken: scrub uses `alphaTest`, forcing a real fragment shader with
heavy overdraw in the shadow depth pass. Shadow-map fill is the dominant frame cost
(14 ms swing between 3×2048² and 3×512²). A cheap `customDepthMaterial` on scrub reclaims
significant headroom — worth doing before adding grass density.

### Then, in order — all five systems ship, scoped to the 250 m level-1 zone

The user authorised running through **all five systems** unattended. Do not stop after Scene
Foundation. Take each to the bar inside the level-1 scope, then move on.

3. **Character System** — Opus for the rig/skinning/animation core, Haiku for material and
   outfit variants once the pattern exists. One original humanoid, PBR materials graded under
   the real lighting, idle + walk + run. No copyrighted likeness.
4. **Player Interaction** — Sonnet for the controller and heightfield collision, Haiku for the
   HUD overlay. Third-person camera rig with collision. Do this BEFORE environment dressing so
   the zone is authored around how the player actually moves through it.
5. **Environment Zone** — Haiku for the procedural generators (trees, rocks, debris, structures)
   one agent per asset class in parallel; Opus for zone composition and set dressing. This is
   where "level 1" becomes a place rather than terrain: landmarks, a path, a reason to walk.
6. **Visual Polish** — Opus. Foliage translucency (the FFXV backlit money shot), volumetric
   light, particles, weather VFX. Runs last so it polishes real content.

Add capture poses per system as needed, but keep the existing nine stable — they are the A/B
baseline and must stay comparable across every iteration.

### Loop discipline while running unattended

- Republish the progress page after every system so the user can see progress on waking.
- Fan out parallel agents wherever the work is genuinely independent (asset generators
  especially — they are Haiku and cheap; run them 3–4 at a time).
- Verify every claim with a capture. Never report a system passed without images and stats.
- If a builder regresses the perf gate or breaks determinism, fix that before moving on.
- Keep a running cost note in this file so the user can see where the window went.

## Standing rules for every agent

- Three.js only. Everything procedural. No asset packs, no downloaded textures, no CDN.
- No bare `Math.random()` — `makeRNG(SEED)` from `src/core/engine.js`.
- Never edit `src/core/*`, `src/main.js`, `index.html`, `tools/*`, `docs/*` — lead-owned.
- Verify with `node tools/shots.mjs --port <unique> --tag <name>` and **look at the PNGs**.
- Captures must stay deterministic and bit-identical between runs.
- Report weaknesses honestly. A critic grades this next; overclaiming wastes a round.
