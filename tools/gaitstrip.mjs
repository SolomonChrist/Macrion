/**
 * Locomotion frame-strip capture.
 *
 * Movement cannot be judged from a single frame. This drives the character into
 * play mode, holds W, and captures an evenly-spaced sequence across roughly one
 * full gait cycle from a SIDE-ON camera — the view animators use to judge a
 * walk, because it shows contact poses, stride length, hip drop and arm swing.
 *
 *   node tools/gaitstrip.mjs                 # run cycle, 14 frames
 *   node tools/gaitstrip.mjs --pose walk
 *   node tools/gaitstrip.mjs --frames 20 --ik 1
 *
 * Output: captures/<stamp>_gait-<pose>/f00..fNN.png + meta.json
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };

const PORT = Number(arg('port', 5220));
const POSE = arg('pose', 'run');
const FRAMES = Number(arg('frames', 14));
const IK = Number(arg('ik', 0));
const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(ROOT, 'captures', `${stamp}_gait-${POSE}`);
mkdirSync(outDir, { recursive: true });

function reclaim() {
  try {
    const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
    for (const pid of new Set(out.split('\n').filter((l) => /LISTENING/.test(l))
      .map((l) => l.trim().split(/\s+/).pop()).filter((x) => x && x !== '0'))) {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    }
  } catch { /* free */ }
}

reclaim();
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
  env: { ...process.env, MACRION_PORT: String(PORT) },
});
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('vite timeout')), 40000);
  server.stdout.on('data', (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(to); res(); } });
});

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.MACRION?.ready === true, { timeout: 60000 });
await page.evaluate(() => window.MACRION.hud(false));

// Enter play, hold forward, let the controller reach steady-state speed.
await page.evaluate((ik) => {
  const c = MACRION.engine.systems.character;
  c.setIK?.(ik);
}, IK);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })));
await page.evaluate((p) => {
  if (p === 'run') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'shift' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
}, POSE);
await page.waitForTimeout(1600);

/**
 * Park a camera side-on to the character and re-aim it every frame, so the
 * subject stays framed while it runs past. The controller owns the camera in
 * play mode, so we override AFTER its update by re-rendering ourselves.
 */
const meta = await page.evaluate(() => {
  const e = MACRION.engine, c = e.systems.character;
  const n = c.root ?? c.object3D;
  e.__gait = { active: true, node: n };
  // Wrap render so we get the last word on camera placement each frame.
  if (!e.__gaitPatched) {
    e.__gaitPatched = true;
    const orig = e.render.bind(e);
    e.render = function () {
      const g = e.__gait;
      if (g?.active) {
        const p = g.node.getWorldPosition(new (e.camera.position.constructor)());
        e.camera.position.set(p.x + 4.2, p.y + 1.25, p.z + 0.6);
        e.camera.lookAt(p.x, p.y + 0.95, p.z);
        e.camera.fov = 38;
        e.camera.updateProjectionMatrix();
        e.camera.updateMatrixWorld(true);
      }
      orig();
    };
  }
  return { pose: c.getPose?.(), mode: e.mode };
});

// One gait cycle: cadence = speed / stride. Sample a bit over a full cycle.
const cycle = await page.evaluate(() => {
  const c = MACRION.engine.systems.character;
  const sp = c.getSpeed?.() ?? 5;
  const stride = c.getPose?.() === 'run' ? 1.4 + 0.35 * sp : 0.85 + 0.28 * sp;
  return Math.max(0.35, Math.min(2.5, stride / Math.max(sp, 0.1)));
});
const stepMs = Math.round((cycle * 1000) / FRAMES);

const shots = [];
for (let i = 0; i < FRAMES; i++) {
  const f = String(i).padStart(2, '0');
  // Re-assert the held keys EVERY frame. Taking a screenshot blurs the page,
  // and the controller clears held keys on blur — without this the character
  // stops moving after the first capture and the whole strip reads as a freeze,
  // which is a tooling artifact, not a game bug.
  await page.evaluate((p) => {
    if (p === 'run') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'shift' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
  }, POSE);
  await page.screenshot({ path: resolve(outDir, `f${f}.png`) });
  const s = await page.evaluate(() => {
    const c = MACRION.engine.systems.character;
    const g = (n) => { const b = c.bones?.get?.(n); return b ? +b.rotation.x.toFixed(3) : null; };
    const n = c.root ?? c.object3D;
    return { thighL: g('thighL'), thighR: g('thighR'), shinL: g('shinL'),
      footL: g('footL'), x: +n.position.x.toFixed(2), z: +n.position.z.toFixed(2) };
  });
  shots.push({ frame: f, ...s });
  await page.waitForTimeout(stepMs);
}

writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify({
  pose: POSE, ik: IK, frames: FRAMES, cycleSeconds: cycle, stepMs,
  viewport: { width: W, height: H }, camera: 'side-on, 38deg fov, tracking',
  mode: meta.mode, reportedPose: meta.pose, consoleErrors: errors, shots,
}, null, 2));

console.log(`pose=${POSE} ik=${IK} cycle=${cycle.toFixed(2)}s step=${stepMs}ms frames=${FRAMES}`);
console.log(`console errors: ${errors.length}`);
console.log(`\nstrip -> ${outDir}`);

await browser.close();
try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ }
process.exit(0);
