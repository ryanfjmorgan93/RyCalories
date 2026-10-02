/**
 * The quick-session generator's input, built from the owner's own rows — pure. No IO, no clock, no
 * database: `src/db/quickQueries.ts` reads the tables and hands them here with today's date.
 *
 * Weights come from nowhere but the owner's own training. An exercise's base is what a real routine
 * of theirs prescribes for it, else what they last did in a real session; a quick session is never
 * a source (a light one is a fraction of a working weight, and would compound on itself), and never
 * a recency for an exercise either.
 */
import { catalogueDemoKey, exerciseFromCatalogue, type CatalogueEntry } from './catalogue';
import { daysBetween, isoToDateKey } from './dates';
import { normaliseName } from './exerciseMatch';
import { equipmentFromDemo, exerciseFromDemo, findExistingExercise, type ListDemo } from './library';
import { NON_ROUTINE_PATTERNS, movementPattern } from './movement';
import { estimateMinutes, paceFactor, type Candidate, type QuickInput } from './quickSession';
import { restSecondsFor, type RestDefaults } from './rest';
import { countsForProgression, countsForVolume } from './sets';
import type { Equipment, Exercise, MuscleGroup, Routine, RoutineExercise, Session, SetLog, Settings } from './types';

type Base = NonNullable<Candidate['base']>;

/** The rows of every table a quick session reads, as plain arrays. */
export interface QuickSource {
  exercises: Exercise[];
  routines: Routine[];
  routineExercises: RoutineExercise[];
  sessions: Session[];
  setLogs: SetLog[];
  /** `muscleRecency` and `weeklySetsByMuscle`, which count quick sessions: a light session still trains the muscle. */
  recency: Partial<Record<MuscleGroup, number>>;
  weeklySets: Partial<Record<MuscleGroup, number>>;
  /** Every catalogue entry. Absent when the owner has not asked for new exercises. */
  catalogue?: CatalogueEntry[];
  /** Every bundled diagram. Absent when the owner has not asked for new exercises. */
  demos?: ListDemo[];
}

/** How many of the most recent finished sessions the owner's pace is read from. */
export const PACE_SESSIONS = 12;

function byPlace(a: { routineOrder: number; rx: RoutineExercise }, b: { routineOrder: number; rx: RoutineExercise }): number {
  return a.routineOrder - b.routineOrder || a.rx.order - b.rx.order || (a.rx.id < b.rx.id ? -1 : a.rx.id > b.rx.id ? 1 : 0);
}

/**
 * What the owner's routines prescribe for an exercise: sets, reps and weight of the row with the
 * lowest working weight among those in normal mode (the conservative one, when two routines have it
 * at different weights). An exercise that is only ever calibrating has no weight and is still
 * calibrating.
 */
export function routineBase(rows: { rx: RoutineExercise; routineOrder: number }[]): Base | undefined {
  if (rows.length === 0) return undefined;
  const normal = rows
    .filter((r) => r.rx.mode === 'normal' && Number.isFinite(r.rx.currentWeight) && r.rx.currentWeight >= 0)
    .sort((a, b) => a.rx.currentWeight - b.rx.currentWeight || byPlace(a, b));
  if (normal.length > 0) {
    const { rx } = normal[0];
    return { sets: rx.targetSets, repMin: rx.repMin, repMax: rx.repMax, weightKg: rx.currentWeight, mode: 'normal' };
  }
  const { rx } = [...rows].sort(byPlace)[0];
  return { sets: rx.targetSets, repMin: rx.repMin, repMax: rx.repMax, weightKg: null, mode: 'calibrating' };
}

function byIndex(a: SetLog, b: SetLog): number {
  return a.index - b.index || a.completedAt.localeCompare(b.completedAt);
}

/**
 * One session's sets for an exercise, read as a prescription: as many sets as were counted, the reps
 * they spanned, and the heaviest weight among them (the first such set, as `exerciseHistory` reads
 * it). Undefined when no set counted. Reps of 0 mean none were logged, which the generator reads as
 * "use the default range".
 */
export function historyBase(sessionSets: SetLog[]): Base | undefined {
  const counted = sessionSets.filter((s) => countsForProgression(s.type)).sort(byIndex);
  if (counted.length === 0) return undefined;
  const top = counted.reduce((best, s) => (s.weight > best.weight ? s : best));
  const reps = counted.map((s) => s.reps).filter((r): r is number => typeof r === 'number' && r >= 1);
  return {
    sets: counted.length,
    repMin: reps.length ? Math.min(...reps) : 0,
    repMax: reps.length ? Math.max(...reps) : 0,
    weightKg: top.weight,
    mode: 'normal',
  };
}

function ownCandidate(e: Exercise, base: Base | undefined, daysSinceUsed: number | undefined): Candidate {
  return {
    id: e.id,
    name: e.name,
    muscleGroup: e.muscleGroup,
    ...(e.equipment ? { equipment: e.equipment } : {}),
    kind: e.kind,
    isCompound: e.isCompound,
    isLowerBody: e.isLowerBody,
    unilateral: e.unilateral,
    defaultIncrement: e.defaultIncrement,
    defaultRestSec: e.defaultRestSec,
    ...(e.standard ? { standard: e.standard } : {}),
    origin: 'own',
    ...(daysSinceUsed !== undefined ? { daysSinceUsed } : {}),
    ...(base ? { base } : {}),
  };
}

function catalogueCandidate(entry: CatalogueEntry): Candidate {
  const e = exerciseFromCatalogue(entry);
  return {
    id: catalogueDemoKey(entry.slug),
    name: e.name,
    muscleGroup: e.muscleGroup,
    equipment: e.equipment,
    kind: e.kind,
    isCompound: e.isCompound,
    isLowerBody: e.isLowerBody,
    unilateral: e.unilateral,
    defaultIncrement: e.defaultIncrement,
    defaultRestSec: e.defaultRestSec,
    level: entry.level,
    origin: 'catalogue',
    catalogueSlug: entry.slug,
  };
}

/**
 * The id a diagram candidate carries. Not the bare slug: a candidate's id must never be an owned
 * exercise's, and the builder keys its pool on it. The slug itself is `demoSlug`, and is what the
 * exercise made from the diagram carries as its picture key.
 */
export function diagramCandidateId(slug: string): string {
  return `demo:${slug}`;
}

function diagramCandidate(d: ListDemo): Candidate {
  const e = exerciseFromDemo(d);
  return {
    id: diagramCandidateId(d.slug),
    name: e.name,
    muscleGroup: e.muscleGroup,
    ...(e.equipment ? { equipment: e.equipment } : {}),
    kind: e.kind,
    isCompound: e.isCompound,
    isLowerBody: e.isLowerBody,
    unilateral: e.unilateral,
    defaultIncrement: e.defaultIncrement,
    defaultRestSec: e.defaultRestSec,
    origin: 'diagram',
    demoSlug: d.slug,
  };
}

/**
 * Equipment the owner has used: that of every exercise they have logged a set on or that sits in
 * one of their own routines (`routineExerciseIds`: not an archived routine, not a quick session's
 * hidden one), plus bodyweight, which needs none. An owner whose routines are built on machines and
 * cables has used them, whatever few sets they have logged; without this they are offered bodyweight
 * only. An exercise with no equipment recorded says nothing either way, and neither does 'other': it
 * is the catch-all for bands, balls, EZ bars and strongman implements, so one logged 'other'
 * exercise (the seeded Neck row) is no evidence of owning any of them.
 */
export function ownedEquipment(
  exercises: readonly Exercise[],
  loggedExerciseIds: ReadonlySet<string>,
  routineExerciseIds: ReadonlySet<string> = new Set(),
): Set<Equipment> {
  const owned = new Set<Equipment>(['bodyweight']);
  for (const e of exercises) {
    if (e.equipment && e.equipment !== 'other' && (loggedExerciseIds.has(e.id) || routineExerciseIds.has(e.id))) owned.add(e.equipment);
  }
  return owned;
}

/**
 * Whether a bundled diagram is a lift something can be built from. Stretches, mobility drills,
 * cardio, carries, jumps and strongman or Olympic lifts are not (`NON_ROUTINE_PATTERNS`, read from
 * the name), nor is a diagram the library files under no muscle group (the mobility drills) or
 * under cardio equipment.
 */
export function isLiftDiagram(d: ListDemo): boolean {
  if (d.muscleGroup === null || d.equipment === 'Cardio') return false;
  if (/^(mobility|cardio|stretch)/i.test(d.primaryMuscle ?? '')) return false;
  return !NON_ROUTINE_PATTERNS.has(movementPattern(d.name, d.muscleGroup));
}

/**
 * Diagrams the generator may suggest: a lift (`isLiftDiagram`), for equipment the owner has used,
 * and not already one of the owner's exercises, by the rule the exercise list applies
 * (`findExistingExercise`: the diagram's picture key, or its name or an alias, ignoring case,
 * apostrophes and spacing). The owner's own row always wins.
 */
export function diagramCandidates(demos: readonly ListDemo[], owned: readonly Exercise[], equipment: ReadonlySet<Equipment>): { candidates: Candidate[]; demos: ListDemo[] } {
  const kept = demos.filter((d) => isLiftDiagram(d) && equipment.has(equipmentFromDemo(d.equipment)) && findExistingExercise(owned, d.slug, d.name) === undefined);
  return { candidates: kept.map(diagramCandidate), demos: kept };
}

/**
 * Catalogue entries a quick session may suggest: not already one of the owner's exercises (by the
 * catalogue picture key, or by name or alias), not expert, and only for equipment they have used.
 * An entry with the name of one of `diagrams` (the ones that are candidates) is left out: the
 * diagram is the curated one, and is the same exercise.
 */
export function catalogueCandidates(
  entries: readonly CatalogueEntry[],
  owned: readonly Exercise[],
  equipment: ReadonlySet<Equipment>,
  diagrams: readonly ListDemo[] = [],
): { candidates: Candidate[]; entries: CatalogueEntry[] } {
  const demos = new Set(owned.map((e) => e.demo).filter((d): d is string => !!d));
  const names = new Set(owned.flatMap((e) => [e.name, ...(e.aliases ?? [])]).map(normaliseName));
  for (const d of diagrams) names.add(normaliseName(d.name));
  const kept = entries.filter(
    (e) => e.level !== 'expert' && equipment.has(e.equipment) && !demos.has(catalogueDemoKey(e.slug)) && !names.has(normaliseName(e.name)),
  );
  return { candidates: kept.map(catalogueCandidate), entries: kept };
}

/** What `modelledSeconds` looks an exercise, its routine row and its rest up in. */
export interface PaceContext {
  candidates: ReadonlyMap<string, Candidate>;
  exercises: ReadonlyMap<string, Exercise>;
  routineExercises: ReadonlyMap<string, RoutineExercise>;
  rest: RestDefaults;
}

/**
 * Seconds a finished session "should" have taken by the same model the plan's estimate uses: its
 * own counted sets per exercise, with that exercise's own rest. `estimateMinutes` with a pace of 60
 * returns seconds.
 */
export function modelledSeconds(sets: readonly SetLog[], ctx: PaceContext): number {
  const groups = new Map<string, { exerciseId: string; routineExerciseId: string | null; sets: number }>();
  for (const s of sets) {
    if (!countsForProgression(s.type)) continue;
    const key = s.routineExerciseId ?? `x:${s.exerciseId}`;
    const g = groups.get(key);
    if (g) g.sets++;
    else groups.set(key, { exerciseId: s.exerciseId, routineExerciseId: s.routineExerciseId, sets: 1 });
  }
  const rows = [];
  for (const g of groups.values()) {
    const candidate = ctx.candidates.get(g.exerciseId);
    const exercise = ctx.exercises.get(g.exerciseId);
    if (!candidate || !exercise) continue;
    const rx = g.routineExerciseId ? (ctx.routineExercises.get(g.routineExerciseId) ?? null) : null;
    rows.push({ sets: g.sets, restSec: restSecondsFor(rx, exercise, ctx.rest), candidate });
  }
  return estimateMinutes(rows, 60);
}

/**
 * The generator's input, and the library entries behind its library candidates: `catalogueEntries`
 * and `demos` are what Start needs to turn the ones chosen into exercises.
 */
export function buildQuickInput(src: QuickSource, settings: Settings, today: string): { input: QuickInput; catalogueEntries: CatalogueEntry[]; demos: ListDemo[] } {
  // A quick session's hidden routine is archived as well, but the owner's routines are the only
  // place a prescription is read from.
  const realRoutineOrder = new Map(src.routines.filter((r) => !r.archived && !r.quick).map((r) => [r.id, r.order]));
  const rxByExercise = new Map<string, { rx: RoutineExercise; routineOrder: number }[]>();
  for (const rx of src.routineExercises) {
    const routineOrder = realRoutineOrder.get(rx.routineId);
    if (routineOrder === undefined) continue;
    const list = rxByExercise.get(rx.exerciseId);
    if (list) list.push({ rx, routineOrder });
    else rxByExercise.set(rx.exerciseId, [{ rx, routineOrder }]);
  }

  // History from finished sessions the owner did for real: exercise -> session -> sets.
  const real = new Map(src.sessions.filter((s) => s.endedAt && !s.quick).map((s) => [s.id, s]));
  const history = new Map<string, Map<string, SetLog[]>>();
  const lastCounted = new Map<string, string>();
  for (const s of src.setLogs) {
    if (!real.has(s.sessionId)) continue;
    let bySession = history.get(s.exerciseId);
    if (!bySession) history.set(s.exerciseId, (bySession = new Map()));
    const list = bySession.get(s.sessionId);
    if (list) list.push(s);
    else bySession.set(s.sessionId, [s]);
    if (countsForVolume(s.type) && s.completedAt > (lastCounted.get(s.exerciseId) ?? '')) lastCounted.set(s.exerciseId, s.completedAt);
  }

  const own = new Map<string, Candidate>();
  for (const e of src.exercises) {
    let base = routineBase(rxByExercise.get(e.id) ?? []);
    if (!base) {
      const sessions = [...(history.get(e.id) ?? new Map<string, SetLog[]>()).entries()]
        .map(([id, sets]) => ({ started: real.get(id)!.startedAt, sets }))
        .sort((a, b) => b.started.localeCompare(a.started));
      for (const s of sessions) {
        base = historyBase(s.sets);
        if (base) break;
      }
    }
    const last = lastCounted.get(e.id);
    const days = last ? Math.max(0, daysBetween(isoToDateKey(last), today)) : undefined;
    own.set(e.id, ownCandidate(e, base, days));
  }

  let candidates = [...own.values()];
  let catalogueEntries: CatalogueEntry[] = [];
  let demos: ListDemo[] = [];
  if (src.catalogue || src.demos) {
    // What they have used: every set they have logged, and every exercise in a routine of theirs.
    const equipment = ownedEquipment(src.exercises, new Set(src.setLogs.map((s) => s.exerciseId)), new Set(rxByExercise.keys()));
    // Diagrams first: a catalogue entry that is the same exercise as one of them is left out.
    const diagrams = diagramCandidates(src.demos ?? [], src.exercises, equipment);
    const cat = catalogueCandidates(src.catalogue ?? [], src.exercises, equipment, diagrams.demos);
    candidates = [...candidates, ...diagrams.candidates, ...cat.candidates];
    catalogueEntries = cat.entries;
    demos = diagrams.demos;
  }

  const rest: RestDefaults = { restCompoundSec: settings.restCompoundSec, restIsolationSec: settings.restIsolationSec, restCarrySec: settings.restCarrySec };
  const setsBySession = new Map<string, SetLog[]>();
  for (const s of src.setLogs) {
    const list = setsBySession.get(s.sessionId);
    if (list) list.push(s);
    else setsBySession.set(s.sessionId, [s]);
  }
  const ctx: PaceContext = {
    candidates: own,
    exercises: new Map(src.exercises.map((e) => [e.id, e])),
    routineExercises: new Map(src.routineExercises.map((rx) => [rx.id, rx])),
    rest,
  };
  const recent = src.sessions
    .filter((s) => s.endedAt && typeof s.durationSec === 'number')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, PACE_SESSIONS);
  const pace = paceFactor(
    recent.map((s) => ({ durationSec: s.durationSec!, modelledSec: modelledSeconds(setsBySession.get(s.id) ?? [], ctx) })),
  );

  return {
    input: {
      candidates,
      recency: src.recency,
      weeklySets: src.weeklySets,
      ...(settings.weeklySetTargets ? { weeklyTargets: settings.weeklySetTargets } : {}),
      settings: { ...rest, barKg: settings.barKg, plates: settings.plates },
      pace,
    },
    catalogueEntries,
    demos,
  };
}
