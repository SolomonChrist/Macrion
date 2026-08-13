/**
 * Macrion dev camera + live controls. LEAD-OWNED.
 *
 * Inert until the user actually provides input, so it can never perturb a
 * capture run (the harness sends no input). Registered as a normal module.
 */
import * as THREE from 'three';
import { SHOTS, WEATHER } from './engine.js';

const SHOT_KEYS = Object.keys(SHOTS);
const WEATHER_KEYS = Object.keys(WEATHER);

export function createDevCam(ctx) {
  const { engine, camera } = ctx;
  const dom = engine.renderer.domElement;

  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let free = false;
  let locked = false;
  let last = performance.now();
  let weatherIdx = 0;
  let shotIdx = 0;
  let speed = 18;
  let toast = '';
  let toastUntil = 0;

  const panel = document.createElement('div');
  panel.id = 'devpanel';
  panel.innerHTML = `
    <div class="dp-title">MACRION</div>
    <div class="dp-rows">
      <div><b>click</b> capture mouse · <b>esc</b> release</div>
      <div><b>W A S D</b> move · <b>Q E</b> down / up · <b>shift</b> sprint</div>
      <div><b>wheel</b> speed · <b>F</b> free camera on / off</div>
      <div><b>1-9</b> jump to capture pose</div>
      <div><b>, .</b> time of day · <b>T</b> cycle weather</div>
      <div><b>H</b> hide this panel</div>
    </div>`;
  document.body.appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    #devpanel{position:fixed;right:12px;bottom:12px;z-index:20;padding:11px 14px;
      background:rgba(8,12,18,.72);border:1px solid rgba(150,180,215,.22);border-radius:5px;
      color:#c8d8ea;font:11.5px/1.75 ui-monospace,Consolas,monospace;
      text-shadow:0 1px 2px rgba(0,0,0,.8);pointer-events:none;backdrop-filter:blur(3px)}
    #devpanel.hidden{display:none}
    .dp-title{font-size:10px;letter-spacing:.22em;color:#e8a33d;margin-bottom:6px}
    #devpanel b{color:#fff;font-weight:600}
    #toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:21;
      padding:7px 16px;background:rgba(8,12,18,.8);border:1px solid rgba(150,180,215,.22);
      border-radius:4px;color:#e8a33d;font:12px/1 ui-monospace,Consolas,monospace;
      letter-spacing:.06em;opacity:0;transition:opacity .18s;pointer-events:none}
    #toast.on{opacity:1}`;
  document.head.appendChild(style);

  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  document.body.appendChild(toastEl);

  function say(msg) {
    toast = msg;
    toastUntil = performance.now() + 1400;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
  }

  function enterFree() {
    if (free) return;
    free = true;
    engine.setMode('free');
    euler.setFromQuaternion(camera.quaternion);
    say('free camera');
  }

  dom.addEventListener('click', () => dom.requestPointerLock?.());
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === dom; });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    enterFree();
    euler.y -= e.movementX * 0.0022;
    euler.x -= e.movementY * 0.0022;
    euler.x = Math.max(-1.5, Math.min(1.5, euler.x));
    camera.quaternion.setFromEuler(euler);
  });

  dom.addEventListener('wheel', (e) => {
    speed = Math.max(2, Math.min(400, speed * (e.deltaY < 0 ? 1.18 : 0.85)));
    say(`speed ${speed.toFixed(0)} m/s`);
    e.preventDefault();
  }, { passive: false });

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);

    if (k >= '1' && k <= '9') {
      const name = SHOT_KEYS[Number(k) - 1];
      if (name) { free = false; shotIdx = Number(k) - 1; engine.setShot(name); say(`shot · ${name}`); }
    }
    if (k === 'f') { free ? (free = false, engine.setShot(SHOT_KEYS[shotIdx]), say('locked to pose')) : enterFree(); }
    if (k === 't') {
      weatherIdx = (weatherIdx + 1) % WEATHER_KEYS.length;
      engine.setWeather(WEATHER_KEYS[weatherIdx]);
      say(`weather · ${WEATHER_KEYS[weatherIdx]}`);
    }
    if (k === ',' || k === '.') {
      engine.setTime(engine.hour + (k === '.' ? 0.5 : -0.5));
      say(`${engine.hour.toFixed(1)}:00`);
    }
    if (k === 'h') panel.classList.toggle('hidden');
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  return {
    name: 'devcam',
    update() {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (toast && now > toastUntil) { toastEl.classList.remove('on'); toast = ''; }
      if (!free || engine.mode !== 'free') return;

      const s = speed * (keys.has('shift') ? 4 : 1) * dt;
      camera.getWorldDirection(fwd);
      right.crossVectors(fwd, up).normalize();

      if (keys.has('w')) camera.position.addScaledVector(fwd, s);
      if (keys.has('s')) camera.position.addScaledVector(fwd, -s);
      if (keys.has('d')) camera.position.addScaledVector(right, s);
      if (keys.has('a')) camera.position.addScaledVector(right, -s);
      if (keys.has('e')) camera.position.addScaledVector(up, s);
      if (keys.has('q')) camera.position.addScaledVector(up, -s);

      // Stay above the ground so you can't fly through the heightfield.
      const h = engine.terrain?.heightAt?.(camera.position.x, camera.position.z);
      if (h !== undefined && camera.position.y < h + 1.2) camera.position.y = h + 1.2;

      camera.updateMatrixWorld(true);
    },
    /** Capture harness hides the HUD; hide our chrome too. */
    setChrome(v) { panel.classList.toggle('hidden', !v); toastEl.classList.remove('on'); },
  };
}
