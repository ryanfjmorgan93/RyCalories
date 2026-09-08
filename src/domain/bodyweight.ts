import { daysBetween } from './dates';
import type { Bodyweight } from './types';

export interface WeeklyDelta {
  /** kg change per week (positive = gained). */
  deltaKg: number;
  /** 'avg' compares 7-day rolling averages; 'points' compares two single readings scaled to a week. */
  method: 'avg' | 'points';
  currentAvg: number;
  previousAvg: number;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Last-7-day delta: mean of readings in the last 7 days minus mean of the 7 days before.
 * Falls back to the latest reading vs the closest reading ≥5 days earlier, scaled to a week.
 * Null with fewer than two usable readings.
 */
export function weeklyDelta(entries: Bodyweight[], asOf: string): WeeklyDelta | null {
  const sorted = [...entries].filter((e) => e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const inWindow = (from: number, to: number) =>
    sorted.filter((e) => {
      const d = daysBetween(e.date, asOf);
      return d >= from && d <= to;
    });
  const cur = inWindow(0, 6);
  const prev = inWindow(7, 13);
  if (cur.length && prev.length) {
    const c = avg(cur.map((e) => e.kg));
    const p = avg(prev.map((e) => e.kg));
    return { deltaKg: round2(c - p), method: 'avg', currentAvg: round2(c), previousAvg: round2(p) };
  }
  const latest = sorted[sorted.length - 1];
  const earlier = [...sorted].reverse().find((e) => daysBetween(e.date, latest.date) >= 5);
  if (!earlier) return null;
  const span = daysBetween(earlier.date, latest.date);
  const perWeek = ((latest.kg - earlier.kg) / span) * 7;
  return { deltaKg: round2(perWeek), method: 'points', currentAvg: latest.kg, previousAvg: earlier.kg };
}

export type BandStatus = 'below' | 'in' | 'above';

export function bandStatus(delta: number, min: number, max: number): BandStatus {
  if (delta < min) return 'below';
  if (delta > max) return 'above';
  return 'in';
}

/** Simple moving average series for charting (window in readings, not days). */
export function movingAverage(entries: Bodyweight[], window = 5): { date: string; kg: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e, i) => {
    const slice = sorted.slice(Math.max(0, i - window + 1), i + 1);
    return { date: e.date, kg: round2(avg(slice.map((x) => x.kg))) };
  });
}
