/**
 * Usual meals (CONTEXT.md): a meal the owner eats as it is, logged again in one tap. Two kinds are
 * offered for a slot: the ones they saved, and the ones their own history shows (the same meal
 * logged in that slot more than once), so the row is useful before anything has been saved.
 * Pure: no IO, no clock.
 */
import { gramsOf } from './food';
import type { MealItem, MealSlot } from './types';

/** A food as a usual meal holds it: what a logged item is, without its row. */
export type UsualItem = Pick<MealItem, 'name' | 'portion' | 'nutrition' | 'source' | 'brand' | 'product'>;

/** A meal the owner saved. No slot means it was saved from a meal that had none: offered in every slot. */
export interface UsualMeal {
  id: string;
  name: string;
  slot?: MealSlot;
  items: UsualItem[];
}

/** One past meal, as much of it as the offer needs. */
export interface PastMeal {
  name: string;
  slot?: MealSlot;
  items: UsualItem[];
}

export interface OfferedUsual extends PastMeal {
  /** What the meal is (see `mealSignature`); stable across days, so it keys the row. */
  key: string;
  /** The id of the saved usual, or absent for one read off the history. */
  savedId?: string;
}

/**
 * What a meal IS: its name and the foods in it with their amounts. Porridge every morning is one
 * meal; "Lunch" with chicken and "Lunch" with a curry are two that share a label.
 */
export function mealSignature(name: string, items: readonly Pick<MealItem, 'name' | 'portion' | 'nutrition'>[]): string {
  return [name.trim().toLowerCase(), ...items.map((i) => `${i.name.trim().toLowerCase()}:${gramsOf(i.nutrition) ?? i.portion}`)].join('|');
}

/** A meal logged in a slot this many times is offered there without being saved. */
export const USUAL_AFTER = 2;

/**
 * The usual meals to offer for a slot, at most `limit`: the saved ones for it first, in the order
 * they were saved, then the meals of `history` logged in that slot at least USUAL_AFTER times, most
 * often first and, on a tie, most recent first (`history` is newest first). `skip` holds the
 * signatures already on the day, which are not offered again.
 */
export function usualsFor(
  slot: MealSlot,
  saved: readonly UsualMeal[],
  history: readonly PastMeal[],
  skip: ReadonlySet<string> = new Set(),
  limit = 3,
): OfferedUsual[] {
  const out: OfferedUsual[] = [];
  const seen = new Set(skip);
  for (const u of saved) {
    if (u.slot !== undefined && u.slot !== slot) continue;
    const key = mealSignature(u.name, u.items);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: u.name, ...(u.slot ? { slot: u.slot } : {}), items: u.items, savedId: u.id });
  }
  const counts = new Map<string, { meal: PastMeal; n: number; first: number }>();
  history.forEach((meal, i) => {
    if (meal.slot !== slot || meal.items.length === 0) return;
    const key = mealSignature(meal.name, meal.items);
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { meal, n: 1, first: i });
  });
  const often = [...counts].filter(([key, c]) => c.n >= USUAL_AFTER && !seen.has(key)).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first);
  for (const [key, c] of often) out.push({ key, ...c.meal });
  return out.slice(0, limit);
}
