/**
 * Macrion cutscene scripts — data-driven definitions.
 * OWNED BY CINEMATICS BUILDER.
 *
 * Each cutscene is a { name, duration, letterboxDuration, beats: [] }.
 * Beats are timed events: camera keyframes, holds, world-state changes, callbacks.
 */

/**
 * Intro cutscene — establishing shot of the basin.
 * Camera sweeps across the valley toward the mountains at golden hour (17.4).
 * Total duration: ~8 seconds with letterbox animations.
 */
export const introCutscene = {
  name: 'intro',
  duration: 8.0,
  letterboxDuration: 0.4,
  beats: [
    // Set golden-hour lighting before camera moves
    {
      type: 'time',
      hour: 17.4,
      duration: 0,
    },
    {
      type: 'weather',
      weather: 'clear',
      duration: 0,
    },

    // Main camera sweep: start from the left edge, sweep across the basin
    // toward the mountains. Position keyframes form a smooth arc.
    {
      type: 'camera',
      duration: 7.2,
      ease: 'easeInOutCubic',
      // Positions: sweep from left edge across the valley
      positions: [
        [-120, 35, 150],      // Start: left edge, high view
        [-60, 28, 100],       // Mid-left: arc over valley
        [0, 22, 40],          // Center: lower, closer to terrain
        [60, 20, -80],        // Mid-right: continuing sweep
        [120, 25, -200],      // End: far right, looking at mountains
      ],
      // Look-at targets: guide the viewer's gaze across the landscape
      targets: [
        [50, 10, -150],       // Start: look toward basin center
        [80, 8, -200],        // Mid-left: shift right
        [100, 5, -250],       // Center: toward mountains
        [120, 8, -300],       // Mid-right: mountain peaks
        [150, 15, -350],      // End: mountain silhouettes
      ],
      // FOV narrows slightly during the sweep for cinematic effect
      fovStart: 48,
      fov: 42,
    },

    // Hold final frame for a moment
    {
      type: 'hold',
      duration: 0.8,
    },
  ],
};

/**
 * firstBlood — short beat after the first encounter set (docs/GAME_DESIGN.md
 * §4: "After basic fights — short beats"). Oz is held at distance/in
 * silhouette against the warm late-afternoon light, not in portrait
 * close-up — his face is being rebuilt concurrently by another builder and
 * is not ready for a tight framing. A low breath of Sarah's motif plays
 * under it: per docs/STORY.md her theme is the player's emotional compass
 * and should recur at every major beat, starting here.
 * Total duration: ~4.1s.
 */
export const firstBloodCutscene = {
  name: 'firstBlood',
  duration: 4.1,
  letterboxDuration: 0.3,
  beats: [
    { type: 'time', hour: 16.8, duration: 0 },
    { type: 'weather', weather: 'clear', duration: 0 },
    {
      type: 'callback',
      duration: 0,
      fn: (ctx) => {
        ctx.engine.systems?.audio?.setMusicState?.('explore');
        ctx.engine.systems?.audio?.sarahMemory?.(0.2);
      },
    },
    // Arc around Oz at distance, aftermath silhouette against warm light.
    {
      type: 'camera',
      duration: 3.2,
      ease: 'easeInOutCubic',
      positions: [
        [30, 19, 45],
        [18, 17, 34],
        [4, 16.5, 20],
      ],
      targets: [
        [12, 17.5, 26],
        [12, 17.3, 26],
        [12, 17.1, 26],
      ],
      fovStart: 40,
      fov: 36,
    },
    { type: 'hold', duration: 0.9 },
  ],
};

/**
 * bossVictory — the big one. Reward order per docs/GAME_DESIGN.md §4 is
 * exact: win (triggered externally by src/game/boss.js calling
 * cutscene.play('bossVictory')) -> this cutscene -> level up -> new power ->
 * the breathtaking view ahead with the next paths visible in it. All of
 * that ordering lives INSIDE this script as beats, so the player leaves the
 * cutscene already knowing where they can go.
 *
 * Oz is framed at distance/in silhouette throughout (never a close portrait)
 * per the same face-not-ready constraint as firstBlood.
 * Total duration: ~9.7s.
 */
export const bossVictoryCutscene = {
  name: 'bossVictory',
  duration: 9.7,
  letterboxDuration: 0.4,
  beats: [
    { type: 'time', hour: 17.4, duration: 0 },
    { type: 'weather', weather: 'clear', duration: 0 },
    {
      type: 'callback',
      duration: 0,
      fn: (ctx) => ctx.engine.systems?.audio?.setMusicState?.('resolve'),
    },

    // Triumph shot: Oz silhouetted at distance over the fallen boss.
    {
      type: 'camera',
      duration: 2.6,
      ease: 'easeInOutCubic',
      positions: [
        [58, 20, -155],
        [46, 17, -168],
        [34, 15, -178],
      ],
      targets: [
        [42, 18, -172],
        [41, 17.5, -171],
        [40, 17, -170],
      ],
      fovStart: 44,
      fov: 40,
    },

    // Level up + new power, granted mid-cutscene so the player already
    // knows what they have before the vista reveal shows them where to
    // spend it. Power is a key for the road ahead (see boss.js), not a
    // stat bump — Storm Dash, the traversal power the 3 revealed paths
    // will need to reach.
    {
      type: 'callback',
      duration: 0,
      fn: (ctx) => {
        ctx.engine.systems?.game?.grantLevel?.('stormDash');
        ctx.engine.systems?.hud?.toast?.('LEVEL UP — New Power: Storm Dash');
        ctx.engine.systems?.audio?.sarahMemory?.(0.55);
      },
    },
    { type: 'hold', duration: 0.4 },

    // The breathtaking view ahead — pull back and up into a wide vista over
    // the basin toward the mountains, wide enough that the ground it opens
    // onto reads as a fork of routes rather than a single corridor. FOV
    // widens through the move to sell the scale of what's now reachable.
    {
      type: 'camera',
      duration: 5.4,
      ease: 'easeInOutCubic',
      positions: [
        [34, 15, -178],
        [10, 45, -230],
        [-40, 70, -260],
        [-90, 95, -300],
      ],
      targets: [
        [40, 20, -170],
        [30, 10, -260],
        [10, 0, -340],
        [-60, -5, -420],
      ],
      fovStart: 40,
      fov: 52,
    },
    { type: 'hold', duration: 1.3 },
  ],
};

/**
 * endCard — hard requirement (docs/STORY.md "The end card — required
 * content"). A slow night pan over the kingdom, then the required overlay:
 * a link to https://www.solomonchrist.com, an invitation to join the
 * mailing list for AI + Automation, and the statement that the entire game
 * was made using Claude and AI. The overlay is shown via cutscene.js's
 * showEndCard(), and — unlike the letterbox — is deliberately NOT hidden
 * when the cutscene finishes; it is meant to be the last thing on screen.
 * cutscene.js's skip() also force-shows it if the player skips through
 * before this beat fires, so the requirement holds even on skip.
 * Total duration: ~9.5s (overlay persists after).
 */
export const endCardCutscene = {
  name: 'endCard',
  duration: 9.5,
  letterboxDuration: 0.4,
  beats: [
    { type: 'time', hour: 21.0, duration: 0 },
    { type: 'weather', weather: 'clear', duration: 0 },
    {
      type: 'callback',
      duration: 0,
      fn: (ctx) => ctx.engine.systems?.audio?.setMusicState?.('resolve'),
    },

    // Slow high pan over the kingdom silhouette at night — no close framing
    // of any character, just the world settling.
    {
      type: 'camera',
      duration: 3.0,
      ease: 'easeInOutCubic',
      positions: [
        [-40, 55, 140],
        [-10, 60, 90],
        [20, 65, 40],
      ],
      targets: [
        [0, 10, -150],
        [10, 8, -180],
        [20, 6, -200],
      ],
      fovStart: 45,
      fov: 38,
    },

    { type: 'endcard', action: 'show', duration: 0 },
    { type: 'hold', duration: 6.5 },
  ],
};

/**
 * Cutscene registry — maps ID to script.
 * Register new cutscenes here.
 */
export const cutscenes = {
  intro: introCutscene,
  firstBlood: firstBloodCutscene,
  bossVictory: bossVictoryCutscene,
  endCard: endCardCutscene,
};
