/**
 * What the last few weeks say maintenance is. Pure functions only — no IO, no clock, no database.
 *
 * The estimate is arithmetic and nothing else: how much was eaten on the days that were logged,
 * and how far the scales moved while it was eaten. If the body gained 0.5 kg over 21 days while
 * eating 2,400 a day, about 183 kcal a day was being stored, so maintenance is about 2,583. Every
 * weakness of that is a weakness of its inputs, so each one is gated rather than smoothed over:
 *
 *  - Unlogged days are not days of eating nothing (see trends.ts), and here they are not days of
 *    eating like the logged ones either. The mean is taken over the days that were logged, and
 *    below `MIN_COVERAGE_FOR_ESTIMATE` of the window being logged that assumption is carrying the
 *    number rather than the data, so there is no number.
 *  - One reading is noise: water, salt, the last meal. Weight is the mean of the readings in the
 *    first week of the window against the mean in the last week, never one day against another.
 *  - Two weeks between those means is the least that separates a real change from that noise.
 *
 * Nothing is clamped and nothing is filled in: a gated estimate carries its counts (the screen
 * shows them) and no figure.
 */

import { addDays, daysBetween } from './dates';
import type { DayRecord } from './trends';
import type { Bodyweight } from './types';

/** Energy in a kilogram of body-weight change. The conventional figure; real tissue varies. */
export const KCAL_PER_KG = 7700;

/**
 * Below this share of the window logged, "the unlogged days were eaten like the logged ones" is
 * doing more of the work than the logs are: 0.8 is eight days in ten, so at most one day in five
 * rests on that assumption. Half (trends.ts MIN_COVERAGE) is enough to say an average describes
 * the window; it is not enough to hang a calorie figure on, because an error in the intake
 * average lands in the estimate one for one.
 */
export const MIN_COVERAGE_FOR_ESTIMATE = 0.8;

/** Fewest days between the centre of the first weigh-ins and the centre of the last. */
export const MIN_SPAN_DAYS = 14;

/** How much of each end of the window its weight is averaged over. */
export const END_WINDOW_DAYS = 7;

/** The estimate is shown to this many kcal: finer than that is a claim the inputs cannot make. */
const ROUND_TO_KCAL = 50;

export type MaintenanceBasis = 'ok' | 'window_too_short' | 'too_few_logged_days' | 'too_short' | 'too_few_weighins';

export interface Maintenance {
  basis: MaintenanceBasis;
  /** Mean kcal over the logged days only. Null when no day was logged. */
  intakeAvg: number | null;
  loggedDays: number;
  totalDays: number;
  /** Means of the readings in the first and last `END_WINDOW_DAYS` of the window. */
  startKg: number | null;
  endKg: number | null;
  /** How many readings each mean is built from. */
  weighInsStart: number;
  weighInsEnd: number;
  /** First and last reading dates in each group, for saying which weigh-ins the figure stands on. */
  startRange: { from: string; to: string } | null;
  endRange: { from: string; to: string } | null;
  /** Centre dates of those two groups: the mean of their dates, rounded to a day. */
  startDate: string | null;
  endDate: string | null;
  /** Days between the centre dates. Zero when either group is empty. */
  spanDays: number;
  /** endKg - startKg. Filled whenever both groups exist, gated or not. */
  deltaKg: number | null;
  /** Kcal a day stored (+) or drawn on (-): deltaKg * KCAL_PER_KG / spanDays. Null unless basis is 'ok'. */
  balanceKcalPerDay: number | null;
  /** intakeAvg - balance, to the nearest 50. Null unless basis is 'ok'. Never clamped. */
  maintenanceKcal: number | null;
  /**
   * kg a week at the logged intake: (intakeAvg - maintenanceKcal) * 7 / KCAL_PER_KG. Uses the
   * ROUNDED maintenance, so the figure and this line agree with each other on screen. Null unless
   * basis is 'ok'.
   */
  rateAtIntakeKgPerWeek: number | null;
}

interface Group {
  kg: number;
  count: number;
  first: string;
  last: string;
  /** Centre date: mean of the dates, rounded to a day. */
  centre: string;
}

function group(readings: Bodyweight[], anchor: string): Group | null {
  if (readings.length === 0) return null;
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const kg = sorted.reduce((s, r) => s + r.kg, 0) / sorted.length;
  const meanOffset = sorted.reduce((s, r) => s + daysBetween(anchor, r.date), 0) / sorted.length;
  return {
    kg,
    count: sorted.length,
    first: sorted[0].date,
    last: sorted[sorted.length - 1].date,
    centre: addDays(anchor, Math.round(meanOffset)),
  };
}

function toNearest(n: number, step: number): number {
  // `+ 0` turns a rounded -0 into 0, which would otherwise print as "-0" and fail a strict equality.
  return Math.round(n / step) * step + 0;
}

/**
 * The fewest logged days a window of `totalDays` may have and still be estimated on, worked out
 * with the very comparison `estimateMaintenance` gates on so the two can never disagree by a day.
 */
export function loggedDaysNeeded(totalDays: number): number {
  if (totalDays <= 0) return 0;
  let n = Math.ceil(totalDays * MIN_COVERAGE_FOR_ESTIMATE);
  while (n > 0 && (n - 1) / totalDays >= MIN_COVERAGE_FOR_ESTIMATE) n--;
  while (n < totalDays && n / totalDays < MIN_COVERAGE_FOR_ESTIMATE) n++;
  return n;
}

/**
 * Estimate maintenance over a window. `days` is the window (every day of it, logged or not) and
 * `readings` may hold any bodyweight rows: those outside the window are ignored.
 */
export function estimateMaintenance(days: DayRecord[], readings: Bodyweight[], opts: { today?: string } = {}): Maintenance {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]?.date ?? null;
  const last = sorted[sorted.length - 1]?.date ?? null;

  // Today is not over: a breakfast logged at ten is not a day's intake, and counting it would pull
  // the estimate down until the last meal of the day is in. Intake is read over finished days only;
  // today's weigh-in still counts, because a reading is complete the moment it is taken.
  const intakeDays = opts.today === undefined ? sorted : sorted.filter((d) => d.date !== opts.today);
  const totalDays = intakeDays.length;
  // A day counts as logged when it has an intake figure — a logged zero is a fast, not a blank.
  const logged = intakeDays.filter((d) => d.kcal !== undefined);
  const loggedDays = logged.length;
  const intakeAvg = loggedDays > 0 ? logged.reduce((s, d) => s + d.kcal!, 0) / loggedDays : null;

  let start: Group | null = null;
  let end: Group | null = null;
  if (first !== null && last !== null) {
    const inWindow = readings.filter((r) => r.date >= first && r.date <= last);
    start = group(
      inWindow.filter((r) => daysBetween(first, r.date) < END_WINDOW_DAYS),
      first,
    );
    end = group(
      inWindow.filter((r) => daysBetween(r.date, last) < END_WINDOW_DAYS),
      first,
    );
  }

  const spanDays = start && end ? daysBetween(start.centre, end.centre) : 0;
  const deltaKg = start && end ? end.kg - start.kg : null;

  let basis: MaintenanceBasis = 'ok';
  // The two week-groups' centres can sit at most (window − 1) days apart, so a window that short
  // can never meet the span gate however often the owner weighs in. Say that, not "weigh in more".
  if (sorted.length - 1 < MIN_SPAN_DAYS) basis = 'window_too_short';
  else if (!start || !end) basis = 'too_few_weighins';
  else if (spanDays < MIN_SPAN_DAYS) basis = 'too_short';
  else if (loggedDays === 0 || loggedDays / totalDays < MIN_COVERAGE_FOR_ESTIMATE) basis = 'too_few_logged_days';

  let balanceKcalPerDay: number | null = null;
  let maintenanceKcal: number | null = null;
  let rateAtIntakeKgPerWeek: number | null = null;
  if (basis === 'ok' && deltaKg !== null && intakeAvg !== null) {
    balanceKcalPerDay = (deltaKg * KCAL_PER_KG) / spanDays;
    maintenanceKcal = toNearest(intakeAvg - balanceKcalPerDay, ROUND_TO_KCAL);
    rateAtIntakeKgPerWeek = ((intakeAvg - maintenanceKcal) * 7) / KCAL_PER_KG;
  }

  return {
    basis,
    intakeAvg,
    loggedDays,
    totalDays,
    startKg: start?.kg ?? null,
    endKg: end?.kg ?? null,
    weighInsStart: start?.count ?? 0,
    weighInsEnd: end?.count ?? 0,
    startRange: start ? { from: start.first, to: start.last } : null,
    endRange: end ? { from: end.first, to: end.last } : null,
    startDate: start?.centre ?? null,
    endDate: end?.centre ?? null,
    spanDays,
    deltaKg,
    balanceKcalPerDay,
    maintenanceKcal,
    rateAtIntakeKgPerWeek,
  };
}
