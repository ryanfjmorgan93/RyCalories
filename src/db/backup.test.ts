import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_VERSION, exportBackup, importBackup, isBackup, tablesInBackup, type Backup } from './backup';
import { db } from './db';
import { resetToSeed, wipeAll } from './repo';
import { fromPer100 } from '@/domain/food';
import type { Meal, MealItem } from '@/domain/types';

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

describe('backup validation', () => {
  it('accepts what this build wrote', async () => {
    expect(isBackup(await exportBackup())).toBe(true);
    expect(isBackup(versionOneBackup())).toBe(true);
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
  });
});
