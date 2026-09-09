/**
 * Read queries for the check-in screen (§9). Pure reads; call from useLiveQuery.
 */
import { db } from './db';
import { previousSets } from './repo';
import { SEED_EXERCISE_IDS } from './seed';
import type { CheckInInput, CheckInLift, CheckInNiggle, CheckInSession } from '@/domain/checkin';
import { windowStart } from '@/domain/checkin';
import { isoToDateKey } from '@/domain/dates';
import type { Routine, RoutineExercise, Session } from '@/domain/types';

/** The four lifts named in the brief, in report order. */
export const CHECK_IN_EXERCISE_IDS: string[] = [
  SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'],
  SEED_EXERCISE_IDS['Hip Thrust (Barbell)'],
  SEED_EXERCISE_IDS['Bench Press (Barbell)'],
  SEED_EXERCISE_IDS['Barbell Back Squat'],
];

/** First non-archived routine-exercise for an exercise, by routine order then position. */
async function firstRoutineExercise(exerciseId: string, routinesById: Map<string, Routine>): Promise<RoutineExercise | undefined> {
  const rxs = (await db.routineExercises.where('exerciseId').equals(exerciseId).toArray()).filter((rx) => routinesById.has(rx.routineId));
  rxs.sort((a, b) => (routinesById.get(a.routineId)?.order ?? 0) - (routinesById.get(b.routineId)?.order ?? 0) || a.order - b.order);
  return rxs[0];
}

export async function checkInLifts(): Promise<CheckInLift[]> {
  const routines = (await db.routines.toArray()).filter((r) => !r.archived);
  const routinesById = new Map(routines.map((r) => [r.id, r]));
  const out: CheckInLift[] = [];
  for (const exerciseId of CHECK_IN_EXERCISE_IDS) {
    const exercise = await db.exercises.get(exerciseId);
    if (!exercise) continue;
    const rx = await firstRoutineExercise(exerciseId, routinesById);
    if (!rx) continue;
    const prev = await previousSets(rx.id, exerciseId, '');
    const lastSessionReps = prev
      ? prev.sets.filter((s) => s.type === 'working' && typeof s.reps === 'number').map((s) => s.reps as number)
      : undefined;
    out.push({
      name: exercise.name,
      weight: rx.mode === 'calibrating' ? null : rx.currentWeight,
      mode: rx.mode,
      kind: exercise.kind,
      repMin: rx.repMin,
      repMax: rx.repMax,
      targetSets: rx.targetSets,
      lastSessionReps: lastSessionReps && lastSessionReps.length > 0 ? lastSessionReps : undefined,
    });
  }
  return out;
}

/** Completed sessions whose local start date falls in the window, oldest first. */
export async function completedSessionsInWindow(asOf: string, days: number): Promise<Session[]> {
  const from = windowStart(asOf, days);
  const done = (await db.sessions.toArray()).filter((s) => {
    if (!s.endedAt) return false;
    const key = isoToDateKey(s.startedAt);
    return key >= from && key <= asOf;
  });
  return done.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Everything buildCheckIn needs for the window ending on `asOf`. */
export async function checkInData(asOf: string, days: number): Promise<CheckInInput> {
  const [lifts, bodyweights, sessions] = await Promise.all([checkInLifts(), db.bodyweight.toArray(), completedSessionsInWindow(asOf, days)]);
  const sessionRows: CheckInSession[] = sessions.map((s) => ({ date: isoToDateKey(s.startedAt), title: s.title }));
  const niggles: CheckInNiggle[] = [];
  for (const s of sessions) {
    for (const n of s.niggles ?? []) niggles.push({ date: isoToDateKey(s.startedAt), tag: n.tag, severity: n.severity, note: n.note });
  }
  return { asOf, days, lifts, bodyweights, niggles, sessions: sessionRows };
}
