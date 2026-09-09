/**
 * Nutrition data access. All meal writes go through here; screens read with useLiveQuery.
 *
 * The shape to notice: a meal's totals are never stored. `dayTotals` sums the items every
 * time it is asked. That is what makes editing an item correct by construction rather than
 * by remembering to recalculate, and it is cheap — a day holds tens of rows, not thousands.
 */
import { db } from './db';
import { nowIso, toDateKey } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import { ZERO, addMacros, macrosOf, type FoodSource, type Macros, type Nutrition } from '@/domain/food';
import type { Meal, MealItem, MealSlot } from '@/domain/types';

/** What a meal is made of, as the UI wants it: the meal plus its items in order. */
export interface MealWithItems {
  meal: Meal;
  items: MealItem[];
  macros: Macros;
}

export interface NewMealItem {
  name: string;
  portion: string;
  nutrition: Nutrition;
  source?: FoodSource;
  brand?: string;
  product?: string;
}

export interface NewMeal {
  name: string;
  /** Defaults to today. Passing a past day is a first-class case, not a workaround. */
  date?: string;
  slot?: MealSlot;
  notes?: string;
  enteredText?: string;
  photoPath?: string;
  confidence?: Meal['confidence'];
}

// ---------------------------------------------------------------------------
// Reads

export async function itemsForMeal(mealId: string): Promise<MealItem[]> {
  const items = await db.mealItems.where('mealId').equals(mealId).toArray();
  return items.sort((a, b) => a.index - b.index);
}

/** Every meal on a day, oldest first, each with its items and derived macros. */
export async function mealsOnDay(date: string): Promise<MealWithItems[]> {
  const meals = (await db.meals.where('date').equals(date).toArray()).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  if (!meals.length) return [];
  // One query for the whole day rather than one per meal.
  const ids = new Set(meals.map((m) => m.id));
  const all = await db.mealItems.where('mealId').anyOf([...ids]).toArray();
  const byMeal = new Map<string, MealItem[]>();
  for (const item of all) {
    const list = byMeal.get(item.mealId);
    if (list) list.push(item);
    else byMeal.set(item.mealId, [item]);
  }
  return meals.map((meal) => {
    const items = (byMeal.get(meal.id) ?? []).sort((a, b) => a.index - b.index);
    return { meal, items, macros: sumItems(items) };
  });
}

export function sumItems(items: MealItem[]): Macros {
  return items.reduce((acc, i) => addMacros(acc, macrosOf(i.nutrition)), ZERO);
}

/** Everything eaten on a day. Derived from the items every time; never stored. */
export async function dayTotals(date: string): Promise<Macros> {
  const meals = await mealsOnDay(date);
  return meals.reduce((acc, m) => addMacros(acc, m.macros), ZERO);
}

export async function getMeal(id: string): Promise<MealWithItems | undefined> {
  const meal = await db.meals.get(id);
  if (!meal) return undefined;
  const items = await itemsForMeal(id);
  return { meal, items, macros: sumItems(items) };
}

/** Days that have any meal logged, newest first. Drives the Food tab's history list. */
export async function loggedDays(limit = 30): Promise<string[]> {
  const dates = new Set<string>();
  // Walk the date index backwards so a long history costs only the days we show.
  await db.meals
    .orderBy('date')
    .reverse()
    .until(() => dates.size >= limit, true)
    .each((m) => dates.add(m.date));
  return [...dates].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Writes

/**
 * Create a meal and its items in one transaction, so a meal can never exist with half its
 * food. Returns the new meal id.
 */
export async function addMeal(meal: NewMeal, items: NewMealItem[]): Promise<string> {
  const id = uuid();
  const row: Meal = {
    id,
    date: meal.date ?? toDateKey(),
    loggedAt: nowIso(),
    name: meal.name.trim() || 'Meal',
    ...(meal.slot ? { slot: meal.slot } : {}),
    ...(meal.notes ? { notes: meal.notes } : {}),
    ...(meal.enteredText ? { enteredText: meal.enteredText } : {}),
    ...(meal.photoPath ? { photoPath: meal.photoPath } : {}),
    ...(meal.confidence ? { confidence: meal.confidence } : {}),
  };
  const itemRows = items.map((it, index) => toItemRow(uuid(), id, index, it));
  await db.transaction('rw', [db.meals, db.mealItems], async () => {
    await db.meals.put(row);
    if (itemRows.length) await db.mealItems.bulkPut(itemRows);
  });
  return id;
}

function toItemRow(id: string, mealId: string, index: number, it: NewMealItem): MealItem {
  return {
    id,
    mealId,
    index,
    name: it.name.trim(),
    portion: it.portion.trim(),
    source: it.source ?? 'user',
    nutrition: it.nutrition,
    ...(it.brand ? { brand: it.brand } : {}),
    ...(it.product ? { product: it.product } : {}),
  };
}

export async function updateMeal(id: string, patch: Partial<Omit<Meal, 'id'>>): Promise<void> {
  await db.meals.update(id, patch);
}

/** Add one food to an existing meal, appended at the end. */
export async function addItem(mealId: string, item: NewMealItem): Promise<string> {
  const id = uuid();
  await db.transaction('rw', db.mealItems, async () => {
    const existing = await db.mealItems.where('mealId').equals(mealId).toArray();
    const index = existing.reduce((max, i) => Math.max(max, i.index), -1) + 1;
    await db.mealItems.put(toItemRow(id, mealId, index, item));
  });
  return id;
}

/**
 * Edit one food. Every number on the Today screen follows automatically, because none of
 * them are stored — this is the "edit anything, before or after saving" both handovers
 * asked for, and it needs no recalculation step.
 */
export async function updateItem(id: string, patch: Partial<Omit<MealItem, 'id' | 'mealId' | 'index'>>): Promise<void> {
  await db.mealItems.update(id, patch);
}

/** Remove one food. Removing the last one leaves an empty meal rather than deleting it. */
export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.mealItems, async () => {
    const item = await db.mealItems.get(id);
    if (!item) return;
    await db.mealItems.delete(id);
    // Close the gap so indexes stay 0..n-1 and a later append cannot collide.
    const rest = (await db.mealItems.where('mealId').equals(item.mealId).toArray()).sort((a, b) => a.index - b.index);
    await db.mealItems.bulkPut(rest.map((r, index) => ({ ...r, index })));
  });
}

/** Delete a meal and everything in it. */
export async function deleteMeal(id: string): Promise<void> {
  await db.transaction('rw', [db.meals, db.mealItems], async () => {
    const items = await db.mealItems.where('mealId').equals(id).toArray();
    await db.mealItems.bulkDelete(items.map((i) => i.id));
    await db.meals.delete(id);
  });
}

/** Copy a meal onto another day — the fastest route to logging a repeated breakfast. */
export async function repeatMeal(id: string, date: string): Promise<string | undefined> {
  const existing = await getMeal(id);
  if (!existing) return undefined;
  return addMeal(
    { name: existing.meal.name, date, slot: existing.meal.slot, notes: existing.meal.notes },
    existing.items.map((i) => ({
      name: i.name,
      portion: i.portion,
      nutrition: i.nutrition,
      source: i.source,
      brand: i.brand,
      product: i.product,
    })),
  );
}
