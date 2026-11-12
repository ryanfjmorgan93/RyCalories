import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { bossBeatenBy, bossesBeaten, ensureBoss, loadBoss, sessionBosses } from './bossQueries';
import { nextSessionPlan } from './planQueries';
import { deleteSet, getSettings, logSet, resetToSeed, startSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { attackFor } from '@/domain/boss';

const SQUAT = SEED_EXERCISE_IDS['Barbell Back Squat'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
// Wednesday 9 September 2026; its week runs Monday 7 to Sunday 13.
const TODAY = '2026-09-09';

/** One session of one lift's working sets ([kg, reps]) at a moment; ended unless `open`. */
async function trained(exerciseId: string, at: string, sets: [number, number][], opts: { open?: boolean; quick?: 'light' } = {}) {
  vi.setSystemTime(new Date(at));
  const rx = (await db.routineExercises.where('exerciseId').equals(exerciseId).first())!;
  const s = await startSession(rx.routineId);
  const ids: string[] = [];
  for (const [weight, reps] of sets) ids.push((await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId, type: 'working', weight, reps })).id);
  await db.sessions.update(s.id, { ...(opts.open ? {} : { endedAt: at }), ...(opts.quick ? { quick: opts.quick } : {}) });
  return { sessionId: s.id, setIds: ids };
}

/** A lift's routine-exercise at a working weight in a 6–8 range, out of calibration. */
async function working(exerciseId: string, kg: number) {
  const rx = (await db.routineExercises.where('exerciseId').equals(exerciseId).first())!;
  await db.routineExercises.update(rx.id, { mode: 'normal', currentWeight: kg, repMin: 6, repMax: 8 });
  return rx;
}

/** Three sessions of 100 × 5 on the squat, the week before: its start is set and 100 × 5 is the boss. */
async function squatStart() {
  for (const day of ['01', '03', '05']) await trained(SQUAT, `2026-09-${day}T18:00:00.000Z`, [[100, 5]]);
  return working(SQUAT, 100);
}

/** Home asking for a boss at a moment (time only moves forward). */
async function pick(at = `${TODAY}T12:00:00.000Z`) {
  vi.setSystemTime(new Date(at));
  await ensureBoss(at.slice(0, 10), await getSettings());
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await resetToSeed();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ensureBoss and loadBoss', () => {
  it('picks nothing before a lift has its start', async () => {
    for (const day of ['01', '03']) await trained(SQUAT, `2026-09-${day}T18:00:00.000Z`, [[100, 5]]);
    await working(SQUAT, 100);
    await pick();
    expect(await db.bosses.count()).toBe(0);
    expect(await loadBoss(TODAY, await getSettings())).toBeNull();
  });

  it('picks the squat once its start is set, with the attack from the plan', async () => {
    const rx = await squatStart();
    await pick();
    expect((await db.bosses.toArray()).map((b) => [b.week, b.exerciseId, b.weight, b.reps])).toEqual([['2026-09-07', SQUAT, 100, 5]]);
    const plan = (await nextSessionPlan(rx.routineId, await getSettings()))!.items.find((i) => i.exercise.id === SQUAT)!;
    const attack = attackFor({ weight: 100, reps: 5 }, { weight: plan.prescription.weight!, repMin: 6, repMax: 8 });
    expect(attack).not.toBeNull();
    const view = (await loadBoss(TODAY, await getSettings()))!;
    expect(view).toMatchObject({ health: 100, beatenBy: null, attack, short: null, bestDate: '2026-09-01' });
    expect(view.exercise.id).toBe(SQUAT);
    expect(view.routine!.id).toBe(rx.routineId);
  });

  it('counts a live session, not a light quick one', async () => {
    await squatStart();
    await pick();
    await trained(SQUAT, '2026-09-10T18:00:00.000Z', [[100, 8]], { quick: 'light' });
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ beatenBy: null, health: 100 });
    // 100 × 6 is 120, over 100 × 5's 116.67, in a session still open.
    await trained(SQUAT, '2026-09-11T18:00:00.000Z', [[100, 6]], { open: true });
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ beatenBy: { weight: 100, reps: 6 }, health: 0 });
  });

  it('moves health on a closer set and un-beats when the beating set is deleted', async () => {
    await squatStart();
    await pick();
    // The floor is the last session's 100 × 5, the boss itself, so 90% of 116.67 (105) stands in.
    // 97.5 × 5 is 113.75: (116.67 − 113.75) ÷ (116.67 − 105) leaves exactly 25%.
    await trained(SQUAT, '2026-09-10T18:00:00.000Z', [[97.5, 5]]);
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ health: 25, beatenBy: null });
    const { setIds } = await trained(SQUAT, '2026-09-11T18:00:00.000Z', [[100, 6]]);
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ health: 0, beatenBy: { weight: 100, reps: 6 } });
    await deleteSet(setIds[0]!);
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ health: 25, beatenBy: null });
  });

  it('picks once when two picks race', async () => {
    await squatStart();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    const settings = await getSettings();
    await Promise.all([ensureBoss(TODAY, settings), ensureBoss(TODAY, settings)]);
    expect(await db.bosses.count()).toBe(1);
  });

  it('brings the next boss after a win, never the same lift twice a week', async () => {
    await squatStart();
    for (const day of ['02', '04', '06']) await trained(RDL, `2026-09-${day}T18:00:00.000Z`, [[100, 5]]);
    await working(RDL, 105);
    // Both bosses are 100 × 5 (116.67). Squat at 100: × 6 is 120, +2.9%; RDL at 105: × 6 is 126, +8%. The squat first.
    await pick();
    expect((await db.bosses.toArray()).map((b) => b.exerciseId)).toEqual([SQUAT]);
    await trained(SQUAT, '2026-09-10T18:00:00.000Z', [[100, 6]]);
    await pick('2026-09-10T19:00:00.000Z');
    expect((await db.bosses.toArray()).sort((a, b) => a.appearedAt.localeCompare(b.appearedAt)).map((b) => b.exerciseId)).toEqual([SQUAT, RDL]);
    await trained(RDL, '2026-09-11T18:00:00.000Z', [[105, 6]]);
    await pick('2026-09-11T19:00:00.000Z');
    expect(await db.bosses.count()).toBe(2);
    const view = (await loadBoss(TODAY, await getSettings()))!;
    expect([view.exercise.id, view.beatenBy]).toEqual([RDL, { weight: 105, reps: 6 }]);
  });

  it('a new week picks a new boss and keeps last week\'s win', async () => {
    await squatStart();
    await pick();
    await trained(SQUAT, '2026-09-10T18:00:00.000Z', [[100, 6]]);
    await working(SQUAT, 100);
    await pick('2026-09-16T12:00:00.000Z');
    expect((await db.bosses.toArray()).sort((a, b) => a.appearedAt.localeCompare(b.appearedAt)).map((b) => [b.week, b.weight, b.reps])).toEqual([
      ['2026-09-07', 100, 5],
      ['2026-09-14', 100, 6],
    ]);
    expect(await bossesBeaten()).toEqual([expect.objectContaining({ name: 'Barbell Back Squat', weight: 100, reps: 5 })]);
  });

  it('keeps the boss without an attack when its lift leaves the routines', async () => {
    await squatStart();
    await pick();
    await db.routines.update(SEED_ROUTINE_IDS['Lower (Squat)'], { archived: true });
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ attack: null, short: null, routine: null, health: 100 });
    await db.exercises.delete(SQUAT);
    expect(await loadBoss(TODAY, await getSettings())).toBeNull();
  });

  it('says when the plan no longer reaches the boss', async () => {
    await squatStart();
    await pick();
    await working(SQUAT, 80);
    expect(await loadBoss(TODAY, await getSettings())).toMatchObject({ attack: null, short: { weight: 80, reps: 8 } });
  });
});

describe('the set that beats the boss', () => {
  it('names the set that beat the boss, once', async () => {
    await squatStart();
    await pick();
    const { sessionId, setIds } = await trained(SQUAT, '2026-09-10T18:00:00.000Z', [[100, 6], [100, 7]]);
    expect((await bossBeatenBy(setIds[0]!))!.exerciseId).toBe(SQUAT);
    expect(await bossBeatenBy(setIds[1]!)).toBeNull();
    expect(await sessionBosses(sessionId)).toEqual([{ name: 'Barbell Back Squat', weight: 100, reps: 5, by: { weight: 100, reps: 6 } }]);
  });
});
