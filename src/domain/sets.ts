/**
 * Set types and what each one counts for. Pure.
 *
 *   warmup  — listed, never counted.
 *   working — the sets progression is decided on.
 *   failure — a working set taken to failure: counts for progression, records and volume;
 *             reads as RIR 0 when no RIR was logged.
 *   drop    — a lighter set straight after a working set: counts for volume only. It would
 *             otherwise read as a missed set and force a hold.
 */
import type { SetLog, SetType } from './types';

export const SET_TYPES: SetType[] = ['warmup', 'working', 'failure', 'drop'];

/** Sets the progression engine decides on. */
export function countsForProgression(type: SetType): boolean {
  return type === 'working' || type === 'failure';
}

/** Sets that count towards volume and set counts: everything but a warm-up. */
export function countsForVolume(type: SetType): boolean {
  return type !== 'warmup';
}

/** Sets a personal record can be set on. A drop set is lighter by definition. */
export function countsForRecords(type: SetType): boolean {
  return countsForProgression(type);
}

/**
 * Whether a session's sets may feed a record, an e1RM or a strength figure. A light quick session
 * is submaximal by design (its weights are a fraction of the working weight), so none of it does;
 * it still counts for volume, weekly sets, the streak and History. A normal quick session, and every
 * other session, counts fully.
 */
export function sessionCountsForRecords(session: { quick?: 'light' | 'normal' }): boolean {
  return session.quick !== 'light';
}

/** The RIR a set stands for: what was logged, else 0 for a failure set, else unknown. */
export function effortRir(set: { type: SetType; rir?: number }): number | undefined {
  if (typeof set.rir === 'number' && Number.isFinite(set.rir)) return set.rir;
  return set.type === 'failure' ? 0 : undefined;
}

/**
 * Row badges in logged order: 'W' for a warm-up, 'D' for a drop set, and a running 1-based
 * number over the sets that count for progression — so the numbers agree with every set count
 * shown elsewhere.
 */
export function setBadges(sets: { type: SetType }[]): ('W' | 'D' | number)[] {
  let n = 0;
  return sets.map((s) => (s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : ++n));
}

// ---------------------------------------------------------------------------
// Feel — the plain-language word for a stored `rir`. Every screen uses it.

export type Feel = 'Easy' | 'Good' | 'Hard';

export interface FeelOption {
  /** Stored value: reps in reserve. */
  rir: number;
  label: Feel;
}

/**
 * The three feel chips: Easy 3, Good 2, Hard 1. They decide next session's weight when every set
 * reached the top of the range (`decide` in `domain/engine.ts`). What a chip stores is read back
 * through `feelLabel`, so an older answer (a Maxed 0, or an import's 4–5) still lands on a chip.
 */
export const FEEL_OPTIONS: FeelOption[] = [
  { rir: 3, label: 'Easy' },
  { rir: 2, label: 'Good' },
  { rir: 1, label: 'Hard' },
];

/**
 * The plain word for a logged RIR: Easy at 3 or above (a Hevy import can carry 4–5), Good at 2,
 * Hard at 1 or below (the retired Maxed answer, RIR 0, counts as Hard). `undefined` (no RIR
 * logged) is null, not a guess.
 */
export function feelLabel(rir: number | undefined): Feel | null {
  if (typeof rir !== 'number' || !Number.isFinite(rir)) return null;
  if (rir >= 3) return 'Easy';
  if (rir >= 2) return 'Good';
  return 'Hard';
}

/**
 * The RIR that every counted, non-failure set of a slot shares — what the completion chip shows
 * as selected, and what a set added later into an already-answered slot inherits. Null when there
 * are no such sets, when they disagree, or when none of them carry an RIR at all. A failure set is
 * excluded: it always implicitly reads as RIR 0 (`effortRir`) regardless of what the slot's feel
 * answer was, so it is never part of "does the slot agree".
 */
export function feelOf(sets: { type: SetType; rir?: number }[]): number | null {
  const counted = sets.filter((s) => countsForProgression(s.type) && s.type !== 'failure');
  if (counted.length === 0) return null;
  const rirs = counted.map((s) => effortRir(s));
  const first = rirs[0];
  if (first === undefined) return null;
  return rirs.every((r) => r === first) ? first : null;
}

/** A slot's sets in the order they were logged: by index, then by time for two at the same index. */
export function byIndex(a: SetLog, b: SetLog): number {
  return a.index - b.index || a.completedAt.localeCompare(b.completedAt);
}
