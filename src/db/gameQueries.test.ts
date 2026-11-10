import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { foodDays, loadGame, sessionGame } from './gameQueries';
import { addMeal } from './foodRepo';
import { trendWindow } from './trendQueries';
import { fromPortion } from '@/domain/food';
import { levelChange } from './recordsQueries';
import { getSettings, logBodyweight, logSet, resetToSeed, startSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import type { Session } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const BACK_EXTENSION = SEED_EXERCISE_IDS['Back Extension']; // bodyweight_plus

/** A session of one exercise's working sets ([kg, reps]) begun on a September day; ended unless `open`. */
async function trained(exerciseId: string, day: number, sets: [number, number][], opts: Partial<Session> & { open?: boolean } = {}) {
  const rx = (await db.routineExercises.where('exerciseId').equals(exerciseId).first())!;
  const s = await startSession(rx.routineId);
  const at = `2026-09-${String(day).padStart(2, '0')}`;
  const { open, ...rest } = opts;
  await db.sessions.update(s.id, { startedAt: `${at}T18:00:00.000Z`, ...(open ? {} : { endedAt: `${at}T19:00:00.000Z` }), ...rest });
  for (const [weight, reps] of sets) await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId, type: 'working', weight, reps });
  return s.id;
}
const ladder = (game: { ladders: { id: string; chips: string[] }[] }, id: string) => game.ladders.find((l) => l.id === id);

beforeEach(async () => {
  await resetToSeed();
});

describe('loadGame: the game as it stands', () => {
  it('is empty before anything is trained', async () => {
    const game = await loadGame();
    expect(game).toMatchObject({ levels: [], total: 0, closest: [] });
    expect(game.ladders.map((l) => [l.id, l.chips])).toEqual([['sessions', []], ['tonnes', []], ['level', []]]);
  });

  it('adds up the levels, names the lift nearest its next one, and holds the barbell marks', async () => {
    for (const day of [1, 3, 5]) await trained(RDL, day, [[100, 8]]);
    const fourth = await trained(RDL, 7, [[111, 8]]);
    // The routine has moved on to 112.5 kg, so the set to hit is named at that weight.
    const rx = (await db.routineExercises.where('exerciseId').equals(RDL).first())!;
    await db.routineExercises.update(rx.id, { currentWeight: 112.5, mode: 'normal' });

    const game = await loadGame();
    // 111 × 8 is 11% over 100 × 8: Level 3, so two levels above 1. Nothing else has a level.
    expect(game.levels.map((l) => [l.exercise.id, l.level.level, l.routine])).toEqual([[RDL, 3, 'Lower (Hinge)']]);
    expect(game.total).toBe(2);
    // Level 4 is at 15%, a size of 145.67: 112.5 × 9 is 146.25, 112.5 × 8 is 142.5.
    expect(game.closest.map((l) => [l.exercise.id, l.level.next])).toEqual([[RDL, { weight: 112.5, reps: 9 }]]);
    expect(ladder(game, `lift:${RDL}`)).toMatchObject({ title: 'Romanian Deadlift (Barbell)', chips: ['60 kg', '80 kg', '100 kg'], next: { toGo: '9 kg to go' } });
    expect(ladder(game, 'sessions')).toMatchObject({ chips: [], next: { toGo: '6 to go' } });
    // Home and the session's own card say the same level.
    expect((await levelChange(RDL, fourth)).to).toMatchObject({ level: game.levels[0]!.level.level, gainPct: game.levels[0]!.level.gainPct });
  });

  it('counts nothing from a session still open, and only the session and the kilos from a light quick one', async () => {
    for (const day of [1, 3, 5, 7]) await trained(RDL, day, [[100, 8]]);
    const before = await loadGame();
    await trained(RDL, 9, [[200, 8]], { quick: 'light' });
    const after = await loadGame();
    expect(after.levels).toEqual(before.levels);
    expect(ladder(after, `lift:${RDL}`)).toEqual(ladder(before, `lift:${RDL}`));
    // Five sessions now, and 4 × 800 + 1,600 kg.
    expect(ladder(after, 'sessions')).toMatchObject({ next: { toGo: '5 to go' } });
    expect(ladder(after, 'tonnes')).toMatchObject({ next: { toGo: '5.2 t to go' } });

    // (Last, because starting a session while one is open hands back the open one.)
    await trained(RDL, 11, [[150, 8]], { open: true });
    expect(await loadGame()).toEqual(after);
  });

  it('keeps a lift that left the routines in the total, but not among the closest', async () => {
    for (const day of [1, 3, 5]) await trained(RDL, day, [[100, 8]]);
    await trained(RDL, 7, [[111, 8]]);
    await db.routines.update(HINGE, { archived: true });
    const game = await loadGame();
    expect(game.total).toBe(2);
    expect(game.closest).toEqual([]);
    expect(game.levels[0]!.routine).toBeNull();
  });

  it('puts the nearest first, three at most, and none whose start is still being set', async () => {
    const lifts = ['Bench Press (Barbell)', 'Barbell Back Squat', 'Romanian Deadlift (Barbell)', 'Lateral Raise'] as const;
    // Each has a start of 100 × 8; the fourth session leaves them 1, 2, 3 and 4% over. A fifth lift has two sessions.
    for (const [i, name] of lifts.entries()) {
      for (const day of [1, 3, 5]) await trained(SEED_EXERCISE_IDS[name], day, [[100, 8]]);
      await trained(SEED_EXERCISE_IDS[name], 7, [[101 + i, 8]]);
    }
    for (const day of [1, 3]) await trained(SEED_EXERCISE_IDS['DB Curl'], day, [[10, 12]]);
    const game = await loadGame();
    expect(game.closest.map((l) => l.exercise.name)).toEqual(['Lateral Raise', 'Romanian Deadlift (Barbell)', 'Barbell Back Squat']);
    expect(game.levels.find((l) => l.exercise.name === 'DB Curl')!.level.startIn).toBe(1);
    expect(game.total).toBe(0);
  });
});

describe('sessionGame: what one session did', () => {
  it('names the badges it added, the highest of a ladder once, and the total level before and with it', async () => {
    const first = await trained(RDL, 1, [[100, 8]]);
    for (const day of [3, 5]) await trained(RDL, day, [[100, 8]]);
    const fourth = await trained(RDL, 7, [[120, 8]]);
    // The first set ever passed 60, 80 and 100 kg at once.
    expect(await sessionGame(first)).toEqual({ badges: ['100 kg Romanian Deadlift (Barbell)'], total: { from: 0, to: 0 } });
    // 120 × 8 is 20% over 100 × 8: Level 5, four levels above 1, and the 120 kg mark.
    expect(await sessionGame(fourth)).toEqual({ badges: ['120 kg Romanian Deadlift (Barbell)'], total: { from: 0, to: 4 } });
    // A later, heavier session is not the fourth's history.
    await trained(RDL, 9, [[140, 8]]);
    expect(await sessionGame(fourth)).toEqual({ badges: ['120 kg Romanian Deadlift (Barbell)'], total: { from: 0, to: 4 } });
    expect(await sessionGame('no-such-session')).toBeNull();
  });

  it('reads a session that is not finished yet with its own sets', async () => {
    for (const day of [1, 3, 5]) await trained(RDL, day, [[100, 8]]);
    const live = await trained(RDL, 7, [[120, 8]], { open: true });
    expect(await sessionGame(live)).toEqual({ badges: ['120 kg Romanian Deadlift (Barbell)'], total: { from: 0, to: 4 } });
  });

  it('counts the tenth session', async () => {
    let last = '';
    for (let day = 1; day <= 10; day++) last = await trained(SEED_EXERCISE_IDS['Lateral Raise'], day, [[8, 12]]);
    expect((await sessionGame(last))!.badges).toEqual(['10 sessions']);
  });

  it('sizes a bodyweight lift with the weigh-in on or before its day, whatever the scale says later', async () => {
    await logBodyweight('2026-08-30', 80);
    for (const day of [1, 3, 5]) await trained(BACK_EXTENSION, day, [[10, 10]]);
    const fourth = await trained(BACK_EXTENSION, 7, [[20, 10]]);
    // Later than any weigh-in the seed holds.
    await logBodyweight('2099-01-01', 40);
    // At 80 kg, 100 against 90 is 11% over: Level 3. At the later 40 kg it is 60 against 50, 20%: Level 5.
    expect((await sessionGame(fourth))!.total).toEqual({ from: 0, to: 2 });
    expect((await loadGame()).total).toBe(4);
  });
});

describe('foodDays: the days behind the two food ladders', () => {
  const ate = (day: number, protein: number) =>
    addMeal({ name: 'Dinner', date: `2026-09-${String(day).padStart(2, '0')}` }, [{ name: 'Food', portion: '1', nutrition: fromPortion({ kcal: 2000, protein, carbs: 0, fat: 0 }) }]);

  it('counts logged days and protein days as Progress does, a leg day held to its higher target', async () => {
    const settings = await getSettings();
    expect([settings.proteinTarget, settings.proteinTargetLegDay]).toEqual([170, 200]);
    await ate(1, 180); // over an ordinary day's 170
    await ate(3, 180); // under a leg day's 200
    await trained(RDL, 3, [[100, 8]]);
    await ate(5, 100);
    await ate(7, 205); // over a leg day's 200
    await trained(RDL, 7, [[100, 8]]);

    const days = await foodDays(settings);
    expect(days).toEqual({ logged: 4, proteinHit: 2 });
    // The same answer the day-by-day trend gives over the same days.
    const { trend } = await trendWindow('2026-09-07', 7, settings);
    expect(days).toEqual({ logged: trend.loggedDays, proteinHit: trend.proteinHit.days });
  });

  it('gives Home the food ladders once a day is logged, and none before', async () => {
    expect((await loadGame()).ladders.map((l) => l.id)).not.toContain('food-days');
    await ate(1, 180);
    const game = await loadGame();
    expect(ladder(game, 'food-days')).toMatchObject({ chips: [] });
    expect(game.ladders.find((l) => l.id === 'protein-days')!.next).toMatchObject({ name: '10 days of protein hit', toGo: '9 to go' });
  });
});
