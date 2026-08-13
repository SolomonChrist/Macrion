/**
 * Macrion engine core — OWNED BY LEAD. Builders must not edit this file.
 *
 * Provides: renderer, camera, frame loop, sun model, named shots, and the
 * window.MACRION capture contract (docs/CAPTURE_CONTRACT.md).
 *
 * Builders plug into module slots via registerModule(). Each module may expose:
 *   { name, object3D?, update?(ctx), onSun?(ctx), onResize?(w,h), dispose?() }
 */
import * as THREE from 'three';

export const SEED = 1337;

/** Deterministic RNG — mulberry32. No bare Math.random() anywhere in Macrion. */
export function makeRNG(seed = SEED) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sun direction from hour-of-day. Returns a unit vector pointing FROM origin
 * TOWARD the sun. Elevation peaks at 12:00, sunrise ~06:00, sunset ~18:00.
 */
export function sunDirection(hour, out = new THREE.Vector3()) {
  const t = ((hour - 6) / 12) * Math.PI;         // 0 at sunrise, PI at sunset
  const elevation = Math.sin(t) * (Math.PI * 0.46);
  const azimuth = -Math.PI * 0.35 + (hour / 24) * Math.PI * 1.4;
  const cosE = Math.cos(elevation);
  return out.set(cosE * Math.sin(azimuth), Math.sin(elevation), cosE * Math.cos(azimuth)).normalize();
}

/**
 * Weather presets. Modules read ctx.weather and respond in onWeather(ctx).
 * These are normalized authoring dials, not physical units — each module maps
 * them into its own domain (sky turbidity, fog density, wind, wetness...).
 */
export const WEATHER = {
  clear:    { cloud: 0.10, turbidity: 2.2, haze: 0.55, sunMul: 1.00, wind: 0.35, wet: 0.0, precip: 0.0 },
  hazy:     { cloud: 0.32, turbidity: 5.0, haze: 1.35, sunMul: 0.82, wind: 0.30, wet: 0.0, precip: 0.0 },
  overcast: { cloud: 0.88, turbidity: 7.5, haze: 1.80, sunMul: 0.28, wind: 0.55, wet: 0.35, precip: 0.0 },
  storm:    { cloud: 1.00, turbidity: 9.5, haze: 2.40, sunMul: 0.12, wind: 1.00, wet: 0.90, precip: 1.0 },
};

/** Camera poses. Positions are (x, heightAboveTerrain, z) + look target. */
export const SHOTS = {
  vista:   { pos: [-40, 26, 120], look: [10, 4, -320], fov: 42, hour: 9.5, weather: 'clear' },
  eye:     { pos: [12, 1.7, 34], look: [40, 3.0, -140], fov: 55, hour: 10.5, weather: 'clear', ground: true },
  backlit: { pos: [0, 2.2, 40], look: [0, 6, -160], fov: 50, hour: 17.4, weather: 'clear', ground: true },
  grazing: { pos: [-90, 12, 60], look: [60, 0, -60], fov: 45, hour: 16.8, weather: 'clear' },
  topdown: { pos: [0, 90, 90], look: [0, 0, -30], fov: 50, hour: 11, weather: 'clear' },

  // Weather/time-of-day range. Same poses, different world state — these prove
  // the zone spans both reference art directions rather than baking one look.
  dawn:    { pos: [-40, 26, 120], look: [10, 4, -320], fov: 42, hour: 6.4, weather: 'hazy' },
  overcast:{ pos: [-90, 12, 60], look: [60, 0, -60], fov: 45, hour: 12.0, weather: 'overcast' },
  storm:   { pos: [12, 1.7, 34], look: [40, 3.0, -140], fov: 55, hour: 13.0, weather: 'storm', ground: true },
  night:   { pos: [-40, 26, 120], look: [10, 4, -320], fov: 42, hour: 22.0, weather: 'clear' },

  // Character poses. The character spawns at SPAWN in src/entities/character.js.
  hero:    { pos: [14.6, 1.55, 29.2], look: [12, 1.05, 26], fov: 38, hour: 16.2, weather: 'clear' },
  portrait:{ pos: [12.9, 1.62, 27.4], look: [12, 1.42, 26], fov: 30, hour: 10.0, weather: 'clear' },
};

export class Engine {
  constructor() {
    const renderer = new THREE.WebGLRenderer({
      antialias: false,           // post chain owns AA
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.25, 8000);
    this.clock = 0;
    /**
     * Camera authority. Exactly one system drives the camera at a time.
     *   'shot' — a named capture pose owns it (the default; what the harness uses)
     *   'free' — the debug fly camera (devcam)
     *   'play' — the player controller / third-person rig
     * Capture runs never send input, so they stay in 'shot' and are unperturbable.
     */
    this.mode = 'shot';
    this.hour = 9.5;
    this.weatherName = 'clear';
    this.weather = { ...WEATHER.clear };
    this.sunDir = new THREE.Vector3();
    this.modules = [];
    this.composer = null;      // post module may set this
    this.terrain = null;       // terrain module sets this (needs heightAt)

    this._times = [];
    this._last = performance.now();
    this._frames = 0;
    this._hud = document.getElementById('hud');

    addEventListener('resize', () => this._resize());
    sunDirection(this.hour, this.sunDir);
  }

  registerModule(m) {
    this.modules.push(m);
    if (m.object3D) this.scene.add(m.object3D);
    if (m.name === 'terrain') this.terrain = m;
    return m;
  }

  get ctx() {
    return {
      engine: this, scene: this.scene, camera: this.camera, renderer: this.renderer,
      sunDir: this.sunDir, hour: this.hour, time: this.clock, terrain: this.terrain,
      weather: this.weather, weatherName: this.weatherName,
    };
  }

  setTime(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    sunDirection(this.hour, this.sunDir);
    for (const m of this.modules) m.onSun?.(this.ctx);
  }

  /**
   * Set weather. Accepts a preset name, or an object of dial overrides merged
   * onto the current preset. Modules respond via onWeather(ctx); anything that
   * also depends on sun angle should re-run its onSun path too.
   */
  setWeather(w) {
    if (typeof w === 'string') {
      this.weatherName = w;
      this.weather = { ...(WEATHER[w] ?? WEATHER.clear) };
    } else {
      this.weatherName = 'custom';
      Object.assign(this.weather, w);
    }
    const ctx = this.ctx;
    for (const m of this.modules) m.onWeather?.(ctx);
    for (const m of this.modules) m.onSun?.(ctx);
  }

  setMode(m) {
    this.mode = m;
    for (const mod of this.modules) mod.onMode?.(m, this.ctx);
  }

  setShot(name) {
    this.mode = 'shot';           // a named pose always reclaims the camera
    const s = SHOTS[name] ?? SHOTS.vista;
    this.camera.fov = s.fov;
    let [x, y, z] = s.pos;
    // `ground: true` means y is height ABOVE terrain, not world height.
    if (s.ground && this.terrain?.heightAt) y += this.terrain.heightAt(x, z);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(...s.look);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    if (s.weather !== undefined) this.setWeather(s.weather);
    if (s.hour !== undefined) this.setTime(s.hour);
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    for (const m of this.modules) m.onResize?.(w, h);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(now - this._last, 100);
      this._last = now;
      this._times.push(dt);
      if (this._times.length > 60) this._times.shift();
      if (!this._pinned) this.clock += dt / 1000;

      const ctx = this.ctx;
      for (const m of this.modules) m.update?.(ctx);
      this.render();

      this._frames++;
      if (this._frames === 3) window.MACRION.ready = true;
      if (this._frames % 15 === 0) this._drawHud();
    };
    requestAnimationFrame(loop);
  }

  _drawHud() {
    const h = this._hud;
    if (!h || h.classList.contains('hidden')) return;
    const s = this.stats();
    h.textContent =
      `${s.fps.toFixed(0)} fps   ${s.ms.toFixed(2)} ms\n` +
      `${s.drawCalls} calls   ${(s.triangles / 1000).toFixed(0)}k tris\n` +
      `${this.hour.toFixed(1)}h`;
  }

  stats() {
    const t = this._times;
    const ms = t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const info = this.renderer.info;
    return {
      fps: ms > 0 ? 1000 / ms : 0,
      ms,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    };
  }

  /** Install window.MACRION. Called once from main.js after modules register. */
  installContract(version) {
    const engine = this;
    window.MACRION = {
      ready: false,
      version,
      SHOTS: Object.keys(SHOTS),
      WEATHERS: Object.keys(WEATHER),
      setShot: (n) => engine.setShot(n),
      setTime: (h) => engine.setTime(h),
      setWeather: (w) => engine.setWeather(w),
      setMode: (m) => engine.setMode(m),
      get mode() { return engine.mode; },
      setClock: (t) => { engine.clock = t; engine._pinned = true; },
      settle(n = 60) {
        return new Promise((res) => {
          let i = 0;
          const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        });
      },
      stats: () => engine.stats(),
      hud: (v) => engine._hud?.classList.toggle('hidden', !v),
      engine,
    };
    return window.MACRION;
  }
}
