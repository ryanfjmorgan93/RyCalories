/**
 * The Food screen's week at a glance: seven days of calories against each day's own target. Pure
 * functions only — no IO, no clock, no database.
 *
 * It never flatters. A day with nothing logged is `unlogged` — not a short bar, not zero — because
 * "ate nothing" and "did not write it down" are different facts and only the second is known. A
 * day over its target is `over`, and the bar is drawn to its real height on the same scale as the
 * rest rather than capped to look tidy.
 */

import { dateKeyToDate } from './dates';
import type { DayRecord } from './trends';

export type StripState = 'unlogged' | 'within' | 'over' | 'no-target';

export interface StripDay {
  date: string;
  /** One letter: M T W T F S S. */
  weekday: string;
  state: StripState;
  kcal?: number;
  target?: number;
  /** Kilocalories past the target, for an `over` day. */
  overBy?: number;
  /** Bar height as a percentage of the tallest thing in the window (a day's intake or its target). */
  heightPct: number;
  /** Where the target line sits, same scale. Absent without a target. */
  targetPct?: number;
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function weekdayLetter(date: string): string {
  return LETTERS[dateKeyToDate(date).getDay()] ?? '';
}

export function weekStrip(days: DayRecord[]): StripDay[] {
  const top = days.reduce((m, d) => Math.max(m, d.kcal ?? 0, d.kcalTarget ?? 0), 0);
  const scale = top > 0 ? top : 1;
  return days.map((d): StripDay => {
    const target = d.kcalTarget;
    const base = { date: d.date, weekday: weekdayLetter(d.date) };
    if (d.kcal === undefined) {
      return { ...base, state: 'unlogged', heightPct: 0, ...(target !== undefined ? { target, targetPct: (target / scale) * 100 } : {}) };
    }
    const heightPct = (d.kcal / scale) * 100;
    if (target === undefined) return { ...base, state: 'no-target', kcal: d.kcal, heightPct };
    const over = d.kcal > target;
    return {
      ...base,
      state: over ? 'over' : 'within',
      kcal: d.kcal,
      target,
      ...(over ? { overBy: d.kcal - target } : {}),
      heightPct,
      targetPct: (target / scale) * 100,
    };
  });
}
