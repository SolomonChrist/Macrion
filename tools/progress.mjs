/**
 * Macrion progress page generator.
 *
 * Reads gauntlet.json (hand-maintained round state) + the referenced capture
 * directories, downscales the shot PNGs to embedded JPEGs, and emits
 * progress.html — a self-contained page suitable for publishing as an Artifact.
 *
 *   node tools/progress.mjs
 *
 * Reference frames in visuals/ are deliberately NOT embedded: they are
 * copyrighted third-party screenshots used locally for grading only.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = JSON.parse(readFileSync(resolve(ROOT, 'gauntlet.json'), 'utf8'));

/* ---------- image encoding via headless canvas ---------- */
const browser = await chromium.launch();
const page = await browser.newPage();

async function toJpegDataURI(absPath, maxW = 900, quality = 0.74) {
  // Feed the PNG in as a data: URI — an about:blank page cannot fetch file:// URLs.
  const url = `data:image/png;base64,${readFileSync(absPath).toString('base64')}`;
  return page.evaluate(async ([u, mw, q]) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const scale = Math.min(1, mw / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }, [url, maxW, quality]);
}

/* ---------- gather capture data ---------- */
for (const sys of state.systems) {
  sys.shots = [];
  if (!sys.captureDir) continue;
  const dir = resolve(ROOT, sys.captureDir);
  if (!existsSync(dir)) { sys.captureMissing = true; continue; }

  let stats = { shots: [] };
  const sp = join(dir, 'stats.json');
  if (existsSync(sp)) stats = JSON.parse(readFileSync(sp, 'utf8'));
  sys.stats = stats;

  for (const f of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
    const name = f.replace(/\.png$/, '');
    const s = stats.shots?.find((x) => x.shot === name);
    sys.shots.push({ name, uri: await toJpegDataURI(join(dir, f)), stats: s });
  }
}
await browser.close();

/* ---------- render ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const STATUS = {
  building: ['Building', 'st-run'],
  critiquing: ['Under critique', 'st-run'],
  refining: ['Refining', 'st-run'],
  passed: ['Passed bar', 'st-pass'],
  blocked: ['Blocked', 'st-fail'],
  queued: ['Queued', 'st-idle'],
};

const shotCard = (sh) => `
  <figure class="shot">
    <img src="${sh.uri}" alt="${esc(sh.name)} shot" loading="lazy" />
    <figcaption>
      <span class="shot-name">${esc(sh.name)}</span>
      ${sh.stats ? `<span class="shot-nums">${sh.stats.fps.toFixed(0)} fps · ${sh.stats.drawCalls} calls · ${(sh.stats.triangles / 1000).toFixed(0)}k tris</span>` : ''}
    </figcaption>
  </figure>`;

const scoreBar = (sc) => {
  if (sc == null) return '<span class="score-none">not yet scored</span>';
  const cls = sc >= 78 ? 'sc-pass' : sc >= 60 ? 'sc-mid' : 'sc-low';
  return `<div class="score"><div class="score-val ${cls}">${sc}<span class="score-max">/100</span></div>
    <div class="score-track"><i class="${cls}" style="width:${Math.max(2, Math.min(100, sc))}%"></i>
    <b style="left:78%"></b></div></div>`;
};

const rubricRows = (r) => (r?.length) ? `
  <table class="rubric">
    <thead><tr><th>Rubric section</th><th>Score</th><th>Read</th></tr></thead>
    <tbody>${r.map((x) => `<tr>
      <td><code>${esc(x.id)}</code> ${esc(x.name)}</td>
      <td class="num ${x.score >= 3 ? 'sc-pass' : x.score >= 2 ? 'sc-mid' : 'sc-low'}">${x.score.toFixed(1)}</td>
      <td>${esc(x.note)}</td></tr>`).join('')}</tbody>
  </table>` : '';

const systemSection = (sys) => {
  const [label, cls] = STATUS[sys.status] ?? STATUS.queued;
  return `
  <section class="sys" id="${esc(sys.id)}">
    <header class="sys-head">
      <div class="sys-id">
        <h2>${esc(sys.name)}</h2>
        <p class="sys-brief">${esc(sys.brief)}</p>
      </div>
      <div class="sys-meta">
        <span class="pill ${cls}">${label}</span>
        <span class="iter">iteration <b>${sys.iteration}</b></span>
      </div>
    </header>

    ${scoreBar(sys.score)}

    ${sys.shots?.length ? `<div class="shots">${sys.shots.map(shotCard).join('')}</div>`
      : `<div class="empty">${sys.captureMissing ? 'capture directory missing' : 'no captures yet'}</div>`}

    ${rubricRows(sys.rubric)}

    <div class="notes">
      ${sys.gap ? `<div class="note note-gap"><h3>Critic — biggest gap</h3><p>${esc(sys.gap)}</p></div>` : ''}
      ${sys.next ? `<div class="note note-next"><h3>Next action</h3><p>${esc(sys.next)}</p>${sys.eta ? `<p class="eta">ETA ${esc(sys.eta)}</p>` : ''}</div>` : ''}
    </div>
  </section>`;
};

const html = `<title>Macrion Gauntlet</title>
<style>
  :root{
    --ground:#f2f4f7; --surface:#ffffff; --surface-2:#e9edf2; --line:#d3dae3;
    --text:#141c26; --dim:#5d6b7d; --faint:#8a97a7;
    --accent:#b8791c; --cool:#3a7fa8;
    --pass:#2f7f63; --mid:#a8761f; --low:#b0463c;
    --shadow:0 1px 2px rgba(20,28,38,.08), 0 8px 24px -12px rgba(20,28,38,.22);
  }
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
    --ground:#0e1319; --surface:#161d26; --surface-2:#1c2530; --line:#2b3644;
    --text:#dbe4ee; --dim:#93a2b4; --faint:#6b7a8c;
    --accent:#e8a33d; --cool:#5aa9d6;
    --pass:#4fa98a; --mid:#d3a04a; --low:#cd6157;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -14px rgba(0,0,0,.7);
  }}
  :root[data-theme="dark"]{
    --ground:#0e1319; --surface:#161d26; --surface-2:#1c2530; --line:#2b3644;
    --text:#dbe4ee; --dim:#93a2b4; --faint:#6b7a8c;
    --accent:#e8a33d; --cool:#5aa9d6;
    --pass:#4fa98a; --mid:#d3a04a; --low:#cd6157;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -14px rgba(0,0,0,.7);
  }

  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ground); color:var(--text);
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  .wrap{max-width:1180px;margin:0 auto;padding:0 24px 96px}

  /* ---- masthead ---- */
  header.top{border-bottom:1px solid var(--line);margin-bottom:40px}
  .top-in{max-width:1180px;margin:0 auto;padding:44px 24px 30px;
    display:flex;justify-content:space-between;align-items:flex-end;gap:32px;flex-wrap:wrap}
  h1{
    font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    font-size:clamp(30px,4.6vw,46px); font-weight:600; letter-spacing:-.035em;
    margin:0 0 10px; text-wrap:balance;
  }
  h1 em{font-style:normal;color:var(--accent)}
  .tagline{margin:0;color:var(--dim);max-width:56ch}
  .runmeta{
    font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    font-size:12px;color:var(--faint);text-align:right;line-height:1.9;
    font-variant-numeric:tabular-nums;white-space:nowrap;
  }
  .runmeta b{color:var(--text);font-weight:600}

  /* ---- launch ---- */
  .launch{
    display:block;text-decoration:none;margin-bottom:10px;padding:20px 24px;
    border-radius:8px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));
    background:linear-gradient(135deg,
      color-mix(in srgb,var(--accent) 12%,var(--surface)),
      var(--surface) 65%);
    box-shadow:var(--shadow);transition:border-color .15s,transform .15s;
  }
  .launch:hover,.launch:focus-visible{
    border-color:var(--accent);transform:translateY(-1px);
  }
  .launch:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  .launch-go{
    display:block;font-family:ui-monospace,Consolas,monospace;font-size:19px;
    font-weight:650;color:var(--accent);letter-spacing:-.01em;margin-bottom:5px;
  }
  .launch-go::after{content:" ↗";font-size:15px}
  .launch-sub{display:block;color:var(--text);font-size:14px;margin-bottom:9px}
  .launch-sub code,.launch-note code{
    font-family:ui-monospace,Consolas,monospace;font-size:12.5px;
    background:var(--surface-2);padding:1px 5px;border-radius:3px;color:var(--cool)}
  .launch-keys{
    display:block;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;
    color:var(--faint);line-height:1.9}
  .launch-keys b{color:var(--text);font-weight:600}
  .launch-note{margin:0 0 40px;font-size:12.5px;color:var(--faint)}

  /* ---- gpu strip ---- */
  .strip{
    display:flex;gap:0;flex-wrap:wrap;border:1px solid var(--line);border-radius:6px;
    background:var(--surface);overflow:hidden;margin-bottom:44px;box-shadow:var(--shadow);
  }
  .strip div{flex:1 1 170px;padding:14px 18px;border-right:1px solid var(--line)}
  .strip div:last-child{border-right:0}
  .strip dt{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
  .strip dd{margin:0;font-family:ui-monospace,Consolas,monospace;font-size:13.5px;font-variant-numeric:tabular-nums}

  /* ---- system block ---- */
  .sys{
    background:var(--surface);border:1px solid var(--line);border-radius:8px;
    padding:26px 26px 22px;margin-bottom:26px;box-shadow:var(--shadow);
  }
  .sys-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;flex-wrap:wrap}
  .sys h2{margin:0 0 5px;font-size:20px;font-weight:650;letter-spacing:-.015em}
  .sys-brief{margin:0;color:var(--dim);font-size:14px;max-width:62ch}
  .sys-meta{display:flex;flex-direction:column;align-items:flex-end;gap:7px;white-space:nowrap}
  .pill{
    font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.05em;
    text-transform:uppercase;padding:4px 10px;border-radius:3px;border:1px solid;
  }
  .st-run{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);
    background:color-mix(in srgb,var(--accent) 10%,transparent)}
  .st-pass{color:var(--pass);border-color:color-mix(in srgb,var(--pass) 40%,transparent);
    background:color-mix(in srgb,var(--pass) 10%,transparent)}
  .st-fail{color:var(--low);border-color:color-mix(in srgb,var(--low) 40%,transparent);
    background:color-mix(in srgb,var(--low) 10%,transparent)}
  .st-idle{color:var(--faint);border-color:var(--line)}
  .iter{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--faint)}
  .iter b{color:var(--text)}

  /* ---- score ---- */
  .score{display:flex;align-items:center;gap:16px;margin:20px 0 4px}
  .score-val{font-family:ui-monospace,Consolas,monospace;font-size:26px;font-weight:600;
    font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .score-max{font-size:13px;color:var(--faint);font-weight:400}
  .score-track{position:relative;flex:1;height:6px;background:var(--surface-2);border-radius:3px;overflow:visible}
  .score-track i{position:absolute;inset:0 auto 0 0;border-radius:3px;display:block}
  .score-track b{position:absolute;top:-5px;bottom:-5px;width:2px;background:var(--dim);opacity:.65}
  .sc-pass{color:var(--pass)} i.sc-pass{background:var(--pass)}
  .sc-mid{color:var(--mid)}  i.sc-mid{background:var(--mid)}
  .sc-low{color:var(--low)}  i.sc-low{background:var(--low)}
  .score-none{color:var(--faint);font-size:13px;font-style:italic;display:block;margin:18px 0 2px}

  /* ---- shots ---- */
  .shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:22px 0}
  .shot{margin:0;background:var(--surface-2);border:1px solid var(--line);border-radius:5px;overflow:hidden}
  .shot img{display:block;width:100%;height:auto}
  .shot figcaption{padding:8px 11px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .shot-name{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--accent)}
  .shot-nums{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--faint);
    font-variant-numeric:tabular-nums}
  .empty{padding:30px;text-align:center;color:var(--faint);font-size:13px;
    border:1px dashed var(--line);border-radius:5px;margin:22px 0}

  /* ---- rubric ---- */
  .rubric{width:100%;border-collapse:collapse;margin:18px 0 4px;font-size:13.5px}
  .rubric th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;
    color:var(--faint);font-weight:600;padding:0 12px 7px 0;border-bottom:1px solid var(--line)}
  .rubric td{padding:8px 12px 8px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
  .rubric td:first-child{color:var(--text);white-space:nowrap}
  .rubric code{font-size:12px;color:var(--cool)}
  .rubric .num{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;
    text-align:right;width:52px;font-weight:600}

  /* ---- notes ---- */
  .notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:20px}
  .note{padding:14px 16px;border-radius:5px;background:var(--surface-2);border-left:2px solid var(--line)}
  .note-gap{border-left-color:var(--low)}
  .note-next{border-left-color:var(--cool)}
  .note h3{margin:0 0 6px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;
    color:var(--faint);font-weight:600}
  .note p{margin:0;font-size:13.5px;color:var(--text)}
  .note .eta{margin-top:6px;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--faint)}

  footer{margin-top:44px;padding-top:22px;border-top:1px solid var(--line);
    color:var(--faint);font-size:12.5px;max-width:74ch}
  footer a{color:var(--cool)}
  @media (prefers-reduced-motion:no-preference){.sys{transition:none}}
</style>

<header class="top">
  <div class="top-in">
    <div>
      <h1>Macrion <em>Gauntlet</em></h1>
      <p class="tagline">${esc(state.tagline)}</p>
    </div>
    <div class="runmeta">
      round <b>${state.round}</b><br />
      ${esc(state.updated)}<br />
      ${esc(state.gpu ?? '')}
    </div>
  </div>
</header>

<div class="wrap">
  <a class="launch" href="http://localhost:5188/" target="_blank" rel="noopener">
    <span class="launch-go">Launch playable build</span>
    <span class="launch-sub">Opens the live engine at <code>localhost:5188</code> — fly the current state yourself</span>
    <span class="launch-keys">click to capture mouse · <b>WASD</b> move · <b>1-9</b> capture poses · <b>,</b> <b>.</b> time · <b>T</b> weather · <b>F</b> free cam</span>
  </a>
  <p class="launch-note">If that link doesn't load, the dev server isn't running — start it with
    <code>npm run dev</code> in the project root.</p>

  <dl class="strip">
    ${(state.strip ?? []).map((s) => `<div><dt>${esc(s.k)}</dt><dd>${esc(s.v)}</dd></div>`).join('')}
  </dl>

  ${state.systems.map(systemSection).join('')}

  <footer>
    <p>Every mesh, texture, and shader in Macrion is generated procedurally in Three.js —
    no asset packs, no downloaded textures. Frame captures are produced by
    <code class="mono">tools/shots.mjs</code> driving headless Chromium on the GPU, at fixed
    camera poses defined in <code class="mono">docs/CAPTURE_CONTRACT.md</code>, so every
    iteration is compared from identical viewpoints.</p>
    <p>The visual bar is graded against reference frames from Final Fantasy XV and God of War,
    held locally and used for critique only. Those frames are copyrighted and are deliberately
    not reproduced on this page; the traits extracted from them are written up in
    <code class="mono">docs/REFERENCE_ANALYSIS.md</code>. The dark tick on each score track
    marks the 78/100 ship gate.</p>
  </footer>
</div>`;

writeFileSync(resolve(ROOT, 'progress.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`progress.html written — ${kb} KB`);
