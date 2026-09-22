/**
 * Personal records, bests and per-exercise chart series. Read-only queries; call from
 * useLiveQuery so screens re-render when sets or sessions change.
 */
import { db } from './db';
import { isoToDateKey } from '@/domain/dates';
import { bestsFor, newRecords, type Bests, type PersonalRecord, type RecordSession, type RecordSet } from '@/domain/records';
import { bestE1rm } from '@/domain/strength';
import { sessionVolume } from '@/domain/volume';
import type { Exercise, Session, SetLog } from '@/domain/types';
import type { ChartPoint } from '@/ui/components/LineChart';

function byIndex(a: SetLog, b: SetLog): number {
  return a.index - b.index || a.completedAt.localeCompare(b.completedAt);
}

function toRecordSet(s: SetLog): RecordSet {
  return { type: s.type, weight: s.weight, reps: s.reps };
}

/** Latest bodyweight reading on or before a session's local day; undefined when there is none. */
async function bodyweightKgFor(session: Session): Promise<number | undefined> {
  const day = isoToDateKey(session.startedAt);
  const rows = (await db.bodyweight.toArray()).filter((b) => b.date <= day);
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows[0].kg;
}

async function latestBodyweightKg(): Promise<number | undefined> {
  const rows = await db.bodyweight.toArray();
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows[0].kg;
}

/**
 * Completed sessions' sets for an exercise (other than `excludeSessionId`), as `RecordSession`s.
 * `before`, when given, also excludes sessions that started on or after it — so a finished
 * session's records can be judged against only what stood at the time it was logged.
 */
async function priorRecordSessions(exerciseId: string, excludeSessionId: string, before?: string): Promise<RecordSession[]> {
  const sets = await db.setLogs.where('exerciseId').equals(exerciseId).toArray();
  const bySession = new Map<string, SetLog[]>();
  for (const s of sets) {
    if (s.sessionId === excludeSessionId) continue;
    const arr = bySession.get(s.sessionId) ?? [];
    arr.push(s);
    bySession.set(s.sessionId, arr);
  }
  const sessions = (await db.sessions.bulkGet([...bySession.keys()])).filter(
    (s): s is Session => !!s && !!s.endedAt && (before === undefined || s.startedAt < before),
  );
  return sessions.map((session) => ({
    sessionId: session.id,
    startedAt: session.startedAt,
    source: session.source,
    sets: (bySession.get(session.id) ?? []).sort(byIndex).map(toRecordSet),
  }));
}

/**
 * Records set by `newSets` for an exercise in `sessionId`, against every other completed
 * session's counted sets (Hevy imports included, attributed) PLUS the earlier sets of this same
 * session (so a second heavier set is compared with the first, not only with history).
 *
 * `opts.calibrating` suppresses records for a slot whose working weight isn't established yet.
 */
export async function recordsForNewSets(
  exerciseId: string,
  sessionId: string,
  newSets: SetLog[],
  opts?: { before?: string; calibrating?: boolean },
): Promise<PersonalRecord[]> {
  if (newSets.length === 0) return [];
  const [exercise, session] = await Promise.all([db.exercises.get(exerciseId), db.sessions.get(sessionId)]);
  if (!exercise || !session) return [];
  const bodyweightKg = exercise.kind === 'bodyweight_plus' ? await bodyweightKgFor(session) : undefined;
  const priorSessions = await priorRecordSessions(exerciseId, sessionId, opts?.before);
  // Computed ONCE, here, from the real completed prior sessions only — before the same-session
  // "so far" entry is spliced in below. Inferring it from the spliced array would let a set
  // logged three minutes ago in this same session count as history for a first-ever session.
  const hasPriorHistory = priorSessions.length > 0;

  const newIds = new Set(newSets.map((s) => s.id));
  const earlier = (await db.setLogs.where('[sessionId+exerciseId]').equals([sessionId, exerciseId]).toArray())
    .filter((s) => !newIds.has(s.id))
    .sort(byIndex);
  const soFar: RecordSet[] = earlier.map(toRecordSet);

  const records: PersonalRecord[] = [];
  newSets.forEach((s, i) => {
    const prior: RecordSession[] =
      soFar.length > 0 ? [...priorSessions, { sessionId, startedAt: session.startedAt, sets: [...soFar] }] : priorSessions;
    for (const r of newRecords(exercise.kind, [s], prior, { bodyweightKg, hasPriorHistory, calibrating: opts?.calibrating }))
      records.push({ ...r, setIndex: i });
    soFar.push(toRecordSet(s));
  });
  return records;
}

/** Best figures for an exercise over every completed session (Hevy imports included). */
export async function bestsForExercise(exerciseId: string): Promise<Bests> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) return { weight: null, e1rm: null, setVolume: null, repsAtWeight: new Map() };
  const sessions = await priorRecordSessions(exerciseId, '');
  const bodyweightKg = exercise.kind === 'bodyweight_plus' ? await latestBodyweightKg() : undefined;
  return bestsFor(exercise.kind, sessions, { bodyweightKg });
}

/**
 * Records in chronological order across all exercises: replays every completed session's sets
 * through `newRecords` and keeps the last `limit`, newest first, with exercise name and date.
 */
export async function recentRecords(
  limit = 10,
): Promise<{ record: PersonalRecord; exercise: Exercise; sessionId: string; date: string }[]> {
  const [exercises, allSets, sessions, decisions] = await Promise.all([
    db.exercises.toArray(),
    db.setLogs.toArray(),
    db.sessions.toArray(),
    db.decisions.toArray(),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const completedIds = new Set(sessions.filter((s) => s.endedAt).map((s) => s.id));
  // A set logged while its routine-exercise was calibrating is never a record, here as in the live
  // session and on Summary. The finished session's decision row is the lasting record of that:
  // one per (session, routine-exercise). Extras have no routine-exercise and never calibrate.
  const calibratingSlots = new Set(
    decisions.filter((d) => d.rule === 'calibrating').map((d) => `${d.sessionId}:${d.routineExerciseId}`),
  );
  const loggedWhileCalibrating = (s: SetLog) => s.routineExerciseId !== null && calibratingSlots.has(`${s.sessionId}:${s.routineExerciseId}`);

  const out: { record: PersonalRecord; exercise: Exercise; sessionId: string; date: string }[] = [];

  for (const exercise of exercises) {
    const bySession = new Map<string, SetLog[]>();
    for (const s of allSets) {
      if (s.exerciseId !== exercise.id || !completedIds.has(s.sessionId)) continue;
      const arr = bySession.get(s.sessionId) ?? [];
      arr.push(s);
      bySession.set(s.sessionId, arr);
    }
    if (bySession.size === 0) continue;
    const ordered = [...bySession.keys()].map((id) => sessionById.get(id)!).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const priorSoFar: RecordSession[] = [];
    for (const session of ordered) {
      const sets = (bySession.get(session.id) ?? []).sort(byIndex);
      const bodyweightKg = exercise.kind === 'bodyweight_plus' ? await bodyweightKgFor(session) : undefined;
      // priorSoFar only ever holds sessions strictly earlier in this same chronological replay —
      // it starts empty, so the first completed session for an exercise never produces a record.
      const hasPriorHistory = priorSoFar.length > 0;
      // Candidates exclude calibrating sets; the prior pool below still includes them, since they
      // were real lifts a later record has to beat.
      const candidates = sets.filter((s) => !loggedWhileCalibrating(s));
      const recs = newRecords(exercise.kind, candidates.map(toRecordSet), priorSoFar, { bodyweightKg, hasPriorHistory });
      for (const r of recs) out.push({ record: r, exercise, sessionId: session.id, date: session.startedAt });
      priorSoFar.push({ sessionId: session.id, startedAt: session.startedAt, source: session.source, sets: sets.map(toRecordSet) });
    }
  }

  out.sort((a, b) => b.date.localeCompare(a.date));
  return out.slice(0, limit);
}

/** Best e1RM per completed session, oldest first. */
export async function e1rmSeries(exerciseId: string): Promise<ChartPoint[]> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) return [];
  const sets = await db.setLogs.where('exerciseId').equals(exerciseId).toArray();
  const bySession = new Map<string, SetLog[]>();
  for (const s of sets) {
    const arr = bySession.get(s.sessionId) ?? [];
    arr.push(s);
    bySession.set(s.sessionId, arr);
  }
  const sessions = (await db.sessions.bulkGet([...bySession.keys()])).filter((s): s is Session => !!s && !!s.endedAt);
  const points: ChartPoint[] = [];
  for (const session of sessions) {
    const t = Date.parse(session.startedAt);
    if (Number.isNaN(t)) continue;
    const bodyweightKg = exercise.kind === 'bodyweight_plus' ? await bodyweightKgFor(session) : undefined;
    const best = bestE1rm(exercise.kind, bySession.get(session.id) ?? [], { bodyweightKg });
    if (best !== null) points.push({ t, y: best });
  }
  return points.sort((a, b) => a.t - b.t);
}

/** Session volume (kg × reps) per completed session, oldest first. */
export async function volumeSeries(exerciseId: string): Promise<ChartPoint[]> {
  const sets = await db.setLogs.where('exerciseId').equals(exerciseId).toArray();
  const bySession = new Map<string, SetLog[]>();
  for (const s of sets) {
    const arr = bySession.get(s.sessionId) ?? [];
    arr.push(s);
    bySession.set(s.sessionId, arr);
  }
  const sessions = (await db.sessions.bulkGet([...bySession.keys()])).filter((s): s is Session => !!s && !!s.endedAt);
  return sessions
    .map((session) => ({ t: Date.parse(session.startedAt), y: sessionVolume(bySession.get(session.id) ?? []) }))
    .filter((p) => !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);
}
