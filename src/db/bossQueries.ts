/**
 * The weekly boss (docs/superpowers/specs/2026-11-12-boss-fight-design.md). One row is stored when
 * a boss appears (`ensureBoss`, which writes); whether it is beaten, its health and the attack are
 * read from the sets and the live plan (`loadBoss` and the rest, read-only, for useLiveQuery), so a
 * deleted or edited set changes the answer.
 */
import Dexie from 'dexie';
import { db } from './db';
import { nextSessionPlan } from './planQueries';
import { attackFor, bossHealth, pickBoss, type BossSet, type Candidate } from '@/domain/boss';
import { addDays, isoToDateKey, mondayOf } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import { bigger, setSize, START_SESSIONS } from '@/domain/level';
import { countsForRecords, sessionCountsForRecords } from '@/domain/sets';
import type { Boss, Exercise, Routine, RoutineExercise, Session, SetLog, Settings } from '@/domain/types';

export interface BossView {
  boss: Boss;
  exercise: Exercise;
  /** The date key of the set the boss is. */
  bestDate: string;
  health: number;
  beatenBy: BossSet | null;
  /** The routine Fight starts: the first current one that holds the lift; null when none does. */
  routine: Routine | null;
  /** The planned set that beats the boss; null when the plan no longer reaches it, or there is no plan. */
  attack: BossSet | null;
  /** The plan's top set when it falls short of the boss. */
  short: BossSet | null;
}

interface Tables {
  exercises: Exercise[];
  sessions: Map<string, Session>;
  sets: SetLog[];
  routines: Routine[];
  rxs: RoutineExercise[];
}

async function readTables(): Promise<Tables> {
  const [exercises, sessions, sets, routines, rxs] = await Promise.all([
    db.exercises.toArray(),
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.routines.toArray(),
    db.routineExercises.toArray(),
  ]);
  return { exercises, sessions: new Map(sessions.map((s) => [s.id, s])), sets, routines, rxs };
}

/** The sets of one lift that count for the game, oldest first (the rule Levels use). */
function countedSets(t: Tables, exerciseId: string): (SetLog & { reps: number })[] {
  return t.sets
    .filter((s): s is SetLog & { reps: number } => {
      const session = t.sessions.get(s.sessionId);
      return s.exerciseId === exerciseId && !!session && sessionCountsForRecords(session) && countsForRecords(s.type) && (s.reps ?? 0) >= 1;
    })
    // Sets can share a time (an import, a session the coach filled in): then the session's own order.
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.index - b.index);
}

const sizeOf = (s: BossSet) => setSize(s.weight, s.reps);
const lastDay = (boss: Boss) => addDays(boss.week, 6);
/** Completed after the boss appeared and on or before its Sunday. */
const inFight = (boss: Boss, s: SetLog) => s.completedAt > boss.appearedAt && isoToDateKey(s.completedAt) <= lastDay(boss);

/** The first set that beat the boss, or null. */
function beatingSet(t: Tables, boss: Boss): SetLog | null {
  return countedSets(t, boss.exerciseId).find((s) => inFight(boss, s) && bigger(sizeOf(s), sizeOf(boss))) ?? null;
}

/** Current routines in their order, each with its routine-exercises. */
function currentRoutines(t: Tables): Routine[] {
  return t.routines.filter((r) => !r.archived && !r.quick).sort((a, b) => a.order - b.order);
}

/** The first current routine whose routine-exercise for the lift is out of calibration. */
function routineFor(t: Tables, exerciseId: string): Routine | null {
  return currentRoutines(t).find((r) => t.rxs.some((x) => x.routineId === r.id && x.exerciseId === exerciseId && x.mode === 'normal')) ?? null;
}

async function planFor(routine: Routine, exerciseId: string, settings: Settings): Promise<{ weight: number; repMin: number; repMax: number } | null> {
  const item = (await nextSessionPlan(routine.id, settings))?.items.find((i) => i.exercise.id === exerciseId);
  const weight = item?.prescription.weight;
  return item && typeof weight === 'number' && weight > 0 ? { weight, repMin: item.prescription.repMin, repMax: item.prescription.repMax } : null;
}

function biggest(sets: readonly (SetLog & { reps: number })[]): (SetLog & { reps: number }) | null {
  return sets.reduce<(SetLog & { reps: number }) | null>((top, s) => (top === null || bigger(sizeOf(s), sizeOf(top)) ? s : top), null);
}

/** This week's bosses, oldest first. */
async function weekBosses(today: string): Promise<Boss[]> {
  return (await db.bosses.where('week').equals(mondayOf(today)).toArray()).sort((a, b) => a.appearedAt.localeCompare(b.appearedAt));
}

/**
 * Picks this week's boss when there is none live: none yet, or the latest beaten. Writes; call it
 * outside useLiveQuery. A pick racing another for the same lift loses to the unique index, quietly.
 */
export async function ensureBoss(today: string, settings: Settings): Promise<void> {
  const t = await readTables();
  const bosses = await weekBosses(today);
  const latest = bosses.at(-1);
  if (latest && !beatingSet(t, latest)) return;

  const candidates: Candidate[] = [];
  for (const exercise of t.exercises) {
    if (exercise.kind !== 'reps') continue;
    const routine = routineFor(t, exercise.id);
    if (!routine) continue;
    const sets = countedSets(t, exercise.id);
    if (new Set(sets.map((s) => s.sessionId)).size < START_SESSIONS) continue;
    const best = biggest(sets);
    const plan = best && (await planFor(routine, exercise.id, settings));
    if (best && plan) candidates.push({ exerciseId: exercise.id, name: exercise.name, best: { weight: best.weight, reps: best.reps }, plan: { routineId: routine.id, routineName: routine.name, ...plan } });
  }
  const pick = pickBoss(candidates, new Set(bosses.map((b) => b.exerciseId)));
  if (!pick) return;
  try {
    await db.bosses.add({ id: uuid(), week: mondayOf(today), exerciseId: pick.exerciseId, weight: pick.best.weight, reps: pick.best.reps, appearedAt: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof Dexie.ConstraintError)) throw e;
  }
}

/** This week's boss as Home shows it: the latest whose lift is still there; null when none. */
export async function loadBoss(today: string, settings: Settings): Promise<BossView | null> {
  const t = await readTables();
  const boss = (await weekBosses(today)).filter((b) => t.exercises.some((e) => e.id === b.exerciseId)).at(-1);
  if (!boss) return null;
  const exercise = t.exercises.find((e) => e.id === boss.exerciseId)!;
  const sets = countedSets(t, boss.exerciseId);
  const before = sets.filter((s) => s.completedAt <= boss.appearedAt);
  const lastSession = before.at(-1)?.sessionId;
  const floor = biggest(before.filter((s) => s.sessionId === lastSession));
  const weekBest = biggest(sets.filter((s) => inFight(boss, s)));
  const beaten = beatingSet(t, boss);
  const bestSet = before.find((s) => s.weight === boss.weight && s.reps === boss.reps);

  const routine = routineFor(t, boss.exerciseId);
  const plan = routine && (await planFor(routine, boss.exerciseId, settings));
  const attack = plan ? attackFor(boss, plan) : null;
  return {
    boss,
    exercise,
    bestDate: isoToDateKey(bestSet?.completedAt ?? boss.appearedAt),
    health: bossHealth(boss, floor && sizeOf(floor), weekBest && sizeOf(weekBest), beaten !== null),
    beatenBy: beaten && { weight: beaten.weight, reps: beaten.reps! },
    routine,
    attack,
    short: plan && !attack ? { weight: plan.weight, reps: plan.repMax } : null,
  };
}

/** Every boss beaten, newest first, with its lift's name; a lift no longer there is left out. */
export async function bossesBeaten(): Promise<{ id: string; name: string; weight: number; reps: number }[]> {
  const t = await readTables();
  const bosses = (await db.bosses.toArray()).sort((a, b) => b.appearedAt.localeCompare(a.appearedAt));
  return bosses.flatMap((b) => {
    const name = t.exercises.find((e) => e.id === b.exerciseId)?.name;
    return name && beatingSet(t, b) ? [{ id: b.id, name, weight: b.weight, reps: b.reps }] : [];
  });
}

/** The boss this set is the first to beat, for the set's toast; null for any other set. */
export async function bossBeatenBy(setId: string): Promise<Boss | null> {
  const set = await db.setLogs.get(setId);
  if (!set) return null;
  const t = await readTables();
  const bosses = await db.bosses.where('week').equals(mondayOf(isoToDateKey(set.completedAt))).toArray();
  return bosses.find((b) => b.exerciseId === set.exerciseId && beatingSet(t, b)?.id === setId) ?? null;
}

/** The bosses first beaten by a set in this session, for its summary. */
export async function sessionBosses(sessionId: string): Promise<{ name: string; weight: number; reps: number; by: BossSet }[]> {
  const t = await readTables();
  return (await db.bosses.toArray()).flatMap((b) => {
    const by = beatingSet(t, b);
    const name = t.exercises.find((e) => e.id === b.exerciseId)?.name;
    return by && name && by.sessionId === sessionId ? [{ name, weight: b.weight, reps: b.reps, by: { weight: by.weight, reps: by.reps! } }] : [];
  });
}
