/**
 * Turning a target the weekly review proposes into a change to Settings. Pure: the caller passes
 * the current settings and `today`, and saves `patch` through `saveSettings`.
 *
 * The calorie target is a reverse-diet stepper (a start figure that steps up on a schedule, up to a
 * ceiling; see `calorieTargetOn`), not a single number. "Use 2,400 kcal" therefore starts the
 * stepper afresh at 2,400 from today, which makes today's target exactly that, and it raises the
 * ceiling when 2,400 would otherwise sit above it. Protein is two numbers, a normal day and a lower
 * body day; the owner's gap between them is kept.
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

/** The change that makes today's calorie target `kcal`; null when it already is. */
export function calorieChange(settings: Settings, kcal: number, today: string): TargetChange | null {
  const now = calorieTargetOn(today, settings);
  if (now && now.kcal === kcal) return null;
  const patch: TargetChange['patch'] = { calorieStart: kcal, calorieStartDate: today };
  let raised = false;
  if (kcal > settings.calorieCeiling) {
    patch.calorieCeiling = kcal;
    raised = true;
  }
  const head = now ? `Calorie target changed from ${fmtNum(now.kcal)} to ${fmtNum(kcal)} kcal from today.` : `Calorie target set to ${fmtNum(kcal)} kcal from today.`;
  return { patch, line: raised ? `${head} The ceiling went up to ${fmtNum(kcal)} kcal too.` : head };
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
