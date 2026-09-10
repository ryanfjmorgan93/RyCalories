import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addMeal } from './foodRepo';
import { getSettings, logBodyweight, resetToSeed, saveSettings } from './repo';
import { trendWindow } from './trendQueries';
import { SEED_ROUTINE_IDS } from './seed';
import { fromPortion } from '@/domain/food';
import { addDays, toDateKey } from '@/domain/dates';
import type { Session } from '@/domain/types';

const TODAY = toDateKey();

async function meal(date: string, kcal: number, protein: number) {
  await addMeal({ name: 'Meal', date }, [
    { name: 'Food', portion: '1', nutrition: fromPortion({ kcal, protein, carbs: 0, fat: 0 }) },
  ]);
}

async function session(routineId: string, date: string, finished = true) {
  const started = new Date(`${date}T00:00:00`);
  started.setHours(18);
  const row: Session = {
    id: `s-${date}`,
    routineId,
    title: 'Session',
    startedAt: started.toISOString(),
    ...(finished ? { endedAt: started.toISOString() } : {}),
  };
  await db.sessions.put(row);
}

beforeEach(async () => {
  await resetToSeed();
});

describe('the trend window', () => {
  it('covers the requested number of days, ending today', async () => {
    const { trend } = await trendWindow(TODAY, 7, await getSettings());
    expect(trend.days).toHaveLength(7);
    expect(trend.to).toBe(TODAY);
    expect(trend.from).toBe(addDays(TODAY, -6));
  });

  it('leaves an unlogged day absent rather than calling it zero', async () => {
    await meal(TODAY, 3000, 200);
    const { trend } = await trendWindow(TODAY, 7, await getSettings());
    expect(trend.loggedDays).toBe(1);
    expect(trend.kcal.value).toBe(3000);
    // Six blank days did not drag the average down to 429.
    expect(trend.kcal.outOf).toBe(7);
  });

  it('sums every meal on a day', async () => {
    await meal(TODAY, 1000, 50);
    await meal(TODAY, 1500, 80);
    const { trend } = await trendWindow(TODAY, 3, await getSettings());
    expect(trend.kcal.value).toBe(2500);
    expect(trend.protein.value).toBe(130);
  });

  it('counts a finished session and ignores one still in progress', async () => {
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, TODAY, true);
    await session(SEED_ROUTINE_IDS['Upper (Push)']!, addDays(TODAY, -1), false);
    const { trend } = await trendWindow(TODAY, 7, await getSettings());
    expect(trend.sessions).toBe(1);
    expect(trend.sessionsPerWeek).toBeCloseTo(1, 6);
  });

  it('raises the protein target on a day that was actually a leg day', async () => {
    const s = await getSettings();
    await meal(TODAY, 3000, 200);
    await session(SEED_ROUTINE_IDS['Lower (Squat)']!, TODAY);
    const { trend } = await trendWindow(TODAY, 3, s);
    expect(trend.days.find((d) => d.date === TODAY)?.proteinTarget).toBe(s.proteinTargetLegDay);
  });

  it('does not project a plan onto a past day', async () => {
    // The day screen falls back to the planned routine for today; a finished day has no plan,
    // only a record, so its target must come from what was trained.
    const s = await getSettings();
    const yesterday = addDays(TODAY, -1);
    await meal(yesterday, 3000, 200);
    const { trend } = await trendWindow(TODAY, 3, s);
    expect(trend.days.find((d) => d.date === yesterday)?.proteinTarget).toBe(s.proteinTarget);
  });

  it('carries the calorie target once the reverse diet has started', async () => {
    await saveSettings({});
    const s = await getSettings();
    await meal(TODAY, 2000, 100);
    const { trend } = await trendWindow(TODAY, 3, s);
    expect(trend.kcalTarget.value).toBe(s.calorieStart);
  });

  it('has no calorie target before Settings has ever been saved', async () => {
    const s = await getSettings();
    expect(s.calorieStartDate).toBeUndefined();
    await meal(TODAY, 2000, 100);
    const { trend } = await trendWindow(TODAY, 3, s);
    expect(trend.kcalTarget.value).toBeNull();
  });

  it('returns the bodyweight readings inside the window, and no others', async () => {
    await db.bodyweight.clear();
    await logBodyweight(TODAY, 80);
    await logBodyweight(addDays(TODAY, -2), 79.5);
    await logBodyweight(addDays(TODAY, -30), 78);
    const { bodyweight } = await trendWindow(TODAY, 7, await getSettings());
    expect(bodyweight.map((b) => b.kg)).toEqual([79.5, 80]);
  });

  it('never asks for fewer than one day', async () => {
    expect((await trendWindow(TODAY, 0, await getSettings())).trend.days).toHaveLength(1);
  });
});
