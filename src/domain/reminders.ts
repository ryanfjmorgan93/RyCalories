/**
 * Reminders: which local notifications to have scheduled for the next seven days, decided from the
 * owner's own data. Pure — no IO, no clock (`now` is passed in), no database, and no model. The
 * wording is fixed text with the owner's real numbers in it, so the reminders cost nothing and work
 * offline. src/platform/reminders.ts gathers the input and hands the result to Android.
 *
 * Three reminders, each with its own rule for when it stays quiet:
 *
 * - Food, every evening: skipped once something has been logged for that day after 17:00, because
 *   the owner has evidently been in the app.
 * - Training, on each day the last session would be at least `afterDays` old: names any region not
 *   trained for a week ("Legs last trained 9 days ago").
 * - Weigh-in, on the chosen weekday: skipped once a bodyweight has been logged since the Monday
 *   that week began.
 *
 * Nothing is reminded about in the past, and a plan is only good until the owner next opens the
 * app, which is why the platform layer replans whenever the app goes to the background.
 */
import { addDays, daysBetween, isoToDateKey, mondayOf, toDateKey } from './dates';
import { plural } from './format';
import type { MuscleGroup } from './types';
import { muscleRecency, type MuscleSetRow } from './volume';

export interface ReminderPrefs {
  food: { on: boolean; time: string };
  training: { on: boolean; time: string; afterDays: number };
  /** `weekday` is JavaScript's: 0 Sunday to 6 Saturday. */
  weighIn: { on: boolean; weekday: number; time: string };
}

/**
 * What a reminder does before the owner touches a setting: the food reminder at 20:30, training at
 * 17:30 after two days without a session, the weigh-in on Monday at 12:00, all on. Deliberately NOT
 * part of `DEFAULT_SETTINGS`: a freshly seeded row stays as it was, and `resolveReminders` fills in
 * whatever a stored row does not have, so an existing install gets these without a migration. They
 * only ever reach the phone once notification permission has been granted.
 */
export const DEFAULT_REMINDERS: ReminderPrefs = {
  food: { on: true, time: '20:30' },
  training: { on: true, time: '17:30', afterDays: 2 },
  weighIn: { on: true, weekday: 1, time: '12:00' },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

type Partials<T> = { [K in keyof T]?: Partial<T[K]> };

/** Stored preferences with every missing or malformed part replaced by its default. */
export function resolveReminders(stored?: Partials<ReminderPrefs> | null): ReminderPrefs {
  const d = DEFAULT_REMINDERS;
  const time = (v: unknown, fallback: string) => (isValidTime(v) ? v : fallback);
  const on = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const int = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
  return {
    food: { on: on(stored?.food?.on, d.food.on), time: time(stored?.food?.time, d.food.time) },
    training: {
      on: on(stored?.training?.on, d.training.on),
      time: time(stored?.training?.time, d.training.time),
      afterDays: int(stored?.training?.afterDays, 1, 14, d.training.afterDays),
    },
    weighIn: {
      on: on(stored?.weighIn?.on, d.weighIn.on),
      weekday: int(stored?.weighIn?.weekday, 0, 6, d.weighIn.weekday),
      time: time(stored?.weighIn?.time, d.weighIn.time),
    },
  };
}

// ---------------------------------------------------------------------------
// Ids

/**
 * Notification ids Iron's reminders use: 8100 to 8129. The rest-over notification is 7001
 * (src/state/native.ts), so the two can never replace each other. Within the range an id is the
 * reminder's kind plus the weekday it falls on; a seven-day plan holds each weekday once, so the
 * same plan always gets the same ids and scheduling over a pending one replaces it.
 */
export const REMINDER_ID_FIRST = 8100;
export const REMINDER_ID_LAST = 8129;
const KIND_BASE = { food: 8100, training: 8110, weighIn: 8120 } as const;

export function isReminderId(id: number): boolean {
  return Number.isInteger(id) && id >= REMINDER_ID_FIRST && id <= REMINDER_ID_LAST;
}

// ---------------------------------------------------------------------------
// Regions

export type TrainingRegion = 'legs' | 'back' | 'chest' | 'shoulders' | 'arms';

/** The region a muscle group counts towards. Abs, neck, full body and other belong to none. */
export const REGION_OF_MUSCLE: Partial<Record<MuscleGroup, TrainingRegion>> = {
  hamstrings: 'legs',
  glutes: 'legs',
  quads: 'legs',
  adductors: 'legs',
  calves: 'legs',
  'lower back': 'back',
  lats: 'back',
  'upper back': 'back',
  traps: 'back',
  chest: 'chest',
  shoulders: 'shoulders',
  'rear delts': 'shoulders',
  triceps: 'arms',
  biceps: 'arms',
  forearms: 'arms',
};

const REGION_NAME: Record<TrainingRegion, string> = { legs: 'Legs', back: 'Back', chest: 'Chest', shoulders: 'Shoulders', arms: 'Arms' };
const REGION_ORDER: TrainingRegion[] = ['legs', 'back', 'chest', 'shoulders', 'arms'];

/** Days since each region was last trained: the most recently trained muscle in it. Absent when never trained. */
export function regionRecency(byMuscle: Partial<Record<MuscleGroup, number>>): Partial<Record<TrainingRegion, number>> {
  const out: Partial<Record<TrainingRegion, number>> = {};
  for (const [muscle, days] of Object.entries(byMuscle) as [MuscleGroup, number][]) {
    const region = REGION_OF_MUSCLE[muscle];
    if (!region) continue;
    out[region] = Math.min(out[region] ?? Infinity, days);
  }
  return out;
}

/** A region left this many days or more is named in the training reminder. */
export const NEGLECTED_AFTER_DAYS = 7;
/** At most this many regions go in one reminder; the longest-neglected first. */
const MAX_REGIONS_NAMED = 3;

// ---------------------------------------------------------------------------
// Planning

export interface ReminderInput {
  /** Meals with the day they count towards, when each was logged, and their calories. */
  meals: { date: string; loggedAt: string; kcal: number }[];
  /** Local day (YYYY-MM-DD) of the most recent finished session; null when there has been none. */
  lastSessionDate: string | null;
  /** Every counted set with its muscle group, as `muscleRecency` takes them. */
  muscleRows: MuscleSetRow[];
  /** Days (YYYY-MM-DD) that have a bodyweight reading. */
  bodyweightDates: string[];
}

export interface PlannedReminder {
  id: number;
  at: Date;
  title: string;
  body: string;
}

/** Days ahead planned, today included: seven days holds every weekday once. */
export const HORIZON_DAYS = 7;
/** Food logged at or after this hour counts as the evening being handled. */
export const EVENING_HOUR = 17;

const kcalFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

function at(dayKey: string, time: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** The reminders to have scheduled, soonest first. Empty for a reminder switched off. */
export function planReminders(input: ReminderInput, now: Date, prefs: ReminderPrefs): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const today = toDateKey(now);

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDays(today, i);
    const weekday = weekdayOf(day);

    if (prefs.food.on) {
      const when = at(day, prefs.food.time);
      if (when.getTime() > now.getTime()) {
        const meals = input.meals.filter((m) => m.date === day);
        const eveningLogged = meals.some((m) => isoToDateKey(m.loggedAt) === day && new Date(m.loggedAt).getHours() >= EVENING_HOUR);
        if (!eveningLogged) {
          const kcal = Math.round(meals.reduce((sum, m) => sum + m.kcal, 0));
          out.push({
            id: KIND_BASE.food + weekday,
            at: when,
            title: 'Food',
            body: kcal > 0 ? `Log today's food: ${kcalFormat.format(kcal)} kcal so far` : 'Nothing logged yet today',
          });
        }
      }
    }

    if (prefs.training.on && input.lastSessionDate !== null) {
      const when = at(day, prefs.training.time);
      const sinceSession = daysBetween(input.lastSessionDate, day);
      if (when.getTime() > now.getTime() && sinceSession >= prefs.training.afterDays) {
        const regions = regionRecency(muscleRecency(input.muscleRows, day));
        const neglected = REGION_ORDER.filter((r) => (regions[r] ?? 0) >= NEGLECTED_AFTER_DAYS)
          .sort((a, b) => regions[b]! - regions[a]!)
          .slice(0, MAX_REGIONS_NAMED);
        out.push({
          id: KIND_BASE.training + weekday,
          at: when,
          title: 'Training',
          body: neglected.length
            ? neglected.map((r) => `${REGION_NAME[r]} last trained ${plural(regions[r]!, 'day')} ago`).join('. ')
            : `Last session was ${plural(sinceSession, 'day')} ago`,
        });
      }
    }

    if (prefs.weighIn.on && weekday === prefs.weighIn.weekday) {
      const when = at(day, prefs.weighIn.time);
      const weekStart = mondayOf(day);
      const weighedThisWeek = input.bodyweightDates.some((d) => d >= weekStart && d <= day);
      if (when.getTime() > now.getTime() && !weighedThisWeek) {
        out.push({ id: KIND_BASE.weighIn + weekday, at: when, title: 'Weigh-in', body: "Log this week's weight" });
      }
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
}
