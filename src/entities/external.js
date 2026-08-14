/**
 * External character loader — Mixamo (and any GLB/FBX skinned rig).
 *
 * Implements the SAME contract as the procedural character in character.js, so
 * the player controller, combat and quest systems cannot tell the difference:
 *
 *   { name:'character', object3D, update(ctx), spawn, setPose(name), root, external:true }
 *
 * Usage — see public/characters/README.md:
 *   1. Drop files in  public/characters/
 *   2. Load with      http://localhost:5188/?character=MyGuy.fbx
 *      or persist it: localStorage.setItem('macrion.character', 'MyGuy.fbx')
 *
 * Animations: either baked into the model file, or supplied as separate clip
 * files named <base>@idle.fbx / @walk.fbx / @run.fbx — which is exactly how
 * Mixamo exports when you download animations for a character.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export const SPAWN = { x: 12, z: 26 };

const BASE = '/characters/';

/** Which file to load, from ?character= or localStorage. Null = use procedural. */
export function requestedCharacter() {
  const q = new URLSearchParams(location.search).get('character');
  if (q) return q;
  try { return localStorage.getItem('macrion.character') || null; } catch { return null; }
}

/**
 * Mixamo clip names are wildly inconsistent ("mixamo.com", "Armature|mixamo.com",
 * "Walking", "Fast Run"). Match on intent instead of exact name.
 */
const POSE_PATTERNS = {
  idle: /idle|breath|stand/i,
  walk: /walk/i,
  run: /run|sprint|jog/i,
  attack: /attack|slash|punch|kick|sword/i,
  stagger: /hit|impact|stagger|damage|react/i,
  die: /death|die|dying/i,
};

function classify(clipName, fileHint = '') {
  const hay = `${fileHint} ${clipName}`;
  for (const [pose, re] of Object.entries(POSE_PATTERNS)) {
    if (re.test(hay)) return pose;
  }
  return null;
}

function loaderFor(url) {
  return /\.fbx$/i.test(url) ? new FBXLoader() : new GLTFLoader();
}

function load(url) {
  return new Promise((res, rej) => {
    loaderFor(url).load(url, res, undefined, rej);
  });
}

/** GLTF hands back { scene, animations }; FBX hands back an Object3D with .animations. */
function normalize(result) {
  if (result.scene) return { root: result.scene, clips: result.animations ?? [] };
  return { root: result, clips: result.animations ?? [] };
}

/**
 * Scale the rig so it stands ~1.75 m tall, matching Oz and the terrain's scale.
 * Mixamo FBX exports are in centimetres, so they arrive ~100x too big; GLB
 * exports are usually already in metres. Measuring beats guessing.
 */
function normalizeScale(obj, targetHeight = 1.75) {
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y;
  if (!Number.isFinite(h) || h <= 0) return 1;
  const s = targetHeight / h;
  obj.scale.setScalar(s);
  // Re-measure and sit the feet exactly on y=0 of the parent group.
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
  return s;
}

export function createExternalCharacter(ctx, file) {
  const group = new THREE.Group();
  const h = ctx.terrain?.heightAt?.(SPAWN.x, SPAWN.z) ?? 0;
  group.position.set(SPAWN.x, h, SPAWN.z);

  let mixer = null;
  const actions = {};          // pose -> AnimationAction
  let pose = 'idle';
  let ready = false;
  let failed = null;

  (async () => {
    try {
      const url = BASE + file;
      const { root, clips } = normalize(await load(url));

      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;       // skinned bounds are unreliable when posed
        // Mixamo materials are often MeshPhongMaterial; convert so they respond
        // to the scene's PMREM environment and tonemapping like everything else.
        const m = o.material;
        if (m && !m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial) {
          o.material = new THREE.MeshStandardMaterial({
            map: m.map ?? null,
            normalMap: m.normalMap ?? null,
            color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
            roughness: 0.75,
            metalness: 0.0,
            skinning: true,
          });
          if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
        }
      });

      normalizeScale(root);
      group.add(root);

      mixer = new THREE.AnimationMixer(root);

      // Clips baked into the model file.
      const found = [];
      for (const clip of clips) found.push({ clip, hint: file });

      // Sibling animation files: MyGuy.fbx -> MyGuy@walk.fbx etc.
      const base = file.replace(/\.(fbx|glb|gltf)$/i, '');
      const ext = file.match(/\.(fbx|glb|gltf)$/i)?.[0] ?? '.fbx';
      for (const p of Object.keys(POSE_PATTERNS)) {
        const sib = `${base}@${p}${ext}`;
        try {
          const r = normalize(await load(BASE + sib));
          for (const clip of r.clips) found.push({ clip, hint: sib });
        } catch { /* optional */ }
      }

      for (const { clip, hint } of found) {
        const p = classify(clip.name, hint);
        if (!p || actions[p]) continue;
        const a = mixer.clipAction(clip);
        a.play();
        a.enabled = true;
        a.setEffectiveWeight(0);
        actions[p] = a;
      }
      // Nothing matched by name — fall back to the first clip as idle.
      if (!Object.keys(actions).length && found.length) {
        const a = mixer.clipAction(found[0].clip);
        a.play(); a.enabled = true; a.setEffectiveWeight(0);
        actions.idle = a;
      }
      applyPose(pose);
      ready = true;
      console.log(`[macrion] external character "${file}" loaded — poses: ${Object.keys(actions).join(', ') || 'none'}`);
    } catch (e) {
      failed = e;
      console.error(`[macrion] failed to load character "${file}":`, e);
    }
  })();

  function applyPose(name) {
    for (const [p, a] of Object.entries(actions)) a.setEffectiveWeight(p === name ? 1 : 0);
  }

  return {
    name: 'character',
    external: true,
    object3D: group,
    spawn: SPAWN,
    /** The world-transform node. The animator never writes to it — same
     *  ownership split as the procedural character, so the controller works. */
    root: group,
    get ready() { return ready; },
    get error() { return failed; },
    poses: () => Object.keys(actions),

    setPose(name) {
      if (!actions[name] || pose === name) return;
      pose = name;
      applyPose(name);
    },

    update(c) {
      if (!mixer) return;
      // Drive from the engine clock, NOT a delta, so a capture that pins the
      // clock renders the identical frame every run.
      mixer.setTime(c.time);
    },
  };
}
