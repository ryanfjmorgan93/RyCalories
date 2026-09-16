/**
 * The next session's plan for a routine: prescription, last time and stall status per exercise.
 * Read-only query; call from useLiveQuery.
 */
import { db } from './db';
import { outcomesForRoutineExercise, previousSets, routineItems, stallStatus, type PreviousSets } from './repo';
import type { Suggestion } from '@/domain/engine';
import { fmtSetsLine } from '@/domain/format';
import { prescribe, type Prescription } from '@/domain/prescription';
import { countsForProgression, effortRir, formatEffort } from '@/domain/sets';
import type { Exercise, ExerciseKind, Routine, RoutineExercise, Settings } from '@/domain/types';

export interface PlanItem {
  rx: RoutineExercise;
  exercise: Exercise;
  prescription: Prescription;
  lastTime: { date: string; line: string; rir?: string } | null;
  stall: Suggestion | null;
}

export interface SessionPlan {
  routine: Routine;
  items: PlanItem[];
  stalledCount: number;
  deloadSuggested: boolean;
}

async function lastTimeFor(prev: PreviousSets | null, kind: ExerciseKind, settings: Settings): Promise<PlanItem['lastTime']> {
  if (!prev) return null;
  const counted = prev.sets.filter((s) => countsForProgression(s.type));
  if (counted.length === 0) return null;
  const line = fmtSetsLine(counted, kind);
  const last = counted[counted.length - 1];
  const rir = effortRir(last);
  const scale = settings.effortScale ?? 'rir';
  return { date: prev.startedAt, line, ...(rir !== undefined ? { rir: formatEffort(rir, scale) } : {}) };
}

export async function nextSessionPlan(routineId: string, settings: Settings, opts?: { deload?: boolean }): Promise<SessionPlan | null> {
  const routine = await db.routines.get(routineId);
  if (!routine) return null;

  const items: PlanItem[] = [];
  let stalledCount = 0;
  for (const { rx, exercise } of await routineItems(routineId)) {
    const stall = await stallStatus(rx.id);
    if (stall?.kind === 'stalled') stalledCount++;
    const lastOutcome = (await outcomesForRoutineExercise(rx.id))[0] ?? null;
    const prescription = prescribe({
      rx,
      kind: exercise.kind,
      equipment: exercise.equipment,
      lastOutcome,
      stall,
      deload: !!opts?.deload,
      settings,
    });
    const prev = await previousSets(rx.id, exercise.id, '');
    const lastTime = await lastTimeFor(prev, exercise.kind, settings);
    items.push({ rx, exercise, prescription, lastTime, stall });
  }

  return { routine, items, stalledCount, deloadSuggested: stalledCount >= 2 };
}
