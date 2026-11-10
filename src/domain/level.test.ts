import { describe, expect, it } from 'vitest';
import { levelFor, levelText, levelUp } from './level';
import type { RecordSession, RecordSet } from './records';

let day = 0;
/** One session per call, each a day after the last, of working sets given as [kg, reps]. */
const session = (...sets: [number, number][]): RecordSession => ({
  sessionId: `s${++day}`,
  startedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  sets: sets.map(([weight, reps]): RecordSet => ({ type: 'working', weight, reps })),
});

describe('a Level: the best set against the start', () => {
  it('has none for a carry, a hold, no counted set or a bodyweight lift with no weigh-in', () => {
    const three = [session([10, 12]), session([10, 12]), session([10, 12])];
    expect(levelFor('carry', three)).toBeNull();
    expect(levelFor('timed', three)).toBeNull();
    expect(levelFor('reps', [])).toBeNull();
    expect(levelFor('bodyweight_plus', three)).toBeNull();
    // A warm-up is not a set here, and nor is one with no weight on a lift that takes weight.
    expect(levelFor('reps', [{ ...session(), sets: [{ type: 'warmup', weight: 40, reps: 10 }] }])).toBeNull();
    expect(levelFor('reps', [session([0, 20])])).toBeNull();
  });

  it('is Level 1 with nothing to chase until three sessions have set the start', () => {
    const l = levelFor('reps', [session([10, 12]), session([10, 13])])!;
    expect(l).toMatchObject({ level: 1, gainPct: 0, fill: 0, startIn: 1, best: { weight: 10, reps: 13 } });
    expect(levelText(l, 'reps')).toEqual({ head: 'Level 1', detail: 'your first 3 sessions set the start (2 done)', next: null });
    // A session with no counted set is not one of the three.
    expect(levelFor('reps', [session([10, 12]), session([10, 13]), session()])!.startIn).toBe(1);
  });

  it('starts from the best of the first three, so a light first day buys nothing', () => {
    const l = levelFor('reps', [session([5, 10]), session([10, 12]), session([10, 12]), session([10, 13])])!;
    // 10 × 13 against 10 × 12: (1 + 13/30) ÷ (1 + 12/30) is 2.38% over, not the 115% a 5 kg start would give.
    expect(l).toMatchObject({ level: 1, gainPct: 2, startIn: 0, start: { weight: 10, reps: 12 }, best: { weight: 10, reps: 13 } });
    expect(l.fill).toBeCloseTo(2.381 / 5, 3);
    expect(levelText(l, 'reps')).toEqual({ head: 'Level 1', detail: 'best 10 kg × 13, 2% over your start of 10 kg × 12', next: 'Level 2 at 5%' });
  });

  it('says only the start while nothing has beaten it', () => {
    const l = levelFor('reps', [session([10, 12]), session([10, 12]), session([9, 12]), session([10, 12])])!;
    expect(l).toMatchObject({ level: 1, gainPct: 0, fill: 0 });
    expect(levelText(l, 'reps')).toEqual({ head: 'Level 1', detail: 'start 10 kg × 12', next: 'Level 2 at 5%' });
  });

  it('does not take a later set of the same size for a new best', () => {
    // 20 × 10 and 25 × 2 are both 26.67, and differ only in the last float digit.
    const l = levelFor('reps', [session([20, 10]), session([15, 10]), session([15, 10]), session([25, 2])])!;
    expect(l.best).toEqual({ weight: 20, reps: 10 });
    expect(levelText(l, 'reps').detail).toBe('start 20 kg × 10');
  });

  it('rounds down: 5% over is Level 2, a hair under is not', () => {
    const start = [session([100, 6]), session([100, 6]), session([100, 6])];
    const under = levelFor('reps', [...start, session([104.5, 6])])!;
    expect(under).toMatchObject({ level: 1, gainPct: 4 });
    expect(under.fill).toBeCloseTo(0.9, 6);
    expect(under.fill).toBeLessThan(1);
    const on = levelFor('reps', [...start, session([105, 6])])!;
    expect(on).toMatchObject({ level: 2, gainPct: 5, fill: 0 });
    expect(levelText(on, 'reps').next).toBe('Level 3 at 10%');
    // Several at once: 100 × 6 to 120 × 6 is 20% over.
    expect(levelFor('reps', [...start, session([120, 6])])!).toMatchObject({ level: 5, gainPct: 20 });
  });

  it('counts reps past 12, where an e1RM is refused', () => {
    const l = levelFor('reps', [session([10, 12]), session([10, 12]), session([10, 12]), session([10, 15])])!;
    // 1.5 ÷ 1.4 is 7.14% over.
    expect(l).toMatchObject({ level: 2, gainPct: 7 });
    expect(levelText(l, 'reps').detail).toBe('best 10 kg × 15, 7% over your start of 10 kg × 12');
  });

  it('never lets a later session move the start, and takes sessions in any order', () => {
    const [a, b, c, d, e] = [session([60, 8]), session([62.5, 8]), session([60, 8]), session([80, 8]), session([70, 8])];
    const l = levelFor('reps', [e, d, c, b, a])!;
    expect(l.start).toEqual({ weight: 62.5, reps: 8 });
    expect(l.best).toEqual({ weight: 80, reps: 8 });
    expect(l.gainPct).toBe(28);
  });

  it('adds bodyweight to a bodyweight lift', () => {
    const start = [session([0, 10]), session([0, 10]), session([0, 10])];
    // 80 × (1 + 15/30) against 80 × (1 + 10/30): 12.5% over.
    expect(levelFor('bodyweight_plus', [...start, session([0, 15])], { bodyweightKg: 80 })!).toMatchObject({ level: 3, gainPct: 12 });
    // Ten more kilos for the same ten reps is 90 against 80: 12.5% as well.
    expect(levelFor('bodyweight_plus', [...start, session([10, 10])], { bodyweightKg: 80 })!).toMatchObject({ level: 3, gainPct: 12 });
  });
});

describe('a level-up', () => {
  const start = [session([100, 6]), session([100, 6]), session([100, 6])];
  it('is the levels crossed, and nothing while the start is being set', () => {
    expect(levelUp(null, levelFor('reps', [start[0]!]))).toBeNull();
    expect(levelUp(levelFor('reps', start.slice(0, 2)), levelFor('reps', start))).toBeNull();
    expect(levelUp(levelFor('reps', start), levelFor('reps', [...start, session([104, 6])]))).toBeNull();
    expect(levelUp(levelFor('reps', start), levelFor('reps', [...start, session([111, 6])]))).toEqual({ from: 1, to: 3 });
    expect(levelUp(levelFor('reps', start), null)).toBeNull();
  });
});

describe('the words for a bodyweight lift', () => {
  it('names the added weight, or bodyweight', () => {
    const l = levelFor('bodyweight_plus', [session([0, 10]), session([0, 10]), session([0, 10]), session([10, 10])], { bodyweightKg: 80 })!;
    expect(levelText(l, 'bodyweight_plus').detail).toBe('best +10 kg × 10, 12% over your start of bodyweight × 10');
  });
});
