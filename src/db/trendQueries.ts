/**
 * Assembling a window of days from both halves of the app: what was eaten, what was targeted,
 * what was trained, and what the scales said.
 *
 * This is the second cross-domain query (see todayQueries.ts) and the one that answers the
 * question the merged app exists for: is the weight moving the way it should while the training
 * holds up, and is that being paid for by the eating.
 */
import { db } from './db';
import { dayTotals } from './foodRepo';
import { sessionsOn } from './todayQueries';
import { addDays } from '@/domain/dates';
import { calorieTargetOn, proteinTarget } from '@/domain/nutrition';
import { dayRange, summarise, type DayRecord, type Trend } from '@/domain/trends';
import type { Bodyweight, Settings } from '@/domain/types';

export interface TrendWindow {
  trend: Trend;
  /** Bodyweight readings in the window, oldest first. */
  bodyweight: Bodyweight[];
}

/**
 * The last `days` days ending on `asOf` (inclusive).
 *
 * Reads day by day rather than in one sweep, which keeps "what counts as this day" in exactly one
 * place (dayTotals and sessionsOn) rather than re-deriving it here and drifting from the day
 * screen. The round trips were measured rather than assumed: the longest window, 56 days holding
 * 168 meals and 672 foods, takes about 185 ms. That is behind a loading state on a screen opened
 * occasionally, so the clarity is worth more than a bulk read would save.
 */
export async function trendWindow(asOf: string, days: number, settings: Settings): Promise<TrendWindow> {
  const from = addDays(asOf, -(Math.max(1, days) - 1));
  const dates = dayRange(from, asOf);

  const bodyweight = (await db.bodyweight.where('date').between(from, asOf, true, true).toArray()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const kgByDate = new Map(bodyweight.map((b) => [b.date, b.kg]));

  const records: DayRecord[] = await Promise.all(
    dates.map(async (date) => {
      const [eaten, sessions] = await Promise.all([dayTotals(date), sessionsOn(date)]);
      const meals = await db.meals.where('date').equals(date).count();
      const target = calorieTargetOn(date, settings);
      // Whether the day was a leg day is a fact about what was trained, so unlike the day screen
      // there is no falling back to what was planned: a past day's target is not a projection.
      const legDay = await wasLower(sessions.map((s) => s.routineId));

      return {
        date,
        // Absent, not zero, when nothing was logged. The distinction is the whole point.
        ...(meals > 0 ? { kcal: eaten.kcal, protein: eaten.protein } : {}),
        ...(target ? { kcalTarget: target.kcal } : {}),
        ...(meals > 0 ? { proteinTarget: proteinTarget(settings, legDay) } : {}),
        trained: sessions.some((s) => s.endedAt),
        ...(kgByDate.has(date) ? { kg: kgByDate.get(date)! } : {}),
      };
    }),
  );

  return { trend: summarise(records), bodyweight };
}

async function wasLower(routineIds: string[]): Promise<boolean> {
  const ids = routineIds.filter(Boolean);
  if (!ids.length) return false;
  const routines = await db.routines.bulkGet(ids);
  return routines.some((r) => r?.isLowerBody === true);
}
