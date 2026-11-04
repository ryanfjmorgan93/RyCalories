/**
 * @vitest-environment jsdom
 *
 * The goal's targets worked out from the real data (Dexie on fake-indexeddb) and saved.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { getSettings, logBodyweight, resetToSeed, saveSettings } from '@/db/repo';
import { calorieTargetOn } from '@/domain/nutrition';
import { refreshGoalTargets } from './goalTargets';

const NOW = new Date(2026, 10, 4, 9, 0, 0);

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
  await db.bodyScans.clear();
  await db.bodyweight.clear();
});

describe('refreshGoalTargets', () => {
  it('does nothing without a goal: the targets are the owner\'s own', async () => {
    expect(await refreshGoalTargets(NOW)).toBeNull();
  });

  it('works the targets out from the scan and weigh-in, holds the calories, and judges pace by the goal', async () => {
    await db.bodyScans.put({ id: 's1', date: '2026-11-01', source: 'csv', weightKg: 82, leanMassKg: 67.4, bmrKcal: 1840, importedAt: '2026-11-01T09:00:00Z' });
    await logBodyweight('2026-11-03', 82);
    await saveSettings({ goal: 'recomp', weeklySessionTarget: 4 });

    const s = (await refreshGoalTargets(NOW))!;
    // No steps in a browser: 6,000 assumed. 1,840 × 1.35 + 6,000 × 82 × 0.5/1,330 + 4 × 4 × 82 × m/60 / 7.
    expect(s.targetsBasis![0]).toContain('6,000 steps a day (assumed: steps not read)');
    expect(s.proteinTarget).toBe(175);
    expect(s.proteinTargetLegDay).toBe(175);
    expect(s.fatTarget! * 9 + s.proteinTarget * 4 + s.carbTarget! * 4).toBeGreaterThan(s.calorieStart - 25);
    // Held: today and in a month are the same figure.
    expect(calorieTargetOn('2026-11-04', s)!.kcal).toBe(s.calorieStart);
    expect(calorieTargetOn('2026-12-04', s)!.kcal).toBe(s.calorieStart);
    // A recomp's pace: steady, give or take 0.1 kg a week.
    expect([s.weeklyGainTargetMin, s.weeklyGainTargetMax]).toEqual([-0.1, 0.1]);

    // Nothing new: nothing written.
    const before = (await getSettings()).savedAt;
    await refreshGoalTargets(NOW);
    expect((await getSettings()).savedAt).toBe(before);
  });

  it('says what it needs when there is nothing to work from', async () => {
    await saveSettings({ goal: 'recomp' });
    const s = (await refreshGoalTargets(NOW))!;
    expect(s.targetsBasis).toEqual(['Log a weigh-in and import an InBody scan, or log two weeks of food and weigh-ins, to work the targets out.']);
  });
});
