/**
 * Macrion cutscene system — camera authority, timed beats, smooth interpolation.
 * OWNED BY CINEMATICS BUILDER.
 *
 * Implements the data-driven cutscene contract:
 * - play(id) starts a registered cutscene, returns Promise resolving on finish
 * - skip() aborts immediately, restores camera authority
 * - isPlaying() boolean
 * - define(id, script) registers a cutscene
 * - update(ctx) is called every frame; only active if engine.mode === 'cutscene'
 *
 * Camera authority: saves and restores engine.mode across playback.
 * Timing is deterministic: driven by ctx.time (engine clock), not performance.now().
 */

import * as THREE from 'three';
import { cutscenes as cutsceneRegistry } from './cutscene-data.js';

/**
 * Easing functions — all deterministic, no randomness.
 * t: 0..1 normalized time within the beat.
 */
const easings = {
  linear: (t) => t,
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 + --t * 2 * (2 * (t) * t),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => (--t) * t * t + 1,
};

export function createCutscene(ctx) {
  const { engine, camera } = ctx;

  const state = {
    playing: false,
    startTime: 0,
    script: null,
    previousMode: 'shot',
    originalMode: 'shot',  // Preserved across nested play() calls
    playResolve: null,
    skipRequested: false,
  };

  // Create letterbox bars (top and bottom)
  const letterboxContainer = document.createElement('div');
  letterboxContainer.id = 'macrion-letterbox';
  letterboxContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999;
    display: none;
  `;

  const topBar = document.createElement('div');
  topBar.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 0;
    background: #000;
  `;

  const bottomBar = document.createElement('div');
  bottomBar.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 0;
    background: #000;
  `;

  letterboxContainer.appendChild(topBar);
  letterboxContainer.appendChild(bottomBar);
  document.body.appendChild(letterboxContainer);

  /**
   * Interpolate along a Catmull-Rom spline through keyframe positions.
   * Caches the curve per beat to avoid repeated creation.
   */
  function interpolateSpline(beat, t, ease = 'easeInOutQuad') {
    if (!beat._curve) {
      // Cache the curve on the beat object
      const keyframes = beat.positions;
      if (keyframes.length === 1) {
        beat._curve = { type: 'single', point: new THREE.Vector3(...keyframes[0]) };
      } else if (keyframes.length === 2) {
        beat._curve = { type: 'line', p0: new THREE.Vector3(...keyframes[0]), p1: new THREE.Vector3(...keyframes[1]) };
      } else {
        const curve = new THREE.CatmullRomCurve3(
          keyframes.map(p => new THREE.Vector3(...p))
        );
        curve.curveType = 'catmullrom';
        curve.closed = false;
        beat._curve = { type: 'spline', curve };
      }
    }

    const easeFn = easings[ease] || easings.easeInOutQuad;
    const eased = easeFn(t);

    const { _curve } = beat;
    if (_curve.type === 'single') {
      return _curve.point.clone();
    } else if (_curve.type === 'line') {
      return _curve.p0.clone().lerp(_curve.p1, eased);
    } else {
      return _curve.curve.getPoint(eased);
    }
  }

  /**
   * Interpolate array of numbers (for look-at targets and FOV).
   * For array targets, interpolate through all keypoints using the same spline approach.
   */
  function interpolateArray(beat, keyframes, t, ease = 'easeInOutQuad') {
    if (!keyframes || keyframes.length === 0) return null;

    const easeFn = easings[ease] || easings.easeInOutQuad;
    const eased = easeFn(t);

    if (keyframes.length === 1) {
      return [...keyframes[0]];
    }

    if (keyframes.length === 2) {
      return [
        keyframes[0][0] + (keyframes[1][0] - keyframes[0][0]) * eased,
        keyframes[0][1] + (keyframes[1][1] - keyframes[0][1]) * eased,
        keyframes[0][2] + (keyframes[1][2] - keyframes[0][2]) * eased,
      ];
    }

    // For 3+ keyframes, use Catmull-Rom in 3D space
    const points = keyframes.map(p => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(points);
    curve.curveType = 'catmullrom';
    curve.closed = false;
    const point = curve.getPoint(eased);
    return [point.x, point.y, point.z];
  }

  /**
   * Process a beat: camera keyframe, hold, world-state change, or callback.
   * Returns { done: boolean, nextTime: number } to track progress.
   */
  function processBeat(beat, elapsed, ctx) {
    const { duration, ease = 'easeInOutQuad' } = beat;

    if (beat.type === 'camera') {
      const { positions, targets, fov, duration } = beat;
      const t = Math.min(elapsed / duration, 1);

      const pos = interpolateSpline(beat, t, ease);
      const target = interpolateArray(beat, targets, t, ease);

      camera.position.copy(pos);
      if (target) camera.lookAt(...target);
      camera.updateMatrixWorld(false);
      if (fov !== undefined) {
        const fovStart = beat.fovStart ?? camera.fov;
        const fovEnd = fov;
        const easeFn = easings[ease] || easings.easeInOutQuad;
        camera.fov = fovStart + (fovEnd - fovStart) * easeFn(t);
        camera.updateProjectionMatrix();
      }

      return { done: t >= 1, nextTime: elapsed };
    }

    if (beat.type === 'hold') {
      return { done: elapsed >= beat.duration, nextTime: elapsed };
    }

    if (beat.type === 'time') {
      engine.setTime(beat.hour);
      return { done: true, nextTime: elapsed };
    }

    if (beat.type === 'weather') {
      engine.setWeather(beat.weather);
      return { done: true, nextTime: elapsed };
    }

    if (beat.type === 'callback') {
      if (elapsed >= 0 && !beat._called) {
        beat.fn?.(ctx);
        beat._called = true;
      }
      return { done: true, nextTime: elapsed };
    }

    return { done: true, nextTime: elapsed };
  }

  /**
   * Play a cutscene by ID. Returns a Promise that resolves when the cutscene
   * finishes or is skipped.
   */
  function play(id) {
    return new Promise((resolve) => {
      const script = cutscenes[id];
      if (!script) {
        console.warn(`[cutscene] unknown cutscene: ${id}`);
        resolve();
        return;
      }

      // Only save the mode if not already playing a cutscene; this prevents nested
      // play() calls from losing track of the original mode before any cutscene started
      const wasPlaying = state.playing;
      if (!wasPlaying || engine.mode !== 'cutscene') {
        state.previousMode = engine.mode;
        state.originalMode = engine.mode;
      }

      state.playing = true;
      state.startTime = ctx.time;
      state.script = script;
      state.playResolve = resolve;
      state.skipRequested = false;

      // Initialize all beats' _called flags
      for (const beat of script.beats) {
        beat._called = false;
      }

      // Take camera authority
      engine.setMode('cutscene');

      // Show letterbox (animation happens in update())
      letterboxContainer.style.display = 'block';
    });
  }

  /**
   * Skip the current cutscene immediately.
   */
  function skip() {
    if (!state.playing) return;

    state.skipRequested = true;
    state.playing = false;

    // Hide letterbox immediately
    letterboxContainer.style.display = 'none';
    topBar.style.height = '0';
    bottomBar.style.height = '0';

    // Restore camera authority to the mode before this play() call
    const restoreMode = state.originalMode !== 'cutscene' ? state.originalMode : state.previousMode;
    engine.setMode(restoreMode);

    if (state.playResolve) {
      state.playResolve();
      state.playResolve = null;
    }
  }

  function isPlaying() {
    return state.playing;
  }

  const cutscenes = { ...cutsceneRegistry };

  function define(id, script) {
    cutscenes[id] = script;
  }

  /**
   * Update is called every frame by the engine.
   * Only runs if engine.mode === 'cutscene'.
   */
  function update(ctx) {
    // Only update if we own the camera
    if (ctx.engine.mode !== 'cutscene') return;

    if (!state.playing || !state.script) return;

    const elapsed = ctx.time - state.startTime;
    const script = state.script;

    // Animate letterbox
    const barHeight = (window.innerHeight * 0.18) | 0;
    const letterboxDuration = script.letterboxDuration || 0.3;
    const totalDuration = script.duration || 10;

    // Bars animate in during letterboxDuration, stay, then animate out in final letterboxDuration
    if (elapsed < letterboxDuration) {
      const t = elapsed / letterboxDuration;
      topBar.style.height = (barHeight * t) + 'px';
      bottomBar.style.height = (barHeight * t) + 'px';
    } else if (elapsed < totalDuration - letterboxDuration) {
      topBar.style.height = barHeight + 'px';
      bottomBar.style.height = barHeight + 'px';
    } else if (elapsed < totalDuration) {
      const fadeStart = totalDuration - letterboxDuration;
      const t = 1 - ((elapsed - fadeStart) / letterboxDuration);
      topBar.style.height = (barHeight * Math.max(0, t)) + 'px';
      bottomBar.style.height = (barHeight * Math.max(0, t)) + 'px';
    } else {
      // Finished — restore camera authority to the mode before this play() call
      topBar.style.height = '0';
      bottomBar.style.height = '0';
      letterboxContainer.style.display = 'none';

      state.playing = false;
      // Use originalMode if we're finishing a nested play, otherwise use previousMode
      const restoreMode = state.originalMode !== 'cutscene' ? state.originalMode : state.previousMode;
      engine.setMode(restoreMode);

      if (state.playResolve) {
        state.playResolve();
        state.playResolve = null;
      }
      return;
    }

    // Process beats
    let beatIndex = 0;
    let beatElapsed = elapsed;

    for (let i = 0; i < script.beats.length; i++) {
      const beat = script.beats[i];
      const beatDuration = beat.duration || 0;

      if (beatElapsed < beatDuration) {
        processBeat(beat, beatElapsed, ctx);
        break;
      }

      beatElapsed -= beatDuration;
    }
  }

  // Listen for skip keypress
  const handleKeyDown = (e) => {
    if (state.playing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      skip();
    }
  };

  addEventListener('keydown', handleKeyDown);

  const dispose = () => {
    removeEventListener('keydown', handleKeyDown);
    letterboxContainer.remove();
  };

  return {
    name: 'cutscene',
    update,
    play,
    skip,
    isPlaying,
    define,
    dispose,
  };
}
