import { describe, expect, it } from 'vitest';
import {
  decide,
  detectStall,
  lockIn,
  resolveWeight,
  roundKg,
  suggestDoubleIncrement,
  suggestRegression,
  suggestedLockInWeight,
  type EngineRoutineExercise,
  type EngineSet,
  type SessionOutcome,
} from './engine';
import { decisionLine, targetLine } from './format';
import type { RoutineExercise } from './types';

const rdl: EngineRoutineExercise = {
  id: 'rx-rdl',
  kind: 'reps',
  mode: 'normal',
  targetSets: 4,
  repMin: 6,
  repMax: 8,
  currentWeight: 110,
  increment: 5,
};

function working(weight: number, reps: number[], rir?: number): EngineSet[] {
  return reps.map((r) => ({ type: 'working', weight, reps: r, rir }));
}

function warmup(weight: number, reps: number): EngineSet {
  return { type: 'warmup', weight, reps };
}

describe('double progression — §4.1 worked example (RDL 4 × 6–8 @ 110, +5)', () => {
  it('runs the five-session table exactly', () => {
    let rx = { ...rdl };

    const s1 = decide(rx, working(110, [6, 6, 6, 5]));
    expect(s1.rule).toBe('hold');
    expect(s1.toWeight).toBe(110);
    rx = { ...rx, currentWeight: resolveWeight(s1) };

    const s2 = decide(rx, working(110, [7, 7, 6, 6]));
    expect(s2.rule).toBe('hold');
    expect(s2.toWeight).toBe(110);
    rx = { ...rx, currentWeight: resolveWeight(s2) };

    const s3 = decide(rx, working(110, [8, 7, 7, 7]));
    expect(s3.rule).toBe('hold');
    expect(s3.toWeight).toBe(110);
    rx = { ...rx, currentWeight: resolveWeight(s3) };

    const s4 = decide(rx, working(110, [8, 8, 8, 8]));
    expect(s4.rule).toBe('increase');
    expect(s4.toWeight).toBe(115);
    expect(s4.changesWeight).toBe(true);
    rx = { ...rx, currentWeight: resolveWeight(s4) };
    expect(rx.currentWeight).toBe(115);

    const s5 = decide(rx, working(115, [6, 6, 6, 6]));
    expect(s5.rule).toBe('hold');
    expect(s5.toWeight).toBe(115);
    expect(s5.changesWeight).toBe(false);
  });

  it('8,8,7,6 holds at 110 (acceptance #3)', () => {
    const d = decide(rdl, working(110, [8, 8, 7, 6]));
    expect(d.rule).toBe('hold');
    expect(d.fromWeight).toBe(110);
    expect(d.toWeight).toBe(110);
  });

  it('reps above repMax still count as hitting it', () => {
    const d = decide(rdl, working(110, [10, 9, 8, 8]));
    expect(d.rule).toBe('increase');
    expect(d.toWeight).toBe(115);
  });

  it('extra sets beyond targetSets all have to hit repMax too', () => {
    expect(decide(rdl, working(110, [8, 8, 8, 8, 8])).rule).toBe('increase');
    expect(decide(rdl, working(110, [8, 8, 8, 8, 7])).rule).toBe('hold');
  });

  it('treats a missing reps value as 0', () => {
    const sets: EngineSet[] = [...working(110, [8, 8, 8]), { type: 'working', weight: 110 }];
    const d = decide(rdl, sets);
    expect(d.rule).toBe('hold');
    expect(d.workingReps).toEqual([8, 8, 8, 0]);
  });
});

describe('warm-ups are ignored entirely', () => {
  it('low-rep warm-ups do not block an increase', () => {
    const sets = [warmup(60, 5), warmup(90, 3), ...working(110, [8, 8, 8, 8])];
    const d = decide(rdl, sets);
    expect(d.rule).toBe('increase');
    expect(d.toWeight).toBe(115);
    expect(d.workingSets).toBe(4);
    expect(d.workingReps).toEqual([8, 8, 8, 8]);
  });

  it('warm-ups do not count towards targetSets', () => {
    const sets = [warmup(60, 8), warmup(90, 8), ...working(110, [8, 8, 8])];
    const d = decide(rdl, sets);
    expect(d.rule).toBe('hold_missing_sets');
    expect(d.toWeight).toBe(110);
  });
});

describe('missing sets → hold', () => {
  it('three perfect sets of four is still a hold', () => {
    const d = decide(rdl, working(110, [8, 8, 8]));
    expect(d.rule).toBe('hold_missing_sets');
    expect(d.toWeight).toBe(110);
    expect(d.workingSets).toBe(3);
    expect(d.targetSets).toBe(4);
  });

  it('no working sets at all is a hold', () => {
    const d = decide(rdl, []);
    expect(d.rule).toBe('hold_missing_sets');
    expect(d.toWeight).toBe(110);
  });
});

describe('calibrating exercises produce no decision', () => {
  it('records but decides nothing, whatever was lifted', () => {
    const squat: EngineRoutineExercise = { ...rdl, id: 'rx-squat', mode: 'calibrating', currentWeight: 0 };
    const sets: EngineSet[] = [
      { type: 'working', weight: 60, reps: 8 },
      { type: 'working', weight: 70, reps: 8 },
      { type: 'working', weight: 80, reps: 8 },
      { type: 'working', weight: 80, reps: 8 },
    ];
    const d = decide(squat, sets);
    expect(d.rule).toBe('calibrating');
    expect(d.toWeight).toBe(0);
    expect(d.changesWeight).toBe(false);
    expect(resolveWeight(d)).toBe(0);
  });

  it('lock-in flips to normal at the chosen weight and progression starts next session', () => {
    const squat: EngineRoutineExercise = { ...rdl, id: 'rx-squat', mode: 'calibrating', currentWeight: 0 };
    const locked = lockIn(squat, 80);
    expect(locked.mode).toBe('normal');
    expect(locked.currentWeight).toBe(80);
    const d = decide(locked, working(80, [8, 8, 8, 8]));
    expect(d.rule).toBe('increase');
    expect(d.toWeight).toBe(85);
  });

  it('suggests the heaviest working-set weight as the lock-in default', () => {
    expect(
      suggestedLockInWeight([warmup(100, 5), { type: 'working', weight: 60, reps: 8 }, { type: 'working', weight: 70, reps: 8 }]),
    ).toBe(70);
    expect(suggestedLockInWeight([warmup(100, 5)])).toBeNull();
  });
});

describe('bodyweight_plus progresses on added kg', () => {
  const backExt: EngineRoutineExercise = {
    id: 'rx-be',
    kind: 'bodyweight_plus',
    mode: 'normal',
    targetSets: 3,
    repMin: 10,
    repMax: 15,
    currentWeight: 0,
    increment: 5,
  };

  it('0 → +5 when 15 is hit on every set', () => {
    const d = decide(backExt, working(0, [15, 15, 15]));
    expect(d.rule).toBe('increase');
    expect(d.fromWeight).toBe(0);
    expect(d.toWeight).toBe(5);
  });

  it('holds at bodyweight otherwise', () => {
    const d = decide(backExt, working(0, [15, 15, 12]));
    expect(d.rule).toBe('hold');
    expect(d.toWeight).toBe(0);
  });

  it('+5 → +10', () => {
    const d = decide({ ...backExt, currentWeight: 5 }, working(5, [15, 15, 15]));
    expect(d.toWeight).toBe(10);
  });
});

describe('carry and timed kinds never produce a weight decision', () => {
  it('carry in normal mode with weights is not applicable', () => {
    const carry: EngineRoutineExercise = { ...rdl, id: 'rx-carry', kind: 'carry', targetSets: 3, currentWeight: 56 };
    const sets: EngineSet[] = [
      { type: 'working', weight: 56, distanceM: 40 },
      { type: 'working', weight: 56, distanceM: 40 },
      { type: 'working', weight: 56, distanceM: 40 },
    ];
    const d = decide(carry, sets);
    expect(d.rule).toBe('not_applicable');
    expect(d.toWeight).toBe(56);
    expect(d.changesWeight).toBe(false);
    expect(resolveWeight(d)).toBe(56);
  });

  it('carry while calibrating is also not applicable', () => {
    const carry: EngineRoutineExercise = { ...rdl, kind: 'carry', mode: 'calibrating', currentWeight: 0 };
    expect(decide(carry, [{ type: 'working', weight: 40, distanceM: 40 }]).rule).toBe('not_applicable');
  });

  it('timed is not applicable', () => {
    const plank: EngineRoutineExercise = { ...rdl, kind: 'timed', currentWeight: 0 };
    expect(decide(plank, [{ type: 'working', weight: 0, seconds: 60 }]).rule).toBe('not_applicable');
  });
});

describe('accept / override', () => {
  it('accept stores the proposed weight', () => {
    const d = decide(rdl, working(110, [8, 8, 8, 8]));
    expect(resolveWeight(d)).toBe(115);
  });

  it('override wins and is stored as-is (acceptance #4)', () => {
    const d = decide(rdl, working(110, [8, 8, 8, 8]));
    expect(resolveWeight(d, 112.5)).toBe(112.5);
    const next = { ...rdl, currentWeight: resolveWeight(d, 112.5) };
    expect(next.currentWeight).toBe(112.5);
    expect(decide(next, working(112.5, [8, 8, 8, 8])).toWeight).toBe(117.5);
  });

  it('override on a hold also wins', () => {
    const d = decide(rdl, working(110, [6, 6, 6, 6]));
    expect(resolveWeight(d, 100)).toBe(100);
  });
});

describe('increment arithmetic', () => {
  it('keeps 2.5-kg steps free of float noise', () => {
    const bench: EngineRoutineExercise = { ...rdl, currentWeight: 62.5, increment: 2.5 };
    expect(decide(bench, working(62.5, [8, 8, 8, 8])).toWeight).toBe(65);
    const db: EngineRoutineExercise = { ...rdl, currentWeight: 1.1, increment: 2.2 };
    expect(decide(db, working(1.1, [8, 8, 8, 8])).toWeight).toBe(3.3);
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
  });
});

describe('deviating from the prescribed weight', () => {
  it('progresses from the weight actually lifted when every working set agrees', () => {
    const d = decide(rdl, working(100, [8, 8, 8, 8]));
    expect(d.rule).toBe('increase');
    expect(d.sessionWeight).toBe(100);
    expect(d.fromWeight).toBe(110);
    expect(d.toWeight).toBe(105);
    expect(d.changesWeight).toBe(true);
  });

  it('a hold at a deviated weight re-prescribes that weight visibly', () => {
    const d = decide(rdl, working(100, [7, 7, 7, 7]));
    expect(d.rule).toBe('hold');
    expect(d.toWeight).toBe(100);
    expect(d.changesWeight).toBe(true);
  });

  it('mixed weights fall back to the prescription', () => {
    const sets: EngineSet[] = [
      { type: 'working', weight: 110, reps: 8 },
      { type: 'working', weight: 110, reps: 8 },
      { type: 'working', weight: 105, reps: 8 },
      { type: 'working', weight: 105, reps: 8 },
    ];
    const d = decide(rdl, sets);
    expect(d.sessionWeight).toBeNull();
    expect(d.rule).toBe('increase');
    expect(d.toWeight).toBe(115);
  });
});

describe('RIR double-increment suggestion (§4.3)', () => {
  it('suggests +2 increments when every set hit repMax at RIR ≥ 3', () => {
    const sets = working(110, [8, 8, 8, 8], 3);
    const d = decide(rdl, sets);
    const s = suggestDoubleIncrement(rdl, d, sets);
    expect(s).toEqual({ kind: 'double_increment', toWeight: 120, minRir: 3 });
  });

  it('does not suggest when any set was RIR < 3 or RIR is missing', () => {
    const sets = working(110, [8, 8, 8, 8], 3);
    sets[2] = { ...sets[2], rir: 2 };
    expect(suggestDoubleIncrement(rdl, decide(rdl, sets), sets)).toBeNull();
    const noRir = working(110, [8, 8, 8, 8], 4);
    delete noRir[0].rir;
    expect(suggestDoubleIncrement(rdl, decide(rdl, noRir), noRir)).toBeNull();
  });

  it('never suggests on a hold', () => {
    const sets = working(110, [8, 8, 8, 7], 5);
    expect(suggestDoubleIncrement(rdl, decide(rdl, sets), sets)).toBeNull();
  });

  it('ignores warm-up RIR', () => {
    const sets = [{ ...warmup(60, 5), rir: 0 }, ...working(110, [8, 8, 8, 8], 4)];
    expect(suggestDoubleIncrement(rdl, decide(rdl, sets), sets)?.kind).toBe('double_increment');
  });
});

describe('regression suggestion (§4.3)', () => {
  it('2+ sets below repMin in two consecutive sessions → hold or drop one increment', () => {
    const prev = working(110, [5, 5, 6, 6]);
    const now = working(110, [5, 4, 6, 6]);
    const s = suggestRegression(rdl, now, prev);
    expect(s).toEqual({ kind: 'regression', holdWeight: 110, dropWeight: 105, setsBelowMin: 2 });
  });

  it('needs two consecutive sessions', () => {
    expect(suggestRegression(rdl, working(110, [5, 5, 5, 5]), working(110, [6, 6, 6, 5]))).toBeNull();
    expect(suggestRegression(rdl, working(110, [5, 5, 5, 5]), null)).toBeNull();
  });

  it('only one set below repMin is not a regression', () => {
    expect(suggestRegression(rdl, working(110, [5, 6, 6, 6]), working(110, [5, 6, 6, 6]))).toBeNull();
  });

  it('never flags reps at repMin after an increase', () => {
    expect(suggestRegression({ ...rdl, currentWeight: 115 }, working(115, [6, 6, 6, 6]), working(110, [8, 8, 8, 8]))).toBeNull();
  });

  it('ignores calibrating and carry', () => {
    const bad = working(110, [3, 3, 3, 3]);
    expect(suggestRegression({ ...rdl, mode: 'calibrating' }, bad, bad)).toBeNull();
    expect(suggestRegression({ ...rdl, kind: 'carry' }, bad, bad)).toBeNull();
  });

  it('drop never goes below zero', () => {
    const be: EngineRoutineExercise = { ...rdl, kind: 'bodyweight_plus', currentWeight: 0, repMin: 10, repMax: 15 };
    const bad = working(0, [8, 8, 8, 8]);
    expect(suggestRegression(be, bad, bad)?.kind).toBe('regression');
    expect((suggestRegression(be, bad, bad) as { dropWeight: number }).dropWeight).toBe(0);
  });
});

describe('stall detection (§4.3)', () => {
  const hold = (w: number): SessionOutcome => ({ fromWeight: w, appliedWeight: w, rule: 'hold' });
  const up = (from: number, to: number): SessionOutcome => ({ fromWeight: from, appliedWeight: to, rule: 'increase' });

  it('three consecutive sessions at the same weight with no progression → stalled', () => {
    expect(detectStall([hold(110), hold(110), hold(110)])).toEqual({ kind: 'stalled', sessions: 3, weight: 110 });
  });

  it('not sooner than three', () => {
    expect(detectStall([hold(110), hold(110)])).toBeNull();
    expect(detectStall([hold(110), hold(110), up(105, 110)])).toBeNull();
  });

  it('an increase within the window clears it', () => {
    expect(detectStall([hold(115), up(110, 115), hold(110), hold(110)])).toBeNull();
  });

  it('counts how long the stall has lasted', () => {
    expect(detectStall([hold(110), hold(110), hold(110), hold(110), up(105, 110)])).toMatchObject({ kind: 'stalled', sessions: 4 });
  });

  it('ignores calibrating / not-applicable / lock-in outcomes', () => {
    const cal: SessionOutcome = { fromWeight: 0, appliedWeight: 0, rule: 'calibrating' };
    expect(detectStall([hold(110), cal, hold(110), hold(110)])?.kind).toBe('stalled');
    expect(detectStall([cal, cal, cal])).toBeNull();
  });

  it('an override to a different weight breaks the stall', () => {
    const overridden: SessionOutcome = { fromWeight: 110, appliedWeight: 100, rule: 'hold' };
    expect(detectStall([overridden, hold(110), hold(110)])).toBeNull();
  });

  it('missing-set holds count as no progression', () => {
    const miss: SessionOutcome = { fromWeight: 110, appliedWeight: 110, rule: 'hold_missing_sets' };
    expect(detectStall([miss, hold(110), miss])?.kind).toBe('stalled');
  });
});

describe('plain-terms decision lines', () => {
  it('increase', () => {
    expect(decisionLine(decide(rdl, working(110, [8, 8, 8, 8])), 'reps')).toBe('8/8/8/8 at 110 kg → 115 kg next time');
  });
  it('hold', () => {
    expect(decisionLine(decide(rdl, working(110, [8, 8, 7, 6])), 'reps')).toBe('8/8/7/6 at 110 kg → hold 110 kg');
  });
  it('missing sets', () => {
    expect(decisionLine(decide(rdl, working(110, [8, 8, 8])), 'reps')).toBe('3/4 sets (8/8/8) at 110 kg → hold 110 kg');
  });
  it('bodyweight plus', () => {
    const be: EngineRoutineExercise = { ...rdl, kind: 'bodyweight_plus', currentWeight: 0, targetSets: 3, repMin: 10, repMax: 15 };
    expect(decisionLine(decide(be, working(0, [15, 15, 15])), 'bodyweight_plus')).toBe('15/15/15 at bodyweight → +5 kg next time');
  });
  it('deviated hold shows both weights', () => {
    expect(decisionLine(decide(rdl, working(100, [7, 7, 7, 7])), 'reps')).toBe('7/7/7/7 at 100 kg → hold 100 kg (was 110 kg)');
  });
});

describe('target lines', () => {
  const base: RoutineExercise = {
    id: 'rx',
    routineId: 'r',
    exerciseId: 'e',
    order: 0,
    targetSets: 4,
    repMin: 6,
    repMax: 8,
    currentWeight: 110,
    increment: 5,
    mode: 'normal',
    optional: false,
  };
  it('normal', () => expect(targetLine(base, 'reps')).toBe('4 × 6–8 @ 110 kg'));
  it('calibrating', () => expect(targetLine({ ...base, mode: 'calibrating' }, 'reps')).toBe('4 × 6–8 · calibrating'));
  it('set range', () => expect(targetLine({ ...base, targetSets: 3, targetSetsMax: 4 }, 'reps')).toBe('3–4 × 6–8 @ 110 kg'));
  it('single rep target', () => expect(targetLine({ ...base, repMin: 15, repMax: 15 }, 'reps')).toBe('4 × 15 @ 110 kg'));
  it('bodyweight plus at 0', () => expect(targetLine({ ...base, currentWeight: 0 }, 'bodyweight_plus')).toBe('4 × 6–8 @ bodyweight'));
  it('carry', () =>
    expect(
      targetLine({ ...base, targetSets: 3, targetSetsMax: 4, mode: 'calibrating', distanceMinM: 30, distanceMaxM: 40 }, 'carry'),
    ).toBe('3–4 walks · 30–40 m · calibrating'));
});
