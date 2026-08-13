# The Macrion Playbook

**How to build a PS4-tier 3D game engine with Claude — every prompt, in order, copy-pasteable.**

Macrion is an original 3D game built from nothing in Three.js: no asset packs, no downloaded
textures, no sample audio, no borrowed models. Every mesh, shader, texture, sound and note is
generated in code. It was built by a lead Claude agent directing a fleet of builder and critic
subagents against a machine-checkable visual bar.

This document is the reproducible recipe. Copy the prompts, adapt the specifics, get a similar
result.

> Built with [Claude Code](https://claude.com/claude-code). Made by AI, directed by a human.
> More on AI + Automation: **https://www.solomonchrist.com**

---

## Table of contents

1. [The idea in one minute](#1-the-idea-in-one-minute)
2. [Prompt 1 — the opening brief](#2-prompt-1--the-opening-brief)
3. [Build the measuring rig first](#3-build-the-measuring-rig-first)
4. [Prompt 2 — supply reference frames](#4-prompt-2--supply-reference-frames)
5. [The builder prompt template](#5-the-builder-prompt-template)
6. [The critic prompt template — the key artifact](#6-the-critic-prompt-template--the-key-artifact)
7. [Steering prompts](#7-steering-prompts)
8. [Model routing — what to run where](#8-model-routing--what-to-run-where)
9. [The game design prompt](#9-the-game-design-prompt)
10. [Commands](#10-commands)
11. [Results, honestly](#11-results-honestly)
12. [What we'd do differently](#12-what-wed-do-differently)

---

## 1. The idea in one minute

Most "build me a game with AI" attempts fail the same way: the model writes plausible code,
nobody checks the output against anything, and quality plateaus at "technically works."

The fix is to make quality **measurable before you write any engine code**:

1. Write a **rubric** with weighted sections and numeric criteria.
2. Write a **capture contract** — an API the running game must expose so a script can drive it.
3. Write a **screenshot harness** that boots the game headless, drives fixed camera poses, and
   records images plus frame rate, draw calls and triangle counts.
4. Only then start building.
5. Have **builder** agents build, and separate **critic** agents score the *images* blind —
   before they're allowed to read the source.

The critics are the whole trick. A builder grading its own work grades its intentions. A fresh
agent looking only at a PNG grades the result.

---

## 2. Prompt 1 — the opening brief

This is the prompt that started the project. Copy it and swap the game name and reference titles.

```
GOAL:
Build a PS4-quality 3D game engine for Macrion in Three.JS, where players can explore
dynamic environments with the epic scale and visual clarity of Final Fantasy XV and God
of War. All assets, creatures, UI, and visual effects must be generated from scratch—no
copyrighted materials. The engine should be a living playground where the lead agent can
request features, and subagents iteratively improve them against a live visual bar.

QUALITY BAR:
A side-by-side screenshot comparison (A/B test) showing the current engine's environment,
character model, and lighting/particle effects next to reference frames from Final Fantasy
XV (grass fields, NPC towns, dynamic weather) and God of War (cinematic camera angles,
material details, atmospheric depth). The engine wins when the player can't distinguish
the visual tier—both look PS4-native in scale and fidelity.

LEAD AGENT INSTRUCTIONS:

You are the director of the Macrion engine build. Break this goal into the smallest,
independently shippable pieces:

1. Scene Foundation – Base terrain, lighting, camera system, frame rate baseline
2. Character System – Original humanoid model, rig, materials, idle animation
3. Environment – One complete zone with NPCs, props, interactable objects
4. Visual Polish – Particle effects, bloom, shadows, material layering, atmospherics
5. Player Interaction – Basic movement, collision, interaction system, UI overlay

For each piece:
- Assign a builder subagent with a clear spec and the quality bar
- Assign a separate critic subagent (fresh context) to inspect the real output
- Critic runs a blind A/B comparison of the output vs. the reference bar
- Critic identifies the single biggest gap and sends it back to the builder
- Loop until the builder's output beats the bar or you decide to move on

Maintain a live progress page (simple HTML artifact) that shows:
- Current iteration count for each system
- Side-by-side comparison images
- Critic's latest gap assessment
- Next action and ETA

You decide the decomposition, the number of rounds, the architecture. Use subagents
(fan out builders and critics in parallel). Three.JS only, no external asset packs.
Keep each round tight: build, critique, refine, repeat.

Start now.
```

**Why it works:** it names the systems, mandates the builder/critic split, demands a live
progress artifact, and forbids external assets. It delegates architecture to the lead rather
than over-specifying it.

---

## 3. Build the measuring rig first

Before any engine code, the lead built four things. **This is the step everyone skips and it
is the step that matters.**

| File | Job |
|---|---|
| `docs/QUALITY_BAR.md` | 6 weighted rubric sections, 0–4 per criterion, 78/100 ship gate |
| `docs/CAPTURE_CONTRACT.md` | The `window.MACRION` API every build must expose |
| `tools/shots.mjs` | Playwright harness — boots Vite, drives fixed poses, writes PNGs + stats |
| `tools/progress.mjs` | Generates the public progress page from real capture data |

### The capture contract

Every build must expose this, or the loop doesn't work:

```js
window.MACRION = {
  ready: boolean,          // true after the first frame renders
  SHOTS: string[],         // named camera poses
  setShot(name),           // snap to a pose — instant, idempotent
  setTime(hour),           // 0..24, updates sun, sky, env map, exposure
  setWeather(name),        // 'clear' | 'hazy' | 'overcast' | 'storm'
  setClock(t),             // PIN animation time — critical for determinism
  settle(frames),          // let TAA/wind/LOD converge before capture
  stats(),                 // { fps, ms, drawCalls, triangles, renderer }
  hud(visible),            // hide all overlay chrome before the shutter
};
```

### Three non-obvious lessons

**Pin the clock.** Without `setClock()`, wind and cloud phase differ per run and two captures
of the same scene aren't comparable. Verified fix: hash two runs of the same shot; they must
be byte-identical.

**Check what GPU headless actually uses.** Everyone assumes headless Chromium means software
rendering. On this machine it reported
`ANGLE (NVIDIA GeForce GTX 1660 Ti, D3D11)` — a real GPU, so frame rate was a genuine
measurement, not noise. Record `renderer` in your stats and flag it if it falls back.

**Give exactly one system camera authority.** Once you have a debug fly camera, a player
controller and a cutscene system, they will fight. A `mode` flag (`shot` / `free` / `play` /
`cutscene`) fixes it, and captures stay in `shot` forever because they send no input.

---

## 4. Prompt 2 — supply reference frames

```
I added all the visual examples to test against inside of the visuals folder as jpeg
images. take a look and let me know if you have any questions
```

The lead then wrote `docs/REFERENCE_ANALYSIS.md`, converting the frames into ranked
engineering directives. The top four, which generalise to any realistic 3D scene:

1. **Aerial perspective is the strongest signal and it's cheap.** Distant geometry must
   desaturate *toward the sky colour* and lose contrast while keeping its silhouette. Fog
   colour sampled from the sky per view direction, inscatter-weighted by sun angle — not
   `mix(color, grey, d)`.
2. **Never crush blacks.** Reference shadows sit at 8–14% luminance with a colour cast. Lifted,
   split-toned blacks are the #1 tell separating AAA from hobby renderers.
3. **Nothing is uniform.** One square metre of reference ground has 3+ distinguishable tones.
   Vegetation grows in **clumps with bare gaps**. Uniform scatter density reads as procedural
   instantly.
4. **Depth is 3–5 discrete silhouette layers**, each separated by a haze step. Compose them
   deliberately; don't generate uniform noise and hope.

> **On copyright:** reference frames from commercial games are used *locally, for grading only*.
> They are never redistributed, never embedded in published output, and nothing is copied out of
> them. Every asset in Macrion is generated procedurally in code.

---

## 5. The builder prompt template

Used for the atmosphere, terrain and character builders. Substitute the bracketed parts.

```
You are the <ROLE> BUILDER for <PROJECT>, a from-scratch Three.js renderer targeting
PS4-native visual fidelity.

## Read these first, in order
1. docs/REFERENCE_ANALYSIS.md — the engineering translation of the reference frames.
2. docs/QUALITY_BAR.md — the rubric you will be graded against. You own sections <X>.
3. docs/CAPTURE_CONTRACT.md — how your work gets measured.
4. src/core/engine.js — the engine core. READ IT. Do not edit it.
5. The reference images in visuals/. You have image-reading ability; use it.

## Files you OWN (edit only these)
<list>

## Files you MUST NOT touch
<list>. Other builders are editing concurrently in this same tree. If a capture fails
because their module is mid-edit, wait and re-run — do not "fix" their file.

## Your mandate
<numbered items — for each one, name the FAILURE MODE as well as the goal>

## Verification — mandatory, do not skip
Run: node tools/shots.mjs --port <N> --tag <name>
- Read the PNGs you produce. Iterate on what you actually SEE, not what you intended to write.
- stats.json must show zero consoleErrors.
- Headless Chromium here uses the real GPU, so FPS is trustworthy. Target 90+ fps at 1080p,
  hard floor 60.
- Iterate at least 3 capture→look→fix cycles. Your first output will not be good enough.

## Standing rules
- Three.js only. Everything procedural. No asset packs, no downloaded textures, no CDN.
- No bare Math.random() — use the seeded RNG exported from engine.js.
- Determinism: same shot + same hour must produce an identical frame every run.

## Report back
What you built, final per-shot FPS/draw-call/triangle numbers, paths to your captures, which
rubric criteria you're still weak on, and anything you cut for performance. Be honest about
weaknesses — a critic with fresh eyes grades this immediately, and overclaiming wastes a round.
```

**The three lines that do the most work:**
- *"Read the PNGs you produce. Iterate on what you actually see, not what you intended to write."*
- *"Iterate at least 3 capture→look→fix cycles. Your first output will not be good enough."*
- *"Be honest about weaknesses — a critic grades this immediately, and overclaiming wastes a round."*

That last line changes behaviour measurably. Builders returned genuinely self-critical reports,
including one that diagnosed a defect in *another* builder's module and proved it with
measurements.

---

## 6. The critic prompt template — the key artifact

This is the single highest-leverage prompt in the project.

```
You are a BLIND VISUAL CRITIC for <PROJECT>. You are not a builder. You do not fix anything.
You score, and you find the one gap that matters most.

## Your assigned rubric sections
<sections>. A second critic is independently covering <other sections> — do not stray.

## CRITICAL — the protocol, in this order. Do not deviate.

### Step 1: Look at the reference frames
<paths>. Calibrate your eye. Copy nothing.

### Step 2: Score the images — BEFORE reading any source code
<capture directory>

You must not open any file under src/ until you have finished scoring. The whole point of a
blind critique is that you judge the image, not the intent behind it. If you read the shader
first you will start grading the effort instead of the result.

Score every criterion with a one-line justification tied to a specific image and a specific
region of it. Be specific: "the shadow terminator on the mid-left ridge in grazing.png
shimmers" beats "shadows look bad".

Be a hard marker. 3 means "reads as PS4-tier". Most first-round work is a 2. Do not inflate —
an inflated score wastes the next build round, which is expensive.

### Step 3: Only now, read the source
Diagnose WHY your lowest-scoring criteria are low.

### Step 4: Report exactly ONE gap
Not a list. One. The single change that moves the most rubric weight for the least work.
State it as a concrete engineering directive — name the file, the mechanism, and what the
frame should look like afterwards. If two things tie, pick the one that shows up in more shots.

## Report format
1. Scored table: criterion, score 0–4, one-line justification.
2. Weighted subtotal normalized to 100.
3. Your single highest-leverage gap, as a directive.
4. Two or three sentences on what is genuinely working — the builder needs to know what not
   to break.

Be blunt and specific. Vague praise is worse than useless here.
```

### The result that proves it works

Two critics ran with this prompt. Different rubric sections. No contact with each other.
Neither allowed to read source before scoring.

**They independently traced the project's dominant defect to the same function.**

One found it as shadow shimmer (scored 1/4). The other found it as ground-detail failure
(scored 1/4). Both landed on `macRelief()` in the terrain shader: un-band-limited noise
octaves faded only by world-space distance, so past ~30 m one screen pixel spanned many noise
cycles and the bump aliased into a corduroy ripple. Because it fed the shading normal it
corrupted direct light *and* ambient — visible in 7 of 9 shots, depressing four separate
criteria.

**One root cause. Four broken criteria. Found by two agents who couldn't see the code.**

The fix — screen-space band-limiting via `fwidth` — took one round. The builder then found a
third contributor neither critic named: a fixed 0.11 m finite-difference step in the normal
gradient that beat against the sub-metre octaves.

**Design notes that matter:**
- *"You must not open any file under src/ until you have finished scoring."* Without this the
  critic reads the shader, sees good intentions, and grades the effort.
- *"Report exactly ONE gap. Not a list. One."* Lists produce shallow scattered fixes. One gap
  produces a real fix.
- *"Be a hard marker... an inflated score wastes the next build round."* Tying the score to a
  downstream cost stops grade inflation.
- Running two critics on **different rubric sections** turns agreement into signal.

---

## 7. Steering prompts

Real prompts used mid-build, and what each one did.

### Choosing an art direction
The lead offered three options; this answer expanded scope deliberately:

```
Both — build a day/night + weather system
```

This turned two competing art directions into **one terrain under different world state**.
Weather became normalized dials — `cloud, turbidity, haze, sunMul, wind, wet, precip` — that
each module maps into its own domain. Golden-hour scrubland and cold misty highland became
`haze: 0.55, sunMul: 1.00` versus `haze: 2.40, sunMul: 0.12`.

### Scoping to something achievable

```
I want depth and breadth. You should do a smaller environment with the character and props
and movement roughed in so that we can always update it but the basics are running at the
highest quality (Ex. if there are 100 levels, build out the perfect level 1)
```

**The best steering prompt in the project.** It resolved every scope question at once: shrink
the world, keep every system, never lower the bar. *Less world, never worse world.*

### Pivoting from polish to breadth

```
note that instead of doing a refining round 2 on terrain (Which already looks great) you need
to do ALL the other working parts for phase 1 including adding in the main player character,
the npcs, the enemy characters, the level progression, the first major quest, the sounds, the
music, the storyline and cutscenes, this needs to have the functionality running before you
run the next pass on the same areas again
```

Polish loops are seductive and can absorb unlimited budget. Getting every system *running* at
rough quality beats one system at high quality, because you can't tell what actually needs
polish until the whole thing exists.

### Controlling cost

```
be wise about usage, if a subagent can be run with Haiku then let it run with Haiku, save
tokens so we can run longer and get the job done. For example if its a tree, it shouldn't
require a full Opus 5 at highest thinking to do something like that.
```

```
we have around 50% usage left and resetting in about 3.5 hours, make use of what you can while
also being smart about it. Areas where you can use Haiku for things can be helpful and then
route to higher models when higher models are required
```

### Demanding a live test link

```
on the progress view I should have a clickable link in there to TEST the entire production
thus far so I can see for myself the current progress of the entire system. Always have this
available for me for every update you do to the progress.
```

### Mid-flight redirect pattern

When scope changes while agents are still running, message them rather than letting them finish
obsolete work:

```
SCOPE CHANGE from the lead — read before you finalize.
<what changed and why>
<what to do now, numbered>
<what to explicitly SKIP>
Do not leave the tree broken — other builders depend on it rendering.
Keep the report short.
```

---

## 8. Model routing — what to run where

Agent spend dominates cost. Local verification is free. Spend capability only where judgment
is load-bearing.

| Work | Model | Why |
|---|---|---|
| Shader/rendering architecture, character rig + skinning | **Opus** | Novel GLSL, numerical calibration, perf tradeoffs under a hard budget |
| Blind visual critic | **Sonnet** | Needs real image judgment and rubric discipline, not complex systems |
| Game logic, quest/dialogue, player controller, audio synthesis | **Sonnet** | Design judgment, bounded implementation |
| Procedural asset generators, HUD/DOM, cutscene timeline | **Haiku** | Bounded work inside an existing contract |

**Rule of thumb:** invent the approach → Opus. Execute a known approach inside an existing
contract → Haiku. Judge the result → Sonnet.

**Observed costs:** Opus builder ≈ 390–450k tokens per round. Sonnet critic ≈ 105k. Haiku
considerably less.

**Haiku's limiting factor is brief quality, not capability.** Give a Haiku agent the exact
contract, the file it owns, a worked example, and the verify command, and it performs well. Give
it a vague brief and it doesn't.

---

## 9. The game design prompt

The full progression design, given as a single prompt. Reproduced because the structure is
reusable for any action-adventure:

```
You need to make sure the game has full progression. Not too frustrating that the player wants
to rage quit. Not too boring that its too easy. Right in between frustration and boredom is
"FUN" and we want to keep players engaged.

As players enter an area with enemies the music needs to change to a heightened awareness. When
entering a boss area the music should transition to epic.

The cut scenes should happen after basic fights and most definitely after boss battles or in
EPIC locations. There should be views that are utterly breathtaking and those should definitely
be cutscenes and opportunities to show the player stunning experiences. They should come after
big battles so that players feel rewarded for their battles.

After each boss battle have them level up and give them a new super power. Each power increases
but is JUST EXACTLY AND UTTERLY what was needed to defeat the next boss ahead as well as the
enemies to come. This progression style makes the player increase after every battle and after
every boss. Every upgrade makes the user curious to test out their new skill and level up.

The players enter the game world running around and learning by DOING. The game should start
with the players just exploring and then realizing they have a special weapon or power that
they can now use against the first round of enemies. They should be taught how to fight and
battle and then use that habit again to destroy enemies and the first boss.

After that a cut scene should show up and again a new upgrade and a beautiful view ahead and
several paths that lead to various weapons and special powers. They need to go through those
progressions and then after solving all 3 of them (which all give a puzzle or interactive piece
to a puzzle) they then can combine to open up a boss battle and the next round which could lead
to 5 paths, 5 mini bosses and 5 areas with different enemy types. Each area leads to another
amazing view and storyline as all 5 paths converge onto a FINAL mega boss that will end the
game off with a beautiful cut scene.

Add a full level editor built in that allows players to throw bosses and enemies into the game
and make their own game.

Add multi-player capabilities allowing up to 4 players with voice chat and text chat within the
game, direct connections using WebRTC, with all 4 webcams showing up (which can be turned off
and replaced with avatars).
```

**The mechanic worth stealing:** *every power granted is exactly and utterly what is needed to
beat the boss ahead.* Not a stat bump — a specific key for a specific lock. Design the boss
first, then the power that beats it, then the enemies that let the player rehearse it. That's
what keeps the player inside the flow channel between frustration and boredom.

The full expansion lives in `docs/GAME_DESIGN.md`.

### The story prompt

Delivered as a single freehand prompt covering the protagonist, the full cast, the world
geography, the three-act structure and the ending twist. Structured into canon in
`docs/STORY.md`. The reusable shape of it:

```
[PROTAGONIST] — age, build, distinctive visual feature, training, temperament.
[ORIGIN] — the backstory that pays off at the very end, not at the start.
[INCITING INCIDENT] — the object they seek, the guide they wake, the charge they accept.
[THE HOOK] — the thing they fall in love with in the first ten minutes.
[ACT I] — N regions, N bosses, each granting the power needed for the next.
[ACT II] — M paths, M items, M mini-bosses, puzzles, all converging.
[ACT III] — the final boss, and THE TWIST.
[THE END CARD] — where the player is sent afterwards.
```

**The lesson worth stealing from how this was written:** the twist is set up in the *first*
scene and paid off in the *last*. Sarah is an apparition from her very first appearance — the
game never lies to the player, it just doesn't explain. A twist is fair when the evidence was
always on screen.

**One thing the lead added unprompted, and why:** the brief said the hair should match "an
Anime character in a video game. Think of characters like Goku." That's a *style* reference,
so the canon records it as a genre convention to build toward — bold sculpted spikes, strong
directional flow, silhouette-readable — with an explicit instruction never to replicate a
specific existing character. Same discipline as the visual references: learn from it, generate
something original. If you're doing this yourself, write that distinction down before a builder
starts, not after.

---

## 10. Commands

```bash
# Setup
npm i three@0.169.0
npm i -D vite@5 playwright@1.48.0
npx playwright install chromium

# Play it
npm run dev                                    # → http://localhost:5188

# Capture and measure
node tools/shots.mjs                           # all named poses
node tools/shots.mjs --port 5191 --tag atmo    # parallel-safe: one port per builder
node tools/shots.mjs --shot eye --time 7.5     # single shot, time override

# Regenerate the public progress page
node tools/progress.mjs
```

**In-game controls:** click to capture mouse · `WASD` move · `Q`/`E` down/up · `shift` sprint ·
wheel speed · `F` free camera · `1`–`9` capture poses · `,` `.` time of day · `T` cycle weather ·
`H` hide panel.

---

## 11. Results, honestly

**Round 1, Scene Foundation: 57/100** against a 78 ship gate.

| Section | Score /4 |
|---|---|
| R1 Lighting & tonemapping | 2.80 |
| R5 Post & atmosphere | 2.50 |
| R2 Shadows & contact | 2.25 |
| R3 Terrain & world scale | 2.20 |
| R6 Time-of-day & weather | 2.17 |
| R4 Foliage & density | 1.60 |

Performance held throughout: **92–135 fps at 1920×1080**, 165–220 draw calls against a 400
budget, ~2–4M triangles, on a GTX 1660 Ti. Captures verified bit-identical between runs.

Round 2 fixed the convergent aliasing defect, and added standing water in storms and genuine
backlit translucency on foliage.

**What's real:** procedural Nishita sky with Rayleigh+Mie scattering, 3-cascade shadow maps,
sky-driven PMREM ambient with LRU caching, depth-reconstructed AO, thresholded bloom, SMAA,
weather-aware split-tone grade, a 7-ring terrain clipmap from 0.5 m cells to 4 km, six
slope-and-noise-blended material layers, ~9,500 clustered scatter instances, a full day/night
cycle with a moon and star field.

**What isn't done yet:** the character, NPCs, enemies, quest, audio, HUD and cutscenes were all
in flight when the build hit a spend limit. Their prompts are in this playbook; the results are
not in yet.

---

## 12. What we'd do differently

**Build the harness first. Genuinely first.** Every hour spent on the capture rig paid for
itself many times over. You cannot iterate toward a visual bar you can't measure.

**Two critics beat one.** Agreement between independent blind critics is a much stronger signal
than either verdict alone — it's what surfaced the root-cause defect.

**Pre-wire stubs before spawning builders.** A builder that can't see itself render is coding
blind. Every module got a wired stub in `main.js` first, so the agent could capture and iterate
immediately.

**The lead should own the integration seam.** `src/core/engine.js` and `src/main.js` were
lead-only. That's what made it safe to run six builders concurrently in one tree.

**Pace agent spend against your reset cadence.** Seven agents were lost mid-task to a spend cap,
wasting work already done. Prefer fewer concurrent agents with tighter, completable scopes, and
checkpoint so partial work survives a hard stop.

**Let cheap local verification do the heavy lifting.** Captures and the progress page cost
nothing and caught real bugs — including a HUD overlay leaking into screenshots because Vite's
hot reload raced the capture shutter.

---

*Macrion is built entirely with AI, using Claude. Every asset is generated in code.*
*For AI + Automation: **https://www.solomonchrist.com***
