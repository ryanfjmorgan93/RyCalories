import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_VERSION, exportBackup, importBackup, isBackup, tablesInBackup, type Backup } from './backup';
import { db } from './db';
import { nextSessionPlan } from './planQueries';
import { buildSummary, resetToSeed, sessionDetail, startSession, wipeAll } from './repo';
import { SEED_EXERCISE_IDS, SEED_EXERCISES, SEED_ROUTINE_IDS } from './seed';
import { fromPer100 } from '@/domain/food';
import { DEFAULT_SETTINGS, type Meal, type MealItem, type Recipe } from '@/domain/types';

const MEAL: Meal = { id: 'm1', date: '2026-03-01', loggedAt: '2026-03-01T08:00:00.000Z', name: 'Porridge', slot: 'breakfast' };
const ITEM: MealItem = {
  id: 'mi1',
  mealId: 'm1',
  index: 0,
  name: 'Oats',
  portion: '80 g',
  source: 'label',
  nutrition: fromPer100({ kcal: 379, protein: 11, carbs: 60, fat: 8 }, 80),
};
const RECIPE: Recipe = {
  id: 'r1',
  name: 'Omelette',
  ingredients: [
    { id: 'ri1', name: 'Eggs', source: 'table', grams: 150, per100: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 }, unit: { count: 3, unitGrams: 50, label: 'egg', plural: 'eggs' } },
  ],
  portionsMade: 1,
  createdAt: '2026-03-01T08:00:00.000Z',
  updatedAt: '2026-03-01T08:00:00.000Z',
};

async function seedNutrition(): Promise<void> {
  await db.meals.put(MEAL);
  await db.mealItems.put(ITEM);
}

/** A backup taken before nutrition existed: no meal tables at all. */
function versionOneBackup(): Backup {
  return {
    app: 'iron',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    tables: {
      exercises: [],
      routines: [],
      routineExercises: [],
      sessions: [],
      setLogs: [],
      decisions: [],
      bodyweight: [],
      settings: [],
    },
  };
}

/** A backup taken after nutrition existed but before recipes did: no `recipes` key at all. */
function versionTwoBackup(): Backup {
  return {
    ...versionOneBackup(),
    version: 2,
    tables: { ...versionOneBackup().tables, meals: [], mealItems: [], foods: [], productCache: [], phases: [] },
  };
}

beforeEach(async () => {
  await resetToSeed();
});

describe('backup covers every table', () => {
  it('round-trips nutrition rows', async () => {
    await seedNutrition();
    const backup = await exportBackup();
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.tables.meals).toHaveLength(1);

    await wipeAll();
    expect(await db.meals.count()).toBe(0);

    await importBackup(backup, 'replace');
    expect(await db.meals.get('m1')).toEqual(MEAL);
    // The union survives the JSON round trip, so weight and macros still cannot disagree.
    expect((await db.mealItems.get('mi1'))?.nutrition).toEqual(ITEM.nutrition);
  });

  it('restoring the same file twice changes nothing', async () => {
    await seedNutrition();
    const backup = await exportBackup();
    await importBackup(backup, 'merge');
    await importBackup(backup, 'merge');
    expect(await db.meals.count()).toBe(1);
    expect(await db.mealItems.count()).toBe(1);
  });

  it('round-trips recipe rows', async () => {
    await db.recipes.put(RECIPE);
    const backup = await exportBackup();
    expect(backup.tables.recipes).toHaveLength(1);

    await wipeAll();
    expect(await db.recipes.count()).toBe(0);

    await importBackup(backup, 'replace');
    // The embedded ingredient — including its unit — survives the JSON round trip whole.
    expect(await db.recipes.get('r1')).toEqual(RECIPE);
  });
});

describe('restoring an older backup', () => {
  // The regression this guards: replace-mode used to clear every table and repopulate only the
  // ones the file carried, so restoring a workouts-only backup destroyed all nutrition data
  // while the restore sheet reported success.
  it('leaves nutrition alone when the file predates it', async () => {
    await seedNutrition();
    const counts = await importBackup(versionOneBackup(), 'replace');

    expect(await db.meals.count()).toBe(1);
    expect(await db.mealItems.get('mi1')).toEqual(ITEM);
    // And it does not claim to have restored tables it never held.
    expect(counts.meals).toBeUndefined();
  });

  // Same rule, one table younger: a v2 file (nutrition, no recipes) restoring in replace mode must
  // not wipe recipes it was never taken with — recipes follow the exact pattern nutrition itself
  // set when it was the new table restoring over an older (v1) file.
  it('leaves recipes alone when the file predates them', async () => {
    await db.recipes.put(RECIPE);
    const counts = await importBackup(versionTwoBackup(), 'replace');

    expect(await db.recipes.count()).toBe(1);
    expect(await db.recipes.get('r1')).toEqual(RECIPE);
    expect(counts.recipes).toBeUndefined();
    // The v2 file's own (empty) tables still restore normally alongside the untouched recipe.
    expect(await db.meals.count()).toBe(0);
  });

  it('a version 1 file also leaves recipes alone', async () => {
    await db.recipes.put(RECIPE);
    await importBackup(versionOneBackup(), 'replace');
    expect(await db.recipes.get('r1')).toEqual(RECIPE);
  });

  it('still clears the tables it can actually put back', async () => {
    expect(await db.exercises.count()).toBeGreaterThan(0);
    await importBackup(versionOneBackup(), 'replace');
    expect(await db.exercises.count()).toBe(0);
  });

  it('leaves the app seeded even when the file carries no settings row', async () => {
    await importBackup(versionOneBackup(), 'replace');
    expect(await db.settings.get('settings')).toBeTruthy();
  });
});

describe('restoring an old-shaped backup (WP3)', () => {
  // A backup taken before Exercise.equipment/demo/standard, RoutineExercise.supersetId,
  // Session.deload/swaps and Settings.seedVersion 2 existed. Old-shaped rows are missing the
  // fields entirely (not just empty), which is what a real pre-migration export looks like.
  function preMigrationBackup(): Backup {
    return {
      app: 'iron',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      tables: {
        exercises: SEED_EXERCISES.map((e) => {
          const { equipment: _equipment, demo: _demo, standard: _standard, ...rest } = e;
          return { ...rest, createdAt: '2026-01-01T00:00:00.000Z' };
        }),
        routines: [],
        routineExercises: [],
        sessions: [],
        setLogs: [],
        decisions: [],
        bodyweight: [],
        settings: [{ ...DEFAULT_SETTINGS, id: 'settings', seedVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' }],
      },
    };
  }

  it('buildSummary, sessionDetail and nextSessionPlan do not throw afterwards', async () => {
    await importBackup(preMigrationBackup(), 'replace');
    const routineId = SEED_ROUTINE_IDS['Lower (Hinge)'];
    const rdl = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];

    // The restore left no routines/routine-exercises (this old-shaped fixture carries none), so
    // rebuild the ones under test directly rather than depending on ensureSeeded to have run.
    await db.routines.put({ id: routineId, name: 'Lower (Hinge)', order: 0, isLowerBody: true });
    const rxId = 'rx-1';
    await db.routineExercises.put({
      id: rxId,
      routineId,
      exerciseId: rdl,
      order: 0,
      targetSets: 4,
      repMin: 6,
      repMax: 8,
      currentWeight: 110,
      increment: 5,
      mode: 'normal',
      optional: false,
    });

    const settings = (await db.settings.get('settings'))!;
    await expect(nextSessionPlan(routineId, settings)).resolves.toBeTruthy();

    const session = await startSession(routineId);
    await db.setLogs.put({
      id: 'set-1',
      sessionId: session.id,
      routineExerciseId: rxId,
      exerciseId: rdl,
      index: 0,
      type: 'working',
      weight: 110,
      reps: 8,
      completedAt: '2026-01-02T00:00:00.000Z',
    });
    await expect(buildSummary(session.id)).resolves.toBeTruthy();
    await expect(sessionDetail(session.id)).resolves.toBeTruthy();
  });
});

describe('backup validation', () => {
  it('accepts what this build wrote', async () => {
    expect(isBackup(await exportBackup())).toBe(true);
    expect(isBackup(versionOneBackup())).toBe(true);
  });

  it('accepts versions 1 through 3', () => {
    expect(isBackup({ ...versionOneBackup(), version: 1 })).toBe(true);
    expect(isBackup(versionTwoBackup())).toBe(true);
    expect(isBackup({ ...versionTwoBackup(), version: 3, tables: { ...versionTwoBackup().tables, recipes: [] } })).toBe(true);
  });

  it('refuses a file from a newer build rather than silently dropping its tables', () => {
    expect(isBackup({ ...versionOneBackup(), version: BACKUP_VERSION + 1 })).toBe(false);
  });

  it('refuses anything that is not an Iron backup', () => {
    expect(isBackup(null)).toBe(false);
    expect(isBackup({ app: 'hevy', version: 1, tables: {} })).toBe(false);
    expect(isBackup({ app: 'iron', version: 1 })).toBe(false);
  });

  it('reports only the tables a file actually carries', () => {
    expect(tablesInBackup(versionOneBackup())).not.toContain('meals');
    expect(tablesInBackup(versionOneBackup())).toContain('sessions');
    expect(tablesInBackup(versionTwoBackup())).not.toContain('recipes');
    expect(tablesInBackup(versionTwoBackup())).toContain('meals');
  });
});
