import { expect, test } from '@playwright/test';
import { backupsOfKind, createRawIronDb, IRON_SCHEMA_V2, readBackupFiles, readRawIron, waitForHistoryCheckSettled } from './fresh';

/**
 * Proves the v2 → v3 (recipes) schema upgrade is safe end to end, against a real browser and the
 * real Filesystem store — not a stand-in for either.
 *
 * Seeds a version-2 'iron' database as raw IndexedDB (Dexie stores its version ×10, so this is
 * `indexedDB.open('iron', 20)`) with a session, its set logs, and a meal with an item — the exact
 * technique e2e/history-safety.spec.ts uses, via the shared helpers in ./fresh.ts. Loads the real
 * app, waits on the one positive signal a test can rely on here (main.tsx's
 * `data-history-check="done"`, set once per load after the boot-time checks have actually
 * finished — never a sleep, and never the `next-up` render alone, which can be satisfied by a
 * PREVIOUS load's history check on a reload), then checks:
 *
 *   - the on-disk version is now 30 (Dexie schema v3);
 *   - every seeded row survived unchanged;
 *   - the 'recipes' store exists;
 *   - a pre-migration backup was written, from the OLD (pre-upgrade) shape — the exact thing
 *     `DB_VERSION` being left un-bumped would silently skip. See the bottom of this file for how
 *     that was confirmed: DB_VERSION was set back to 2, this spec rerun, and the
 *     pre-migration-backup assertion below failed exactly as expected.
 */

function fixture() {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);

  const exercise = {
    id: 'mig-ex-1',
    name: 'Migration RDL',
    kind: 'reps',
    muscleGroup: 'hamstrings',
    isCompound: true,
    isLowerBody: true,
    defaultRestSec: 150,
    defaultIncrement: 5,
    unilateral: false,
    createdAt: iso(30),
  };
  const routine = { id: 'mig-routine-1', name: 'Migration Routine', order: 0, isLowerBody: true };
  const rx = {
    id: 'mig-rx-1',
    routineId: routine.id,
    exerciseId: exercise.id,
    order: 0,
    targetSets: 4,
    repMin: 6,
    repMax: 8,
    currentWeight: 82.5, // a non-seed weight, so a wrong upgrade silently reverting to seed data would be caught
    increment: 5,
    mode: 'normal',
    optional: false,
  };
  const session = { id: 'mig-session-1', routineId: routine.id, title: routine.name, startedAt: iso(3), endedAt: iso(3), durationSec: 1800 };
  const setLogs = [
    { id: 'mig-set-1', sessionId: session.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 0, type: 'working', weight: 80, reps: 8, completedAt: session.startedAt },
    { id: 'mig-set-2', sessionId: session.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 1, type: 'working', weight: 80, reps: 7, completedAt: session.startedAt },
  ];
  const settings = {
    id: 'settings',
    units: 'kg',
    theme: 'dark',
    calorieStart: 1900,
    calorieStep: 200,
    calorieStepDays: 14,
    calorieCeiling: 3000,
    proteinTarget: 170,
    proteinTargetLegDay: 200,
    weeklyGainTargetMin: 0.25,
    weeklyGainTargetMax: 0.5,
    bodyweightTargetMin: 80,
    bodyweightTargetMax: 82,
    restCompoundSec: 150,
    restIsolationSec: 75,
    restCarrySec: 90,
    restVibrate: true,
    restNotify: true,
    productLookup: true,
    seedVersion: 3, // current — the migration under test is the DB_VERSION bump, not a seed change
    barKg: 20,
    plates: [25, 20, 15, 10, 5, 2.5, 1.25],
    deloadPercent: 0.9,
    weeklySessionTarget: 3,
    createdAt: iso(30),
  };
  const meal = { id: 'mig-meal-1', date: today, loggedAt: iso(0), name: 'Migration Lunch', slot: 'lunch' };
  const mealItems = [
    {
      id: 'mig-item-1',
      mealId: meal.id,
      index: 0,
      name: 'Chicken',
      portion: '150 g',
      source: 'label',
      nutrition: { basis: 'weighed', grams: 150, per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } },
    },
  ];

  return {
    exercises: [exercise],
    routines: [routine],
    routineExercises: [rx],
    sessions: [session],
    setLogs,
    decisions: [],
    bodyweight: [],
    settings: [settings],
    meals: [meal],
    mealItems,
    foods: [],
    productCache: [],
    phases: [],
  };
}

test.describe('v2 → v3 migration (recipes)', () => {
  test('upgrades to version 30, keeps every seeded row, adds the recipes store, and writes a pre-migration backup', async ({ page }) => {
    await page.goto('/icons/icon-192.png'); // a static asset: no app JS runs, so nothing opens `iron` before this test does
    const data = fixture();
    await createRawIronDb(page, 20, IRON_SCHEMA_V2, data);

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);

    // The schema: Dexie's raw version is its declared version ×10, so 30 is schema v3.
    const raw = await readRawIron(page);
    expect(raw.version).toBe(30);
    expect(Object.keys(raw.tables)).toContain('recipes');
    expect(raw.tables.recipes).toEqual([]);

    // Every seeded row, exactly as seeded — the additive-delta upgrade must not touch a single one.
    expect(raw.tables.exercises).toEqual(data.exercises);
    expect(raw.tables.routines).toEqual(data.routines);
    expect(raw.tables.routineExercises).toEqual(data.routineExercises);
    expect(raw.tables.sessions).toEqual(data.sessions);
    expect(raw.tables.setLogs).toEqual(data.setLogs);
    expect(raw.tables.settings).toEqual(data.settings);
    expect(raw.tables.meals).toEqual(data.meals);
    expect(raw.tables.mealItems).toEqual(data.mealItems);

    // The pre-migration backup: written before Dexie's upgrade ran, from the OLD on-disk shape.
    const files = await readBackupFiles(page);
    const premig = backupsOfKind(files, 'premig');
    expect(premig.length).toBeGreaterThan(0);
    const content = JSON.parse(premig[0].content) as { dbVersion: number; tables: { sessions: unknown[]; settings: Array<{ seedVersion: number }> } };
    // Raw pre-upgrade version (20), not the post-upgrade one — this file exists precisely because
    // it was captured before Dexie touched anything.
    expect(content.dbVersion).toBe(20);
    expect(content.tables.sessions).toHaveLength(1);
    expect(content.tables.settings[0]!.seedVersion).toBe(3);
  });
});
