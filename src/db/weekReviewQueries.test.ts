import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { finishSession, logBodyweight, logSet, resetToSeed, routineItems, startSession } from './repo';
import { SEED_ROUTINE_IDS } from './seed';
import { loadWeekReviewInput, storeReviewMessage, weekReviewMessage } from './weekReviewQueries';
import { addDays, mondayOf, toDateKey } from '@/domain/dates';
import { DEFAULT_SETTINGS } from '@/domain/types';
import type { CoachMessage, Settings } from '@/domain/types';

const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];

const settings: Settings = { ...DEFAULT_SETTINGS, id: 'settings', createdAt: '2026-01-01T00:00:00.000Z', calorieStartDate: '2026-01-01' };

/** A finished Push session with `sets` working sets of the first exercise, started `daysAgo` days ago at noon. */
async function pushDay(daysAgo: number, sets = 2) {
  const session = await startSession(PUSH);
  const [first] = await routineItems(PUSH);
  for (let i = 0; i < sets; i++) {
    await logSet({ sessionId: session.id, routineExerciseId: first.rx.id, exerciseId: first.exercise.id, type: 'working', weight: 60, reps: 8 });
  }
  await finishSession(session.id, { choices: [] });
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  day.setHours(12, 0, 0, 0);
  const when = day.toISOString();
  await db.sessions.update(session.id, { startedAt: when, endedAt: when });
  for (const s of await db.setLogs.where('sessionId').equals(session.id).toArray()) await db.setLogs.update(s.id, { completedAt: when });
}

describe('loadWeekReviewInput', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('counts the sessions and sets of the seven days before today, by region, and no others', async () => {
    await pushDay(2, 3);
    await pushDay(5, 2);
    await pushDay(8, 4); // before the window
    const input = await loadWeekReviewInput(toDateKey(), settings);
    expect(input.sessions).toHaveLength(2);
    expect(input.sessions.every((s) => s.title === 'Upper (Push)')).toBe(true);
    // The first Push exercise is the bench press: chest.
    expect(input.setsByRegion).toEqual({ Chest: 5 });
    expect(input.trend.sessions).toBe(2);
    expect(input.trend.days).toHaveLength(7);
  });

  it('does not count a session started today', async () => {
    await pushDay(0, 2);
    const input = await loadWeekReviewInput(toDateKey(), settings);
    expect(input.sessions).toHaveLength(0);
    expect(input.setsByRegion).toEqual({});
  });

  it('carries the targets in force and the recent bodyweight', async () => {
    const today = toDateKey();
    await db.bodyweight.clear(); // the seed logs a first reading for today
    await logBodyweight(addDays(today, -7), 82.1);
    await logBodyweight(addDays(today, -60), 79);
    const input = await loadWeekReviewInput(today, settings);
    expect(input.targets.protein).toBe(DEFAULT_SETTINGS.proteinTarget);
    expect(input.targets.proteinLegDay).toBe(DEFAULT_SETTINGS.proteinTargetLegDay);
    expect(input.targets.calories).toBeGreaterThan(0);
    expect(input.bodyweight).toEqual([{ date: addDays(today, -7), kg: 82.1 }]);
  });

  it('has no target for calories until the reverse diet has a start date', async () => {
    const input = await loadWeekReviewInput(toDateKey(), { ...settings, calorieStartDate: undefined });
    expect(input.targets.calories).toBeNull();
  });
});

describe('weekReviewMessage', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  const msg = (id: string, at: Date, moment?: CoachMessage['moment']): CoachMessage => ({ id, at: at.toISOString(), role: 'coach', text: id, moment });

  it('finds the review given this week and ignores other weeks and other moments', async () => {
    const monday = mondayOf(toDateKey());
    const at = (offsetDays: number, hour = 9) => {
      const d = new Date(`${addDays(monday, offsetDays)}T00:00:00`);
      d.setHours(hour);
      return d;
    };
    await db.coachMessages.bulkPut([
      msg('last-week', at(-7), 'week'),
      msg('this-open', at(0), 'open'),
      msg('this-week-early', at(0, 8), 'week'),
      msg('this-week-late', at(3, 18), 'week'),
      msg('next-week', at(7), 'week'),
    ]);
    expect((await weekReviewMessage(monday))?.id).toBe('this-week-late');
  });

  it('is null when the week has none', async () => {
    expect(await weekReviewMessage(mondayOf(toDateKey()))).toBeNull();
  });

  it('storeReviewMessage records a coach message for the week moment, which is then found', async () => {
    const stored = await storeReviewMessage('A good week.');
    expect(stored).toMatchObject({ role: 'coach', text: 'A good week.', moment: 'week' });
    expect((await weekReviewMessage(mondayOf(toDateKey())))?.id).toBe(stored.id);
  });
});
