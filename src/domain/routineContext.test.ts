import { describe, expect, it } from 'vitest';
import { SEED_EXERCISES, SEED_ROUTINES, SEED_ROUTINE_EXERCISES } from '../db/seed';
import { NIGGLE_WINDOW_DAYS, buildRoutineContext, weeklySetsFromRoutines, type RoutineContextSource } from './routineContext';
import type { Exercise, Niggle, ProgressionDecision, ProgressionRule, Routine, RoutineExercise, Session } from './types';

const TODAY = '2026-10-01';
const CREATED = '2026-01-01T09:00:00.000Z';
const EXERCISES: Exercise[] = SEED_EXERCISES.map((e) => ({ ...e, createdAt: CREATED }));
const BENCH = SEED_EXERCISES.find((e) => e.name === 'Bench Press (Barbell)')!.id;
const SQUAT = SEED_EXERCISES.find((e) => e.name === 'Barbell Back Squat')!.id;

function source(over: Partial<RoutineContextSource> = {}): RoutineContextSource {
  return { exercises: EXERCISES, routines: SEED_ROUTINES, routineExercises: SEED_ROUTINE_EXERCISES, sessions: [], decisions: [], ...over };
}

function session(id: string, startedAt: string, niggles?: Niggle[]): Session {
  return { id, routineId: '', title: id, startedAt, ...(niggles ? { niggles } : {}) };
}

/** `ago` days before TODAY, at midday UTC so no timezone moves it off its day. */
function daysAgo(ago: number): string {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - ago, 12)).toISOString();
}

function decision(rx: string, n: number, fromWeight: number, toWeight: number, rule: ProgressionRule = 'hold', overrideTo?: number): ProgressionDecision {
  return {
    id: `${rx}-${n}`,
    sessionId: `s${n}`,
    routineExerciseId: rx,
    fromWeight,
    toWeight,
    rule,
    accepted: true,
    decidedAt: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00.000Z`,
    ...(overrideTo !== undefined ? { overrideTo } : {}),
  };
}

const BENCH_RX = SEED_ROUTINE_EXERCISES.find((r) => r.exerciseId === BENCH)!;

describe('buildRoutineContext: the owner\'s routines', () => {
  it('reads the five seeded routines in their weekly order, with each exercise, its muscle, its movement and its sets', () => {
    const { routines } = buildRoutineContext(source(), TODAY);
    expect(routines.map((r) => r.name)).toEqual(['Lower (Hinge)', 'Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)']);
    const push = routines[1]!;
    expect(push.exercises.map((e) => [e.name, e.muscleGroup, e.pattern, e.targetSets, e.repMin, e.repMax])).toEqual([
      ['Bench Press (Barbell)', 'chest', 'press-horizontal', 4, 6, 8],
      ['Incline DB Press', 'chest', 'press-incline', 3, 6, 8],
      ['DB Shoulder Press', 'shoulders', 'press-vertical', 3, 6, 8],
      ['Triceps Pushdown', 'triceps', 'pushdown', 3, 12, 15],
    ]);
    expect(push.exercises[0]!.exerciseId).toBe(BENCH);
  });

  it('leaves out an archived routine and the hidden routine a quick session runs on', () => {
    const routines: Routine[] = [
      ...SEED_ROUTINES,
      { id: 'old', name: 'Old', order: 9, isLowerBody: false, archived: true },
      { id: 'quick', name: 'Quick', order: 10, isLowerBody: false, archived: true, quick: true },
    ];
    const rx: RoutineExercise[] = [
      ...SEED_ROUTINE_EXERCISES,
      { id: 'o1', routineId: 'old', exerciseId: BENCH, order: 0, targetSets: 5, repMin: 5, repMax: 5, currentWeight: 80, increment: 2.5, mode: 'normal', optional: false },
      { id: 'q1', routineId: 'quick', exerciseId: BENCH, order: 0, targetSets: 2, repMin: 10, repMax: 15, currentWeight: 30, increment: 2.5, mode: 'normal', optional: false },
    ];
    const ctx = buildRoutineContext(source({ routines, routineExercises: rx }), TODAY);
    expect(ctx.routines.map((r) => r.name)).not.toContain('Old');
    expect(ctx.routines.map((r) => r.name)).not.toContain('Quick');
    expect(ctx.routines).toHaveLength(5);
  });

  it('puts a routine\'s exercises in their order in it, and skips a row whose exercise is gone', () => {
    const routines: Routine[] = [{ id: 'r', name: 'R', order: 0, isLowerBody: false }];
    const base = { routineId: 'r', targetSets: 3, repMin: 8, repMax: 10, currentWeight: 0, increment: 2, mode: 'normal' as const, optional: false };
    const rx: RoutineExercise[] = [
      { ...base, id: 'b', exerciseId: SQUAT, order: 2 },
      { ...base, id: 'a', exerciseId: BENCH, order: 1 },
      { ...base, id: 'gone', exerciseId: 'no-such-exercise', order: 0 },
    ];
    const ctx = buildRoutineContext(source({ routines, routineExercises: rx }), TODAY);
    expect(ctx.routines[0]!.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Barbell Back Squat']);
  });

  it('is empty for an owner with no routines', () => {
    expect(buildRoutineContext(source({ routines: [], routineExercises: [] }), TODAY)).toEqual({ routines: [], niggles: [], stalled: [] });
  });
});

describe('buildRoutineContext: niggles in the last fortnight', () => {
  it('reads those logged in the window, newest first, one entry per niggle', () => {
    const sessions = [
      session('a', daysAgo(10), [{ tag: 'knee', severity: 1 }]),
      session('b', daysAgo(2), [{ tag: 'shoulder', severity: 2, note: 'left' }, { tag: 'lower back', severity: 3 }]),
      session('c', daysAgo(0), [{ tag: 'hamstring DOMS', severity: 1 }]),
    ];
    const { niggles } = buildRoutineContext(source({ sessions }), TODAY);
    expect(niggles).toEqual([
      { tag: 'hamstring DOMS', severity: 1, date: '2026-10-01' },
      { tag: 'lower back', severity: 3, date: '2026-09-29' },
      { tag: 'shoulder', severity: 2, date: '2026-09-29' },
      { tag: 'knee', severity: 1, date: '2026-09-21' },
    ]);
  });

  it('is fourteen days: the fourteenth day back is in and the fifteenth is out', () => {
    expect(NIGGLE_WINDOW_DAYS).toBe(14);
    const sessions = [session('in', daysAgo(14), [{ tag: 'knee', severity: 2 }]), session('out', daysAgo(15), [{ tag: 'shoulder', severity: 2 }])];
    const { niggles } = buildRoutineContext(source({ sessions }), TODAY);
    expect(niggles.map((n) => n.tag)).toEqual(['knee']);
    expect(niggles[0]!.date).toBe('2026-09-17');
  });

  it('leaves out a session from the future, a session with no niggles, and one with an empty list', () => {
    const sessions = [session('future', daysAgo(-1), [{ tag: 'knee', severity: 2 }]), session('none', daysAgo(1)), session('empty', daysAgo(1), [])];
    expect(buildRoutineContext(source({ sessions }), TODAY).niggles).toEqual([]);
  });
});

describe('buildRoutineContext: stalled lifts', () => {
  const stalled = (decisions: ProgressionDecision[]) => buildRoutineContext(source({ decisions }), TODAY).stalled;

  it('is a lift that has held at one weight for three sessions in a row, with how many', () => {
    expect(stalled([decision(BENCH_RX.id, 1, 65, 65), decision(BENCH_RX.id, 2, 65, 65), decision(BENCH_RX.id, 3, 65, 65)])).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
    expect(stalled([1, 2, 3, 4, 5].map((n) => decision(BENCH_RX.id, n, 65, 65)))).toEqual([{ exerciseId: BENCH, sessions: 5 }]);
  });

  it('is not a lift that moved in the last three, or has fewer than three sessions', () => {
    expect(stalled([decision(BENCH_RX.id, 1, 65, 65), decision(BENCH_RX.id, 2, 65, 65)])).toEqual([]);
    expect(stalled([decision(BENCH_RX.id, 1, 62.5, 65, 'increase'), decision(BENCH_RX.id, 2, 65, 65), decision(BENCH_RX.id, 3, 65, 65)])).toEqual([]);
  });

  it('reads the newest sessions first, so an old stall that has been broken is not one', () => {
    const history = [1, 2, 3, 4].map((n) => decision(BENCH_RX.id, n, 65, 65));
    history.push(decision(BENCH_RX.id, 5, 65, 67.5, 'increase'));
    expect(stalled(history)).toEqual([]);
  });

  it('is broken by a deload, and ignores a calibrating session', () => {
    expect(stalled([decision(BENCH_RX.id, 1, 65, 65), decision(BENCH_RX.id, 2, 65, 58.5, 'deload'), decision(BENCH_RX.id, 3, 65, 65), decision(BENCH_RX.id, 4, 65, 65)])).toEqual([]);
    expect(stalled([decision(BENCH_RX.id, 1, 65, 65), decision(BENCH_RX.id, 2, 0, 65, 'calibrating'), decision(BENCH_RX.id, 3, 65, 65), decision(BENCH_RX.id, 4, 65, 65)])).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
  });

  it('reads the weight the owner chose over the one that was proposed', () => {
    const overridden = [1, 2, 3].map((n) => decision(BENCH_RX.id, n, 65, 67.5, 'increase', 65));
    expect(stalled(overridden)).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
  });

  it('is the exercise, once, with the longest run, when it sits in two of the owner\'s routines', () => {
    const second: RoutineExercise = { ...BENCH_RX, id: 'second-bench', routineId: SEED_ROUTINES[0]!.id, order: 99 };
    const routineExercises = [...SEED_ROUTINE_EXERCISES, second];
    const decisions = [
      ...[1, 2, 3].map((n) => decision(BENCH_RX.id, n, 65, 65)),
      ...[1, 2, 3, 4].map((n) => decision('second-bench', n, 65, 65)),
    ];
    const ctx = buildRoutineContext(source({ routineExercises, decisions }), TODAY);
    expect(ctx.stalled).toEqual([{ exerciseId: BENCH, sessions: 4 }]);
  });

  it('does not read the decisions of a routine that is archived', () => {
    const routines = SEED_ROUTINES.map((r) => (r.id === BENCH_RX.routineId ? { ...r, archived: true } : r));
    const decisions = [1, 2, 3].map((n) => decision(BENCH_RX.id, n, 65, 65));
    expect(buildRoutineContext(source({ routines, decisions }), TODAY).stalled).toEqual([]);
  });

  it('lists each stalled lift once, in a fixed order', () => {
    const squatRx = SEED_ROUTINE_EXERCISES.find((r) => r.exerciseId === SQUAT)!;
    const decisions = [...[1, 2, 3].map((n) => decision(squatRx.id, n, 100, 100)), ...[1, 2, 3].map((n) => decision(BENCH_RX.id, n, 65, 65))];
    const a = stalled(decisions);
    const b = stalled([...decisions].reverse());
    expect(a).toEqual(b);
    expect(a.map((s) => s.exerciseId)).toEqual([BENCH, SQUAT].sort());
  });
});

describe('weeklySetsFromRoutines', () => {
  it('adds up each routine\'s target sets for each muscle, once per routine', () => {
    const { routines } = buildRoutineContext(source(), TODAY);
    const week = weeklySetsFromRoutines(routines);
    expect(week.chest).toBe(7);
    expect(week.shoulders).toBe(6);
    expect(week['rear delts']).toBe(3);
    expect(week.biceps).toBe(13);
    expect(week.triceps).toBe(10);
    expect(week.calves).toBe(11);
    expect(week.glutes).toBe(4);
    expect(week.forearms).toBeUndefined();
    expect(week['full body']).toBe(3);
    expect(week.neck).toBe(2);
    // Every target set is counted, once.
    expect(Object.values(week).reduce((s, n) => s + n!, 0)).toBe(SEED_ROUTINE_EXERCISES.reduce((s, r) => s + r.targetSets, 0));
  });

  it('is nothing for no routines', () => {
    expect(weeklySetsFromRoutines([])).toEqual({});
  });
});
