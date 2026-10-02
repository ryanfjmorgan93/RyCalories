import { describe, expect, it } from 'vitest';
import { cand, miniInput, seededInput } from '../test/routineFixtures';
import { SHUFFLE_TRIES, builtTurn, describeRead, readUsable, requestUsable, reshuffle } from './coachBuild';
import { MACRO_MUSCLES, parseQuickRequest } from './quickRequest';
import { buildRoutines, routineRequestFrom, routineToText, type BuiltRoutine, type RoutineRequest } from './routineBuilder';

/** A routine of `n` rows, for the lines that only count them. */
function routine(name: string, n: number): BuiltRoutine {
  return {
    name,
    rows: Array.from({ length: n }, (_, i) => ({
      id: `${name}-${i}`,
      name: `Exercise ${i}`,
      sets: 3,
      repMin: 8,
      repMax: 12,
      weightKg: null,
      origin: 'own' as const,
      muscleGroup: 'chest' as const,
      pattern: 'chest',
      region: null,
      tier: 'isolation' as const,
      reason: 'chest',
    })),
    reasonLines: [],
    estimateMinutes: 10 * n,
    focus: [],
    unmet: [],
  };
}

describe('readUsable: whether the rules read anything a routine can be built to', () => {
  it.each([
    ['nothing', {}, undefined, false],
    ['effort alone: the builder has no light routine', { effort: 'light' as const }, undefined, false],
    ['an empty list of muscles', { focus: [] }, undefined, false],
    ['a muscle', { focus: ['chest' as const] }, undefined, true],
    ['a split', {}, 'ppl' as const, true],
    ['a count', { count: 5 }, undefined, true],
    ['a length', { minutes: 45 }, undefined, true],
    ['equipment', { equipment: ['dumbbell' as const] }, undefined, true],
    ['a muscle ruled out', { exclude: ['quads' as const] }, undefined, true],
  ])('%s', (_name, options, split, expected) => {
    expect(readUsable(options, split)).toBe(expected);
  });

  it('agrees with the request the typed words make', () => {
    for (const [text, usable] of [
      ['give me a routine', false],
      ['give me a routine that makes me look like thor', false],
      ['give me a routine for 3d shoulders', true],
      ['give me a ppl routine', true],
      ['give me a 45 minute routine', true],
      ['give me a routine with dumbbells only', true],
      ['give me a routine, no legs', true],
    ] as const) {
      const parsed = parseQuickRequest(text);
      expect(requestUsable(routineRequestFrom(parsed)), text).toBe(usable);
      expect(readUsable(parsed.options, parsed.split), text).toBe(usable);
    }
  });
});

describe('describeRead: what was read and what was built', () => {
  it('names the muscles and counts what the routine holds, not what was asked for', () => {
    const request: RoutineRequest = { focus: ['shoulders', 'rear delts'] };
    expect(describeRead(request, [routine('Shoulders and rear delts', 6)])).toBe('shoulders, rear delts · 6 exercises');
    expect(describeRead({ focus: ['chest'], count: 8 }, [routine('Chest', 5)])).toBe('chest · 5 exercises');
    expect(describeRead({ focus: ['chest'] }, [routine('Chest', 1)])).toBe('chest · 1 exercise');
    expect(describeRead({ focus: ['chest'] }, [routine('Chest', 0)])).toBe('chest · 0 exercises');
  });

  it('reads a named group of muscles by its name, not as a list of nine', () => {
    expect(describeRead({ focus: MACRO_MUSCLES.push }, [routine('Push', 6)])).toBe('push · 6 exercises');
    expect(describeRead({ focus: MACRO_MUSCLES.upper }, [routine('Upper', 7)])).toBe('upper · 7 exercises');
  });

  it('names the days of a split and counts every exercise in them', () => {
    const days = [routine('Push', 5), routine('Pull', 5), routine('Legs', 4)];
    expect(describeRead({ focus: [], split: 'ppl' }, days)).toBe('push, pull, legs · 3 routines · 14 exercises');
    expect(describeRead({ focus: [], split: 'full-body' }, [routine('Full body', 6)])).toBe('full body · 6 exercises');
  });

  it('says what else was read: a muscle ruled out, equipment, a length', () => {
    expect(describeRead({ focus: ['chest'], exclude: ['triceps'] }, [routine('Chest', 4)])).toBe('chest · 4 exercises · no triceps');
    expect(describeRead({ focus: ['chest'], equipment: ['dumbbell', 'cable'] }, [routine('Chest', 4)])).toBe('chest · 4 exercises · dumbbell, cable');
    expect(describeRead({ focus: ['chest'], minutes: 45 }, [routine('Chest', 4)])).toBe('chest · 4 exercises · 45 min');
  });

  it('"no barbell" names the one kind left out, not the six that are left', () => {
    const allButBarbell = ['dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'other'] as const;
    expect(describeRead({ focus: ['chest'], equipment: [...allButBarbell] }, [routine('Chest', 4)])).toBe('chest · 4 exercises · no barbell');
  });

  it('a count or a length alone is a routine by need, and says so', () => {
    expect(describeRead({ focus: [], count: 5 }, [routine('Full body', 5)])).toBe('full body by need · 5 exercises');
    expect(describeRead({ focus: [], minutes: 30 }, [routine('Full body', 4)])).toBe('full body by need · 4 exercises · 30 min');
  });

  it('a request with nothing in it says nothing specific was read', () => {
    expect(describeRead({ focus: [] }, [routine('Full body', 6)])).toBe('nothing specific · full body by need');
  });

  it('is the line for what the real builder made from the owner\'s own words', () => {
    const input = seededInput();
    const text = 'Give me a routine solely designed to build 3D shoulders';
    const request = routineRequestFrom(parseQuickRequest(text));
    expect(describeRead(request, buildRoutines(input, request, 3))).toBe('shoulders, rear delts · 6 exercises');
  });
});

describe('builtTurn', () => {
  it('stands a built routine in the conversation as one short line naming it', () => {
    expect(builtTurn([routine('Shoulders and rear delts', 6)])).toBe('Routine built: Shoulders and rear delts');
    expect(builtTurn([routine('Push', 5), routine('Pull', 5)])).toBe('Routine built: Push, Pull');
  });
});

describe('reshuffle: a new seed that gives another routine', () => {
  const POOL = [
    cand('Bench Press (Barbell)', 'chest', { compound: true, weight: 60, equipment: 'barbell' }),
    cand('Incline DB Press', 'chest', { compound: true, weight: 20 }),
    cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
    cand('Pec Deck', 'chest', { equipment: 'machine', weight: 40 }),
    cand('Decline Press (Machine)', 'chest', { equipment: 'machine', compound: true, weight: 30 }),
    cand('Push Up', 'chest', { equipment: 'bodyweight' }),
  ];

  it('draws one seed when the first already gives another routine', () => {
    const input = miniInput(POOL);
    const request: RoutineRequest = { focus: ['chest'], count: 3 };
    const current = buildRoutines(input, request, 1);
    let drawn = 0;
    // Find a seed that does not give the current routine, and hand reshuffle exactly that one.
    let other = 2;
    while (routineToText(buildRoutines(input, request, other)) === routineToText(current)) other++;
    const { routines, seed } = reshuffle(input, request, current, () => (drawn++, other));
    expect(drawn).toBe(1);
    expect(seed).toBe(other);
    expect(routineToText(routines)).not.toBe(routineToText(current));
  });

  it('skips a seed that gives back what is on screen, and takes the next', () => {
    const input = miniInput(POOL);
    const request: RoutineRequest = { focus: ['chest'], count: 3 };
    const current = buildRoutines(input, request, 1);
    let other = 2;
    while (routineToText(buildRoutines(input, request, other)) === routineToText(current)) other++;
    const seeds = [1, 1, other];
    const { routines, seed } = reshuffle(input, request, current, () => seeds.shift()!);
    expect(seeds).toEqual([]);
    expect(seed).toBe(other);
    expect(routineToText(routines)).not.toBe(routineToText(current));
  });

  it('gives up after SHUFFLE_TRIES where only one routine can be built, and shows it', () => {
    const only = miniInput([cand('Bench Press (Barbell)', 'chest', { compound: true, weight: 60, equipment: 'barbell' })]);
    const request: RoutineRequest = { focus: ['chest'] };
    const current = buildRoutines(only, request, 1);
    let drawn = 0;
    const { routines, seed } = reshuffle(only, request, current, () => ++drawn);
    expect(drawn).toBe(SHUFFLE_TRIES);
    expect(seed).toBe(SHUFFLE_TRIES);
    expect(routineToText(routines)).toBe(routineToText(current));
  });

  it('is the builder for the seed it reports', () => {
    const input = miniInput(POOL);
    const request: RoutineRequest = { focus: ['chest'], count: 3 };
    const current = buildRoutines(input, request, 1);
    const { routines, seed } = reshuffle(input, request, current, () => 5);
    expect(routines).toEqual(buildRoutines(input, request, seed));
  });
});
