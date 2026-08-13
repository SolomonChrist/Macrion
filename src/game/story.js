/**
 * Macrion — story content for Act 0 ("The Flute and the Great Head") and
 * Act 0.5 ("Sarah's Song, and the First Battle"). Canon source: docs/STORY.md.
 *
 * PURE DATA (plus small pure condition/predicate functions). No THREE, no
 * engine calls, no side effects. quest.js, dialogue.js and interaction.js are
 * the content-blind machinery that interprets this file; Act I's three
 * regions are authored the same way, by adding to the exports below, not by
 * touching the machinery.
 *
 * ---------------------------------------------------------------------------
 * THE CAST (see docs/STORY.md for full detail)
 *
 *   Oz Macrion          protagonist — adopted prince, sword and magic, earnest and impulsive
 *   King Baiza           adoptive father, ruler of Macrion
 *   Queen Maseena         adoptive mother
 *   the Maid              Oz's birth mother, honorary sister to the Queen
 *   Melina                Oz's cousin — the home-base NPC, warm and familiar
 *   the Great Head        the last essence of a great sage, bound into the land — ancient, formal, few words
 *   Sarah                 a captive apparition — ghostly from her first appearance, truthful but incomplete
 *   Sallenties             the sorcerer who defiled the land — off-screen this round, present in every enemy
 *   Snagulas               man-sized, green, sharp-toothed, red-eyed — sent by Sallenties
 *
 * THE PLACE
 *
 * The Kingdom of Macrion sits atop a flattened mountain summit — the plateau,
 * home base, safe. Below it lies the mainland, first reached in Act 0.5, on
 * the way to the Great Mountain of Macrion where Sallenties waits (Act III,
 * future work). This round only authors the plateau (castle ward, town,
 * forest) and the near edge of the mainland.
 *
 * THE ARC THIS ROUND
 *
 * Act 0     — Melina points Oz at a market rumor: a flute that can wake a
 *             sleeping sage. He finds it in the town, carries it through the
 *             forest to the place the rumor named, and plays it himself —
 *             a player action, not a cutscene. The Great Head of Macrion
 *             wakes and charges him to cleanse the land of Sallenties.
 * Act 0.5   — Oz descends to the mainland, sights his first Snagulas, then
 *             hears Sarah's song and finds her — an apparition, though the
 *             game never says the word. He vows to rescue her. The moment he
 *             does, Sallenties throws Snagulas at him: the first battle.
 *
 * Both acts run as one quest chain (QUEST_CHAIN below): completing Act 0
 * auto-starts Act 0.5.
 * ---------------------------------------------------------------------------
 */

export const LORE = {
  title: 'Macrion',
  kingdom: 'the Kingdom of Macrion',
  premise:
    "The Kingdom of Macrion sits atop a flattened mountain summit, looking down on " +
    "everything else. Oz Macrion, adopted prince, was raised there on magic and the sword. " +
    "Below the plateau lies the mainland, and beyond it the Great Mountain of Macrion, where " +
    "the sorcerer Sallenties has defiled the land. Oz does not know that yet. He only knows " +
    "there is a flute in the town said to wake a sleeping sage, and that his cousin thinks he " +
    "should be the one to find it.",
  landmarks: [
    { id: 'castle_ward', name: 'the castle ward', desc: "The plateau's inner grounds. Home base." },
    { id: 'town', name: 'the town', desc: 'Down the gate road from the castle. Stalls, rumor, the flute.' },
    { id: 'the_forest', name: 'the forest', desc: 'Between the town and the appointed spot — a ring of standing stones.' },
    { id: 'the_descent', name: 'the descent', desc: 'Where the plateau path drops away to the mainland.' },
    { id: 'the_mainland', name: 'the mainland', desc: "Below the plateau. Sallenties's reach begins here." },
  ],
};

/**
 * World-space anchors for Act 0 / Act 0.5 content. Independent of SPAWN in
 * entities/character.js by design (spawn is ~[12, 26]) — these are logical
 * quest/story anchors, not a claim about final region geometry (the Sand
 * Kingdom / Badlands / Water Coastline biomes from STORY.md are a Terrain
 * builder's job in a later wave). Sampled against the real height field at
 * marker-build time, so nothing floats.
 */
export const POSITIONS = {
  castleWard: { x: 14, z: 30 },
  melina: { x: 8, z: 34 },
  fallSite: { x: 20, z: 38 },       // secret — see LANDMARKS.fallSite below
  townSquare: { x: 30, z: 10 },
  fluteCache: { x: 34, z: 6 },
  songSpot: { x: 25, z: -70 },      // the appointed spot, deep in the forest
  greatHead: { x: 21, z: -74 },     // where the Head rises once the song is played
  descentPath: { x: 10, z: -110 },
  mainlandGate: { x: -20, z: -180 },
  snagulaWatch: { x: -55, z: -220 },
  sarahClearing: { x: -80, z: -250 },
};

/**
 * The evidence for the Act III twist, planted now per STORY.md's continuity
 * note: "the castle grounds in the opening should contain the place where
 * Sarah is later found to have fallen. The player should be able to walk
 * past it in Act 0 without knowing." Deliberately NOT wired into any quest
 * trigger and its flavor text gives nothing away — it is meant to read as
 * background dressing until Act III recontextualizes it.
 */
export const LANDMARKS = {
  fallSite: { id: 'fall_site', pos: POSITIONS.fallSite, note: 'the cracked flagstone, castle ward' },
};

export const ITEMS = {
  flute: { id: 'flute', name: 'the flute', desc: 'Old wood, dark with handling, carved with a spiral that has no start.' },
};

/* ------------------------------------------------------------------------ *
 * Interactables — what the player can walk up to and press E on.
 * kind: 'npc' opens a branching conversation; 'item' is collected into the
 * inventory; 'object'/'landmark' show flavor text and may carry a mechanical
 * action gated by the active quest objective (actionByObjective).
 * `requires(flags)` gates both visibility and proximity-detection — used
 * here to keep the Great Head and Sarah entirely out of the world (no
 * marker, no prompt, no way to interact) until the story has earned them.
 * ------------------------------------------------------------------------ */
export const INTERACTABLES = [
  {
    id: 'melina', kind: 'npc', name: 'Melina',
    pos: POSITIONS.melina, radius: 3.4,
    conversation: 'melina',
  },
  {
    id: 'flute', kind: 'item', name: 'the flute', itemId: 'flute',
    pos: POSITIONS.fluteCache, radius: 3,
    conversation: 'flute_found',
    requires: (flags) => !flags.has_flute, // taken off the ground once collected
  },
  {
    id: 'fall_site', kind: 'landmark', name: 'a cracked flagstone',
    pos: POSITIONS.fallSite, radius: 2.2,
    conversation: 'fall_site',
  },
  {
    id: 'song_spot', kind: 'object', name: 'the standing stones',
    pos: POSITIONS.songSpot, radius: 4.5,
    conversation: 'song_spot',
    // Mechanical effect of pressing E here, keyed by the quest's CURRENT
    // active objective id. Outside that objective it's flavor-text-only.
    actionByObjective: {
      play_the_song: {
        type: 'requireItem',
        item: 'flute',
        notify: { type: 'interact', payload: { target: 'song_spot' } },
        failText: 'He lifts empty hands. Nothing to play.',
      },
    },
  },
  {
    id: 'great_head', kind: 'npc', name: 'the Great Head of Macrion', marker: 'giant',
    pos: POSITIONS.greatHead, radius: 6,
    conversation: 'great_head',
    requires: (flags) => !!flags.song_played, // has no presence in the world before it is summoned
  },
  {
    id: 'sarah', kind: 'npc', name: 'Sarah', ghostly: true,
    pos: POSITIONS.sarahClearing, radius: 5,
    conversation: 'sarah',
    requires: (flags) => !!flags.saw_snagula, // her song is heard only once Oz is deep enough in
  },
];

/* ------------------------------------------------------------------------ *
 * Quest chain — quest id -> quest id to auto-start on completion. Lets Act
 * 0.5 begin the instant Act 0 resolves without any content-specific code in
 * game.js; a level editor extends the story simply by adding an entry here.
 * ------------------------------------------------------------------------ */
export const QUEST_CHAIN = {
  act0_flute_and_head: 'act0_5_sarahs_song',
};

/** The quest game.js starts automatically on boot. */
export const STARTING_QUEST = 'act0_flute_and_head';

/* ------------------------------------------------------------------------ *
 * Quest definitions.
 *
 * Objective shape:
 *   id           stable string, used by save data, actionByObjective keys,
 *                and console testing
 *   text         HUD-facing objective text
 *   trigger      { type: 'radius'|'timeOfDay'|'talk'|'interact'|'defeatEnemy'|'collect', ...params }
 *   require(flags)  optional extra gate evaluated alongside the trigger
 *   onEnter      effect applied the moment this objective becomes active
 *   onComplete   effect applied the moment this objective is satisfied
 *
 * Effect shape (interpreted by quest.js — never touches THREE directly):
 *   { setFlags:[...], clearFlags:[...], weather:'storm', time:20.5,
 *     toast:'...', emit:[{event,payload}], audio:'cue-id' }
 * `emit` is how boss:enter / levelup will reach the bus once Act I's bosses
 * are authored — the machinery already supports it; nothing in this round's
 * data uses it because nothing in this round's story is a boss fight yet.
 * ------------------------------------------------------------------------ */
export const QUESTS = [
  {
    id: 'act0_flute_and_head',
    title: 'The Flute and the Great Head',
    giver: 'melina',
    objectives: [
      {
        id: 'speak_with_melina',
        text: 'Find Melina in the castle ward.',
        trigger: { type: 'talk', npc: 'melina' },
        onComplete: {
          setFlags: ['met_melina'],
          emit: [{ event: 'quest:event', payload: { id: 'melina_points_to_town', quest: 'act0_flute_and_head' } }],
        },
      },
      {
        id: 'find_the_flute',
        text: 'Find the flute the rumor speaks of, down in the town.',
        trigger: { type: 'collect', item: 'flute' },
        onComplete: {
          setFlags: ['has_flute'],
          toast: 'The flute is his now.',
          emit: [{ event: 'quest:event', payload: { id: 'flute_found', quest: 'act0_flute_and_head' } }],
        },
      },
      {
        id: 'reach_song_spot',
        text: 'Carry the flute through the forest to the place the rumor named.',
        trigger: { type: 'radius', pos: POSITIONS.songSpot, radius: 14 },
        onComplete: {
          setFlags: ['reached_song_spot'],
          emit: [{ event: 'quest:event', payload: { id: 'reached_song_spot', quest: 'act0_flute_and_head' } }],
        },
      },
      {
        id: 'play_the_song',
        text: 'Play the flute.',
        trigger: { type: 'interact', target: 'song_spot' },
        onComplete: {
          setFlags: ['song_played'],
          toast: 'The notes hang in the air longer than they should.',
          emit: [{ event: 'quest:event', payload: { id: 'great_head_appears', quest: 'act0_flute_and_head' } }],
        },
      },
      {
        id: 'hear_the_charge',
        text: 'Speak with the Great Head of Macrion.',
        trigger: { type: 'talk', npc: 'great_head' },
        onComplete: {
          setFlags: ['charged_by_great_head'],
          emit: [{ event: 'quest:event', payload: { id: 'charged_by_great_head', quest: 'act0_flute_and_head' } }],
        },
      },
    ],
    reward: {
      setFlags: ['act0_complete'],
      toast: 'Quest complete — The Flute and the Great Head',
      audio: 'quest-complete',
      emit: [{ event: 'quest:event', payload: { id: 'act0_resolved' } }],
    },
  },

  {
    id: 'act0_5_sarahs_song',
    title: "Sarah's Song",
    giver: null, // auto-started via QUEST_CHAIN, not handed off by an NPC
    objectives: [
      {
        id: 'descend_to_mainland',
        text: 'Descend from the plateau to the mainland.',
        trigger: { type: 'radius', pos: POSITIONS.mainlandGate, radius: 18 },
        onComplete: {
          setFlags: ['on_mainland'],
          toast: 'The mainland spreads out below, wrong in ways he cannot name.',
          emit: [
            { event: 'quest:event', payload: { id: 'reached_mainland', quest: 'act0_5_sarahs_song' } },
            { event: 'area:enter', payload: { area: 'mainland' } },
          ],
        },
      },
      {
        id: 'first_snagula_sighting',
        text: 'Something is watching from the rocks.',
        trigger: { type: 'radius', pos: POSITIONS.snagulaWatch, radius: 16 },
        onComplete: {
          setFlags: ['saw_snagula'],
          toast: 'Green shapes. Teeth. Eyes like coals. They watch, and do not follow — yet.',
          emit: [
            { event: 'quest:event', payload: { id: 'first_snagula_sighting', quest: 'act0_5_sarahs_song' } },
            { event: 'area:enter', payload: { area: 'snagula_watch', enemies: ['snagula'] } },
          ],
        },
      },
      {
        id: 'meet_sarah',
        text: 'Follow the music.',
        trigger: { type: 'talk', npc: 'sarah' },
        onComplete: {
          setFlags: ['vowed_to_rescue_sarah'],
          toast: 'He knows her name before she says it.',
          emit: [{ event: 'quest:event', payload: { id: 'sarah_vow', quest: 'act0_5_sarahs_song' } }],
        },
      },
      {
        id: 'first_battle',
        text: 'Fight — Sallenties has sent them for him.',
        trigger: { type: 'defeatEnemy', enemy: 'snagula' },
        onEnter: {
          toast: 'They break from the rocks together.',
          emit: [{ event: 'combat:start', payload: { enemy: 'snagula', reason: 'sallenties_ambush' } }],
        },
        onComplete: {
          setFlags: ['first_battle_won'],
          toast: 'The last of them scatters into the dark.',
          emit: [{ event: 'quest:event', payload: { id: 'first_battle_won', quest: 'act0_5_sarahs_song' } }],
        },
      },
    ],
    reward: {
      setFlags: ['act0_5_complete'],
      toast: "Quest complete — Sarah's Song",
      audio: 'quest-complete',
      emit: [{ event: 'quest:event', payload: { id: 'act0_5_resolved' } }],
    },
  },
];

/* ------------------------------------------------------------------------ *
 * Conversations — data-driven, branching, gated on progression flags.
 * Entries are checked top-to-bottom; the first whose when(flags) is true
 * (or whose id is explicitly targeted by a choice's `next`) is shown.
 * Keep a catch-all `when: () => true` last in every conversation.
 *
 * lines:   [{ speaker, text }]   null speaker = narration/flavor text
 * choices: [{ text, next, effect? }]   optional; omit for auto-advance/close
 * effect:  applied the instant this entry is shown (see Effect shape above)
 *
 * VOICE — Oz: earnest, impulsive, falls hard and fast. The Great Head:
 * ancient, formal, few words. Melina: familiar and warm. Sarah: she never
 * lies about being a spirit and nobody asks — every line she has is true
 * and reads differently on a second playthrough.
 * ------------------------------------------------------------------------ */
export const CONVERSATIONS = {
  melina: [
    {
      id: 'first_meet',
      when: (f) => !f.met_melina,
      lines: [
        { speaker: 'Melina', text: 'There you are. I thought the sword-masters would keep you all morning.' },
        { speaker: 'Melina', text: "Listen — there's talk in the town. A flute, old as the plateau itself, that can wake a sleeping sage. People say it still works." },
        { speaker: 'Melina', text: "Uncle would call it a market tale. I don't. Go and look, Oz. If it's real, you should be the one holding it." },
        { speaker: 'Oz', text: "A flute that wakes the dead? That's the best thing I've heard all week." },
        { speaker: 'Melina', text: 'Wakes a sage, not the dead. Try to come back with both.' },
      ],
      choices: [
        { text: 'Tell me about the sage.', next: 'about_sage' },
        { text: "I'll find it.", next: null },
      ],
    },
    {
      id: 'about_sage',
      lines: [
        { speaker: 'Melina', text: 'The Great Head, they call it. All that\'s left of the old sages, bound into the land itself. Nobody living has seen it wake.' },
        { speaker: 'Melina', text: 'Which is either a very good reason to go, or a very good reason not to. Knowing you, I know which one wins.' },
      ],
      choices: [{ text: 'Right.', next: null }],
    },
    {
      id: 'reminder_pre_flute',
      when: (f) => f.met_melina && !f.has_flute,
      lines: [
        { speaker: 'Melina', text: "Town's down past the gate. Ask around the stalls — somebody always knows more than they're telling." },
      ],
    },
    {
      id: 'reminder_pre_song',
      when: (f) => f.has_flute && !f.song_played,
      lines: [
        { speaker: 'Melina', text: "You actually found it. Don't just carry the thing, Oz — find wherever it's meant to be played." },
      ],
    },
    {
      id: 'after_charge',
      when: (f) => f.charged_by_great_head && !f.act0_5_complete,
      lines: [
        { speaker: 'Melina', text: 'You look like a man who just talked to a ghost the size of a hill.' },
        { speaker: 'Melina', text: "Go, then. Cleanse the land. Come back in one piece — that part isn't optional." },
      ],
    },
    {
      id: 'after',
      when: () => true,
      lines: [{ speaker: 'Melina', text: 'The plateau holds, for now.' }],
    },
  ],

  flute_found: [
    {
      id: 'found',
      when: (f) => !f.has_flute,
      lines: [
        { speaker: null, text: 'A flute, tucked behind loose stones — old wood, dark with handling, carved with a spiral that has no start.' },
        { speaker: 'Oz', text: 'This is it. Has to be.' },
      ],
    },
    {
      id: 'carried',
      when: () => true,
      lines: [{ speaker: null, text: 'The flute rests warm against his hand, like it has been waiting to be picked up again.' }],
    },
  ],

  song_spot: [
    {
      id: 'before',
      when: (f) => !f.song_played,
      lines: [
        { speaker: null, text: 'A ring of standing stones, half-swallowed by moss, holding a silence too complete to be empty.' },
      ],
    },
    {
      id: 'after',
      when: () => true,
      lines: [{ speaker: null, text: 'The air here still hums, faintly, on the edge of hearing.' }],
    },
  ],

  great_head: [
    {
      id: 'summon',
      when: (f) => !f.charged_by_great_head,
      lines: [
        { speaker: null, text: 'The ground does not shake. The air simply admits it was hiding something.' },
        { speaker: 'The Great Head of Macrion', text: 'You played true. Few do, on the first try.' },
        { speaker: 'Oz', text: "I didn't know if it would even work." },
        { speaker: 'The Great Head of Macrion', text: 'It worked because you meant it. That is the whole of the craft.' },
        { speaker: 'The Great Head of Macrion', text: 'The land below is defiled. Sallenties walks it unchallenged. This charge is yours: go down, and cleanse it.' },
        { speaker: 'Oz', text: "I'll go. I swear it." },
        { speaker: 'The Great Head of Macrion', text: 'Swear less. Walk more. Begin.' },
      ],
    },
    {
      id: 'after',
      when: () => true,
      lines: [{ speaker: 'The Great Head of Macrion', text: 'The charge stands. Go.' }],
    },
  ],

  fall_site: [
    {
      id: 'look',
      when: () => true,
      lines: [
        { speaker: null, text: "A flagstone in the inner ward, cracked corner to corner. Moss has already found the crack. No one seems to remember why it's broken." },
      ],
    },
  ],

  sarah: [
    {
      id: 'first',
      when: (f) => !f.vowed_to_rescue_sarah,
      lines: [
        { speaker: null, text: "Music first — high and clear, and wrong for the wind to carry it this far. Then her, standing where the light doesn't quite reach her feet." },
        { speaker: 'Sarah', text: 'You can hear that? Not many can, out here.' },
        { speaker: 'Oz', text: 'Who are you?' },
        { speaker: 'Sarah', text: "Sarah. I don't get many visitors." },
        { speaker: 'Oz', text: 'Are you all right? You look—' },
        { speaker: 'Sarah', text: "Cold. I know. I've been cold a long time." },
        { speaker: 'Sarah', text: 'He keeps me apart from everything else. I sing so I remember I still can.' },
        { speaker: 'Oz', text: 'Sallenties.' },
        { speaker: 'Sarah', text: "Find me, if you're the sort who does that. I'd like to be found." },
      ],
    },
    {
      id: 'after',
      when: () => true,
      lines: [{ speaker: 'Sarah', text: "Still here. Still singing. Hurry, if you're going to." }],
    },
  ],
};
