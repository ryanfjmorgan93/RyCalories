import { expect, test } from '@playwright/test';
import { backupsOfKind, createRawIronDb, IRON_SCHEMA_V6, readBackupFiles, readRawIron, waitForHistoryCheckSettled } from './fresh';

/**
 * Proves the v6 → v7 schema upgrade (weekly bosses) is safe end to end, the same way as
 * e2e/migration-v6.spec.ts one version on: a version-6 'iron' database seeded as raw IndexedDB
 * (raw version 60) with a training history and a problem report, then the real app, then the
 * database read back raw.
 */

function fixture() {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const exercise = { id: 'mig7-ex-1', name: 'Migration Squat', kind: 'reps', muscleGroup: 'quads', isCompound: true, isLowerBody: true, defaultRestSec: 150, defaultIncrement: 5, unilateral: false, createdAt: iso(40) };
  const routine = { id: 'mig7-routine-1', name: 'Migration Routine', order: 0, isLowerBody: true };
  // A non-seed weight, so an upgrade silently reverting to seed data would be caught.
  const rx = { id: 'mig7-rx-1', routineId: routine.id, exerciseId: exercise.id, order: 0, targetSets: 3, repMin: 6, repMax: 8, currentWeight: 92.5, increment: 5, mode: 'normal', optional: false };
  const sessions = [9, 6, 3].map((d, i) => ({ id: `mig7-session-${i}`, routineId: routine.id, title: routine.name, startedAt: iso(d), endedAt: iso(d), durationSec: 1800 }));
  const setLogs = sessions.map((s) => ({ id: `${s.id}-set`, sessionId: s.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 0, type: 'working', weight: 90, reps: 6, completedAt: s.startedAt }));
  const settings = { id: 'settings', units: 'kg', theme: 'dark', calorieStart: 1900, calorieStep: 200, calorieStepDays: 14, calorieCeiling: 3000, proteinTarget: 170, proteinTargetLegDay: 200, weeklyGainTargetMin: 0.25, weeklyGainTargetMax: 0.5, bodyweightTargetMin: 80, bodyweightTargetMax: 82, restCompoundSec: 150, restIsolationSec: 75, restCarrySec: 90, restVibrate: true, restNotify: true, productLookup: true, seedVersion: 3, barKg: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], deloadPercent: 0.9, weeklySessionTarget: 3, createdAt: iso(40) };
  return {
    exercises: [exercise],
    routines: [routine],
    routineExercises: [rx],
    sessions,
    setLogs,
    settings: [settings],
    problemReports: [{ id: 'mig7-report-1', at: iso(2), source: 'coach', summary: 'Migration report', detail: 'Kept across the upgrade' }],
  };
}

test.describe('v6 → v7 migration (weekly bosses)', () => {
  test('upgrades to version 70, keeps every row, adds the bosses store, and writes a pre-migration backup', async ({ page }) => {
    await page.goto('/icons/icon-192.png'); // a static asset: no app JS runs, so nothing opens `iron` before this test does
    const data = fixture();
    await createRawIronDb(page, 60, IRON_SCHEMA_V6, data);

    const before = await readRawIron(page);
    expect(before.version).toBe(60);
    expect(Object.keys(before.tables)).not.toContain('bosses');

    await page.goto('/');
    await waitForHistoryCheckSettled(page);

    const raw = await readRawIron(page);
    expect(raw.version).toBe(70);
    for (const name of Object.keys(data) as (keyof typeof data)[]) {
      expect(raw.tables[name], `table ${name}`).toEqual(data[name]);
    }

    const store = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('iron');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const s = db.transaction('bosses', 'readonly').objectStore('bosses');
      const out = { keyPath: s.keyPath as string, indexes: Array.from(s.indexNames).sort(), unique: s.index('[week+exerciseId]').unique };
      db.close();
      return out;
    });
    expect(store).toEqual({ keyPath: 'id', indexes: ['[week+exerciseId]', 'week'], unique: true });

    const files = await readBackupFiles(page);
    const premig = backupsOfKind(files, 'premig');
    expect(premig.length).toBeGreaterThan(0);
    const content = JSON.parse(premig[0].content) as { dbVersion: number; tables: Record<string, unknown[]> };
    expect(content.dbVersion).toBe(60);
    expect(content.tables.problemReports).toHaveLength(1);
    expect(Object.keys(content.tables)).not.toContain('bosses');
  });
});
