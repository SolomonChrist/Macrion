// Macrion — tiny synchronous pub/sub. No dependencies, no queueing: emit()
// calls listeners immediately, in subscription order. Exceptions in one
// listener must not stop the others (a bad HUD render should never break
// quest state), so each call is wrapped.
export function createEventBus() {
  const listeners = new Map(); // event name -> Set<fn>

  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => off(evt, fn); // convenience: on() returns its own unsubscribe
  }

  function off(evt, fn) {
    listeners.get(evt)?.delete(fn);
  }

  function emit(evt, payload) {
    const set = listeners.get(evt);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (err) { console.error(`[game] listener for "${evt}" threw`, err); }
    }
  }

  return { on, off, emit };
}
