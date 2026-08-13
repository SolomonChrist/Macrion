# Macrion

**A PS4-tier 3D game engine built from scratch in Three.js — by AI, directed by a human.**

No asset packs. No downloaded textures. No sample audio. No borrowed models. Every mesh,
shader, texture, sound and note in Macrion is generated procedurally in code.

> **[Read the Playbook →](PLAYBOOK.md)** — every prompt used to build this, copy-pasteable,
> so you can reproduce the method on your own project.

---

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:5188**.

**Controls** — click to capture the mouse, then:

| Key | Action |
|---|---|
| `W` `A` `S` `D` | move · `Q` `E` down/up · `shift` sprint |
| mouse wheel | camera speed |
| `F` | free camera on/off |
| `1`–`9` | jump to a named capture pose |
| `,` `.` | time of day, ±30 min |
| `T` | cycle weather: clear → hazy → overcast → storm |
| `H` | hide the control panel |

Try `3` then hold `.` to walk the sun down through golden hour. Try `1` then tap `T` four
times to swing the same terrain from arid scrubland to storm. Try `9` for night.

---

## What's in the engine

- Nishita atmospheric sky — Rayleigh + Mie single-scattering raymarch, turbidity-driven
- Scattering-based aerial perspective from a sky-rendered LUT, with per-channel extinction
  and sun-angle inscatter weighting
- 3-cascade shadow maps with texel snapping
- Sky-driven PMREM image-based ambient, cached per (time, weather) with an LRU
- 7-ring terrain clipmap: 0.5 m cells at the camera out to 32 m at the 4 km edge
- Six terrain material layers blended by slope **and** three decorrelated noise masks,
  with triplanar detail normals and wetness pooling by concavity
- ~9,500 clustered scatter instances placed by a thresholded product of two noise fields
- Full day/night cycle with a moon on its own arc, star field and Milky Way band
- Depth-reconstructed ambient occlusion, thresholded bloom, SMAA, weather-aware split-tone grade
- Weather as normalized dials — `cloud, turbidity, haze, sunMul, wind, wet, precip`

**Measured:** 83–111 fps at 1920×1080, 168–222 draw calls against a 400 budget, ~4.2M
triangles, on a GTX 1660 Ti. Captures verified bit-identical between runs.

---

## The method

Quality was made **measurable before any engine code was written**:

| File | Job |
|---|---|
| [`docs/QUALITY_BAR.md`](docs/QUALITY_BAR.md) | 6 weighted rubric sections, 0–4 per criterion, 78/100 ship gate |
| [`docs/CAPTURE_CONTRACT.md`](docs/CAPTURE_CONTRACT.md) | The `window.MACRION` API every build must expose |
| [`tools/shots.mjs`](tools/shots.mjs) | Playwright harness — boots the app headless, drives fixed poses, writes PNGs + fps/draw-call/triangle stats |
| [`tools/progress.mjs`](tools/progress.mjs) | Generates the progress page from real capture data |

Then **builder** agents built, and separate **critic** agents scored the images *blind* —
forbidden from reading source until after scoring.

The result that proves it works: two critics, different rubric sections, no contact with each
other, independently traced the project's dominant defect to the same function in the terrain
shader. One found it as shadow shimmer, the other as ground-detail failure. One root cause,
four broken criteria, invisible to casual inspection.

```bash
node tools/shots.mjs          # capture every named pose + stats
node tools/progress.mjs       # regenerate the progress page
```

---

## Docs

- **[PLAYBOOK.md](PLAYBOOK.md)** — every prompt, copy-pasteable. Start here.
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — progression design, music states, cutscene
  placement, level editor, multiplayer
- [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) — round plan and model-routing policy
- [docs/REFERENCE_ANALYSIS.md](docs/REFERENCE_ANALYSIS.md) — how reference frames were turned
  into engineering directives

---

## Status

Scene Foundation is built and running. Character, NPCs, enemies, quest, audio, HUD and
cutscenes are partially built — their modules are in the tree but unverified. See
[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) for what's next.

## A note on references

Development graded output against frames from commercial games, held **locally only**. Those
frames are copyrighted and are deliberately **not** included in this repository, not
redistributed, and nothing was copied out of them. They informed engineering targets —
aerial perspective behaviour, shadow luminance floors, scatter clustering — written up in
`docs/REFERENCE_ANALYSIS.md`. Everything Macrion renders is original and generated in code.

---

Built with [Claude Code](https://claude.com/claude-code).

**More on AI + Automation → [solomonchrist.com](https://www.solomonchrist.com)**
