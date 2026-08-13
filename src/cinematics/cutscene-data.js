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
 * Cutscene registry — maps ID to script.
 * Register new cutscenes here.
 */
export const cutscenes = {
  intro: introCutscene,
};
