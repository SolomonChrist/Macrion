/**
 * Macrion — proximity interaction: detects when the player is near an
 * interactable, emits events the HUD can show a prompt for, and handles the
 * E key (conventional interact; free of the reserved keys — devcam owns
 * F/T/H/1-9/,/. and the player controller owns WASD/shift/P).
 *
 * This module does NOT decide what pressing E *does* — that's quest/story
 * logic and stays in game.js. It only tells the caller "the player pressed
 * interact while standing near X" via the onInteract callback. Content-blind:
 * nothing here knows Melina from the Great Head, only `kind` and `marker`.
 *
 * Interactable data shape (see story.js INTERACTABLES):
 *   { id, kind: 'npc'|'item'|'object'|'landmark', name, pos:{x,z}, radius,
 *     marker?: 'giant'|'apparition',   // override the default kind->marker pick
 *     ghostly?: true,                  // shorthand for marker:'apparition'
 *     requires?: (flags) => boolean,   // gates BOTH visibility and proximity
 *     conversation?: string, itemId?: string, actionByObjective?: {...} }
 *
 * `requires` lets story content stage reveals data-side — e.g. the Great Head
 * has no presence in the world until the flute has been played, and Sarah's
 * apparition has none until the player is on the mainland. No machinery
 * change is needed to add a new gated interactable; a level editor authors
 * it by writing the predicate.
 *
 * Markers are placeholder debug geometry — "roughed in", not final art — and
 * are gated behind `engine.mode !== 'shot'` per the determinism contract, so
 * they cannot perturb a capture no matter where they sit in world space:
 * they are invisible in the only mode a capture ever runs in.
 */
import * as THREE from 'three';

function buildHumanMarker(bodyColor = 0x6b5a45, headColor = 0xcaa27a, opacity = 1) {
  const g = new THREE.Group();
  const transparent = opacity < 1;
  const robe = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85, transparent, opacity, depthWrite: !transparent })
  );
  robe.position.y = 0.75;
  robe.castShadow = !transparent;
  robe.receiveShadow = !transparent;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.7, transparent, opacity, depthWrite: !transparent })
  );
  head.position.y = 1.62;
  head.castShadow = !transparent;
  g.add(robe, head);
  return g;
}

/** Sarah — ghostly from the very first appearance, per STORY.md. Pale,
 * translucent, no cast shadow (an apparition casts no shadow). */
function buildApparitionMarker() {
  return buildHumanMarker(0xdce8f5, 0xf3f7ff, 0.42);
}

/** The Great Head of Macrion — giant, ghostly, immensely powerful. Scaled
 * well above human height so it reads as a spectacle even as a placeholder. */
function buildGiantMarker() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xcfe0f2, roughness: 0.55, transparent: true, opacity: 0.55, depthWrite: false,
      emissive: 0x3a5a7a, emissiveIntensity: 0.4,
    })
  );
  head.position.y = 3.2;
  g.add(head);
  return g;
}

/** A carried or ground item — small, distinct, catches the eye. */
function buildItemMarker() {
  const g = new THREE.Group();
  const stone = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0xd8c48a, roughness: 0.4, metalness: 0.15 })
  );
  stone.position.y = 0.55;
  stone.castShadow = true;
  g.add(stone);
  return g;
}

/** A notable feature — a landmark, a prop, an object worth pressing E on. */
function buildPropMarker() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x54524c, roughness: 0.92 });
  const sizes = [0.85, 0.66, 0.48];
  let y = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const box = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.6, 0), stoneMat);
    y += s * 0.42;
    box.position.set((i % 2 ? 0.06 : -0.05) * i, y, (i % 2 ? -0.05 : 0.06) * i);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    y += s * 0.42;
  }
  return g;
}

function buildMarker(it) {
  const kind = it.marker ?? (it.ghostly ? 'apparition' : it.kind);
  if (kind === 'giant') return buildGiantMarker();
  if (kind === 'apparition') return buildApparitionMarker();
  if (kind === 'item') return buildItemMarker();
  if (kind === 'npc') return buildHumanMarker();
  return buildPropMarker(); // object / landmark / unknown — generic prop
}

export function createInteractionSystem(ctx, { interactables, bus, getPlayerPos, getFlags, onInteract }) {
  const group = new THREE.Group();
  group.name = 'game-interactables';
  group.visible = false;

  const markers = new Map(); // interactable id -> Object3D
  for (const it of interactables) {
    const marker = buildMarker(it);
    const h = ctx.terrain?.heightAt?.(it.pos.x, it.pos.z) ?? 0;
    marker.position.set(it.pos.x, h, it.pos.z);
    group.add(marker);
    markers.set(it.id, marker);
  }

  let target = null; // currently in-range, satisfied-requirement interactable, or null

  function available(it) {
    return !it.requires || it.requires(getFlags?.() ?? {});
  }

  function nearest() {
    const p = getPlayerPos();
    if (!p) return null;
    let best = null, bestD = Infinity;
    for (const it of interactables) {
      if (!available(it)) continue;
      const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
      if (d <= it.radius && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  addEventListener('keydown', (e) => {
    if (ctx.engine.mode !== 'play') return; // interact only means something in gameplay
    if (e.key.toLowerCase() !== 'e') return;
    if (!target) return;
    onInteract(target, ctx.engine.ctx);
  });

  return {
    object3D: group,
    current() { return target; },
    update(c) {
      const shot = c.engine.mode === 'shot';
      for (const it of interactables) {
        const m = markers.get(it.id);
        if (m) m.visible = !shot && available(it);
      }
      group.visible = !shot;
      const next = nearest();
      if (next?.id !== target?.id) {
        target = next;
        bus.emit('interact:target', target ? { id: target.id, name: target.name, kind: target.kind } : null);
      }
    },
  };
}
