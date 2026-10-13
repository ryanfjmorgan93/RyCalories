/**
 * Steps: daily totals from the step records Health Connect holds, and the week the Steps sheet
 * shows. Pure: records and the day in, numbers out. src/platform/health.ts reads the records.
 *
 * Health Connect hands back raw records, one per app that wrote them. When two apps both count the
 * same walk (the phone and a watch, or Samsung Health and Google Fit) their records overlap, and
 * adding them would count the walk twice. So a day's total is the largest total any ONE source
 * recorded that day, never the sum across sources: a number that can only be too low, not too high.
 */
import { addDays, toDateKey } from './dates';

export const DEFAULT_STEP_GOAL = 8000;
export const STEP_GOAL_MIN = 1000;
export const STEP_GOAL_MAX = 50000;

export interface StepRecord {
  /** Steps in the record. */
  value: number;
  /** ISO start of the record; it counts towards its start's local day. */
  startDate: string;
  /** The app that wrote it, when Health Connect says. */
  sourceId?: string;
  sourceName?: string;
}

export interface StepDay {
  /** Local day, YYYY-MM-DD. */
  date: string;
  /** The day's steps; null when nothing at all was recorded that day (not the same as 0). */
  steps: number | null;
}

/** Daily totals for `days` days ending `today`, oldest first: per source per day, the largest source wins. */
export function dailySteps(records: readonly StepRecord[], today: string, days = 7): StepDay[] {
  const bySourceDay = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (!Number.isFinite(r.value) || r.value < 0) continue;
    const start = new Date(r.startDate);
    if (Number.isNaN(start.getTime())) continue;
    const day = toDateKey(start);
    const source = r.sourceId ?? r.sourceName ?? 'unknown';
    const perDay = bySourceDay.get(day) ?? new Map<string, number>();
    perDay.set(source, (perDay.get(source) ?? 0) + r.value);
    bySourceDay.set(day, perDay);
  }
  const out: StepDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const perDay = bySourceDay.get(date);
    out.push({ date, steps: perDay ? Math.round(Math.max(...perDay.values())) : null });
  }
  return out;
}

export interface StepWeek {
  days: StepDay[];
  today: number | null;
  goal: number;
  /** Sum over the recorded days. */
  total: number;
  /** Average over recorded days only; null when none was recorded. */
  average: number | null;
  recordedDays: number;
  /** Recorded days at or over the goal. */
  goalHit: number;
}

/** The week as the Steps sheet shows it. Days with nothing recorded are left out of the average, never counted as 0. */
export function stepWeek(days: readonly StepDay[], goal: number): StepWeek {
  const recorded = days.filter((d): d is StepDay & { steps: number } => d.steps !== null);
  const total = recorded.reduce((sum, d) => sum + d.steps, 0);
  return {
    days: [...days],
    today: days.at(-1)?.steps ?? null,
    goal,
    total,
    average: recorded.length > 0 ? Math.round(total / recorded.length) : null,
    recordedDays: recorded.length,
    goalHit: recorded.filter((d) => d.steps >= goal).length,
  };
}

/** A goal as typed, a whole number held to a sensible range; the default when it is not a number. */
export function cleanStepGoal(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_STEP_GOAL;
  return Math.min(STEP_GOAL_MAX, Math.max(STEP_GOAL_MIN, Math.round(n)));
}
