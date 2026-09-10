/**
 * What the last few weeks actually looked like. Pure functions only — no IO, no clock, no database.
 *
 * The whole problem this module solves is honesty about missing days.
 *
 * A day with no food logged is not a day you ate nothing, and averaging it in as zero produces a
 * figure that is not merely imprecise but actively false: three well-logged days and four blank
 * ones would report an intake less than half the real one, and that number would then be read as
 * evidence for eating more. So an unlogged day is excluded from every average, and the count of
 * days the average is built from is carried alongside it — a summary that cannot be quoted without
 * saying how much it is standing on.
 */

import { addDays, daysBetween } from './dates';

export interface DayRecord {
  /** Local day key. */
  date: string;
  /** Absent when nothing was logged that day. Zero means "logged, and it came to zero". */
  kcal?: number;
  protein?: number;
  /** Target for that day, when one existed. */
  kcalTarget?: number;
  proteinTarget?: number;
  /** Whether a session was completed. */
  trained: boolean;
  /** Bodyweight reading, when there was one. */
  kg?: number;
}

export interface Average {
  /** Null when nothing was logged in the window at all. */
  value: number | null;
  /** How many days the average is built from. */
  days: number;
  /** How many days it could have been built from. */
  outOf: number;
}

export interface Trend {
  from: string;
  to: string;
  days: DayRecord[];
  /** Intake, over the days that were logged. */
  kcal: Average;
  protein: Average;
  /** Target intake over the same logged days, so the two are comparable. */
  kcalTarget: Average;
  /** Days the protein target was met, out of the days both a figure and a target existed. */
  proteinHit: { days: number; outOf: number };
  /** Sessions completed in the window, and the rate per week. */
  sessions: number;
  sessionsPerWeek: number;
  /** Days with any food logged. The number every average above is standing on. */
  loggedDays: number;
}

function average(values: number[], outOf: number): Average {
  if (values.length === 0) return { value: null, days: 0, outOf };
  const total = values.reduce((a, b) => a + b, 0);
  return { value: total / values.length, days: values.length, outOf };
}

/** Every day from `from` to `to` inclusive, oldest first. */
export function dayRange(from: string, to: string): string[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
}

/**
 * Summarise a window. `days` must already cover the range; anything missing from it is treated as
 * a day with nothing logged, which is exactly what it is.
 */
export function summarise(days: DayRecord[]): Trend {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const from = sorted[0]?.date ?? '';
  const to = sorted[sorted.length - 1]?.date ?? '';
  const outOf = sorted.length;

  // A day counts as logged when it has an intake figure, not when it merely exists.
  const logged = sorted.filter((d) => d.kcal !== undefined);

  const proteinDays = sorted.filter((d) => d.protein !== undefined && d.proteinTarget !== undefined);
  const sessions = sorted.filter((d) => d.trained).length;

  return {
    from,
    to,
    days: sorted,
    kcal: average(logged.map((d) => d.kcal!), outOf),
    protein: average(
      sorted.filter((d) => d.protein !== undefined).map((d) => d.protein!),
      outOf,
    ),
    // Averaged over the SAME days as intake, so "2,400 against a target of 2,300" compares two
    // figures drawn from one set of days rather than two different ones.
    kcalTarget: average(
      logged.filter((d) => d.kcalTarget !== undefined).map((d) => d.kcalTarget!),
      outOf,
    ),
    proteinHit: {
      days: proteinDays.filter((d) => d.protein! >= d.proteinTarget!).length,
      outOf: proteinDays.length,
    },
    sessions,
    sessionsPerWeek: outOf > 0 ? (sessions / outOf) * 7 : 0,
    loggedDays: logged.length,
  };
}

/**
 * How completely the window was logged, as a fraction. The UI uses this to decide whether an
 * average is worth showing at all: an average of two days out of twenty-eight describes those two
 * days, not the month.
 */
export function coverage(t: Trend): number {
  return t.days.length === 0 ? 0 : t.loggedDays / t.days.length;
}

/** Below this, a window's averages say more about the gaps than about the eating. */
export const MIN_COVERAGE = 0.5;

export function averagesAreMeaningful(t: Trend): boolean {
  return t.loggedDays > 0 && coverage(t) >= MIN_COVERAGE;
}
