/**
 * @vitest-environment jsdom
 *
 * Each coach action against the real data code (Dexie on fake-indexeddb, the seeded routines).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { getMeal, mealsOnDay } from '@/db/foodRepo';
import { getActiveSession, listRoutines, logSet, resetToSeed, routineItems, setPlanOverride, startSession } from '@/db/repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from '@/db/seed';
import { toDateKey } from '@/domain/dates';
import { macrosOf } from '@/domain/food';
import { slotForHour } from '@/domain/mealSlot';
import { createCoachActions, findRoutine } from './actions';
import { noteShortId } from './context';

const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const BENCH = SEED_EXERCISE_IDS['Bench Press (Barbell)'];

/** 9 a.m. local on a fixed day. */
const MORNING = () => new Date(2026, 9, 12, 9, 0, 0);
const TODAY = toDateKey(MORNING());

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
  await db.coachNotes.clear();
  await db.coachMessages.clear();
});

async function rxOf(routineName: string, exerciseName: string) {
  const routine = (await listRoutines()).find((r) => r.name === routineName)!;
  return (await routineItems(routine.id)).find((it) => it.exercise.name === exerciseName)!;
}

describe('log_food', () => {
  it('raises a calorie figure the macros contradict, and refuses an impossible amount', async () => {
    const actions = createCoachActions({ now: MORNING });
    // 40 g protein, 30 g carbs and 20 g fat come to about 460 kcal, not 80.
    expect((await actions.logFood({ items: [{ name: 'Shake', amount: 1, unit: 'glass', kcal: 80, protein: 40, carbs: 30, fat: 20 }] })).ok).toBe(true);
    const [{ items }] = await mealsOnDay(TODAY);
    expect(macrosOf(items[0]!.nutrition).kcal).toBeGreaterThan(400);
    // A milligram figure typed as grams.
    expect((await actions.logFood({ items: [{ name: 'Bar', amount: 1, unit: 'bar', kcal: 200, protein: 25000, carbs: 20, fat: 8 }] })).ok).toBe(false);
  });

  it('writes one meal for the slot with its items, as model estimates, weighed when grams are given', async () => {
    const actions = createCoachActions({ now: MORNING });
    const out = await actions.logFood({
      items: [
        { name: 'Wholemeal toast', amount: 2, unit: 'slices', grams: 72, kcal: 170, protein: 7, carbs: 30, fat: 2 },
        { name: 'Scrambled eggs', amount: 3, unit: 'eggs', kcal: 240, protein: 19, carbs: 2, fat: 17 },
      ],
    });
    expect(out.ok).toBe(true);
    expect(out.description).toBe('Logged Wholemeal toast, Scrambled eggs for breakfast (≈410 kcal)');
    expect(out.result).toContain('Today so far: 410 kcal');

    const meals = await mealsOnDay(TODAY);
    expect(meals).toHaveLength(1);
    const { meal, items } = meals[0]!;
    expect(meal).toMatchObject({ name: 'Breakfast', slot: 'breakfast', date: TODAY });
    expect(items.map((i) => i.name)).toEqual(['Wholemeal toast', 'Scrambled eggs']);
    expect(items.every((i) => i.source === 'model')).toBe(true);
    // An amount Claude supplied is an estimate and says so (docs/adr/0004).
    expect(items[0]!.portion).toBe('≈ 2 slices (72 g)');
    expect(items[0]!.nutrition.basis).toBe('weighed');
    expect(macrosOf(items[0]!.nutrition).kcal).toBeCloseTo(170, 6);
    expect(items[1]!.portion).toBe('≈ 3 eggs');
    expect(items[1]!.nutrition.basis).toBe('portion');
  });

  it('guesses the slot from the time of day, and takes the one it is given', async () => {
    expect([slotForHour(7), slotForHour(12), slotForHour(18), slotForHour(22)]).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    const evening = createCoachActions({ now: () => new Date(2026, 9, 12, 19, 30) });
    await evening.logFood({ items: [{ name: 'Chilli', amount: 1, unit: 'bowl', grams: 400, kcal: 520, protein: 32, carbs: 55, fat: 14 }] });
    await evening.logFood({ items: [{ name: 'Apple', amount: 1, unit: 'apple', kcal: 80, protein: 0.4, carbs: 19, fat: 0.2 }], slot: 'snack' });
    const meals = await mealsOnDay(TODAY);
    expect(meals.map((m) => m.meal.slot)).toEqual(['dinner', 'snack']);
  });

  it('treats a weight in grams as the grams', async () => {
    const actions = createCoachActions({ now: MORNING });
    await actions.logFood({ items: [{ name: 'Chicken breast', amount: 150, unit: 'g', kcal: 248, protein: 46, carbs: 0, fat: 5.4 }] });
    const item = (await mealsOnDay(TODAY))[0]!.items[0]!;
    expect(item.portion).toBe('≈ 150 g');
    expect(item.nutrition).toMatchObject({ basis: 'weighed', grams: 150 });
  });

  it('adds to the meal the slot already has instead of making a new meal for every call', async () => {
    const actions = createCoachActions({ now: MORNING });
    await actions.logFood({ items: [{ name: 'Porridge', amount: 1, unit: 'bowl', grams: 300, kcal: 310, protein: 10, carbs: 52, fat: 6 }] });
    await actions.logFood({ items: [{ name: 'Black coffee', amount: 1, unit: 'cup', kcal: 5, protein: 0, carbs: 1, fat: 0 }] });
    const meals = await mealsOnDay(TODAY);
    expect(meals).toHaveLength(1);
    expect(meals[0]!.meal).toMatchObject({ name: 'Breakfast', slot: 'breakfast' });
    expect(meals[0]!.items.map((i) => i.name)).toEqual(['Porridge', 'Black coffee']);
    expect(meals[0]!.items.map((i) => i.index)).toEqual([0, 1]);
  });

  it('keeps the figures of a food the app already knows, as the Describe flow does, and the coach\'s own for the rest', async () => {
    const actions = createCoachActions({ now: MORNING });
    // The UK table's whole raw egg is 131 kcal per 100 g; the coach said 150 for these two.
    const out = await actions.logFood({
      items: [
        { name: 'Egg', amount: 2, unit: 'eggs', grams: 100, kcal: 150, protein: 12, carbs: 1, fat: 10 },
        { name: 'Sourdough toast', amount: 2, unit: 'slices', grams: 80, kcal: 210, protein: 8, carbs: 40, fat: 1 },
      ],
    });
    const { items } = (await mealsOnDay(TODAY))[0]!;
    expect(items.map((i) => i.source)).toEqual(['table', 'model']);
    expect(items[0]!.name).toBe('Eggs, chicken, whole, raw');
    expect(macrosOf(items[0]!.nutrition).kcal).toBeCloseTo(131, 6);
    expect(macrosOf(items[1]!.nutrition).kcal).toBeCloseTo(210, 6);
    // What the coach is told and what the owner sees is what was stored, not what the model guessed.
    expect(out.description).toBe('Logged Eggs, chicken, whole, raw, Sourdough toast for breakfast (≈341 kcal)');
    expect(out.result).toContain('about 341 kcal');
    expect(out.result).toContain('Today so far: 341 kcal');
  });

  it('keeps a food the owner has already remembered at their own figures', async () => {
    await db.foods.put({
      id: 'f1',
      key: 'n:chicken curry',
      name: 'Chicken curry',
      per100: { kcal: 150, protein: 10, carbs: 8, fat: 8 },
      source: 'label',
      timesUsed: 3,
      lastUsedAt: '2026-10-01T12:00:00.000Z',
    });
    const actions = createCoachActions({ now: MORNING });
    // Claude's own reading agrees with the remembered food's density (≈160 vs 150 kcal per 100 g),
    // so it is the same food and the owner's figures win; a wildly different density is the raw-vs-
    // cooked guard's case, tested in src/domain/claudeFood.test.ts.
    await actions.logFood({ items: [{ name: 'Chicken curry', amount: 1, unit: 'bowl', grams: 300, kcal: 480, protein: 30, carbs: 24, fat: 26 }], slot: 'dinner' });
    const item = (await mealsOnDay(TODAY))[0]!.items[0]!;
    expect(item.source).toBe('label');
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(450, 6);
  });

  describe('on an earlier day', () => {
    it('logs to that date, into the slot\'s meal, and says which day', async () => {
      const actions = createCoachActions({ now: MORNING });
      const first = await actions.logFood({ items: [{ name: 'Chilli', amount: 1, unit: 'bowl', grams: 400, kcal: 520, protein: 32, carbs: 55, fat: 14 }], slot: 'dinner', date: '2026-10-10' });
      expect(first).toMatchObject({ ok: true });
      expect(first.description).toBe('Logged Chilli for dinner on Sat 10 Oct (≈520 kcal)');
      expect(first.result).toContain('Sat 10 Oct so far: 520 kcal');
      await actions.logFood({ items: [{ name: 'Rice', amount: 150, unit: 'g', kcal: 195, protein: 4, carbs: 43, fat: 0.4 }], slot: 'dinner', date: '2026-10-10' });

      const meals = await mealsOnDay('2026-10-10');
      expect(meals).toHaveLength(1);
      expect(meals[0]!.items.map((i) => i.name)).toEqual(['Chilli', 'Rice']);
      expect(await mealsOnDay(TODAY)).toEqual([]);
    });

    it('is the same as today when the date is today', async () => {
      const actions = createCoachActions({ now: MORNING });
      const out = await actions.logFood({ items: [{ name: 'Porridge', amount: 1, unit: 'bowl', kcal: 310, protein: 10, carbs: 52, fat: 6 }], date: TODAY });
      expect(out.description).toBe('Logged Porridge for breakfast (≈310 kcal)');
      expect(await mealsOnDay(TODAY)).toHaveLength(1);
    });

    it('goes back a week and no further, never forward, and needs a real day and a meal', async () => {
      const actions = createCoachActions({ now: MORNING });
      const item = { name: 'Toast', amount: 1, unit: 'slice', kcal: 90, protein: 3, carbs: 17, fat: 1 };
      expect((await actions.logFood({ items: [item], slot: 'snack', date: '2026-10-05' })).ok).toBe(true); // 7 days back
      const tooOld = await actions.logFood({ items: [item], slot: 'snack', date: '2026-10-04' });
      expect(tooOld.ok).toBe(false);
      expect(tooOld.result).toContain('last 7 days');
      expect((await actions.logFood({ items: [item], slot: 'snack', date: '2026-10-13' })).result).toBe('That date is in the future.');
      expect((await actions.logFood({ items: [item], slot: 'snack', date: 'yesterday' })).ok).toBe(false);
      expect((await actions.logFood({ items: [item], slot: 'snack', date: '2026-02-31' })).ok).toBe(false);
      // The time of day says nothing about which meal an earlier day's food was.
      const noSlot = await actions.logFood({ items: [item], date: '2026-10-10' });
      expect(noSlot.ok).toBe(false);
      expect(noSlot.result).toContain('Which meal');
      expect(await db.meals.count()).toBe(1);
    });
  });

  it('refuses nonsense without writing anything', async () => {
    const actions = createCoachActions({ now: MORNING });
    const bad = [
      await actions.logFood({ items: [] }),
      await actions.logFood({ items: [{ name: '', amount: 1, unit: 'x', kcal: 1, protein: 0, carbs: 0, fat: 0 }] }),
      await actions.logFood({ items: [{ name: 'Cake', amount: 1, unit: 'slice', kcal: -5, protein: 0, carbs: 0, fat: 0 }] }),
      await actions.logFood({ items: [{ name: 'Cake', amount: 0, unit: 'slice', kcal: 300, protein: 0, carbs: 0, fat: 0 }] }),
      await actions.logFood({ items: [{ name: 'Feast', amount: 1, unit: 'plate', kcal: 9000, protein: 0, carbs: 0, fat: 0 }] }),
      await actions.logFood({ items: [{ name: 'Cake', amount: 1, unit: 'slice', kcal: Number.NaN, protein: 0, carbs: 0, fat: 0 }] }),
    ];
    expect(bad.every((b) => !b.ok && b.description === undefined)).toBe(true);
    expect(await db.meals.count()).toBe(0);
  });
});

describe('log_weight', () => {
  it('logs today by default and replaces the same day', async () => {
    const actions = createCoachActions({ now: MORNING });
    const first = await actions.logWeight({ kg: 81.2 });
    expect(first).toMatchObject({ ok: true, description: 'Weigh-in: 81.2 kg' });
    await actions.logWeight({ kg: 81 });
    const rows = await db.bodyweight.toArray();
    expect(rows.filter((r) => r.date === TODAY)).toHaveLength(1);
    expect(rows.find((r) => r.date === TODAY)!.kg).toBe(81);
  });

  it('takes a past date, and refuses a future one or an impossible weight', async () => {
    const actions = createCoachActions({ now: MORNING });
    expect((await actions.logWeight({ kg: 80.4, date: '2026-10-09' })).description).toBe('Weigh-in: 80.4 kg (2026-10-09)');
    expect((await actions.logWeight({ kg: 80, date: '2026-10-20' })).ok).toBe(false);
    expect((await actions.logWeight({ kg: 12 })).ok).toBe(false);
    expect((await actions.logWeight({ kg: 81, date: 'yesterday' })).ok).toBe(false);
    expect((await actions.logWeight({ kg: Number.NaN })).ok).toBe(false);
  });

  it('refuses a day that does not exist, or one too far back', async () => {
    const actions = createCoachActions({ now: MORNING });
    for (const date of ['2026-02-30', '2026-00-00', '2025-10-12']) expect((await actions.logWeight({ kg: 81, date })).ok, date).toBe(false);
    expect(await db.bodyweight.where('date').anyOf('2026-02-30', '2026-00-00', '2025-10-12').count()).toBe(0);
  });
});

describe('remember and forget', () => {
  it('writes a note, shows its short id, and does not store the same note twice', async () => {
    const actions = createCoachActions();
    const out = await actions.remember('  Left knee twinges   on deep squats ');
    expect(out.ok).toBe(true);
    const [note] = await db.coachNotes.toArray();
    expect(note!.text).toBe('Left knee twinges on deep squats');
    expect(out.result).toBe(`Noted as [${noteShortId(note!.id)}].`);
    expect(out.description).toBe('Noted: Left knee twinges on deep squats');

    const again = await actions.remember('left knee twinges on deep squats');
    expect(again.ok).toBe(true);
    expect(again.description).toBeUndefined();
    expect(await db.coachNotes.count()).toBe(1);
  });

  it('refuses an empty or very long note', async () => {
    const actions = createCoachActions();
    expect((await actions.remember('   ')).ok).toBe(false);
    expect((await actions.remember('x'.repeat(301))).ok).toBe(false);
    expect(await db.coachNotes.count()).toBe(0);
  });

  it('forgets by the id it was shown, in brackets or not, and by nothing less than a unique prefix', async () => {
    const actions = createCoachActions();
    await db.coachNotes.bulkPut([
      { id: 'aaaa1111-0000-4000-8000-000000000001', createdAt: '2026-10-01T08:00:00.000Z', text: 'First' },
      { id: 'aaaa1111-0000-4000-8000-000000000002', createdAt: '2026-10-02T08:00:00.000Z', text: 'Second' },
      { id: 'bbbb2222-0000-4000-8000-000000000003', createdAt: '2026-10-03T08:00:00.000Z', text: 'Third' },
    ]);
    expect((await actions.forget('aaaa1111')).ok).toBe(false); // two notes start with it
    expect((await actions.forget('zzzz')).ok).toBe(false);
    expect((await actions.forget('')).ok).toBe(false);
    expect(await db.coachNotes.count()).toBe(3);

    const out = await actions.forget('[bbbb2222]');
    expect(out).toMatchObject({ ok: true, description: 'Forgot: Third' });
    expect((await actions.forget('aaaa1111-0000-4000-8000-000000000001')).ok).toBe(true);
    expect((await db.coachNotes.toArray()).map((n) => n.text)).toEqual(['Second']);
  });
});

describe('edit_routine', () => {
  it('changes the sets of an exercise, found by a loose name in a loosely named routine', async () => {
    const actions = createCoachActions();
    const out = await actions.editRoutine({ routine: 'push day', exercise: 'bench press', change: 'sets', sets: 5 });
    expect(out).toMatchObject({ ok: true, description: 'Bench Press (Barbell): 5 sets in Upper (Push)' });
    expect((await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx.targetSets).toBe(5);
  });

  it('will not remove or reweigh an exercise the owner did not name: the closest is named back', async () => {
    const actions = createCoachActions();
    const removed = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Dumbbell Bench Press', change: 'remove' });
    expect(removed.ok).toBe(false);
    expect(removed.result).toContain('The closest is Incline DB Press');
    const weighed = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Dumbbell Bench Press', change: 'weight', weightKg: 30 });
    expect(weighed.ok).toBe(false);
    expect((await rxOf('Upper (Push)', 'Incline DB Press')).rx.currentWeight).not.toBe(30);
  });

  it('changes a rep range, keeping the other end consistent', async () => {
    const actions = createCoachActions();
    await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'reps', repMin: 8, repMax: 10 });
    const bench = (await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx;
    expect([bench.repMin, bench.repMax]).toEqual([8, 10]);

    // Only the top given: the bottom stays unless it would cross.
    await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'reps', repMax: 6 });
    const after = (await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx;
    expect([after.repMin, after.repMax]).toEqual([6, 6]);

    // Only the bottom given and above the top: the top follows.
    await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'reps', repMin: 10 });
    const last = (await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx;
    expect([last.repMin, last.repMax]).toEqual([10, 10]);

    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'reps', repMin: 12, repMax: 8 })).ok).toBe(false);
  });

  it('changes the weight of an exercise that is already progressing', async () => {
    const actions = createCoachActions();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'weight', weightKg: 67.5 });
    expect(out.description).toBe('Bench Press (Barbell): 67.5 kg in Upper (Push)');
    const bench = (await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx;
    expect(bench).toMatchObject({ currentWeight: 67.5, mode: 'normal' });
  });

  it('locks in a calibrating exercise when given a weight, the way the app does', async () => {
    const actions = createCoachActions();
    const before = (await rxOf('Upper (Push)', 'Incline DB Press')).rx;
    expect(before.mode).toBe('calibrating');
    await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Incline DB Press', change: 'weight', weightKg: 22 });
    const after = (await rxOf('Upper (Push)', 'Incline DB Press')).rx;
    expect(after).toMatchObject({ currentWeight: 22, mode: 'normal' });
    const decisions = await db.decisions.where('routineExerciseId').equals(after.id).toArray();
    expect(decisions.map((d) => d.rule)).toEqual(['lock_in']);
  });

  it('adds one of the owner\'s exercises with the numbers asked for, and refuses a duplicate or a stranger', async () => {
    const actions = createCoachActions();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Lateral Raise', change: 'add', sets: 3, repMin: 12, repMax: 15, weightKg: 8 });
    expect(out.ok).toBe(true);
    expect(out.description).toBe('Added Lateral Raise to Upper (Push): 3 sets, 12–15 reps, 8 kg');
    const raise = await rxOf('Upper (Push)', 'Lateral Raise');
    expect(raise.rx).toMatchObject({ targetSets: 3, repMin: 12, repMax: 15, currentWeight: 8, mode: 'normal' });

    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Lateral Raise', change: 'add' })).ok).toBe(false);
    const stranger = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Zercher Squat Of Doom', change: 'add' });
    expect(stranger.ok).toBe(false);
  });

  it('removes an exercise', async () => {
    const actions = createCoachActions();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Triceps Pushdown', change: 'remove' });
    expect(out.description).toBe('Removed Triceps Pushdown from Upper (Push)');
    const names = (await routineItems(PUSH)).map((it) => it.exercise.name);
    expect(names).not.toContain('Triceps Pushdown');
    expect(names).toContain('Bench Press (Barbell)');
  });

  it('says what it found when the routine or exercise is not recognised', async () => {
    const actions = createCoachActions();
    const noRoutine = await actions.editRoutine({ routine: 'Leg day of doom', exercise: 'Squat', change: 'sets', sets: 3 });
    expect(noRoutine.ok).toBe(false);
    expect(noRoutine.result).toContain('Upper (Push)');
    const noExercise = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Preacher curl', change: 'sets', sets: 3 });
    expect(noExercise.ok).toBe(false);
    expect(noExercise.result).toContain('Bench Press (Barbell)');
  });

  it('checks the numbers', async () => {
    const actions = createCoachActions();
    const base = { routine: 'Upper (Push)', exercise: 'Bench Press' } as const;
    expect((await actions.editRoutine({ ...base, change: 'sets', sets: 0 })).ok).toBe(false);
    expect((await actions.editRoutine({ ...base, change: 'sets', sets: 40 })).ok).toBe(false);
    expect((await actions.editRoutine({ ...base, change: 'sets' })).ok).toBe(false);
    expect((await actions.editRoutine({ ...base, change: 'weight', weightKg: -5 })).ok).toBe(false);
    expect((await actions.editRoutine({ ...base, change: 'weight', weightKg: 0 })).ok).toBe(false);
    expect((await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx).toMatchObject({ targetSets: 4, currentWeight: 65 });
  });

  it('finds routines by exact name, by part of the name, and refuses an ambiguous one', async () => {
    const routines = await listRoutines();
    expect(findRoutine('Upper (Push)', routines)?.name).toBe('Upper (Push)');
    expect(findRoutine('push', routines)?.name).toBe('Upper (Push)');
    expect(findRoutine('lower hinge', routines)?.name).toBe('Lower (Hinge)');
    expect(findRoutine('upper', routines)).toBeNull(); // Push and Pull
    expect(findRoutine('   ', routines)).toBeNull();
  });
});

describe('build_routine', () => {
  it('builds an easy routine when the model reads an easy day the words did not say, with no heavy lifts', async () => {
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'CBA routine for a tired day', split: 'full-body', effort: 'easy' });
    expect(out.ok).toBe(true);
    expect(out.result).toContain('easy');
    const rows = out.draft!.routines.flatMap((r) => r.rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect([row.sets, row.repMin, row.repMax], row.name).toEqual([2, 10, 15]);
      expect(row.name).not.toMatch(/Barbell|Deadlift|Romanian/);
    }
  });

  it('reads "no heavy barbell lifts" as no barbell, not barbell only', async () => {
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'easy full body session, no heavy barbell lifts' });
    expect(out.result).toContain('no barbell');
    expect(out.draft!.text).not.toMatch(/Barbell/);
  });

  it('drafts a routine from the owner\'s exercises and returns it unsaved', async () => {
    const routinesBefore = await db.routines.count();
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'a 45 minute shoulder routine' });
    expect(out.ok).toBe(true);
    expect(out.draft?.routines.length).toBeGreaterThan(0);
    expect(out.draft?.text).toContain('Lateral Raise');
    expect(out.result).toContain('not saved');
    expect(out.description).toContain('ready to save');
    // Nothing was written.
    expect(await db.routines.count()).toBe(routinesBefore);
  });

  it('uses what the model read only where the rules read nothing', async () => {
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'something for my back day', focus: ['lats'], minutes: 40 });
    expect(out.ok).toBe(true);
    expect(out.draft?.routines[0]?.focus).toContain('lats');
  });

  it('builds a split when one is named', async () => {
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'push pull legs' });
    expect(out.ok).toBe(true);
    expect(out.draft?.routines.length).toBe(3);
  });

  it('says so when the request gives it nothing to build from', async () => {
    const actions = createCoachActions({ seed: () => 7 });
    const out = await actions.buildRoutine({ request: 'surprise me' });
    expect(out.ok).toBe(false);
    expect(out.draft).toBeUndefined();
  });
});

describe('edit_session', () => {
  it('has nothing to change when no session is live', async () => {
    const actions = createCoachActions({ setPlanOverride: vi.fn() });
    const out = await actions.editSession({ exercise: 'Bench Press', change: 'sets', sets: 3 });
    expect(out.ok).toBe(false);
    expect(out.result).toContain('No session is live');
  });

  it('writes a plan override for sets, reps and weight through the function it is given', async () => {
    const setPlanOverride = vi.fn(async () => undefined);
    const actions = createCoachActions({ setPlanOverride });
    const session = await startSession(PUSH);
    const bench = await rxOf('Upper (Push)', 'Bench Press (Barbell)');

    const sets = await actions.editSession({ exercise: 'bench', change: 'sets', sets: 3 });
    expect(sets).toMatchObject({ ok: true, description: 'Bench Press (Barbell): 3 sets today' });
    expect(setPlanOverride).toHaveBeenLastCalledWith(session.id, bench.rx.id, { targetSets: 3 });

    const reps = await actions.editSession({ exercise: 'bench', change: 'reps', repMin: 8, repMax: 10 });
    expect(reps.description).toBe('Bench Press (Barbell): 8–10 reps today');
    expect(setPlanOverride).toHaveBeenLastCalledWith(session.id, bench.rx.id, { repMin: 8, repMax: 10 });

    // A weight needs the exercise by name: a guess is named back, and nothing is written.
    const guessed = await actions.editSession({ exercise: 'bench', change: 'weight', weightKg: 60 });
    expect(guessed).toMatchObject({ ok: false });
    expect(guessed.result).toContain('The closest is Bench Press (Barbell)');
    const weight = await actions.editSession({ exercise: 'Bench Press', change: 'weight', weightKg: 60 });
    expect(weight.description).toBe('Bench Press (Barbell): 60 kg today');
    expect(setPlanOverride).toHaveBeenLastCalledWith(session.id, bench.rx.id, { weight: 60 });

    // The routine itself is untouched.
    expect((await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx).toMatchObject({ targetSets: 4, currentWeight: 65 });
  });

  it('says it cannot change sets, reps or weight until the override writer is supplied', async () => {
    const actions = createCoachActions();
    await startSession(PUSH);
    const out = await actions.editSession({ exercise: 'bench', change: 'sets', sets: 3 });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("can't change today's sets");
  });

  it('skips, restores, swaps and adds with the existing session functions', async () => {
    const actions = createCoachActions({ setPlanOverride: vi.fn() });
    const session = await startSession(PUSH);
    const bench = await rxOf('Upper (Push)', 'Bench Press (Barbell)');

    expect((await actions.editSession({ exercise: 'bench', change: 'skip' })).description).toBe('Bench Press (Barbell) skipped today');
    expect((await getActiveSession())!.skippedRoutineExerciseIds).toEqual([bench.rx.id]);
    expect((await actions.editSession({ exercise: 'bench', change: 'unskip' })).description).toBe('Bench Press (Barbell) back in today');
    expect((await getActiveSession())!.skippedRoutineExerciseIds).toEqual([]);

    const swap = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });
    expect(swap.description).toBe('Bench Press (Barbell) swapped for Incline DB Curl today');
    const swapped = (await getActiveSession())!;
    expect(swapped.swaps).toEqual({ [bench.rx.id]: SEED_EXERCISE_IDS['Incline DB Curl'] });
    expect(swapped.skippedRoutineExerciseIds).toContain(bench.rx.id);
    expect(swapped.extraExerciseIds).toContain(SEED_EXERCISE_IDS['Incline DB Curl']);

    const add = await actions.editSession({ exercise: 'Face Pull', change: 'add' });
    expect(add.description).toBe('Face Pull added today');
    expect((await getActiveSession())!.extraExerciseIds).toContain(SEED_EXERCISE_IDS['Face Pull']);
    // Adding it again changes nothing, and says so rather than reporting an addition.
    const again = await actions.editSession({ exercise: 'Face Pull', change: 'add' });
    expect(again.ok).toBe(false);
    expect(again.result).toContain("already in today's session");
    expect(again.description).toBeUndefined();
    expect((await getActiveSession())!.extraExerciseIds).toEqual([SEED_EXERCISE_IDS['Incline DB Curl'], SEED_EXERCISE_IDS['Face Pull']]);

    expect(session.id).toBe((await getActiveSession())!.id);
  });

  it('names the session\'s exercises when one is not recognised, and refuses a swap to itself', async () => {
    const actions = createCoachActions({ setPlanOverride: vi.fn() });
    await startSession(PUSH);
    await logSet({ sessionId: (await getActiveSession())!.id, routineExerciseId: null, exerciseId: BENCH, type: 'working', weight: 65, reps: 8 });
    const lost = await actions.editSession({ exercise: 'Deadlift', change: 'skip' });
    expect(lost.ok).toBe(false);
    expect(lost.result).toContain('Bench Press (Barbell)');
    expect((await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Bench Press' })).ok).toBe(false);
    expect((await actions.editSession({ exercise: 'bench', change: 'swap' })).ok).toBe(false);
    expect((await actions.editSession({ exercise: 'bench', change: 'sets', sets: 99 })).ok).toBe(false);
  });
});

describe('edit_session against what is really in today\'s session', () => {
  const INCLINE_CURL = SEED_EXERCISE_IDS['Incline DB Curl'];
  const FACE_PULL = SEED_EXERCISE_IDS['Face Pull'];

  /** Actions that write overrides for real, so what the owner would see is what is asserted. */
  const real = () => createCoachActions({ setPlanOverride });

  async function live() {
    const session = await startSession(PUSH);
    const bench = await rxOf('Upper (Push)', 'Bench Press (Barbell)');
    return { session, bench };
  }

  describe('a slot that has been swapped', () => {
    it('has no plan to change, whether it is called by the exercise swapped out or the one swapped in', async () => {
      const actions = real();
      const { bench } = await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });

      const original = await actions.editSession({ exercise: 'bench', change: 'sets', sets: 2 });
      expect(original.ok).toBe(false);
      expect(original.result).toContain('swapped for Incline DB Curl');
      const substitute = await actions.editSession({ exercise: 'Incline DB Curl', change: 'weight', weightKg: 12 });
      expect(substitute.ok).toBe(false);
      expect(substitute.result).toContain('no sets, reps or weight to set');

      // Nothing was written behind the owner's back.
      expect((await getActiveSession())!.planOverrides).toBeUndefined();
      expect((await getActiveSession())!.swaps).toEqual({ [bench.rx.id]: INCLINE_CURL });
    });

    it('is put back with undoSwap: the substitute goes, the slot is back, nothing is left over', async () => {
      const actions = real();
      const { bench } = await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });

      const out = await actions.editSession({ exercise: 'bench', change: 'unskip' });
      expect(out).toMatchObject({ ok: true, description: 'Bench Press (Barbell) back in today' });
      const after = (await getActiveSession())!;
      expect(after.swaps).toEqual({});
      expect(after.extraExerciseIds).toEqual([]);
      expect(after.skippedRoutineExerciseIds).toEqual([]);
      expect(bench.rx.id).toBeTruthy();
    });

    it('is not put back when that would delete sets already logged on the substitute', async () => {
      const actions = real();
      const { session } = await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });
      await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: INCLINE_CURL, type: 'working', weight: 12, reps: 10 });

      const out = await actions.editSession({ exercise: 'bench', change: 'unskip' });
      expect(out.ok).toBe(false);
      expect(out.result).toContain('would delete them');
      expect((await getActiveSession())!.extraExerciseIds).toEqual([INCLINE_CURL]);
      expect(await db.setLogs.where('sessionId').equals(session.id).count()).toBe(1);
    });

    it('swapped again replaces the first swap and does not leave its substitute behind as an extra', async () => {
      const actions = real();
      const { bench } = await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });

      // By the exercise standing there now, or by the one swapped out: the slot is the same.
      const again = await actions.editSession({ exercise: 'Incline DB Curl', change: 'swap', swapTo: 'Face Pull' });
      expect(again).toMatchObject({ ok: true, description: 'Bench Press (Barbell) swapped for Face Pull today' });
      const after = (await getActiveSession())!;
      expect(after.swaps).toEqual({ [bench.rx.id]: FACE_PULL });
      expect(after.extraExerciseIds).toEqual([FACE_PULL]);
      expect(after.skippedRoutineExerciseIds).toEqual([bench.rx.id]);
    });

    it('is not swapped again once the substitute has sets, and may be swapped back to nothing but the original', async () => {
      const actions = real();
      const { session } = await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });
      await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: INCLINE_CURL, type: 'working', weight: 12, reps: 10 });

      const blocked = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Face Pull' });
      expect(blocked.ok).toBe(false);
      expect(blocked.result).toContain('has 1 set logged');
      expect((await getActiveSession())!.extraExerciseIds).toEqual([INCLINE_CURL]);

      const original = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Bench Press' });
      expect(original.ok).toBe(false);
      expect(original.result).toContain('Unskip');
    });

    it('is skipped already, and a substitute cannot be skipped: the swap is what is undone', async () => {
      const actions = real();
      await live();
      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });
      const already = await actions.editSession({ exercise: 'bench', change: 'skip' });
      expect(already).toMatchObject({ ok: true });
      expect(already.description).toBeUndefined();
      const sub = await actions.editSession({ exercise: 'Incline DB Curl', change: 'skip' });
      expect(sub.ok).toBe(false);
      expect(sub.result).toContain('unskipping Bench Press (Barbell)');
      const unskipSub = await actions.editSession({ exercise: 'Incline DB Curl', change: 'unskip' });
      expect(unskipSub.ok).toBe(false);
    });
  });

  describe('swapping', () => {
    it('refuses what the swap sheet would not offer: anything already in the session', async () => {
      const actions = real();
      await live();
      // Another exercise of the routine, and one that is already an extra.
      const inRoutine = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Triceps Pushdown' });
      expect(inRoutine.ok).toBe(false);
      expect(inRoutine.result).toContain("already in today's session");
      await actions.editSession({ exercise: 'Face Pull', change: 'add' });
      const extra = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Face Pull' });
      expect(extra.ok).toBe(false);
      expect(extra.result).toContain("already in today's session");
      expect((await getActiveSession())!.swaps).toBeUndefined();
    });

    it('cannot swap an exercise that was only added for today', async () => {
      const actions = real();
      await live();
      await actions.editSession({ exercise: 'Face Pull', change: 'add' });
      const out = await actions.editSession({ exercise: 'Face Pull', change: 'swap', swapTo: 'Incline DB Curl' });
      expect(out.ok).toBe(false);
      expect(out.result).toContain('nothing to swap');
    });

    it('can swap a skipped exercise', async () => {
      const actions = real();
      const { bench } = await live();
      await actions.editSession({ exercise: 'bench', change: 'skip' });
      expect((await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' })).ok).toBe(true);
      expect((await getActiveSession())!.swaps).toEqual({ [bench.rx.id]: INCLINE_CURL });
    });
  });

  describe('sets, reps and weight', () => {
    it('are not changed on a skipped exercise', async () => {
      const actions = real();
      await live();
      await actions.editSession({ exercise: 'bench', change: 'skip' });
      for (const input of [
        { change: 'sets', sets: 2 },
        { change: 'reps', repMin: 5, repMax: 5 },
        { change: 'weight', weightKg: 50 },
      ] as const) {
        const out = await actions.editSession({ exercise: 'Bench Press (Barbell)', ...input });
        expect(out.ok, input.change).toBe(false);
        expect(out.result, input.change).toContain('skipped today');
      }
      expect((await getActiveSession())!.planOverrides).toBeUndefined();
    });

    it('are not changed on an exercise added for today', async () => {
      const actions = real();
      await live();
      await actions.editSession({ exercise: 'Face Pull', change: 'add' });
      const out = await actions.editSession({ exercise: 'Face Pull', change: 'sets', sets: 3 });
      expect(out.ok).toBe(false);
      expect(out.result).toContain('added to today');
    });

    it('answer plainly that a weight on a calibrating exercise cannot be changed, instead of dropping it', async () => {
      const actions = real();
      await live();
      const out = await actions.editSession({ exercise: 'Incline DB Press', change: 'weight', weightKg: 22 });
      expect(out.ok).toBe(false);
      expect(out.description).toBeUndefined();
      expect(out.result).toContain('still calibrating');
      expect((await getActiveSession())!.planOverrides).toBeUndefined();
      // Its sets and reps are still its own to change.
      expect((await actions.editSession({ exercise: 'Incline DB Press', change: 'sets', sets: 2 })).ok).toBe(true);
    });

    it('fill a rep bound that was not given from today\'s plan, not the saved routine', async () => {
      const actions = real();
      const { bench } = await live();
      expect([bench.rx.repMin, bench.rx.repMax]).toEqual([6, 8]);

      await actions.editSession({ exercise: 'bench', change: 'reps', repMin: 10, repMax: 12 });
      // Only the top: the bottom stays at today's 10, not the routine's 6.
      await actions.editSession({ exercise: 'bench', change: 'reps', repMax: 15 });
      let override = (await getActiveSession())!.planOverrides![bench.rx.id]!;
      expect([override.repMin, override.repMax]).toEqual([10, 15]);

      // Only the bottom: the top stays at today's 15, not pulled down to the routine's 8.
      await actions.editSession({ exercise: 'bench', change: 'reps', repMin: 11 });
      override = (await getActiveSession())!.planOverrides![bench.rx.id]!;
      expect([override.repMin, override.repMax]).toEqual([11, 15]);
    });

    it('write the override for a slot that is on, and say it is for today only', async () => {
      const actions = real();
      const { bench } = await live();
      const out = await actions.editSession({ exercise: 'bench', change: 'sets', sets: 3 });
      expect(out).toMatchObject({ ok: true, description: 'Bench Press (Barbell): 3 sets today' });
      expect((await getActiveSession())!.planOverrides).toEqual({ [bench.rx.id]: { targetSets: 3 } });
      expect((await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx.targetSets).toBe(4);
    });
  });

  describe('adding', () => {
    it('says an exercise is already in the session whether it is planned, skipped, swapped out or an extra', async () => {
      const actions = real();
      await live();
      expect((await actions.editSession({ exercise: 'Triceps Pushdown', change: 'add' })).result).toContain("already in today's session");

      await actions.editSession({ exercise: 'Triceps Pushdown', change: 'skip' });
      const skipped = await actions.editSession({ exercise: 'Triceps Pushdown', change: 'add' });
      expect(skipped.ok).toBe(false);
      expect(skipped.result).toContain('unskip');

      await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' });
      const swappedOut = await actions.editSession({ exercise: 'Bench Press', change: 'add' });
      expect(swappedOut.ok).toBe(false);
      expect(swappedOut.result).toContain('swapped for Incline DB Curl');
      const extra = await actions.editSession({ exercise: 'Incline DB Curl', change: 'add' });
      expect(extra.ok).toBe(false);
      expect(extra.result).toContain("already in today's session");
    });
  });

  describe('once the owner is on the Summary screen', () => {
    afterEach(() => window.history.pushState({}, '', '/'));

    it('refuses every change, with a plain line, and changes nothing', async () => {
      const actions = real();
      const { session } = await live();
      window.history.pushState({}, '', `/session/${session.id}/summary`);
      for (const input of [
        { exercise: 'bench', change: 'sets', sets: 2 },
        { exercise: 'bench', change: 'skip' },
        { exercise: 'Face Pull', change: 'add' },
      ] as const) {
        const out = await actions.editSession(input);
        expect(out.ok, input.change).toBe(false);
        expect(out.result, input.change).toContain('Summary screen');
      }
      const after = (await getActiveSession())!;
      expect(after.planOverrides).toBeUndefined();
      expect(after.skippedRoutineExerciseIds).toBeUndefined();
      expect(after.extraExerciseIds).toBeUndefined();

      // Anywhere else in the app it works again.
      window.history.pushState({}, '', `/session/${session.id}`);
      expect((await actions.editSession({ exercise: 'bench', change: 'sets', sets: 2 })).ok).toBe(true);
    });
  });
});

describe('edit_routine while a session is live on the routine', () => {
  async function liveWithBenchSet() {
    const session = await startSession(PUSH);
    const bench = await rxOf('Upper (Push)', 'Bench Press (Barbell)');
    await logSet({ sessionId: session.id, routineExerciseId: bench.rx.id, exerciseId: BENCH, type: 'working', weight: 65, reps: 8 });
    return { session, bench };
  }

  it('will not remove, or change the sets, reps or weight of, an exercise that has sets logged in it', async () => {
    const actions = createCoachActions();
    await liveWithBenchSet();
    const base = { routine: 'Upper (Push)', exercise: 'Bench Press' } as const;
    for (const input of [{ change: 'remove' }, { change: 'sets', sets: 5 }, { change: 'reps', repMin: 5, repMax: 5 }, { change: 'weight', weightKg: 70 }] as const) {
      const out = await actions.editRoutine({ ...base, ...input });
      expect(out.ok, input.change).toBe(false);
      expect(out.result, input.change).toBe("Bench Press (Barbell) has sets logged in today's session; change it after the owner finishes, or change today only (edit_session).");
      expect(out.description, input.change).toBeUndefined();
    }
    expect((await rxOf('Upper (Push)', 'Bench Press (Barbell)')).rx).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8, currentWeight: 65 });
  });

  it('still changes the exercises that have no sets yet, and routines other than the live one', async () => {
    const actions = createCoachActions();
    await liveWithBenchSet();
    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Triceps Pushdown', change: 'sets', sets: 4 })).ok).toBe(true);
    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Triceps Pushdown', change: 'remove' })).ok).toBe(true);
    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Lateral Raise', change: 'add' })).ok).toBe(true);
    // The same exercise in another routine is not today's.
    expect((await actions.editRoutine({ routine: 'Arms', exercise: 'Lateral Raise', change: 'sets', sets: 4 })).ok).toBe(true);
  });

  it('can be changed once the session is over', async () => {
    const actions = createCoachActions();
    const { session } = await liveWithBenchSet();
    await db.sessions.update(session.id, { endedAt: new Date().toISOString() });
    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Bench Press', change: 'sets', sets: 5 })).ok).toBe(true);
  });

  it('counts a linked copy of the exercise that is being done today, because a weight is copied to it', async () => {
    const actions = createCoachActions();
    const pull = (await listRoutines()).find((r) => r.name === 'Upper (Pull)')!;
    const curlInPull = (await routineItems(pull.id)).find((i) => i.exercise.name === 'DB Curl')!;
    const curlInArms = await rxOf('Arms (Day 5)', 'DB Curl');
    await db.routineExercises.update(curlInPull.rx.id, { linkProgression: true });
    await db.routineExercises.update(curlInArms.rx.id, { linkProgression: true });

    const session = await startSession(pull.id);
    await logSet({ sessionId: session.id, routineExerciseId: curlInPull.rx.id, exerciseId: curlInPull.exercise.id, type: 'working', weight: 9, reps: 12 });

    const weight = await actions.editRoutine({ routine: 'Arms', exercise: 'DB Curl', change: 'weight', weightKg: 12 });
    expect(weight.ok).toBe(false);
    expect(weight.result).toContain("has sets logged in today's session");
    // Sets and reps are not shared between copies, so those are the Arms routine's own business.
    expect((await actions.editRoutine({ routine: 'Arms', exercise: 'DB Curl', change: 'sets', sets: 5 })).ok).toBe(true);
    expect((await rxOf('Upper (Pull)', 'DB Curl')).rx.currentWeight).toBe(9);
  });
});

describe('the meal written is the meal read back', () => {
  it('round-trips through getMeal', async () => {
    const actions = createCoachActions({ now: MORNING });
    await actions.logFood({ items: [{ name: 'Porridge', amount: 1, unit: 'bowl', grams: 300, kcal: 310, protein: 10, carbs: 52, fat: 6 }], slot: 'breakfast' });
    const [row] = await mealsOnDay(TODAY);
    const meal = await getMeal(row!.meal.id);
    expect(meal?.macros).toEqual({ kcal: 310, protein: 10, carbs: 52, fat: 6 });
  });
});

describe('exercises from the app library', () => {
  it('adds a library exercise to a routine by its name, making it one of the owner\'s with its picture', async () => {
    const actions = createCoachActions();
    const before = await db.exercises.count();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Chest-Supported Row', change: 'add' });
    expect(out).toMatchObject({ ok: true, description: 'Added Chest Supported Row to Upper (Push)' });
    expect(out.result).toContain('came from the library');
    expect(await db.exercises.count()).toBe(before + 1);
    const row = await rxOf('Upper (Push)', 'Chest Supported Row');
    expect(row.exercise.demo).toBe('chest-supported-row');

    // Asked for again, it is the owner's own now: no second row, and it is already there.
    const again = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'chest supported rows', change: 'add' });
    expect(again).toMatchObject({ ok: false, result: 'Chest Supported Row is already in Upper (Push).' });
    expect(await db.exercises.count()).toBe(before + 1);
  });

  it('takes a cable lateral raise as the cable one, not the dumbbell Lateral Raise the owner has', async () => {
    const actions = createCoachActions();
    expect((await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Lateral Raise', change: 'add' })).ok).toBe(true);
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Cable Lateral Raise', change: 'add' });
    expect(out).toMatchObject({ ok: true, description: 'Added Cable Lateral Raise to Upper (Push)' });
    const names = (await routineItems(PUSH)).map((it) => it.exercise.name);
    expect(names).toEqual(expect.arrayContaining(['Lateral Raise', 'Cable Lateral Raise']));
  });

  it('finds a catalogue exercise from shorthand that says the same words', async () => {
    const actions = createCoachActions();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Incline DB Rows', change: 'add' });
    expect(out).toMatchObject({ ok: true, description: 'Added Dumbbell Incline Row to Upper (Push)' });
    expect((await rxOf('Upper (Push)', 'Dumbbell Incline Row')).exercise.demo).toBe('cat:dumbbell-incline-row');
  });

  it('names the closest library exercise instead of adding a guess, and writes nothing', async () => {
    const actions = createCoachActions();
    const before = await db.exercises.count();
    const out = await actions.editRoutine({ routine: 'Upper (Push)', exercise: 'Zercher Squat Of Doom', change: 'add' });
    expect(out.ok).toBe(false);
    expect(out.result).toBe('No exercise called "Zercher Squat Of Doom". The closest in the app\'s library is "Zercher Squats"; to use it, ask for it by that name.');
    expect(await db.exercises.count()).toBe(before);
    expect((await routineItems(PUSH)).map((it) => it.exercise.name)).not.toContain('Zercher Squats');
  });

  it('adds and swaps in library exercises in today\'s session, and a refused swap leaves no new exercise behind', async () => {
    const actions = createCoachActions({ setPlanOverride: vi.fn() });
    const session = await startSession(PUSH);

    const add = await actions.editSession({ exercise: 'Machine Lateral Raise', change: 'add' });
    expect(add).toMatchObject({ ok: true, description: 'Machine Lateral Raise added today' });
    const machine = (await db.exercises.toArray()).find((e) => e.name === 'Machine Lateral Raise')!;
    expect((await getActiveSession())!.extraExerciseIds).toContain(machine.id);

    // Bench swapped for one of theirs, with a set logged on the substitute: a second swap would delete
    // that set, so it is refused, and the library exercise it named is not added.
    expect((await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Incline DB Curl' })).ok).toBe(true);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: SEED_EXERCISE_IDS['Incline DB Curl'], type: 'working', weight: 10, reps: 10 });
    const before = await db.exercises.count();
    const refused = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Meadows Row' });
    expect(refused).toMatchObject({ ok: false, result: 'Incline DB Curl has 1 set logged today, so it cannot be swapped out. Leave it, or add Meadows Row as an extra.' });
    expect(await db.exercises.count()).toBe(before);
    expect((await db.exercises.toArray()).some((e) => e.name === 'Meadows Row')).toBe(false);
  });

  it('swaps in a library exercise when the swap goes ahead', async () => {
    const actions = createCoachActions({ setPlanOverride: vi.fn() });
    await startSession(PUSH);
    const bench = await rxOf('Upper (Push)', 'Bench Press (Barbell)');
    const out = await actions.editSession({ exercise: 'bench', change: 'swap', swapTo: 'Meadows Row' });
    expect(out).toMatchObject({ ok: true, description: 'Bench Press (Barbell) swapped for Meadows Row today' });
    const meadows = (await db.exercises.toArray()).find((e) => e.name === 'Meadows Row')!;
    expect((await getActiveSession())!.swaps).toEqual({ [bench.rx.id]: meadows.id });
  });
});

describe('report_problem', () => {
  it('writes a coach report on the phone, with no key in it', async () => {
    await db.problemReports.clear();
    const actions = createCoachActions({ now: MORNING });
    const out = await actions.reportProblem({ summary: 'Builder gave squats for an easy day', detail: 'Asked for a CBA routine; got Barbell Back Squat 4x6-8. key sk-ant-api03-SECRETSECRET' });
    expect(out).toMatchObject({ ok: true, description: 'Problem logged: Builder gave squats for an easy day' });
    const [r] = await db.problemReports.toArray();
    expect(r).toMatchObject({ source: 'coach', summary: 'Builder gave squats for an easy day', at: MORNING().toISOString() });
    expect(r!.detail).toContain('CBA routine');
    expect(JSON.stringify(r)).not.toContain('sk-ant');
    expect((await actions.reportProblem({ summary: ' ', detail: '' })).ok).toBe(false);
  });
});
