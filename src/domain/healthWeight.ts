/**
 * Bodyweight from Health Connect: which readings to add to the log. Pure: samples, the days the log
 * already has and the day in; readings out. src/platform/health.ts reads the samples and
 * src/state/healthWeight.ts writes what this returns.
 *
 * A scale or an InBody scan writes weight to Samsung Health, which shares it with Health Connect.
 * The log keeps one reading a day, so the day's first is taken (the morning weight, before the day
 * moves it). A day that already has a reading keeps it: the owner's own figure is never overwritten,
 * and one they deleted is not brought back.
 */
import { addDays, toDateKey } from './dates';

export interface WeightSample {
  /** Kilograms. */
  kg: number;
  /** ISO time of the reading; it counts towards its local day. */
  startDate: string;
}

/** How far back a first read goes, in days. */
export const HEALTH_WEIGHT_DAYS = 90;
/** Readings outside this range are taken as a mistake, not a weight. */
export const HEALTH_WEIGHT_MIN_KG = 30;
export const HEALTH_WEIGHT_MAX_KG = 300;

/**
 * Readings to add: per local day in the `days` ending `today`, the earliest sample, to 0.1 kg; none
 * for a day in `skip` (one the log already has, or one the owner deleted). Oldest first.
 */
export function weightsToImport(samples: readonly WeightSample[], skip: ReadonlySet<string>, today: string, days = HEALTH_WEIGHT_DAYS): { date: string; kg: number }[] {
  const from = addDays(today, -(days - 1));
  const first = new Map<string, { t: number; kg: number }>();
  for (const s of samples) {
    if (!Number.isFinite(s.kg) || s.kg < HEALTH_WEIGHT_MIN_KG || s.kg > HEALTH_WEIGHT_MAX_KG) continue;
    const t = Date.parse(s.startDate);
    if (Number.isNaN(t)) continue;
    const date = toDateKey(new Date(t));
    if (date < from || date > today || skip.has(date)) continue;
    const had = first.get(date);
    if (!had || t < had.t) first.set(date, { t, kg: s.kg });
  }
  return [...first.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, { kg }]) => ({ date, kg: Math.round(kg * 10) / 10 }));
}
