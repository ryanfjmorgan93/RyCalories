/**
 * Saves a pasted routine (see `@/domain/routineText`) once its exercise lines have been matched
 * or assigned to new exercises. One atomic write: new exercises, the routine, and its
 * routine-exercises all land together or not at all.
 */
import { db } from './db';
import { BODYWEIGHT_PLUS_TITLE_RE, CARRY_TITLE_RE, COMPOUND, guessIncrement, guessMuscle, LOWER } from './hevy';
import { createExercise, createRoutine, defaultRoutineExercise, normaliseName } from './repo';
import type { ParsedRoutineLine } from '@/domain/routineText';
import type { Exercise, ExerciseKind, Routine, RoutineExercise } from '@/domain/types';

export type ImportChoice = { kind: 'existing'; exerciseId: string } | { kind: 'new' };

export interface ImportRow {
  line: ParsedRoutineLine;
  choice: ImportChoice;
}

/**
 * `guessExercise` in `./hevy` reads `HevyExerciseStat` fields (`hasDistance`, `hasDuration`,
 * `bodyweightOnly`) a pasted line has no equivalent of, so this mirrors it using only the name —
 * `opts.timed` stands in for that stat-derived signal (a line parsed as seconds, e.g. "Plank
 * 3x30s") rather than trying to infer duration from the name alone.
 */
function guessKindFromName(name: string, timed: boolean | undefined): ExerciseKind {
  if (CARRY_TITLE_RE.test(name)) return 'carry';
  if (timed) return 'timed';
  if (BODYWEIGHT_PLUS_TITLE_RE.test(name)) return 'bodyweight_plus';
  return 'reps';
}

export function guessExerciseFromName(name: string, opts?: { timed?: boolean }): Omit<Exercise, 'id' | 'createdAt'> {
  const kind = guessKindFromName(name, opts?.timed);
  const isLowerBody = LOWER.test(name) && !/neck/i.test(name);
  const isCompound = kind !== 'carry' && COMPOUND.test(name) && !/leg extension|leg curl/i.test(name);
  return {
    name,
    kind,
    muscleGroup: guessMuscle(name),
    isCompound,
    isLowerBody,
    defaultRestSec: kind === 'carry' ? 90 : isCompound ? 150 : 75,
    defaultIncrement: guessIncrement(name, isLowerBody),
    unilateral: /single|one.?arm|one.?leg|bulgarian|split squat|unilateral/i.test(name),
    aliases: [name],
  };
}

/**
 * Save a pasted routine: resolve each row's exercise (create it if `choice.kind === 'new'`, or
 * learn the pasted name as an alias of the chosen existing one), then create the routine and one
 * routine-exercise per row. One transaction — a failure partway through (e.g. an `existing` row
 * naming an exerciseId that isn't actually in the database) leaves nothing written.
 */
export async function saveParsedRoutine(name: string, rows: ImportRow[]): Promise<Routine> {
  const [routine] = await saveParsedRoutines([{ name, rows }]);
  return routine!;
}

/**
 * Save every routine of one paste together, in ONE transaction: all of them or none. Saved one by
 * one, a failure on the second left the first written, and Save again duplicated it. An unknown
 * name marked "Add new" twice (the same exercise on two days) becomes one new exercise, not two.
 */
export async function saveParsedRoutines(routines: { name: string; rows: ImportRow[] }[]): Promise<Routine[]> {
  if (routines.length === 0 || routines.some((r) => r.rows.length === 0)) throw new Error('Cannot save a routine with no exercises');

  return db.transaction('rw', [db.routines, db.routineExercises, db.exercises], async () => {
    const exercisesById = new Map<string, Exercise>();
    const createdByName = new Map<string, Exercise>();
    const saved: Routine[] = [];
    for (const { name, rows } of routines) {
      saved.push(await writeRoutine(name, rows, exercisesById, createdByName));
    }
    return saved;
  });
}

async function writeRoutine(
  name: string,
  rows: ImportRow[],
  exercisesById: Map<string, Exercise>,
  createdByName: Map<string, Exercise>,
): Promise<Routine> {
  const resolved: { line: ParsedRoutineLine; exercise: Exercise }[] = [];

  for (const row of rows) {
    let exercise: Exercise;
    if (row.choice.kind === 'new') {
      const key = normaliseName(row.line.name);
      const already = createdByName.get(key);
      if (already) {
        exercise = already;
      } else {
        const guessed = guessExerciseFromName(row.line.name, { timed: row.line.seconds });
        exercise = await createExercise(guessed);
        createdByName.set(key, exercise);
      }
    } else {
      const cached = exercisesById.get(row.choice.exerciseId);
      const existing = cached ?? (await db.exercises.get(row.choice.exerciseId));
      if (!existing) throw new Error(`Exercise not found: ${row.choice.exerciseId}`);
      exercise = existing;
      const key = normaliseName(row.line.name);
      const alreadyKnown = normaliseName(exercise.name) === key || (exercise.aliases ?? []).some((a) => normaliseName(a) === key);
      if (!alreadyKnown) {
        const aliases = [...(exercise.aliases ?? []), row.line.name];
        await db.exercises.update(exercise.id, { aliases });
        exercise = { ...exercise, aliases };
      }
    }
    exercisesById.set(exercise.id, exercise);
    resolved.push({ line: row.line, exercise });
  }

  const lowerCount = resolved.filter((r) => r.exercise.isLowerBody).length;
  const isLowerBody = lowerCount * 2 > resolved.length;
  const routine = await createRoutine({ name, isLowerBody });

  const rxs: RoutineExercise[] = resolved.map(({ line, exercise }, order) => {
    const base = defaultRoutineExercise(routine.id, exercise, order);
    const patch: Partial<RoutineExercise> = {};
    if (line.sets !== undefined) patch.targetSets = line.sets;
    if (line.repMin !== undefined && line.repMax !== undefined) {
      // A seconds line ("Plank 3x30s") only means "the numbers are seconds" when it actually
      // landed on a timed exercise. Matched against a non-timed one (an existing exercise the
      // owner picked, say), the numbers aren't reps for that exercise either, so they are
      // dropped and the exercise's own default rep range stands rather than writing 30 reps.
      if (!(line.seconds && exercise.kind !== 'timed')) {
        patch.repMin = line.repMin;
        patch.repMax = line.repMax;
      }
    }
    if (line.weightKg !== undefined && line.weightKg > 0) {
      patch.mode = 'normal';
      patch.currentWeight = line.weightKg;
    } else {
      // No weight (or a non-positive one) never becomes mode 'normal' at 0 kg for anything but
      // bodyweight_plus — see RoutineExerciseEditor's `zeroWeightNormal` rule.
      patch.mode = 'calibrating';
      patch.currentWeight = 0;
    }
    return { ...base, ...patch };
  });
  await db.routineExercises.bulkPut(rxs);

  return routine;
}
