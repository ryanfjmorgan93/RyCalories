/**
 * What the coach is told about a meal or a day of food when it is asked for a comment. Pure
 * functions only; compact by design (a Haiku one-liner, so a handful of lines and no history: the
 * coach's own context already carries the rest).
 *
 * The values are plain text and numbers. Figures Claude estimated keep their "≈" in the text, and
 * the facts say so once, so the coach talks about them as estimates.
 */

import { displayMacros, type FoodSource, type Macros, type Nutrition } from './food';
import { isEstimate } from './claudeFood';
import type { MealSlot } from './types';

export type FactValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type FoodFacts = Record<string, FactValue>;

/** The slice of a meal and its items these facts read (structurally `MealWithItems`, db/foodRepo). */
export interface FactMeal {
  meal: { name: string; slot?: MealSlot };
  items: ReadonlyArray<{ name: string; portion: string; nutrition: Nutrition; source?: FoodSource }>;
}

/** The day against its targets. A target the settings do not give is null. */
export interface FactDay {
  eaten: Macros;
  kcalTarget: number | null;
  proteinTarget: number | null;
}

/** Most foods listed by name; a big meal is "and 3 more". */
const MAX_FOODS = 8;

function kcalOf(n: Nutrition): number {
  return displayMacros(n).kcal;
}

function sumMacros(items: FactMeal['items']): Macros {
  return items.reduce<Macros>(
    (acc, i) => {
      const m = displayMacros(i.nutrition);
      return { kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein, carbs: acc.carbs + m.carbs, fat: acc.fat + m.fat };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

const ESTIMATES_NOTE = 'some amounts or figures are estimates (≈)';

/** The day against its targets, in the same keys for a meal and for the day. */
function dayAgainstTargets(day: FactDay, prefix: string): FoodFacts {
  const out: FoodFacts = {
    [`${prefix} kcal`]: Math.round(day.eaten.kcal),
    [`${prefix} protein g`]: Math.round(day.eaten.protein),
  };
  if (day.kcalTarget !== null) out['calorie target'] = Math.round(day.kcalTarget);
  if (day.proteinTarget !== null) out['protein target g'] = Math.round(day.proteinTarget);
  return out;
}

/** A meal just logged: what was in it, its totals, and the day so far against the targets. */
export function mealMomentFacts(m: FactMeal, day: FactDay): FoodFacts {
  const foods = m.items.slice(0, MAX_FOODS).map((i) => `${i.name}: ${i.portion}, ${kcalOf(i.nutrition)} kcal`);
  if (m.items.length > MAX_FOODS) foods.push(`and ${m.items.length - MAX_FOODS} more`);
  const total = sumMacros(m.items);
  return {
    meal: m.meal.slot ?? m.meal.name,
    foods,
    'meal kcal': total.kcal,
    'meal protein g': total.protein,
    'meal carbs g': total.carbs,
    'meal fat g': total.fat,
    ...dayAgainstTargets(day, 'day so far'),
    figures: m.items.some(isEstimate) ? ESTIMATES_NOTE : undefined,
  };
}

/** A day of food, late on: the totals against the targets and each meal in a few words. */
export function dayMomentFacts(meals: readonly FactMeal[], day: FactDay): FoodFacts {
  const lines = meals.map((m) => {
    const names = m.items.slice(0, 4).map((i) => i.name).join(', ');
    return `${m.meal.slot ?? m.meal.name}: ${sumMacros(m.items).kcal} kcal (${names}${m.items.length > 4 ? ' and more' : ''})`;
  });
  const left = day.kcalTarget === null ? undefined : Math.round(day.kcalTarget - day.eaten.kcal);
  // No clock in the facts: they are compared by content to decide whether the coach has been asked
  // already, and a time would make every minute a new question.
  return {
    meals: lines,
    ...dayAgainstTargets(day, 'eaten'),
    'calories left (negative is over)': left,
    figures: meals.some((m) => m.items.some(isEstimate)) ? ESTIMATES_NOTE : undefined,
  };
}

/** Whether the day's late comment may be asked for: today, from 20:00, with something logged. */
export function dayCommentDue(opts: { isToday: boolean; now: Date; mealCount: number }): boolean {
  return opts.isToday && opts.now.getHours() >= 20 && opts.mealCount > 0;
}
