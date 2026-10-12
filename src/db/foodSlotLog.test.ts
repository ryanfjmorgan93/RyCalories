import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addItem,
  addMeal,
  logItemToSlot,
  logItemsToSlot,
  mealsOnDay,
  memoryFor,
  undoLoggedItems,
  updateItem,
  type NewMealItem,
} from './foodRepo';
import { wipeAll } from './repo';
import { toDateKey } from '@/domain/dates';
import { fromPer100, macrosOf } from '@/domain/food';
import { applyLabel, blankDraft, draftToItem, editAmount, editNutrition } from '@/domain/foodDraft';
import { amountPlan, choiceFromLabel, itemFromAmount } from '@/domain/foodChoice';
import { unitOptions } from '@/domain/foodUnits';
import type { LabelNutrition } from '@/domain/products';

const TODAY = toDateKey();
const CHICKEN: LabelNutrition = {
  code: '5000000000001',
  brand: 'Tesco',
  name: 'Chicken Breast Fillets',
  per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  packGrams: 400,
  servingGrams: 100,
};
const OATS = { kcal: 379, protein: 11, carbs: 60, fat: 8 };

function oats(grams = 80): NewMealItem {
  return { name: 'Oats', portion: `${grams} g`, nutrition: fromPer100(OATS, grams), source: 'label' };
}

/** What a tap on "Whole pack (400 g)" logs. */
function wholePack(): NewMealItem {
  const choice = choiceFromLabel(CHICKEN);
  const { options, unit, chips } = amountPlan(choice);
  return itemFromAmount(choice, unit, chips[0]!.qty, options);
}

beforeEach(async () => {
  await wipeAll();
});

describe('logging straight to a day’s slot', () => {
  it('creates the slot’s meal when the day has none', async () => {
    const logged = await logItemToSlot(TODAY, 'lunch', oats());
    expect(logged.createdMeal).toBe(true);
    const meals = await mealsOnDay(TODAY);
    expect(meals).toHaveLength(1);
    expect(meals[0]!.meal).toMatchObject({ name: 'Lunch', slot: 'lunch', date: TODAY });
    expect(meals[0]!.items.map((i) => i.name)).toEqual(['Oats']);
    expect(meals[0]!.items[0]!.id).toBe(logged.itemIds[0]);
  });

  it('appends to the meal that is already there for the slot', async () => {
    const existing = await addMeal({ name: 'Lunch', slot: 'lunch' }, [oats(), oats(40)]);
    const logged = await logItemToSlot(TODAY, 'lunch', wholePack());
    expect(logged).toMatchObject({ mealId: existing, createdMeal: false });
    const meals = await mealsOnDay(TODAY);
    expect(meals).toHaveLength(1);
    expect(meals[0]!.items.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(meals[0]!.items[2]!.name).toBe('Tesco Chicken Breast Fillets');
  });

  it('keeps slots and days apart', async () => {
    await addMeal({ name: 'Lunch', slot: 'lunch' }, [oats()]);
    await addMeal({ name: 'Lunch', slot: 'lunch', date: '2026-01-05' }, [oats()]);
    await logItemToSlot(TODAY, 'dinner', oats());
    await logItemToSlot('2026-01-05', 'lunch', oats(30));
    const today = await mealsOnDay(TODAY);
    expect(today.map((m) => [m.meal.slot, m.items.length])).toEqual([
      ['lunch', 1],
      ['dinner', 1],
    ]);
    const past = await mealsOnDay('2026-01-05');
    expect(past.map((m) => [m.meal.slot, m.items.length])).toEqual([['lunch', 2]]);
  });

  it('goes to the most recently logged meal when a slot has more than one', async () => {
    await addMeal({ name: 'Lunch', slot: 'lunch' }, [oats()]);
    await new Promise((r) => setTimeout(r, 5));
    const second = await addMeal({ name: 'Second lunch', slot: 'lunch' }, [oats()]);
    const logged = await logItemToSlot(TODAY, 'lunch', oats(20));
    expect(logged.mealId).toBe(second);
  });

  it('never makes two meals for one slot when two logs land together', async () => {
    await Promise.all([logItemToSlot(TODAY, 'snack', oats(10)), logItemToSlot(TODAY, 'snack', oats(20))]);
    const meals = await mealsOnDay(TODAY);
    expect(meals).toHaveLength(1);
    expect(meals[0]!.items.map((i) => i.index).sort()).toEqual([0, 1]);
  });

  it('writes the right figures: 400 g of 165 kcal per 100 g is 660 kcal', async () => {
    await logItemToSlot(TODAY, 'dinner', wholePack());
    const [meal] = await mealsOnDay(TODAY);
    expect(meal!.macros.kcal).toBe(660);
    expect(meal!.items[0]).toMatchObject({ portion: '1 pack (400 g)', source: 'label', brand: 'Tesco', product: 'Chicken Breast Fillets' });
    expect(macrosOf(meal!.items[0]!.nutrition).protein).toBeCloseTo(124, 5);
  });

  it('logs several items to one meal at once, with a photo’s extras on a meal it creates', async () => {
    const logged = await logItemsToSlot(TODAY, 'dinner', [oats(), oats(20)], { enteredText: 'oats twice', confidence: 'medium' });
    expect(logged.itemIds).toHaveLength(2);
    const [meal] = await mealsOnDay(TODAY);
    expect(meal!.meal).toMatchObject({ enteredText: 'oats twice', confidence: 'medium' });
    // A meal that exists keeps what it has.
    await logItemsToSlot(TODAY, 'dinner', [oats(5)], { enteredText: 'something else' });
    expect((await mealsOnDay(TODAY))[0]!.meal.enteredText).toBe('oats twice');
  });
});

describe('remembering what was logged', () => {
  it('remembers the food as the other paths do, with the pack, serving and unit', async () => {
    await logItemToSlot(TODAY, 'dinner', wholePack());
    const m = await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' });
    expect(m).toMatchObject({
      name: 'Tesco Chicken Breast Fillets',
      source: 'label',
      typicalGrams: 400,
      packGrams: 400,
      servingGrams: 100,
      lastUnit: 'pack',
      timesUsed: 1,
    });
    expect(m!.per100.kcal).toBe(165);
  });

  it('the next scan offers the pack with no label read at all (offline)', async () => {
    await logItemToSlot(TODAY, 'dinner', wholePack());
    const m = (await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' }))!;
    const plan = amountPlan({ key: 'k', name: m.name, per100: m.per100, source: m.source, origin: 'memory', units: { memory: m } });
    expect(plan.chips.map((c) => c.label)).toEqual(['Whole pack (400 g)', 'Half']);
  });

  it('opens on the unit used last, and counts the use', async () => {
    const choice = choiceFromLabel(CHICKEN);
    const { options } = amountPlan(choice);
    const serving = options.find((o) => o.key === 'serving')!;
    await logItemToSlot(TODAY, 'dinner', wholePack());
    await logItemToSlot(TODAY, 'dinner', itemFromAmount(choice, serving, 1, options));
    const m = (await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' }))!;
    expect(m.lastUnit).toBe('serving');
    expect(m.timesUsed).toBe(2);
    expect(amountPlan(choiceFromLabel(CHICKEN, m)).unit.key).toBe('serving');
  });

  it('learns a count unit from the amount that produced the weight', async () => {
    const eggs: NewMealItem = {
      name: 'Eggs, chicken, whole, raw',
      portion: '2 eggs (100 g)',
      nutrition: fromPer100({ kcal: 131, protein: 12.6, carbs: 0, fat: 9 }, 100),
      source: 'table',
      unit: { count: 2, unitGrams: 50, label: 'egg', plural: 'eggs' },
      units: { lastUnit: 'egg' },
    };
    await logItemToSlot(TODAY, 'breakfast', eggs);
    const m = (await memoryFor({ name: 'Eggs, chicken, whole, raw' }))!;
    expect(m).toMatchObject({ unitGrams: 50, unitLabel: 'egg', unitPlural: 'eggs', lastUnit: 'egg', source: 'table' });
  });

  it('does not write units, the barcode or any other teaching onto the meal row', async () => {
    await logItemToSlot(TODAY, 'dinner', { ...wholePack(), barcode: '5000000000001' });
    const row = (await db.mealItems.toArray())[0]!;
    expect(row).not.toHaveProperty('units');
    expect(row).not.toHaveProperty('unit');
    expect(row).not.toHaveProperty('barcode');
  });

  it('teaches the last unit through an edit as well', async () => {
    const mealId = await addMeal({ name: 'Dinner', slot: 'dinner' }, [wholePack()]);
    const row = (await db.mealItems.where('mealId').equals(mealId).first())!;
    await updateItem(row.id, { portion: '½ pack (200 g)' }, { units: { packGrams: 400, lastUnit: 'g' } });
    expect((await memoryFor(row))!.lastUnit).toBe('g');
  });

  it('adds through the other path too', async () => {
    const mealId = await addMeal({ name: 'Dinner', slot: 'dinner' }, []);
    await addItem(mealId, wholePack());
    expect((await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' }))!.packGrams).toBe(400);
  });
});

describe('Undo', () => {
  it('removes the item and the meal the log created', async () => {
    const logged = await logItemToSlot(TODAY, 'lunch', wholePack());
    await undoLoggedItems(logged);
    expect(await mealsOnDay(TODAY)).toEqual([]);
    expect(await db.mealItems.count()).toBe(0);
  });

  it('removes only the item from a meal that was already there', async () => {
    const existing = await addMeal({ name: 'Lunch', slot: 'lunch' }, [oats(), oats(40)]);
    const logged = await logItemToSlot(TODAY, 'lunch', wholePack());
    await undoLoggedItems(logged);
    const [meal] = await mealsOnDay(TODAY);
    expect(meal!.meal.id).toBe(existing);
    expect(meal!.items.map((i) => i.index)).toEqual([0, 1]);
    expect(meal!.items.map((i) => i.name)).toEqual(['Oats', 'Oats']);
  });

  it('leaves the meal alone when food was put into it after the log', async () => {
    const logged = await logItemToSlot(TODAY, 'lunch', wholePack());
    await logItemToSlot(TODAY, 'lunch', oats());
    await undoLoggedItems(logged);
    const [meal] = await mealsOnDay(TODAY);
    expect(meal!.meal.id).toBe(logged.mealId);
    expect(meal!.items.map((i) => i.name)).toEqual(['Oats']);
    expect(meal!.items[0]!.index).toBe(0);
  });

  it('is harmless twice', async () => {
    const logged = await logItemToSlot(TODAY, 'lunch', wholePack());
    await undoLoggedItems(logged);
    await undoLoggedItems(logged);
    expect(await mealsOnDay(TODAY)).toEqual([]);
  });
});

describe('a scanned label whose weight is edited stays a label’s', () => {
  const scanned = () => applyLabel(blankDraft(), CHICKEN, { fromScan: true });
  const options = () => unitOptions({ packGrams: 400, servingGrams: 100 });

  it('in the item and in the remembered food', async () => {
    // The scan fills the sheet; the owner ate 250 g, not the 100 g serving it opened on.
    const edited = editAmount(scanned(), { grams: 250, unitKey: 'g' });
    const item = draftToItem(edited, { options: options() });
    expect(item.source).toBe('label');

    await addMeal({ name: 'Dinner', slot: 'dinner' }, [item]);
    const m = await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' });
    expect(m!.source).toBe('label');
    expect(m!.typicalGrams).toBe(250);
    expect((await db.mealItems.toArray())[0]!.source).toBe('label');
  });

  it('so a later, better read of the same pack can still replace the figures', async () => {
    const first = draftToItem(editAmount(scanned(), { grams: 250, unitKey: 'g' }), { options: options() });
    await addMeal({ name: 'Dinner', slot: 'dinner' }, [first]);

    // The database corrects the pack's figures; the next scan is logged at the new ones.
    const better = draftToItem(
      editAmount(applyLabel(blankDraft(), { ...CHICKEN, per100: { kcal: 150, protein: 30, carbs: 0, fat: 2 } }, { fromScan: true }), { grams: 250, unitKey: 'g' }),
      { options: options() },
    );
    await addMeal({ name: 'Supper', slot: 'snack' }, [better]);
    const m = await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' });
    expect(m!.per100.kcal).toBe(150);
    expect(m!.source).toBe('label');
  });

  it('whereas overruling a figure does make it the user’s own, and the next label cannot replace it', async () => {
    const mine = draftToItem(editNutrition(scanned(), 'kcal', 120), { options: options() });
    expect(mine.source).toBe('user');
    await addMeal({ name: 'Dinner', slot: 'dinner' }, [mine]);

    await addMeal({ name: 'Supper', slot: 'snack' }, [draftToItem(scanned(), { options: options() })]);
    const m = await memoryFor({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets' });
    expect(m!.per100.kcal).toBe(120);
    expect(m!.source).toBe('user');
  });
});
