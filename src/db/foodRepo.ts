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
import { ZERO, addMacros, displayMacros, type FoodSource, type Macros, type Nutrition } from '@/domain/food';
import { memoryFrom, mergeMemory, rankMemories } from '@/domain/foodMemory';
import { MEAL_SLOTS, type FoodMemory, type Meal, type MealItem, type MealSlot } from '@/domain/types';

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

/**
 * Every meal on a day, in the order they were eaten, each with its items and derived macros.
 *
 * Ordered by slot first and only then by when the row was typed. `loggedAt` is when the meal was
 * RECORDED, which on a back-filled day is the moment the user sat down to catch up — so every meal
 * on Monday can carry a Tuesday-morning timestamp, and sorting by it alone puts Monday's dinner
 * above Monday's breakfast. Meals with no slot sort after the slotted ones, by when they were
 * recorded.
 *
 * The final tie-break on id exists because two meals written in the same millisecond share a
 * loggedAt, and without it their order would come from IndexedDB's key order over random UUIDs —
 * stable for a given database, but arbitrary and untestable.
 */
export async function mealsOnDay(date: string): Promise<MealWithItems[]> {
  const meals = (await db.meals.where('date').equals(date).toArray()).sort(
    (a, b) => slotOrder(a.slot) - slotOrder(b.slot) || a.loggedAt.localeCompare(b.loggedAt) || a.id.localeCompare(b.id),
  );
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

/**
 * A meal's macros. Summed from each item at DISPLAY precision, so the total shown always equals
 * the sum of the item figures shown above it — see displayMacros in the domain for why.
 */
function slotOrder(slot: MealSlot | undefined): number {
  const i = slot ? MEAL_SLOTS.indexOf(slot) : -1;
  return i === -1 ? MEAL_SLOTS.length : i;
}

export function sumItems(items: MealItem[]): Macros {
  return items.reduce((acc, i) => addMacros(acc, displayMacros(i.nutrition)), ZERO);
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
  // After the meal is safely committed, never inside its transaction: remembering is a
  // convenience and must not be able to fail the write the user actually asked for.
  for (const it of itemRows) await rememberFood(it);
  return id;
}

// ---------------------------------------------------------------------------
// Food memory

/**
 * Record that a food was eaten, so it can be offered back next time.
 *
 * Best-effort by design: a failure here must never take a meal down with it. Logging the food is
 * the user's intent; remembering it is a convenience the app adds on top.
 */
export async function rememberFood(item: NewMealItem | MealItem): Promise<void> {
  // NewMealItem's source is optional and defaults the same way toItemRow does, so a food added
  // without one is remembered as the user's own rather than falling through to the least trusted.
  const next = memoryFrom({ ...item, source: item.source ?? 'user' });
  if (!next) return;
  const at = nowIso();
  try {
    await db.transaction('rw', db.foods, async () => {
      const existing = await db.foods.where('key').equals(next.key).first();
      if (existing) await db.foods.put(mergeMemory(existing, next, at));
      else await db.foods.put({ id: uuid(), ...next, timesUsed: 1, lastUsedAt: at });
    });
  } catch {
    // Deliberately swallowed. See above.
  }
}

/**
 * Forget a food. Nothing else ever removes one, so without this a name typed wrong once is
 * suggested for ever with no way to be rid of it. Meals that used the food are untouched: what
 * was eaten is a fact, and only the suggestion is being withdrawn.
 */
export async function forgetFood(id: string): Promise<void> {
  await db.foods.delete(id);
}

/** Remembered foods for the picker, ranked for `query` (empty = most eaten, most recent). */
export async function suggestFoods(query: string, limit = 8): Promise<FoodMemory[]> {
  const all = await db.foods.toArray();
  return rankMemories(query, all, limit).map((r) => r.memory);
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
  await rememberFood(item);
  return id;
}

/**
 * Edit one food. Every number on the Today screen follows automatically, because none of
 * them are stored — this is the "edit anything, before or after saving" both handovers
 * asked for, and it needs no recalculation step.
 */
export async function updateItem(id: string, patch: Partial<Omit<MealItem, 'id' | 'mealId' | 'index'>>): Promise<void> {
  await db.mealItems.update(id, patch);
  // A correction is the most valuable thing to remember: it is the number the user went back and
  // fixed, and the trust hierarchy will let it overwrite a guess.
  const row = await db.mealItems.get(id);
  if (row) await rememberFood(row);
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
