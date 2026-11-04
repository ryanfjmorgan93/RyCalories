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
  await db.sessions.clear();
});

describe('refreshGoalTargets', () => {
  it('does nothing without a goal: the targets are the owner\'s own', async () => {
    expect(await refreshGoalTargets(NOW)).toBeNull();
  });

  it('works the targets out from the scan and weigh-in, holds the calories, and judges pace by the goal', async () => {
    await db.bodyScans.put({ id: 's1', date: '2026-11-01', source: 'csv', weightKg: 82, leanMassKg: 67.4, bmrKcal: 1840, importedAt: '2026-11-01T09:00:00Z' });
    await logBodyweight('2026-11-03', 82);
    await saveSettings({ goal: 'recomp' });
    // The lifting is what was logged in the last 4 weeks: an hour, and one left open all night
    // (counted as 3 hours). Not one from 5 weeks ago, and not one the coach filled in (no length).
    await db.sessions.bulkPut([
      { id: 'a', routineId: '', title: 'Push', startedAt: '2026-11-02T18:00:00', endedAt: '2026-11-02T19:00:00', durationSec: 3600 },
      { id: 'b', routineId: '', title: 'Pull', startedAt: '2026-10-20T18:00:00', endedAt: '2026-10-21T06:00:00' },
      { id: 'c', routineId: '', title: 'Legs', startedAt: '2026-09-28T18:00:00', endedAt: '2026-09-28T19:00:00', durationSec: 3600 },
      { id: 'd', routineId: '', title: 'Arms', startedAt: '2026-11-01T12:00:00', endedAt: '2026-11-01T12:00:00', source: 'coach' },
    ]);

    const s = (await refreshGoalTargets(NOW))!;
    // No steps in a browser: 6,000 assumed.
    expect(s.targetsBasis![0]).toContain('6,000 steps a day (assumed: steps not read)');
    expect(s.targetsBasis![0]).toContain('for your 2 sessions in the last 4 weeks (240 min in all).');
    // No food logged, one weigh-in: what the measured figure needs, all of it.
    expect(s.targetsBasis!.at(-1)).toContain(
      'Still needs food logged on 22 of the last 27 days (0 so far), and a weigh-in in the first of the 4 weeks.',
    );
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
    expect(s.targetsBasis).toEqual(['Log a weigh-in and import an InBody scan to estimate the targets, or log food and weigh in for 4 weeks to measure them.']);
  });
});
