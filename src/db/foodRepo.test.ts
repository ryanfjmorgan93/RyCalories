import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addItem,
  addMeal,
  copyDay,
  dayTotals,
  deleteItem,
  deleteMeal,
  forgetFood,
  getMeal,
  itemsForMeal,
  loggedDays,
  mealCountOnDay,
  mealsOnDay,
  recentMeals,
  repeatMeal,
  suggestFoods,
  sumItems,
  updateItem,
  updateMeal,
  type NewMealItem,
} from './foodRepo';
import { wipeAll } from './repo';
import { displayMacros, fromPer100, fromPortion, gramsOf, macrosOf, withGrams } from '@/domain/food';
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

    // Half the weight, half the calories, and the stored weight agrees with them. The total is at
    // display precision (189.5 → 190) so that what is shown adds up; the underlying portion keeps
    // its exact value.
    expect((await dayTotals(TODAY)).kcal).toBe(190);
    const after = (await itemsForMeal(id))[0]!;
    expect(gramsOf(after.nutrition)).toBe(50);
    expect(macrosOf(after.nutrition).kcal).toBeCloseTo((OATS.kcal * 50) / 100, 6);
  });

  it('always equal the sum of the parts as displayed', async () => {
    // Independently rounding each item and the total is individually honest and collectively
    // wrong: four rows reading 289 + 286 + 50 + 106 under a total of 730 is a maths error to
    // anyone reading it. These weights are chosen so every item lands on a .x fraction.
    const items: NewMealItem[] = [
      { name: 'Chicken', portion: '175 g', nutrition: fromPer100({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, 175) },
      { name: 'Rice', portion: '220 g', nutrition: fromPer100({ kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, 220) },
      { name: 'Courgette', portion: '150 g', nutrition: fromPer100({ kcal: 33, protein: 2.4, carbs: 6, fat: 0.4 }, 150) },
      { name: 'Olive oil', portion: '12 g', nutrition: fromPer100({ kcal: 884, protein: 0, carbs: 0, fat: 100 }, 12) },
    ];
    const id = await addMeal({ name: 'Lunch' }, items);
    const rows = await itemsForMeal(id);

    const shownParts = rows.map((r) => displayMacros(r.nutrition));
    const shownTotal = sumItems(rows);
    for (const key of ['kcal', 'protein', 'carbs', 'fat'] as const) {
      const summed = shownParts.reduce((n, m) => n + m[key], 0);
      expect(shownTotal[key]).toBe(summed);
    }

    // And the day total is the sum of the meal totals, so the day screen adds up too.
    expect((await dayTotals(TODAY)).kcal).toBe(shownTotal.kcal);
  });

  it('ignore meals on other days', async () => {
    await addMeal({ name: 'Old', date: '2026-03-01' }, [oats(100)]);
    expect((await dayTotals(TODAY)).kcal).toBe(0);
  });
});

describe('the order meals appear in', () => {
  it('follows the slot, not the order they were typed', async () => {
    // Back-filling a past day stamps every meal with the same catch-up timestamp, so ordering by
    // loggedAt alone put dinner above breakfast on exactly the day the feature exists for.
    await addMeal({ name: 'Dinner', date: '2026-03-01', slot: 'dinner' }, []);
    await addMeal({ name: 'Breakfast', date: '2026-03-01', slot: 'breakfast' }, []);
    await addMeal({ name: 'Lunch', date: '2026-03-01', slot: 'lunch' }, []);
    expect((await mealsOnDay('2026-03-01')).map((m) => m.meal.name)).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('puts unslotted meals after the slotted ones, in the order they were recorded', async () => {
    const a = await addMeal({ name: 'Unlabelled A', date: '2026-03-02' }, []);
    const b = await addMeal({ name: 'Unlabelled B', date: '2026-03-02' }, []);
    await addMeal({ name: 'Dinner', date: '2026-03-02', slot: 'dinner' }, []);
    // Timestamps set explicitly: two addMeal calls can land in the same millisecond, and meals
    // that share a loggedAt have no recorded order to recover — the sort falls through to the id.
    await db.meals.update(a, { loggedAt: '2026-03-02T09:00:00.000Z' });
    await db.meals.update(b, { loggedAt: '2026-03-02T15:00:00.000Z' });
    expect((await mealsOnDay('2026-03-02')).map((m) => m.meal.name)).toEqual(['Dinner', 'Unlabelled A', 'Unlabelled B']);
  });

  it('orders two meals in the same slot by when they were logged', async () => {
    const first = await addMeal({ name: 'Snack one', date: '2026-03-03', slot: 'snack' }, []);
    const second = await addMeal({ name: 'Snack two', date: '2026-03-03', slot: 'snack' }, []);
    // addMeal stamps from the clock, and two writes can land in the same millisecond, so set the
    // times explicitly rather than testing the machine's timer resolution.
    await db.meals.update(first, { loggedAt: '2026-03-03T10:00:00.000Z' });
    await db.meals.update(second, { loggedAt: '2026-03-03T16:00:00.000Z' });
    expect((await mealsOnDay('2026-03-03')).map((m) => m.meal.name)).toEqual(['Snack one', 'Snack two']);
  });

  it('is stable when two meals share a timestamp', async () => {
    await addMeal({ name: 'A', date: '2026-03-04', slot: 'snack' }, []);
    await addMeal({ name: 'B', date: '2026-03-04', slot: 'snack' }, []);
    await db.meals.toCollection().modify({ loggedAt: '2026-03-04T10:00:00.000Z' });
    const once = (await mealsOnDay('2026-03-04')).map((m) => m.meal.name);
    const twice = (await mealsOnDay('2026-03-04')).map((m) => m.meal.name);
    expect(once).toEqual(twice);
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

describe('remembering food', () => {
  it('remembers a weighed food the first time it is logged', async () => {
    await addMeal({ name: 'Breakfast' }, [oats(80)]);
    const remembered = await suggestFoods('');
    expect(remembered.map((f) => f.name)).toEqual(['Oats']);
    expect(remembered[0]!.per100).toEqual(OATS);
    expect(remembered[0]!.typicalGrams).toBe(80);
    expect(remembered[0]!.timesUsed).toBe(1);
  });

  it('counts repeats instead of duplicating the entry', async () => {
    await addMeal({ name: 'Monday' }, [oats(80)]);
    await addMeal({ name: 'Tuesday' }, [oats(65)]);
    const remembered = await suggestFoods('');
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.timesUsed).toBe(2);
    // The suggested weight follows the most recent portion, which is what was actually eaten.
    expect(remembered[0]!.typicalGrams).toBe(65);
  });

  it('does not remember an unweighed portion', async () => {
    await addMeal({ name: 'Snack' }, [shake()]);
    expect(await suggestFoods('')).toEqual([]);
  });

  it('remembers a food added to an existing meal', async () => {
    const id = await addMeal({ name: 'Lunch' }, []);
    await addItem(id, oats(50));
    expect((await suggestFoods('oat')).map((f) => f.name)).toEqual(['Oats']);
  });

  it('remembers a correction, and lets it overwrite a guess', async () => {
    const id = await addMeal({ name: 'Lunch' }, [{ ...oats(100), source: 'model' }]);
    const row = (await itemsForMeal(id))[0]!;
    await updateItem(row.id, { nutrition: fromPer100({ kcal: 500, protein: 20, carbs: 50, fat: 20 }, 100), source: 'user' });
    const remembered = await suggestFoods('oat');
    expect(remembered[0]!.per100.kcal).toBe(500);
    expect(remembered[0]!.source).toBe('user');
  });

  it('does not let a later guess undo that correction', async () => {
    await addMeal({ name: 'A' }, [{ ...oats(100), source: 'user' }]);
    await addMeal({ name: 'B' }, [{ ...oats(100), source: 'model', nutrition: fromPer100({ kcal: 1, protein: 0, carbs: 0, fat: 0 }, 100) }]);
    const remembered = await suggestFoods('oat');
    expect(remembered[0]!.per100).toEqual(OATS);
    expect(remembered[0]!.timesUsed).toBe(2);
  });

  it('survives a meal that cannot be remembered without failing the meal', async () => {
    const id = await addMeal({ name: 'Mixed' }, [shake(), oats(80)]);
    expect((await itemsForMeal(id))).toHaveLength(2);
    expect((await suggestFoods('')).map((f) => f.name)).toEqual(['Oats']);
  });

  it('remembers a count-style amount as unitGrams/unitLabel, without persisting unit on the row', async () => {
    const eggs: NewMealItem = {
      name: 'Eggs',
      portion: '3 eggs',
      nutrition: fromPer100({ kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 }, 150),
      source: 'table',
      unit: { count: 3, unitGrams: 50, label: 'egg', plural: 'eggs' },
    };
    const id = await addMeal({ name: 'Breakfast' }, [eggs]);
    const remembered = await suggestFoods('egg');
    expect(remembered[0]!.unitGrams).toBe(50);
    expect(remembered[0]!.unitLabel).toBe('egg');
    expect(remembered[0]!.unitPlural).toBe('eggs');

    // NewMealItem.unit is a seam into rememberFood only — MealItem itself carries no such field.
    const row = (await itemsForMeal(id))[0]!;
    expect(row).not.toHaveProperty('unit');
  });
});

describe('a barcode typed in against a food', () => {
  const CODE = '5099999999994';

  it('is remembered with the food and never written to the logged row', async () => {
    const id = await addMeal({ name: 'Snack' }, [{ ...oats(100), name: 'Chicken fries', barcode: CODE }]);
    expect((await suggestFoods('chicken'))[0]!.barcode).toBe(CODE);
    expect((await itemsForMeal(id))[0]!).not.toHaveProperty('barcode');
  });

  it('survives the food being logged again without one', async () => {
    await addMeal({ name: 'Snack' }, [{ ...oats(100), name: 'Chicken fries', barcode: CODE }]);
    await addMeal({ name: 'Snack' }, [{ ...oats(100), name: 'Chicken fries' }]);
    const remembered = await suggestFoods('chicken');
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.timesUsed).toBe(2);
    expect(remembered[0]!.barcode).toBe(CODE);
  });

  it('is remembered when it comes with the edit of a saved food, too', async () => {
    const mealId = await addMeal({ name: 'Snack' }, [{ ...oats(100), name: 'Chicken fries' }]);
    const row = (await itemsForMeal(mealId))[0]!;
    expect((await suggestFoods('chicken'))[0]!.barcode).toBeUndefined();

    await updateItem(row.id, { portion: '120 g' }, { barcode: CODE });

    expect((await suggestFoods('chicken'))[0]!.barcode).toBe(CODE);
    expect((await itemsForMeal(mealId))[0]!).not.toHaveProperty('barcode');
  });
});

describe('recipeId on a logged item', () => {
  it('is persisted when set, conditionally like brand/product', async () => {
    const id = await addMeal({ name: 'Lunch' }, [{ ...oats(80), recipeId: 'recipe-1' }]);
    expect((await itemsForMeal(id))[0]!.recipeId).toBe('recipe-1');
  });

  it('is absent (not merely undefined) when not set', async () => {
    const id = await addMeal({ name: 'Lunch' }, [oats(80)]);
    const row = (await itemsForMeal(id))[0]!;
    expect(row).not.toHaveProperty('recipeId');
  });
});

describe('editing a food keeps its identity in step', () => {
  it('persists a brand typed on a saved food', async () => {
    const id = await addMeal({ name: 'Snack' }, [oats(50)]);
    const row = (await itemsForMeal(id))[0]!;
    await updateItem(row.id, { name: 'Oats', portion: '50 g', nutrition: row.nutrition, source: 'user', brand: 'Quaker', product: 'Porridge Oats' });
    expect((await itemsForMeal(id))[0]!.brand).toBe('Quaker');
  });

  it('clears a brand the food no longer has, rather than leaving the old one', async () => {
    // Dexie's update MERGES, so an omitted field survives. Applying one product's label to a row
    // that still carried another's brand left the wrong identity on it for ever, and keyed the
    // food memory off the stale pair.
    const id = await addMeal({ name: 'Snack' }, [{ ...oats(50), brand: 'Aldi', product: 'Protein bar' }]);
    const row = (await itemsForMeal(id))[0]!;
    expect(row.brand).toBe('Aldi');

    await updateItem(row.id, { name: 'Oats', portion: '50 g', nutrition: row.nutrition, source: 'user', brand: undefined, product: undefined });
    const after = (await itemsForMeal(id))[0]!;
    expect(after.brand).toBeUndefined();
    expect(after.product).toBeUndefined();
    // The new logging is remembered under the name, not the brand it no longer has. The old
    // entry stays: renaming a food is not evidence you never ate the first one, so it is left
    // for the user to forget deliberately rather than removed on their behalf.
    const keys = (await suggestFoods('')).map((f) => f.key);
    expect(keys).toContain('n:oats');
    expect(keys).toContain('p:aldi protein bar');
  });
});

describe('forgetting a food', () => {
  it('removes it from the suggestions', async () => {
    await addMeal({ name: 'Breakfast' }, [oats(80)]);
    const [remembered] = await suggestFoods('');
    expect(remembered).toBeTruthy();

    await forgetFood(remembered!.id);
    expect(await suggestFoods('')).toEqual([]);
  });

  it('leaves the meals that used it alone', async () => {
    const id = await addMeal({ name: 'Breakfast' }, [oats(80)]);
    const [remembered] = await suggestFoods('');
    await forgetFood(remembered!.id);
    expect((await itemsForMeal(id))).toHaveLength(1);
    expect((await dayTotals(TODAY)).kcal).toBe(303);
  });

  it('does not mind being asked twice', async () => {
    await addMeal({ name: 'Breakfast' }, [oats(80)]);
    const [remembered] = await suggestFoods('');
    await forgetFood(remembered!.id);
    await expect(forgetFood(remembered!.id)).resolves.toBeUndefined();
  });
});

describe('recent meals, for repeating one', () => {
  it('offers a meal eaten on another day', async () => {
    await addMeal({ name: 'Breakfast', date: '2026-03-01', slot: 'breakfast' }, [oats(80), shake()]);
    const recent = await recentMeals(TODAY);
    expect(recent.map((m) => m.meal.name)).toEqual(['Breakfast']);
    expect(recent[0]!.macros.kcal).toBe(423);
  });

  it('never offers a meal already on the day being viewed', async () => {
    await addMeal({ name: 'Breakfast', date: TODAY }, [oats(80)]);
    expect(await recentMeals(TODAY)).toEqual([]);
  });

  it('collapses the same meal eaten repeatedly into one entry', async () => {
    // Porridge every morning should be one row, not thirty.
    for (const date of ['2026-03-01', '2026-03-02', '2026-03-03']) {
      await addMeal({ name: 'Breakfast', date }, [oats(80)]);
    }
    expect(await recentMeals(TODAY)).toHaveLength(1);
  });

  it('keeps two different meals that happen to share a name', async () => {
    await addMeal({ name: 'Lunch', date: '2026-03-01' }, [oats(80)]);
    await addMeal({ name: 'Lunch', date: '2026-03-02' }, [shake()]);
    expect(await recentMeals(TODAY)).toHaveLength(2);
  });

  it('treats the same food at a different weight as a different meal', async () => {
    await addMeal({ name: 'Breakfast', date: '2026-03-01' }, [oats(80)]);
    await addMeal({ name: 'Breakfast', date: '2026-03-02' }, [oats(120)]);
    expect(await recentMeals(TODAY)).toHaveLength(2);
  });

  it('leaves out a meal with no food in it', async () => {
    await addMeal({ name: 'Empty', date: '2026-03-01' }, []);
    expect(await recentMeals(TODAY)).toEqual([]);
  });

  it('respects the limit', async () => {
    for (let i = 1; i <= 6; i++) {
      await addMeal({ name: `Meal ${i}`, date: `2026-03-0${i}` }, [oats(80 + i)]);
    }
    expect(await recentMeals(TODAY, 3)).toHaveLength(3);
  });

  it('copies onto the day being viewed, not onto today', async () => {
    await addMeal({ name: 'Breakfast', date: '2026-03-01' }, [oats(80)]);
    const [recent] = await recentMeals('2026-03-05');
    await repeatMeal(recent!.meal.id, '2026-03-05');
    expect((await mealsOnDay('2026-03-05')).map((m) => m.meal.name)).toEqual(['Breakfast']);
    expect(await dayTotals(TODAY)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('copying a day', () => {
  const FROM = '2026-03-01';
  const TO = '2026-03-02';

  it('copies every meal with its items and macros exactly, and leaves the original day alone', async () => {
    await addMeal({ name: 'Breakfast', slot: 'breakfast', notes: 'with honey', date: FROM }, [oats(100), shake()]);
    await addMeal(
      { name: 'Lunch', slot: 'lunch', date: FROM },
      [{ name: 'Beans', portion: '1 tin', nutrition: fromPortion({ kcal: 312, protein: 20, carbs: 44, fat: 1.4 }), source: 'label', brand: 'Heinz', product: 'Baked Beans' }],
    );
    const before = await mealsOnDay(FROM);

    expect(await copyDay(FROM, TO)).toBe(2);

    const copies = await mealsOnDay(TO);
    expect(copies.map((m) => m.meal.name)).toEqual(['Breakfast', 'Lunch']);
    expect(copies.map((m) => m.meal.slot)).toEqual(['breakfast', 'lunch']);
    expect(copies[0]!.meal.notes).toBe('with honey');
    copies.forEach((c, i) => {
      // Items exactly as logged: same foods, same portions, same figures, same provenance.
      const strip = (items: typeof c.items) => items.map(({ id: _id, mealId: _mealId, ...rest }) => rest);
      expect(strip(c.items)).toEqual(strip(before[i]!.items));
      expect(c.macros).toEqual(before[i]!.macros);
      expect(c.meal.id).not.toBe(before[i]!.meal.id);
      expect(c.items.every((it) => it.mealId === c.meal.id)).toBe(true);
    });
    expect(await dayTotals(TO)).toEqual(await dayTotals(FROM));
    expect(copies[1]!.items[0]).toMatchObject({ source: 'label', brand: 'Heinz', product: 'Baked Beans' });

    // The original day is exactly what it was.
    expect(await mealsOnDay(FROM)).toEqual(before);
  });

  it('keeps a day with no meal slots in the order it was eaten', async () => {
    // Slotless meals sort by loggedAt. Written in one millisecond they would fall back to random
    // ids, so the copied day would shuffle. Six meals, seeded out of alphabetical order, so a
    // shuffle cannot pass by luck (1 in 720).
    const names = ['F', 'B', 'E', 'A', 'D', 'C'];
    for (const [i, name] of names.entries()) {
      const id = await addMeal({ name, date: FROM }, [oats(50 + i)]);
      await db.meals.update(id, { loggedAt: `2026-03-01T08:00:0${i}.000Z` });
    }
    expect((await mealsOnDay(FROM)).map((m) => m.meal.name)).toEqual(names);

    expect(await copyDay(FROM, TO)).toBe(6);
    expect((await mealsOnDay(TO)).map((m) => m.meal.name)).toEqual(names);
  });

  it('is atomic: a meal that cannot be written rolls back the meals copied before it', async () => {
    const a = await addMeal({ name: 'Breakfast', slot: 'breakfast', date: FROM }, [oats(), shake()]);
    const b = await addMeal({ name: 'Lunch', slot: 'lunch', date: FROM }, [oats(60)]);
    // The second meal throws once copyDay reaches it: a row with no name, which the app never
    // writes, so it stands in for "the write failed part-way through the day".
    await db.meals.update(b, { name: null as unknown as string });
    const mealsBefore = await db.meals.count();
    const itemsBefore = await db.mealItems.count();

    await expect(copyDay(FROM, TO)).rejects.toThrow();

    expect(await db.meals.where('date').equals(TO).count()).toBe(0);
    expect(await db.meals.count()).toBe(mealsBefore);
    expect(await db.mealItems.count()).toBe(itemsBefore);
    expect((await getMeal(a))?.items).toHaveLength(2);
  });

  it('returns 0 and writes nothing when the day has no meals', async () => {
    await addMeal({ name: 'Elsewhere', date: '2026-03-09' }, [oats()]);
    expect(await copyDay(FROM, TO)).toBe(0);
    expect(await db.meals.count()).toBe(1);
    expect(await db.mealItems.count()).toBe(1);
  });

  it('copies nothing when asked to copy a day onto itself', async () => {
    await addMeal({ name: 'Breakfast', date: FROM }, [oats()]);
    expect(await copyDay(FROM, FROM)).toBe(0);
    expect(await mealsOnDay(FROM)).toHaveLength(1);
  });

  it('adds to a day that already has food rather than replacing it', async () => {
    await addMeal({ name: 'Yesterday breakfast', slot: 'breakfast', date: FROM }, [oats()]);
    await addMeal({ name: 'Already here', slot: 'snack', date: TO }, [shake()]);
    expect(await copyDay(FROM, TO)).toBe(1);
    expect((await mealsOnDay(TO)).map((m) => m.meal.name)).toEqual(['Yesterday breakfast', 'Already here']);
  });

  it('counts the meals on a day', async () => {
    await addMeal({ name: 'A', date: FROM }, []);
    await addMeal({ name: 'B', date: FROM }, [oats()]);
    await addMeal({ name: 'C', date: TO }, []);
    expect(await mealCountOnDay(FROM)).toBe(2);
    expect(await mealCountOnDay('2026-03-09')).toBe(0);
  });
});
