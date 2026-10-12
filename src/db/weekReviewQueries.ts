/**
 * The Monday review's data: what the past seven days hold (training, records, food, weight, body
 * scans) gathered into `WeekReviewInput`, and the coach message that records a review having been
 * given. Read-only apart from `storeReviewMessage`.
 */
import { listScans } from './bodyScanRepo';
import { db } from './db';
import { recentRecords } from './recordsQueries';
import { trendWindow } from './trendQueries';
import { addDays, dateKeyToDate, isoToDateKey, nowIso } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import { calorieTargetOn } from '@/domain/nutrition';
import { regionOfMuscle, type TrainingRegion } from '@/domain/routineOrder';
import { countsForVolume } from '@/domain/sets';
import type { CoachMessage, Settings } from '@/domain/types';
import { inReviewWindow, reviewWindow, type ReviewRecord, type WeekReviewInput } from '@/domain/weekReview';

/** Everything the review is built from, for the seven days before `today`. */
export async function loadWeekReviewInput(today: string, settings: Settings): Promise<WeekReviewInput> {
  const { from, to } = reviewWindow(today);

  // startedAt is UTC and the window is in local days, so the index range is widened by a day each
  // side and the exact test is on the local day (the same care `sessionsOn` takes).
  const near = await db.sessions
    .where('startedAt')
    .between(`${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 1)}T23:59:59.999Z`, true, true)
    .toArray();
  const sessions = near.filter((s) => !!s.endedAt && inReviewWindow(s.startedAt, from, to)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const sets = sessions.length > 0 ? await db.setLogs.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray() : [];
  const exercises = new Map((await db.exercises.bulkGet([...new Set(sets.map((s) => s.exerciseId))])).filter((e) => !!e).map((e) => [e!.id, e!]));
  const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
  for (const s of sets) {
    if (!countsForVolume(s.type)) continue;
    const muscle = exercises.get(s.exerciseId)?.muscleGroup;
    const region = muscle ? regionOfMuscle(muscle) : null;
    if (region) setsByRegion[region] = (setsByRegion[region] ?? 0) + 1;
  }

  const [recent, trend, bodyweight, scans] = await Promise.all([
    recentRecords(100),
    trendWindow(to, 7, settings),
    db.bodyweight.where('date').between(addDays(today, -28), today, true, true).toArray(),
    listScans(),
  ]);
  const records: ReviewRecord[] = recent
    .filter((r) => inReviewWindow(r.date, from, to))
    .map((r) => ({ exercise: r.exercise.name, kind: r.record.kind, weight: r.record.weight, reps: r.record.reps }));

  return {
    today,
    sessions: sessions.map((s) => ({ date: isoToDateKey(s.startedAt), title: s.title })),
    setsByRegion,
    records,
    trend: trend.trend,
    targets: { calories: calorieTargetOn(today, settings)?.kcal ?? null, protein: settings.proteinTarget, proteinLegDay: settings.proteinTargetLegDay },
    bodyweight: bodyweight.map((b) => ({ date: b.date, kg: b.kg })),
    scans,
  };
}

/** The review the coach gave in the week that starts on `weekStart` (a Monday), or null. The newest if there are several. */
export async function weekReviewMessage(weekStart: string): Promise<CoachMessage | null> {
  const weekEnd = addDays(weekStart, 6);
  // `at` is UTC; widen the index range by a day below and filter on the local day.
  const since = dateKeyToDate(addDays(weekStart, -1)).toISOString();
  const found = await db.coachMessages
    .where('at')
    .aboveOrEqual(since)
    .filter((m) => m.moment === 'week' && isoToDateKey(m.at) >= weekStart && isoToDateKey(m.at) <= weekEnd)
    .toArray();
  return found.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

/** Record that the review was given: a coach message for the 'week' moment. */
export async function storeReviewMessage(text: string): Promise<CoachMessage> {
  const message: CoachMessage = { id: uuid(), at: nowIso(), role: 'coach', text, moment: 'week' };
  await db.coachMessages.put(message);
  return message;
}
