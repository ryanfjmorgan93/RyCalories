/**
 * The Monday review's raw material: the past seven days as a short list of facts the coach reads.
 * Pure: no IO, no clock. src/db/weekReviewQueries.ts gathers the input; the coach turns the facts
 * into the review (src/ai/moments.ts `weeklyReview`).
 *
 * The facts are honest about gaps. An average is over the days that were logged and says how many
 * (the way src/domain/trends.ts does), a figure that is not there is left out rather than zero, and
 * a body scan is dated so an old one is not mistaken for this week's.
 */
import { addDays, fmtDateKey, isoToDateKey } from './dates';
import { fmtKg, fmtNum, fmtSignedKg } from './format';
import { scanDeltas, type ScanFigures } from './inbody';
import type { TrainingRegion } from './routineOrder';
import type { RecordKind } from './records';
import { averagesAreMeaningful, type Trend } from './trends';
import type { Reading } from './weighIn';

/** The seven days before today: for a Monday, the Monday-to-Sunday week that has just ended. */
export function reviewWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -7), to: addDays(today, -1) };
}

/** Whether a local day key is a Monday. */
export function isMonday(dayKey: string): boolean {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 1;
}

export interface ReviewRecord {
  exercise: string;
  kind: RecordKind;
  weight: number;
  reps?: number;
}

export interface WeekReviewInput {
  today: string;
  /** Finished sessions that started in the window, with their names. */
  sessions: { date: string; title: string }[];
  /** Sets that count for volume, by region, over those sessions. */
  setsByRegion: Partial<Record<TrainingRegion, number>>;
  /** Records set in the window. */
  records: ReviewRecord[];
  /** The window's food, bodyweight and training, as src/db/trendQueries.ts `trendWindow` builds it. */
  trend: Trend;
  /** The targets in force today. */
  targets: { calories: number | null; protein: number; proteinLegDay: number };
  /** Bodyweight readings, any order; those from before the window help for the change. */
  bodyweight: Reading[];
  /** Every body scan, any order. */
  scans: (ScanFigures & { id?: string })[];
}

export type ReviewFacts = Record<string, string | number | boolean | undefined | readonly (string | number)[]>;

const MAX_RECORDS_LISTED = 5;

function signedNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${fmtNum(r)}` : r < 0 ? `−${fmtNum(Math.abs(r))}` : '0';
}

/** One line for an exercise that set a record: its best set of the week. */
export function recordLines(records: readonly ReviewRecord[], limit = MAX_RECORDS_LISTED): string[] {
  const byExercise = new Map<string, ReviewRecord>();
  for (const r of records) {
    const held = byExercise.get(r.exercise);
    if (!held || r.weight > held.weight || (r.weight === held.weight && (r.reps ?? 0) > (held.reps ?? 0))) byExercise.set(r.exercise, r);
  }
  return [...byExercise.values()]
    .sort((a, b) => a.exercise.localeCompare(b.exercise))
    .slice(0, limit)
    .map((r) => (r.reps ? `${r.exercise}: ${fmtKg(r.weight)} × ${fmtNum(r.reps)}` : `${r.exercise}: ${fmtKg(r.weight)}`));
}

/** "82.4 kg on 2026-10-12, +0.3 kg from 82.1 kg on 2026-10-05", and the change on its own. Empty with no reading. */
export function weightFacts(readings: readonly Reading[], today: string): { weight?: string; weightChangeKg?: number } {
  const upToToday = readings.filter((r) => r.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const latest = upToToday[0];
  if (!latest) return {};
  // The reading a week or so before the latest: five to fourteen days back.
  const base = upToToday.find((r) => r.date <= addDays(latest.date, -5) && r.date >= addDays(latest.date, -14));
  if (!base) return { weight: `${fmtKg(latest.kg)} on ${latest.date}` };
  const change = Math.round((latest.kg - base.kg) * 100) / 100;
  return { weight: `${fmtKg(latest.kg)} on ${latest.date}, ${fmtSignedKg(change)} from ${fmtKg(base.kg)} on ${base.date}`, weightChangeKg: change };
}

/** The latest body scan and what changed since the one before it; undefined with no scan. */
export function scanFacts(scans: readonly ScanFigures[]): string | undefined {
  const { latest, vsPrevious } = scanDeltas(scans);
  if (!latest) return undefined;
  const head = `latest scan ${latest.date}`;
  if (!vsPrevious) return head;
  const c = vsPrevious.change;
  const parts: string[] = [];
  if (c.skeletalMuscleKg !== null) parts.push(`skeletal muscle ${fmtSignedKg(c.skeletalMuscleKg)}`);
  if (c.bodyFatKg !== null) parts.push(`body fat ${fmtSignedKg(c.bodyFatKg)}`);
  if (c.bodyFatPct !== null) parts.push(`body fat ${signedNum(c.bodyFatPct)} points`);
  if (c.weightKg !== null) parts.push(`weight ${fmtSignedKg(c.weightKg)}`);
  return parts.length > 0 ? `${head}, since ${vsPrevious.scan.date}: ${parts.join(', ')}` : head;
}

/** The facts the coach reads for the review. Values that are not known are left out. */
export function buildReviewFacts(i: WeekReviewInput): ReviewFacts {
  const { from, to } = reviewWindow(i.today);
  const t = i.trend;
  const regionLines = (Object.entries(i.setsByRegion) as [TrainingRegion, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([region, n]) => `${region} ${n}`);
  const records = recordLines(i.records);
  const logged = t.loggedDays > 0;
  // An average over a couple of logged days says more about the gaps than the eating; it is still
  // given, with the day count beside it, and the coach is told when too few days stand behind it.
  const thin = logged && !averagesAreMeaningful(t);
  return {
    period: `${fmtDateKey(from)} to ${fmtDateKey(to)}`,
    sessions: i.sessions.length,
    sessionNames: i.sessions.length > 0 ? i.sessions.map((s) => s.title) : undefined,
    setsByRegion: regionLines.length > 0 ? regionLines : undefined,
    personalRecords: records.length > 0 ? records : undefined,
    daysFoodLogged: `${t.loggedDays} of ${t.days.length}`,
    averageCalories: logged && t.kcal.value !== null ? Math.round(t.kcal.value) : undefined,
    averageCalorieTarget: logged && t.kcalTarget.value !== null ? Math.round(t.kcalTarget.value) : undefined,
    averageProteinGrams: logged && t.protein.value !== null ? Math.round(t.protein.value) : undefined,
    proteinTargetMetOnDays: t.proteinHit.outOf > 0 ? `${t.proteinHit.days} of ${t.proteinHit.outOf}` : undefined,
    foodLoggedForFewDays: thin ? true : undefined,
    ...weightFacts(i.bodyweight, i.today),
    bodyScan: scanFacts(i.scans),
    currentCalorieTarget: i.targets.calories ?? undefined,
    currentProteinTargetGrams: i.targets.protein,
    currentProteinTargetLowerBodyDayGrams: i.targets.proteinLegDay,
  };
}

/** Whether an ISO timestamp falls on a local day in the window (inclusive). */
export function inReviewWindow(iso: string, from: string, to: string): boolean {
  const key = isoToDateKey(iso);
  return key >= from && key <= to;
}
