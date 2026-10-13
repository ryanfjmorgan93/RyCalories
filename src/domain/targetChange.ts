/**
 * Turning a target the weekly review proposes into a change to Settings. Pure: the caller passes
 * the current settings and `today`, and saves `patch` through `saveSettings`.
 *
 * The calorie target is a reverse-diet stepper (a start figure that steps up on a schedule, up to a
 * ceiling; see `calorieTargetOn`), not a single number. The coach's proposal is "a new daily calorie
 * target", so "Use 2,400 kcal" sets the start AND the ceiling to 2,400 from today: today's target is
 * exactly that and it stays there. The owner restarts a ramp by raising the ceiling in Settings →
 * Targets. Protein is two numbers, a normal day and a lower body day; the owner's gap between them
 * is kept.
 */
import { fmtNum } from './format';
import { calorieTargetOn } from './nutrition';
import type { Settings } from './types';

export interface TargetChange {
  /** What to save. */
  patch: Partial<Omit<Settings, 'id'>>;
  /** What changed, in a sentence for the owner. */
  line: string;
}

/**
 * The change that makes `kcal` the daily calorie target from today and holds it there; null when
 * it already is the target and already holds (the stepper has nowhere left to go).
 */
export function calorieChange(settings: Settings, kcal: number, today: string): TargetChange | null {
  const now = calorieTargetOn(today, settings);
  if (now && now.kcal === kcal && settings.calorieCeiling === kcal) return null;
  // Start AND ceiling are the figure, so the stepper has nothing to climb to. Setting only the
  // start would leave "hold at 2,600" stepping up to 2,800 and 3,000 on the old schedule.
  return {
    patch: { calorieStart: kcal, calorieStartDate: today, calorieCeiling: kcal },
    line: `Calories set to ${fmtNum(kcal)} a day from today.`,
  };
}

/** The change that makes the daily protein target `grams`, keeping the lower-body day's gap; null when it already is. */
export function proteinChange(settings: Settings, grams: number): TargetChange | null {
  if (settings.proteinTarget === grams) return null;
  const gap = settings.proteinTargetLegDay - settings.proteinTarget;
  const legDay = grams + gap;
  return {
    patch: { proteinTarget: grams, proteinTargetLegDay: legDay },
    line: `Protein target changed from ${fmtNum(settings.proteinTarget)} g to ${fmtNum(grams)} g (lower-body days ${fmtNum(settings.proteinTargetLegDay)} g to ${fmtNum(legDay)} g).`,
  };
}
