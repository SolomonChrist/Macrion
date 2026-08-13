/**
 * Macrion — story content for level 1: "The Dark Cairn".
 *
 * PURE DATA (plus small pure condition functions). No THREE, no engine calls,
 * no side effects. quest.js and dialogue.js are the machinery that interprets
 * this file; a level 2 is authored by writing a new file in this shape, not
 * by touching the machinery.
 *
 * ---------------------------------------------------------------------------
 * THE PLACE
 *
 * The basin is the Varn — a dry highland bowl of grass and standing stone,
 * closed on every side by the Cindral peaks. A player should be able to
 * orient by:
 *   - the Cindral Shoulder   nearest ridge, north of camp — the wardcairn sits
 *                            on it. Close enough to see individual stones.
 *   - the Cindral Wall       the second rank of peaks behind the Shoulder
 *   - the High Cindral       the snowbound crest line, farthest and palest
 *   - the Rasp Wall          the range closing the basin to the east
 *   - the Hollow Wall        the range closing the basin to the west
 *   - the Sable Ridge        the lower range at the player's back, south
 *
 * THE PREMISE
 *
 * For as long as anyone in the Varn can count, wardcairns built into the
 * shoulders of the Cindral peaks have kept the basin's weather honest —
 * golden mornings, cold clean nights, storms that come and go on schedule.
 * The Cindral people raised them, generations back, and then were gone; what's
 * left is the craft of tending the coals, passed Warden to apprentice.
 *
 * You are a Warden, trained from childhood to walk the high cairns and keep
 * them lit. Your teacher kept the nearest ones for twenty years, until the
 * message came that she wasn't coming back down. You've returned alone for
 * the first time — and the first cairn you check, the one on the shoulder
 * above camp, is already dark. The sky already knows it.
 *
 * THE FIRST QUEST — "The Dark Cairn"
 *
 * Beginning:    talk to Senna Vey, a herder who camped near your spawn point
 *               and knew your teacher. She points you up the shoulder trail.
 * Complication: the moment you reach the cairn, the sky breaks — a storm
 *               that shouldn't exist yet rolls in, because the coal that
 *               would have kept it off is dark. The cairn only takes a
 *               light in true dark, so you have to keep vigil and let real
 *               night fall around you while the storm runs itself out.
 * Resolution:   relight the coal, watch the storm spend itself, and carry
 *               the news back down to Senna.
 *
 * All of it happens within ~100 m of spawn. Verticality (the climb to the
 * Shoulder), weather (the storm), and time of day (the vigil) do the work
 * that distance would do in a bigger level.
 */

export const LORE = {
  title: 'Macrion',
  basin: 'the Varn',
  premise:
    "The Varn is a bowl of dry grass and standing stone, ringed by the white teeth of the " +
    "Cindral peaks. For as long as anyone can count, the wardcairns built into their shoulders " +
    "have kept the basin's weather honest — golden mornings, cold clean nights, storms that come " +
    "and go on schedule. You are a Warden, trained from childhood to walk the high cairns and " +
    "keep their coals lit; your teacher kept the nearest ones for twenty years, until the message " +
    "came that she wouldn't be coming back down. You've returned alone for the first time, and " +
    "the first cairn you check — the one on the shoulder above camp — is dark. The sky already knows it.",
  landmarks: [
    { id: 'cindral_shoulder', name: 'the Cindral Shoulder', desc: 'Nearest ridge, north of camp. The wardcairn sits on it.' },
    { id: 'cindral_wall', name: 'the Cindral Wall', desc: 'The second rank of peaks behind the Shoulder.' },
    { id: 'high_cindral', name: 'the High Cindral', desc: 'The snowbound crest line, farthest and palest.' },
    { id: 'rasp_wall', name: 'the Rasp Wall', desc: 'Closes the basin to the east.' },
    { id: 'hollow_wall', name: 'the Hollow Wall', desc: 'Closes the basin to the west.' },
    { id: 'sable_ridge', name: 'the Sable Ridge', desc: 'Lower range at your back, south of camp.' },
  ],
};

/**
 * World-space anchors for level-1 content. Independent of SPAWN in
 * entities/character.js by design — that file is owned by the Character
 * builder and may move; these are close to it (spawn is ~[12, 26]) but not
 * coupled to its export, so a spawn tweak there can't silently break trigger
 * geometry here. Sampled against the real height field (see report) so the
 * climb to the cairn is a genuine ~16 m rise over ~90 m, not a flat walk.
 */
export const POSITIONS = {
  senna: { x: 20, z: 21 },
  wardcairn: { x: 25, z: -70 },
};

/* ------------------------------------------------------------------------ *
 * Interactables — what the player can walk up to and press E on.
 * kind: 'npc' opens a branching conversation; 'object' shows flavor text and
 * may carry a mechanical action gated by the active quest objective.
 * ------------------------------------------------------------------------ */
export const INTERACTABLES = [
  {
    id: 'senna', kind: 'npc', name: 'Senna Vey',
    pos: POSITIONS.senna, radius: 3.4,
    conversation: 'senna',
  },
  {
    id: 'wardcairn', kind: 'object', name: 'the wardcairn',
    pos: POSITIONS.wardcairn, radius: 4.5,
    conversation: 'wardcairn',
    // Mechanical effect of pressing E here, keyed by the quest's CURRENT
    // active objective id. Anything not listed here is flavor-text-only.
    actionByObjective: {
      hold_vigil: { type: 'vigil', hourStep: 3.2, nightRange: [20, 5] },
      relight_cairn: { type: 'notify', trigger: 'interact', target: 'wardcairn' },
    },
  },
];

/* ------------------------------------------------------------------------ *
 * Quest definition.
 *
 * Objective shape:
 *   id           stable string, used by save data and console testing
 *   text         HUD-facing objective text
 *   trigger      { type: 'radius'|'timeOfDay'|'talk'|'interact'|'defeatEnemy'|'collect', ...params }
 *   require(flags)  optional extra gate evaluated alongside the trigger
 *   onEnter      effect applied the moment this objective becomes active
 *   onComplete   effect applied the moment this objective is satisfied
 *
 * Effect shape (interpreted by quest.js — never touches THREE directly):
 *   { setFlags:[...], clearFlags:[...], weather:'storm', time:20.5,
 *     toast:'...', emit:[{event,payload}], audio:'cue-id' }
 * ------------------------------------------------------------------------ */
export const QUESTS = [
  {
    id: 'dark_cairn',
    title: 'The Dark Cairn',
    giver: 'senna',
    objectives: [
      {
        id: 'meet_senna',
        text: 'Speak with Senna Vey.',
        trigger: { type: 'talk', npc: 'senna' },
        onComplete: {
          setFlags: ['met_senna'],
          emit: [{ event: 'quest:event', payload: { id: 'quest_accepted', quest: 'dark_cairn' } }],
        },
      },
      {
        id: 'reach_cairn',
        text: 'Climb the shoulder trail to the wardcairn.',
        trigger: { type: 'radius', pos: POSITIONS.wardcairn, radius: 16 },
        onComplete: {
          setFlags: ['reached_cairn'],
          weather: 'storm',
          toast: 'The sky breaks over the ridge.',
          emit: [{ event: 'quest:event', payload: { id: 'storm_rolls_in', quest: 'dark_cairn' } }],
        },
      },
      {
        id: 'hold_vigil',
        text: 'Keep vigil at the cairn until true dark falls.',
        // Satisfied generically once the clock is in the night range — the
        // vigil action on the wardcairn interactable is what pushes the
        // clock there; this trigger doesn't care how the hour got there,
        // so a later real day/night cycle would satisfy it just as well.
        trigger: { type: 'timeOfDay', in: [20, 5] },
        onComplete: {
          setFlags: ['night_fallen'],
          weather: 'clear',
          toast: 'The storm spends itself as true dark falls.',
          emit: [{ event: 'quest:event', payload: { id: 'night_fallen', quest: 'dark_cairn' } }],
        },
      },
      {
        id: 'relight_cairn',
        text: 'Relight the wardcairn.',
        trigger: { type: 'interact', target: 'wardcairn' },
        onComplete: {
          setFlags: ['cairn_lit'],
          toast: 'The coal catches. Warm light climbs the shoulder stones.',
          audio: 'cairn-relight',
          emit: [{ event: 'quest:event', payload: { id: 'cairn_lit', quest: 'dark_cairn' } }],
        },
      },
      {
        id: 'report_back',
        text: 'Tell Senna Vey the cairn is lit.',
        trigger: { type: 'talk', npc: 'senna' },
        require: (flags) => !!flags.cairn_lit,
      },
    ],
    reward: {
      setFlags: ['quest_dark_cairn_complete', 'warden_recognized'],
      toast: 'Quest complete — The Dark Cairn',
      audio: 'quest-complete',
      emit: [{ event: 'quest:event', payload: { id: 'dark_cairn_resolved' } }],
    },
  },
];

/* ------------------------------------------------------------------------ *
 * Conversations — data-driven, branching, gated on progression flags.
 * Entries are checked top-to-bottom; the first whose when(flags) is true
 * (or whose id is explicitly targeted by a choice's `next`) is shown.
 * Keep a catch-all `when: () => true` last in every conversation.
 *
 * lines:   [{ speaker, text }]
 * choices: [{ text, next, effect? }]   optional; omit for auto-advance/close
 * effect:  applied the instant this entry is shown (see Effect shape above)
 * ------------------------------------------------------------------------ */
export const CONVERSATIONS = {
  senna: [
    {
      id: 'first_meet',
      when: (f) => !f.met_senna,
      lines: [
        { speaker: 'Senna Vey', text: "You made it. Good — thought I'd have to send someone up after you too." },
        { speaker: 'Senna Vey', text: "You'll be Mira's, then. The new Warden. Word came down about her. I'm sorry." },
        { speaker: 'Senna Vey', text: "Cairn on the shoulder above camp's gone dark. Started two nights back. Weather's been walking around like it forgot the schedule since." },
        { speaker: 'Senna Vey', text: "Should be a simple relight. If it were simple, it'd still be lit." },
      ],
      effect: {
        setFlags: ['met_senna'],
        emit: [{ event: 'quest:event', payload: { id: 'quest_accepted', quest: 'dark_cairn' } }],
      },
      choices: [
        { text: 'Who was she to you?', next: 'about_mira' },
        { text: "I'll go look at it.", next: null },
      ],
    },
    {
      id: 'about_mira',
      lines: [
        { speaker: 'Senna Vey', text: 'Twenty years keeping those coals lit. Taught half this basin where not to walk in a storm.' },
        { speaker: 'Senna Vey', text: "She'd have wanted you doing this, not standing here talking to me. Go on." },
      ],
      choices: [{ text: 'Right.', next: null }],
    },
    {
      id: 'reminder_pre_vigil',
      when: (f) => f.met_senna && !f.reached_cairn,
      lines: [
        { speaker: 'Senna Vey', text: "Shoulder trail's behind my camp — follows the goat track up. You'll see the cairn stones from a way off. Dark stone against a bright sky, can't miss it." },
      ],
    },
    {
      id: 'reminder_vigil',
      when: (f) => f.reached_cairn && !f.night_fallen,
      lines: [
        { speaker: 'Senna Vey', text: "Sky's already turning up there, isn't it. Cairns only take a light in true dark — don't waste the wait on half-dusk." },
      ],
    },
    {
      id: 'reminder_relight',
      when: (f) => f.night_fallen && !f.cairn_lit,
      lines: [
        { speaker: 'Senna Vey', text: "Well? Dark's dark. Get up there and strike it." },
      ],
    },
    {
      id: 'report_back',
      when: (f) => f.cairn_lit && !f.quest_dark_cairn_complete,
      lines: [
        { speaker: 'Senna Vey', text: '...I saw it catch from down here. Whole ridge went warm for a second.' },
        { speaker: 'Senna Vey', text: "That's a Warden's work, that is. First one you've lit on your own." },
        { speaker: 'Senna Vey', text: "She'd have said something dry about it taking you long enough. I'll say it was well done instead." },
      ],
      choices: [{ text: 'Thank you.', next: null }],
    },
    {
      id: 'after',
      when: () => true,
      lines: [
        { speaker: 'Senna Vey', text: "Basin's quiet tonight. Let's keep it that way." },
      ],
    },
  ],

  wardcairn: [
    {
      id: 'cold',
      when: (f) => !f.met_senna,
      lines: [
        { speaker: null, text: 'Stacked stone, waist high, soot-black at the crown. Whatever burned here has been out a long time.' },
      ],
    },
    {
      id: 'marked',
      when: (f) => f.met_senna && !f.reached_cairn,
      lines: [
        { speaker: null, text: 'This must be the one Senna meant. Dark, just like she said.' },
      ],
    },
    {
      id: 'wrong_light',
      when: (f) => f.reached_cairn && !f.night_fallen,
      lines: [
        { speaker: null, text: "The stones are cold, and the sky over the shoulder has that too-bright, wrong look. Better to wait for true dark." },
      ],
    },
    {
      id: 'ready',
      when: (f) => f.night_fallen && !f.cairn_lit,
      lines: [
        { speaker: null, text: "Dark enough now. The coal's waiting." },
      ],
    },
    {
      id: 'lit',
      when: (f) => f.cairn_lit && !f.quest_dark_cairn_complete,
      lines: [
        { speaker: null, text: 'Warm light climbs the shoulder stones. Senna will want to see this.' },
      ],
    },
    {
      id: 'after',
      when: () => true,
      lines: [
        { speaker: null, text: "The coal breathes low and steady. Whatever kept it dark hasn't come back — not yet." },
      ],
    },
  ],
};
