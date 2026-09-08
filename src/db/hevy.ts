/**
 * Hevy CSV import, built against the real `hevy_export.csv` (workouts) and
 * `hevy_measurements.csv` (bodyweight) files in the repo root.
 *
 * Workout columns: title, start_time, end_time, description, exercise_title, superset_id,
 *   exercise_notes, set_index, set_type, weight_kg, reps, distance_km, duration_seconds, rpe
 * Measurement columns: date, weight_kg, fat_percent, …
 *
 * Dates look like "8 Sep 2026, 20:03" (local time). Idempotency comes from deterministic ids:
 * a session's id is derived from (title, start_time, end_time) and a set's id from the session
 * key plus exercise title and its ordinal, so re-importing the same file overwrites in place.
 */
import Papa from 'papaparse';
import { db } from './db';
import { findExerciseByName, lockInRoutineExercise, logBodyweight, normaliseName, routineItems } from './repo';
import { stableUuid } from '@/domain/ids';
import { roundKg } from '@/domain/engine';
import { toDateKey } from '@/domain/dates';
import type { Exercise, ExerciseKind, MuscleGroup, Routine, RoutineExercise, Session, SetLog } from '@/domain/types';

export type HevyFileKind = 'workouts' | 'measurements' | 'unknown';

export interface HevySet {
  exerciseTitle: string;
  /** Ordinal of this set within the exercise for the session (file order). */
  ordinal: number;
  type: 'warmup' | 'working';
  hevySetType: string;
  weight: number | null;
  reps?: number;
  distanceM?: number;
  seconds?: number;
  rir?: number;
  notes?: string;
}

export interface HevySession {
  /** Raw (title|start|end) — the stable identity used for ids. */
  key: string;
  title: string;
  start: Date;
  end: Date | null;
  description?: string;
  sets: HevySet[];
}

export interface HevyExerciseStat {
  title: string;
  sets: number;
  sessions: number;
  maxWeight: number;
  medianWeight: number;
  isDumbbell: boolean;
  hasDistance: boolean;
  hasDuration: boolean;
  bodyweightOnly: boolean;
}

export interface HevyParsed {
  kind: HevyFileKind;
  columns: string[];
  sessions: HevySession[];
  exercises: HevyExerciseStat[];
  measurements: { date: string; kg: number }[];
  warnings: string[];
  skippedRows: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** "8 Sep 2026, 20:03" → local Date. Also accepts ISO-ish strings. */
export function parseHevyDate(s: string): Date | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,5})\.?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    return new Date(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  }
  const m2 = t.match(/^(\d{1,2})\s+([A-Za-z]{3,5})\.?\s+(\d{4})$/);
  if (m2) {
    const mon = MONTHS[m2[2].toLowerCase()];
    if (mon === undefined) return null;
    return new Date(Number(m2[3]), mon, Number(m2[1]));
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0));
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function detectHevyFile(columns: string[]): HevyFileKind {
  const cols = new Set(columns.map((c) => c.trim().toLowerCase()));
  if (cols.has('exercise_title') && (cols.has('start_time') || cols.has('title'))) return 'workouts';
  if (cols.has('date') && cols.has('weight_kg')) return 'measurements';
  return 'unknown';
}

export function parseHevyCsv(text: string): HevyParsed {
  // The real export mixes CRLF and bare LF line endings; normalise or Papa merges rows.
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const result = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() });
  const columns = (result.meta.fields ?? []).map((f) => f.trim().toLowerCase());
  const kind = detectHevyFile(columns);
  const warnings: string[] = [];
  const parsed: HevyParsed = { kind, columns, sessions: [], exercises: [], measurements: [], warnings, skippedRows: 0 };
  for (const err of result.errors.slice(0, 3)) warnings.push(`CSV: ${err.message}${err.row !== undefined ? ` (row ${err.row + 2})` : ''}`);

  if (kind === 'measurements') {
    for (const row of result.data) {
      const d = parseHevyDate(row.date);
      const kg = num(row.weight_kg);
      if (!d || kg === null || kg <= 0) {
        parsed.skippedRows++;
        continue;
      }
      parsed.measurements.push({ date: toDateKey(d), kg: roundKg(kg) });
    }
    return parsed;
  }
  if (kind !== 'workouts') {
    warnings.push('Not a Hevy export: expected columns like exercise_title/start_time or date/weight_kg.');
    return parsed;
  }

  const hasLbs = columns.includes('weight_lbs') && !columns.includes('weight_kg');
  if (hasLbs) warnings.push('Weights are in lb in this file; converted to kg.');
  const sessionsByKey = new Map<string, HevySession>();
  const ordinals = new Map<string, number>();
  for (const row of result.data) {
    const title = (row.title ?? '').trim() || 'Workout';
    const startRaw = (row.start_time ?? '').trim();
    const endRaw = (row.end_time ?? '').trim();
    const start = parseHevyDate(startRaw);
    if (!start) {
      parsed.skippedRows++;
      continue;
    }
    const key = `${title}|${startRaw}|${endRaw}`;
    let session = sessionsByKey.get(key);
    if (!session) {
      session = { key, title, start, end: parseHevyDate(endRaw), description: (row.description ?? '').trim() || undefined, sets: [] };
      sessionsByKey.set(key, session);
    }
    const exerciseTitle = (row.exercise_title ?? '').trim();
    if (!exerciseTitle) {
      parsed.skippedRows++;
      continue;
    }
    const ordKey = `${key}|${exerciseTitle}`;
    const ordinal = ordinals.get(ordKey) ?? 0;
    ordinals.set(ordKey, ordinal + 1);
    const hevySetType = (row.set_type ?? 'normal').trim().toLowerCase();
    const rawWeight = hasLbs ? num(row.weight_lbs) : num(row.weight_kg);
    const weight = rawWeight === null ? null : hasLbs ? roundKg(rawWeight * 0.45359237) : rawWeight;
    const reps = num(row.reps);
    const km = num(row.distance_km);
    const secs = num(row.duration_seconds);
    const rpe = num(row.rpe);
    const set: HevySet = {
      exerciseTitle,
      ordinal,
      type: hevySetType === 'warmup' ? 'warmup' : 'working',
      hevySetType,
      weight,
      reps: reps === null ? undefined : Math.max(0, Math.round(reps)),
      distanceM: km === null ? undefined : Math.round(km * 1000),
      seconds: secs === null ? undefined : Math.round(secs),
      rir: rpe === null ? undefined : Math.max(0, Math.min(5, Math.round(10 - rpe))),
      notes: (row.exercise_notes ?? '').trim() || undefined,
    };
    session.sets.push(set);
  }
  parsed.sessions = [...sessionsByKey.values()].sort((a, b) => a.start.getTime() - b.start.getTime());

  const stats = new Map<string, { weights: number[]; sessions: Set<string>; sets: number; dist: boolean; dur: boolean; anyWeight: boolean }>();
  for (const s of parsed.sessions) {
    for (const set of s.sets) {
      const st = stats.get(set.exerciseTitle) ?? { weights: [], sessions: new Set<string>(), sets: 0, dist: false, dur: false, anyWeight: false };
      st.sets++;
      st.sessions.add(s.key);
      if (set.weight !== null && set.weight > 0) {
        st.weights.push(set.weight);
        st.anyWeight = true;
      }
      if (set.distanceM !== undefined) st.dist = true;
      if (set.seconds !== undefined) st.dur = true;
      stats.set(set.exerciseTitle, st);
    }
  }
  parsed.exercises = [...stats.entries()]
    .map(([title, st]) => {
      const sorted = [...st.weights].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      return {
        title,
        sets: st.sets,
        sessions: st.sessions.size,
        maxWeight: sorted.length ? sorted[sorted.length - 1] : 0,
        medianWeight: median,
        isDumbbell: /dumbbell|\bdb\b/i.test(title),
        hasDistance: st.dist,
        hasDuration: st.dur,
        bodyweightOnly: !st.anyWeight,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return parsed;
}

// ---------------------------------------------------------------------------
// Planning

export interface HevyExercisePlan {
  title: string;
  /** Existing exercise to map to, or null to create a new one named `title`. */
  exerciseId: string | null;
  exerciseName: string | null;
  /** Divide logged weights by two (Hevy pair totals → per-hand). */
  halve: boolean;
  /** How the match was made. */
  matched: 'name' | 'alias' | 'none';
}

export interface HevyRoutinePlan {
  title: string;
  routineId: string | null;
  routineName: string | null;
  sessions: number;
}

export interface HevyImportPlan {
  exercises: HevyExercisePlan[];
  routines: HevyRoutinePlan[];
}

function guessRoutine(title: string, routines: Routine[]): Routine | null {
  const key = normaliseName(title);
  const exact = routines.find((r) => normaliseName(r.name) === key);
  if (exact) return exact;
  const numbered = key.match(/routine\s*(\d+)/);
  if (numbered) {
    const byOrder = routines.find((r) => r.order === Number(numbered[1]) - 1);
    if (byOrder) return byOrder;
  }
  const has = (s: string, w: string) => s.includes(w);
  const pick = (w: string) => routines.find((r) => has(normaliseName(r.name), w)) ?? null;
  if (has(key, 'push')) return pick('push');
  if (has(key, 'pull')) return pick('pull');
  if (has(key, 'squat')) return pick('squat');
  if (has(key, 'hinge') || has(key, 'lower')) return pick('hinge') ?? pick('lower');
  if (has(key, 'arm') || has(key, 'day 5')) return pick('arm') ?? pick('day 5');
  if (has(key, 'upper')) return pick('upper');
  return null;
}

export async function planHevyImport(parsed: HevyParsed): Promise<HevyImportPlan> {
  const routines = (await db.routines.toArray()).filter((r) => !r.archived);
  const exercises: HevyExercisePlan[] = [];
  for (const stat of parsed.exercises) {
    const ex = await findExerciseByName(stat.title);
    const matched: HevyExercisePlan['matched'] = ex ? (normaliseName(ex.name) === normaliseName(stat.title) ? 'name' : 'alias') : 'none';
    exercises.push({
      title: stat.title,
      exerciseId: ex?.id ?? null,
      exerciseName: ex?.name ?? null,
      // Heuristic from the real export: dumbbell presses were logged as the pair total (52, 36),
      // curls/raises per hand (9, 10). Anything dumbbell with a median ≥ 24 kg is probably a pair total.
      halve: stat.isDumbbell && stat.medianWeight >= 24,
      matched,
    });
  }
  const titles = new Map<string, number>();
  for (const s of parsed.sessions) titles.set(s.title, (titles.get(s.title) ?? 0) + 1);
  const routinePlans: HevyRoutinePlan[] = [...titles.entries()].map(([title, sessions]) => {
    const r = guessRoutine(title, routines);
    return { title, routineId: r?.id ?? null, routineName: r?.name ?? null, sessions };
  });
  return { exercises, routines: routinePlans };
}

// ---------------------------------------------------------------------------
// Guessing attributes for brand-new exercises

const LOWER = /squat|leg|calf|calves|hip|deadlift|lunge|glute|hamstring|adduct|abduct|thrust|rdl|step.?up|extension \(machine\)|back extension|hyperextension/i;
const COMPOUND = /press|squat|deadlift|row|pulldown|pull.?up|chin.?up|thrust|lunge|dip|shrug|clean|snatch/i;

function guessKind(stat: HevyExerciseStat): ExerciseKind {
  if (stat.hasDistance || /walk|carry/i.test(stat.title)) return 'carry';
  if (stat.hasDuration && stat.bodyweightOnly && /plank|hold|hang/i.test(stat.title)) return 'timed';
  if (/hyperextension|back extension|\bdip\b|pull.?up|chin.?up|push.?up/i.test(stat.title)) return 'bodyweight_plus';
  return 'reps';
}

function guessMuscle(title: string): MuscleGroup {
  const t = title.toLowerCase();
  const rules: [RegExp, MuscleGroup][] = [
    [/hamstring|leg curl|romanian|rdl|good morning/, 'hamstrings'],
    [/glute|hip thrust|kickback/, 'glutes'],
    [/squat|leg press|leg extension|lunge|hack/, 'quads'],
    [/adduct/, 'adductors'],
    [/calf|calves/, 'calves'],
    [/back extension|hyperextension|deadlift/, 'lower back'],
    [/bench|chest|fly|push.?up|pec/, 'chest'],
    [/shoulder|overhead|lateral raise|military|arnold/, 'shoulders'],
    [/tricep|pushdown|skull|dip/, 'triceps'],
    [/bicep|curl(?!.*leg)/, 'biceps'],
    [/forearm|wrist/, 'forearms'],
    [/pulldown|pull.?up|chin.?up|lat /, 'lats'],
    [/row|rear delt|reverse fly|face pull/, 'upper back'],
    [/shrug|trap/, 'traps'],
    [/crunch|ab |abs|plank|leg raise|sit.?up/, 'abs'],
    [/neck/, 'neck'],
    [/walk|carry/, 'full body'],
  ];
  for (const [re, g] of rules) if (re.test(t)) return g;
  return 'other';
}

function guessIncrement(title: string, isLower: boolean): number {
  const t = title.toLowerCase();
  if (/dumbbell|\bdb\b/.test(t)) return 2;
  if (/machine|cable|smith/.test(t)) return 5;
  if (/barbell/.test(t)) return isLower ? 5 : 2.5;
  return isLower ? 5 : 2.5;
}

export function guessExercise(stat: HevyExerciseStat): Omit<Exercise, 'id' | 'createdAt'> {
  const kind = guessKind(stat);
  const isLowerBody = LOWER.test(stat.title) && !/neck/i.test(stat.title);
  const isCompound = kind !== 'carry' && COMPOUND.test(stat.title) && !/leg extension|leg curl/i.test(stat.title);
  return {
    name: stat.title,
    kind,
    muscleGroup: guessMuscle(stat.title),
    isCompound,
    isLowerBody,
    defaultRestSec: kind === 'carry' ? 90 : isCompound ? 150 : 75,
    defaultIncrement: guessIncrement(stat.title, isLowerBody),
    unilateral: /single|one.?arm|one.?leg|bulgarian|split squat|unilateral/i.test(stat.title),
    aliases: [stat.title],
  };
}

// ---------------------------------------------------------------------------
// Running the import

export interface HevyImportResult {
  sessionsNew: number;
  sessionsUpdated: number;
  setsWritten: number;
  exercisesCreated: string[];
  bodyweightWritten: number;
  skippedRows: number;
}

export async function runHevyImport(parsed: HevyParsed, plan: HevyImportPlan): Promise<HevyImportResult> {
  const result: HevyImportResult = {
    sessionsNew: 0,
    sessionsUpdated: 0,
    setsWritten: 0,
    exercisesCreated: [],
    bodyweightWritten: 0,
    skippedRows: parsed.skippedRows,
  };

  if (parsed.kind === 'measurements') {
    for (const m of parsed.measurements) {
      await logBodyweight(m.date, m.kg);
      result.bodyweightWritten++;
    }
    return result;
  }
  if (parsed.kind !== 'workouts') return result;

  // 1. Resolve / create exercises.
  const exerciseByTitle = new Map<string, Exercise>();
  const halveByTitle = new Map<string, boolean>();
  const statByTitle = new Map(parsed.exercises.map((s) => [s.title, s]));
  for (const p of plan.exercises) {
    halveByTitle.set(p.title, p.halve);
    let ex: Exercise | undefined = p.exerciseId ? await db.exercises.get(p.exerciseId) : undefined;
    if (!ex) {
      const stat = statByTitle.get(p.title);
      if (!stat) continue;
      const guessed = guessExercise(stat);
      ex = { ...guessed, id: await stableUuid('hevy-exercise', p.title), createdAt: new Date().toISOString() };
      const existing = await db.exercises.get(ex.id);
      if (!existing) {
        await db.exercises.put(ex);
        result.exercisesCreated.push(ex.name);
      } else {
        ex = existing;
      }
    } else if (normaliseName(ex.name) !== normaliseName(p.title) && !(ex.aliases ?? []).some((a) => normaliseName(a) === normaliseName(p.title))) {
      // Remember the Hevy title so the next import auto-matches.
      await db.exercises.update(ex.id, { aliases: [...(ex.aliases ?? []), p.title] });
    }
    exerciseByTitle.set(p.title, ex);
  }

  // 2. Routine mapping and routine-exercise lookup.
  const routineByTitle = new Map<string, Routine | null>();
  const rxByRoutine = new Map<string, RoutineExercise[]>();
  for (const rp of plan.routines) {
    const r = rp.routineId ? await db.routines.get(rp.routineId) : undefined;
    routineByTitle.set(rp.title, r ?? null);
    if (r && !rxByRoutine.has(r.id)) rxByRoutine.set(r.id, (await routineItems(r.id)).map((i) => i.rx));
  }

  // 3. Build rows with deterministic ids.
  const sessions: Session[] = [];
  const sets: SetLog[] = [];
  for (const hs of parsed.sessions) {
    const id = await stableUuid('hevy-session', hs.key);
    const routine = routineByTitle.get(hs.title) ?? null;
    const startMs = hs.start.getTime();
    const endMs = hs.end ? hs.end.getTime() : startMs;
    const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
    sessions.push({
      id,
      routineId: routine?.id ?? '',
      title: hs.title,
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(Math.max(startMs, endMs)).toISOString(),
      durationSec,
      notes: hs.description,
      source: 'hevy',
    });
    const rxs = routine ? rxByRoutine.get(routine.id) ?? [] : [];
    const n = hs.sets.length;
    const span = Math.max(endMs - startMs, n * 1000);
    for (let i = 0; i < n; i++) {
      const s = hs.sets[i];
      const ex = exerciseByTitle.get(s.exerciseTitle);
      if (!ex) {
        result.skippedRows++;
        continue;
      }
      const rx = rxs.find((r) => r.exerciseId === ex.id) ?? null;
      const halve = halveByTitle.get(s.exerciseTitle) ?? false;
      const weight = s.weight === null ? 0 : halve ? roundKg(s.weight / 2) : roundKg(s.weight);
      sets.push({
        id: await stableUuid('hevy-set', `${hs.key}|${s.exerciseTitle}|${s.ordinal}`),
        sessionId: id,
        routineExerciseId: rx?.id ?? null,
        exerciseId: ex.id,
        index: s.ordinal,
        type: s.type,
        weight,
        reps: s.reps,
        distanceM: s.distanceM,
        seconds: s.seconds,
        rir: s.rir,
        completedAt: new Date(startMs + Math.round(((i + 1) / (n + 1)) * span)).toISOString(),
      });
    }
  }

  // 4. Write. Existing imported sessions are replaced wholesale so edits/deletions in Hevy propagate.
  await db.transaction('rw', [db.sessions, db.setLogs], async () => {
    const existing = await db.sessions.bulkGet(sessions.map((s) => s.id));
    for (let i = 0; i < sessions.length; i++) {
      if (existing[i]) {
        result.sessionsUpdated++;
        await db.setLogs.where('sessionId').equals(sessions[i].id).delete();
      } else {
        result.sessionsNew++;
      }
    }
    await db.sessions.bulkPut(sessions);
    await db.setLogs.bulkPut(sets);
    result.setsWritten = sets.length;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Post-import: reconcile prescribed weights with the latest imported session

export interface WeightReconcileRow {
  rx: RoutineExercise;
  exercise: Exercise;
  routineName: string;
  current: number;
  latest: number;
  latestDate: string;
  reps: number[];
}

/**
 * For every routine-exercise, the working weight of the most recent completed session
 * containing its exercise, when all working sets agree and it differs from the prescription.
 * Calibrating exercises are included so the user can lock in from real history.
 */
export async function reconcileWeights(): Promise<WeightReconcileRow[]> {
  const routines = (await db.routines.toArray()).filter((r) => !r.archived);
  const rows: WeightReconcileRow[] = [];
  for (const routine of routines) {
    for (const { rx, exercise } of await routineItems(routine.id)) {
      if (exercise.kind === 'carry' || exercise.kind === 'timed') continue;
      const sets = await db.setLogs.where('exerciseId').equals(exercise.id).toArray();
      if (sets.length === 0) continue;
      const sessionIds = [...new Set(sets.map((s) => s.sessionId))];
      const sessions = (await db.sessions.bulkGet(sessionIds)).filter((s): s is Session => !!s && !!s.endedAt);
      sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const latest = sessions[0];
      if (!latest) continue;
      const working = sets.filter((s) => s.sessionId === latest.id && s.type === 'working');
      if (working.length === 0) continue;
      const w = working[0].weight;
      if (!working.every((s) => s.weight === w)) continue;
      if (rx.mode === 'normal' && w === rx.currentWeight) continue;
      rows.push({
        rx,
        exercise,
        routineName: routine.name,
        current: rx.currentWeight,
        latest: w,
        latestDate: latest.startedAt,
        reps: working.sort((a, b) => a.index - b.index).map((s) => s.reps ?? 0),
      });
    }
  }
  return rows;
}

/** Apply chosen weights: normal exercises get the new currentWeight, calibrating ones lock in. */
export async function applyReconciledWeights(rows: WeightReconcileRow[]): Promise<void> {
  for (const row of rows) {
    if (row.rx.mode === 'calibrating') await lockInRoutineExercise(row.rx.id, row.latest);
    else await db.routineExercises.update(row.rx.id, { currentWeight: roundKg(row.latest) });
  }
}
