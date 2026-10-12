import type { MealSlot } from './types';

/** The slot a clock hour (0 to 23) most likely belongs to. A guess, and one tap to change. */
export function slotForHour(hour: number): MealSlot {
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

/** Best guess at the slot from the clock. */
export function defaultSlot(now: Date = new Date()): MealSlot {
  return slotForHour(now.getHours());
}
