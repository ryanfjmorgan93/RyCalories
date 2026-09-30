import type { Routine } from './types';

export interface ScheduleOptions {
  /** §8 — never suggest two lower-body days in a row. */
  avoidConsecutiveLower?: boolean;
  /**
   * Whether the last session was a lower-body day, when that is not the routine `lastRoutineId`
   * names: a quick session runs on a hidden routine that is in no list, and does not move the
   * rotation, but two lower-body days in a row are still two. Unset reads it from the list.
   */
  lastWasLower?: boolean;
}

function activeSorted(routines: Routine[]): Routine[] {
  return routines.filter((r) => !r.archived).sort((a, b) => a.order - b.order);
}

/**
 * Suggest the next routine: the one after the last completed routine in weekly order.
 * With `avoidConsecutiveLower`, a lower-body day directly after a lower-body day is skipped
 * in favour of the next non-lower routine in order (wrapping round), falling back to the
 * plain next-in-order pick if every routine is lower-body.
 */
export function suggestNextRoutine(
  routines: Routine[],
  lastRoutineId: string | null | undefined,
  opts: ScheduleOptions = {},
): Routine | null {
  const list = activeSorted(routines);
  if (list.length === 0) return null;
  const lastIdx = lastRoutineId ? list.findIndex((r) => r.id === lastRoutineId) : -1;
  const last = lastIdx >= 0 ? list[lastIdx] : null;
  const start = lastIdx >= 0 ? (lastIdx + 1) % list.length : 0;

  if (opts.avoidConsecutiveLower && (opts.lastWasLower ?? last?.isLowerBody)) {
    for (let i = 0; i < list.length; i++) {
      const candidate = list[(start + i) % list.length];
      if (!candidate.isLowerBody) return candidate;
    }
  }
  return list[start];
}

/**
 * True when picking `pickedId` straight after `lastRoutineId` would be two lower-body days in a row.
 * `opts.lastWasLower`, when given, answers for the last session instead of the list lookup.
 */
export function isConsecutiveLower(
  routines: Routine[],
  lastRoutineId: string | null | undefined,
  pickedId: string,
  opts: Pick<ScheduleOptions, 'lastWasLower'> = {},
): boolean {
  const lastLower = opts.lastWasLower ?? (lastRoutineId ? routines.find((r) => r.id === lastRoutineId)?.isLowerBody : false);
  const picked = routines.find((r) => r.id === pickedId);
  return Boolean(lastLower && picked?.isLowerBody);
}

/**
 * True when a routine is known to have no exercises, so there is nothing to start. `counts` is
 * exercises-per-routine as the screens build it — a routine with no rows is simply absent from it —
 * so absence means empty only once the counts have loaded: `undefined` (still loading) judges
 * nothing, and a Start button must not flash disabled on every visit.
 */
export function hasNoExercises(counts: ReadonlyMap<string, number> | undefined, routineId: string): boolean {
  return counts !== undefined && (counts.get(routineId) ?? 0) === 0;
}
