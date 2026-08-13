# Capture Contract

Every Macrion build MUST expose `window.MACRION` so the screenshot harness and critic
agents can drive it deterministically. Breaking this contract breaks the gauntlet loop.

```ts
window.MACRION = {
  ready: boolean,              // flips true after first frame is fully rendered
  version: string,             // e.g. "scene-foundation.r2"

  SHOTS: string[],             // names of available camera poses

  // Snap camera to a named pose. Must be instant (no lerp) and idempotent.
  setShot(name: string): void,

  // Set time of day in hours, 0..24. Must fully update sun, sky, env map, exposure.
  setTime(hour: number): void,

  // Force N frames to render synchronously-ish; resolves when settled.
  // Used to let TAA/wind/LOD converge before capture.
  settle(frames: number): Promise<void>,

  // Perf + scene stats for the current frame.
  stats(): {
    fps: number,               // rolling average over last 60 frames
    ms: number,                // rolling average frame time
    drawCalls: number,
    triangles: number,
    programs: number,
    renderer: string,          // UNMASKED_RENDERER_WEBGL string
  },

  hud(visible: boolean): void, // hide HUD before capture
};
```

## Required shots (Scene Foundation)

Named poses must exist and stay stable across iterations so A/B diffs are meaningful.

| Shot name | Intent | Rubric sections it exercises |
|---|---|---|
| `vista` | Hero wide, camera 12m up, looking across valley to far ridge | R1, R3, R5 |
| `eye` | Player eye height 1.7m, standing in grass, horizon at 1/3 | R3.5, R4, R2.3 |
| `backlit` | Sun low and directly ahead, grass between camera and sun | R4.3, R5.1, R1.2 |
| `grazing` | Sun ~15° elevation, camera perpendicular — long shadows across terrain | R2.1, R2.2, R3.3 |
| `topdown` | 60m up, 45° down — reveals tiling, LOD rings, density falloff | R3.2, R4.1, R4.4 |
| `dawn` | vista pose at 06:24, hazy — cold blue dawn, mist pooling in valleys | R1.5, R3.4 |
| `overcast` | grazing pose at 12:00, overcast — flat diffuse sky-dominant light | R1.4, R2.3 |
| `storm` | eye pose at 13:00, storm — heavy haze, wet ground, hard wind | R1.2, R3.3, R5.3 |
| `night` | vista pose at 22:00 — moonlight, no sun, must not go pure black | R1.2, R5.4 |

## Weather

`setWeather(name | overrides)` sets normalized authoring dials that every module maps into its
own domain. Presets live in `WEATHER` in `src/core/engine.js`:

| Dial | Meaning |
|---|---|
| `cloud` | 0–1 cloud cover |
| `turbidity` | atmospheric scattering turbidity |
| `haze` | aerial-perspective density multiplier |
| `sunMul` | direct sun intensity multiplier |
| `wind` | 0–1 wind strength for foliage/cloth |
| `wet` | 0–1 surface wetness — darkens albedo, raises specular |
| `precip` | 0–1 precipitation rate |

Presets: `clear`, `hazy`, `overcast`, `storm`. Modules respond via an optional `onWeather(ctx)`
hook; `setWeather` also re-runs every module's `onSun(ctx)` afterwards.

**The zone must read convincingly across the full time × weather range** — a look that only
holds at one hour with one preset does not pass.

## Rules

- `setShot` + `setTime` must be **pure**: same inputs → identical frame, every run.
- No `Math.random()` at runtime without a seeded RNG. Seed must be fixed and documented.
- Animation (wind, clouds) must be driven by an explicit clock the harness can pin, so
  captures are reproducible. Expose it as `MACRION.setClock(t: number)` if animated.
- The HUD must be hidden by `hud(false)` before any capture.

## Running a capture

```bash
npm run shots               # all shots, default time, → captures/<timestamp>/
npm run shots -- --shot eye --time 7.5
```

Output: `captures/<run-id>/<shot>.png` plus `stats.json` with per-shot perf + scene stats.

## Perf measurement — verified hardware path

Headless Chromium on this machine renders on the **real GPU**:

```
ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti (0x00002182) Direct3D11 vs_5_0 ps_5_0, D3D11)
```

So FPS from `npm run shots` **is** meaningful and the perf gate can be enforced headless.

`stats.json` records `renderer` and `fpsTrustworthy` on every run. If a future run reports
SwiftShader / llvmpipe, `fpsTrustworthy` flips to `false` — in that case report draw calls
and triangles against budget and explicitly flag FPS as unverified rather than claiming the
gate passed.

### Hardware context for budgeting

A GTX 1660 Ti is roughly 2–2.5× a PS4 GPU. Target **60 fps at 1920×1080** here with headroom;
a scene that only just clears 60 fps on this card would not have been a PS4-native frame.
Treat 90+ fps at 1080p as the comfortable pass, 60 as the floor.
