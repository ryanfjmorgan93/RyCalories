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
import { ZERO, addMacros, displayMacros, gramsOf, type FoodSource, type Macros, type Nutrition } from '@/domain/food';
import { memoryFrom, memoryKey, mergeMemory, rankMemories } from '@/domain/foodMemory';
import { MEAL_SLOTS, type FoodMemory, type ItemUnits, type Meal, type MealItem, type MealSlot } from '@/domain/types';

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
  /** The recipe this item's share was logged from, when it was — see `MealItem.recipeId`. */
  recipeId?: string;
  /**
   * The count-style amount that produced this item's weight, when there was one — "3 eggs" at
   * 50 g each. NOT persisted on the row (`MealItem` carries no `unit` field): it exists only so
   * `rememberFood` can pass it through to `memoryFrom`, so FoodMemory learns `unitGrams`/
   * `unitLabel`/`unitPlural` and a later recipe or quick-add can offer "how many?" next time.
   */
  unit?: { count: number; unitGrams: number; label: string; plural: string };
  /**
   * The pack's barcode (digits), when this food was typed in after a scan the database could not
   * fill. Like `unit`, NOT persisted on the row (`MealItem` carries no `barcode` field): it exists
   * only so `rememberFood` can hand it to `memoryFrom`, and the next scan of that pack then fills
   * from the food memory instead of asking again.
   */
  barcode?: string;
  /**
   * What the amount step knew about the food — pack and serving weights, further count-style
   * units, the unit just used (see `ItemUnits`). Like `unit` and `barcode`, NOT persisted on the
   * row: it exists only so `rememberFood` can teach `FoodMemory`, which is how the natural-unit
   * chips come back next time, offline included.
   */
  units?: ItemUnits;
  /**
   * `false` logs the item but teaches FoodMemory nothing from it. For an estimate that stands in
   * for a remembered food it turned out not to be (Claude's cooked rice against the owner's raw
   * "Rice"): the figures are already protected by the trust order, but the portion, units and use
   * count would still be filed under the owner's food. Not persisted on the row.
   */
  remember?: false;
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
  // convenience and must not be able to fail the write the user actually asked for. Remembers
  // from the ORIGINAL `items`, not `itemRows` — `toItemRow` deliberately drops `unit` (it is not a
  // column on MealItem), and rememberFood needs it to teach FoodMemory unitGrams/unitLabel.
  for (const it of items) await rememberFood(it);
  return id;
}

/**
 * Where an item (or several) went, so it can be taken back out. `createdMeal` says the meal did not
 * exist before the call: undoing then removes the meal too, provided nothing else has been put in
 * it since.
 *
 * `attachedPhoto` is the photo this call put on a meal that already existed and had none (see
 * `logItemsToSlot`); undoing the log takes it off again, if the meal still carries it. Absent when
 * the call created the meal (the photo is then the meal's own and goes with it) or the meal kept a
 * photo it already had.
 */
export interface LoggedItems {
  mealId: string;
  itemIds: string[];
  createdMeal: boolean;
  attachedPhoto?: string;
}

/** The meal-level extras a reader of a photo or a description can attach to the slot's meal. */
export type SlotMealExtras = Pick<NewMeal, 'photoPath' | 'enteredText' | 'confidence' | 'notes'>;

/** A slot's name as a meal title: "Lunch". */
function slotName(slot: MealSlot): string {
  return slot[0]!.toUpperCase() + slot.slice(1);
}

/**
 * Log food straight to a day: append `items` to that date's meal for `slot` — the most recently
 * logged one when there are several — creating it if there is none. No "Add meal" step, which is
 * the point: one tap from a chip is a logged food. `extras` (a photo path, the text a description
 * came from, how sure the reader was) are written when this call creates the meal; a meal that
 * already exists keeps what it has, with one exception: a `photoPath` goes onto it when it has no
 * photo yet. The caller has already kept that file, and a file no meal points at is swept away, so
 * a photographed meal logged into an existing slot would otherwise be lost. A meal holds one
 * photo, so a second is not kept in place of the first (the sweep takes it).
 *
 * Found-or-created and appended in ONE transaction, so two quick logs cannot both decide the slot
 * has no meal and write two. Remembering the foods happens after the commit, as in `addMeal`:
 * a convenience that must not be able to fail the write the user asked for.
 */
export async function logItemsToSlot(
  date: string,
  slot: MealSlot,
  items: NewMealItem[],
  extras?: SlotMealExtras,
): Promise<LoggedItems> {
  const logged = await db.transaction('rw', [db.meals, db.mealItems], async (): Promise<LoggedItems> => {
    const inSlot = (await db.meals.where('date').equals(date).toArray())
      .filter((m) => m.slot === slot)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.id.localeCompare(b.id));
    let meal = inSlot[inSlot.length - 1];
    const createdMeal = meal === undefined;
    if (!meal) {
      meal = {
        id: uuid(),
        date,
        loggedAt: nowIso(),
        name: slotName(slot),
        slot,
        ...(extras?.notes ? { notes: extras.notes } : {}),
        ...(extras?.enteredText ? { enteredText: extras.enteredText } : {}),
        ...(extras?.photoPath ? { photoPath: extras.photoPath } : {}),
        ...(extras?.confidence ? { confidence: extras.confidence } : {}),
      };
      await db.meals.put(meal);
    }
    let attachedPhoto: string | undefined;
    if (!createdMeal && extras?.photoPath && !meal.photoPath) {
      await db.meals.update(meal.id, { photoPath: extras.photoPath });
      attachedPhoto = extras.photoPath;
    }
    const existing = await db.mealItems.where('mealId').equals(meal.id).toArray();
    const first = existing.reduce((max, i) => Math.max(max, i.index), -1) + 1;
    const rows = items.map((it, n) => toItemRow(uuid(), meal.id, first + n, it));
    if (rows.length) await db.mealItems.bulkPut(rows);
    return { mealId: meal.id, itemIds: rows.map((r) => r.id), createdMeal, ...(attachedPhoto ? { attachedPhoto } : {}) };
  });
  // From the ORIGINAL items, not the rows: `toItemRow` drops `unit`, `units` and `barcode`, which
  // are exactly what teach FoodMemory its unit weights, pack sizes and barcodes.
  for (const it of items) await rememberFood(it);
  return logged;
}

/** One item to a day's slot — see `logItemsToSlot`. */
export function logItemToSlot(date: string, slot: MealSlot, item: NewMealItem, extras?: SlotMealExtras): Promise<LoggedItems> {
  return logItemsToSlot(date, slot, [item], extras);
}

/**
 * Take back what `logItemsToSlot` wrote. The items go; the meal goes with them only if the call
 * created it and it is empty now — food put into it afterwards is the owner's, and survives.
 * Remembered foods are left alone: choosing a food is a fact about what the owner eats, whether or
 * not this particular log stood.
 */
export async function undoLoggedItems(logged: LoggedItems): Promise<void> {
  await db.transaction('rw', [db.meals, db.mealItems], async () => {
    await db.mealItems.bulkDelete(logged.itemIds);
    const rest = (await db.mealItems.where('mealId').equals(logged.mealId).toArray()).sort((a, b) => a.index - b.index);
    if (rest.length === 0 && logged.createdMeal) {
      await db.meals.delete(logged.mealId);
      return;
    }
    // The photo this log put on an existing meal is of the food just taken back. The file is left
    // for the sweep: once no meal points at it, it goes.
    if (logged.attachedPhoto) {
      const meal = await db.meals.get(logged.mealId);
      if (meal?.photoPath === logged.attachedPhoto) await db.meals.update(logged.mealId, { photoPath: undefined });
    }
    // Close the gap so indexes stay 0..n-1 and a later append cannot collide, as deleteItem does.
    await db.mealItems.bulkPut(rest.map((r, index) => ({ ...r, index })));
  });
}

// ---------------------------------------------------------------------------
// Food memory

/**
 * Record that a food was eaten, so it can be offered back next time.
 *
 * Best-effort by design: a failure here must never take a meal down with it. Logging the food is
 * the user's intent; remembering it is a convenience the app adds on top.
 *
 * `opts.portion` defaults to true; pass `{ portion: false }` when `item.nutrition`'s weight is not
 * a portion anyone ate (a recipe's batch quantity) — see `memoryFrom`'s doc comment.
 */
export async function rememberFood(item: NewMealItem | MealItem, opts?: { portion?: boolean }): Promise<void> {
  if ('remember' in item && item.remember === false) return;
  // NewMealItem's source is optional and defaults the same way toItemRow does, so a food added
  // without one is remembered as the user's own rather than falling through to the least trusted.
  // `unit` and `barcode` only ever exist on a NewMealItem (never persisted on the MealItem row —
  // see the fields' doc comments), so a remembered row and a freshly logged one both flow through
  // the same call; `barcode` rides in on the spread below.
  const unit = 'unit' in item ? item.unit : undefined;
  const next = memoryFrom({ ...item, source: item.source ?? 'user' }, unit, opts);
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

/** Every remembered food. The list is small (what one person has eaten), so search ranks it in memory. */
export async function allFoods(): Promise<FoodMemory[]> {
  return db.foods.toArray();
}

/** The remembered food an item would be filed under, when there is one. */
export async function memoryFor(item: Pick<MealItem, 'name' | 'brand' | 'product'>): Promise<FoodMemory | undefined> {
  return db.foods.where('key').equals(memoryKey(item)).first();
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
    ...(it.recipeId ? { recipeId: it.recipeId } : {}),
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
export async function updateItem(
  id: string,
  patch: Partial<Omit<MealItem, 'id' | 'mealId' | 'index'>>,
  /**
   * `barcode`: see `NewMealItem.barcode`; `units`: see `NewMealItem.units`. Remembered with the
   * food, never written to the row.
   */
  opts?: { barcode?: string; units?: ItemUnits },
): Promise<void> {
  await db.mealItems.update(id, patch);
  // A correction is the most valuable thing to remember: it is the number the user went back and
  // fixed, and the trust hierarchy will let it overwrite a guess.
  const row = await db.mealItems.get(id);
  if (row) {
    await rememberFood({
      ...row,
      ...(opts?.barcode ? { barcode: opts.barcode } : {}),
      ...(opts?.units ? { units: opts.units } : {}),
    });
  }
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

/**
 * Distinct meals eaten recently, newest first, excluding anything already on `date`.
 *
 * De-duplicated by what the meal IS — its name and the foods in it — rather than by name alone.
 * Eating porridge every morning should offer one entry, not thirty; but "Lunch" on Monday with
 * chicken and "Lunch" on Tuesday with a curry are two different meals that happen to share a
 * label, and collapsing them would hide one behind the other.
 */
export async function recentMeals(date: string, limit = 8): Promise<MealWithItems[]> {
  // A window, not the whole history: enough to find a fortnight of distinct meals without
  // reading years of rows on a phone.
  const recent = (await db.meals.orderBy('loggedAt').reverse().limit(limit * 12).toArray()).filter((m) => m.date !== date);
  if (!recent.length) return [];

  const items = await db.mealItems.where('mealId').anyOf(recent.map((m) => m.id)).toArray();
  const byMeal = new Map<string, MealItem[]>();
  for (const item of items) {
    const list = byMeal.get(item.mealId);
    if (list) list.push(item);
    else byMeal.set(item.mealId, [item]);
  }

  const seen = new Set<string>();
  const out: MealWithItems[] = [];
  for (const meal of recent) {
    const mealItems = (byMeal.get(meal.id) ?? []).sort((a, b) => a.index - b.index);
    if (!mealItems.length) continue;
    const signature = [meal.name.trim().toLowerCase(), ...mealItems.map((i) => `${i.name.trim().toLowerCase()}:${gramsOf(i.nutrition) ?? i.portion}`)].join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push({ meal, items: mealItems, macros: sumItems(mealItems) });
    if (out.length >= limit) break;
  }
  return out;
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

/** How many meals a day holds. The Food screen reads this to decide whether "Copy yesterday" shows. */
export async function mealCountOnDay(date: string): Promise<number> {
  return db.meals.where('date').equals(date).count();
}

/**
 * Copy every meal of `fromDate` onto `toDate`, in ONE transaction: a day is copied whole or not
 * at all. Returns how many meals were copied — 0 when `fromDate` has none, and 0 when the two
 * days are the same, because copying a day onto itself would only double it.
 *
 * What is copied is what `repeatMeal` copies (name, slot, notes, each item as logged) plus the
 * item's recipe link. The meal's photo, typed text and AI confidence stay behind: they describe
 * how the ORIGINAL was logged, not what was eaten. Rows are written directly rather than through
 * `addMeal`, because `addMeal` opens its own transaction and then teaches FoodMemory — neither
 * belongs inside a day-sized one. FoodMemory is taught after the commit, as `addMeal` does.
 *
 * Copies get strictly increasing `loggedAt`, a millisecond apart. `mealsOnDay` orders meals with
 * no slot by `loggedAt`, so copies written in the same millisecond would fall back to sorting by
 * random id and the copied day would come back in a different order from the one it came from.
 */
export async function copyDay(fromDate: string, toDate: string): Promise<number> {
  if (fromDate === toDate) return 0;
  const base = Date.now();
  const copied = await db.transaction('rw', [db.meals, db.mealItems], async () => {
    const source = await mealsOnDay(fromDate);
    for (const [n, { meal, items }] of source.entries()) {
      const id = uuid();
      await db.meals.put({
        id,
        date: toDate,
        loggedAt: new Date(base + n).toISOString(),
        name: meal.name.trim() || 'Meal',
        ...(meal.slot ? { slot: meal.slot } : {}),
        ...(meal.notes ? { notes: meal.notes } : {}),
      });
      if (items.length) {
        await db.mealItems.bulkPut(
          items.map((it) =>
            toItemRow(uuid(), id, it.index, {
              name: it.name,
              portion: it.portion,
              nutrition: it.nutrition,
              source: it.source,
              brand: it.brand,
              product: it.product,
              recipeId: it.recipeId,
            }),
          ),
        );
      }
    }
    return source;
  });
  for (const { items } of copied) for (const it of items) await rememberFood(it);
  return copied.length;
}
