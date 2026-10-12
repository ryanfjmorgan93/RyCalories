import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logItemsToSlot, undoLoggedItems, type NewMealItem } from '@/db/foodRepo';
import { wipeAll } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { fromPer100 } from '@/domain/food';
import { clearMealMoment, freshMoment, noteMealLogged, SHOWN_MS, takeMealMoment, useMealMoment } from './mealMoment';

const TODAY = toDateKey();

function item(name: string, grams: number, source: NewMealItem['source'] = 'user'): NewMealItem {
  return { name, portion: `${grams} g`, nutrition: fromPer100({ kcal: 200, protein: 20, carbs: 10, fat: 5 }, grams), source };
}

beforeEach(async () => {
  await wipeAll();
  clearMealMoment();
});

describe('the facts taken after a meal', () => {
  it('are the whole meal and the day so far, fixed at that moment', async () => {
    const first = await logItemsToSlot(TODAY, 'dinner', [item('Chicken', 150)]);
    const second = await logItemsToSlot(TODAY, 'dinner', [item('Rice', 100, 'model')]);

    const moment = await takeMealMoment(second.mealId, second.itemIds);
    expect(moment).not.toBeNull();
    expect(moment!.mealId).toBe(first.mealId);
    expect(moment!.date).toBe(TODAY);
    expect(moment!.facts.meal).toBe('dinner');
    expect(moment!.facts.foods).toEqual(['Chicken: 150 g, 300 kcal', 'Rice: 100 g, 200 kcal']);
    expect(moment!.facts['meal kcal']).toBe(500);
    expect(moment!.facts['day so far kcal']).toBe(500);
    expect(moment!.facts.figures).toContain('estimates');
  });

  it('are nothing when the food was taken back out', async () => {
    const logged = await logItemsToSlot(TODAY, 'lunch', [item('Soup', 300)]);
    await undoLoggedItems(logged);
    expect(await takeMealMoment(logged.mealId, logged.itemIds)).toBeNull();
  });

  it('are nothing for a meal that is not there', async () => {
    expect(await takeMealMoment('missing')).toBeNull();
  });
});

describe('noting a meal', () => {
  it('shows the moment once the settle time has passed, and not before', async () => {
    const logged = await logItemsToSlot(TODAY, 'snack', [item('Yoghurt', 150)]);
    noteMealLogged({ mealId: logged.mealId, itemIds: logged.itemIds, settleMs: 30 });
    expect(useMealMoment.getState().moment).toBeNull();
    // Waiting is a state of its own, so nothing else (the day's comment) speaks in the meantime.
    expect(useMealMoment.getState().pending).toBe(true);
    await vi.waitFor(() => expect(useMealMoment.getState().moment?.mealId).toBe(logged.mealId));
    expect(useMealMoment.getState().pending).toBe(false);
  });

  it('is one comment on the last meal when several are logged together', async () => {
    const a = await logItemsToSlot(TODAY, 'breakfast', [item('Oats', 60)]);
    const b = await logItemsToSlot(TODAY, 'lunch', [item('Wrap', 200)]);
    noteMealLogged({ mealId: a.mealId, itemIds: a.itemIds, settleMs: 30 });
    noteMealLogged({ mealId: b.mealId, itemIds: b.itemIds, settleMs: 30 });
    await vi.waitFor(() => expect(useMealMoment.getState().moment?.mealId).toBe(b.mealId));
  });

  it('says nothing about food that was undone inside the window', async () => {
    const logged = await logItemsToSlot(TODAY, 'snack', [item('Biscuit', 30)]);
    noteMealLogged({ mealId: logged.mealId, itemIds: logged.itemIds, settleMs: 30 });
    await undoLoggedItems(logged);
    await vi.waitFor(() => expect(useMealMoment.getState().pending).toBe(false));
    expect(useMealMoment.getState().moment).toBeNull();
  });

  it('is dropped by clearing, which also stops a comment still waiting', async () => {
    const logged = await logItemsToSlot(TODAY, 'snack', [item('Biscuit', 30)]);
    noteMealLogged({ mealId: logged.mealId, itemIds: logged.itemIds, settleMs: 30 });
    clearMealMoment();
    expect(useMealMoment.getState().pending).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(useMealMoment.getState().moment).toBeNull();
  });
});

describe('how long it stays', () => {
  it('goes stale after twenty minutes', () => {
    const moment = { mealId: 'm', date: TODAY, at: 1_000, facts: {} };
    expect(freshMoment(moment, 1_000 + SHOWN_MS - 1)).toBe(moment);
    expect(freshMoment(moment, 1_000 + SHOWN_MS)).toBeNull();
    expect(freshMoment(null)).toBeNull();
  });
});
