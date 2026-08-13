/**
 * Macrion — proximity interaction: detects when the player is near an
 * interactable, emits events the HUD can show a prompt for, and handles the
 * E key (conventional interact; free of the reserved keys — devcam owns
 * F/T/H/1-9/,/. and the player controller owns WASD/shift/P).
 *
 * This module does NOT decide what pressing E *does* — that's quest/story
 * logic and stays in game.js. It only tells the caller "the player pressed
 * interact while standing near X" via the onInteract callback.
 *
 * It also owns simple placeholder markers for the NPC and the wardcairn —
 * nobody else in the tree is responsible for quest-specific props, and
 * BUILD_PLAN's "roughed in" bar covers exactly this: cheap, legible,
 * replaceable geometry, not final art. Markers are gated behind
 * `engine.mode !== 'shot'` per the determinism contract, so they cannot
 * perturb a capture no matter where they sit in world space — they are
 * invisible in the only mode a capture ever runs in.
 */
import * as THREE from 'three';

function buildNpcMarker() {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.85 })
  );
  robe.position.y = 0.75;
  robe.castShadow = true;
  robe.receiveShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xcaa27a, roughness: 0.7 })
  );
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(robe, head);
  return g;
}

function buildCairnMarker() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x54524c, roughness: 0.92 });
  const sizes = [0.85, 0.66, 0.48, 0.32];
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
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0x2a1c14, roughness: 0.6, emissive: 0x000000, emissiveIntensity: 0,
    })
  );
  ember.position.y = y + 0.08;
  ember.name = 'ember';
  g.add(ember);
  g.userData.ember = ember;
  return g;
}

export function createInteractionSystem(ctx, { interactables, bus, getPlayerPos, onInteract }) {
  const group = new THREE.Group();
  group.name = 'game-interactables';
  group.visible = false;

  const markers = new Map(); // interactable id -> Object3D
  for (const it of interactables) {
    const marker = it.kind === 'npc' ? buildNpcMarker() : buildCairnMarker();
    const h = ctx.terrain?.heightAt?.(it.pos.x, it.pos.z) ?? 0;
    marker.position.set(it.pos.x, h, it.pos.z);
    group.add(marker);
    markers.set(it.id, marker);
  }

  let target = null; // currently in-range interactable, or null

  function nearest() {
    const p = getPlayerPos();
    if (!p) return null;
    let best = null, bestD = Infinity;
    for (const it of interactables) {
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
    setCairnLit(lit) {
      const ember = markers.get('wardcairn')?.userData.ember;
      if (!ember) return;
      ember.material.emissive.setHex(lit ? 0xff7a2a : 0x000000);
      ember.material.emissiveIntensity = lit ? 1.4 : 0;
    },
    update(c) {
      group.visible = c.engine.mode !== 'shot';
      // gentle ember flicker once lit, driven by the pinnable clock
      const ember = markers.get('wardcairn')?.userData.ember;
      if (ember && ember.material.emissiveIntensity > 0) {
        ember.material.emissiveIntensity = 1.2 + 0.4 * Math.sin(c.time * 6.0);
      }
      const next = nearest();
      if (next?.id !== target?.id) {
        target = next;
        bus.emit('interact:target', target ? { id: target.id, name: target.name } : null);
      }
    },
  };
}
