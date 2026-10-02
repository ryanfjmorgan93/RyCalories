import { describe, expect, it } from 'vitest';
import { EXERCISE_DEMOS } from '../data/exerciseDemos';
import type { CatalogueEntry } from './catalogue';
import { exerciseFromDemo, type ListDemo } from './library';
import { NON_ROUTINE_PATTERNS, movementPattern } from './movement';
import {
  buildQuickInput,
  catalogueCandidates,
  diagramCandidateId,
  diagramCandidates,
  historyBase,
  isLiftDiagram,
  modelledSeconds,
  ownedEquipment,
  routineBase,
  type PaceContext,
  type QuickSource,
} from './quickInput';
import { DEFAULT_SETTINGS, type Equipment, type Exercise, type Routine, type RoutineExercise, type Session, type SetLog, type Settings } from './types';

// ---------------------------------------------------------------------------
// Fixtures

const TODAY = '2026-09-30';
/** An ISO timestamp at noon, `days` before TODAY. */
const noon = (days: number): string => new Date(2026, 8, 30 - days, 12, 0, 0).toISOString();

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, id: 'settings', createdAt: noon(100) };

function exercise(id: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    kind: 'reps',
    muscleGroup: 'chest',
    isCompound: false,
    isLowerBody: false,
    defaultRestSec: 75,
    defaultIncrement: 2.5,
    unilateral: false,
    createdAt: noon(100),
    ...over,
  };
}

function routine(id: string, order: number, over: Partial<Routine> = {}): Routine {
  return { id, name: id, order, isLowerBody: false, ...over };
}

function rx(id: string, routineId: string, exerciseId: string, over: Partial<RoutineExercise> = {}): RoutineExercise {
  return { id, routineId, exerciseId, order: 0, targetSets: 3, repMin: 8, repMax: 10, currentWeight: 40, increment: 2.5, mode: 'normal', optional: false, ...over };
}

function session(id: string, daysAgo: number, over: Partial<Session> = {}): Session {
  return { id, routineId: 'r1', title: id, startedAt: noon(daysAgo), endedAt: noon(daysAgo), durationSec: 2400, ...over };
}

let setCounter = 0;
function set(sessionId: string, exerciseId: string, weight: number, reps: number | undefined, over: Partial<SetLog> = {}): SetLog {
  const n = ++setCounter;
  return { id: `s${n}`, sessionId, routineExerciseId: null, exerciseId, index: n, type: 'working', weight, reps, completedAt: noon(0), ...over };
}

/** Sets in a session, logged on `daysAgo`. */
function sets(sessionId: string, exerciseId: string, daysAgo: number, rows: [number, number | undefined][], type: SetLog['type'] = 'working'): SetLog[] {
  return rows.map(([w, r]) => set(sessionId, exerciseId, w, r, { type, completedAt: noon(daysAgo) }));
}

function source(over: Partial<QuickSource> = {}): QuickSource {
  return { exercises: [], routines: [], routineExercises: [], sessions: [], setLogs: [], recency: {}, weeklySets: {}, ...over };
}

function entry(slug: string, over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return { slug, name: slug.replace(/-/g, ' '), muscleGroup: 'biceps', equipment: 'dumbbell', kind: 'reps', isCompound: false, unilateral: false, level: 'beginner', ...over };
}

const build = (src: QuickSource) => buildQuickInput(src, SETTINGS, TODAY);
const own = (src: QuickSource, id: string) => build(src).input.candidates.find((c) => c.id === id)!;

// ---------------------------------------------------------------------------

describe('routineBase', () => {
  const row = (id: string, over: Partial<RoutineExercise> = {}, routineOrder = 0) => ({ rx: rx(id, 'r', 'e', over), routineOrder });

  it('has nothing for an exercise in no routine', () => {
    expect(routineBase([])).toBeUndefined();
  });

  it('takes the sets, reps and weight of the lowest normal-mode weight', () => {
    const base = routineBase([
      row('a', { currentWeight: 60, targetSets: 4, repMin: 6, repMax: 8 }),
      row('b', { currentWeight: 50, targetSets: 3, repMin: 8, repMax: 12 }),
      row('c', { currentWeight: 55 }),
    ]);
    expect(base).toEqual({ sets: 3, repMin: 8, repMax: 12, weightKg: 50, mode: 'normal' });
  });

  it('ignores a calibrating row when a normal one exists, whatever its weight field says', () => {
    const base = routineBase([row('a', { mode: 'calibrating', currentWeight: 5 }), row('b', { currentWeight: 50 })]);
    expect(base).toMatchObject({ weightKg: 50, mode: 'normal' });
  });

  it('is calibrating with no weight when every row is calibrating', () => {
    const base = routineBase([row('a', { mode: 'calibrating', currentWeight: 30, targetSets: 4 }, 1), row('b', { mode: 'calibrating', targetSets: 2 }, 0)]);
    expect(base).toEqual({ sets: 2, repMin: 8, repMax: 10, weightKg: null, mode: 'calibrating' });
  });

  it('keeps a bodyweight 0 as a real weight', () => {
    expect(routineBase([row('a', { currentWeight: 0 })])).toMatchObject({ weightKg: 0, mode: 'normal' });
  });

  it('breaks a tie on weight by the routine that comes first in the week', () => {
    const base = routineBase([row('a', { currentWeight: 50, targetSets: 5 }, 2), row('b', { currentWeight: 50, targetSets: 3 }, 1)]);
    expect(base?.sets).toBe(3);
  });

  it('does not trust a weight that is not a number', () => {
    const base = routineBase([row('a', { currentWeight: Number.NaN }), row('b', { currentWeight: -5 })]);
    expect(base).toMatchObject({ weightKg: null, mode: 'calibrating' });
  });
});

describe('historyBase', () => {
  it('reads what was done: the counted sets, the reps they spanned, the heaviest weight', () => {
    const base = historyBase(sets('s', 'e', 0, [[60, 8], [60, 7], [57.5, 10]]));
    expect(base).toEqual({ sets: 3, repMin: 7, repMax: 10, weightKg: 60, mode: 'normal' });
  });

  it('does not count warm-ups or drop sets', () => {
    const all = [
      ...sets('s', 'e', 0, [[20, 10]], 'warmup'),
      ...sets('s', 'e', 0, [[60, 8], [60, 8]]),
      ...sets('s', 'e', 0, [[30, 12]], 'drop'),
    ];
    expect(historyBase(all)).toEqual({ sets: 2, repMin: 8, repMax: 8, weightKg: 60, mode: 'normal' });
  });

  it('counts a failure set', () => {
    expect(historyBase(sets('s', 'e', 0, [[60, 8], [60, 5]]).map((s, i) => (i === 1 ? { ...s, type: 'failure' as const } : s)))?.sets).toBe(2);
  });

  it('has nothing when no set counted', () => {
    expect(historyBase(sets('s', 'e', 0, [[20, 10]], 'warmup'))).toBeUndefined();
    expect(historyBase([])).toBeUndefined();
  });

  it('says no reps are known, rather than guessing, when none were logged', () => {
    expect(historyBase(sets('s', 'e', 0, [[60, undefined]]))).toMatchObject({ repMin: 0, repMax: 0, weightKg: 60 });
  });
});

describe('buildQuickInput: bases', () => {
  const bench = exercise('bench', { equipment: 'barbell' });

  it('takes the base from a real routine first', () => {
    const src = source({
      exercises: [bench],
      routines: [routine('r1', 0)],
      routineExercises: [rx('x1', 'r1', 'bench', { currentWeight: 70, targetSets: 4, repMin: 6, repMax: 8 })],
      sessions: [session('s1', 3)],
      setLogs: sets('s1', 'bench', 3, [[100, 5]]),
    });
    expect(own(src, 'bench').base).toEqual({ sets: 4, repMin: 6, repMax: 8, weightKg: 70, mode: 'normal' });
  });

  it('does not read a prescription from an archived routine or from the hidden quick one', () => {
    const src = source({
      exercises: [bench],
      routines: [routine('old', 0, { archived: true }), routine('q', -1, { archived: true, quick: true })],
      routineExercises: [rx('x1', 'old', 'bench', { currentWeight: 70 }), rx('x2', 'q', 'bench', { currentWeight: 26 })],
    });
    expect(own(src, 'bench').base).toBeUndefined();
  });

  it('is calibrating, and does not borrow a weight from history, when its routines have only calibrating rows', () => {
    const src = source({
      exercises: [bench],
      routines: [routine('r1', 0)],
      routineExercises: [rx('x1', 'r1', 'bench', { mode: 'calibrating', currentWeight: 0 })],
      sessions: [session('s1', 3)],
      setLogs: sets('s1', 'bench', 3, [[100, 5]]),
    });
    expect(own(src, 'bench').base).toMatchObject({ weightKg: null, mode: 'calibrating' });
  });

  it('falls back to the last top working set of a real finished session', () => {
    const src = source({
      exercises: [bench],
      sessions: [session('old', 20), session('new', 5)],
      setLogs: [...sets('old', 'bench', 20, [[60, 8]]), ...sets('new', 'bench', 5, [[65, 8], [65, 6], [62.5, 8]])],
    });
    expect(own(src, 'bench').base).toEqual({ sets: 3, repMin: 6, repMax: 8, weightKg: 65, mode: 'normal' });
  });

  it('skips a newer session that only warmed up, and a quick one, and one still running', () => {
    const src = source({
      exercises: [bench],
      sessions: [
        session('real', 30),
        session('warmup-only', 10),
        session('quick', 2, { quick: 'light' }),
        session('live', 0, { endedAt: undefined, durationSec: undefined }),
      ],
      setLogs: [
        ...sets('real', 'bench', 30, [[80, 5]]),
        ...sets('warmup-only', 'bench', 10, [[20, 10]], 'warmup'),
        ...sets('quick', 'bench', 2, [[52, 12]]),
        ...sets('live', 'bench', 0, [[90, 3]]),
      ],
    });
    expect(own(src, 'bench').base).toMatchObject({ weightKg: 80, repMin: 5, repMax: 5 });
  });

  it('has no base for an exercise never done and in no routine', () => {
    expect(own(source({ exercises: [bench] }), 'bench').base).toBeUndefined();
  });
});

describe('buildQuickInput: days since used', () => {
  const bench = exercise('bench');

  it('counts whole days back from the latest counted set', () => {
    const src = source({
      exercises: [bench],
      sessions: [session('a', 12), session('b', 6)],
      setLogs: [...sets('a', 'bench', 12, [[60, 8]]), ...sets('b', 'bench', 6, [[60, 8]])],
    });
    expect(own(src, 'bench').daysSinceUsed).toBe(6);
  });

  it('is absent for an exercise never done', () => {
    expect(own(source({ exercises: [bench] }), 'bench')).not.toHaveProperty('daysSinceUsed');
  });

  it('does not count a warm-up, but does count a drop set', () => {
    const warm = source({ exercises: [bench], sessions: [session('a', 3)], setLogs: sets('a', 'bench', 3, [[20, 10]], 'warmup') });
    expect(own(warm, 'bench')).not.toHaveProperty('daysSinceUsed');
    const drop = source({ exercises: [bench], sessions: [session('a', 3)], setLogs: sets('a', 'bench', 3, [[20, 10]], 'drop') });
    expect(own(drop, 'bench').daysSinceUsed).toBe(3);
  });

  it('ignores a quick session and one that has not finished', () => {
    const src = source({
      exercises: [bench],
      sessions: [session('real', 9), session('quick', 1, { quick: 'normal' }), session('live', 0, { endedAt: undefined })],
      setLogs: [...sets('real', 'bench', 9, [[60, 8]]), ...sets('quick', 'bench', 1, [[60, 8]]), ...sets('live', 'bench', 0, [[60, 8]])],
    });
    expect(own(src, 'bench').daysSinceUsed).toBe(9);
  });

  it('is never negative', () => {
    const src = source({ exercises: [bench], sessions: [session('a', -2)], setLogs: sets('a', 'bench', -2, [[60, 8]]) });
    expect(own(src, 'bench').daysSinceUsed).toBe(0);
  });

  it('leaves the muscles\' recency and weekly sets exactly as they were given (they count a quick session)', () => {
    const recency = { chest: 1 };
    const weeklySets = { chest: 6 };
    const input = build(source({ exercises: [bench], recency, weeklySets })).input;
    expect(input.recency).toBe(recency);
    expect(input.weeklySets).toBe(weeklySets);
  });
});

describe('buildQuickInput: the rest of the input', () => {
  it('carries the weekly targets and the rest and plate settings', () => {
    const settings: Settings = { ...SETTINGS, weeklySetTargets: { chest: 12 }, restCompoundSec: 200, restIsolationSec: 60, restCarrySec: 80, barKg: 15, plates: [20, 10] };
    const { input } = buildQuickInput(source(), settings, TODAY);
    expect(input.weeklyTargets).toEqual({ chest: 12 });
    expect(input.settings).toEqual({ restCompoundSec: 200, restIsolationSec: 60, restCarrySec: 80, barKg: 15, plates: [20, 10] });
  });

  it('has no weekly targets when none are set', () => {
    expect(build(source()).input).not.toHaveProperty('weeklyTargets');
  });

  it('maps an exercise field by field, leaving out what it does not have', () => {
    const c = own(source({ exercises: [exercise('e', { name: 'Cable Fly', muscleGroup: 'chest', equipment: 'cable', unilateral: true, defaultIncrement: 5, defaultRestSec: 90, standard: 'bench' })] }), 'e');
    expect(c).toEqual({
      id: 'e',
      name: 'Cable Fly',
      muscleGroup: 'chest',
      equipment: 'cable',
      kind: 'reps',
      isCompound: false,
      isLowerBody: false,
      unilateral: true,
      defaultIncrement: 5,
      defaultRestSec: 90,
      standard: 'bench',
      origin: 'own',
    });
    const plain = own(source({ exercises: [exercise('p')] }), 'p');
    expect(plain).not.toHaveProperty('equipment');
    expect(plain).not.toHaveProperty('standard');
  });
});

describe('the catalogue', () => {
  const cable = exercise('cable-curl', { muscleGroup: 'biceps', equipment: 'cable' });
  const ran = (extra: Partial<QuickSource> = {}) =>
    source({ exercises: [cable], sessions: [session('s', 4)], setLogs: sets('s', 'cable-curl', 4, [[20, 12]]), ...extra });

  it('adds nothing, and returns no entries, when new exercises are not wanted', () => {
    const { input, catalogueEntries } = build(ran());
    expect(input.candidates.every((c) => c.origin === 'own')).toBe(true);
    expect(catalogueEntries).toEqual([]);
  });

  it('adds candidates for entries the owner does not have, with the picture key as the id, and returns the same entries', () => {
    const entries = [entry('cable-hammer-curl', { equipment: 'cable' }), entry('cable-kickback', { equipment: 'cable', muscleGroup: 'glutes' })];
    const { input, catalogueEntries } = build(ran({ catalogue: entries }));
    const cat = input.candidates.filter((c) => c.origin === 'catalogue');
    expect(cat.map((c) => c.id)).toEqual(['cat:cable-hammer-curl', 'cat:cable-kickback']);
    expect(cat.map((c) => c.catalogueSlug)).toEqual(['cable-hammer-curl', 'cable-kickback']);
    expect(catalogueEntries).toEqual(entries);
    expect(cat[0]).toMatchObject({ name: 'cable hammer curl', muscleGroup: 'biceps', equipment: 'cable', kind: 'reps', level: 'beginner', isLowerBody: false });
    expect(cat[1].isLowerBody).toBe(true);
    expect(cat[0]).not.toHaveProperty('base');
    expect(cat[0]).not.toHaveProperty('daysSinceUsed');
  });

  it('only for equipment the owner has logged sets with, and bodyweight', () => {
    const entries = [
      entry('a-cable', { equipment: 'cable' }),
      entry('a-machine', { equipment: 'machine' }),
      entry('a-barbell', { equipment: 'barbell' }),
      entry('a-kettlebell', { equipment: 'kettlebell' }),
      entry('a-other', { equipment: 'other' }),
      entry('a-bodyweight', { equipment: 'bodyweight' }),
    ];
    const { catalogueEntries } = build(ran({ catalogue: entries }));
    expect(catalogueEntries.map((e) => e.slug)).toEqual(['a-cable', 'a-bodyweight']);
  });

  it('does not count equipment of an exercise that was never logged, or that has none recorded', () => {
    const machine = exercise('leg-press', { equipment: 'machine' });
    const unknown = exercise('mystery');
    const src = source({
      exercises: [cable, machine, unknown],
      sessions: [session('s', 4)],
      setLogs: [...sets('s', 'cable-curl', 4, [[20, 12]]), ...sets('s', 'mystery', 4, [[20, 12]])],
      catalogue: [entry('a-machine', { equipment: 'machine' }), entry('a-other', { equipment: 'other' })],
    });
    expect(build(src).catalogueEntries).toEqual([]);
  });

  it('counts equipment used in a quick session or one still running: sets were logged', () => {
    const kb = exercise('kb-swing', { equipment: 'kettlebell' });
    const src = source({
      exercises: [kb],
      sessions: [session('q', 2, { quick: 'light' })],
      setLogs: sets('q', 'kb-swing', 2, [[16, 12]]),
      catalogue: [entry('a-kettlebell', { equipment: 'kettlebell' })],
    });
    expect(build(src).catalogueEntries.map((e) => e.slug)).toEqual(['a-kettlebell']);
  });

  it("a catch-all 'other' is not kit the owner owns: logging the seeded Neck row never makes bands, balls or strongman lifts candidates", () => {
    // 'other' holds bands, exercise balls, EZ bars, a medicine ball, strongman implements and entries with
    // no equipment at all: one logged 'other' exercise must not stand for every one of them.
    const neck = exercise('neck', { muscleGroup: 'neck', equipment: 'other' });
    const entries = [
      entry('car-deadlift', { name: 'Car Deadlift', equipment: 'other' }),
      entry('tire-flip', { name: 'Tire Flip', equipment: 'other', muscleGroup: 'quads' }),
      entry('band-curl', { name: 'Band Curl', equipment: 'other' }),
      entry('ball-crunch', { name: 'Ball Crunch', equipment: 'other', muscleGroup: 'abs' }),
      entry('push-up', { name: 'Push Up', equipment: 'bodyweight', muscleGroup: 'chest' }),
    ];
    const src = source({ exercises: [neck], sessions: [session('s', 4)], setLogs: sets('s', 'neck', 4, [[10, 12]]), catalogue: entries });
    // Bodyweight still needs nothing, so it is the only kit the owner has here.
    expect(build(src).catalogueEntries.map((e) => e.slug)).toEqual(['push-up']);
    expect([...ownedEquipment([neck], new Set(['neck']))]).toEqual(['bodyweight']);
    // Real kit beside it still counts, and 'other' is never added to it.
    const both = ownedEquipment([neck, cable], new Set(['neck', 'cable-curl']));
    expect([...both].sort()).toEqual(['bodyweight', 'cable']);
  });

  it('leaves out an entry that is already one of the owner\'s exercises, by picture key, name or alias', () => {
    const byDemo = exercise('mine-1', { name: 'Something Else', equipment: 'cable', demo: 'cat:by-demo' });
    const byName = exercise('mine-2', { name: 'Cable  Fly', equipment: 'cable' });
    const byAlias = exercise('mine-3', { name: 'Hevy Name', aliases: ['Rope Pushdown'], equipment: 'cable' });
    const src = source({
      exercises: [cable, byDemo, byName, byAlias],
      sessions: [session('s', 4)],
      setLogs: sets('s', 'cable-curl', 4, [[20, 12]]),
      catalogue: [
        entry('by-demo', { name: 'Whatever', equipment: 'cable' }),
        entry('by-name', { name: 'cable fly', equipment: 'cable' }),
        entry('by-alias', { name: 'Rope Pushdown', equipment: 'cable' }),
        entry('free', { name: 'Cable Crossover', equipment: 'cable' }),
      ],
    });
    expect(build(src).catalogueEntries.map((e) => e.slug)).toEqual(['free']);
  });

  it('leaves out expert entries and keeps beginner and intermediate', () => {
    const entries = [entry('b', { level: 'beginner' }), entry('i', { level: 'intermediate' }), entry('e', { level: 'expert' })];
    const dumbbell = exercise('db-curl', { equipment: 'dumbbell' });
    const src = source({ exercises: [dumbbell], sessions: [session('s', 4)], setLogs: sets('s', 'db-curl', 4, [[10, 12]]), catalogue: entries });
    expect(build(src).catalogueEntries.map((e) => e.slug)).toEqual(['b', 'i']);
  });

  it('ownedEquipment and catalogueCandidates agree when used alone', () => {
    const owned = ownedEquipment([cable, exercise('x', { equipment: 'machine' })], new Set(['cable-curl']));
    expect([...owned].sort()).toEqual(['bodyweight', 'cable']);
    const { candidates, entries } = catalogueCandidates([entry('a', { equipment: 'cable' }), entry('b', { equipment: 'machine' })], [cable], owned);
    expect(candidates.map((c) => c.id)).toEqual(['cat:a']);
    expect(entries.map((e) => e.slug)).toEqual(['a']);
  });
});

describe('pace', () => {
  // A compound with the default 150 s rest: three sets model as 60 + 3 x 40 + 2 x 150 = 480 s.
  const squat = exercise('squat', { isCompound: true, defaultRestSec: 150 });
  const finished = (id: string, daysAgo: number, durationSec: number | undefined, over: Partial<Session> = {}) => session(id, daysAgo, { durationSec, ...over });
  const threeSets = (id: string, daysAgo: number) => sets(id, 'squat', daysAgo, [[100, 5], [100, 5], [100, 5]]);

  it('models a session from its own counted sets and their rest', () => {
    const ctx: PaceContext = {
      candidates: new Map([['squat', own(source({ exercises: [squat] }), 'squat')]]),
      exercises: new Map([['squat', squat]]),
      routineExercises: new Map(),
      rest: { restCompoundSec: 150, restIsolationSec: 75, restCarrySec: 90 },
    };
    expect(modelledSeconds(threeSets('s', 1), ctx)).toBe(480);
    expect(modelledSeconds([...threeSets('s', 1), ...sets('s', 'squat', 1, [[40, 10]], 'warmup')], ctx)).toBe(480);
    expect(modelledSeconds([], ctx)).toBe(0);
  });

  it('uses the routine row\'s own rest, and doubles an exercise done one side at a time', () => {
    const row = rx('x1', 'r1', 'squat', { restSecOverride: 60 });
    const uni = exercise('lunge', { unilateral: true, defaultRestSec: 100 });
    const ctx: PaceContext = {
      candidates: new Map([
        ['squat', own(source({ exercises: [squat] }), 'squat')],
        ['lunge', own(source({ exercises: [uni] }), 'lunge')],
      ]),
      exercises: new Map([['squat', squat], ['lunge', uni]]),
      routineExercises: new Map([['x1', row]]),
      rest: { restCompoundSec: 150, restIsolationSec: 75, restCarrySec: 90 },
    };
    const logged = sets('s', 'squat', 1, [[100, 5], [100, 5]]).map((s) => ({ ...s, routineExerciseId: 'x1' }));
    // squat: 60 + 2 x 40 + 1 x 60 = 200. lunge: 60 + 2 x 40 x 2 + 1 x 100 = 320.
    expect(modelledSeconds([...logged, ...sets('s', 'lunge', 1, [[20, 10], [20, 10]])], ctx)).toBe(520);
  });

  it('is the owner\'s actual over modelled duration, from their finished sessions', () => {
    const src = source({
      exercises: [squat],
      sessions: [finished('a', 1, 600), finished('b', 2, 600), finished('c', 3, 600)],
      setLogs: [...threeSets('a', 1), ...threeSets('b', 2), ...threeSets('c', 3)],
    });
    expect(build(src).input.pace).toBeCloseTo(600 / 480, 10);
  });

  it('is 1 with fewer than three usable sessions', () => {
    const src = source({
      exercises: [squat],
      sessions: [finished('a', 1, 600), finished('b', 2, 600), finished('c', 3, undefined), finished('d', 4, 600, { endedAt: undefined })],
      setLogs: [...threeSets('a', 1), ...threeSets('b', 2), ...threeSets('c', 3), ...threeSets('d', 4)],
    });
    expect(build(src).input.pace).toBe(1);
  });

  it('says where the pace came from: measured from three sessions, held when it ran past the bounds, and nothing when there was no evidence', () => {
    const three = (secs: number) =>
      source({
        exercises: [squat],
        sessions: [finished('a', 1, secs), finished('b', 2, secs), finished('c', 3, secs)],
        setLogs: [...threeSets('a', 1), ...threeSets('b', 2), ...threeSets('c', 3)],
      });
    expect(build(three(600)).input.paceBasis).toBe('measured');
    // 480 s modelled: 1200 s is 2.5 times it, held to 1.6; 120 s is a quarter of it, held to 0.6.
    const slow = build(three(1200)).input;
    expect(slow.pace).toBe(1.6);
    expect(slow.paceBasis).toBe('held-slow');
    const fast = build(three(120)).input;
    expect(fast.pace).toBe(0.6);
    expect(fast.paceBasis).toBe('held-fast');
    const none = build(source({ exercises: [squat], sessions: [finished('a', 1, 600)], setLogs: threeSets('a', 1) })).input;
    expect(none.pace).toBe(1);
    expect('paceBasis' in none).toBe(false);
  });

  it('counts a quick session\'s own pace too', () => {
    const src = source({
      exercises: [squat],
      sessions: [finished('a', 1, 720, { quick: 'light' }), finished('b', 2, 720, { quick: 'normal' }), finished('c', 3, 720)],
      setLogs: [...threeSets('a', 1), ...threeSets('b', 2), ...threeSets('c', 3)],
    });
    expect(build(src).input.pace).toBeCloseTo(720 / 480, 10);
  });

  it('reads only the most recent sessions', () => {
    // The window is the twelve latest finished sessions, written out here rather than read from
    // PACE_SESSIONS: a test built from the constant would follow it to any size.
    const recent = Array.from({ length: 12 }, (_, i) => finished(`r${i}`, 1 + i, 480));
    // Older than all of them, and wildly slow: it must not move the median.
    const old = Array.from({ length: 12 }, (_, i) => finished(`o${i}`, 100 + i, 4800));
    const src = source({
      exercises: [squat],
      sessions: [...recent, ...old],
      setLogs: [...recent, ...old].flatMap((s) => threeSets(s.id, 0)),
    });
    expect(build(src).input.pace).toBe(1);
  });

  it('the window is exactly twelve sessions: the twelfth counts and the thirteenth does not', () => {
    // Newest first: six at the modelled pace, six at 1.4 times it, then eight more at the modelled pace.
    // Twelve of them have a median of 1.2; eleven would say 1, thirteen or more would say 1.
    const durations = [...Array(6).fill(480), ...Array(6).fill(672), ...Array(8).fill(480)] as number[];
    const all = durations.map((d, i) => finished(`w${i}`, 1 + i, d));
    const src = source({ exercises: [squat], sessions: all, setLogs: all.flatMap((s) => threeSets(s.id, 0)) });
    expect(build(src).input.pace).toBeCloseTo(1.2, 10);
  });

  it('drops a session with no modelled time rather than dividing by zero', () => {
    const src = source({
      exercises: [squat],
      sessions: [finished('a', 1, 600), finished('b', 2, 600), finished('c', 3, 600), finished('empty', 4, 600)],
      setLogs: [...threeSets('a', 1), ...threeSets('b', 2), ...threeSets('c', 3)],
    });
    expect(build(src).input.pace).toBeCloseTo(600 / 480, 10);
  });
});

describe('the same input in any order', () => {
  it('gives the same candidates whatever order the rows come in', () => {
    const exercises = [exercise('a', { equipment: 'cable' }), exercise('b', { equipment: 'machine' }), exercise('c')];
    const routines = [routine('r1', 0), routine('r2', 1)];
    const routineExercises = [rx('x1', 'r1', 'a', { currentWeight: 30 }), rx('x2', 'r2', 'a', { currentWeight: 25 }), rx('x3', 'r1', 'b')];
    const sessions = [session('s1', 5), session('s2', 9)];
    const setLogs = [...sets('s1', 'c', 5, [[10, 10]]), ...sets('s2', 'c', 9, [[12, 10]])];
    const forward = build(source({ exercises, routines, routineExercises, sessions, setLogs }));
    const backward = build(source({ exercises: [...exercises].reverse(), routines: [...routines].reverse(), routineExercises: [...routineExercises].reverse(), sessions: [...sessions].reverse(), setLogs: [...setLogs].reverse() }));
    const key = (c: { id: string }) => c.id;
    expect([...forward.input.candidates].sort((x, y) => (key(x) < key(y) ? -1 : 1))).toEqual([...backward.input.candidates].sort((x, y) => (key(x) < key(y) ? -1 : 1)));
    expect(forward.input.pace).toBe(backward.input.pace);
  });
});


// ---------------------------------------------------------------------------
// Equipment from the owner's routines

describe('ownedEquipment: what a routine says the owner uses', () => {
  const press = exercise('leg-press', { muscleGroup: 'quads', equipment: 'machine' });
  const cable = exercise('cable-curl', { muscleGroup: 'biceps', equipment: 'cable' });
  const band = exercise('band-pull', { muscleGroup: 'lats', equipment: 'other' });
  const kb = exercise('kb-swing', { muscleGroup: 'glutes', equipment: 'kettlebell' });
  const all = [press, cable, band, kb];

  it('counts the equipment of an exercise in a routine of theirs with no set ever logged', () => {
    expect([...ownedEquipment(all, new Set(), new Set(['leg-press', 'cable-curl']))].sort()).toEqual(['bodyweight', 'cable', 'machine']);
  });

  it('counts a logged set and a routine row together, each for its own exercise', () => {
    expect([...ownedEquipment(all, new Set(['kb-swing']), new Set(['leg-press']))].sort()).toEqual(['bodyweight', 'kettlebell', 'machine']);
  });

  it('is what it always was when no routine is given: logged sets, and bodyweight', () => {
    expect([...ownedEquipment(all, new Set(['cable-curl']))].sort()).toEqual(['bodyweight', 'cable']);
  });

  it("'other' is still no evidence of owning anything, in a routine as much as in a set", () => {
    expect([...ownedEquipment(all, new Set(['band-pull']), new Set(['band-pull']))]).toEqual(['bodyweight']);
  });

  it('an exercise in neither says nothing', () => {
    expect([...ownedEquipment(all, new Set(), new Set())]).toEqual(['bodyweight']);
  });

  describe('through buildQuickInput, which reads the routines', () => {
    const entries = [entry('a-machine', { equipment: 'machine' }), entry('a-cable', { equipment: 'cable' }), entry('a-kettlebell', { equipment: 'kettlebell' })];
    const slugs = (src: QuickSource) => build(src).catalogueEntries.map((e) => e.slug);

    it('offers the library for equipment their routines use, though nothing was ever logged', () => {
      const src = source({
        exercises: [press, kb],
        routines: [routine('r1', 0)],
        routineExercises: [rx('x1', 'r1', 'leg-press')],
        catalogue: entries,
      });
      expect(slugs(src)).toEqual(['a-machine']);
    });

    it('a routine the owner archived, and the hidden one a quick session runs on, say nothing about what they use', () => {
      const src = source({
        exercises: [press, cable, kb],
        routines: [routine('old', 0, { archived: true }), routine('quick', 1, { archived: true, quick: true }), routine('r3', 2)],
        routineExercises: [rx('x1', 'old', 'leg-press'), rx('x2', 'quick', 'kb-swing'), rx('x3', 'r3', 'cable-curl')],
        catalogue: entries,
      });
      expect(slugs(src)).toEqual(['a-cable']);
    });

    it('an exercise in no routine and never logged is still no evidence', () => {
      const src = source({ exercises: [press, cable], routines: [routine('r1', 0)], routineExercises: [rx('x1', 'r1', 'cable-curl')], catalogue: entries });
      expect(slugs(src)).toEqual(['a-cable']);
    });

    it("an 'other' exercise in a routine opens nothing", () => {
      const src = source({
        exercises: [band],
        routines: [routine('r1', 0)],
        routineExercises: [rx('x1', 'r1', 'band-pull')],
        catalogue: [...entries, entry('a-other', { equipment: 'other' }), entry('a-bodyweight', { equipment: 'bodyweight' })],
      });
      expect(slugs(src)).toEqual(['a-bodyweight']);
    });
  });
});

// ---------------------------------------------------------------------------
// The bundled diagrams

describe('the diagrams', () => {
  const diagram = (slug: string, over: Partial<ListDemo> = {}): ListDemo => ({
    slug,
    name: slug.replace(/-/g, ' '),
    equipment: 'Cable',
    muscleGroup: 'upper back',
    primaryMuscle: 'Upper Back',
    ...over,
  });
  const cable = exercise('cable-curl', { muscleGroup: 'biceps', equipment: 'cable' });
  const ran = (extra: Partial<QuickSource> = {}) =>
    source({ exercises: [cable], sessions: [session('s', 4)], setLogs: sets('s', 'cable-curl', 4, [[20, 12]]), ...extra });
  const slugsOf = (src: QuickSource) => build(src).demos.map((d) => d.slug);

  it('adds nothing, and returns no diagrams, when new exercises are not wanted', () => {
    const { input, demos } = build(ran());
    expect(input.candidates.every((c) => c.origin === 'own')).toBe(true);
    expect(demos).toEqual([]);
  });

  it('adds a candidate for a diagram the owner has not got, from the exercise it would become, and returns the diagram', () => {
    const face = diagram('face-pull');
    const { input, demos } = build(ran({ demos: [face] }));
    const fresh = input.candidates.filter((c) => c.origin === 'diagram');
    expect(fresh).toHaveLength(1);
    const made = exerciseFromDemo(face);
    expect(fresh[0]).toEqual({
      id: diagramCandidateId('face-pull'),
      name: 'face pull',
      muscleGroup: 'upper back',
      equipment: 'cable',
      kind: made.kind,
      isCompound: made.isCompound,
      isLowerBody: false,
      unilateral: false,
      defaultIncrement: made.defaultIncrement,
      defaultRestSec: made.defaultRestSec,
      origin: 'diagram',
      demoSlug: 'face-pull',
    });
    // Never an owned exercise's id, and never a weight or a history of its own.
    expect(fresh[0]!.id).toBe('demo:face-pull');
    expect(fresh[0]).not.toHaveProperty('base');
    expect(fresh[0]).not.toHaveProperty('daysSinceUsed');
    expect(demos).toEqual([face]);
  });

  it('only for equipment the owner has used (a set, or a routine), and bodyweight', () => {
    const demos = [
      diagram('a-cable', { equipment: 'Cable' }),
      diagram('a-machine', { equipment: 'Machine' }),
      diagram('a-barbell', { equipment: 'Barbell' }),
      diagram('a-band', { equipment: 'Resistance Band' }),
      diagram('a-bodyweight', { equipment: 'Bodyweight' }),
      diagram('a-bar', { equipment: 'Pull-up Bar' }),
    ];
    expect(slugsOf(ran({ demos }))).toEqual(['a-cable', 'a-bodyweight', 'a-bar']);
    // A machine exercise in a routine of theirs opens machines, with no set logged on it.
    const press = exercise('leg-press', { muscleGroup: 'quads', equipment: 'machine' });
    const withRoutine = ran({ demos, exercises: [cable, press], routines: [routine('r1', 0)], routineExercises: [rx('x', 'r1', 'leg-press')] });
    expect(slugsOf(withRoutine)).toEqual(['a-cable', 'a-machine', 'a-bodyweight', 'a-bar']);
  });

  it("leaves out a diagram that is already one of the owner's exercises, by picture key, name or alias: their own row wins", () => {
    const byDemo = exercise('mine-1', { name: 'Something Else', equipment: 'cable', demo: 'by-key' });
    const byName = exercise('mine-2', { name: 'Cable  Fly', equipment: 'cable' });
    const byAlias = exercise('mine-3', { name: 'Hevy Name', aliases: ['Rope Pushdown'], equipment: 'cable' });
    const src = ran({
      exercises: [cable, byDemo, byName, byAlias],
      demos: [
        diagram('by-key', { name: 'Whatever' }),
        diagram('by-name', { name: 'cable fly' }),
        diagram('by-alias', { name: 'Rope Pushdown' }),
        diagram('free', { name: 'Cable Crossover' }),
      ],
    });
    const { input } = build(src);
    expect(slugsOf(src)).toEqual(['free']);
    // The owner's exercises are all still there, each as their own.
    for (const id of ['mine-1', 'mine-2', 'mine-3']) expect(input.candidates.find((c) => c.id === id)?.origin).toBe('own');
    expect(input.candidates.filter((c) => c.origin === 'diagram').map((c) => c.demoSlug)).toEqual(['free']);
  });

  it('a catalogue entry with the name of a diagram that is a candidate is left out: the diagram wins', () => {
    const src = ran({
      demos: [diagram('face-pull', { name: 'Face Pull' })],
      catalogue: [entry('standing-face-pull', { name: 'face  PULL', equipment: 'cable' }), entry('cable-row', { name: 'Cable Row', equipment: 'cable' })],
    });
    const out = build(src);
    expect(out.demos.map((d) => d.slug)).toEqual(['face-pull']);
    expect(out.catalogueEntries.map((e) => e.slug)).toEqual(['cable-row']);
    expect(out.input.candidates.filter((c) => c.name.toLowerCase().includes('face')).map((c) => c.origin)).toEqual(['diagram']);
  });

  it('with no diagrams the catalogue is exactly what it was', () => {
    const entries = [entry('a', { equipment: 'cable' }), entry('b', { equipment: 'bodyweight' })];
    expect(build(ran({ catalogue: entries })).catalogueEntries.map((e) => e.slug)).toEqual(['a', 'b']);
  });

  it('is the same whatever order the diagrams come in', () => {
    const demos = [diagram('a'), diagram('b'), diagram('c', { equipment: 'Bodyweight' })];
    const sorted = (list: { id: string }[]) => [...list].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(sorted(build(ran({ demos })).input.candidates)).toEqual(sorted(build(ran({ demos: [...demos].reverse() })).input.candidates));
  });

  describe('which diagrams are lifts', () => {
    const lift = (name: string, over: Partial<ListDemo> = {}) => isLiftDiagram(diagram('x', { name, equipment: 'Bodyweight', ...over }));

    it('leaves out stretches, mobility, cardio, carries, jumps, and strongman and Olympic lifts, however they are filed', () => {
      expect(lift('Hamstring Stretch', { muscleGroup: 'hamstrings' })).toBe(false);
      expect(lift('Doorway Chest Stretch', { muscleGroup: 'chest', equipment: 'Doorway' })).toBe(false);
      expect(lift('Cat-Cow Stretch', { muscleGroup: null, primaryMuscle: 'Mobility' })).toBe(false);
      expect(lift('Leg Swings', { muscleGroup: null, primaryMuscle: 'Mobility' })).toBe(false);
      expect(lift('Spin', { muscleGroup: 'quads', equipment: 'Cardio' })).toBe(false);
      expect(lift('Treadmill Incline Walk', { muscleGroup: 'quads', equipment: 'Cardio' })).toBe(false);
      expect(lift('Farmer Carry', { muscleGroup: 'forearms', equipment: 'Dumbbell' })).toBe(false);
      expect(lift('Jump Squat', { muscleGroup: 'quads' })).toBe(false);
      expect(lift('Burpee', { muscleGroup: 'quads' })).toBe(false);
      expect(lift('Dumbbell Snatch', { muscleGroup: 'shoulders', equipment: 'Dumbbell' })).toBe(false);
      expect(lift('Sled Push', { muscleGroup: 'quads' })).toBe(false);
      expect(lift('Warm-up', { muscleGroup: 'abs', primaryMuscle: 'Mobility' })).toBe(false);
    });

    it('keeps the lifts, including the ones that look like something else', () => {
      expect(lift('Face Pull', { muscleGroup: 'upper back', equipment: 'Cable' })).toBe(true);
      expect(lift('Leg Press', { muscleGroup: 'quads', equipment: 'Machine' })).toBe(true);
      expect(lift('Dip', { muscleGroup: 'triceps' })).toBe(true);
      expect(lift('Hip Abduction Machine', { muscleGroup: 'glutes', equipment: 'Machine' })).toBe(true);
      expect(lift('Plank', { muscleGroup: 'abs' })).toBe(true);
    });

    it('over every real diagram: none that is a candidate is a movement a routine cannot be built from, and the lifts are there', () => {
      const every = new Set<Equipment>(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell']);
      const { candidates } = diagramCandidates(EXERCISE_DEMOS, [cable], every);
      expect(candidates.length).toBeGreaterThan(150);
      for (const c of candidates) {
        expect(NON_ROUTINE_PATTERNS.has(movementPattern(c.name, c.muscleGroup)), c.name).toBe(false);
        expect(c.muscleGroup, c.name).not.toBe('other');
        expect(c.equipment, c.name).not.toBe('other');
      }
      const names = new Set(candidates.map((c) => c.name));
      for (const lifts of ['Face Pull', 'Leg Press', 'Dip', 'Hip Abduction Machine', 'Chest Dip']) expect(names.has(lifts), lifts).toBe(true);
      // And the ones that are not lifts are not.
      for (const gone of ['Hamstring Stretch', 'Cat-Cow Stretch', 'Assault Bike', 'Running', 'Jump Squat', 'Burpee', 'Farmer Carry', 'Leg Swings', 'Battle Ropes']) {
        expect(names.has(gone), gone).toBe(false);
      }
    });
  });

  it('has a unique id for every candidate over the real data, and never one that is an owned exercise', () => {
    const owned = ['bench', 'face-pull'].map((id) => exercise(id, { equipment: 'cable' }));
    const { input } = build(source({ exercises: owned, sessions: [session('s', 4)], setLogs: sets('s', 'bench', 4, [[10, 10]]), demos: EXERCISE_DEMOS }));
    const ids = input.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(input.candidates.filter((c) => c.origin === 'diagram').every((c) => c.id.startsWith('demo:') && c.id === `demo:${c.demoSlug}`)).toBe(true);
  });
});
