/**
 * Macrion agent heartbeat monitor.
 *
 * Reads heartbeats/*.md and reports which agents are alive, stale, blocked or done.
 * See docs/HEARTBEAT.md for the protocol.
 *
 *   node tools/heartbeat.mjs              # default 5-minute staleness threshold
 *   node tools/heartbeat.mjs --stale 8    # custom threshold, minutes
 *   node tools/heartbeat.mjs --show oz    # dump one agent's full heartbeat
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'heartbeats');
mkdirSync(DIR, { recursive: true });

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i === -1 ? d : argv[i + 1];
};
const staleMin = Number(arg('stale', 5));
const show = arg('show', null);

if (!existsSync(DIR)) {
  console.log('no heartbeats/ directory yet');
  process.exit(0);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
if (!files.length) {
  console.log('no heartbeats yet — no agents have reported in');
  process.exit(0);
}

const now = Date.now();
const rows = [];

for (const f of files) {
  const name = f.replace(/\.md$/, '');
  const body = readFileSync(join(DIR, f), 'utf8');

  if (show && name.includes(show)) {
    console.log(`\n${'='.repeat(60)}\n${body}\n${'='.repeat(60)}`);
    continue;
  }

  const updated = /^updated:\s*(.+)$/m.exec(body)?.[1]?.trim();
  const status = /^status:\s*(\w+)/m.exec(body)?.[1]?.trim() ?? 'unknown';
  const task = /^task:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';

  const t = updated ? Date.parse(updated) : NaN;
  const ageMin = Number.isFinite(t) ? (now - t) / 60000 : Infinity;

  let state;
  if (status === 'done') state = 'DONE';
  else if (status === 'blocked') state = 'BLOCKED';
  else if (!Number.isFinite(ageMin)) state = 'NO-TIMESTAMP';
  else if (ageMin > staleMin) state = 'STALE';
  else state = 'OK';

  rows.push({ name, state, ageMin, task, inProgress: /## In progress\s*\n([\s\S]*?)(?=\n##|$)/.exec(body)?.[1]?.trim().split('\n')[0] ?? '' });
}

if (show) process.exit(0);

const pad = (s, n) => String(s).padEnd(n);
const age = (m) => {
  if (!Number.isFinite(m)) return '—';
  if (m > 999) return '>999m';
  return `${m.toFixed(1)}m`;
};

console.log(`\nheartbeats  (stale threshold ${staleMin}m)\n`);
console.log(`${pad('AGENT', 22)}${pad('STATE', 9)}${pad('AGE', 8)}TASK`);
console.log('-'.repeat(90));
for (const r of rows.sort((a, b) => b.ageMin - a.ageMin)) {
  console.log(`${pad(r.name, 22)}${pad(r.state, 9)}${pad(age(r.ageMin), 8)}${r.task.slice(0, 48)}`);
  if (r.state === 'STALE' || r.state === 'BLOCKED') {
    console.log(`${' '.repeat(22)}last: ${r.inProgress.slice(0, 60)}`);
  }
}

const stale = rows.filter((r) => r.state === 'STALE');
const blocked = rows.filter((r) => r.state === 'BLOCKED');
console.log('');
if (stale.length) {
  console.log(`${stale.length} PRESUMED DEAD — read heartbeats/<name>.md, commit their work, respawn with the heartbeat in the brief:`);
  for (const r of stale) console.log(`  heartbeats/${r.name}.md`);
}
if (blocked.length) {
  console.log(`${blocked.length} BLOCKED — needs lead intervention:`);
  for (const r of blocked) console.log(`  heartbeats/${r.name}.md`);
}
if (!stale.length && !blocked.length) console.log('all agents healthy');

process.exit(stale.length ? 1 : 0);
