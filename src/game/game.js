/**
 * Macrion — game orchestration. Wires the content-blind machinery
 * (eventBus, quest, dialogue, interaction) to story.js's data and to the
 * sibling systems (HUD, audio, character, player) reachable through
 * ctx.engine.systems.*. This file is the ONLY place that decides what
 * pressing E *does* with a given interactable — quest.js, dialogue.js and
 * interaction.js never see story content, only shapes.
 *
 * createGame(ctx) -> {
 *   name: 'game', object3D, update(ctx),
 *   state,            // serializable progression: quest state + inventory + level + powers
 *   quest, dialogue, interaction, bus,   // the machinery, exposed for console testing
 *   on(evt, fn), emit(evt, data),         // event bus passthrough
 *   startQuest(id), advance(objectiveId), // console/test helpers
 *   serialize(), deserialize(json),
 * }
 *
 * Every sibling call is optional-chained (?.) — other builders are mid-
 * rewrite and their systems may not exist yet, or may exist without every
 * method. A missing HUD or audio system must never break quest state.
 *
 * Determinism: nothing here mutates the rendered scene at construction.
 * The one auto-start (STARTING_QUEST) happens on the FIRST update() tick,
 * after every module in main.js has registered, and only ever sets flags /
 * emits bus events — no THREE object is added, removed, or altered by it.
 * The interaction system's debug markers stay gated behind
 * `engine.mode !== 'shot'` exactly as before, so a capture run is
 * unaffected by any of this running underneath it.
 */
import * as THREE from 'three';
import { createEventBus } from './eventBus.js';
import { createQuestSystem } from './quest.js';
import { createDialogueSystem } from './dialogue.js';
import { createInteractionSystem } from './interaction.js';
import { QUESTS, CONVERSATIONS, INTERACTABLES, QUEST_CHAIN, STARTING_QUEST } from './story.js';

export function createGame(ctx) {
  const bus = createEventBus();

  /** Fresh ctx snapshot — engine.ctx is a getter, so this always reflects
   * whatever modules exist right now, even from a listener registered at
   * construction time before every sibling has registered. */
  const fresh = () => ctx.engine.ctx;

  // Read TRUE world position, not local .position — the character node
  // (root bone, or object3D) sits under its own nested transform (a spawn
  // offset group, itself under a skinned rig), so raw .position is not
  // world space. getWorldPosition() is correct regardless of how deep that
  // nesting is, and needs no coordination with the Character/Player builders.
  const _worldPos = new THREE.Vector3();
  function getPlayerPos() {
    const char = ctx.engine.systems?.character;
    const node = char?.root ?? char?.object3D;
    if (!node) return null;
    node.getWorldPosition(_worldPos);
    return { x: _worldPos.x, z: _worldPos.z };
  }
  function getFlags() {
    return quest.state.flags;
  }

  const quest = createQuestSystem({ questDefs: QUESTS, bus, getPlayerPos });
  const dialogue = createDialogueSystem({
    conversations: CONVERSATIONS, bus, getFlags, applyEffect: quest.applyEffect,
  });

  // ---- progression beyond flags/quest-state: inventory, level, powers ----
  const progression = { inventory: {}, level: 1, powers: [] };

  function grantLevel(power) {
    progression.level += 1;
    if (power && !progression.powers.includes(power)) progression.powers.push(power);
    bus.emit('levelup', { level: progression.level, power: power ?? null });
  }

  // ---- dialogue presentation: push line data to the HUD, if present -------
  function openConversation(convId, c) {
    if (!convId) return null;
    const lines = dialogue.start(convId, c);
    ctx.engine.systems?.hud?.dialogue?.(lines);
    return lines;
  }

  function collectItem(target, c) {
    const itemId = target.itemId ?? target.id;
    // Resolve/display flavor text against CURRENT flags first, so the very
    // first pickup shows the "found it" entry rather than the post-flag one.
    openConversation(target.conversation, c);
    if (progression.inventory[itemId]) return; // already held — flavor only, no re-collect
    progression.inventory[itemId] = true;
    bus.emit('item:collect', { item: itemId, name: target.name });
    quest.notify('collect', { item: itemId }, c);
  }

  function applyAction(action, target, c) {
    if (action.type === 'requireItem') {
      if (progression.inventory[action.item]) {
        quest.notify(action.notify?.type ?? 'interact', action.notify?.payload ?? { target: target.id }, c);
      } else {
        c.engine.systems?.hud?.toast?.(action.failText ?? 'Nothing happens.');
      }
      return;
    }
    if (action.type === 'collect') { collectItem(target, c); return; }
    // Unknown action type — fall back to flavor text rather than silently no-op.
    openConversation(target.conversation, c);
  }

  function onInteract(target, c) {
    bus.emit('interact:use', { id: target.id, kind: target.kind });
    const snap = quest.snapshot();
    const action = target.actionByObjective?.[snap?.objectiveId];
    if (action) { applyAction(action, target, c); return; }

    if (target.kind === 'npc') {
      // Resolve dialogue against CURRENT flags before the talk trigger can
      // flip them, so the first meeting shows the first-meeting lines.
      openConversation(target.conversation, c);
      quest.notify('talk', { npc: target.id }, c);
      return;
    }
    if (target.kind === 'item') { collectItem(target, c); return; }
    // object / landmark — flavor text only, no quest coupling by default.
    openConversation(target.conversation, c);
  }

  const interaction = createInteractionSystem(ctx, {
    interactables: INTERACTABLES, bus, getPlayerPos, getFlags, onInteract,
  });

  // ---- HUD sync: objective tracker + interaction prompt --------------------
  function syncObjective() {
    const s = quest.snapshot();
    ctx.engine.systems?.hud?.setObjective?.(s?.state === 'active' ? s.objectiveText : null);
  }
  bus.on('quest:start', syncObjective);
  bus.on('quest:advance', syncObjective);
  bus.on('quest:complete', ({ questId }) => {
    ctx.engine.systems?.hud?.setObjective?.(null);
    const next = QUEST_CHAIN[questId];
    if (next) quest.startQuest(next, fresh());
  });
  bus.on('interact:target', (t) => {
    ctx.engine.systems?.hud?.prompt?.(t ? `[E] ${t.name}` : null);
  });

  let booted = false;

  return {
    name: 'game',
    object3D: interaction.object3D,

    // progression is intentionally a getter-composed view, not a duplicated
    // copy — quest.state.flags/quests stays the single source of truth for
    // story progress, this file only adds what quest.js doesn't own.
    get state() {
      return {
        flags: quest.state.flags,
        quests: quest.state.quests,
        inventory: progression.inventory,
        level: progression.level,
        powers: progression.powers,
      };
    },

    quest, dialogue, interaction, bus,
    on: bus.on, emit: bus.emit,

    startQuest(id) { quest.startQuest(id, fresh()); },
    /** Console/test helper: force the active quest's CURRENT objective to
     * complete, ignoring its real trigger. No-ops on a mismatched id. */
    advance(objectiveId) { return quest.forceAdvance(objectiveId, fresh()); },
    grantLevel,

    serialize() {
      return JSON.stringify({
        quest: JSON.parse(quest.serialize()),
        inventory: progression.inventory,
        level: progression.level,
        powers: progression.powers,
      });
    },
    deserialize(json) {
      const parsed = JSON.parse(json);
      if (!parsed) return;
      if (parsed.quest) quest.deserialize(JSON.stringify(parsed.quest));
      if (parsed.inventory) Object.assign(progression.inventory, parsed.inventory);
      if (typeof parsed.level === 'number') progression.level = parsed.level;
      if (Array.isArray(parsed.powers)) progression.powers = parsed.powers;
    },

    update(c) {
      if (!booted) {
        booted = true;
        quest.startQuest(STARTING_QUEST, c);
      }
      quest.tick(c);
      interaction.update(c);
    },
  };
}
