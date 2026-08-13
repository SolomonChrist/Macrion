# Macrion — Story Canon

The authoritative narrative. Every character, cutscene, quest and level builder works from
this file. Companion to `docs/GAME_DESIGN.md` (progression mechanics) and
`docs/BUILD_PLAN.md` (scope and model routing).

---

## The protagonist — Oz Macrion

Also called **Oz of Macrion**.

| | |
|---|---|
| Age | Early twenties (18–22 at the inciting incident) |
| Build | Muscular and fit — an athlete's frame, not a bodybuilder's |
| Hair | **Anime-styled** — bold, sculpted, gravity-defying silhouette in the tradition of shōnen action heroes |
| Training | Raised as a prince: magic, sword fighting, and the ordinary skills of the court |
| Nature | Earnest, impulsive, falls hard and fast |

### Design constraint — original silhouette, genre-accurate style

The reference point is the *genre*: shōnen anime action heroes, of which Goku is the
archetype. Build to the **convention** — dramatic spiked volume, strong directional flow,
a silhouette readable in one glance from any angle, hard stylized shapes rather than
realistic strands.

**Do not replicate any specific existing character.** No copied hair shape, no borrowed
outfit, no recognizable likeness. Oz must be his own character who clearly belongs to the
genre. This is the same rule the renderer follows: learn from the reference, generate
something original.

Practical notes for the builder:
- Hair reads as a **silhouette shape**, so it must survive the `backlit` shot as a
  recognizable outline. Build it as sculpted geometry, not strands or cards.
- Royal-but-travelling wardrobe: he is a prince who left the castle to walk into a war.
  Fine materials, worn by the road.
- He carries a **sword** and a **flute**. Both are plot-critical and must be visible on his
  person.

---

## The cast

| Character | Role |
|---|---|
| **Oz Macrion** | Protagonist. Adopted prince. Sword and magic. |
| **King Baiza** | Adoptive father. Ruler of Macrion. |
| **Queen Maseena** | Adoptive mother. Could not bear children; loved Oz on sight. |
| **The Maid** | Oz's birth mother. Raised to honorary sister of Queen Maseena, and so into the royal family. |
| **Melina** | Oz's cousin. Lives on the near side of the land of Macrion. |
| **The Great Head of Macrion** | A giant, ghostly, immensely powerful head. The final essence of a great sage of the past, now part of the land itself. Quest-giver. |
| **Sarah** | A beautiful maiden. Appears as a captive apparition. Oz's love. |
| **Sallenties** | The evil sorcerer who defiled the land. Can transform into an **evil serpent**. Final boss. |
| **Snagulas** | The common enemy. Man-sized, **green**, **sharp teeth**, **red eyes**. Multiple types. Sent by Sallenties. |

---

## The world

**The Kingdom of Macrion** sits atop a **flattened mountain summit** — a plateau kingdom
looking down on everything else. This is the safe home base.

Down from the plateau lies the **mainland**, which the player crosses on the way to the
**Great Mountain of Macrion**, where Sallenties waits.

```
        ┌──────────────────────────────┐
        │   KINGDOM OF MACRION         │   plateau — flattened mountain top
        │   castle · court · Melina     │   home base, safe
        └───────────┬──────────────────┘
                    │  descent
                    ▼
        ┌──────────────────────────────┐
        │        THE MAINLAND          │
        │  Sand Kingdom · Badlands ·   │   Act I — three boss regions
        │      Water Coastline          │
        └───────────┬──────────────────┘
                    │  pathway unlocks after all three
                    ▼
        ┌──────────────────────────────┐
        │    FIVE PATHS  (A–E)         │   Act II — five distinct regions,
        │  each yields ONE key item    │   five items, puzzles
        └───────────┬──────────────────┘
                    │  all five items combine
                    ▼
        ┌──────────────────────────────┐
        │  GREAT MOUNTAIN OF MACRION   │   Act III — Sallenties
        └──────────────────────────────┘
```

The existing engine already renders an arid highland basin ringed by snow peaks, spanning
golden hour to storm to night. **Build the regions out of that range** rather than inventing
unrelated biomes: Sand Kingdom leans hot and golden, Badlands hard and high-contrast, Water
Coastline cool and misty. The weather and time-of-day system is the region-differentiation
tool.

---

## Backstory — the swap

Oz was born the son of a **maid** in the castle.

One day, while she was cooking, the newborn was **sent up to the Queen's quarters by
mistake**.

King Baiza and Queen Maseena could not have children. When the Queen saw the baby, she fell
in love instantly. They **pleaded with the maid** to let the child be theirs as well — and
the maid agreed. Rather than losing her son, she was raised up: made the **honorary sister of
Queen Maseena**, and so became part of the royal family herself.

Oz grew up a prince. He learned magic, sword fighting, and the ordinary skills of the court.

> **Tone note:** this is a warm origin, not a tragic one. Nobody was cheated. Two mothers,
> one son, one family. It matters at the end, when Oz is told he may marry whomever he
> chooses — this family gives freely.

---

## Act 0 — The Flute and the Great Head

Grown, Oz goes down **into the town** looking for a **flute** that is rumoured to have the
power to **raise a great sage** — the Great Head of Macrion.

He finds it. He is told where it will work.

He travels **through the forest** to the appointed spot, and **plays the song**.

The **Great Head of Macrion** appears: a giant ghostly head, superior and immensely
powerful — the last essence of a great sage of the past, now bound into the land.

It charges Oz with a quest: **go out into the land and cleanse it of the evil sorcerer
Sallenties**, who has defiled it.

Oz accepts, and **descends from the plateau to the mainland**.

> **Playable beat:** the flute is the player's first magical instrument and the first
> "learn by doing" moment. Finding it, carrying it, and playing it at the right place should
> all be player actions, not cutscene.

---

## Act 0.5 — Sarah's song, and the first battle

On the mainland, Oz meets his first creatures — **Snagulas**, sent by Sallenties. Man-sized,
green, sharp-toothed, red-eyed. Several types.

Then he hears it: **haunting, beautiful music** drifting from an **apparition**.

It is **Sarah** — a beautiful maiden, held captive by Sallenties.

Oz **falls in love instantly** and vows to find and rescue her.

**This is where the first battle begins.** Sallenties throws Snagulas at him, and Oz fights.

> **Design note:** Sarah's music is the player's emotional compass for the whole game. It
> should be a real, recurring musical motif in the score — heard first here, returning at
> every major beat, and resolving at the wedding. The audio system's `explore` layer should
> carry a ghost of it near story locations.

---

## Act I — Three regions, three bosses

Three battle rounds, each culminating in a boss:

1. **The Sand Kingdom**
2. **The Badlands**
3. **The Water Coastline**

Each is a distinct region with its own enemy mix, all sent by Sallenties.

Per the progression rules in `GAME_DESIGN.md`: **every boss defeat grants a level and a new
power, and each power is exactly what is needed for the road ahead.** Each boss is followed
by a **cutscene and a breathtaking view** — the reward for the fight.

Completing all three **unlocks the pathway across to the Great Mountain of Macrion.**

---

## Act II — Five paths, five items

The pathway opens into **five paths**.

- Each path leads to **one different item** required to unlock the way to the mountain.
- The five must be **distinctly different and unique** — different terrain, different enemy
  types, different mini-boss, different mood.
- Each path ends on **another amazing view and story beat.**
- Each contains **fun, inventive puzzles** — pushing blocks, multi-step tasks, mechanisms
  that unlock in stages. Puzzles should be playful, not punishing.

Collecting **all five items** unlocks the final ascent. By this point Oz has **every power he
needs** for Sallenties.

---

## Act III — Sallenties, and the twist

Oz reaches the Great Mountain and confronts **Sallenties**, who transforms into an **evil
serpent**. **Sarah is there.**

The great boss battle plays out. Oz wins.

And as the battle ends, Sallenties speaks his last words:

> **"Shinto, Ganshee, Rasta, Lin! It was all Magic Oz, HAHAHAHA"**

It is a **reincarnation spell**. Sallenties dies — and **Sarah vanishes.**

### What actually happened

Sarah was never captive on the mountain.

She had been **struck over the head back in the town of Macrion, on the castle grounds**. She
fell into a **deep coma**, and Sallenties **took her spirit** — using it as an apparition,
purely to **lure Oz to him**, so that at the moment of his death he could cast the
reincarnation spell.

**Oz does not understand any of this.** He does not know what the spell was. He leaves the
mountain believing only that he has lost her.

### The return

Oz returns to the Kingdom, grieving.

His parents had told him he may **marry anyone he chooses**. He is heartbroken, because the
one he wanted is gone.

Then they present him with a bride.

**It is Sarah** — awake, out of the coma.

Oz is overjoyed. **They marry.**

### The final shot

They have a child.

...but wait. **Two.** **Twins.**

The camera pushes in on the infants — and **one of them is Sallenties**, who laughs.

**Cut to black.**

---

## The end card — required content

Immediately following the final cutscene, the player is shown:

1. A link to **https://www.solomonchrist.com** with an invitation to join the mailing list
   for **AI + Automation**
2. A statement that **the entire game was made using Claude and AI**

This is a hard requirement.

---

## Continuity notes for builders

- **The flute is not a one-off.** It summoned the Great Head; it should stay in Oz's kit and
  matter again. Consider it the key to at least one Act II puzzle.
- **The Great Head is a recurring guide,** not a single scene. It is the essence of the land
  itself, so it can plausibly appear anywhere in it. Use it to deliver progression beats.
- **Melina** lives on the near side of the plateau and is currently unused after the setup.
  She is the natural home-base NPC — the person Oz returns to between acts.
- **Sallenties is present the whole game** even when off-screen: every enemy is sent by him.
  Enemy encounters should feel authored by an antagonist, not spawned at random.
- **Sarah's apparition must read as an apparition** — she is a spirit, not a person, and in
  hindsight the player should be able to see that the game never lied about it. Render her
  accordingly, and keep her ghostly from the very first appearance. That is what makes the
  twist land as fair rather than cheap.
- **Plant the head wound.** The castle grounds in the opening should contain the place where
  Sarah is later found to have fallen. The player should be able to walk past it in Act 0
  without knowing.

---

## Structural reconciliation

An earlier design pass described *three paths yielding puzzle pieces, then a second boss,
then five paths*. This document supersedes it. The canonical structure is:

**Act I — three regions, three bosses** (Sand Kingdom, Badlands, Water Coastline)
→ **Act II — five paths, five items, five mini-bosses, puzzles**
→ **Act III — Sallenties.**

The puzzle-piece mechanic from the earlier pass survives, relocated into the Act II paths.
