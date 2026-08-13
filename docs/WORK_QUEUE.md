# Macrion Work Queue

The lead executes this top-down. A cron job wakes the session periodically to keep the
queue full. **Goal: agents are always running.** Idle time is wasted budget window.

Read with `docs/BUILD_PLAN.md` (model routing), `docs/STORY.md` (canon),
`docs/GAME_DESIGN.md` (progression), `docs/QUALITY_BAR.md` (visual bar).

---

## Standing rules for the lead when a cron fires

1. **Check what's already running first.** Do not double-spawn a wave that is still in
   flight. If ≥3 agents are live, do nothing but report and reschedule.
2. **Commit and push after every agent lands.** Non-negotiable — seven agents' work was
   nearly lost to a spend limit on 2026-08-13. `git add -A && git commit && git push`.
3. **Verify with a capture before believing any report.** `node tools/shots.mjs`.
4. **Regenerate and republish the progress page after each wave** so the user always has
   something real to look at, with the launch link intact.
5. **Route by cost** — Opus only for novel architecture, Haiku for bounded work inside an
   existing contract, Sonnet for judgment. See `BUILD_PLAN.md`.
6. **Prefer fewer, longer, completable agent scopes** over many short ones. A builder that
   dies at 80% wastes more than one that finishes a smaller brief.

---

## WAVE 1 — Repair and verify what already exists

Everything here already has code on disk from the interrupted run. **Repair and verify
before building anything new** — we do not know what actually works.

| # | Agent | Model | Scope |
|---|---|---|---|
| 1.1 | **Oz character repair** | Opus | `src/entities/character/*` renders but the surface is shredded and the face unfinished. Repair topology and skin weights, then re-target the design to **Oz Macrion** per `docs/STORY.md` — anime-styled sculpted hair readable as a silhouette in `backlit`, sword and flute visible, royal-but-travelling wardrobe. Verify at the `hero` and `portrait` shots. This is the biggest single job in the queue. |
| 1.2 | **Audio verify + finish** | Sonnet | Six modules exist (`synth, score, music, ambience, sfx, audio`), never run end to end. Verify they load, produce sound, and don't throw. Wire the music state machine from `GAME_DESIGN.md`: `explore → alert → combat → boss → resolve`. Compose **Sarah's motif** — the recurring theme from `STORY.md` that must return at every major beat. |
| 1.3 | **Game systems verify + finish** | Sonnet | `story.js, quest.js, dialogue.js, interaction.js, eventBus.js` exist, unverified. Verify end to end. **Replace placeholder story content with the real canon** from `docs/STORY.md`. Author Act 0 (the flute and the Great Head) and Act 0.5 (descent, first Snagulas, Sarah's song) as real quest data. |
| 1.4 | **HUD + cutscenes verify** | Haiku | `hud.js/hud.css` and `cutscene.js/cutscene-data.js` exist, unverified. Confirm HUD hides completely under `hud(false)` — capture must contain zero HUD pixels. Confirm cutscene camera authority releases cleanly and never soft-locks. |

**Wave 1 gate:** all eleven capture poses render, zero console errors, captures bit-identical
between runs, perf inside budget. Commit and push. Republish progress page.

---

## WAVE 2 — Make it a game

| # | Agent | Model | Scope |
|---|---|---|---|
| 2.1 | **Snagula enemies** | Haiku | The common enemy from `STORY.md`: man-sized, **green**, **sharp teeth**, **red eyes**. Build 3+ distinct types sharing one generator. Reuse the character rig — do not duplicate it. Instanced, LOD'd, inside the perf budget. |
| 2.2 | **Combat system** | Sonnet | Sword melee with real hit detection, damage, hit reactions and death. Enemy AI: idle → notice → approach → attack → stagger. Must feel responsive; input latency is what players judge. Emit events on the game bus so audio and HUD react. |
| 2.3 | **Player controller finish** | Sonnet | Verify and finish `controller.js`. Third-person rig, terrain collision, camera boom that never clips the ground, acceleration curves, `setPose` driving the character. Tune the feel — this is judged in the first five seconds. |

**Wave 2 gate:** the player can walk out of the castle, meet Snagulas, and fight them.

---

## WAVE 3 — Act 0 and Act 0.5 content

| # | Agent | Model | Scope |
|---|---|---|---|
| 3.1 | **The Great Head of Macrion** | Opus | A giant ghostly head, superior and immensely powerful, the last essence of a sage bound into the land. Must look genuinely impressive — it is the game's first spectacle. Appears when Oz plays the flute. |
| 3.2 | **Sarah's apparition** | Opus | She must read as **a spirit from her very first appearance** — that is what makes the Act III twist fair. Ghostly rendering, haunting music tied to her motif. |
| 3.3 | **Sand Kingdom boss + first power** | Sonnet | First boss encounter. Per `GAME_DESIGN.md`, the power granted must be **exactly what is needed** for the road ahead — a key for a specific lock, not a stat bump. Reward cutscene plus a breathtaking view afterwards. |

---

## WAVE 4 — Cinematics and critique

| # | Agent | Model | Scope |
|---|---|---|---|
| 4.1 | **Intro cutscene** | Sonnet | The flute, the forest, the Great Head, the charge, the descent. Spline camera, letterboxing, golden hour. |
| 4.2 | **Boss reward cutscene** | Haiku | The Act I reward beat: win → cutscene → level up → power → the view ahead with the next paths visible in it. |
| 4.3 | **Blind critic — visual** | Sonnet | Re-score R1–R6 against `QUALITY_BAR.md` on fresh captures. Image-first, source second, one gap. |
| 4.4 | **Blind critic — character** | Sonnet | Score Oz specifically at `hero` and `portrait`. Silhouette, topology, deformation, material, how he sits in the world. |

---

## WAVE 5 — Refine against critics

Spawn refine builders against whatever the Wave 4 critics return. One gap each, highest
leverage first. Then re-score.

---

## Later phases (not this session)

Per `GAME_DESIGN.md`: Act I remaining bosses (Badlands, Water Coastline) → Act II five paths
with five items and puzzles → Act III Sallenties and the twist → the end card to
solomonchrist.com → level editor → 4-player WebRTC multiplayer with voice, text and webcams.
