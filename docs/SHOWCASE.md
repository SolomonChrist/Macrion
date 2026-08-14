# MACRION: FIRST LIGHT — the shippable showcase

**Directive:** the next 5-hour run must complete something that can be shown to people and
shipped. Polish comes later; *something finished* comes now.

This document defines exactly what "finished" means. Everything in MUST ships or the round
failed. Everything in COULD is cut without hesitation the moment the clock is at risk.

---

## The strategy — lead with strength, hide the long pole

Honest assessment of the build as of this round:

| Area | State | Showable? |
|---|---|---|
| Terrain, sky, atmosphere, weather, day/night | **Excellent** | Yes — this is the headline |
| Audio: adaptive score, Sarah's motif, ambience | **Written, unverified** | Yes, once verified |
| HUD, cutscene system | **Verified working** | Yes |
| Quest data, Act 0 / 0.5 flow | **Verified running** | Yes |
| Oz — body, clothing, materials | **Good** | Yes at gameplay distance |
| Oz — face, hair, props | **Weak** — face reads wrong, hair is a cap, no sword or flute | **No, not in close-up** |
| Combat, enemies, bosses | **Does not exist** | No |

**The decision that follows from this:** the showcase is built around the world and the
atmosphere, with Oz shown at **gameplay and silhouette distance where he already reads well**,
and *not* framed in portrait close-up. A broken face at 30° FOV would undo the credibility the
environment earns.

That is not hiding a flaw — it is shot selection, which is what every game trailer does.

---

## MUST — the round fails without these

### 1. Fix the movement blocker
`character.js`'s `animator.apply(time)` resets every bone absolutely from rest pose each frame,
wiping the position writes from `controller.js`, which runs after it in module order. **The
player currently cannot move.** Nothing else in this document matters until this is fixed.

The fix is an ownership decision: the animator owns *bone-local* pose; the controller owns the
character **root/group** transform. They must not both write translation to the same node.

### 2. A playable free-roam build
- Oz walks, runs and turns with a third-person camera that never clips terrain
- Full day/night (`,` `.`) and weather (`T`) control while playing
- HUD visible, audio playing
- Runs at 60+ fps

This is the thing a person can be handed. It is the product.

### 3. A cinematic showcase reel — `MACRION.systems.cutscene.play('showcase')`
A real-time, in-engine sequence of roughly 90 seconds, triggerable from the title screen and
from a key. It must:
- Sweep the basin across **dawn → golden hour → storm → night**, using the weather and
  time-of-day system, since that range is the engine's single most impressive capability
- Use spline camera moves with ease in/out — never straight lerps
- Carry **Sarah's motif** under it, and the adaptive score
- Show Oz **in silhouette and at distance**, never in portrait close-up
- End on the **end card**: `https://www.solomonchrist.com`, an invitation to the AI + Automation
  mailing list, and the statement that the entire game was made using Claude and AI

### 4. A title screen
Simple, restrained: the title, "Press any key", and the credit line. It makes the build feel
like a product rather than a demo, and it costs almost nothing.

### 5. Ship packaging
- `README.md` updated with a one-command start and a screenshot
- Everything committed and pushed to GitHub
- The progress page updated with the showcase captures and the live launch link

---

## SHOULD — do these if the MUSTs are secure

### 6. Oz's silhouette pass
Not the face. The **silhouette**, because that is what the showcase actually shows:
- Anime-styled sculpted hair that reads as a shape in `backlit` — the current moulded cap does not
- **A sword and a flute on his person.** Both are plot-critical and both are currently absent.
  The flute in particular is the Act 0 mechanic.

### 7. Act 0 playable
The flute beat, already authored as verified quest data: find it, carry it, play it at the
song-spot, the Great Head appears. This is the game's first "learn by doing" moment and it is
mostly wiring rather than new systems.

---

## COULD — cut without hesitation

- The Great Head as impressive geometry (a simple version is fine for the showcase)
- Sarah's apparition in-world
- Snagulas, combat, the first boss
- Oz's face repair

**Do not start combat this round.** Half-finished combat is worse than none — it invites the
viewer to judge the game on its weakest axis. Better to ship a beautiful world you can walk
through than a broken fight.

---

## The gate — how we know it shipped

A person who has never seen this project can:
1. Clone the repo, run two commands, and be in the game
2. Press a key and watch a 90-second reel that ends on the end card
3. Press another key and walk around the world themselves
4. Change the time of day and the weather while walking
5. Hear music that responds to what they are doing

If all five are true, the round succeeded. If Oz's face is still imperfect and there are no
enemies, **the round still succeeded** — those are the next round's job.

---

## Standing constraints, unchanged

- Three.js only. Everything procedural. No asset packs, no downloaded textures, no sample audio.
- No copyrighted material ships — the repo publicly claims this and it must stay true.
- Determinism: captures bit-identical between runs.
- Perf: 60 fps floor at 1080p, ≤400 draw calls.
- Every agent writes a heartbeat per `docs/HEARTBEAT.md`, with a hard tool-call budget and an
  instruction to report before exhausting it.
