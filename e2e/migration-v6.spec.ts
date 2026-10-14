import { expect, test } from '@playwright/test';
import { backupsOfKind, createRawIronDb, IRON_SCHEMA_V5, readBackupFiles, readRawIron, waitForHistoryCheckSettled } from './fresh';

/**
 * Proves the v5 → v6 schema upgrade (problem reports) is safe end to end, the same way as
 * e2e/migration-v5.spec.ts one version on: a version-5 'iron' database seeded as raw IndexedDB
 * (raw version 50) with rows in every table, the supplement checklist included, then the real app,
 * then the database read back raw.
 */

function fixture() {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  const exercise = {
    id: 'mig6-ex-1',
    name: 'Migration RDL',
    kind: 'reps',
    muscleGroup: 'hamstrings',
    isCompound: true,
    isLowerBody: true,
    defaultRestSec: 150,
    defaultIncrement: 5,
    unilateral: false,
    createdAt: iso(40),
  };
  const routine = { id: 'mig6-routine-1', name: 'Migration Routine', order: 0, isLowerBody: true };
  const rx = {
    id: 'mig6-rx-1',
    routineId: routine.id,
    exerciseId: exercise.id,
    order: 0,
    targetSets: 4,
    repMin: 6,
    repMax: 8,
    currentWeight: 87.5, // a non-seed weight, so an upgrade silently reverting to seed data would be caught
    increment: 5,
    mode: 'normal',
    optional: false,
  };
  const sessions = [
    { id: 'mig6-session-1', routineId: routine.id, title: routine.name, startedAt: iso(9), endedAt: iso(9), durationSec: 1900 },
    { id: 'mig6-session-2', routineId: routine.id, title: routine.name, startedAt: iso(3), endedAt: iso(3), durationSec: 1750, notes: 'Felt strong' },
  ];
  const setLogs = sessions.flatMap((s, i) => [
    { id: `${s.id}-set-1`, sessionId: s.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 0, type: 'working', weight: 82.5 + i * 2.5, reps: 8, rir: 2, completedAt: s.startedAt },
    { id: `${s.id}-set-2`, sessionId: s.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 1, type: 'working', weight: 82.5 + i * 2.5, reps: 7, completedAt: s.startedAt },
  ]);
  const decisions = sessions.map((s, i) => ({
    id: `${s.id}-decision`,
    sessionId: s.id,
    routineExerciseId: rx.id,
    fromWeight: 80 + i * 2.5,
    toWeight: 85 + i * 2.5,
    rule: 'hold',
    accepted: true,
    decidedAt: s.startedAt,
  }));
  const bodyweight = [
    { id: 'mig6-bw-1', date: day(10), kg: 80.4 },
    { id: 'mig6-bw-2', date: day(2), kg: 80.9, note: 'morning' },
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
    createdAt: iso(40),
  };
  const meal = { id: 'mig6-meal-1', date: day(0), loggedAt: iso(0), name: 'Migration Lunch', slot: 'lunch' };
  const mealItems = [
    {
      id: 'mig6-item-1',
      mealId: meal.id,
      index: 0,
      name: 'Chicken',
      portion: '150 g',
      source: 'label',
      nutrition: { basis: 'weighed', grams: 150, per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } },
    },
  ];
  const foods = [
    { id: 'mig6-food-1', key: 'chicken breast', name: 'Chicken breast', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, typicalGrams: 150, source: 'label', lastUsedAt: iso(1), useCount: 4 },
  ];
  const productCache = [{ key: '5000000000017', per100: { kcal: 120, protein: 8, carbs: 14, fat: 3 }, name: 'Migration Beans', fetchedAt: iso(5) }];
  const phases = [{ id: 'mig6-phase-1', kind: 'bulk', startDate: day(30), targetRateKgPerWeek: 0.25 }];
  const recipes = [
    {
      id: 'mig6-recipe-1',
      name: 'Migration Chilli',
      ingredients: [{ id: 'mig6-ing-1', name: 'Beef mince', source: 'label', grams: 500, per100: { kcal: 250, protein: 26, carbs: 0, fat: 17 } }],
      portionsMade: 4,
      createdAt: iso(20),
      updatedAt: iso(20),
    },
  ];

  return {
    exercises: [exercise],
    routines: [routine],
    routineExercises: [rx],
    sessions,
    setLogs,
    decisions,
    bodyweight,
    settings: [settings],
    meals: [meal],
    mealItems,
    foods,
    productCache,
    phases,
    recipes,
    bodyScans: [{ id: 'mig6-scan-1', date: day(14), source: 'csv', weightKg: 80.6, skeletalMuscleKg: 36.2, bodyFatPct: 16.4, importedAt: iso(14) }],
    coachMessages: [{ id: 'mig6-msg-1', at: iso(1), role: 'user', text: 'How was my week?' }],
    coachNotes: [{ id: 'mig6-note-1', createdAt: iso(6), text: 'Left knee twinges on deep squats' }],
    supplements: [{ id: 'mig6-sup-1', name: 'Creatine', dose: '5 g', time: 'any', order: 0, createdAt: iso(8), source: 'owner' }],
    supplementLogs: [{ id: 'mig6-suplog-1', date: day(1), supplementId: 'mig6-sup-1', takenAt: iso(1) }],
  };
}

test.describe('v5 → v6 migration (problem reports)', () => {
  test('upgrades to version 60, keeps every row, adds an empty store, and writes a pre-migration backup', async ({ page }) => {
    await page.goto('/icons/icon-192.png'); // a static asset: no app JS runs, so nothing opens `iron` before this test does
    const data = fixture();
    await createRawIronDb(page, 50, IRON_SCHEMA_V5, data);

    const before = await readRawIron(page);
    expect(before.version).toBe(50);
    expect(Object.keys(before.tables)).not.toContain('problemReports');

    await page.goto('/');
    await waitForHistoryCheckSettled(page);

    const raw = await readRawIron(page);
    expect(raw.version).toBe(60);
    expect(raw.tables.problemReports).toEqual([]);
    for (const name of Object.keys(data) as (keyof typeof data)[]) {
      expect(raw.tables[name], `table ${name}`).toEqual(data[name]);
    }

    const store = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('iron');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const s = db.transaction('problemReports', 'readonly').objectStore('problemReports');
      const out = { keyPath: s.keyPath as string, indexes: Array.from(s.indexNames).sort() };
      db.close();
      return out;
    });
    expect(store).toEqual({ keyPath: 'id', indexes: ['at'] });

    const files = await readBackupFiles(page);
    const premig = backupsOfKind(files, 'premig');
    expect(premig.length).toBeGreaterThan(0);
    const content = JSON.parse(premig[0].content) as { dbVersion: number; tables: Record<string, unknown[]> };
    expect(content.dbVersion).toBe(50);
    expect(content.tables.supplements).toHaveLength(1);
    expect(Object.keys(content.tables)).not.toContain('problemReports');
  });

  test('Settings lists no problem reports on an upgraded install, next to the old history', async ({ page }) => {
    await page.goto('/icons/icon-192.png');
    await createRawIronDb(page, 50, IRON_SCHEMA_V5, fixture());
    await page.goto('/');
    await waitForHistoryCheckSettled(page);
    await page.goto('/settings');
    await expect(page.getByTestId('problem-reports').getByTestId('problem-count')).toHaveText('None recorded.');
    const raw = await readRawIron(page);
    expect(raw.tables.sessions).toHaveLength(2);
    expect(raw.tables.supplementLogs).toHaveLength(1);
  });
});
