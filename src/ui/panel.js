/**
 * Macrion sandbox panel — volume, animation triggers, music states, cutscenes.
 *
 * Exists so a dropped-in Mixamo rig can be driven immediately without the
 * console. Hidden by setVisible(false), which the capture harness calls before
 * every shot, so it can never appear in a capture.
 */
const POSES = ['idle', 'walk', 'run', 'attack', 'stagger', 'die'];
const MUSIC = ['explore', 'alert', 'combat', 'boss', 'resolve'];
const SFX = ['swordSwing', 'swordHit', 'enemyHit', 'enemyDeath', 'levelUp', 'footstep', 'landing', 'interact'];
const CUTSCENES = ['intro', 'firstBlood', 'bossVictory', 'endCard'];

export function createPanel(ctx) {
  const { engine } = ctx;
  const el = document.createElement('div');
  el.id = 'sandbox';
  el.className = 'hidden';

  const style = document.createElement('style');
  style.textContent = `
    #sandbox{position:fixed;left:12px;top:12px;z-index:30;width:232px;max-height:92vh;
      overflow-y:auto;padding:12px 13px;border-radius:6px;
      background:rgba(10,14,20,.82);border:1px solid rgba(150,180,215,.2);
      color:#c8d8ea;font:11.5px/1.5 ui-monospace,Consolas,monospace;
      backdrop-filter:blur(4px);box-shadow:0 8px 28px -12px rgba(0,0,0,.8)}
    #sandbox.hidden{display:none}
    #sandbox h4{margin:11px 0 5px;font-size:9.5px;letter-spacing:.16em;
      text-transform:uppercase;color:#e8a33d;font-weight:600}
    #sandbox h4:first-child{margin-top:0}
    #sandbox .row{display:flex;flex-wrap:wrap;gap:4px}
    #sandbox button{flex:1 1 auto;min-width:52px;padding:5px 7px;cursor:pointer;
      background:rgba(90,169,214,.13);color:#cfe3ff;
      border:1px solid rgba(150,180,215,.28);border-radius:3px;
      font:11px ui-monospace,Consolas,monospace}
    #sandbox button:hover{background:rgba(232,163,61,.22);border-color:#e8a33d;color:#fff}
    #sandbox button:active{transform:translateY(1px)}
    #sandbox button.on{background:rgba(232,163,61,.3);border-color:#e8a33d;color:#fff}
    #sandbox label{display:flex;align-items:center;gap:7px;margin:3px 0}
    #sandbox input[type=range]{flex:1;accent-color:#e8a33d}
    #sandbox .val{width:30px;text-align:right;color:#8fa4bb;font-variant-numeric:tabular-nums}
    #sandbox .note{color:#7d8ea3;font-size:10.5px;line-height:1.45;margin:5px 0 0}
    #sandbox .hint{color:#e8a33d}
  `;
  document.head.appendChild(style);

  const sys = () => engine.systems ?? {};
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };

  function section(title) {
    el.appendChild(h(`<h4>${title}</h4>`));
    const row = h('<div class="row"></div>');
    el.appendChild(row);
    return row;
  }

  function btn(row, label, fn) {
    const b = h(`<button type="button">${label}</button>`);
    b.addEventListener('click', (e) => { e.preventDefault(); fn(b); });
    row.appendChild(b);
    return b;
  }

  /* ---- character upload ---- */
  el.appendChild(h('<h4>Character</h4>'));
  const upWrap = h(`<div>
    <input type="file" id="charfiles" multiple accept=".fbx,.glb,.gltf" hidden />
    <div class="row">
      <button type="button" id="charpick">upload FBX / GLB</button>
    </div>
    <p class="note" id="charnote">Select the character <em>and</em> its animation files together.</p>
  </div>`);
  el.appendChild(upWrap);
  const fileInput = upWrap.querySelector('#charfiles');
  const charNote = upWrap.querySelector('#charnote');
  upWrap.querySelector('#charpick').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (!files.length) return;
    const { UPLOADS } = await import('../entities/external.js');

    // Register every file under its own name so the @pose sibling lookup finds
    // the animation clips without a round trip to the server.
    for (const f of files) UPLOADS.set(f.name, URL.createObjectURL(f));

    // The character is whichever file has no @pose suffix; otherwise the first.
    const model = files.find((f) => !f.name.includes('@')) ?? files[0];
    charNote.innerHTML = `loading <span class="hint">${model.name}</span> (${files.length} file${files.length > 1 ? 's' : ''})…`;

    try {
      const { createExternalCharacter } = await import('../entities/external.js');
      const next = createExternalCharacter(engine.ctx, model.name);
      const old = sys().character;
      if (old?.object3D) engine.scene.remove(old.object3D);
      const i = engine.modules.indexOf(old);
      if (i !== -1) engine.modules[i] = next; else engine.modules.push(next);
      engine.scene.add(next.object3D);
      engine.systems.character = next;
      described = false;                          // re-read which poses exist
      charNote.innerHTML = `loaded <span class="hint">${model.name}</span> — press <span class="hint">P</span> to play`;
    } catch (err) {
      charNote.textContent = `failed: ${err.message}`;
    }
  });

  const charRow = section('');
  btn(charRow, 'restore Oz', async () => {
    const { createCharacter } = await import('../entities/character.js');
    const next = createCharacter(engine.ctx);
    const old = sys().character;
    if (old?.object3D) engine.scene.remove(old.object3D);
    const i = engine.modules.indexOf(old);
    if (i !== -1) engine.modules[i] = next; else engine.modules.push(next);
    engine.scene.add(next.object3D);
    engine.systems.character = next;
    described = false;
    for (const b of Object.values(poseBtns)) { b.disabled = false; b.style.opacity = ''; }
    poseNote.textContent = '';
    charNote.textContent = 'procedural Oz restored.';
  });

  /* ---- volume ---- */
  el.appendChild(h('<h4>Volume</h4>'));
  const volWrap = h('<label><input type="range" min="0" max="100" value="70" /><span class="val">70</span></label>');
  el.appendChild(volWrap);
  const slider = volWrap.querySelector('input');
  const volVal = volWrap.querySelector('.val');
  slider.addEventListener('input', () => {
    volVal.textContent = slider.value;
    sys().audio?.setVolume?.(slider.value / 100);
  });
  const muteRow = section('');
  let muted = false, lastVol = 70;
  btn(muteRow, 'mute', (b) => {
    muted = !muted;
    b.classList.toggle('on', muted);
    if (muted) { lastVol = Number(slider.value); slider.value = 0; }
    else slider.value = lastVol;
    volVal.textContent = slider.value;
    sys().audio?.setVolume?.(slider.value / 100);
  });
  btn(muteRow, 'unlock audio', () => sys().audio?.unlock?.());

  /* ---- animation ---- */
  const poseRow = section('Animation');
  const poseBtns = {};
  for (const p of POSES) {
    poseBtns[p] = btn(poseRow, p, () => {
      sys().character?.setPose?.(p);
      for (const [k, b] of Object.entries(poseBtns)) b.classList.toggle('on', k === p);
    });
  }
  const poseNote = h('<p class="note"></p>');
  el.appendChild(poseNote);

  /* ---- music ---- */
  const musicRow = section('Music');
  const musicBtns = {};
  for (const m of MUSIC) {
    musicBtns[m] = btn(musicRow, m, () => {
      sys().audio?.setMusicState?.(m);
      for (const [k, b] of Object.entries(musicBtns)) b.classList.toggle('on', k === m);
    });
  }

  /* ---- sarah ---- */
  const sarahRow = section("Sarah's theme");
  btn(sarahRow, 'apparition', () => sys().audio?.sarahApparition?.());
  btn(sarahRow, 'memory', () => sys().audio?.sarahMemory?.(0.8));
  btn(sarahRow, 'wedding', () => sys().audio?.sarahWedding?.());

  /* ---- sfx ---- */
  const sfxRow = section('Sound effects');
  for (const id of SFX) btn(sfxRow, id.replace(/([A-Z])/g, ' $1').trim(), () => sys().audio?.play?.(id));

  /* ---- cutscenes ---- */
  const cineRow = section('Cutscenes');
  for (const id of CUTSCENES) btn(cineRow, id, () => sys().cutscene?.play?.(id));
  btn(cineRow, 'skip', () => sys().cutscene?.skip?.());

  el.appendChild(h('<p class="note">Toggle this panel with <span class="hint">B</span>. Play with <span class="hint">P</span>.</p>'));
  document.body.appendChild(el);

  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'b') el.classList.toggle('hidden');
  });

  let described = false;

  return {
    name: 'panel',
    update() {
      // Once the character reports which poses it actually has, grey out the rest.
      if (described) return;
      const c = sys().character;
      const list = c?.poses?.();
      if (!list) { if (c && !c.external) described = true; return; }
      if (!list.length) return;
      described = true;
      for (const [k, b] of Object.entries(poseBtns)) {
        if (!list.includes(k)) { b.disabled = true; b.style.opacity = '.35'; b.title = 'no clip for this pose'; }
      }
      poseNote.textContent = `external rig — clips found: ${list.join(', ')}`;
    },
    setVisible(v) { el.classList.toggle('hidden', !v); },
  };
}
