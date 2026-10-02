import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createExercise, resetToSeed, routineItems } from './repo';
import { saveParsedRoutine, saveParsedRoutines, type ImportRow } from './routineImport';
import { SEED_EXERCISE_IDS } from './seed';
import { loadCatalogue } from '@/data/catalogue';
import { findDemo } from '@/data/exerciseDemos';
import { exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { exerciseFromDemo, type DemoLike } from '@/domain/library';
import type { ParsedRoutineLine } from '@/domain/routineText';

const BENCH_PRESS = SEED_EXERCISE_IDS['Bench Press (Barbell)'];

function line(name: string, patch: Partial<ParsedRoutineLine> = {}): ParsedRoutineLine {
  return { raw: name, name, ...patch };
}

let fly: CatalogueEntry;
let crossover: CatalogueEntry;
let arnold: DemoLike;

beforeEach(async () => {
  await resetToSeed();
  const all = await loadCatalogue();
  // Entries the seed does not carry, read from the real catalogue.
  fly = all.find((e) => e.slug === 'cable-rear-delt-fly') ?? all.find((e) => e.name.toLowerCase().includes('rear delt'))!;
  crossover = all.find((e) => e.slug === 'single-arm-cable-crossover')!;
  arnold = findDemo('arnold-press')!;
  expect(fly, 'the catalogue has a rear delt entry').toBeDefined();
  expect(crossover, 'the catalogue has single-arm-cable-crossover').toBeDefined();
  expect(arnold, 'the diagrams have arnold-press').toBeDefined();
  expect(await db.exercises.where('name').equals(fly.name).count()).toBe(0);
});

const withDemoKey = (key: string) => db.exercises.filter((e) => e.demo === key).toArray();

describe('saveParsedRoutines with a library entry', () => {
  it('makes the exercise from a catalogue entry when the routine is saved, and the routine points at it', async () => {
    const before = await db.exercises.count();
    const routine = await saveParsedRoutine('Pull', [
      { line: line('Bench press', { sets: 3, repMin: 8, repMax: 10, weightKg: 60 }), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line(fly.name, { sets: 3, repMin: 12, repMax: 15 }), choice: { kind: 'catalogue', entry: fly } },
    ]);

    expect(await db.exercises.count()).toBe(before + 1);
    const made = await withDemoKey(`cat:${fly.slug}`);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ ...exerciseFromCatalogue(fly), name: fly.name });
    expect(made[0]!.createdAt).toBeTruthy();
    const items = await routineItems(routine.id);
    expect(items.map((i) => i.exercise.id)).toEqual([BENCH_PRESS, made[0]!.id]);
    expect(items[1]!.rx).toMatchObject({ order: 1, targetSets: 3, repMin: 12, repMax: 15, mode: 'calibrating', currentWeight: 0 });
  });

  it('makes the exercise from a bundled diagram the same way', async () => {
    const before = await db.exercises.count();
    const routine = await saveParsedRoutine('Shoulders', [{ line: line('Arnold press', { sets: 3, repMin: 8, repMax: 10 }), choice: { kind: 'demo', demo: arnold } }]);

    expect(await db.exercises.count()).toBe(before + 1);
    const made = await withDemoKey('arnold-press');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ ...exerciseFromDemo(arnold), name: arnold.name });
    expect((await routineItems(routine.id))[0]!.exercise.id).toBe(made[0]!.id);
  });

  it('saving the same paste twice makes the exercise once, and both routines use it', async () => {
    const rows: ImportRow[] = [{ line: line(fly.name, { sets: 3, repMin: 12, repMax: 15 }), choice: { kind: 'catalogue', entry: fly } }];
    const first = await saveParsedRoutine('Pull A', rows);
    const count = await db.exercises.count();
    const second = await saveParsedRoutine('Pull B', rows);

    expect(await db.exercises.count()).toBe(count);
    expect(await withDemoKey(`cat:${fly.slug}`)).toHaveLength(1);
    expect(await db.exercises.where('name').equals(fly.name).count()).toBe(1);
    const a = (await routineItems(first.id))[0]!.exercise.id;
    const b = (await routineItems(second.id))[0]!.exercise.id;
    expect(b).toBe(a);
  });

  it('one entry on two days of one paste is one exercise', async () => {
    const before = await db.exercises.count();
    const rows = (): ImportRow[] => [{ line: line(fly.name, { sets: 3, repMin: 12, repMax: 15 }), choice: { kind: 'catalogue', entry: fly } }];
    const saved = await saveParsedRoutines([
      { name: 'Day 1', rows: rows() },
      { name: 'Day 2', rows: rows() },
    ]);

    expect(await db.exercises.count()).toBe(before + 1);
    const ids = await Promise.all(saved.map(async (r) => (await routineItems(r.id))[0]!.exercise.id));
    expect(new Set(ids).size).toBe(1);
  });

  it('uses the exercise the owner already has for that movement, by picture key or by name, and makes none', async () => {
    const byKey = await createExercise({ ...exerciseFromCatalogue(fly), name: 'My rear delt thing' });
    const byName = await createExercise({ ...exerciseFromDemo(arnold), demo: undefined });
    const before = await db.exercises.count();

    const routine = await saveParsedRoutine('Mixed', [
      { line: line(fly.name, { sets: 3, repMin: 12, repMax: 15 }), choice: { kind: 'catalogue', entry: fly } },
      { line: line('Arnold press', { sets: 3, repMin: 8, repMax: 10 }), choice: { kind: 'demo', demo: arnold } },
    ]);

    expect(await db.exercises.count()).toBe(before);
    const items = await routineItems(routine.id);
    expect(items.map((i) => i.exercise.id)).toEqual([byKey.id, byName.id]);
  });

  it('learns the pasted wording as an alias of the exercise it made, once, and not when it is the exercise\'s own name', async () => {
    await saveParsedRoutine('A', [{ line: line('Rear delt cable fly', { sets: 3 }), choice: { kind: 'catalogue', entry: fly } }]);
    await saveParsedRoutine('B', [{ line: line('rear delt cable fly', { sets: 3 }), choice: { kind: 'catalogue', entry: fly } }]);
    await saveParsedRoutine('C', [{ line: line(fly.name, { sets: 3 }), choice: { kind: 'catalogue', entry: fly } }]);

    const [made] = await withDemoKey(`cat:${fly.slug}`);
    expect(made!.aliases).toEqual(['Rear delt cable fly']);
  });

  it('writes nothing when a later row fails: the exercise it would have made is not left behind', async () => {
    const before = await db.exercises.count();
    const routines = await db.routines.count();
    await expect(
      saveParsedRoutine('Broken', [
        { line: line(fly.name), choice: { kind: 'catalogue', entry: fly } },
        { line: line('Ghost'), choice: { kind: 'existing', exerciseId: 'no-such-exercise' } },
      ]),
    ).rejects.toThrow();

    expect(await db.exercises.count()).toBe(before);
    expect(await withDemoKey(`cat:${fly.slug}`)).toHaveLength(0);
    expect(await db.routines.count()).toBe(routines);
  });

  it('keeps a mixed routine in the order pasted, with a library row between two of the owner\'s', async () => {
    const routine = await saveParsedRoutine('Order', [
      { line: line('Bench press'), choice: { kind: 'existing', exerciseId: BENCH_PRESS } },
      { line: line(crossover.name), choice: { kind: 'catalogue', entry: crossover } },
      { line: line('Plank'), choice: { kind: 'new' } },
    ]);
    const items = await routineItems(routine.id);
    expect(items.map((i) => i.rx.order)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.exercise.name)).toEqual(['Bench Press (Barbell)', crossover.name, 'Plank']);
  });
});
