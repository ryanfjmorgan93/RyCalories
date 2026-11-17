import { db } from './db';
import { isEstimate } from '@/domain/claudeFood';
import { addDays } from '@/domain/dates';
import { dietDigest, DIET_WINDOW_DAYS, type DietDigest } from '@/domain/dietCheck';
import { macrosOf } from '@/domain/food';
import { memoryKey } from '@/domain/foodMemory';

/** Everything logged in the 28 days ending today, food by food, for the diet check. */
export async function loadDietDigest(today: string): Promise<DietDigest> {
  const from = addDays(today, -(DIET_WINDOW_DAYS - 1));
  const meals = await db.meals.where('date').between(from, today, true, true).toArray();
  const dateOf = new Map(meals.map((m) => [m.id, m.date]));
  const items = await db.mealItems.where('mealId').anyOf([...dateOf.keys()]).toArray();
  return dietDigest(
    items.map((i) => ({ key: memoryKey(i), name: i.name, date: dateOf.get(i.mealId)!, portion: i.portion, macros: macrosOf(i.nutrition), estimate: isEstimate(i) })),
    from,
    today,
  );
}
