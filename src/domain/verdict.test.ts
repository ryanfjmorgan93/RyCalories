import { describe, expect, it } from 'vitest';
import { decide, type EngineRoutineExercise, type EngineSet } from './engine';
import { liveVerdict } from './verdict';

const rx: EngineRoutineExercise = {
  id: 'rx1',
  kind: 'reps',
  mode: 'normal',
  targetSets: 4,
  repMin: 6,
  repMax: 8,
  currentWeight: 110,
  increment: 5,
};

const s = (weight: number, reps: number, type: EngineSet['type'] = 'working'): EngineSet => ({ type, weight, reps });

describe('liveVerdict — target met', () => {
  it('every counted set at repMax, target exactly met → the ok increase line', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 8)]);
    expect(v.decision.rule).toBe('increase');
    expect(v.line).toBe('→ 115 kg next time');
    expect(v.tone).toBe('ok');
    expect(v.repsToGoUp).toBe(8);
  });

  it('extra sets beyond target, all still at repMax → still the ok increase line', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 8), s(110, 8)]);
    expect(v.decision.rule).toBe('increase');
    expect(v.line).toBe('→ 115 kg next time');
    expect(v.tone).toBe('ok');
  });

  it('an extra 5th set that misses repMax flips an already-earned increase to a hold — never stuck showing the old verdict', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 8), s(110, 5)]);
    expect(v.decision.rule).toBe('hold');
    expect(v.line).toBe('Holding 110 kg');
    expect(v.tone).toBe('muted');
    expect(v.repsToGoUp).toBeNull();
  });
});

describe('liveVerdict — short of target, still live', () => {
  it('2 of 4 counted sets logged, both at repMax → the accent preview, but the real decision is still hold_missing_sets (never promises early)', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8)]);
    expect(v.decision.rule).toBe('hold_missing_sets'); // flattering-number trap: never 'increase' before targetSets is met
    expect(v.line).toBe('2 more at 8 → 115 kg');
    expect(v.tone).toBe('accent');
    expect(v.repsToGoUp).toBe(8);
  });

  it('zero counted sets logged yet → previews the full target', () => {
    const v = liveVerdict(rx, []);
    expect(v.decision.rule).toBe('hold_missing_sets');
    expect(v.line).toBe('4 more at 8 → 115 kg');
    expect(v.tone).toBe('accent');
  });

  it('3 of 4 logged, all at repMax → "1 more"', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8)]);
    expect(v.line).toBe('1 more at 8 → 115 kg');
    expect(v.tone).toBe('accent');
  });
});

describe('liveVerdict — a counted set below repMax', () => {
  it('the first of several sets misses repMax → muted "Holding", regardless of what follows', () => {
    const v = liveVerdict(rx, [s(110, 6), s(110, 8), s(110, 8)]);
    expect(v.decision.rule).toBe('hold_missing_sets');
    expect(v.line).toBe('Holding 110 kg');
    expect(v.tone).toBe('muted');
    expect(v.repsToGoUp).toBeNull();
  });

  it('a full set of target-count sets with the last one short → muted "Holding", never the increase line', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 7)]);
    expect(v.decision.rule).toBe('hold');
    expect(v.line).toBe('Holding 110 kg');
    expect(v.tone).toBe('muted');
  });

  it('a failure set below repMax counts as a miss too (failure counts for progression)', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 5, 'failure')]);
    expect(v.decision.rule).toBe('hold');
    expect(v.line).toBe('Holding 110 kg');
    expect(v.tone).toBe('muted');
  });
});

describe('liveVerdict — flattering-number traps', () => {
  it('calibrating: no line, even when every logged set is at repMax and target is met', () => {
    const calibrating: EngineRoutineExercise = { ...rx, mode: 'calibrating' };
    const v = liveVerdict(calibrating, [s(110, 8), s(110, 8), s(110, 8), s(110, 8)]);
    expect(v.decision.rule).toBe('calibrating');
    expect(v.line).toBeNull();
    expect(v.tone).toBeNull();
    expect(v.repsToGoUp).toBeNull();
  });

  it('not a weight-producing exercise (carry): no line, target met at top reps', () => {
    const carry: EngineRoutineExercise = { ...rx, kind: 'carry' };
    const v = liveVerdict(carry, [s(30, 8), s(30, 8), s(30, 8), s(30, 8)]);
    expect(v.decision.rule).toBe('not_applicable');
    expect(v.line).toBeNull();
  });

  it('not a weight-producing exercise (timed): no line', () => {
    const timed: EngineRoutineExercise = { ...rx, kind: 'timed' };
    const v = liveVerdict(timed, [s(0, 45), s(0, 45), s(0, 45), s(0, 45)]);
    expect(v.decision.rule).toBe('not_applicable');
    expect(v.line).toBeNull();
  });

  it('a deload session: no increase line even with every set at repMax and target met', () => {
    const v = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 8)], { deload: true });
    expect(v.decision.rule).toBe('deload');
    expect(v.line).toBeNull();
    expect(v.tone).toBeNull();
    expect(v.repsToGoUp).toBeNull();
  });

  it('sets logged at a consistent weight below the prescription progress from THAT weight, not from currentWeight — the verdict must not overstate it as 115', () => {
    // Every working set agrees on 100 kg (not the prescribed 110), all at repMax, target met.
    const v = liveVerdict(rx, [s(100, 8), s(100, 8), s(100, 8), s(100, 8)]);
    expect(v.decision.sessionWeight).toBe(100);
    expect(v.decision.rule).toBe('increase');
    expect(v.line).toBe('→ 105 kg next time'); // 100 + increment(5), never 115
  });

  it('sets logged at inconsistent weights progress from rx.currentWeight (decide()\'s real base), never from the last weight lifted', () => {
    // Two different weights among the counted sets → sessionWeight is null inside decide(), so
    // baseWeight falls back to rx.currentWeight (110), not the last set's weight (105).
    const v = liveVerdict(rx, [s(100, 8), s(100, 8), s(105, 8), s(105, 8)]);
    expect(v.decision.sessionWeight).toBeNull();
    expect(v.decision.rule).toBe('increase');
    expect(v.line).toBe('→ 115 kg next time'); // 110 + increment(5) — from currentWeight, not 110 (105+5)
    // Cross-check directly against decide() itself, so this can never silently drift from the engine.
    const direct = decide(rx, [s(100, 8), s(100, 8), s(105, 8), s(105, 8)]);
    expect(v.decision).toEqual(direct);
  });

  it('warm-up and drop sets are ignored entirely, never dragging the verdict down or inflating the count', () => {
    // One dreadful warm-up set plus a full target of good working sets → still earns the increase.
    const v = liveVerdict(rx, [s(20, 1, 'warmup'), s(110, 8), s(110, 8), s(110, 8), s(110, 8)]);
    expect(v.decision.workingSets).toBe(4);
    expect(v.decision.rule).toBe('increase');
    expect(v.line).toBe('→ 115 kg next time');

    // A drop set after a full target of good sets doesn't count as a 5th working set either.
    const v2 = liveVerdict(rx, [s(110, 8), s(110, 8), s(110, 8), s(110, 8), s(50, 20, 'drop')]);
    expect(v2.decision.workingSets).toBe(4);
    expect(v2.decision.rule).toBe('increase');
  });
});

describe('liveVerdict — bodyweight_plus formatting', () => {
  const bw: EngineRoutineExercise = { id: 'rx2', kind: 'bodyweight_plus', mode: 'normal', targetSets: 3, repMin: 10, repMax: 12, currentWeight: 5, increment: 5 };

  it('the increase line uses the "+N kg" style', () => {
    const v = liveVerdict(bw, [s(5, 12), s(5, 12), s(5, 12)]);
    expect(v.line).toBe('→ +10 kg next time');
  });

  it('"Holding bodyweight" at 0 kg added', () => {
    const v = liveVerdict(bw, [s(0, 8)]);
    expect(v.line).toBe('Holding bodyweight');
  });
});
