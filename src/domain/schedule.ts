import type { Routine } from './types';

export interface ScheduleOptions {
  /** §8 — never suggest two lower-body days in a row. */
  avoidConsecutiveLower?: boolean;
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

  if (opts.avoidConsecutiveLower && last?.isLowerBody) {
    for (let i = 0; i < list.length; i++) {
      const candidate = list[(start + i) % list.length];
      if (!candidate.isLowerBody) return candidate;
    }
  }
  return list[start];
}

/** True when picking `pickedId` straight after `lastRoutineId` would be two lower-body days in a row. */
export function isConsecutiveLower(
  routines: Routine[],
  lastRoutineId: string | null | undefined,
  pickedId: string,
): boolean {
  if (!lastRoutineId) return false;
  const last = routines.find((r) => r.id === lastRoutineId);
  const picked = routines.find((r) => r.id === pickedId);
  return Boolean(last?.isLowerBody && picked?.isLowerBody);
}
