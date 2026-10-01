import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addCatalogueExercise, addDemoExercise } from './catalogueRepo';
import { createExercise, resetToSeed } from './repo';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS, findDemo } from '@/data/exerciseDemos';
import { normaliseName } from '@/domain/exerciseMatch';
import { buildExerciseList, filterExerciseList, listCounts, type ExerciseListRow } from '@/domain/library';
import type { CatalogueEntry } from '@/domain/catalogue';

/** The list the Exercises screen shows, built from what is really in the database and in the bundled data. */
async function list(): Promise<{ rows: ExerciseListRow[]; entries: CatalogueEntry[] }> {
  const entries = await loadCatalogue();
  return { rows: buildExerciseList({ owned: await db.exercises.toArray(), demos: EXERCISE_DEMOS, entries }), entries };
}

beforeEach(async () => {
  await resetToSeed();
});

describe('the exercise list over the real seed, diagrams and catalogue', () => {
  it('has the owner\'s exercises and every diagram and catalogue entry they do not already have', async () => {
    const { rows, entries } = await list();
    const seeded = await db.exercises.toArray();
    const counts = listCounts(rows);

    expect(counts.owned).toBe(seeded.length);
    // Each seeded exercise carries one diagram of the bundle, and that diagram is not listed a second time.
    const seededDiagrams = seeded.filter((e) => e.demo !== undefined && findDemo(e.demo) !== undefined).length;
    expect(seededDiagrams).toBeGreaterThan(0);
    expect(counts.library).toBe(EXERCISE_DEMOS.length + entries.length - seededDiagrams);
    // More than the 27 the screen used to show, with nothing typed.
    expect(rows.length).toBeGreaterThan(seeded.length + 700);
  });

  it('lists nothing twice: no key, no picture and no name appears on two rows', async () => {
    const { rows } = await list();
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const pictures = rows.flatMap((r) => (r.pictureKey ? [r.pictureKey] : []));
    expect(new Set(pictures).size).toBe(pictures.length);
    const named = rows.map((r) => normaliseName(r.name));
    expect(new Set(named).size).toBe(named.length);
  });

  it('puts every one of the owner\'s rows ahead of every library row', async () => {
    const { rows } = await list();
    const firstLibrary = rows.findIndex((r) => !r.owned);
    expect(firstLibrary).toBeGreaterThan(0);
    expect(rows.slice(firstLibrary).every((r) => !r.owned)).toBe(true);
    expect(rows.slice(0, firstLibrary).every((r) => r.owned)).toBe(true);
  });

  it('finds library rows for a muscle the seed has none of, and for a search', async () => {
    const { rows } = await list();
    const rear = filterExerciseList(rows, { muscle: 'rear delts' });
    expect(rear.length).toBeGreaterThan(5);
    expect(rear.every((r) => (r.muscleGroup ?? 'other') === 'rear delts')).toBe(true);
    expect(rear.some((r) => !r.owned)).toBe(true);
    const found = filterExerciseList(rows, { query: 'cable crossover' });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((r) => r.entry !== undefined)).toBe(true);
  });

  it('moves an entry from the library to the owner\'s when it is added, by one each way, and not again when added twice', async () => {
    const before = await list();
    const target = before.rows.find((r) => r.entry && r.muscleGroup === 'rear delts')!;
    const was = listCounts(before.rows);

    const added = await addCatalogueExercise(target.entry!);
    await addCatalogueExercise(target.entry!);
    const after = await list();

    expect(listCounts(after.rows)).toEqual({ owned: was.owned + 1, library: was.library - 1 });
    expect(after.rows.filter((r) => r.pictureKey === target.pictureKey)).toHaveLength(1);
    const now = after.rows.find((r) => r.pictureKey === target.pictureKey)!;
    expect(now.owned).toBe(true);
    expect(now.exercise!.id).toBe(added.id);
    // It is listed among the owner's, ahead of the library.
    expect(after.rows.indexOf(now)).toBeLessThan(after.rows.findIndex((r) => !r.owned));
  });

  it('does the same for a bundled diagram', async () => {
    const before = await list();
    const target = before.rows.find((r) => r.demo && r.key === 'arnold-press')!;
    const was = listCounts(before.rows);

    await addDemoExercise(target.demo!);
    const after = await list();

    expect(listCounts(after.rows)).toEqual({ owned: was.owned + 1, library: was.library - 1 });
    expect(after.rows.find((r) => r.key === 'arnold-press')).toBeUndefined();
    expect(after.rows.filter((r) => r.pictureKey === 'arnold-press' && r.owned)).toHaveLength(1);
  });

  it('takes an entry off the library when the owner makes an exercise of the same name by hand', async () => {
    const before = await list();
    const target = before.rows.find((r) => r.entry)!;
    const was = listCounts(before.rows);

    await createExercise({ name: target.name.toUpperCase(), kind: 'reps', muscleGroup: 'other', isCompound: false, isLowerBody: false, defaultRestSec: 75, defaultIncrement: 2.5, unilateral: false });
    const after = await list();

    expect(listCounts(after.rows)).toEqual({ owned: was.owned + 1, library: was.library - 1 });
    expect(after.rows.some((r) => !r.owned && r.key === target.key)).toBe(false);
  });
});
