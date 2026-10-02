/**
 * What the coach's routine builder reads: the generator's input (the owner's exercises and the
 * library) with the owner's routines, their niggles from the last fortnight and the lifts that have
 * stopped progressing beside it. Read-only; the mapping itself is pure (`@/domain/routineContext`).
 */
import { db } from './db';
import { loadQuickInput } from './quickQueries';
import { addDays } from '@/domain/dates';
import type { RoutineInput } from '@/domain/routineBuilder';
import { buildRoutineContext, NIGGLE_WINDOW_DAYS, type RoutineContext } from '@/domain/routineContext';
import type { Settings } from '@/domain/types';

/**
 * The owner's routines, the niggles logged in the last `NIGGLE_WINDOW_DAYS` days and the exercises
 * stalled as of `today` (a local YYYY-MM-DD). A quick session's hidden routine and an archived one
 * are not the owner's routines: they say nothing about their week and carry no stall.
 */
export async function loadRoutineContext(today: string): Promise<RoutineContext> {
  // A day either side of the window, so the zone a session was started in cannot cut one at its edge.
  const from = addDays(today, -(NIGGLE_WINDOW_DAYS + 2));
  const tables = await db.transaction('r', [db.exercises, db.routines, db.routineExercises, db.sessions, db.decisions], async () => {
    const [exercises, routines, routineExercises, sessions, decisions] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.sessions.where('startedAt').aboveOrEqual(from).toArray(),
      db.decisions.toArray(),
    ]);
    return { exercises, routines, routineExercises, sessions, decisions };
  });
  return buildRoutineContext(tables, today);
}

/** The builder's input as of `today`: every exercise the owner has and every one the library could add, with their context. */
export async function loadRoutineInput(opts: { today: string; settings: Settings }): Promise<RoutineInput> {
  const { input } = await loadQuickInput({ today: opts.today, settings: opts.settings, includeNew: true });
  return { ...input, context: await loadRoutineContext(opts.today) };
}
