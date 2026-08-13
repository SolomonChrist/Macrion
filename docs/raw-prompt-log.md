# RAW PROMPT LOG — source material for PLAYBOOK.md

This is the unedited source. The Playbook Keeper agent turns it into `PLAYBOOK.md`.
Everything here is verbatim. Do not paraphrase user prompts or agent briefs — they are
the product.

---

## PART 1 — USER PROMPTS, VERBATIM, IN ORDER

### U1 — the opening brief

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
the visual tier—both look PS4-native in scale and fidelity. This is your "Call of Duty
screenshot" moment.

---

LEAD AGENT INSTRUCTIONS:

You are the director of the Macrion engine build. Break this goal into the smallest,
independently shippable pieces:

1. **Scene Foundation** – Base terrain, lighting, camera system, frame rate baseline
2. **Character System** – Original humanoid model, rig, materials, idle animation
3. **Environment** – One complete zone (village, field, or dungeon) with NPCs, props, interactable objects
4. **Visual Polish** – Particle effects, bloom, shadows, material layering, atmospheric effects
5. **Player Interaction** – Basic movement, collision, interaction system, UI overlay

For each piece:
- Assign a **builder subagent** with a clear spec and the quality bar (show them the reference frames)
- Assign a separate **critic subagent** (fresh context) to inspect the real output
- Critic runs a blind A/B comparison of the output vs. the reference bar
- Critic identifies the single biggest gap and sends it back to the builder
- Loop continues until the builder's output beats the bar or you decide to move on

Maintain a **live progress page** (simple HTML artifact) that shows:
- Current iteration count for each system
- Side-by-side comparison images (reference vs. current output)
- Critic's latest gap assessment (text)
- Next action and ETA

You decide the decomposition, the number of rounds, the architecture. Use **subagents**
(fan out builders and critics in parallel) and **ultracode** (Three.JS only, no external
asset packs). Keep each round tight: build, critique, refine, repeat.

Start now. Show me what Macrion looks like.Run the Macrion Gauntlet Loop. You're the lead. Start with Scene Foundation.
```

### U2
```
I added all the visual examples to test against inside of the visuals folder as jpeg images. take a look and let me know if you have any questions
```

### U3 — answering the art-direction question
Selected: **"Both — build a day/night + weather system"**
```
One terrain, two moods driven by state:
  hour  6.5 → cold blue dawn mist
  hour 12.0 → hard high sun, dry heat shimmer
  hour 17.4 → golden backlight, god rays
  weather: clear / overcast / storm
Cost: ~2x iterations to pass the gate
```

### U4
```
can i do a test run until the building starts again?
```

### U5
```
Please note we are about to hit Claude weekly limits as well, we are currently on paid credits. 23% weekly usage and the local current usage resets in 2 hours
```

### U6
```
can you show me the progress somewhere?
```

### U7
```
Yes do option 1 until the window resets then continue full speed at 3 again and lets continue that way until done. Check the usage so you know the status and can guide the entire build.
```
(Option 1 = let running builders finish, spawn nothing new. Option 3 = full critic + refine loop.)

### U8
```
my account resets in 50 minutes. set the system up to restart then. Also be wise about usage, if a subagent can be run with Haiku then let it run with Haiku, save tokens so we can run longer and get the job done. For example if its a tree, it shouldn't require a full Opus 5 at highest thinking to do something like that. Let me know if you have any questions for me before I leave for the night
```

### U9 — answering the autonomy question
Autonomy: **"Keep going through all five systems"**
Priority, written in freehand:
```
I want depth and breadth. You should do a smaller environment with the character and props
and movement roughed in so that we can always update it but the basics are running at the
highest quality (Ex. if there are 100 levels, build out the perfect level 1)
```

### U10
```
Hi what is the status
```

### U11 — the pivot to breadth
```
note that instead of doing a refining round 2 on terrain (Which already looks great) you need
to do ALL the other working parts for phase 1 including adding in the main player character,
the npcs, the enemy characters, the level progression, the first major quest, the sounds, the
music, the storyline and cutscenes, this needsd to have the functionality running before you
run the next pass on the same areas again
```

### U12
```
we have around 50% usage left and resetting in about 3.5 hours, make use of what you can while
also being smart about it. Areas where you can use Haiku for things can be helpful and then
route to higher models when higher models are required going back and forth with haiku on the
lower end parts and opus on the higher end parts.
```

### U13
```
Also, on the progress view I should have a clickable link in there to TEST the entire production
thus far so I can see for myself the current progress of the entire system. Always have this
available for me for every update you do to the progress.
```

### U14 — this document's commissioning prompt
```
I want you to have ONE subagent (haiku, keep it really simple) to take ALL the prompts and
commands and work that was done (The thinking is fine but this is a high level overview with a
focus on the PROMPTS USED TO BUILD THE GAME) and keep it all in a FINAL MD file that will be
shown to the public so if anyone wants to recreate a similar creation they simply copy/paste the
same prompts I used. Track it all from the beginning until now and everything in the future,
this should all be documented as this is being presented. Yes also include this prompt as well.
```

---

## PART 2 — THE LEAD'S METHOD (what the director did between user prompts)

Order of operations, because sequence is the reusable part:

1. **Built the measurement rig before writing any engine code.** Nothing can be
   iterated against a "visual bar" unless the bar is machine-checkable. Created:
   - `docs/QUALITY_BAR.md` — 6 weighted rubric sections, 0–4 per criterion, 78/100 ship gate
   - `docs/CAPTURE_CONTRACT.md` — the `window.MACRION` API every build must implement
   - `tools/shots.mjs` — Playwright harness: boots Vite, drives fixed camera poses, writes PNGs + FPS/draw-call/triangle stats
   - `tools/progress.mjs` — generates the public progress page from capture data
2. **Analysed the user's reference frames into engineering directives** —
   `docs/REFERENCE_ANALYSIS.md`. Seven ranked traits with a calibration table.
   Copyrighted frames used locally for grading only; never embedded in published output.
3. **Owned the integration seam personally.** `src/core/engine.js` and `src/main.js` are
   lead-only. Builders get module slots. This is what made parallel fan-out safe.
4. **Pre-wired stubs for every system before spawning its builder**, so each agent could
   see itself render and iterate against real captures instead of coding blind.
5. **Verified every agent claim with a capture run.** No system reported as passing
   without images and stats.

Key infrastructure decisions worth copying:
- Fixed named camera poses, stable across iterations, so A/B diffs mean something.
- `MACRION.setClock()` pinned before capture — otherwise wind/animation phase drifts and
  captures aren't bit-comparable.
- A `mode` flag (`shot` / `free` / `play` / `cutscene`) giving exactly one system camera
  authority at a time. Without it, concurrent gameplay builders corrupt the baseline.
- Each parallel builder gets its own dev-server port.

---

## PART 3 — SUBAGENT PROMPTS, VERBATIM

All briefs share a standing rules block:

```
- Three.js only. Everything procedural. No asset packs, no downloaded textures, no CDN.
- No bare Math.random() — makeRNG(SEED) from src/core/engine.js.
- Never edit src/core/*, src/main.js, index.html, tools/*, docs/* — lead-owned.
- Verify with `node tools/shots.mjs --port <unique> --tag <name>` and LOOK at the PNGs.
- Captures must stay deterministic and bit-identical between runs.
- Report weaknesses honestly. A critic grades this next; overclaiming wastes a round.
```

The full text of every builder and critic brief is recoverable from the session, but the
**reusable skeleton** of each is below. The Playbook Keeper should present these as
copy-pasteable templates with the Macrion specifics marked as substitutable.

### Builder brief skeleton (used for Atmosphere, Terrain, Character)
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
<numbered, specific, with the failure mode named for each item>

## Verification — mandatory, do not skip
Run: node tools/shots.mjs --port <N> --tag <name>
- Read the PNGs you produce. Iterate on what you actually see, not what you intended.
- stats.json must show zero consoleErrors.
- Headless Chromium here uses the real GPU, so FPS is trustworthy. Target 90+ fps at
  1080p, hard floor 60.
- Iterate at least 3 capture→look→fix cycles. Your first output will not be good enough.

## Report back
What you built, final per-shot FPS/draw-call/triangle numbers, paths to your captures,
which rubric criteria you're still weak on, and anything you cut for performance. Be
honest — a critic with fresh eyes grades this immediately, and overclaiming wastes a round.
```

### Critic brief skeleton — THE KEY ARTIFACT
This is the highest-leverage prompt in the project. Two critics using it, working blind on
different rubric sections, independently found the same root-cause defect.
```
You are a BLIND VISUAL CRITIC for <PROJECT>. You are not a builder. You do not fix
anything. You score, and you find the one gap that matters most.

## Your assigned rubric sections
<sections>. A second critic is independently covering <other sections> — do not stray.

## CRITICAL — the protocol, in this order. Do not deviate.

### Step 1: Look at the reference frames
<paths>. Calibrate your eye. Copy nothing.

### Step 2: Score the images — BEFORE reading any source code
<capture paths>
You must not open any file under src/ until you have finished scoring. The whole point of
a blind critique is that you judge the image, not the intent behind it. If you read the
shader first you will start grading the effort instead of the result.

Score every criterion with a one-line justification tied to a specific image and a
specific region of it. Be specific: "the shadow terminator on the mid-left ridge in
grazing.png shimmers" beats "shadows look bad".

Be a hard marker. 3 means "reads as PS4-tier". Most first-round work is a 2. Do not
inflate — an inflated score wastes the next build round, which is expensive.

### Step 3: Only now, read the source
Diagnose why your lowest-scoring criteria are low.

### Step 4: Report exactly ONE gap
Not a list. One. The single change that moves the most rubric weight for the least work.
State it as a concrete engineering directive — name the file, the mechanism, and what the
frame should look like afterwards. If two things tie, pick the one in more shots.

## Report format
1. Scored table: criterion, score 0–4, one-line justification.
2. Weighted subtotal normalized to 100.
3. Your single highest-leverage gap, as a directive.
4. Two or three sentences on what is genuinely working — the builder needs to know what
   not to break.

Be blunt and specific. Vague praise is worse than useless here.
```

### Gameplay-system brief additions
For player controller, game systems, audio, HUD, cinematics — same skeleton plus:
```
## THE CRITICAL RULE — camera authority
engine.mode decides who owns the camera: 'shot' (capture pose), 'free' (debug fly cam),
'play' (player controller), 'cutscene' (cinematics).
- Your update(ctx) must return immediately unless ctx.engine.mode === '<yours>'.
- engine.setShot() always forces mode back to 'shot'. Never fight it.
- The capture harness sends no input, so it stays in 'shot' and your system must be
  completely invisible to it. If a capture run changes because of your code, you have
  broken the project's A/B baseline. Verify this.

## Determinism — non-negotiable
Captures pin the clock via MACRION.setClock(120.0). Animation must be a pure function of
ctx.time — no performance.now(), no accumulating state, no Math.random() at runtime.
```

For audio specifically:
```
## THE HARD CONSTRAINT — everything is synthesized
No audio files. No samples. No downloaded loops. No copyrighted music. Every sound is
generated at runtime with the Web Audio API — oscillators, noise buffers you fill
yourself, filters, envelopes, convolution reverb from a procedurally generated impulse
response. Wind is filtered noise. Footsteps are short filtered noise bursts with a fast
envelope. Compose in DATA — scales, motifs, chord movement as arrays — not hardcoded
oscillator calls.
```

### Mid-flight redirect messages
Sent to running agents when scope changed. Pattern:
```
SCOPE CHANGE / SCOPE CUT from the lead — read before you finalize.
<what changed and why>
<what to do now, numbered>
<what to explicitly skip>
<don't leave the tree broken — other builders depend on it rendering>
Keep the report short.
```

---

## PART 4 — MODEL ROUTING POLICY (user-directed, U8 + U12)

| Work | Model | Why |
|---|---|---|
| Shader/rendering architecture, character rig | Opus | Novel GLSL, numerical calibration, perf tradeoffs |
| Blind visual critic, game logic, controller, audio | Sonnet | Real judgment, not complex systems |
| Procedural asset generators, HUD, cutscene timeline | Haiku | Bounded work inside an existing contract |

Rule of thumb: **invent the approach → Opus. Execute a known approach inside an existing
contract → Haiku. Judge the result → Sonnet.**

Observed costs: Opus builder ~390–450k tokens. Sonnet critic ~105k. Haiku considerably less.

---

## PART 5 — COMMANDS

```bash
npm i three@0.169.0
npm i -D vite@5 playwright@1.48.0
npx playwright install chromium

npm run dev                                    # live build at localhost:5188
node tools/shots.mjs                           # capture all named poses
node tools/shots.mjs --port 5191 --tag atmo    # parallel-safe, per-builder port
node tools/shots.mjs --shot eye --time 7.5     # single shot, time override
node tools/progress.mjs                        # regenerate the progress page
```

---

## PART 6 — RESULTS SO FAR (for the playbook's honesty section)

- Round 1 Scene Foundation scored **57/100** against a 78 gate. Sections: R1 2.8, R2 2.25,
  R3 2.2, R4 1.6, R5 2.5, R6 2.17 (of 4).
- **The convergence result:** two blind critics, different rubric sections, no contact,
  independently traced the dominant defect to the same function — `macRelief()` in the
  terrain shader. Un-band-limited noise octaves aliasing into a corduroy ripple, visible in
  7 of 9 shots, depressing four separate criteria. One root cause.
- Fixed in round 2 via screen-space band-limiting (`fwidth`), plus a third contributor
  neither critic named: a fixed 0.11 m finite-difference step in the normal gradient that
  beat against the sub-metre octaves.
- Performance held throughout: 92–135 fps at 1080p, 165–220 draw calls against a 400 budget,
  on a GTX 1660 Ti. Captures verified bit-identical between runs.
