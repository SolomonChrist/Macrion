/**
 * Macrion — conversation state machine. Drives both NPC talk trees and
 * object/landmark flavor text through the same data shape from
 * story.js's CONVERSATIONS. Content-blind: this file knows nothing about
 * Oz, Melina, the Great Head or Sarah — that's all in story.js.
 *
 * This module never touches ctx.engine.systems.hud itself — it only returns
 * line data and lets the caller (game.js) push it through
 * ctx.engine.systems.hud?.dialogue?.(lines), which is where the actual
 * "drive presentation through the HUD" contract lives. Keeping the HUD call
 * at the orchestration layer means this file has zero engine coupling and
 * is trivially unit-testable from the console.
 *
 * `lines` returned to the caller is an array of:
 *   { speaker: string|null, text: string }                  — a spoken line
 *   { choice: true, index: number, text: string }            — a choice option
 * A null speaker means narration/flavor text (used for object interactables).
 *
 * Entry resolution: CONVERSATIONS[id] is scanned top-to-bottom for the first
 * entry whose when(flags) is true (a `next` jump bypasses the scan and goes
 * straight to that entry id). Every conversation should end its scan list
 * with a `when: () => true` catch-all.
 *
 * Bus events: 'dialogue:start' {convId, entryId}, 'dialogue:line' {convId,
 * entryId} on choice-driven advance, 'dialogue:end' {convId} on close.
 */
export function createDialogueSystem({ conversations, bus, getFlags, applyEffect }) {
  let open = null; // { convId, entryId }

  function resolveEntry(convId, entryId) {
    const list = conversations[convId];
    if (!list) return null;
    if (entryId) return list.find((e) => e.id === entryId) ?? null;
    const flags = getFlags();
    return list.find((e) => !e.when || e.when(flags)) ?? null;
  }

  function toLines(entry) {
    const lines = entry.lines.map((l) => ({ speaker: l.speaker ?? null, text: l.text }));
    (entry.choices ?? []).forEach((c, i) => lines.push({ choice: true, index: i, text: c.text }));
    return lines;
  }

  /** Start (or resume) a conversation by id, e.g. 'senna' or 'wardcairn'.
   * Returns the line data to hand to the HUD, or null if nothing matched. */
  function start(convId, ctx) {
    const entry = resolveEntry(convId, null);
    if (!entry) return null;
    open = { convId, entryId: entry.id };
    applyEffect(entry.effect, ctx);
    bus.emit('dialogue:start', { convId, entryId: entry.id });
    return toLines(entry);
  }

  /** Player picked choice `i` of the currently open entry. Returns the next
   * entry's lines, or null if the conversation closed. */
  function choose(i, ctx) {
    if (!open) return null;
    const entry = conversations[open.convId]?.find((e) => e.id === open.entryId);
    const choice = entry?.choices?.[i];
    if (!choice) return null;
    applyEffect(choice.effect, ctx);
    if (choice.next === null || choice.next === undefined) { close(); return null; }
    const next = resolveEntry(open.convId, choice.next);
    if (!next) { close(); return null; }
    open.entryId = next.id;
    applyEffect(next.effect, ctx);
    bus.emit('dialogue:line', { convId: open.convId, entryId: next.id });
    return toLines(next);
  }

  /** Advance past a choice-less entry (the "continue" action). Entries with
   * choices wait for choose() instead; calling advance() on one is a no-op. */
  function advance() {
    if (!open) return null;
    const entry = conversations[open.convId]?.find((e) => e.id === open.entryId);
    if (entry?.choices?.length) return toLines(entry);
    close();
    return null;
  }

  function close() {
    if (!open) return;
    const convId = open.convId;
    open = null;
    bus.emit('dialogue:end', { convId });
  }

  function isOpen() { return !!open; }
  function current() { return open ? { ...open } : null; }

  return { start, choose, advance, close, isOpen, current };
}
