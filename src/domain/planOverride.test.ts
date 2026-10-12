import { describe, expect, it } from 'vitest';
import { decide } from './engine';
import {
  applyOverride,
  cleanOverride,
  describeOverride,
  effectiveRx,
  isEmptyOverride,
  judgedRx,
  mergeOverride,
  overrideFor,
  pruneOverride,
} from './planOverride';
import type { PlanOverride, RoutineExercise, Session } from './types';

const rx: RoutineExercise = {
  id: 'rx-1',
  routineId: 'r-1',
  exerciseId: 'e-1',
  order: 0,
  targetSets: 4,
  repMin: 6,
  repMax: 8,
  currentWeight: 110,
  increment: 5,
  mode: 'normal',
  optional: false,
};

const withOverrides = (planOverrides: Record<string, PlanOverride> | undefined): Pick<Session, 'planOverrides'> => ({ planOverrides });

describe('effectiveRx', () => {
  it('returns the very same object when there is no override', () => {
    expect(effectiveRx(rx, withOverrides(undefined))).toBe(rx);
    expect(effectiveRx(rx, withOverrides({}))).toBe(rx);
    expect(effectiveRx(rx, withOverrides({ 'other-rx': { targetSets: 2 } }))).toBe(rx);
    expect(effectiveRx(rx, null)).toBe(rx);
    expect(effectiveRx(rx, undefined)).toBe(rx);
  });

  it('an empty override is no override', () => {
    expect(effectiveRx(rx, withOverrides({ 'rx-1': {} }))).toBe(rx);
  });

  it('applies the sets, the rep range and the weight, and nothing else', () => {
    const eff = effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: 2, repMin: 8, repMax: 10, weight: 100 } }));
    expect(eff).toEqual({ ...rx, targetSets: 2, repMin: 8, repMax: 10, currentWeight: 100 });
  });

  it('does not mutate the saved rx', () => {
    const before = { ...rx };
    effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: 1, weight: 50 } }));
    expect(rx).toEqual(before);
  });

  it('an override of one field leaves the rest as the routine says', () => {
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: 3 } }))).toEqual({ ...rx, targetSets: 3 });
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { weight: 105 } }))).toEqual({ ...rx, currentWeight: 105 });
  });

  it('keeps sets at least 1', () => {
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: 0 } })).targetSets).toBe(1);
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: -3 } })).targetSets).toBe(1);
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: 2.6 } })).targetSets).toBe(3);
  });

  it('an explicit set count drops the routine\'s "up to" count; a rep or weight change keeps it', () => {
    const ranged = { ...rx, targetSets: 3, targetSetsMax: 4 };
    expect(effectiveRx(ranged, withOverrides({ 'rx-1': { targetSets: 2 } })).targetSetsMax).toBeUndefined();
    expect(effectiveRx(ranged, withOverrides({ 'rx-1': { repMax: 10 } })).targetSetsMax).toBe(4);
  });

  it('keeps repMin ≤ repMax: the bound just changed wins', () => {
    // Only repMin given, above the routine's repMax: repMax follows it.
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { repMin: 10 } }))).toMatchObject({ repMin: 10, repMax: 10 });
    // Only repMax given, below the routine's repMin: repMin follows it.
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { repMax: 4 } }))).toMatchObject({ repMin: 4, repMax: 4 });
    // Both given and inverted: swapped.
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { repMin: 12, repMax: 8 } }))).toMatchObject({ repMin: 8, repMax: 12 });
  });

  it('keeps reps at least 1 and ignores junk numbers', () => {
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { repMin: 0, repMax: 0 } }))).toMatchObject({ repMin: 1, repMax: 1 });
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { targetSets: Number.NaN, weight: Number.POSITIVE_INFINITY } }))).toBe(rx);
  });

  it('never sets a negative weight, and rounds it to the kilo grid', () => {
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { weight: -5 } })).currentWeight).toBe(0);
    expect(effectiveRx(rx, withOverrides({ 'rx-1': { weight: 62.499999 } })).currentWeight).toBe(62.5);
  });

  it('a weight override does nothing on a calibrating lift (it has no prescribed weight)', () => {
    const calibrating = { ...rx, mode: 'calibrating' as const, currentWeight: 0 };
    expect(effectiveRx(calibrating, withOverrides({ 'rx-1': { weight: 60 } }))).toBe(calibrating);
    expect(effectiveRx(calibrating, withOverrides({ 'rx-1': { weight: 60, targetSets: 2 } }))).toEqual({ ...calibrating, targetSets: 2 });
  });

  it('applying an already-effective rx again changes nothing', () => {
    const o = { targetSets: 2, repMin: 8, repMax: 10, weight: 100 };
    const once = effectiveRx(rx, withOverrides({ 'rx-1': o }));
    expect(effectiveRx(once, withOverrides({ 'rx-1': o }))).toEqual(once);
  });
});

describe('judgedRx (what the progression engine judges today against)', () => {
  it('uses today\'s sets and rep range but the SAVED weight', () => {
    const j = judgedRx(rx, withOverrides({ 'rx-1': { targetSets: 2, repMax: 10, weight: 60 } }));
    expect(j).toMatchObject({ targetSets: 2, repMin: 6, repMax: 10, currentWeight: 110 });
  });

  it('is the same object with no override or a weight-only override', () => {
    expect(judgedRx(rx, withOverrides(undefined))).toBe(rx);
    expect(judgedRx(rx, withOverrides({ 'rx-1': { weight: 60 } }))).toEqual(rx);
  });

  it('a lift cut to two sets and done twice is a full session, not hold_missing_sets', () => {
    const sets = [
      { type: 'working' as const, weight: 110, reps: 8 },
      { type: 'working' as const, weight: 110, reps: 8 },
    ];
    const engine = (r: typeof rx) => ({ id: r.id, kind: 'reps' as const, mode: r.mode, targetSets: r.targetSets, repMin: r.repMin, repMax: r.repMax, currentWeight: r.currentWeight, increment: r.increment });
    expect(decide(engine(rx), sets).rule).toBe('hold_missing_sets');
    const today = decide(engine(judgedRx(rx, withOverrides({ 'rx-1': { targetSets: 2 } }))), sets);
    expect(today.rule).toBe('increase');
    expect(today.toWeight).toBe(115);
    expect(today.targetSets).toBe(2);
  });

  it('a raised rep ceiling today means 8s are no longer the top of the range', () => {
    const sets = [8, 8, 8, 8].map((reps) => ({ type: 'working' as const, weight: 110, reps }));
    const engine = (r: typeof rx) => ({ id: r.id, kind: 'reps' as const, mode: r.mode, targetSets: r.targetSets, repMin: r.repMin, repMax: r.repMax, currentWeight: r.currentWeight, increment: r.increment });
    expect(decide(engine(judgedRx(rx, withOverrides({ 'rx-1': { repMin: 8, repMax: 10 } }))), sets).rule).toBe('hold');
  });

  it('progression reads the weight actually lifted, not the override weight', () => {
    // Prescribed 60 today (override), but 110 was lifted all four sets at the top of the range.
    const sets = [8, 8, 8, 8].map((reps) => ({ type: 'working' as const, weight: 110, reps }));
    const engine = (r: typeof rx) => ({ id: r.id, kind: 'reps' as const, mode: r.mode, targetSets: r.targetSets, repMin: r.repMin, repMax: r.repMax, currentWeight: r.currentWeight, increment: r.increment });
    const d = decide(engine(judgedRx(rx, withOverrides({ 'rx-1': { weight: 60 } }))), sets);
    expect(d).toMatchObject({ rule: 'increase', fromWeight: 110, sessionWeight: 110, toWeight: 115 });
  });

  it('a lighter day lifted at the override weight shows as a move from the routine\'s weight, never a silent "up"', () => {
    const sets = [8, 8, 8, 8].map((reps) => ({ type: 'working' as const, weight: 60, reps }));
    const engine = (r: typeof rx) => ({ id: r.id, kind: 'reps' as const, mode: r.mode, targetSets: r.targetSets, repMin: r.repMin, repMax: r.repMax, currentWeight: r.currentWeight, increment: r.increment });
    const d = decide(engine(judgedRx(rx, withOverrides({ 'rx-1': { weight: 60 } }))), sets);
    expect(d.fromWeight).toBe(110);
    expect(d.sessionWeight).toBe(60);
    expect(d.toWeight).toBe(65);
  });
});

describe('describeOverride', () => {
  it('reads the whole change as "Today: 3 × 8–10 at 60 kg"', () => {
    expect(describeOverride(rx, { targetSets: 3, repMin: 8, repMax: 10, weight: 60 })).toBe('Today: 3 × 8–10 at 60 kg');
  });

  it('names only what changed', () => {
    expect(describeOverride(rx, { targetSets: 3 })).toBe('Today: 3 sets');
    expect(describeOverride(rx, { targetSets: 1 })).toBe('Today: 1 set');
    expect(describeOverride(rx, { repMin: 8, repMax: 10 })).toBe('Today: 8–10 reps');
    expect(describeOverride(rx, { weight: 62.5 })).toBe('Today: 62.5 kg');
    expect(describeOverride(rx, { targetSets: 3, repMin: 8, repMax: 10 })).toBe('Today: 3 × 8–10');
    expect(describeOverride(rx, { targetSets: 2, weight: 100 })).toBe('Today: 2 sets at 100 kg');
    expect(describeOverride(rx, { repMax: 10, weight: 100 })).toBe('Today: 6–10 reps at 100 kg');
  });

  it('works the same on the saved rx or the effective one', () => {
    const o = { targetSets: 2, weight: 100 };
    expect(describeOverride(effectiveRx(rx, withOverrides({ 'rx-1': o })), o)).toBe(describeOverride(rx, o));
  });

  it('says nothing for an empty override', () => {
    expect(describeOverride(rx, {})).toBe('');
    expect(describeOverride(rx, null)).toBe('');
    expect(describeOverride(rx, undefined)).toBe('');
  });

  it('uses the kind\'s own words: seconds for a timed lift, added kg for a weighted bodyweight one', () => {
    expect(describeOverride({ ...rx, repMin: 30, repMax: 60 }, { repMax: 45 }, 'timed')).toBe('Today: 30–45 s');
    expect(describeOverride({ ...rx, currentWeight: 10 }, { weight: 12.5 }, 'bodyweight_plus')).toBe('Today: +12.5 kg');
  });

  it('leaves the weight out on a calibrating lift', () => {
    expect(describeOverride({ ...rx, mode: 'calibrating' }, { targetSets: 2, weight: 60 })).toBe('Today: 2 sets');
  });
});

describe('merge, prune and clean', () => {
  it('mergeOverride sets given numbers, removes keys given as undefined, and leaves absent keys alone', () => {
    expect(mergeOverride({ targetSets: 2, weight: 60 }, { repMin: 8 })).toEqual({ targetSets: 2, weight: 60, repMin: 8 });
    expect(mergeOverride({ targetSets: 2, weight: 60 }, { targetSets: undefined })).toEqual({ weight: 60 });
    expect(mergeOverride({ targetSets: 2 }, { targetSets: 3 })).toEqual({ targetSets: 3 });
    expect(mergeOverride(undefined, { targetSets: 3 })).toEqual({ targetSets: 3 });
  });

  it('pruneOverride drops every field equal to the saved routine', () => {
    expect(pruneOverride(rx, { targetSets: 4, repMin: 6, repMax: 8, weight: 110 })).toEqual({});
    expect(pruneOverride(rx, { targetSets: 3, repMin: 6, repMax: 10, weight: 110 })).toEqual({ targetSets: 3, repMax: 10 });
  });

  it('pruneOverride keeps a set count that differs only from a "3–4" range', () => {
    expect(pruneOverride({ ...rx, targetSets: 3, targetSetsMax: 4 }, { targetSets: 3 })).toEqual({ targetSets: 3 });
  });

  it('pruneOverride drops a weight on a calibrating lift', () => {
    expect(pruneOverride({ ...rx, mode: 'calibrating' }, { weight: 60 })).toEqual({});
  });

  it('cleanOverride drops junk and rounds', () => {
    expect(cleanOverride({ targetSets: 2.4, repMin: Number.NaN, repMax: 10, weight: 62.5 })).toEqual({ targetSets: 2, repMax: 10, weight: 62.5 });
    expect(cleanOverride(null)).toEqual({});
    expect(cleanOverride({ targetSets: 99 }).targetSets).toBe(12);
  });

  it('isEmptyOverride and overrideFor', () => {
    expect(isEmptyOverride({})).toBe(true);
    expect(isEmptyOverride({ weight: 0 })).toBe(false);
    expect(overrideFor('rx-1', withOverrides({ 'rx-1': { targetSets: 2 } }))).toEqual({ targetSets: 2 });
    expect(overrideFor('rx-1', withOverrides({ 'rx-1': {} }))).toBeUndefined();
  });

  it('applyOverride is exported for callers that hold the override itself', () => {
    expect(applyOverride(rx, { targetSets: 2 }).targetSets).toBe(2);
  });
});
