/**
 * @vitest-environment jsdom
 *
 * The rest of the app the coach can run (supplements, routines, recipes, reminders, the session),
 * against the real data code: Dexie on fake-indexeddb with the seeded routines.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { mealsOnDay } from '@/db/foodRepo';
import { saveRecipe } from '@/db/recipeRepo';
import { getActiveSession, getSettings, listArchivedRoutines, listRoutines, logSet, resetToSeed, routineItems } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { displayMacros } from '@/domain/food';
import { resolveReminders } from '@/domain/reminders';
import { createCoachActions } from './actions';

const NOW = () => new Date(2026, 10, 2, 19, 0, 0);
const TODAY = toDateKey(NOW());

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
  await db.supplements.clear();
  await db.recipes.clear();
});

const actions = () => createCoachActions({ now: NOW });

describe('supplements', () => {
  it('adds one, changes its time and dose, and removes it', async () => {
    const a = actions();
    expect(await a.editSupplement({ action: 'add', name: 'Creatine', dose: '5 g', time: 'morning' })).toMatchObject({ ok: true, description: 'Added Creatine 5 g to supplements' });
    expect(await a.editSupplement({ action: 'add', name: 'creatine' })).toMatchObject({ ok: true, result: expect.stringContaining('already') });
    expect((await a.editSupplement({ action: 'change', name: 'creatine', time: 'evening', dose: '3 g' })).ok).toBe(true);
    expect((await db.supplements.toArray()).map((s) => [s.name, s.dose, s.time, s.source])).toEqual([['Creatine', '3 g', 'evening', 'coach']]);
    expect((await a.editSupplement({ action: 'remove', name: 'Creatine' })).ok).toBe(true);
    expect((await db.supplements.toArray())[0]!.archived).toBe(true);
    expect(await a.editSupplement({ action: 'remove', name: 'Fish oil' })).toMatchObject({ ok: false, result: expect.stringContaining('none') });
  });
});

describe('routines', () => {
  it('renames, copies, deletes and restores a routine, and refuses a name already taken', async () => {
    const a = actions();
    expect(await a.manageRoutine({ routine: 'upper (push)', action: 'rename', newName: 'Push A' })).toMatchObject({ ok: true, description: 'Renamed Upper (Push) to Push A' });
    expect((await a.manageRoutine({ routine: 'Push A', action: 'rename', newName: 'Lower (Squat)' })).ok).toBe(false);
    expect((await a.manageRoutine({ routine: 'Push A', action: 'copy' })).ok).toBe(true);
    expect((await listRoutines()).filter((r) => r.name.startsWith('Push A'))).toHaveLength(2);
    // Never trained: gone for good, nothing to restore.
    expect(await a.manageRoutine({ routine: 'Upper (Pull)', action: 'delete' })).toMatchObject({ ok: true, result: expect.stringContaining('for good') });
    expect((await a.manageRoutine({ routine: 'Upper (Pull)', action: 'restore' })).ok).toBe(false);
    // Trained: hidden with its history, and back on request.
    expect(await a.logPastSession({ date: '2026-11-01', routine: 'Lower (Squat)', asPlanned: false, exercises: [{ name: 'Barbell Back Squat', sets: [{ weightKg: 100, reps: 5 }] }] })).toMatchObject({ ok: true });
    expect(await a.manageRoutine({ routine: 'Lower (Squat)', action: 'delete' })).toMatchObject({ ok: true, result: expect.stringContaining('can be restored') });
    expect((await listRoutines()).some((r) => r.name === 'Lower (Squat)')).toBe(false);
    expect((await a.manageRoutine({ routine: 'Lower (Squat)', action: 'restore' })).ok).toBe(true);
    expect((await listRoutines()).some((r) => r.name === 'Lower (Squat)')).toBe(true);
    expect(await listArchivedRoutines()).toEqual([]);
    // Deleting takes the exact name: "Arms" is not "Arms (Day 5)".
    expect(await a.manageRoutine({ routine: 'Arms', action: 'delete' })).toMatchObject({ ok: false, result: expect.stringContaining('Arms (Day 5)') });
    expect((await listRoutines()).some((r) => r.name === 'Arms (Day 5)')).toBe(true);
  });
});

describe('recipes', () => {
  it('logs a share at the recipe\'s own figures, and deletes a recipe', async () => {
    const a = actions();
    await saveRecipe({ name: 'Chilli', portionsMade: 4, ingredients: [{ id: 'mince', name: 'Beef mince', source: 'table', grams: 1000, per100: { kcal: 200, protein: 20, carbs: 0, fat: 13 } }] });
    const out = await a.recipe({ action: 'log', recipe: 'chilli', portions: 1, slot: 'dinner' });
    expect(out).toMatchObject({ ok: true, result: expect.stringContaining('500 kcal, 50 g protein') });
    const item = (await mealsOnDay(TODAY)).flatMap((m) => m.items)[0]!;
    expect([item.name, displayMacros(item.nutrition).kcal]).toEqual(['Chilli', 500]);
    expect((await a.recipe({ action: 'log', recipe: 'Chilli', portions: 0 })).ok).toBe(false);
    expect((await a.recipe({ action: 'delete', recipe: 'Chil' })).ok).toBe(false);
    expect((await a.recipe({ action: 'delete', recipe: 'Chilli' })).ok).toBe(true);
    expect(await db.recipes.count()).toBe(0);
    // What was eaten stays.
    expect((await mealsOnDay(TODAY)).flatMap((m) => m.items)).toHaveLength(1);
  });
});

describe('reminders', () => {
  it('turns one off and moves another, and refuses what does not fit', async () => {
    const a = actions();
    expect(await a.setReminder({ reminder: 'food', on: false })).toMatchObject({ ok: true, description: 'food reminder off' });
    expect(await a.setReminder({ reminder: 'training', on: true, time: '18:00', afterDays: 3 })).toMatchObject({ ok: true, description: 'training reminder: 18:00 after 3 days without a session' });
    expect(await a.setReminder({ reminder: 'weigh_in', on: true, weekday: 0, time: '09:00' })).toMatchObject({ ok: true, description: 'weigh-in reminder: Sunday 09:00' });
    expect((await a.setReminder({ reminder: 'food', on: true, time: '9pm' })).ok).toBe(false);
    expect((await a.setReminder({ reminder: 'food', on: true, weekday: 2 })).ok).toBe(false);
    const prefs = resolveReminders((await getSettings()).reminders);
    expect(prefs).toMatchObject({ food: { on: false }, training: { on: true, time: '18:00', afterDays: 3 }, weighIn: { weekday: 0, time: '09:00' } });
  });
});

describe('the session', () => {
  it('starts a routine and opens it, opens the finish screen once a set is in, and discards on request', async () => {
    const a = actions();
    expect((await a.session({ action: 'finish' })).ok).toBe(false);
    const started = await a.session({ action: 'start', routine: 'push' });
    const live = (await getActiveSession())!;
    expect(started).toMatchObject({ ok: true, open: `/session/${live.id}`, description: 'Started Upper (Push)' });
    expect((await a.session({ action: 'start', routine: 'Lower (Squat)' })).ok).toBe(false);
    expect(await a.session({ action: 'finish' })).toMatchObject({ ok: false, result: expect.stringContaining('no sets') });

    const { rx, exercise } = (await routineItems(live.routineId))[0]!;
    await logSet({ sessionId: live.id, routineExerciseId: rx.id, exerciseId: exercise.id, type: 'working', weight: 60, reps: 8 });
    expect(await a.session({ action: 'finish' })).toMatchObject({ ok: true, open: `/session/${live.id}/summary` });
    // Finishing is the owner's Save on that screen: nothing is finished yet.
    expect((await db.sessions.get(live.id))!.endedAt).toBeUndefined();

    expect(await a.session({ action: 'discard' })).toMatchObject({ ok: true, description: 'Discarded Upper (Push)' });
    expect(await getActiveSession()).toBeUndefined();
    expect(await db.setLogs.where('sessionId').equals(live.id).count()).toBe(0);
  });
});
