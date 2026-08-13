/**
 * Macrion — quest/progression machinery. Generic and content-blind: every
 * word of "The Dark Cairn" lives in story.js, not here. A level 2 quest file
 * runs on this same engine unmodified.
 *
 * Progression state (save-able):
 *   { flags: { [name]: true }, quests: { [id]: { state, objective, data } } }
 * `state` per quest is one of 'inactive' | 'active' | 'complete'.
 *
 * Trigger types (objective.trigger.type):
 *   radius      { pos:{x,z}, radius }            — player within radius, polled every tick()
 *   timeOfDay   { in:[a,b] }                      — ctx.hour inside [a,b), wrapping past 24, polled
 *   talk        { npc }                           — notify('talk',   { npc })
 *   interact    { target }                        — notify('interact', { target })
 *   defeatEnemy { enemy }                         — notify('defeatEnemy', { enemy })
 *   collect     { item }                          — notify('collect', { item })
 * The last three exist for future levels; nothing in level 1 uses them yet
 * except talk/interact, but the evaluator treats all five identically.
 *
 * Effects (applied by objective.onEnter / objective.onComplete / quest.reward):
 *   { setFlags:[...], clearFlags:[...], weather:'storm', time:20.5,
 *     toast:'...', emit:[{event,payload}], audio:'cue-id' }
 * This is the ONLY place quest content is allowed to touch the engine
 * (setWeather/setTime) or siblings (hud.toast, audio.play) — and even here
 * it only happens in response to a real trigger firing, never at
 * construction or from an unconditional per-frame call, which is what keeps
 * capture runs pixel-stable: no input reaches the game during a capture, so
 * no trigger ever fires, so no effect ever runs.
 */

/** Is `hour` inside [a,b)? Wraps past midnight when a > b, e.g. [20, 5]. */
export function hourInRange(hour, [a, b]) {
  if (a <= b) return hour >= a && hour < b;
  return hour >= a || hour < b;
}

export function createQuestSystem({ questDefs, bus, getPlayerPos }) {
  const state = {
    flags: {},
    quests: {}, // id -> { state, objective, data }
  };
  for (const q of questDefs) state.quests[q.id] = { state: 'inactive', objective: 0, data: {} };

  const byId = new Map(questDefs.map((q) => [q.id, q]));

  function applyEffect(effect, ctx) {
    if (!effect) return;
    for (const f of effect.setFlags ?? []) state.flags[f] = true;
    for (const f of effect.clearFlags ?? []) delete state.flags[f];
    if (effect.weather !== undefined) ctx?.engine?.setWeather?.(effect.weather);
    if (effect.time !== undefined) ctx?.engine?.setTime?.(effect.time);
    if (effect.toast) ctx?.engine?.systems?.hud?.toast?.(effect.toast);
    if (effect.audio) ctx?.engine?.systems?.audio?.play?.(effect.audio);
    for (const e of effect.emit ?? []) bus.emit(e.event, e.payload);
  }

  function activeQuest() {
    for (const q of questDefs) {
      if (state.quests[q.id].state === 'active') return q;
    }
    return null;
  }

  function currentObjective(q) {
    if (!q) return null;
    const s = state.quests[q.id];
    return q.objectives[s.objective] ?? null;
  }

  function startQuest(id, ctx) {
    const q = byId.get(id);
    if (!q) return;
    const s = state.quests[id];
    if (s.state !== 'inactive') return;
    s.state = 'active';
    s.objective = 0;
    bus.emit('quest:start', { questId: id });
    applyEffect(q.objectives[0]?.onEnter, ctx);
  }

  /** Move an active quest to its next objective, or complete it. */
  function completeObjective(q, ctx) {
    const s = state.quests[q.id];
    const obj = q.objectives[s.objective];
    if (!obj) return;
    applyEffect(obj.onComplete, ctx);
    s.objective += 1;
    const next = q.objectives[s.objective];
    if (next) {
      bus.emit('quest:advance', { questId: q.id, objectiveId: next.id, index: s.objective });
      applyEffect(next.onEnter, ctx);
    } else {
      s.state = 'complete';
      applyEffect(q.reward, ctx);
      bus.emit('quest:complete', { questId: q.id });
    }
  }

  /** Event-based trigger arrival: talk / interact / defeatEnemy / collect. */
  function notify(type, payload, ctx) {
    const q = activeQuest();
    const obj = currentObjective(q);
    if (!obj || obj.trigger.type !== type) return false;
    const t = obj.trigger;
    let match = false;
    if (type === 'talk') match = t.npc === payload?.npc;
    else if (type === 'interact') match = t.target === payload?.target;
    else if (type === 'defeatEnemy') match = t.enemy === payload?.enemy;
    else if (type === 'collect') match = t.item === payload?.item;
    if (!match) return false;
    if (obj.require && !obj.require(state.flags)) return false;
    completeObjective(q, ctx);
    return true;
  }

  /** Polled trigger check: radius / timeOfDay. Call once per frame. */
  function tick(ctx) {
    const q = activeQuest();
    const obj = currentObjective(q);
    if (!obj) return;
    const t = obj.trigger;
    let satisfied = false;
    if (t.type === 'radius') {
      const p = getPlayerPos();
      if (p) satisfied = Math.hypot(p.x - t.pos.x, p.z - t.pos.z) <= t.radius;
    } else if (t.type === 'timeOfDay') {
      satisfied = hourInRange(ctx.hour, t.in);
    } else {
      return; // event-based types only advance through notify()
    }
    if (!satisfied) return;
    if (obj.require && !obj.require(state.flags)) return;
    completeObjective(q, ctx);
  }

  function snapshot() {
    const q = activeQuest();
    if (!q) return null;
    const s = state.quests[q.id];
    const obj = q.objectives[s.objective] ?? null;
    return {
      id: q.id,
      title: q.title,
      state: s.state,
      objectiveIndex: s.objective,
      objectiveId: obj?.id ?? null,
      objectiveText: obj?.text ?? null,
    };
  }

  /** Debug/test hook: force the CURRENT objective of the given quest to
   * complete regardless of its trigger. Matches the createGame() stub
   * contract's `advance(id)`. No-ops if `id` doesn't match the active
   * objective, so it can't be used to skip ahead by accident. */
  function forceAdvance(objectiveId, ctx) {
    const q = activeQuest();
    const obj = currentObjective(q);
    if (!obj) return false;
    if (objectiveId !== undefined && objectiveId !== obj.id) return false;
    completeObjective(q, ctx);
    return true;
  }

  function serialize() { return JSON.stringify(state); }
  function deserialize(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return;
    state.flags = parsed.flags ?? {};
    state.quests = parsed.quests ?? state.quests;
  }

  return { state, startQuest, notify, tick, snapshot, forceAdvance, applyEffect, serialize, deserialize };
}
