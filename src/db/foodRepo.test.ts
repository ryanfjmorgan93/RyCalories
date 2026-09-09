import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addItem,
  addMeal,
  dayTotals,
  deleteItem,
  deleteMeal,
  getMeal,
  itemsForMeal,
  loggedDays,
  mealsOnDay,
  repeatMeal,
  updateItem,
  updateMeal,
  type NewMealItem,
} from './foodRepo';
import { wipeAll } from './repo';
import { fromPer100, fromPortion, gramsOf, macrosOf, withGrams } from '@/domain/food';
import { toDateKey } from '@/domain/dates';

const OATS = { kcal: 379, protein: 11, carbs: 60, fat: 8 };
const TODAY = toDateKey();

function oats(grams = 80): NewMealItem {
  return { name: 'Oats', portion: `${grams} g`, nutrition: fromPer100(OATS, grams), source: 'label' };
}

function shake(): NewMealItem {
  return { name: 'Whey shake', portion: '1 scoop', nutrition: fromPortion({ kcal: 120, protein: 24, carbs: 3, fat: 1.5 }) };
}

beforeEach(async () => {
  await wipeAll();
});

describe('logging a meal', () => {
  it('stores the meal and its items in order', async () => {
    const id = await addMeal({ name: 'Breakfast', slot: 'breakfast' }, [oats(), shake()]);
    const meal = await getMeal(id);
    expect(meal?.meal.name).toBe('Breakfast');
    expect(meal?.items.map((i) => i.name)).toEqual(['Oats', 'Whey shake']);
    expect(meal?.items.map((i) => i.index)).toEqual([0, 1]);
  });

  it('defaults to today but accepts a past day', async () => {
    await addMeal({ name: 'Now' }, [oats()]);
    await addMeal({ name: 'Yesterday', date: '2026-03-01' }, [oats()]);
    expect((await mealsOnDay(TODAY)).map((m) => m.meal.name)).toEqual(['Now']);
    expect((await mealsOnDay('2026-03-01')).map((m) => m.meal.name)).toEqual(['Yesterday']);
  });

  it('keeps the day it counts towards separate from when it was recorded', async () => {
    // The old app derived the day from the timestamp, which is why it could only log to today.
    const id = await addMeal({ name: 'Late entry', date: '2026-03-01' }, []);
    const meal = await db.meals.get(id);
    expect(meal?.date).toBe('2026-03-01');
    expect(meal?.loggedAt.slice(0, 10)).not.toBe('2026-03-01');
  });

  it('never leaves a meal with only some of its food', async () => {
    const id = await addMeal({ name: 'Dinner' }, [oats(), shake()]);
    // Both rows land in one transaction, so a half-written meal is not a reachable state.
    expect(await db.mealItems.where('mealId').equals(id).count()).toBe(2);
  });

  it('falls back to a name rather than storing a blank one', async () => {
    const id = await addMeal({ name: '   ' }, []);
    expect((await db.meals.get(id))?.name).toBe('Meal');
  });
});

describe('totals', () => {
  it('sum the day across meals', async () => {
    await addMeal({ name: 'Breakfast' }, [oats(100)]);
    await addMeal({ name: 'Snack' }, [shake()]);
    const total = await dayTotals(TODAY);
    expect(total.kcal).toBeCloseTo(499, 6);
    expect(total.protein).toBeCloseTo(35, 6);
  });

  it('are zero on a day with nothing logged', async () => {
    expect(await dayTotals('2020-01-01')).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('follow an edited portion with no recalculation step', async () => {
    const id = await addMeal({ name: 'Breakfast' }, [oats(100)]);
    expect((await dayTotals(TODAY)).kcal).toBeCloseTo(379, 6);

    const item = (await itemsForMeal(id))[0]!;
    await updateItem(item.id, { nutrition: withGrams(item.nutrition, 50) });

    // Half the weight, half the calories, and the stored weight agrees with them.
    expect((await dayTotals(TODAY)).kcal).toBeCloseTo(189.5, 6);
    const after = (await itemsForMeal(id))[0]!;
    expect(gramsOf(after.nutrition)).toBe(50);
    expect(macrosOf(after.nutrition).kcal).toBeCloseTo((OATS.kcal * 50) / 100, 6);
  });

  it('ignore meals on other days', async () => {
    await addMeal({ name: 'Old', date: '2026-03-01' }, [oats(100)]);
    expect((await dayTotals(TODAY)).kcal).toBe(0);
  });
});

describe('editing a meal', () => {
  it('appends a food at the end', async () => {
    const id = await addMeal({ name: 'Lunch' }, [oats()]);
    await addItem(id, shake());
    expect((await itemsForMeal(id)).map((i) => i.index)).toEqual([0, 1]);
  });

  it('closes the gap when a food is removed, so a later append cannot collide', async () => {
    const id = await addMeal({ name: 'Lunch' }, [oats(), shake(), oats(50)]);
    const items = await itemsForMeal(id);
    await deleteItem(items[1]!.id);
    expect((await itemsForMeal(id)).map((i) => i.index)).toEqual([0, 1]);

    await addItem(id, shake());
    const after = await itemsForMeal(id);
    expect(after.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(new Set(after.map((i) => i.index)).size).toBe(3);
  });

  it('leaves an empty meal rather than deleting it when the last food goes', async () => {
    const id = await addMeal({ name: 'Lunch' }, [oats()]);
    await deleteItem((await itemsForMeal(id))[0]!.id);
    expect(await db.meals.get(id)).toBeTruthy();
    expect((await getMeal(id))?.macros.kcal).toBe(0);
  });

  it('moves a meal to another day', async () => {
    const id = await addMeal({ name: 'Dinner' }, [oats(100)]);
    await updateMeal(id, { date: '2026-03-01' });
    expect((await dayTotals(TODAY)).kcal).toBe(0);
    expect((await dayTotals('2026-03-01')).kcal).toBeCloseTo(379, 6);
  });

  it('deletes a meal and its food together, leaving nothing orphaned', async () => {
    const id = await addMeal({ name: 'Dinner' }, [oats(), shake()]);
    await deleteMeal(id);
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
  });
});

describe('repeating a meal', () => {
  it('copies the food onto another day without touching the original', async () => {
    const id = await addMeal({ name: 'Breakfast', slot: 'breakfast' }, [oats(100), shake()]);
    const copyId = await repeatMeal(id, '2026-03-02');

    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(id);
    const copy = await getMeal(copyId!);
    expect(copy?.meal.date).toBe('2026-03-02');
    expect(copy?.meal.slot).toBe('breakfast');
    expect(copy?.macros.kcal).toBeCloseTo(499, 6);

    // Editing the copy must not reach back into the original.
    await updateItem(copy!.items[0]!.id, { nutrition: withGrams(copy!.items[0]!.nutrition, 200) });
    expect((await getMeal(id))?.macros.kcal).toBeCloseTo(499, 6);
  });

  it('returns nothing for a meal that is gone', async () => {
    expect(await repeatMeal('missing', TODAY)).toBeUndefined();
  });
});

describe('logged days', () => {
  it('lists days with food, newest first, without repeating a day', async () => {
    await addMeal({ name: 'A', date: '2026-03-01' }, []);
    await addMeal({ name: 'B', date: '2026-03-01' }, []);
    await addMeal({ name: 'C', date: '2026-03-03' }, []);
    expect(await loggedDays()).toEqual(['2026-03-03', '2026-03-01']);
  });

  it('is empty before anything is logged', async () => {
    expect(await loggedDays()).toEqual([]);
  });
});
