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
import type { SetType } from './types';

export const SET_TYPES: SetType[] = ['warmup', 'working', 'failure', 'drop'];

export const SET_TYPE_LABEL: Record<SetType, string> = {
  warmup: 'Warm-up',
  working: 'Working',
  failure: 'Failure',
  drop: 'Drop',
};

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

export type EffortScale = 'rir' | 'rpe';

/** RPE is 10 minus RIR, kept to halves. */
export function rpeFromRir(rir: number): number {
  return Math.round((10 - rir) * 2) / 2;
}

export function rirFromRpe(rpe: number): number {
  return Math.round((10 - rpe) * 2) / 2;
}

export interface EffortOption {
  /** Stored value: reps in reserve. */
  rir: number;
  /** What the chip shows. */
  label: string;
}

/** Chip values for the effort row. RIR 0–5, or RPE 10 down to 6 in halves (RIR 0–4). */
export function effortOptions(scale: EffortScale): EffortOption[] {
  if (scale === 'rpe') {
    const out: EffortOption[] = [];
    for (let rpe = 10; rpe >= 6; rpe -= 0.5) out.push({ rir: rirFromRpe(rpe), label: String(rpe) });
    return out;
  }
  return [0, 1, 2, 3, 4, 5].map((rir) => ({ rir, label: String(rir) }));
}

/** "RIR 2" or "RPE 8", as the settings say. */
export function formatEffort(rir: number, scale: EffortScale): string {
  return scale === 'rpe' ? `RPE ${rpeFromRir(rir)}` : `RIR ${rir}`;
}

// ---------------------------------------------------------------------------
// Feel — the plain-language replacement for RIR/RPE jargon everywhere but the live session screen
// (rebuilt in a later phase) and Settings' effort-scale control (removed in that same phase).

export type Feel = 'Easy' | 'Good' | 'Hard' | 'Maxed';

export interface FeelOption {
  /** Stored value: reps in reserve. */
  rir: number;
  label: Feel;
}

/** The four feel chips, RIR 3 down to 0. */
export const FEEL_OPTIONS: FeelOption[] = [
  { rir: 3, label: 'Easy' },
  { rir: 2, label: 'Good' },
  { rir: 1, label: 'Hard' },
  { rir: 0, label: 'Maxed' },
];

/**
 * The plain word for a logged RIR: Easy at 3 or above (a Hevy import can carry 4–5), Good at 2,
 * Hard at 1, Maxed at 0 or below. `undefined` (no RIR logged) is null, not a guess.
 */
export function feelLabel(rir: number | undefined): Feel | null {
  if (typeof rir !== 'number' || !Number.isFinite(rir)) return null;
  if (rir >= 3) return 'Easy';
  if (rir >= 2) return 'Good';
  if (rir >= 1) return 'Hard';
  return 'Maxed';
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
