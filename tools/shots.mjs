/**
 * Macrion capture harness.
 *
 * Boots a vite dev server, drives window.MACRION through the named shots in
 * docs/CAPTURE_CONTRACT.md, and writes deterministic PNGs + stats.json.
 *
 *   node tools/shots.mjs                       # all shots
 *   node tools/shots.mjs --shot eye            # one shot
 *   node tools/shots.mjs --time 7.5 --tag r2   # override time, label the run
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 5188;
let URL;

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i === -1 ? d : argv[i + 1];
};
const only = arg('shot', null);
const timeOverride = arg('time', null);
const tag = arg('tag', 'run');
PORT = Number(arg('port', 5188));
URL = `http://localhost:${PORT}/`;
const width = Number(arg('w', 1920));
const height = Number(arg('h', 1080));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(ROOT, 'captures', `${stamp}_${tag}`);
mkdirSync(outDir, { recursive: true });

/** Free the port if a previous run leaked a vite process. */
function reclaimPort() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
      const pids = new Set(
        out.split('\n')
          .filter((l) => /LISTENING/.test(l))
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && p !== '0')
      );
      for (const pid of pids) {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        console.log(`[shots] reclaimed port ${PORT} from pid ${pid}`);
      }
    } else {
      execSync(`lsof -ti tcp:${PORT} | xargs -r kill -9`, { stdio: 'ignore' });
    }
  } catch { /* nothing listening */ }
}

function startServer() {
  reclaimPort();
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Pass the port via env, not --port: vite's injected HMR client uses the
  // CONFIG port, so a CLI override leaves the client dialing the wrong port and
  // every capture picks up 3 phantom console errors from the failed handshake.
  const p = spawn(bin, ['vite'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, MACRION_PORT: String(PORT) },
  });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('vite did not start in 40s')), 40000);
    p.stdout.on('data', (d) => {
      if (/Local:|ready in/i.test(String(d))) { clearTimeout(to); res(p); }
    });
    p.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    p.on('exit', (c) => { clearTimeout(to); rej(new Error(`vite exited ${c}`)); });
  });
}

const server = await startServer();

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });

try {
  await page.waitForFunction(() => window.MACRION && window.MACRION.ready === true, { timeout: 60000 });
} catch {
  writeFileSync(resolve(outDir, 'FAILED.txt'),
    `window.MACRION.ready never became true.\n\nConsole:\n${consoleErrors.join('\n')}\n`);
  await page.screenshot({ path: resolve(outDir, 'FAILED.png') });
  console.error('CAPTURE FAILED — MACRION.ready never true. See', outDir);
  console.error(consoleErrors.slice(0, 20).join('\n'));
  await browser.close(); server.kill();
  process.exit(1);
}

await page.evaluate(() => window.MACRION.hud(false));

const shots = only ? [only] : await page.evaluate(() => window.MACRION.SHOTS);
const version = await page.evaluate(() => window.MACRION.version ?? 'unknown');
const results = [];

for (const shot of shots) {
  await page.evaluate(async ([s, t]) => {
    window.MACRION.setShot(s);
    if (t !== null) window.MACRION.setTime(Number(t));
    // Pin the animation clock BEFORE settling. Anything driven by engine.clock
    // (wind, cloud drift) must land on the same phase every run, or captures
    // are not comparable between iterations. See CAPTURE_CONTRACT determinism rule.
    window.MACRION.setClock?.(120.0);
    await window.MACRION.settle(120);
  }, [shot, timeOverride]);

  // let the rolling FPS window fill after settling
  await page.waitForTimeout(1500);

  // Re-assert HUD suppression immediately before the shutter. A concurrent
  // builder saving a file triggers Vite HMR, which can re-create HUD/dev DOM
  // after our one-time hud(false) — that leaked overlay pixels into captures
  // and broke bit-identical determinism. Cheap to repeat, so repeat it.
  await page.evaluate(() => window.MACRION.hud(false));

  const stats = await page.evaluate(() => window.MACRION.stats());
  await page.screenshot({ path: resolve(outDir, `${shot}.png`) });
  results.push({ shot, ...stats });
  console.log(
    `${shot.padEnd(10)} ${String(stats.drawCalls).padStart(4)} calls  ` +
    `${(stats.triangles / 1000).toFixed(0).padStart(5)}k tris  ` +
    `${stats.fps.toFixed(0).padStart(3)} fps`
  );
}

const renderer = results[0]?.renderer ?? 'unknown';
const software = /swiftshader|llvmpipe|software/i.test(renderer);

writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify({
  version, capturedAt: new Date().toISOString(), viewport: { width, height },
  renderer,
  fpsTrustworthy: !software,
  fpsNote: software
    ? 'Software rasterizer (SwiftShader). FPS/ms are NOT representative — verify perf in real Chrome.'
    : 'Hardware GPU path.',
  consoleErrors,
  shots: results,
}, null, 2));

console.log(`\nrenderer: ${renderer}`);
if (software) console.log('WARNING: software raster — FPS numbers are not meaningful.');
if (consoleErrors.length) console.log(`console errors: ${consoleErrors.length}`);
console.log(`\ncaptures → ${outDir}`);

await browser.close();

// Windows: vite is under a cmd.exe wrapper, so kill the tree, then hard-exit.
if (process.platform === 'win32' && server.pid) {
  try {
    execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
  } catch { /* already gone */ }
} else {
  server.kill();
}
process.exit(consoleErrors.length ? 2 : 0);
