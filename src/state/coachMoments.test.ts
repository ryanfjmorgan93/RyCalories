import { beforeEach, describe, expect, it } from 'vitest';
import { factsText, hashFacts } from '../ai/moments';
import type { SetLog } from '../domain/types';
import { setMomentFacts, useCoachMoments } from './coachMoments';

const set = (over: Partial<SetLog>): SetLog => ({
  id: 's',
  sessionId: 'sess',
  routineExerciseId: 'rx',
  exerciseId: 'ex',
  index: 0,
  type: 'working',
  weight: 100,
  reps: 8,
  completedAt: '2026-10-12T10:00:00.000Z',
  ...over,
});

describe('setMomentFacts', () => {
  it('describes a lift: the set, which one of how many, the range, last time and nothing about effort yet', () => {
    const facts = setMomentFacts({
      exercise: { name: 'Bench Press (Barbell)', kind: 'reps' },
      set: set({ weight: 65, reps: 8 }),
      setNumber: 2,
      of: 4,
      repMin: 6,
      repMax: 8,
      previous: [set({ weight: 65, reps: 8 }), set({ weight: 65, reps: 7 }), set({ weight: 65, reps: 6 })],
    });
    expect(facts).toEqual({
      exercise: 'Bench Press (Barbell)',
      set: '65 × 8',
      setNumber: 2,
      of: 4,
      weight: '65 kg',
      reps: 8,
      repRange: '6–8',
      lastTime: '65 × 8, 7, 6',
      effort: null,
    });
  });

  it('carries the effort the exercise already has, as the word the owner sees', () => {
    const base = { exercise: { name: 'Row', kind: 'reps' as const }, set: set({}), setNumber: 3, of: 3 };
    expect(setMomentFacts({ ...base, effortRir: 3 }).effort).toBe('Easy');
    expect(setMomentFacts({ ...base, effortRir: 2 }).effort).toBe('Good');
    expect(setMomentFacts({ ...base, effortRir: 0 }).effort).toBe('Hard');
    expect(setMomentFacts({ ...base, effortRir: null }).effort).toBeNull();
  });

  it('says bodyweight for an unweighted bodyweight exercise, and an added weight otherwise', () => {
    const base = { exercise: { name: 'Pull-up', kind: 'bodyweight_plus' as const }, setNumber: 1, of: 3 };
    expect(setMomentFacts({ ...base, set: set({ weight: 0, reps: 6 }) }).weight).toBe('bodyweight');
    expect(setMomentFacts({ ...base, set: set({ weight: 10, reps: 6 }) }).weight).toBe('+10 kg');
  });

  it('has no weight or reps for a timed set, and no range, count or last time for an extra exercise', () => {
    const facts = setMomentFacts({ exercise: { name: 'Plank', kind: 'timed' }, set: set({ weight: 0, reps: undefined, seconds: 45 }), setNumber: 1 });
    expect(facts.weight).toBeNull();
    expect(facts.reps).toBeNull();
    expect(facts.of).toBeNull();
    expect(facts.repRange).toBeNull();
    expect(facts.lastTime).toBeNull();
    expect(facts.set).toBe('45 s');
  });

  it('gives the same facts the same hash, so one line is asked for once, and different sets different ones', () => {
    const one = setMomentFacts({ exercise: { name: 'Squat', kind: 'reps' }, set: set({ weight: 100, reps: 5 }), setNumber: 1, of: 3 });
    const again = setMomentFacts({ exercise: { name: 'Squat', kind: 'reps' }, set: set({ weight: 100, reps: 5 }), setNumber: 1, of: 3 });
    const next = setMomentFacts({ exercise: { name: 'Squat', kind: 'reps' }, set: set({ weight: 100, reps: 5 }), setNumber: 2, of: 3 });
    expect(hashFacts(one)).toBe(hashFacts(again));
    expect(hashFacts(one)).not.toBe(hashFacts(next));
    // What the prompt shows: empty facts are left out.
    expect(factsText(one)).toContain('- exercise: Squat');
    expect(factsText(one)).not.toContain('lastTime');
  });
});

describe('the latest set', () => {
  beforeEach(() => useCoachMoments.getState().clear());

  it('keeps the newest set and when it was logged, and clears', () => {
    expect(useCoachMoments.getState().lastSet).toBeNull();
    const before = Date.now();
    useCoachMoments.getState().noteSet(setMomentFacts({ exercise: { name: 'Squat', kind: 'reps' }, set: set({}), setNumber: 1, of: 3 }));
    const first = useCoachMoments.getState().lastSet!;
    expect(first.at).toBeGreaterThanOrEqual(before);
    expect(first.facts.exercise).toBe('Squat');
    useCoachMoments.getState().noteSet(setMomentFacts({ exercise: { name: 'Squat', kind: 'reps' }, set: set({}), setNumber: 2, of: 3 }));
    expect(useCoachMoments.getState().lastSet!.facts.setNumber).toBe(2);
    useCoachMoments.getState().clear();
    expect(useCoachMoments.getState().lastSet).toBeNull();
  });
});
