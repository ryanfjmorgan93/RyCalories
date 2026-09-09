import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addMeal } from './foodRepo';
import { getSettings, resetToSeed } from './repo';
import { dayView, legDayFor, wasLegDay } from './todayQueries';
import { SEED_ROUTINE_IDS } from './seed';
import { fromPortion } from '@/domain/food';
import { toDateKey } from '@/domain/dates';
import type { Session } from '@/domain/types';

const TODAY = toDateKey();

/** A finished session on `date` at the given local hour. */
async function session(routineId: string, date: string, hour = 18): Promise<void> {
  const startedAt = new Date(`${date}T00:00:00`);
  startedAt.setHours(hour);
  const row: Session = {
    id: `s-${date}-${hour}`,
    routineId,
    title: 'Session',
    startedAt: startedAt.toISOString(),
    endedAt: startedAt.toISOString(),
  };
  await db.sessions.put(row);
}

beforeEach(async () => {
  // Seeded, because leg-day detection reads the routine behind a session.
  await resetToSeed();
});

describe('leg day detection', () => {
  it('is false with nothing trained', async () => {
    expect(await wasLegDay(TODAY)).toBe(false);
  });

  it('is true for a lower-body routine and false for an upper one', async () => {
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, TODAY);
    expect(await wasLegDay(TODAY)).toBe(true);

    await db.sessions.clear();
    await session(SEED_ROUTINE_IDS['Upper (Push)']!, TODAY);
    expect(await wasLegDay(TODAY)).toBe(false);
  });

  it('finds a late-evening session, whichever side of UTC midnight it fell on', async () => {
    // startedAt is UTC but the day key is local: an 11pm session can be tomorrow in UTC.
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, TODAY, 23);
    expect(await wasLegDay(TODAY)).toBe(true);
  });

  it('finds an early-morning session too', async () => {
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, TODAY, 0);
    expect(await wasLegDay(TODAY)).toBe(true);
  });

  it('does not count a session from another day', async () => {
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, '2026-03-01');
    expect(await wasLegDay(TODAY)).toBe(false);
  });

  it('ignores an imported session with no routine', async () => {
    await session('', TODAY);
    expect(await wasLegDay(TODAY)).toBe(false);
  });
});

describe('which day counts as a leg day', () => {
  it('uses what was actually trained', async () => {
    await session(SEED_ROUTINE_IDS['Lower (Hinge)']!, TODAY);
    expect(await legDayFor(TODAY, TODAY)).toEqual({ legDay: true, basis: 'trained' });
  });

  it('falls back to the planned routine for today before anything is trained', async () => {
    // The target has to be usable at breakfast, before the session it is sized for.
    const planned = await legDayFor(TODAY, TODAY);
    expect(planned.basis).toBe('planned');
    // The seed's first routine is a lower day, so the plan says leg day.
    expect(planned.legDay).toBe(true);
  });

  it('does not let a plan override a session that already happened', async () => {
    await session(SEED_ROUTINE_IDS['Upper (Push)']!, TODAY);
    expect(await legDayFor(TODAY, TODAY)).toEqual({ legDay: false, basis: 'trained' });
  });

  it('never guesses for a past day', async () => {
    expect(await legDayFor('2026-03-01', TODAY)).toEqual({ legDay: false, basis: 'none' });
  });

  it('is not a leg day with no routines at all', async () => {
    await db.routines.clear();
    expect(await legDayFor(TODAY, TODAY)).toEqual({ legDay: false, basis: 'none' });
  });
});

describe('the day view', () => {
  it('raises the protein target on a leg day', async () => {
    const s = await getSettings();
    // No `today` argument: a plain day with nothing trained is not a leg day.
    expect((await dayView(TODAY, s)).proteinTarget).toBe(s.proteinTarget);

    await session(SEED_ROUTINE_IDS['Lower (Squat)']!, TODAY);
    const legDay = await dayView(TODAY, s);
    expect(legDay.legDay).toBe(true);
    expect(legDay.proteinTarget).toBe(s.proteinTargetLegDay);
  });

  it('gives the same answer wherever it is asked, which is the point of it', async () => {
    // Home and Food previously computed this separately and disagreed: Home projected the
    // planned routine, Food read the trained one, so the same day showed two protein targets.
    const s = await getSettings();
    const view = await dayView(TODAY, s, TODAY);
    const direct = await legDayFor(TODAY, TODAY);
    expect(view.legDay).toBe(direct.legDay);
    expect(view.legDayBasis).toBe(direct.basis);
  });

  it('reports what was eaten', async () => {
    await addMeal({ name: 'Lunch' }, [
      { name: 'Chicken and rice', portion: '1 plate', nutrition: fromPortion({ kcal: 600, protein: 50, carbs: 60, fat: 15 }) },
    ]);
    const view = await dayView(TODAY, await getSettings());
    expect(view.eaten.kcal).toBe(600);
    expect(view.eaten.protein).toBe(50);
  });

  it('has no calorie target until the reverse diet has a start date', async () => {
    const s = await getSettings();
    expect(s.calorieStartDate).toBeUndefined();
    expect((await dayView(TODAY, s)).calories).toBeNull();
  });
});
