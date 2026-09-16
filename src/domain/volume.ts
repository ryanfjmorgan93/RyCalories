/**
 * Session and weekly training volume. Pure functions only — no IO, no clock, no database.
 */
import { daysBetween, isoToDateKey, mondayOf } from './dates';
import { countsForProgression, countsForVolume } from './sets';
import type { MuscleGroup, SetType } from './types';

export { mondayOf };

/** Total kg×reps over the sets that count for volume (everything but a warm-up). */
export function sessionVolume(sets: { type: SetType; weight: number; reps?: number }[]): number {
  return sets.reduce((total, s) => (countsForVolume(s.type) ? total + s.weight * (s.reps ?? 0) : total), 0);
}

/** How many sets count for progression (working + failure), same count shown elsewhere. */
export function countedSets(sets: { type: SetType }[]): number {
  return sets.filter((s) => countsForProgression(s.type)).length;
}

export interface MuscleSetRow {
  muscleGroup: MuscleGroup;
  type: SetType;
  /** ISO timestamp. */
  completedAt: string;
}

/**
 * Sets per muscle group in the local week (Monday–Sunday) containing `weekStart` (a Monday
 * YYYY-MM-DD); counts sets that count for volume. Missing groups are absent, not zero.
 */
export function weeklySetsByMuscle(rows: MuscleSetRow[], weekStart: string): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const row of rows) {
    if (!countsForVolume(row.type)) continue;
    const dayKey = isoToDateKey(row.completedAt);
    if (mondayOf(dayKey) !== weekStart) continue;
    out[row.muscleGroup] = (out[row.muscleGroup] ?? 0) + 1;
  }
  return out;
}

/** Days since the most recent counted set per muscle group, as of `today`; absent when never trained. */
export function muscleRecency(rows: MuscleSetRow[], today: string): Partial<Record<MuscleGroup, number>> {
  const latest: Partial<Record<MuscleGroup, string>> = {};
  for (const row of rows) {
    if (!countsForVolume(row.type)) continue;
    const dayKey = isoToDateKey(row.completedAt);
    const cur = latest[row.muscleGroup];
    if (cur === undefined || dayKey > cur) latest[row.muscleGroup] = dayKey;
  }
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const [group, dayKey] of Object.entries(latest) as [MuscleGroup, string][]) {
    out[group] = daysBetween(dayKey, today);
  }
  return out;
}
