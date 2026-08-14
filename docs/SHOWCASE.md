# MACRION: FIRST LIGHT — the shippable showcase

**Directive (user, superseding the earlier draft of this file):**

> *"The visuals for Oz and movement need to be done, it should look stellar and match the
> requested spec of Anime. It should all look AAA. Use whatever agents you need to get this
> done and focus on it as well as the gameplay. We need to be able to clear at least a first
> set of battles and a boss battle and cut scenes. That should be a bare minimum and it should
> all look incredible."*

An earlier version of this document proposed deferring Oz's face and barring combat to
guarantee something shipped. **That is overruled.** Oz's anime look and a complete first
combat arc are now the minimum bar, not stretch goals. Spend agents freely.

---

## What "done" means this round

A person can start the game and play an unbroken arc:

**Title screen → intro cutscene → explore → learn to fight → clear a set of enemy encounters
→ cutscene → boss battle → victory cutscene → level up + new power → end card.**

And at every moment of it, **it looks AAA**.

---

## MUST — all of these, or the round failed

### 1. Movement — fix the blocker, then make it feel good
`character.js`'s `animator.apply(time)` resets every bone absolutely from rest pose each frame,
wiping position writes from `controller.js`, which runs after it in module order. **The player
currently cannot move.** Everything else is downstream of this.

Fix by ownership: the animator owns **bone-local pose**; the controller owns the character
**root transform**. They must never both write translation to the same node.

Then make it feel AAA: acceleration and deceleration curves, a turn rate that reads as weight,
sprint, a third-person camera on a spring boom that never clips terrain, and locomotion
animation that matches actual ground speed so the feet do not slide. Foot-slide is the single
most common tell of amateur character movement.

### 2. Oz — stellar, anime, AAA
This is the headline asset and it is currently the weakest thing in the build.

- **Face:** stylized anime, not attempted-realistic. Large expressive eyes with clean lid
  lines, defined brows, a simple confident nose and mouth. Clean shapes beat detail here —
  anime faces are about precise, minimal forms, and a muddy realistic face is worse than a
  crisp stylized one at every distance.
- **Hair:** bold sculpted shōnen silhouette with strong directional flow and dramatic spiked
  volume. It must read as a distinctive shape in the `backlit` shot. The current moulded cap
  fails this outright.
- **Sword and flute**, both visible on his person. Both are plot-critical; the flute is the
  Act 0 mechanic and is currently absent.
- **Materials:** real roughness contrast between skin, cloth, leather and metal. He must sit in
  the world with correct rim light and contact shadow.

**Original silhouette, genre-accurate style.** Build to the shōnen convention; never replicate
a specific existing character. The repo publicly states it contains no copyrighted material.

Prior diagnosis is in `heartbeats/oz-repair.md` — three bugs already found and fixed (surface
nets winding, material aliasing past Nyquist, mid-face masses burying every feature). Do not
re-investigate what it ruled out.

### 3. Enemies — the Snagulas
Man-sized, **green**, **sharp teeth**, **red eyes**, per `docs/STORY.md`. At least **three
distinct types** sharing one generator so they read as a family. They must look genuinely
threatening and genuinely finished — an unconvincing enemy undoes the world's credibility
faster than anything else. Reuse the character rig; do not duplicate it.

### 4. Combat that feels good
- Sword melee with real hit detection, a combo or two, and **hit feedback that lands**:
  impact pause, camera shake, a flash, a sound, knockback
- Enemy AI: idle → notice → approach → attack → stagger → death
- Player health, damage, and death/respawn
- Emits events on the game bus so audio and HUD react

Responsiveness is the whole game here. Input latency is what players feel first.

### 5. A first set of encounters, then a boss
- Several Snagula encounters that teach the mechanic by using it
- **A boss** — distinct from the Snagulas, with a readable attack pattern the player learns,
  and a real difficulty curve between frustration and boredom per `docs/GAME_DESIGN.md`
- On victory: **level up and a new power**, and per the design rule that power must be
  *exactly what is needed* for what comes next — a key for a specific lock, not a stat bump

### 6. Cutscenes
- **Intro** — establishing the basin, golden hour, spline camera, letterboxed
- **Post-battle reward** — after the first encounter set
- **Boss victory** — the big one. Per `GAME_DESIGN.md` the reward order is: win → cutscene →
  level up → new power → the breathtaking view ahead with the next paths visible in it
- **End card** — `https://www.solomonchrist.com`, the AI + Automation mailing list invitation,
  and the statement that the entire game was made using Claude and AI

Music must follow the state machine: `explore → alert` on entering an enemy area, `→ boss` on
entering the boss arena, `→ resolve` on victory.

### 7. Ship packaging
README with a one-command start, everything committed and pushed, progress page updated with
showcase captures and the live launch link.

---

## Integration contracts — already built, do not rebuild

Wave 1 landed these. Wire to them; do not reinvent them.

### Game event bus — `engine.systems.game`
```js
game.on(evt, fn); game.emit(evt, data);
game.state; game.startQuest(id); game.advance(objectiveId); game.grantLevel(power);
game.serialize(); game.deserialize(json);
```
Events already emitted: `quest:start`, `quest:advance`, `quest:complete`, `dialogue:start`,
`dialogue:end`, `area:enter`, `combat:start`, `item:collect`, `levelup`.

**Combat and boss builders: emit these** so audio and HUD react without further wiring —
`combat:start`, `enemy:hit`, `enemy:death`, `boss:enter`, `boss:death`, `player:hit`.

### Audio — `engine.systems.audio`
```js
audio.setMusicState('explore'|'alert'|'combat'|'boss'|'resolve');
audio.play(id, { position: {x,y,z} });   // positional supported and stress-tested
audio.sarahApparition(); audio.sarahMemory(intensity); audio.sarahWedding();
audio.setStoryProximity(0..1);
```
SFX ids ready now: `swordSwing`, `swordHit`, `enemyHit`, `enemyDeath`, `levelUp`, `footstep`,
`landing`, `interact`, `dialogueAdvance`, `questAccept`, `questComplete`.

Audio has a `wireGameEvents()` bridge that subscribes to the bus. It was written against a
`game.js` that was still a stub at the time; the bus exists now, so **verify that bridge
actually connects** rather than assuming it does.

### HUD — `engine.systems.hud`
```js
hud.setVisible(v); hud.toast(msg); hud.dialogue(lines); hud.prompt(text);
hud.setObjective(text); hud.setHealth(cur, max);
```
`setHealth` exists and is unused — the combat builder should drive it.

### Cutscenes — `engine.systems.cutscene`
```js
cutscene.define(id, script); cutscene.play(id); cutscene.skip(); cutscene.isPlaying();
```
Takes camera authority via `engine.setMode('cutscene')` and restores the prior mode. Verified
against nested `play()`, mid-play `skip()`, and `skip()` with nothing playing.

### Capture harness gotcha
Captures must set `MACRION_PORT` env, not `--port`, or Vite's HMR client dials the wrong port
and logs 3 phantom console errors. `tools/shots.mjs` already does this — if you invoke Chromium
yourself, copy its GPU launch args or `requestAnimationFrame` barely ticks headless.

## Non-negotiables

- Three.js only. Everything procedural. No asset packs, no downloaded textures, no sample audio.
- No copyrighted material ships.
- 60 fps floor at 1080p, ≤400 draw calls.
- Captures bit-identical between runs.
- Every agent writes a heartbeat per `docs/HEARTBEAT.md`, with a hard tool-call budget and an
  instruction to report before exhausting it.

## If the clock runs out

Cut in this order, last first:
1. Extra Snagula types beyond the first
2. The post-battle reward cutscene (keep intro, boss victory, end card)
3. Combo attacks beyond a single swing

**Never cut:** movement, Oz's look, one enemy type, one boss, the boss victory cutscene, the
end card. Those are the arc.
