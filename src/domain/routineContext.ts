/**
 * What a built routine is fitted around, beyond the exercises themselves — pure. No IO, no clock:
 * `src/db` reads the tables and hands the rows here with today's date.
 *
 * Three things from the owner's own data: the routines they already have (so a new one adds to the
 * week rather than repeating it), the niggles they logged in the last fortnight (so a routine does
 * not ask a sore shoulder for an upright row), and the exercises that have stopped progressing (so a
 * routine offers a variation instead of the same lift a fourth time).
 */
import { daysBetween, isoToDateKey } from './dates';
import { detectStall, type SessionOutcome } from './engine';
import { movementPattern } from './movement';
import type { Exercise, MuscleGroup, NiggleTag, ProgressionDecision, Routine, RoutineExercise, Session } from './types';

export interface ContextExercise {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  pattern: string;
  targetSets: number;
  repMin: number;
  repMax: number;
}

export interface ContextRoutine {
  id: string;
  name: string;
  exercises: ContextExercise[];
}

export interface ContextNiggle {
  tag: NiggleTag;
  severity: 1 | 2 | 3;
  /** Local day the session it was logged on was started (YYYY-MM-DD). */
  date: string;
}

export interface ContextStall {
  exerciseId: string;
  /** How many sessions in a row it has gone without moving. */
  sessions: number;
}

export interface RoutineContext {
  /** The owner's own routines: not archived, not a quick session's hidden one. In their weekly order. */
  routines: ContextRoutine[];
  niggles: ContextNiggle[];
  stalled: ContextStall[];
}

/** A niggle steers a routine for this many days after the session it was logged on. */
export const NIGGLE_WINDOW_DAYS = 14;

/** The rows of every table a routine's context reads, as plain arrays. */
export interface RoutineContextSource {
  exercises: Exercise[];
  routines: Routine[];
  routineExercises: RoutineExercise[];
  sessions: Session[];
  decisions: ProgressionDecision[];
}

/** What a progression decision came to, as the stall check reads it (the same reading `repo.toOutcome` gives). */
function outcomeOf(d: ProgressionDecision): SessionOutcome {
  const applied = d.overrideTo !== undefined ? d.overrideTo : d.rule === 'calibrating' ? d.fromWeight : d.toWeight;
  return { fromWeight: d.fromWeight, appliedWeight: applied, rule: d.rule };
}

export function buildRoutineContext(src: RoutineContextSource, today: string): RoutineContext {
  const exerciseById = new Map(src.exercises.map((e) => [e.id, e]));
  const real = src.routines.filter((r) => !r.archived && !r.quick).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const routines: ContextRoutine[] = [];
  const rxIds: { rx: RoutineExercise; exercise: Exercise }[] = [];
  for (const r of real) {
    const rows = src.routineExercises
      .filter((rx) => rx.routineId === r.id)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const exercises: ContextExercise[] = [];
    for (const rx of rows) {
      const e = exerciseById.get(rx.exerciseId);
      if (!e) continue;
      exercises.push({
        exerciseId: e.id,
        name: e.name,
        muscleGroup: e.muscleGroup,
        pattern: movementPattern(e.name, e.muscleGroup),
        targetSets: rx.targetSets,
        repMin: rx.repMin,
        repMax: rx.repMax,
      });
      rxIds.push({ rx, exercise: e });
    }
    routines.push({ id: r.id, name: r.name, exercises });
  }

  const niggles: ContextNiggle[] = [];
  for (const s of src.sessions) {
    if (!s.niggles?.length) continue;
    const date = isoToDateKey(s.startedAt);
    const ago = daysBetween(date, today);
    if (ago < 0 || ago > NIGGLE_WINDOW_DAYS) continue;
    for (const n of s.niggles) niggles.push({ tag: n.tag, severity: n.severity, date });
  }
  niggles.sort((a, b) => b.date.localeCompare(a.date) || a.tag.localeCompare(b.tag));

  const byRx = new Map<string, ProgressionDecision[]>();
  for (const d of src.decisions) {
    const list = byRx.get(d.routineExerciseId);
    if (list) list.push(d);
    else byRx.set(d.routineExerciseId, [d]);
  }
  const stallOf = new Map<string, number>();
  for (const { rx, exercise } of rxIds) {
    const decisions = [...(byRx.get(rx.id) ?? [])].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    const stall = detectStall(decisions.map(outcomeOf));
    if (stall?.kind === 'stalled') stallOf.set(exercise.id, Math.max(stallOf.get(exercise.id) ?? 0, stall.sessions));
  }
  const stalled = [...stallOf.entries()].map(([exerciseId, sessions]) => ({ exerciseId, sessions })).sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : 1));

  return { routines, niggles, stalled };
}

/**
 * Working sets a week each muscle already gets from the owner's routines: every routine's target
 * sets, summed, each routine counted once.
 */
export function weeklySetsFromRoutines(routines: readonly ContextRoutine[]): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const r of routines) {
    for (const e of r.exercises) out[e.muscleGroup] = (out[e.muscleGroup] ?? 0) + e.targetSets;
  }
  return out;
}
