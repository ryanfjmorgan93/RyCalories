/**
 * The game's reading of everything trained: each exercise's Level (domain/level.ts), the total, the
 * lifts nearest their next level, and the badge ladders (domain/badges.ts). One read of the tables,
 * then pure sums, so the same arrays can be read as they stood around one session. Read-only; call
 * from useLiveQuery.
 *
 * Nothing is stored: all of it follows the sets, sessions and weigh-ins as they are.
 */
import { db } from './db';
import { ladders, newBadges, type FoodDays, type Ladder } from '@/domain/badges';
import { isoToDateKey } from '@/domain/dates';
import { levelFor, totalLevel, type Level } from '@/domain/level';
import { countsForRecords, countsForVolume, sessionCountsForRecords } from '@/domain/sets';
import { sessionVolume } from '@/domain/volume';
import type { Bodyweight, Exercise, Routine, RoutineExercise, Session, SetLog, Settings } from '@/domain/types';
import { displayMacros } from '@/domain/food';
import { proteinTarget } from '@/domain/nutrition';
import { getSettings } from './repo';

export interface GameLevel {
  exercise: Exercise;
  level: Level;
  /** The first current routine that has the exercise; null when none does. */
  routine: string | null;
}

export interface Game {
  /** Every exercise that has a Level, by name. */
  levels: GameLevel[];
  /** Every level above 1, all lifts added up. */
  total: number;
  /** Up to three exercises of the current routines nearest their next level, nearest first. */
  closest: GameLevel[];
  ladders: Ladder[];
  /** Sessions finished with a counted set, and every kilo lifted in them. */
  sessions: number;
  liftedKg: number;
}

interface Tables {
  exercises: Exercise[];
  sessions: Session[];
  sets: SetLog[];
  routines: Routine[];
  rxs: RoutineExercise[];
  weighIns: Bodyweight[];
}

const readTables = async (): Promise<Tables> => {
  const [exercises, sessions, sets, routines, rxs, weighIns] = await Promise.all([
    db.exercises.toArray(),
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.routines.toArray(),
    db.routineExercises.toArray(),
    db.bodyweight.orderBy('date').toArray(),
  ]);
  return { exercises, sessions, sets, routines, rxs, weighIns };
};

/** The game over the sessions `keep` lets in, with the last weigh-in on or before `day` (the last of all without one). */
function gameFrom(t: Tables, keep: (s: Session) => boolean, day?: string, food?: FoodDays): Game {
  const kept = new Map(t.sessions.filter(keep).map((s) => [s.id, s]));
  const sets = t.sets.filter((s) => kept.has(s.sessionId));
  const bodyweightKg = t.weighIns.filter((w) => day === undefined || w.date <= day).at(-1)?.kg;

  // Current routines in their order: where an exercise is trained, and at what working weight.
  const current = t.routines.filter((r) => !r.archived && !r.quick).sort((a, b) => a.order - b.order);
  const routineOf = new Map<string, string>();
  const working = new Map<string, number>();
  for (const routine of current) {
    for (const rx of t.rxs.filter((x) => x.routineId === routine.id)) {
      if (!routineOf.has(rx.exerciseId)) routineOf.set(rx.exerciseId, routine.name);
      if (rx.mode === 'normal') working.set(rx.exerciseId, Math.max(working.get(rx.exerciseId) ?? 0, rx.currentWeight));
    }
  }

  // What counts for a Level and for a heaviest set: the sets records count, outside a light quick session.
  const counted = new Map<string, Map<string, SetLog[]>>();
  for (const s of sets) {
    if (!sessionCountsForRecords(kept.get(s.sessionId)!)) continue;
    const bySession = counted.get(s.exerciseId) ?? new Map<string, SetLog[]>();
    bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s]);
    counted.set(s.exerciseId, bySession);
  }

  const levels: GameLevel[] = [];
  const lifts: { id: string; name: string; kg: number }[] = [];
  for (const exercise of [...t.exercises].sort((a, b) => a.name.localeCompare(b.name))) {
    const bySession = counted.get(exercise.id);
    if (!bySession) continue;
    const sessions = [...bySession].map(([sessionId, own]) => ({ sessionId, startedAt: kept.get(sessionId)!.startedAt, sets: own }));
    const level = levelFor(exercise.kind, sessions, { bodyweightKg, workingWeight: working.get(exercise.id) });
    if (level) levels.push({ exercise, level, routine: routineOf.get(exercise.id) ?? null });
    if (exercise.equipment === 'barbell' && exercise.kind === 'reps') {
      const kg = Math.max(0, ...sessions.flatMap((s) => s.sets.filter((x) => countsForRecords(x.type) && (x.reps ?? 0) >= 1).map((x) => x.weight)));
      // A lift under its first mark has a ladder only while it is being trained: nobody chases a 60 kg curl they dropped.
      if (kg >= 60 || (kg > 0 && routineOf.has(exercise.id))) lifts.push({ id: exercise.id, name: exercise.name, kg });
    }
  }

  const total = totalLevel(levels.map((l) => l.level));
  const sessionsDone = new Set(sets.filter((s) => countsForVolume(s.type)).map((s) => s.sessionId)).size;
  const liftedKg = sessionVolume(sets);
  return {
    sessions: sessionsDone,
    liftedKg,
    levels,
    total,
    closest: levels
      .filter((l) => l.routine !== null && l.level.startIn === 0)
      .sort((a, b) => b.level.fill - a.level.fill || a.exercise.name.localeCompare(b.exercise.name))
      .slice(0, 3),
    ladders: ladders({ sessions: sessionsDone, liftedKg, totalLevel: total, lifts, ...(food ? { food } : {}) }),
  };
}

/**
 * The days food was logged on, and how many of them reached that day's protein target, for the two
 * food ladders. One sweep rather than trendQueries' day-by-day read (this covers every day there
 * is, on Home), by the same rules: a day is logged when it has a meal, its protein is the sum the
 * day screen shows, and its target is the leg-day one when a lower-body routine was trained on it.
 * `gameQueries.test.ts` holds the two in step. Past days are judged by today's targets, as Progress
 * judges them: the targets a day had are not kept.
 */
export async function foodDays(settings: Settings): Promise<FoodDays> {
  const [meals, items, sessions, routines] = await Promise.all([db.meals.toArray(), db.mealItems.toArray(), db.sessions.toArray(), db.routines.toArray()]);
  const dateOf = new Map(meals.map((m) => [m.id, m.date]));
  const protein = new Map<string, number>(meals.map((m) => [m.date, 0]));
  for (const item of items) {
    const date = dateOf.get(item.mealId);
    if (date !== undefined) protein.set(date, protein.get(date)! + displayMacros(item.nutrition).protein);
  }
  const lower = new Set(routines.filter((r) => r.isLowerBody).map((r) => r.id));
  const legDays = new Set(sessions.filter((s) => s.routineId && lower.has(s.routineId)).map((s) => isoToDateKey(s.startedAt)));
  let proteinHit = 0;
  for (const [date, eaten] of protein) if (eaten >= proteinTarget(settings, legDays.has(date))) proteinHit++;
  return { logged: protein.size, proteinHit };
}

/** The game as it stands: every finished session, the latest weigh-in, every day of food. */
export async function loadGame(): Promise<Game> {
  return gameFrom(await readTables(), (s) => !!s.endedAt, undefined, await foodDays(await getSettings()));
}

/**
 * What one session did to the game: the badges it added and the total level before and with it.
 * Only finished sessions that began before it are its history, and one weigh-in (the last on or
 * before its day) serves both sides, so a past session reads as it stood and a change of
 * bodyweight alone adds nothing. Null for a session that is not there.
 */
export async function sessionGame(sessionId: string): Promise<{ badges: string[]; total: { from: number; to: number } } | null> {
  const t = await readTables();
  const session = t.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const earlier = (s: Session) => !!s.endedAt && s.startedAt < session.startedAt;
  const day = isoToDateKey(session.startedAt);
  const before = gameFrom(t, earlier, day);
  const after = gameFrom(t, (s) => earlier(s) || s.id === sessionId, day);
  return { badges: newBadges(before.ladders, after.ladders), total: { from: before.total, to: after.total } };
}
