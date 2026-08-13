# Macrion — Game Design

The full design directive, captured verbatim in intent. This governs every gameplay
builder from here forward. Read alongside `docs/BUILD_PLAN.md` (scope + model routing)
and `docs/QUALITY_BAR.md` (visual bar).

---

## 1. The core loop — engineer for flow

> *"Not too frustrating that the player wants to rage quit. Not too boring that it's too easy.
> Right in between frustration and boredom is FUN."*

This is the flow channel, and it is the design's first principle. Difficulty must rise in
step with player capability, never ahead of it and never behind it.

**The mechanism that delivers it:** every power granted is *exactly and utterly* what is
needed to beat the boss ahead and the enemies that follow. Not a generic stat bump — a
specific key for a specific lock. The player leaves each boss fight strictly more capable,
and immediately meets content shaped to use that new capability.

This produces the intended feeling: after every upgrade the player is **curious to test the
new skill**, and the next area is built to satisfy that curiosity.

**Learn by doing.** No tutorial text walls. The player enters the world running around and
exploring. They discover they have a weapon or power. They use it on the first enemies.
That repetition becomes habit, and the habit is what carries them through the first boss.
Teaching happens through encounter design, not instruction.

---

## 2. Progression structure

```
EXPLORE  →  discover weapon/power  →  first enemies (learn by doing)
                                            ↓
                                      FIRST BOSS
                                            ↓
                          CUTSCENE + LEVEL UP + NEW POWER
                                            ↓
                              breathtaking view, 3 paths revealed
                                            ↓
        ┌───────────────┬───────────────┬───────────────┐
      PATH 1          PATH 2          PATH 3
   weapon/power    weapon/power    weapon/power
   + puzzle piece  + puzzle piece  + puzzle piece
        └───────────────┴───────────────┘
                        ↓
        3 puzzle pieces COMBINE → opens SECOND BOSS
                        ↓
             CUTSCENE + LEVEL UP + NEW POWER
                        ↓
                  5 paths revealed
        ┌────┬────┬────┬────┬────┐
       A    B    C    D    E          5 areas, 5 distinct enemy types
       │    │    │    │    │          5 mini-bosses
       │    │    │    │    │          each ends on an amazing view + story beat
        └────┴────┴────┴────┘
                  ↓
            all 5 converge
                  ↓
           FINAL MEGA BOSS
                  ↓
          CLOSING CUTSCENE  → solomonchrist.com
```

### Rules that fall out of this
- **Every boss defeat grants a level and a new power.** No exceptions.
- **Every power is the answer to the next lock.** Design the boss first, then the power
  that beats it, then the enemies that let the player rehearse it.
- **Paths are parallel, not sequential.** The 3-path and 5-path stages let the player choose
  order, which preserves agency while keeping difficulty gated.
- **Puzzle pieces gate the boss.** Each of the 3 paths yields both a power and a puzzle
  component; only combining all 3 opens the second boss arena.

---

## 3. Music state machine

The audio system must drive these states, cross-faded, never hard-cut:

| State | Trigger | Character |
|---|---|---|
| `explore` | default, open world | Sparse, modal, atmospheric — scale and solitude |
| `alert` | player enters an area containing enemies | **Heightened awareness** — tension enters, pulse rises |
| `combat` | engaged with enemies | Driving, rhythmic |
| `boss` | player enters a boss arena | **Epic** — full arrangement, the largest sound in the game |
| `resolve` | boss defeated / quest complete | Release, warmth, reward |

The transition into `alert` on area entry and into `boss` on arena entry are explicitly
required. They are the player's primary non-visual warning system and a large part of how
tension is authored.

Score also continues to respond to `hour` and `weather`, as already built.

---

## 4. Cutscenes — as reward, not interruption

> *"There should be views that are utterly breathtaking and those should definitely be
> cutscenes and opportunities to show the player stunning experiences. They should come
> after big battles so that players feel rewarded for their battles."*

**Placement rules:**
- After basic fights — short beats.
- **After every boss battle — mandatory.**
- On arrival at epic locations — the vista reveal.

**Composition rule:** a cutscene's job is to show the player something worth the fight they
just won. The engine already renders a 4 km basin with a full day/night and weather range —
cutscenes should be composed to exploit it: golden-hour reveals, storm arrivals, the
mountain range opening up. Camera work uses the spline system, never straight lerps.

The reward sequence is: **win the fight → cutscene → level up → new power → the view ahead →
paths revealed.** That ordering matters; the view should come with the paths visible in it,
so the player leaves the cutscene already knowing where they can go.

---

## 5. Closing cutscene — required content

The final mega-boss cutscene ends the game and must:
1. Direct every player to **https://www.solomonchrist.com**
2. Explain that visitors can sign up to the mailing list for **AI + Automation**
3. State that **the entire game was made using AI and Claude**

This is a hard requirement, not a suggestion.

---

## 6. Level editor — in-game, shipped

Players must be able to build their own game inside Macrion:
- Place enemies and bosses into the world
- Author their own levels, encounters and progressions
- Save and load their creations

This is why every system is data-driven and separated from its machinery — quests, dialogue,
cutscenes, and the score are all authored as data specifically so the editor can write them.
Keep it that way.

---

## 7. Multiplayer — 4 players, WebRTC direct

- Up to **4 players total** (the host plus 3 friends)
- **Voice chat and text chat in-game**
- **Direct peer connections via WebRTC** for the realtime layer
- **All 4 webcams visible**, each individually toggleable — a player who turns their camera
  off is replaced by their avatar
- Designed so groups can build their own battles, team storylines and quests together
- Must be **livestream-friendly** for Twitch and YouTube

---

## 8. Distribution

Everything ships to GitHub:
- The full source
- **The prompts used to build it** (see `PLAYBOOK.md`)
- Easy-to-run instructions

End users download it, run it, play it fully, and then edit the levels themselves. The
project is both a game and a reproducible demonstration of building one with AI.

---

## 9. Build sequencing note

The design above is large. It is sequenced so that each stage is playable on its own:

1. **Phase 1 (current)** — one zone, player character, movement, first enemies, first boss,
   first power, first cutscene, music states, HUD. This is the "perfect level 1" directive.
2. **Phase 2** — the 3-path stage, puzzle-piece gating, second boss.
3. **Phase 3** — the 5-path stage, 5 enemy types, 5 mini-bosses, final mega boss, closing
   cutscene.
4. **Phase 4** — level editor.
5. **Phase 5** — multiplayer, WebRTC, voice/text/webcam.

Do not start a later phase before the earlier one is playable end to end.

---

## 10. Operational constraint — budget pacing

Directive from the user, 2026-08-13:

> *"3 hours to the plan update, for future adjust to match that so we are not in a situation
> where we are locked waiting for the subscription fees to hit."*

**Standing rule for the lead:** pace agent spend against the known reset cadence. Do not fan
out a wave of expensive agents that cannot finish before a limit is reached — seven agents
were lost mid-task to a monthly spend cap on 2026-08-13, wasting the work they had already
done. Prefer:
- Fewer concurrent agents, each with a tighter, completable scope.
- Cheapest capable model per task (see routing table in `BUILD_PLAN.md`).
- Checkpoint agents so partial work is committed and reportable before a hard stop.
- Keep local verification (captures, progress page) doing as much of the work as possible,
  since it costs nothing.
