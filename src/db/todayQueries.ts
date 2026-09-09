/**
 * The one query that joins the two halves of the app.
 *
 * Protein target depends on whether the day was a leg day (§ Settings: proteinTargetLegDay),
 * which is a training fact answering a nutrition question. That join is the whole reason this
 * is one app rather than two tabs, so it lives in its own file rather than being smuggled into
 * either domain's repository.
 */
import { db } from './db';
import { dayTotals } from './foodRepo';
import { lastCompletedSession } from './repo';
import { suggestNextRoutine } from '@/domain/schedule';
import { addDays, isoToDateKey } from '@/domain/dates';
import { calorieTargetOn, proteinTarget, type CalorieTarget } from '@/domain/nutrition';
import { type Macros } from '@/domain/food';
import type { Session, Settings } from '@/domain/types';

export interface DayView {
  date: string;
  eaten: Macros;
  /** Null until a reverse-diet start date exists. */
  calories: CalorieTarget | null;
  proteinTarget: number;
  legDay: boolean;
  /** Why: what was trained, what is planned, or neither. */
  legDayBasis: LegDayBasis;
}

export type LegDayBasis = 'trained' | 'planned' | 'none';

export interface LegDayResult {
  legDay: boolean;
  basis: LegDayBasis;
}

/** Sessions started on a local day. */
export async function sessionsOn(date: string): Promise<Session[]> {
  // startedAt is indexed but stored as UTC, while `date` is a LOCAL day key. A local evening
  // in a western timezone lands on the next UTC day, so the index range is deliberately widened
  // by a day either side and the exact match is done on the local key.
  const sessions = await db.sessions
    .where('startedAt')
    .between(`${addDays(date, -1)}T00:00:00.000Z`, `${addDays(date, 1)}T23:59:59.999Z`, true, true)
    .toArray();
  return sessions.filter((s) => isoToDateKey(s.startedAt) === date);
}

/** Whether any session on this day belonged to a lower-body routine. */
export async function wasLegDay(date: string): Promise<boolean> {
  const onDay = await sessionsOn(date);
  if (!onDay.length) return false;
  const routineIds = onDay.map((s) => s.routineId).filter(Boolean);
  if (!routineIds.length) return false;
  const routines = await db.routines.bulkGet(routineIds);
  return routines.some((r) => r?.isLowerBody === true);
}

/**
 * Whether this day counts as a leg day for the protein target.
 *
 * Training that already happened settles it. For today with nothing trained yet, the planned
 * next routine stands in — the target has to be usable at breakfast, before the session it is
 * sized for. Any other day with no session is simply not a leg day.
 *
 * This is the only place that decision is made. Two screens computing it separately is how
 * Home and Food came to show different protein targets for the same day.
 */
export async function legDayFor(date: string, today?: string): Promise<LegDayResult> {
  if (await wasLegDay(date)) return { legDay: true, basis: 'trained' };
  if (await trainedOn(date)) return { legDay: false, basis: 'trained' };
  if (date !== today) return { legDay: false, basis: 'none' };

  const [routines, last] = await Promise.all([db.routines.toArray(), lastCompletedSession()]);
  const next = suggestNextRoutine(routines, last?.routineId ?? null, { avoidConsecutiveLower: true });
  return next ? { legDay: next.isLowerBody, basis: 'planned' } : { legDay: false, basis: 'none' };
}

/** Whether anything at all was trained on this day. */
async function trainedOn(date: string): Promise<boolean> {
  return (await sessionsOn(date)).length > 0;
}

export async function dayView(date: string, settings: Settings, today?: string): Promise<DayView> {
  const [eaten, leg] = await Promise.all([dayTotals(date), legDayFor(date, today)]);
  return {
    date,
    eaten,
    calories: calorieTargetOn(date, settings),
    proteinTarget: proteinTarget(settings, leg.legDay),
    legDay: leg.legDay,
    legDayBasis: leg.basis,
  };
}
