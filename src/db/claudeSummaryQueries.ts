/**
 * Loads everything `buildClaudeSummary` (src/domain/claudeSummary.ts) needs for the "Copy for
 * Claude" export. All four datasets are always loaded in full, regardless of `include` — the
 * export sheet shows a count on every toggle, on and off, so the counts have to be accurate
 * whether or not that section ends up in the text.
 */
import { dayTotals } from './foodRepo';
import { completedSessions, sessionSeconds } from './historyQueries';
import { db } from './db';
import { listRoutines, routineItems, sessionDetail } from './repo';
import type {
  ClaudeSummaryInclude,
  ClaudeSummaryInput,
  SummaryExercise,
  SummaryFoodDay,
  SummaryRoutine,
  SummarySession,
  SummarySet,
} from '@/domain/claudeSummary';
import { addDays, isoToDateKey } from '@/domain/dates';
import { calorieTargetOn, proteinTarget } from '@/domain/nutrition';
import { targetLine } from '@/domain/format';
import type { Settings } from '@/domain/types';

export interface ClaudeSummaryWindows {
  trainingDays: number;
  foodDays: number;
  bodyweightDays: number;
}

const DEFAULT_WINDOWS: ClaudeSummaryWindows = { trainingDays: 56, foodDays: 28, bodyweightDays: 56 };

/** Inclusive window start for `days` days ending on `asOf`. */
function windowStart(asOf: string, days: number): string {
  return addDays(asOf, -(Math.max(1, days) - 1));
}

/** Completed sessions, most recent detail included, whose local start date falls in the window. Newest first. */
async function loadSessions(asOf: string, days: number): Promise<SummarySession[]> {
  const from = windowStart(asOf, days);
  const all = await completedSessions(); // newest first already
  const inWindow = all.filter((s) => {
    const key = isoToDateKey(s.startedAt);
    return key >= from && key <= asOf;
  });
  const out: SummarySession[] = [];
  for (const s of inWindow) {
    const detail = await sessionDetail(s.id);
    const exercises: SummaryExercise[] = (detail?.groups ?? []).map((g) => {
      const sets: SummarySet[] = g.sets.map((set) => ({
        type: set.type,
        weight: set.weight,
        reps: set.reps,
        seconds: set.seconds,
        distanceM: set.distanceM,
      }));
      return { name: g.exercise.name, kind: g.exercise.kind, sets };
    });
    const seconds = sessionSeconds(s);
    out.push({
      date: isoToDateKey(s.startedAt),
      title: s.title,
      // 0 elapsed seconds is indistinguishable from "no duration recorded" for a completed
      // session, so it reads as unknown rather than a suspiciously instant workout.
      minutes: seconds > 0 ? Math.round(seconds / 60) : null,
      deload: s.deload,
      exercises,
    });
  }
  return out;
}

/** One entry per day in the window, oldest first; a day with zero meals logs as `macros: null`. */
async function loadFoodDays(asOf: string, days: number): Promise<SummaryFoodDay[]> {
  const from = windowStart(asOf, days);
  const n = Math.max(1, days);
  const out: SummaryFoodDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const mealCount = await db.meals.where('date').equals(date).count();
    out.push({ date, macros: mealCount > 0 ? await dayTotals(date) : null });
  }
  return out;
}

async function loadRoutines(): Promise<SummaryRoutine[]> {
  const routines = await listRoutines(); // already unarchived, ordered
  const out: SummaryRoutine[] = [];
  for (const r of routines) {
    const items = await routineItems(r.id);
    out.push({ name: r.name, items: items.map((it) => ({ name: it.exercise.name, line: targetLine(it.rx, it.exercise.kind) })) });
  }
  return out;
}

export async function loadClaudeSummaryInput(
  asOf: string,
  include: ClaudeSummaryInclude,
  settings: Settings,
  windows: ClaudeSummaryWindows = DEFAULT_WINDOWS,
): Promise<ClaudeSummaryInput> {
  const [sessions, perDay, bodyweight, routines] = await Promise.all([
    loadSessions(asOf, windows.trainingDays),
    loadFoodDays(asOf, windows.foodDays),
    db.bodyweight.toArray(),
    loadRoutines(),
  ]);

  const calorieTarget = calorieTargetOn(asOf, settings);
  const normalProteinTarget = proteinTarget(settings, false);
  const legDayProteinTarget = proteinTarget(settings, true);

  return {
    asOf,
    include,
    training: { days: windows.trainingDays, sessions },
    food: {
      days: windows.foodDays,
      perDay,
      calorieTarget: calorieTarget ? calorieTarget.kcal : null,
      proteinTarget: normalProteinTarget,
      proteinTargetLegDay: legDayProteinTarget !== normalProteinTarget ? legDayProteinTarget : undefined,
    },
    bodyweight: { days: windows.bodyweightDays, readings: bodyweight },
    routines,
  };
}
