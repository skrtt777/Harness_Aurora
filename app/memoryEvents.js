// The memory's own events, as they really happen (the Mapa Vivo de Memórias listens to them): a memory
// created, updated, archived or deleted, and the memories the Aurora put into a turn's context ("recalled").
// Nothing here is simulated: each emit sits next to the code that does the thing. The last ones stay in a
// small ring for the map's "atividade recente".
import { EventEmitter } from "node:events";

export const memoryEvents = new EventEmitter();
memoryEvents.setMaxListeners(50);
const RING = 200;
const recent = [];
let seq = 0;

/** One real event: { type, at, seq, ...payload }. Never throws. */
export function emitMemoryEvent(type, payload = {}) {
  try {
    const event = { type, at: new Date().toISOString(), seq: (seq += 1), ...payload };
    recent.push(event);
    if (recent.length > RING) recent.splice(0, recent.length - RING);
    memoryEvents.emit("event", event);
    return event;
  } catch { return null; }
}

/** The latest events, newest first (optionally only after `afterSeq`). */
export function recentMemoryEvents({ limit = 50, afterSeq = 0 } = {}) {
  return recent.filter((e) => e.seq > afterSeq).slice(-limit).reverse();
}
