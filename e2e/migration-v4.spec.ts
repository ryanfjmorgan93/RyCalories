import { expect, test } from '@playwright/test';
import { backupsOfKind, createRawIronDb, IRON_SCHEMA_V3, readBackupFiles, readRawIron, waitForHistoryCheckSettled } from './fresh';

/**
 * Proves the v3 → v4 schema upgrade (body scans, coach messages, coach notes) is safe end to end,
 * against a real browser and the real Filesystem store — the same technique as
 * e2e/migration-v3.spec.ts, one version on.
 *
 * Seeds a version-3 'iron' database as raw IndexedDB (Dexie stores its version ×10, so this is
 * `indexedDB.open('iron', 30)`) with real rows in every table a training and food history uses,
 * including the v3 `recipes` store. Loads the real app, waits on the one positive signal a test can
 * rely on here (main.tsx's `data-history-check="done"`, set once per load after the boot-time
 * checks have finished — never a sleep), then checks:
 *
 *   - the on-disk version is the current one (50 since the supplements schema, v5);
 *   - every seeded row survived unchanged, in every table;
 *   - the three new stores exist, with their indexes, and are empty;
 *   - a pre-migration backup was written from the OLD (version 30) shape, before Dexie upgraded.
 *
 * It does not wait on any screen: what the Home screen shows is not what this proves.
 */

function fixture() {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  const exercise = {
    id: 'mig4-ex-1',
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
  const routine = { id: 'mig4-routine-1', name: 'Migration Routine', order: 0, isLowerBody: true };
  const rx = {
    id: 'mig4-rx-1',
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
    { id: 'mig4-session-1', routineId: routine.id, title: routine.name, startedAt: iso(9), endedAt: iso(9), durationSec: 1900 },
    { id: 'mig4-session-2', routineId: routine.id, title: routine.name, startedAt: iso(3), endedAt: iso(3), durationSec: 1750, notes: 'Felt strong' },
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
    { id: 'mig4-bw-1', date: day(10), kg: 80.4 },
    { id: 'mig4-bw-2', date: day(2), kg: 80.9, note: 'morning' },
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
  const meal = { id: 'mig4-meal-1', date: day(0), loggedAt: iso(0), name: 'Migration Lunch', slot: 'lunch' };
  const mealItems = [
    {
      id: 'mig4-item-1',
      mealId: meal.id,
      index: 0,
      name: 'Chicken',
      portion: '150 g',
      source: 'label',
      nutrition: { basis: 'weighed', grams: 150, per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } },
    },
  ];
  const foods = [
    { id: 'mig4-food-1', key: 'chicken breast', name: 'Chicken breast', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, typicalGrams: 150, source: 'label', lastUsedAt: iso(1), useCount: 4 },
  ];
  const productCache = [{ key: '5000000000017', per100: { kcal: 120, protein: 8, carbs: 14, fat: 3 }, name: 'Migration Beans', fetchedAt: iso(5) }];
  const phases = [{ id: 'mig4-phase-1', kind: 'bulk', startDate: day(30), targetRateKgPerWeek: 0.25 }];
  const recipes = [
    {
      id: 'mig4-recipe-1',
      name: 'Migration Chilli',
      ingredients: [{ id: 'mig4-ing-1', name: 'Beef mince', source: 'label', grams: 500, per100: { kcal: 250, protein: 26, carbs: 0, fat: 17 } }],
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
  };
}

test.describe('v3 → v4 migration (body scans, coach messages, coach notes)', () => {
  test('upgrades to version 40, keeps every row, adds three empty stores, and writes a pre-migration backup', async ({ page }) => {
    await page.goto('/icons/icon-192.png'); // a static asset: no app JS runs, so nothing opens `iron` before this test does
    const data = fixture();
    await createRawIronDb(page, 30, IRON_SCHEMA_V3, data);

    // The seeded database really is the old shape before the app touches it.
    const before = await readRawIron(page);
    expect(before.version).toBe(30);
    expect(Object.keys(before.tables)).not.toContain('bodyScans');

    await page.goto('/');
    await waitForHistoryCheckSettled(page);

    // The schema: Dexie's raw version is its declared version ×10; the build upgrades to its current one.
    const raw = await readRawIron(page);
    // The current schema (v6, raw 60): an install this far behind upgrades straight through.
    expect(raw.version).toBe(60);
    for (const name of ['bodyScans', 'coachMessages', 'coachNotes']) {
      expect(Object.keys(raw.tables)).toContain(name);
      expect(raw.tables[name]).toEqual([]);
    }

    // Every seeded row, exactly as seeded, in every table the fixture filled — the additive-delta
    // upgrade must not touch a single one.
    for (const name of Object.keys(data) as (keyof typeof data)[]) {
      expect(raw.tables[name], `table ${name}`).toEqual(data[name]);
    }

    // The new stores carry their indexes (`bodyScans: 'id, date'`, `coachMessages: 'id, at'`,
    // `coachNotes: 'id, createdAt'`), read off the real database rather than assumed.
    const indexes = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('iron');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['bodyScans', 'coachMessages', 'coachNotes'], 'readonly');
      const out: Record<string, { keyPath: string | string[]; indexes: string[] }> = {};
      for (const name of ['bodyScans', 'coachMessages', 'coachNotes']) {
        const store = tx.objectStore(name);
        out[name] = { keyPath: store.keyPath as string, indexes: Array.from(store.indexNames) };
      }
      db.close();
      return out;
    });
    expect(indexes).toEqual({
      bodyScans: { keyPath: 'id', indexes: ['date'] },
      coachMessages: { keyPath: 'id', indexes: ['at'] },
      coachNotes: { keyPath: 'id', indexes: ['createdAt'] },
    });

    // The pre-migration backup: written before Dexie's upgrade ran, from the OLD on-disk shape.
    const files = await readBackupFiles(page);
    const premig = backupsOfKind(files, 'premig');
    expect(premig.length).toBeGreaterThan(0);
    const content = JSON.parse(premig[0].content) as { dbVersion: number; tables: Record<string, unknown[]> };
    // Raw pre-upgrade version (30), not the post-upgrade one — this file exists precisely because
    // it was captured before Dexie touched anything, and so it has no new stores.
    expect(content.dbVersion).toBe(30);
    expect(content.tables.sessions).toHaveLength(2);
    expect(content.tables.setLogs).toHaveLength(4);
    expect(content.tables.recipes).toHaveLength(1);
    expect(Object.keys(content.tables)).not.toContain('bodyScans');
  });

  test('the new stores take writes after the upgrade, and the old rows are still there next to them', async ({ page }) => {
    await page.goto('/icons/icon-192.png');
    const data = fixture();
    await createRawIronDb(page, 30, IRON_SCHEMA_V3, data);
    await page.goto('/');
    await waitForHistoryCheckSettled(page);

    // A write into each new store through the real upgraded database, then a reload: it persists.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('iron');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['bodyScans', 'coachMessages', 'coachNotes'], 'readwrite');
      tx.objectStore('bodyScans').put({ id: 'scan-1', date: '2026-10-01', weightKg: 81.2 });
      tx.objectStore('coachMessages').put({ id: 'msg-1', at: '2026-10-01T10:00:00.000Z', role: 'user', text: 'hi' });
      tx.objectStore('coachNotes').put({ id: 'note-1', createdAt: '2026-10-01T10:00:00.000Z', text: 'left knee niggle' });
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await waitForHistoryCheckSettled(page);

    const raw = await readRawIron(page);
    // The current schema (v6, raw 60): an install this far behind upgrades straight through.
    expect(raw.version).toBe(60);
    expect(raw.tables.bodyScans).toHaveLength(1);
    expect(raw.tables.coachMessages).toHaveLength(1);
    expect(raw.tables.coachNotes).toHaveLength(1);
    expect(raw.tables.sessions).toEqual(data.sessions);
    expect(raw.tables.routineExercises).toEqual(data.routineExercises);
  });
});
