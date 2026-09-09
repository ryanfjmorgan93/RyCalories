/**
 * Data access layer. All writes go through here; screens read with dexie-react-hooks'
 * useLiveQuery directly against `db` and call these functions to mutate.
 */
import { db } from './db';
import { SEED_BODYWEIGHT_KG, SEED_EXERCISES, SEED_ROUTINES, SEED_ROUTINE_EXERCISES } from './seed';
import { nowIso, toDateKey } from '@/domain/dates';
import {
  decide,
  detectStall,
  resolveWeight,
  roundKg,
  suggestDoubleIncrement,
  suggestRegression,
  suggestedLockInWeight,
  type Decision,
  type EngineRoutineExercise,
  type SessionOutcome,
  type Suggestion,
} from '@/domain/engine';
import { uuid } from '@/domain/ids';
import {
  DEFAULT_SETTINGS,
  type Bodyweight,
  type Exercise,
  type Niggle,
  type ProgressionDecision,
  type Routine,
  type RoutineExercise,
  type Session,
  type SetLog,
  type SetType,
  type Settings,
} from '@/domain/types';

// ---------------------------------------------------------------------------
// Seeding

export async function isSeeded(): Promise<boolean> {
  return (await db.settings.get('settings')) !== undefined;
}

async function seedAll(): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', [db.exercises, db.routines, db.routineExercises, db.bodyweight, db.settings], async () => {
    await db.exercises.bulkPut(SEED_EXERCISES.map((e) => ({ ...e, createdAt: now })));
    await db.routines.bulkPut(SEED_ROUTINES);
    await db.routineExercises.bulkPut(SEED_ROUTINE_EXERCISES);
    await db.bodyweight.put({ id: uuid(), date: toDateKey(), kg: SEED_BODYWEIGHT_KG });
    await db.settings.put({ id: 'settings', ...DEFAULT_SETTINGS, createdAt: now });
  });
}

/** Seed the library, routines, bodyweight and settings on first run. */
export async function ensureSeeded(): Promise<void> {
  if (await isSeeded()) return;
  await seedAll();
}

/** Wipe everything and reseed (Settings → dev). */
export async function resetToSeed(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  await seedAll();
}

/** Wipe everything, leaving an empty (but seeded-settings) database. */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  await db.settings.put({ id: 'settings', ...DEFAULT_SETTINGS, createdAt: nowIso() });
}

// ---------------------------------------------------------------------------
// Settings

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  if (s) return s;
  await ensureSeeded();
  return (await db.settings.get('settings'))!;
}

/** Save settings. The reverse-diet start date is stamped on the first save if not set. */
export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { ...cur, ...patch, id: 'settings', savedAt: nowIso() };
  if (!next.calorieStartDate) next.calorieStartDate = toDateKey();
  await db.settings.put(next);
  return next;
}

// ---------------------------------------------------------------------------
// Exercises

export type ExerciseInput = Omit<Exercise, 'id' | 'createdAt'>;

export async function createExercise(input: ExerciseInput): Promise<Exercise> {
  const e: Exercise = { ...input, id: uuid(), name: input.name.trim(), createdAt: nowIso() };
  await db.exercises.put(e);
  return e;
}

export async function updateExercise(id: string, patch: Partial<ExerciseInput>): Promise<void> {
  await db.exercises.update(id, patch);
}

export async function exerciseUsage(id: string): Promise<{ routines: number; sets: number }> {
  const [routines, sets] = await Promise.all([
    db.routineExercises.where('exerciseId').equals(id).count(),
    db.setLogs.where('exerciseId').equals(id).count(),
  ]);
  return { routines, sets };
}

/** Deletes only when unused; returns false if the exercise is referenced by a routine or a set. */
export async function deleteExercise(id: string): Promise<boolean> {
  const u = await exerciseUsage(id);
  if (u.routines > 0 || u.sets > 0) return false;
  await db.exercises.delete(id);
  return true;
}

/** Case/whitespace-insensitive lookup by name or alias. */
export async function findExerciseByName(name: string): Promise<Exercise | undefined> {
  const key = normaliseName(name);
  const all = await db.exercises.toArray();
  return all.find((e) => normaliseName(e.name) === key || (e.aliases ?? []).some((a) => normaliseName(a) === key));
}

export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9()+]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Routines

export async function listRoutines(): Promise<Routine[]> {
  return (await db.routines.toArray()).filter((r) => !r.archived).sort((a, b) => a.order - b.order);
}

export async function createRoutine(input: { name: string; isLowerBody: boolean; targetMinutes?: number }): Promise<Routine> {
  const all = await db.routines.toArray();
  const order = all.length ? Math.max(...all.map((r) => r.order)) + 1 : 0;
  const r: Routine = {
    id: uuid(),
    name: input.name.trim() || 'Untitled routine',
    order,
    isLowerBody: input.isLowerBody,
    targetMinutes: input.targetMinutes,
  };
  await db.routines.put(r);
  return r;
}

export async function updateRoutine(id: string, patch: Partial<Omit<Routine, 'id'>>): Promise<void> {
  await db.routines.update(id, patch);
}

/** Hard-delete when no session references the routine, otherwise archive so history keeps its name. */
export async function deleteRoutine(id: string): Promise<'deleted' | 'archived'> {
  const used = await db.sessions.where('routineId').equals(id).count();
  await db.transaction('rw', [db.routines, db.routineExercises], async () => {
    if (used > 0) {
      await db.routines.update(id, { archived: true });
    } else {
      await db.routineExercises.where('routineId').equals(id).delete();
      await db.routines.delete(id);
    }
  });
  return used > 0 ? 'archived' : 'deleted';
}

export async function duplicateRoutine(id: string): Promise<Routine> {
  const src = await db.routines.get(id);
  if (!src) throw new Error('Routine not found');
  const rxs = await db.routineExercises.where('routineId').equals(id).sortBy('order');
  const copy = await createRoutine({ name: `${src.name} (copy)`, isLowerBody: src.isLowerBody, targetMinutes: src.targetMinutes });
  await db.routineExercises.bulkPut(rxs.map((rx) => ({ ...rx, id: uuid(), routineId: copy.id })));
  return copy;
}

export async function reorderRoutines(ids: string[]): Promise<void> {
  await db.transaction('rw', db.routines, async () => {
    for (let i = 0; i < ids.length; i++) await db.routines.update(ids[i], { order: i });
  });
}

export interface RoutineItem {
  rx: RoutineExercise;
  exercise: Exercise;
}

export async function routineItems(routineId: string): Promise<RoutineItem[]> {
  const rxs = await db.routineExercises.where('routineId').equals(routineId).sortBy('order');
  const exercises = await db.exercises.bulkGet(rxs.map((r) => r.exerciseId));
  const items: RoutineItem[] = [];
  rxs.forEach((rx, i) => {
    const ex = exercises[i];
    if (ex) items.push({ rx, exercise: ex });
  });
  return items;
}

// ---------------------------------------------------------------------------
// Routine exercises

export function defaultRoutineExercise(routineId: string, exercise: Exercise, order: number): RoutineExercise {
  const base: RoutineExercise = {
    id: uuid(),
    routineId,
    exerciseId: exercise.id,
    order,
    targetSets: 3,
    repMin: exercise.isCompound ? 6 : 10,
    repMax: exercise.isCompound ? 8 : 12,
    currentWeight: 0,
    increment: exercise.defaultIncrement,
    mode: 'calibrating',
    optional: false,
  };
  if (exercise.kind === 'carry') return { ...base, repMin: 1, repMax: 1, distanceMinM: 30, distanceMaxM: 40 };
  if (exercise.kind === 'timed') return { ...base, repMin: 30, repMax: 60 };
  return base;
}

export async function addRoutineExercise(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) throw new Error('Exercise not found');
  const existing = await db.routineExercises.where('routineId').equals(routineId).toArray();
  const order = existing.length ? Math.max(...existing.map((r) => r.order)) + 1 : 0;
  const rx = defaultRoutineExercise(routineId, exercise, order);
  await db.routineExercises.put(rx);
  return rx;
}

type LinkedFields = Partial<Pick<RoutineExercise, 'currentWeight' | 'mode' | 'increment'>>;

/** §4.8 — copy progression fields to every other linked routine-exercise of the same exercise. */
async function propagateLinked(rx: Pick<RoutineExercise, 'id' | 'exerciseId' | 'linkProgression'>, fields: LinkedFields): Promise<void> {
  if (!rx.linkProgression || Object.keys(fields).length === 0) return;
  const siblings = await db.routineExercises.where('exerciseId').equals(rx.exerciseId).toArray();
  for (const s of siblings) {
    if (s.id === rx.id || !s.linkProgression) continue;
    await db.routineExercises.update(s.id, fields);
  }
}

/** Other linked routine-exercises for the same exercise (excluding `rx` itself). */
export async function linkedSiblings(rx: Pick<RoutineExercise, 'id' | 'exerciseId'>): Promise<RoutineExercise[]> {
  const siblings = await db.routineExercises.where('exerciseId').equals(rx.exerciseId).toArray();
  return siblings.filter((s) => s.id !== rx.id && s.linkProgression);
}

/**
 * Update a routine-exercise. When it is linked (§4.8), weight / mode / increment changes are
 * mirrored to its linked siblings; switching the link on adopts the group's current numbers.
 */
export async function updateRoutineExercise(id: string, patch: Partial<Omit<RoutineExercise, 'id' | 'routineId'>>): Promise<void> {
  await db.transaction('rw', db.routineExercises, async () => {
    const before = await db.routineExercises.get(id);
    if (!before) return;
    let next: Partial<Omit<RoutineExercise, 'id' | 'routineId'>> = { ...patch };
    const turningOn = patch.linkProgression === true && !before.linkProgression;
    if (turningOn) {
      const [leader] = await linkedSiblings(before);
      if (leader) next = { ...next, currentWeight: leader.currentWeight, mode: leader.mode, increment: leader.increment };
    }
    await db.routineExercises.update(id, next);
    const after = { ...before, ...next };
    if (after.linkProgression && !turningOn) {
      const fields: LinkedFields = {};
      if (patch.currentWeight !== undefined) fields.currentWeight = roundKg(patch.currentWeight);
      if (patch.mode !== undefined) fields.mode = patch.mode;
      if (patch.increment !== undefined) fields.increment = patch.increment;
      await propagateLinked(after, fields);
    }
  });
}

export async function removeRoutineExercise(id: string): Promise<void> {
  await db.routineExercises.delete(id);
}

export async function reorderRoutineExercises(ids: string[]): Promise<void> {
  await db.transaction('rw', db.routineExercises, async () => {
    for (let i = 0; i < ids.length; i++) await db.routineExercises.update(ids[i], { order: i });
  });
}

/** Lock a calibrating routine-exercise in at `weight`; double progression starts next session. */
export async function lockInRoutineExercise(id: string, weight: number, sessionId = ''): Promise<void> {
  await db.transaction('rw', [db.routineExercises, db.decisions], async () => {
    const rx = await db.routineExercises.get(id);
    if (!rx) return;
    const w = roundKg(weight);
    await db.routineExercises.update(id, { mode: 'normal', currentWeight: w });
    await propagateLinked(rx, { mode: 'normal', currentWeight: w });
    await db.decisions.put({
      id: uuid(),
      sessionId,
      routineExerciseId: id,
      fromWeight: rx.currentWeight,
      toWeight: w,
      rule: 'lock_in',
      accepted: true,
      decidedAt: nowIso(),
    });
  });
}

/** Put a routine-exercise back into calibration. */
export async function unlockRoutineExercise(id: string): Promise<void> {
  await db.routineExercises.update(id, { mode: 'calibrating' });
}

// ---------------------------------------------------------------------------
// Sessions

export async function getActiveSession(): Promise<Session | undefined> {
  return db.sessions.filter((s) => !s.endedAt).first();
}

/** Start a session for a routine. If one is already live, it is returned instead. */
export async function startSession(routineId: string): Promise<Session> {
  return db.transaction('rw', [db.sessions, db.routines], async () => {
    const active = await getActiveSession();
    if (active) return active;
    const routine = await db.routines.get(routineId);
    const s: Session = { id: uuid(), routineId, title: routine?.name ?? 'Session', startedAt: nowIso() };
    await db.sessions.put(s);
    return s;
  });
}

/** Delete a session together with its sets and decisions. Stored weights are left as they are. */
export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.setLogs, db.decisions], async () => {
    await db.setLogs.where('sessionId').equals(id).delete();
    await db.decisions.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

export const discardSession = deleteSession;

export async function updateSession(id: string, patch: Partial<Omit<Session, 'id'>>): Promise<void> {
  await db.sessions.update(id, patch);
}

export async function setSkipped(sessionId: string, routineExerciseId: string, skipped: boolean): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (!s) return;
  const cur = new Set(s.skippedRoutineExerciseIds ?? []);
  if (skipped) cur.add(routineExerciseId);
  else cur.delete(routineExerciseId);
  await db.sessions.update(sessionId, { skippedRoutineExerciseIds: [...cur] });
}

export async function addExtraExercise(sessionId: string, exerciseId: string): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (!s) return;
  const cur = s.extraExerciseIds ?? [];
  if (cur.includes(exerciseId)) return;
  await db.sessions.update(sessionId, { extraExerciseIds: [...cur, exerciseId] });
}

export async function removeExtraExercise(sessionId: string, exerciseId: string): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (!s) return;
  await db.transaction('rw', [db.sessions, db.setLogs], async () => {
    await db.sessions.update(sessionId, { extraExerciseIds: (s.extraExerciseIds ?? []).filter((id) => id !== exerciseId) });
    const sets = await db.setLogs.where('[sessionId+exerciseId]').equals([sessionId, exerciseId]).toArray();
    await db.setLogs.bulkDelete(sets.filter((x) => x.routineExerciseId === null).map((x) => x.id));
  });
}

function byIndex(a: SetLog, b: SetLog): number {
  return a.index - b.index || a.completedAt.localeCompare(b.completedAt);
}

/** Sets logged in a session for one slot (a routine-exercise, or an extra exercise with no routine-exercise). */
export async function setsForSlot(sessionId: string, routineExerciseId: string | null, exerciseId: string): Promise<SetLog[]> {
  const sets = routineExerciseId
    ? await db.setLogs.where('[sessionId+routineExerciseId]').equals([sessionId, routineExerciseId]).toArray()
    : (await db.setLogs.where('[sessionId+exerciseId]').equals([sessionId, exerciseId]).toArray()).filter(
        (s) => s.routineExerciseId === null,
      );
  return sets.sort(byIndex);
}

export interface LogSetInput {
  sessionId: string;
  routineExerciseId: string | null;
  exerciseId: string;
  type: SetType;
  weight: number;
  reps?: number;
  distanceM?: number;
  seconds?: number;
  rir?: number;
}

export async function logSet(input: LogSetInput): Promise<SetLog> {
  return db.transaction('rw', db.setLogs, async () => {
    const existing = await setsForSlot(input.sessionId, input.routineExerciseId, input.exerciseId);
    const set: SetLog = {
      id: uuid(),
      sessionId: input.sessionId,
      routineExerciseId: input.routineExerciseId,
      exerciseId: input.exerciseId,
      index: existing.length,
      type: input.type,
      weight: roundKg(Number.isFinite(input.weight) ? input.weight : 0),
      reps: input.reps,
      distanceM: input.distanceM,
      seconds: input.seconds,
      rir: input.rir,
      completedAt: nowIso(),
    };
    await db.setLogs.put(set);
    return set;
  });
}

export async function updateSet(
  id: string,
  patch: Partial<Pick<SetLog, 'weight' | 'reps' | 'rir' | 'type' | 'distanceM' | 'seconds'>>,
): Promise<void> {
  const clean: Partial<SetLog> = { ...patch };
  if (clean.weight !== undefined) clean.weight = roundKg(clean.weight);
  await db.setLogs.update(id, clean);
}

/** Delete a set and close the gap in `index` for its slot. */
export async function deleteSet(id: string): Promise<void> {
  const set = await db.setLogs.get(id);
  if (!set) return;
  await db.transaction('rw', db.setLogs, async () => {
    await db.setLogs.delete(id);
    const rest = await setsForSlot(set.sessionId, set.routineExerciseId, set.exerciseId);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].index !== i) await db.setLogs.update(rest[i].id, { index: i });
    }
  });
}

export interface PreviousSets {
  sessionId: string;
  startedAt: string;
  sets: SetLog[];
}

/**
 * The most recent earlier session's sets for a slot. Prefers sets logged against the same
 * routine-exercise; falls back to any session containing the exercise (other routines, imports).
 */
export async function previousSets(
  routineExerciseId: string | null,
  exerciseId: string,
  excludeSessionId: string,
): Promise<PreviousSets | null> {
  const pick = async (sets: SetLog[]): Promise<PreviousSets | null> => {
    const candidates = sets.filter((s) => s.sessionId !== excludeSessionId);
    if (candidates.length === 0) return null;
    const sessionIds = [...new Set(candidates.map((s) => s.sessionId))];
    const sessions = (await db.sessions.bulkGet(sessionIds)).filter((s): s is Session => !!s && !!s.endedAt);
    if (sessions.length === 0) return null;
    sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const latest = sessions[0];
    return {
      sessionId: latest.id,
      startedAt: latest.startedAt,
      sets: candidates.filter((s) => s.sessionId === latest.id).sort(byIndex),
    };
  };
  if (routineExerciseId) {
    const byRx = await pick(await db.setLogs.where('routineExerciseId').equals(routineExerciseId).toArray());
    if (byRx) return byRx;
  }
  return pick(await db.setLogs.where('exerciseId').equals(exerciseId).toArray());
}

export function toEngine(rx: RoutineExercise, exercise: Exercise): EngineRoutineExercise {
  return {
    id: rx.id,
    kind: exercise.kind,
    mode: rx.mode,
    targetSets: rx.targetSets,
    repMin: rx.repMin,
    repMax: rx.repMax,
    currentWeight: rx.currentWeight,
    increment: rx.increment,
  };
}

/** Past outcomes for a routine-exercise, most recent first. */
export async function outcomesForRoutineExercise(routineExerciseId: string): Promise<SessionOutcome[]> {
  const decisions = await db.decisions.where('routineExerciseId').equals(routineExerciseId).toArray();
  decisions.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  return decisions.map(toOutcome);
}

export function toOutcome(d: ProgressionDecision): SessionOutcome {
  const applied = d.overrideTo !== undefined ? d.overrideTo : d.rule === 'calibrating' ? d.fromWeight : d.toWeight;
  return { fromWeight: d.fromWeight, appliedWeight: applied, rule: d.rule };
}

export async function stallStatus(routineExerciseId: string): Promise<Suggestion | null> {
  return detectStall(await outcomesForRoutineExercise(routineExerciseId));
}

// ---------------------------------------------------------------------------
// Summary + finish

export type SummaryStatus = 'done' | 'skipped' | 'not_done' | 'extra';

export interface SummaryItem {
  /** Null for exercises added to this session only. */
  rx: RoutineExercise | null;
  exercise: Exercise;
  sets: SetLog[];
  status: SummaryStatus;
  decision: Decision | null;
  suggestions: Suggestion[];
  /** Present for calibrating exercises with working sets: the default lock-in weight. */
  lockIn: { suggested: number } | null;
}

export interface SessionSummary {
  session: Session;
  routine: Routine | undefined;
  items: SummaryItem[];
  setsDone: number;
  workingSetsDone: number;
  durationSec: number;
}

export async function buildSummary(sessionId: string, now = nowIso()): Promise<SessionSummary> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  const routine = session.routineId ? await db.routines.get(session.routineId) : undefined;
  const items: SummaryItem[] = [];
  const skipped = new Set(session.skippedRoutineExerciseIds ?? []);
  const allSets = (await db.setLogs.where('sessionId').equals(sessionId).toArray()).sort(byIndex);

  if (routine) {
    for (const { rx, exercise } of await routineItems(routine.id)) {
      const sets = allSets.filter((s) => s.routineExerciseId === rx.id);
      if (sets.length === 0) {
        items.push({ rx, exercise, sets, status: skipped.has(rx.id) ? 'skipped' : 'not_done', decision: null, suggestions: [], lockIn: null });
        continue;
      }
      const engineRx = toEngine(rx, exercise);
      const decision = decide(engineRx, sets);
      const suggestions: Suggestion[] = [];
      const dbl = suggestDoubleIncrement(engineRx, decision, sets);
      if (dbl) suggestions.push(dbl);
      const prev = await previousSets(rx.id, exercise.id, sessionId);
      const reg = suggestRegression(engineRx, sets, prev?.sets ?? null);
      if (reg) suggestions.push(reg);
      if (decision.rule !== 'calibrating' && decision.rule !== 'not_applicable') {
        const history = await outcomesForRoutineExercise(rx.id);
        const stall = detectStall([{ fromWeight: decision.fromWeight, appliedWeight: decision.toWeight, rule: decision.rule }, ...history]);
        if (stall) suggestions.push(stall);
      }
      const lockIn =
        decision.rule === 'calibrating' && suggestedLockInWeight(sets) !== null
          ? { suggested: suggestedLockInWeight(sets) as number }
          : null;
      items.push({ rx, exercise, sets, status: 'done', decision, suggestions, lockIn });
    }
  }

  const extraIds = [...new Set([...(session.extraExerciseIds ?? []), ...allSets.filter((s) => s.routineExerciseId === null).map((s) => s.exerciseId)])];
  for (const exerciseId of extraIds) {
    const exercise = await db.exercises.get(exerciseId);
    if (!exercise) continue;
    const sets = allSets.filter((s) => s.routineExerciseId === null && s.exerciseId === exerciseId);
    items.push({ rx: null, exercise, sets, status: 'extra', decision: null, suggestions: [], lockIn: null });
  }

  const durationSec = session.durationSec ?? Math.max(0, Math.round((Date.parse(now) - Date.parse(session.startedAt)) / 1000));
  return {
    session,
    routine,
    items,
    setsDone: allSets.length,
    workingSetsDone: allSets.filter((s) => s.type === 'working').length,
    durationSec,
  };
}

export interface FinishChoice {
  routineExerciseId: string;
  /** User-typed weight that replaces the proposal. */
  overrideTo?: number;
  /** For calibrating exercises: lock in at this weight. */
  lockInAt?: number;
}

export interface FinishInput {
  choices: FinishChoice[];
  niggles?: Niggle[];
  notes?: string;
  checklist?: Session['checklist'];
}

/** Apply decisions (accept/override/lock-in), stamp the session as finished. */
export async function finishSession(sessionId: string, input: FinishInput): Promise<SessionSummary> {
  const now = nowIso();
  const summary = await buildSummary(sessionId, now);
  const byRx = new Map(input.choices.map((c) => [c.routineExerciseId, c]));

  if (summary.session.endedAt) return summary;
  await db.transaction('rw', [db.sessions, db.routineExercises, db.decisions], async () => {
    const current = await db.sessions.get(sessionId);
    if (!current || current.endedAt) return; // already finished (double tap / retry)
    await db.decisions.where('sessionId').equals(sessionId).delete();
    for (const item of summary.items) {
      if (!item.rx || !item.decision) continue;
      const rx = item.rx;
      const d = item.decision;
      const choice = byRx.get(rx.id);
      if (d.rule === 'not_applicable') continue;
      if (d.rule === 'calibrating') {
        if (choice?.lockInAt !== undefined && Number.isFinite(choice.lockInAt)) {
          const w = roundKg(choice.lockInAt);
          await db.routineExercises.update(rx.id, { mode: 'normal', currentWeight: w });
          await propagateLinked(rx, { mode: 'normal', currentWeight: w });
          await db.decisions.put({
            id: uuid(),
            sessionId,
            routineExerciseId: rx.id,
            fromWeight: rx.currentWeight,
            toWeight: w,
            rule: 'lock_in',
            accepted: true,
            decidedAt: now,
          });
        } else {
          await db.decisions.put({
            id: uuid(),
            sessionId,
            routineExerciseId: rx.id,
            fromWeight: rx.currentWeight,
            toWeight: rx.currentWeight,
            rule: 'calibrating',
            accepted: true,
            decidedAt: now,
          });
        }
        continue;
      }
      const override = choice?.overrideTo !== undefined && Number.isFinite(choice.overrideTo) ? roundKg(choice.overrideTo) : undefined;
      const to = resolveWeight(d, override);
      const accepted = override === undefined || override === d.toWeight;
      await db.routineExercises.update(rx.id, { currentWeight: to });
      await propagateLinked(rx, { currentWeight: to });
      await db.decisions.put({
        id: uuid(),
        sessionId,
        routineExerciseId: rx.id,
        fromWeight: d.fromWeight,
        toWeight: d.toWeight,
        rule: d.rule,
        accepted,
        overrideTo: accepted ? undefined : override,
        decidedAt: now,
      });
    }
    const durationSec = Math.max(0, Math.round((Date.parse(now) - Date.parse(summary.session.startedAt)) / 1000));
    await db.sessions.update(sessionId, {
      endedAt: now,
      durationSec,
      niggles: input.niggles && input.niggles.length ? input.niggles : undefined,
      notes: input.notes?.trim() || undefined,
      checklist: input.checklist,
    });
  });

  return buildSummary(sessionId, now);
}

// ---------------------------------------------------------------------------
// History queries

export async function lastCompletedSession(): Promise<Session | undefined> {
  const done = await db.sessions.filter((s) => !!s.endedAt).toArray();
  done.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return done[0];
}

export async function recentSessions(limit = 3): Promise<Session[]> {
  const done = await db.sessions.filter((s) => !!s.endedAt).toArray();
  done.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return done.slice(0, limit);
}

export interface HistoryEntry {
  session: Session;
  sets: SetLog[];
  /** Heaviest working-set weight (0 when none). */
  topWeight: number;
  /** Reps on the heaviest working set. */
  topReps: number | undefined;
  /** Sum of weight × reps over working sets. */
  volume: number;
}

/** Completed-session history for an exercise, most recent first. */
export async function exerciseHistory(exerciseId: string): Promise<HistoryEntry[]> {
  const sets = await db.setLogs.where('exerciseId').equals(exerciseId).toArray();
  const bySession = new Map<string, SetLog[]>();
  for (const s of sets) {
    const arr = bySession.get(s.sessionId) ?? [];
    arr.push(s);
    bySession.set(s.sessionId, arr);
  }
  const sessions = (await db.sessions.bulkGet([...bySession.keys()])).filter((s): s is Session => !!s && !!s.endedAt);
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return sessions.map((session) => {
    const ss = (bySession.get(session.id) ?? []).sort(byIndex);
    const working = ss.filter((x) => x.type === 'working');
    const top = working.reduce<SetLog | null>((best, x) => (best === null || x.weight > best.weight ? x : best), null);
    return {
      session,
      sets: ss,
      topWeight: top?.weight ?? 0,
      topReps: top?.reps,
      volume: working.reduce((sum, x) => sum + x.weight * (x.reps ?? 0), 0),
    };
  });
}

export interface SessionGroup {
  rx: RoutineExercise | null;
  exercise: Exercise;
  sets: SetLog[];
  decision: ProgressionDecision | null;
}

export interface SessionDetail {
  session: Session;
  routine: Routine | undefined;
  groups: SessionGroup[];
}

/** Everything about one session, grouped by exercise in logged order. */
export async function sessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const session = await db.sessions.get(sessionId);
  if (!session) return null;
  const routine = session.routineId ? await db.routines.get(session.routineId) : undefined;
  const sets = (await db.setLogs.where('sessionId').equals(sessionId).toArray()).sort(byIndex);
  const decisions = await db.decisions.where('sessionId').equals(sessionId).toArray();
  const order: string[] = [];
  const groupsByKey = new Map<string, SessionGroup>();
  const rxCache = new Map<string, RoutineExercise | undefined>();
  const firstSeen = new Map<string, string>();
  for (const s of sets) {
    const key = s.routineExerciseId ?? `x:${s.exerciseId}`;
    if (!firstSeen.has(key)) firstSeen.set(key, s.completedAt);
  }
  const keys = [...firstSeen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k]) => k);
  for (const key of keys) {
    const ss = sets.filter((s) => (s.routineExerciseId ?? `x:${s.exerciseId}`) === key);
    const exercise = await db.exercises.get(ss[0].exerciseId);
    if (!exercise) continue;
    let rx: RoutineExercise | null = null;
    if (ss[0].routineExerciseId) {
      if (!rxCache.has(ss[0].routineExerciseId)) rxCache.set(ss[0].routineExerciseId, await db.routineExercises.get(ss[0].routineExerciseId));
      rx = rxCache.get(ss[0].routineExerciseId) ?? null;
    }
    const decision = decisions.find((d) => d.routineExerciseId === ss[0].routineExerciseId) ?? null;
    groupsByKey.set(key, { rx, exercise, sets: ss, decision });
    order.push(key);
  }
  return { session, routine, groups: order.map((k) => groupsByKey.get(k)!) };
}

export async function decisionsForRoutineExercise(routineExerciseId: string): Promise<ProgressionDecision[]> {
  const ds = await db.decisions.where('routineExerciseId').equals(routineExerciseId).toArray();
  return ds.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

// ---------------------------------------------------------------------------
// Bodyweight

/** Upsert by date: logging the same day again replaces that day's reading. */
export async function logBodyweight(date: string, kg: number, note?: string): Promise<Bodyweight> {
  const existing = await db.bodyweight.where('date').equals(date).first();
  const entry: Bodyweight = { id: existing?.id ?? uuid(), date, kg: roundKg(kg), note: note?.trim() || undefined };
  await db.bodyweight.put(entry);
  return entry;
}

export async function deleteBodyweight(id: string): Promise<void> {
  await db.bodyweight.delete(id);
}
