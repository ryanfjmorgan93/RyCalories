/**
 * `LiveSessionScreen` groups every logged set by slot on each render (its `setsBySlot` memo),
 * rebuilding every slot's array fresh — even a slot nothing happened to — because the whole
 * session's `setLogs` live query fires on any write, to any slot. Every `ExerciseCard` reads its
 * own `useLiveQuery(..., [..., sets, ...])` off that array's reference, so a fresh-but-identical
 * array for slot X makes X's records query re-run every time slot Y logs a set — pure waste.
 *
 * `mergeStableSlots` keeps the previous render's array reference for any slot whose sets are
 * unchanged, so an unaffected card's `sets` prop — and its live-query dependency array — stays
 * referentially stable.
 */
import type { SetLog } from './types';

const SAME_FIELDS = ['id', 'weight', 'reps', 'type', 'distanceM', 'seconds', 'rir'] as const;

function setLogEqual(a: SetLog, b: SetLog): boolean {
  return SAME_FIELDS.every((f) => a[f] === b[f]);
}

function slotEqual(a: SetLog[], b: SetLog[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((set, i) => setLogEqual(set, b[i]));
}

/**
 * `prev` is the previous render's map; `next` is this render's freshly-built one. Returns a new
 * map with `next`'s keys, but reusing `prev`'s array object wherever the two slots' sets are equal
 * (same length, same sets in the same order, same tracked fields) — a slot present in `next` but
 * not `prev` (a brand-new slot) simply keeps its `next` array; a key dropped from `next` (e.g. a
 * removed extra) is absent from the result, exactly as `next` already has it.
 */
export function mergeStableSlots(prev: Map<string, SetLog[]>, next: Map<string, SetLog[]>): Map<string, SetLog[]> {
  const out = new Map<string, SetLog[]>();
  for (const [key, arr] of next) {
    const prevArr = prev.get(key);
    out.set(key, prevArr && slotEqual(prevArr, arr) ? prevArr : arr);
  }
  return out;
}
