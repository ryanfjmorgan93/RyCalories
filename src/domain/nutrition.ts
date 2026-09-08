import { addDays, daysBetween } from './dates';
import type { Settings } from './types';

export interface CalorieTarget {
  kcal: number;
  /** How many +step increments have been applied. */
  step: number;
  /** Date of the next increase, or null once the ceiling is reached. */
  nextStepOn: string | null;
  daysUntilNextStep: number | null;
}

/**
 * Reverse-diet stepper: start kcal, +step every stepDays from startDate, capped at ceiling.
 * Returns null when no start date has been set yet.
 */
export function calorieTargetOn(
  dateKey: string,
  s: Pick<Settings, 'calorieStart' | 'calorieStep' | 'calorieStepDays' | 'calorieCeiling' | 'calorieStartDate'>,
): CalorieTarget | null {
  if (!s.calorieStartDate) return null;
  const days = Math.max(0, daysBetween(s.calorieStartDate, dateKey));
  const stepDays = Math.max(1, s.calorieStepDays);
  const step = Math.floor(days / stepDays);
  const raw = s.calorieStart + step * s.calorieStep;
  const kcal = Math.min(s.calorieCeiling, raw);
  if (kcal >= s.calorieCeiling) return { kcal, step, nextStepOn: null, daysUntilNextStep: null };
  const daysUntil = stepDays - (days % stepDays);
  return { kcal, step, nextStepOn: addDays(dateKey, daysUntil), daysUntilNextStep: daysUntil };
}

export function proteinTarget(
  s: Pick<Settings, 'proteinTarget' | 'proteinTargetLegDay'>,
  isLowerBodyDay: boolean,
): number {
  return isLowerBodyDay ? s.proteinTargetLegDay : s.proteinTarget;
}
