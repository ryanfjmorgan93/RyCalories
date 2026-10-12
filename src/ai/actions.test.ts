/**
 * @vitest-environment jsdom
 *
 * Each coach action against the real data code (Dexie on fake-indexeddb, the seeded routines).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { getMeal, mealsOnDay } from '@/db/foodRepo';
import { getActiveSession, listRoutines, logSet, resetToSeed, routineItems, startSession } from '@/db/repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from '@/db/seed';
import { toDateKey } from '@/domain/dates';
import { macrosOf } from '@/domain/food';
import { createCoachActions, findRoutine, slotForHour } from './actions';
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
    expect(items[0]!.portion).toBe('2 slices (72 g)');
    expect(items[0]!.nutrition.basis).toBe('weighed');
    expect(macrosOf(items[0]!.nutrition).kcal).toBeCloseTo(170, 6);
    expect(items[1]!.portion).toBe('3 eggs');
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
    expect(item.portion).toBe('150 g');
    expect(item.nutrition).toMatchObject({ basis: 'weighed', grams: 150 });
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

    const weight = await actions.editSession({ exercise: 'bench', change: 'weight', weightKg: 60 });
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
    expect((await actions.editSession({ exercise: 'Face Pull', change: 'add' })).ok).toBe(true); // idempotent in the repo

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

describe('the meal written is the meal read back', () => {
  it('round-trips through getMeal', async () => {
    const actions = createCoachActions({ now: MORNING });
    await actions.logFood({ items: [{ name: 'Porridge', amount: 1, unit: 'bowl', grams: 300, kcal: 310, protein: 10, carbs: 52, fat: 6 }], slot: 'breakfast' });
    const [row] = await mealsOnDay(TODAY);
    const meal = await getMeal(row!.meal.id);
    expect(meal?.macros).toEqual({ kcal: 310, protein: 10, carbs: 52, fat: 6 });
  });
});
