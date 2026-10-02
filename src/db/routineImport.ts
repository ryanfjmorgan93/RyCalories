/**
 * Saves a pasted routine (see `@/domain/routineText`) once its exercise lines have been matched
 * or assigned to new exercises. One atomic write: new exercises, the routine, and its
 * routine-exercises all land together or not at all.
 */
import { db } from './db';
import { CARRY_TITLE_RE, COMPOUND, guessIncrement, guessMuscle, LOWER } from './hevy';
import { createExercise, createRoutine, defaultRoutineExercise, normaliseName } from './repo';
import { catalogueDemoKey, exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { exerciseFromDemo, findExistingExercise, type DemoLike } from '@/domain/library';
import type { ParsedRoutineLine } from '@/domain/routineText';
import type { Exercise, ExerciseKind, Routine, RoutineExercise } from '@/domain/types';

/**
 * What a pasted line becomes. `demo` and `catalogue` are library entries the owner has not added:
 * the exercise is made when the routine is saved (or, when they already have that movement, the row
 * they have is used), so a paste that is cancelled leaves nothing behind. The entry travels in the
 * choice itself, so saving never has to fetch the catalogue inside its transaction.
 */
export type ImportChoice =
  | { kind: 'existing'; exerciseId: string }
  | { kind: 'new' }
  | { kind: 'demo'; demo: DemoLike }
  | { kind: 'catalogue'; entry: CatalogueEntry };

export interface ImportRow {
  line: ParsedRoutineLine;
  choice: ImportChoice;
}

/**
 * Bodyweight with weight added, by name: pull-ups, chin-ups, push-ups and dips, in the plural
 * people write them ("Pull ups", "Press-ups", "Dips"). `BODYWEIGHT_PLUS_TITLE_RE` in `./hevy` is
 * the same idea read off Hevy's singular titles; this one also takes the plural and leaves a hip
 * dip alone.
 */
const BODYWEIGHT_PLUS_NAME_RE = /hyperextension|back extension|(?<!hip\s)\bdips?\b|pull.?up|chin.?up|push.?up|press.?up/i;

/**
 * `guessExercise` in `./hevy` reads `HevyExerciseStat` fields (`hasDistance`, `hasDuration`,
 * `bodyweightOnly`) a pasted line has no equivalent of, so this mirrors it using only the name —
 * `opts.timed` stands in for that stat-derived signal (a line parsed as seconds, e.g. "Plank
 * 3x30s") rather than trying to infer duration from the name alone. A line in seconds is timed
 * before anything else, a carry included: only a timed exercise keeps the numbers.
 */
function guessKindFromName(name: string, timed: boolean | undefined): ExerciseKind {
  if (timed) return 'timed';
  if (CARRY_TITLE_RE.test(name)) return 'carry';
  if (BODYWEIGHT_PLUS_NAME_RE.test(name)) return 'bodyweight_plus';
  return 'reps';
}

/**
 * The exercise a library entry becomes when a pasted line is what asked for it. The diagrams carry
 * no exercise type, so every one is made as a plain reps exercise, and a line landed on it lost
 * what it said: "Plank 3x45s" came out as 3 x 10-12 reps (only a timed exercise keeps seconds) and
 * "Pull-ups 3x8" as plain reps at no weight. So an entry made as reps takes the kind the line
 * implies: timed for seconds, bodyweight with weight added for a bodyweight pull-up, chin-up, dip
 * or push-up. The entry's own name says which, not the line's wording (a line may be "Strict
 * chins", or an inverted row done on a pull-up bar), and only a bodyweight entry counts, so a
 * "Dip Machine" is not a bodyweight dip. An entry the catalogue types itself (a carry, a hold)
 * keeps its type.
 */
export function exerciseForLine(made: Omit<Exercise, 'id' | 'createdAt'>, line: Pick<ParsedRoutineLine, 'seconds'>): Omit<Exercise, 'id' | 'createdAt'> {
  if (made.kind !== 'reps') return made;
  if (line.seconds) return { ...made, kind: 'timed' };
  if (made.equipment === 'bodyweight' && BODYWEIGHT_PLUS_NAME_RE.test(made.name)) return { ...made, kind: 'bodyweight_plus' };
  return made;
}

/**
 * Whether a line's numbers are written to the routine for an exercise of this kind. A seconds line
 * ("Plank 3x30s") only means "the numbers are seconds" when it landed on a timed exercise. Matched
 * against a non-timed one (an existing exercise the owner picked, say), the numbers aren't reps for
 * that exercise either, so they are dropped and the exercise's own default rep range stands rather
 * than writing 30 reps. A line the owner typed is never dropped without saying so: the Review row
 * asks this too, before Save.
 */
export function keepsNumbers(line: Pick<ParsedRoutineLine, 'seconds'>, kind: ExerciseKind): boolean {
  return !(line.seconds && kind !== 'timed');
}

/**
 * The kind of the exercise a choice stands for, as Save will have it: the owner's own exercise as it
 * is, a library entry as it will be made for this line, a new exercise as it will be guessed.
 * undefined when it is not known (an exercise of theirs that has not loaded).
 */
export function kindOfChoice(choice: ImportChoice, line: Pick<ParsedRoutineLine, 'name' | 'seconds'>, owned: ReadonlyMap<string, Pick<Exercise, 'kind'>>): ExerciseKind | undefined {
  switch (choice.kind) {
    case 'existing':
      return owned.get(choice.exerciseId)?.kind;
    case 'new':
      return guessKindFromName(line.name, line.seconds);
    default:
      return exerciseForLine(libraryChoice(choice).input, line).kind;
  }
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

/** The picture key, name and Exercise fields a library choice stands for. */
function libraryChoice(choice: Extract<ImportChoice, { kind: 'demo' | 'catalogue' }>): { pictureKey: string; name: string; input: Omit<Exercise, 'id' | 'createdAt'> } {
  return choice.kind === 'catalogue'
    ? { pictureKey: catalogueDemoKey(choice.entry.slug), name: choice.entry.name, input: exerciseFromCatalogue(choice.entry) }
    : { pictureKey: choice.demo.slug, name: choice.demo.name, input: exerciseFromDemo(choice.demo) };
}

/** The exercise, knowing the pasted name as an alias (once) so the same wording matches on its own next time. */
async function withPastedName(exercise: Exercise, pasted: string): Promise<Exercise> {
  const key = normaliseName(pasted);
  const alreadyKnown = normaliseName(exercise.name) === key || (exercise.aliases ?? []).some((a) => normaliseName(a) === key);
  if (alreadyKnown) return exercise;
  const aliases = [...(exercise.aliases ?? []), pasted];
  await db.exercises.update(exercise.id, { aliases });
  return { ...exercise, aliases };
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
    } else if (row.choice.kind === 'demo' || row.choice.kind === 'catalogue') {
      // The row the owner already has for this movement, else a new one: the same rule as adding it from the list.
      const { pictureKey, name: entryName, input } = libraryChoice(row.choice);
      const have = findExistingExercise(await db.exercises.toArray(), pictureKey, entryName);
      exercise = await withPastedName(have ?? (await createExercise(exerciseForLine(input, row.line))), row.line.name);
    } else {
      const cached = exercisesById.get(row.choice.exerciseId);
      const existing = cached ?? (await db.exercises.get(row.choice.exerciseId));
      if (!existing) throw new Error(`Exercise not found: ${row.choice.exerciseId}`);
      exercise = await withPastedName(existing, row.line.name);
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
      // The Review row says so when this is about to happen (`keepsNumbers`), so it is never silent.
      if (keepsNumbers(line, exercise.kind)) {
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
