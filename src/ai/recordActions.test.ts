/**
 * @vitest-environment jsdom
 *
 * The coach's hands on what is already logged, against the real data code (Dexie on
 * fake-indexeddb, the seeded routines): look a day up, then change or delete what is there.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addMeal, mealsOnDay } from '@/db/foodRepo';
import { getActiveSession, getSettings, logBodyweight, logSet, resetToSeed, routineItems, startSession } from '@/db/repo';
import { SEED_ROUTINE_IDS } from '@/db/seed';
import { toDateKey } from '@/domain/dates';
import { displayMacros } from '@/domain/food';
import { createCoachActions } from './actions';
import { shortId } from './recordActions';

const NOW = () => new Date(2026, 10, 2, 21, 0, 0);
const TODAY = toDateKey(NOW());
const YESTERDAY = '2026-11-01';

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
});

/** The ids find_entries showed, in order. */
const ids = (text: string) => [...text.matchAll(/\[([0-9a-f]{8})\]/g)].map((m) => m[1]!);

describe('food', () => {
  async function nandos() {
    const actions = createCoachActions({ now: NOW });
    await actions.logFood({
      slot: 'dinner',
      items: [
        { name: "Nando's 4 boneless thighs", amount: 1, unit: 'portion', kcal: 900, protein: 90, carbs: 2, fat: 55 },
        { name: "Nando's regular chips", amount: 1, unit: 'portion', kcal: 500, protein: 6, carbs: 70, fat: 20 },
      ],
    });
    const found = await actions.findEntries({ date: TODAY, kind: 'food' });
    return { actions, found: found.result, items: (await mealsOnDay(TODAY)).flatMap((m) => m.items) };
  }

  it('lists a day by meal, each food with its id, figures and where they came from', async () => {
    const { found, items } = await nandos();
    expect(found).toContain('dinner:');
    expect(ids(found)).toEqual(items.map((i) => shortId(i.id)));
    expect(found).toContain("Nando's 4 boneless thighs (≈ 1 portion): ≈900 kcal, P ≈90, C ≈2, F ≈55, from your estimate");
    expect(found).toContain('from your estimate');
  });

  it('replaces its own estimate with better figures, and the day follows', async () => {
    const { actions, items } = await nandos();
    const thighs = items.find((i) => i.name.includes('thighs'))!;
    const out = await actions.editFood({ id: shortId(thighs.id), delete: false, kcal: 706, protein: 85.5, carbs: 0.3, fat: 37.2 });
    expect(out).toMatchObject({ ok: true, description: expect.stringContaining('≈706 kcal') });
    const now = (await db.mealItems.get(thighs.id))!;
    expect(displayMacros(now.nutrition)).toMatchObject({ kcal: 706, protein: 86 });
    expect(now.source).toBe('model');
  });

  it('deletes a food, and halves one', async () => {
    const { actions, items } = await nandos();
    const [thighs, chips] = [items.find((i) => i.name.includes('thighs'))!, items.find((i) => i.name.includes('chips'))!];
    expect((await actions.editFood({ id: `[${shortId(chips.id)}]`, delete: true })).ok).toBe(true);
    expect(await db.mealItems.get(chips.id)).toBeUndefined();
    expect((await actions.editFood({ id: shortId(thighs.id), delete: false, scale: 0.5 })).ok).toBe(true);
    expect(displayMacros((await db.mealItems.get(thighs.id))!.nutrition).kcal).toBe(450);
  });

  it('never replaces a label\'s figures, but scales them to the amount eaten', async () => {
    const actions = createCoachActions({ now: NOW });
    await addMeal({ name: 'Snack', date: TODAY, slot: 'snack' }, [{ name: 'Protein bar', portion: '1 bar', source: 'label', nutrition: { basis: 'portion', macros: { kcal: 200, protein: 20, carbs: 20, fat: 6 } } }]);
    const bar = (await mealsOnDay(TODAY)).flatMap((m) => m.items)[0]!;
    const refused = await actions.editFood({ id: shortId(bar.id), delete: false, kcal: 150 });
    expect(refused).toMatchObject({ ok: false, result: expect.stringContaining('a label') });
    expect(displayMacros((await db.mealItems.get(bar.id))!.nutrition).kcal).toBe(200);
    expect((await actions.editFood({ id: shortId(bar.id), delete: false, scale: 2 })).ok).toBe(true);
    expect(displayMacros((await db.mealItems.get(bar.id))!.nutrition).kcal).toBe(400);
  });

  it('says what is wrong with an id or a request, and changes nothing', async () => {
    const { actions } = await nandos();
    expect(await actions.editFood({ id: 'ffffffff', delete: true })).toMatchObject({ ok: false, result: expect.stringContaining('No food with id ffffffff') });
    expect(await actions.editFood({ id: 'ab', delete: true })).toMatchObject({ ok: false });
    expect(await actions.findEntries({ date: 'yesterday', kind: 'food' })).toMatchObject({ ok: false });
    expect((await mealsOnDay(TODAY)).flatMap((m) => m.items)).toHaveLength(2);
  });
});

describe('training', () => {
  async function pushYesterday() {
    const actions = createCoachActions({ now: NOW });
    expect((await actions.logPastSession({ date: YESTERDAY, routine: 'Upper (Push)', asPlanned: false, exercises: [{ name: 'Bench Press (Barbell)', sets: [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 7 }] }] })).ok).toBe(true);
    const found = (await actions.findEntries({ date: YESTERDAY, kind: 'sessions' })).result;
    return { actions, found, session: (await db.sessions.toArray()).find((s) => s.source === 'coach')! };
  }

  it('lists a day\'s sessions with every set, each with an id', async () => {
    const { found, session } = await pushYesterday();
    const sets = await db.setLogs.where('sessionId').equals(session.id).toArray();
    expect(found).toContain(`[${shortId(session.id)}] Upper (Push), filled in`);
    expect(found).toContain('Bench Press (Barbell):');
    expect(found).toContain('60 kg × 8');
    expect(ids(found)).toEqual(expect.arrayContaining(sets.map((s) => shortId(s.id))));
  });

  it('corrects a set, deletes one, and deletes the session', async () => {
    const { actions, session } = await pushYesterday();
    const [first, second] = (await db.setLogs.where('sessionId').equals(session.id).sortBy('index'))!;
    const changed = await actions.editTraining({ id: shortId(first!.id), delete: false, weightKg: 62.5 });
    expect(changed).toMatchObject({ ok: true, description: 'Bench Press (Barbell) set: 60 kg × 8 → 62.5 kg × 8' });
    expect((await db.setLogs.get(first!.id))!.weight).toBe(62.5);
    expect((await actions.editTraining({ id: shortId(second!.id), delete: true })).ok).toBe(true);
    expect(await db.setLogs.get(second!.id)).toBeUndefined();
    expect((await actions.editTraining({ id: shortId(session.id), delete: false })).ok).toBe(false);
    expect((await actions.editTraining({ id: shortId(session.id), delete: true })).ok).toBe(true);
    expect(await db.sessions.get(session.id)).toBeUndefined();
    expect(await db.setLogs.where('sessionId').equals(session.id).count()).toBe(0);
  });

  it('leaves the session still going to the session screen', async () => {
    const actions = createCoachActions({ now: NOW });
    const live = await startSession(SEED_ROUTINE_IDS['Upper (Push)']);
    const { rx, exercise } = (await routineItems(live.routineId))[0]!;
    const set = await logSet({ sessionId: live.id, routineExerciseId: rx.id, exerciseId: exercise.id, type: 'working', weight: 60, reps: 8 });
    expect((await actions.editTraining({ id: shortId(set.id), delete: true })).ok).toBe(false);
    expect((await actions.editTraining({ id: shortId(live.id), delete: true })).ok).toBe(false);
    expect((await getActiveSession())?.id).toBe(live.id);
    expect(await db.setLogs.get(set.id)).toBeDefined();
  });
});

describe('weigh-ins and settings', () => {
  it('deletes a day\'s weigh-in, and says when there is none', async () => {
    const actions = createCoachActions({ now: NOW });
    await logBodyweight(YESTERDAY, 82.4);
    expect((await actions.findEntries({ date: YESTERDAY, kind: 'weight' })).result).toContain('82.4 kg');
    expect((await actions.deleteWeight(YESTERDAY)).ok).toBe(true);
    expect(await db.bodyweight.where('date').equals(YESTERDAY).count()).toBe(0);
    expect((await actions.deleteWeight(YESTERDAY)).ok).toBe(false);
  });

  it('changes a setting the owner names, within its range, and nothing else', async () => {
    const actions = createCoachActions({ now: NOW });
    // Protein moves the way the offer's button moves it: the lower-body days keep their gap.
    expect(await actions.changeSetting({ setting: 'protein_target', value: 180 })).toMatchObject({ ok: true, description: 'Protein target changed from 170 g to 180 g (lower-body days 200 g to 210 g).' });
    expect(await actions.changeSetting({ setting: 'calorie_target', value: 2500 })).toMatchObject({ ok: true, description: 'Calories set to 2,500 a day from today.' });
    expect((await actions.changeSetting({ setting: 'calorie_target', value: 200 })).ok).toBe(false);
    expect(await actions.changeSetting({ setting: 'sex', value: 'Male' })).toMatchObject({ ok: true });
    expect(await actions.changeSetting({ setting: 'step_goal', value: '12000' })).toMatchObject({ ok: true });
    expect((await actions.changeSetting({ setting: 'protein_target', value: 4000 })).ok).toBe(false);
    expect((await actions.changeSetting({ setting: 'theme' as never, value: 'light' })).ok).toBe(false);
    expect(await getSettings()).toMatchObject({ proteinTarget: 180, proteinTargetLegDay: 210, calorieStart: 2500, calorieCeiling: 2500, calorieStartDate: TODAY, sex: 'male', stepGoal: 12000 });
  });
});
