import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addCatalogueExercise, addDemoExercise } from './catalogueRepo';
import { createExercise, resetToSeed } from './repo';
import { SEED_EXERCISES } from './seed';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS, findDemo } from '@/data/exerciseDemos';
import { exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';

let crossover: CatalogueEntry;
let other: CatalogueEntry;

beforeEach(async () => {
  await resetToSeed();
  const all = await loadCatalogue();
  // Two real entries with nothing in common but a word. (Plain "Cable Crossover" is not one: it repeats the bundled Cable Fly and is left out.)
  crossover = all.find((e) => e.slug === 'single-arm-cable-crossover')!;
  other = all.find((e) => e.slug === 'low-cable-crossover')!;
  expect(crossover, 'the catalogue has single-arm-cable-crossover').toBeDefined();
  expect(other, 'the catalogue has low-cable-crossover').toBeDefined();
});

describe('addCatalogueExercise', () => {
  it('creates the exercise once, with the demo key and the defaults the catalogue gives it', async () => {
    const before = await db.exercises.count();
    const e = await addCatalogueExercise(crossover);

    expect(await db.exercises.count()).toBe(before + 1);
    const stored = (await db.exercises.get(e.id))!;
    expect(stored).toEqual(e);
    expect(stored).toMatchObject({ ...exerciseFromCatalogue(crossover), demo: 'cat:single-arm-cable-crossover' });
    // The increment and rest are the ones the mapping chose, not the form's blanks.
    expect(stored.defaultIncrement).toBe(exerciseFromCatalogue(crossover).defaultIncrement);
    expect(stored.defaultRestSec).toBe(exerciseFromCatalogue(crossover).defaultRestSec);
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false);
  });

  it('returns the same row the second time, and adds nothing', async () => {
    const first = await addCatalogueExercise(crossover);
    const count = await db.exercises.count();
    const second = await addCatalogueExercise(crossover);

    expect(second.id).toBe(first.id);
    expect(second).toEqual(first);
    expect(await db.exercises.count()).toBe(count);
    expect(await db.exercises.where('name').equals(crossover.name).count()).toBe(1);
  });

  it('makes one row when the same entry is added several times at once', async () => {
    const before = await db.exercises.count();
    const rows = await Promise.all([addCatalogueExercise(crossover), addCatalogueExercise(crossover), addCatalogueExercise(crossover)]);

    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await db.exercises.count()).toBe(before + 1);
  });

  it('returns an exercise the owner already has under the same name, without touching it', async () => {
    const mine = await createExercise({
      name: '  SINGLE-ARM   cable crossover ',
      kind: 'reps',
      muscleGroup: 'chest',
      isCompound: false,
      isLowerBody: false,
      unilateral: false,
      defaultRestSec: 60,
      defaultIncrement: 1.25,
    });
    const count = await db.exercises.count();

    const e = await addCatalogueExercise(crossover);

    expect(e.id).toBe(mine.id);
    expect(await db.exercises.count()).toBe(count);
    // Still what the owner made: no demo key stamped on, no defaults replaced.
    expect(await db.exercises.get(mine.id)).toEqual(mine);
    expect((await db.exercises.get(mine.id))!.demo).toBeUndefined();
  });

  it('returns an exercise that has the entry\'s name as an alias', async () => {
    const mine = await createExercise({
      name: 'Standing Cable Fly',
      aliases: ['Single-Arm Cable Crossover'],
      kind: 'reps',
      muscleGroup: 'chest',
      isCompound: false,
      isLowerBody: false,
      unilateral: false,
      defaultRestSec: 75,
      defaultIncrement: 2.5,
    });
    const count = await db.exercises.count();

    expect((await addCatalogueExercise(crossover)).id).toBe(mine.id);
    expect(await db.exercises.count()).toBe(count);
  });

  it('returns the row that holds the entry\'s picture key even after the owner renamed it', async () => {
    const first = await addCatalogueExercise(crossover);
    await db.exercises.update(first.id, { name: 'My Crossovers' });
    const count = await db.exercises.count();

    const again = await addCatalogueExercise(crossover);

    expect(again.id).toBe(first.id);
    expect(again.name).toBe('My Crossovers');
    expect(await db.exercises.count()).toBe(count);
  });

  it('makes a separate row for a different entry', async () => {
    const a = await addCatalogueExercise(crossover);
    const b = await addCatalogueExercise(other);

    expect(b.id).not.toBe(a.id);
    expect(b.demo).toBe('cat:low-cable-crossover');
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length + 2);
  });

  it('leaves every seeded exercise exactly as it was', async () => {
    const seededBefore = await db.exercises.toArray();
    await addCatalogueExercise(crossover);
    await addCatalogueExercise(other);
    await addCatalogueExercise(crossover);

    for (const row of seededBefore) expect(await db.exercises.get(row.id), row.name).toEqual(row);
    expect(await db.exercises.count()).toBe(seededBefore.length + 2);
  });

  it('adds nothing to routines or sessions', async () => {
    const routines = await db.routineExercises.count();
    const sets = await db.setLogs.count();
    await addCatalogueExercise(crossover);
    expect(await db.routineExercises.count()).toBe(routines);
    expect(await db.setLogs.count()).toBe(sets);
  });
});

describe('addDemoExercise', () => {
  const arnold = () => findDemo('arnold-press')!;

  it('creates the exercise once from a bundled diagram, carrying its slug', async () => {
    const before = await db.exercises.count();
    const e = await addDemoExercise(arnold());

    expect(await db.exercises.count()).toBe(before + 1);
    expect(e).toMatchObject({ name: 'Arnold Press', demo: 'arnold-press', equipment: 'dumbbell', defaultIncrement: 2, defaultRestSec: 75, isCompound: false });
    expect(await db.exercises.get(e.id)).toEqual(e);
  });

  it('returns the same row the second time, and adds nothing', async () => {
    const first = await addDemoExercise(arnold());
    const count = await db.exercises.count();
    const second = await addDemoExercise(arnold());

    expect(second.id).toBe(first.id);
    expect(await db.exercises.count()).toBe(count);
  });

  it('makes one row when the same diagram is added several times at once', async () => {
    const before = await db.exercises.count();
    const rows = await Promise.all([addDemoExercise(arnold()), addDemoExercise(arnold())]);

    expect(rows[0].id).toBe(rows[1].id);
    expect(await db.exercises.count()).toBe(before + 1);
  });

  it('returns the seeded exercise that already carries the diagram, without a second row', async () => {
    const bench = SEED_EXERCISES.find((e) => e.demo === 'bench-press')!;
    const count = await db.exercises.count();

    const e = await addDemoExercise(findDemo('bench-press')!);

    expect(e.id).toBe(bench.id);
    expect(e.name).toBe('Bench Press (Barbell)');
    expect(await db.exercises.count()).toBe(count);
  });

  it('returns an exercise with the same name even when it carries another diagram', async () => {
    const mine = await createExercise({
      name: 'arnold press',
      kind: 'reps',
      muscleGroup: 'shoulders',
      isCompound: false,
      isLowerBody: false,
      unilateral: false,
      defaultRestSec: 75,
      defaultIncrement: 2,
      demo: 'seated-dumbbell-press',
    });
    const count = await db.exercises.count();

    expect((await addDemoExercise(arnold())).id).toBe(mine.id);
    expect(await db.exercises.count()).toBe(count);
  });

  it('does not treat a diagram and a catalogue entry as the same exercise', async () => {
    const d = await addDemoExercise(arnold());
    const c = await addCatalogueExercise(crossover);
    expect(c.id).not.toBe(d.id);
  });

  it('adds each of forty bundled diagrams once, however many times they are added again', async () => {
    const demos = EXERCISE_DEMOS.slice(0, 40);
    const first: string[] = [];
    for (const d of demos) first.push((await addDemoExercise(d)).id);
    const count = await db.exercises.count();

    for (const [i, d] of demos.entries()) expect((await addDemoExercise(d)).id, d.slug).toBe(first[i]);
    expect(await db.exercises.count()).toBe(count);
  });
});
