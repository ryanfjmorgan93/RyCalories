/**
 * "A meal was just logged", for the coach's comment on the Food screen.
 *
 * Any path that puts food on a day (a chip, a photo, a sentence, a meal built by hand) calls
 * `noteMealLogged`. A few seconds later, once the Undo window has passed, it reads the meal and the
 * day so far and keeps those facts for the Food screen's coach line. They are fixed at that point,
 * so coming back to the screen asks nothing new: the coach comments on the meal once, and only if
 * the food is still there (an Undo within the window means there is nothing to comment on).
 *
 * Module-level and not tied to a screen, so the comment survives a trip to the meal's own screen
 * and back.
 */
import { create } from 'zustand';
import { getMeal } from '@/db/foodRepo';
import { getSettings } from '@/db/repo';
import { dayView } from '@/db/todayQueries';
import { toDateKey } from '@/domain/dates';
import { mealMomentFacts, type FoodFacts } from '@/domain/foodFacts';

export interface MealMoment {
  mealId: string;
  /** The day the meal counts towards. */
  date: string;
  /** When the facts were taken. */
  at: number;
  facts: FoodFacts;
}

/** How long to wait before commenting: the Undo window, so a meal taken straight back out is never remarked on. */
export const SETTLE_MS = 8000;
/** How long a meal moment stays on the Food screen. */
export const SHOWN_MS = 20 * 60 * 1000;

interface MealMomentState {
  moment: MealMoment | null;
  /** A meal has been logged and its comment is still waiting out the Undo window. */
  pending: boolean;
}

export const useMealMoment = create<MealMomentState>(() => ({ moment: null, pending: false }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** The moment, if it is still fresh. */
export function freshMoment(moment: MealMoment | null, now: number = Date.now()): MealMoment | null {
  return moment && now - moment.at < SHOWN_MS ? moment : null;
}

/** Read the meal and the day now and keep the facts. Null when the meal is gone or none of `itemIds` is left in it. */
export async function takeMealMoment(mealId: string, itemIds?: readonly string[]): Promise<MealMoment | null> {
  const m = await getMeal(mealId);
  if (!m) return null;
  if (itemIds && !itemIds.some((id) => m.items.some((i) => i.id === id))) return null;
  const settings = await getSettings();
  const view = await dayView(m.meal.date, settings, toDateKey());
  const facts = mealMomentFacts(m, { eaten: view.eaten, kcalTarget: view.calories?.kcal ?? null, proteinTarget: view.proteinTarget });
  return { mealId, date: m.meal.date, at: Date.now(), facts };
}

/**
 * Note that food was just logged to a meal. Several in quick succession (three chips for one
 * breakfast) are one comment, on the last. Never throws.
 */
export function noteMealLogged(opts: { mealId: string; itemIds?: readonly string[]; settleMs?: number }): void {
  if (timer !== undefined) clearTimeout(timer);
  useMealMoment.setState({ pending: true });
  timer = setTimeout(() => {
    timer = undefined;
    takeMealMoment(opts.mealId, opts.itemIds)
      .then((moment) => useMealMoment.setState(moment ? { moment, pending: false } : { pending: false }))
      .catch(() => useMealMoment.setState({ pending: false }));
  }, opts.settleMs ?? SETTLE_MS);
}

/** Forget the moment and any comment still waiting: the food it was about has been taken back out. */
export function clearMealMoment(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  useMealMoment.setState({ moment: null, pending: false });
}
