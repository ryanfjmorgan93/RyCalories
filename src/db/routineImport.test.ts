import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { resetToSeed, routineItems } from './repo';
import { guessExerciseFromName, saveParsedRoutine, saveParsedRoutines, type ImportRow } from './routineImport';
import { SEED_EXERCISE_IDS } from './seed';
import type { ParsedRoutineLine } from '@/domain/routineText';

const BENCH_PRESS = SEED_EXERCISE_IDS['Bench Press (Barbell)'];
const BACK_SQUAT = SEED_EXERCISE_IDS['Barbell Back Squat'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];

/** A minimal parsed line, defaulting to a plain "no numbers" exercise. */
function line(name: string, patch: Partial<ParsedRoutineLine> = {}): ParsedRoutineLine {
  return { raw: name, name, ...patch };
}

describe('saveParsedRoutine', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('throws on zero rows', async () => {
    await expect(saveParsedRoutine('Empty', [])).rejects.toThrow();
  });

  it('saves the routine and one routine-exercise per row, in order', async () => {
    const rows: ImportRow[] = [
      { line: line('Bench press', { sets: 4, repMin: 6, repMax: 8, weightKg: 80 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line('Back squat', { sets: 5, repMin: 5, repMax: 5, weightKg: 100 }), choice: { kind: 'existing', exerciseId: BACK_SQUAT } },
    ];
    const routine = await saveParsedRoutine('Upper A', rows);
    expect(routine.name).toBe('Upper A');
    const items = await routineItems(routine.id);
    expect(items).toHaveLength(2);
    expect(items[0]!.exercise.id).toBe(BENCH_PRESS);
    expect(items[0]!.rx.order).toBe(0);
    expect(items[0]!.rx).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8, mode: 'normal', currentWeight: 80 });
    expect(items[1]!.exercise.id).toBe(BACK_SQUAT);
    expect(items[1]!.rx.order).toBe(1);
    expect(items[1]!.rx).toMatchObject({ targetSets: 5, repMin: 5, repMax: 5, mode: 'normal', currentWeight: 100 });
  });

  it('creates a new exercise for a "new" row with guessed fields, and links to it', async () => {
    const rows: ImportRow[] = [{ line: line('Cable Face Pulls', { sets: 3, repMin: 12, repMax: 15 }), choice: { kind: 'new' } }];
    const routine = await saveParsedRoutine('Pull day', rows);
    const items = await routineItems(routine.id);
    expect(items).toHaveLength(1);
    const exercise = items[0]!.exercise;
    expect(exercise.name).toBe('Cable Face Pulls');
    expect(exercise.aliases).toEqual(['Cable Face Pulls']);
    expect(exercise.muscleGroup).toBe('upper back');
    expect(exercise.kind).toBe('reps');
    expect(exercise.createdAt).toBeTruthy();
    expect(exercise.id).not.toBe(BENCH_PRESS);
    // It's a real row in the exercise table, not just an in-memory guess.
    expect(await db.exercises.get(exercise.id)).toBeTruthy();
  });

  it('guessExerciseFromName mirrors hevy.ts guessing: carry, timed and bodyweight_plus by name/opts', () => {
    expect(guessExerciseFromName('Farmers walk').kind).toBe('carry');
    expect(guessExerciseFromName('Plank', { timed: true }).kind).toBe('timed');
    expect(guessExerciseFromName('Weighted pull up').kind).toBe('bodyweight_plus');
    expect(guessExerciseFromName('Bench press').kind).toBe('reps');
  });

  it('learns the pasted name as an alias on a chosen existing exercise exactly once, not duplicated', async () => {
    const rows: ImportRow[] = [
      { line: line('Flat bench', { sets: 4, repMin: 6, repMax: 8 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line('Flat bench', { sets: 3, repMin: 8, repMax: 10 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
    ];
    await saveParsedRoutine('Push', rows);
    const exercise = (await db.exercises.get(BENCH_PRESS))!;
    expect(exercise.aliases?.filter((a) => a === 'Flat bench')).toHaveLength(1);
  });

  it('does not learn an alias that already matches the exercise\'s own name or an existing alias', async () => {
    const rows: ImportRow[] = [{ line: line('Bench Press (Barbell)'), choice: { kind: 'existing', exerciseId: BENCH_PRESS } }];
    await saveParsedRoutine('Push', rows);
    const exercise = (await db.exercises.get(BENCH_PRESS))!;
    expect(exercise.aliases ?? []).toEqual([]);
  });

  it('weightKg > 0 → mode normal at that weight; no weight → mode calibrating at 0', async () => {
    const rows: ImportRow[] = [
      { line: line('Bench press', { weightKg: 62.5 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line('Back squat'), choice: { kind: 'existing', exerciseId: BACK_SQUAT } },
    ];
    const routine = await saveParsedRoutine('Push', rows);
    const items = await routineItems(routine.id);
    const bench = items.find((i) => i.exercise.id === BENCH_PRESS)!;
    const squat = items.find((i) => i.exercise.id === BACK_SQUAT)!;
    expect(bench.rx).toMatchObject({ mode: 'normal', currentWeight: 62.5 });
    expect(squat.rx).toMatchObject({ mode: 'calibrating', currentWeight: 0 });
  });

  it('a seconds line on a new timed exercise writes the seconds as repMin/repMax', async () => {
    const rows: ImportRow[] = [{ line: line('Plank', { sets: 3, repMin: 45, repMax: 45, seconds: true }), choice: { kind: 'new' } }];
    const routine = await saveParsedRoutine('Core', rows);
    const items = await routineItems(routine.id);
    expect(items[0]!.exercise.kind).toBe('timed');
    expect(items[0]!.rx).toMatchObject({ repMin: 45, repMax: 45 });
  });

  it('a seconds line landing on a non-timed exercise keeps that exercise\'s default reps, ignoring the numbers', async () => {
    // Bench Press (Barbell) is kind 'reps', not 'timed' — a pasted "3x30s" against it (e.g. the
    // owner picked the wrong candidate, or matched a real exercise that doesn't take a timed set)
    // must not write 30 reps onto it.
    const bench = (await db.exercises.get(BENCH_PRESS))!;
    expect(bench.kind).not.toBe('timed');
    const rows: ImportRow[] = [{ line: line('Bench press', { sets: 3, repMin: 30, repMax: 30, seconds: true }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } }];
    const routine = await saveParsedRoutine('Push', rows);
    const items = await routineItems(routine.id);
    expect(items[0]!.rx.repMin).not.toBe(30);
    expect(items[0]!.rx).toMatchObject({ repMin: bench.isCompound ? 6 : 10, repMax: bench.isCompound ? 8 : 12 });
  });

  it('isLowerBody follows the majority of the routine\'s exercises', async () => {
    // Two lower-body (squat, RDL) against one upper (bench) → lower body wins.
    const lowerMajority: ImportRow[] = [
      { line: line('Back squat'), choice: { kind: 'existing', exerciseId: BACK_SQUAT } },
      { line: line('Romanian deadlift'), choice: { kind: 'existing', exerciseId: RDL } },
      { line: line('Bench press'), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
    ];
    const lower = await saveParsedRoutine('Lower', lowerMajority);
    expect(lower.isLowerBody).toBe(true);

    const upperMajority: ImportRow[] = [
      { line: line('Bench press'), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line('Overhead press'), choice: { kind: 'new' } },
      { line: line('Back squat'), choice: { kind: 'existing', exerciseId: BACK_SQUAT } },
    ];
    const upper = await saveParsedRoutine('Upper', upperMajority);
    expect(upper.isLowerBody).toBe(false);
  });

  it('is atomic: a row naming an unknown existing exerciseId rolls back everything, including earlier rows in the same call', async () => {
    const routinesBefore = await db.routines.count();
    const exercisesBefore = await db.exercises.count();

    const rows: ImportRow[] = [
      { line: line('Brand new lift'), choice: { kind: 'new' } },
      { line: line('Ghost exercise'), choice: { kind: 'existing', exerciseId: 'does-not-exist' } },
    ];
    await expect(saveParsedRoutine('Broken', rows)).rejects.toThrow();

    expect(await db.routines.count()).toBe(routinesBefore);
    expect(await db.exercises.count()).toBe(exercisesBefore);
    expect(await db.exercises.where('name').equals('Brand new lift').count()).toBe(0);
    const routines = await db.routines.toArray();
    expect(routines.some((r) => r.name === 'Broken')).toBe(false);
  });

  it('saves every routine of one paste together: a failure in the second leaves the first unwritten', async () => {
    const routinesBefore = await db.routines.count();
    const good: ImportRow[] = [{ line: line('Bench press', { sets: 3 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } }];
    const bad: ImportRow[] = [{ line: line('Ghost'), choice: { kind: 'existing', exerciseId: 'does-not-exist' } }];
    await expect(saveParsedRoutines([{ name: 'Day 1', rows: good }, { name: 'Day 2', rows: bad }])).rejects.toThrow();
    expect(await db.routines.count()).toBe(routinesBefore);
    expect((await db.routines.toArray()).some((r) => r.name === 'Day 1')).toBe(false);
  });

  it('an unknown name added as new on two days becomes one new exercise, used by both', async () => {
    const saved = await saveParsedRoutines([
      { name: 'Day 1', rows: [{ line: line('Landmine press', { sets: 3, repMin: 10, repMax: 12 }), choice: { kind: 'new' } }] },
      { name: 'Day 2', rows: [{ line: line('landmine  Press', { sets: 2, repMin: 8, repMax: 8 }), choice: { kind: 'new' } }] },
    ]);
    expect(saved).toHaveLength(2);
    expect(await db.exercises.filter((e) => e.name.toLowerCase().startsWith('landmine')).count()).toBe(1);
    const day1 = await routineItems(saved[0]!.id);
    const day2 = await routineItems(saved[1]!.id);
    expect(day1[0]!.exercise.id).toBe(day2[0]!.exercise.id);
    expect(day2[0]!.rx.targetSets).toBe(2);
  });
});
