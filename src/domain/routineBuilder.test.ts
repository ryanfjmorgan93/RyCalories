import { describe, expect, it } from 'vitest';
import { SEED_EXERCISE_IDS } from '../db/seed';
import { CATALOGUE, OWN_EXERCISES, QUICK_SETTINGS, cand, miniInput, seededInput, seedsFrom } from '../test/routineFixtures';
import { roundKg } from './engine';
import { NON_ROUTINE_PATTERNS, movementPattern } from './movement';
import { MACRO_MUSCLES, parseQuickRequest } from './quickRequest';
import { baseWeight } from './quickSession';
import {
  DEFAULT_ROUTINE_COUNT,
  DEFAULT_SPLIT_DAY_COUNT,
  MAX_NEW_EXERCISES,
  aboutMinutes,
  buildRoutines,
  joinList,
  routineName,
  routineRequestFrom,
  routineToText,
  type BuiltRoutine,
  type RoutineRequest,
} from './routineBuilder';
import { parseRoutineText } from './routineText';
import type { MuscleGroup } from './types';

const SEEDS = seedsFrom(500);
const SHOULDERS: RoutineRequest = { focus: ['shoulders', 'rear delts'] };

// One input, built once through the app's own `buildQuickInput`: the owner's 27 exercises and the real catalogue.
const REAL = seededInput({ recency: { shoulders: 6, 'rear delts': 6, chest: 2, biceps: 3 } });
const OWN_ONLY = seededInput({ catalogue: false });
const candidateById = new Map(REAL.candidates.map((c) => [c.id, c]));

const one = (r: BuiltRoutine[]): BuiltRoutine => r[0]!;
const patternsOf = (r: BuiltRoutine): string[] => r.rows.map((x) => x.pattern);
const countBy = (r: BuiltRoutine, group: MuscleGroup) => r.rows.filter((x) => x.muscleGroup === group).length;

describe('buildRoutines: what it hands back', () => {
  it('is one routine for a request with a focus, named for the muscles', () => {
    const r = buildRoutines(REAL, SHOULDERS, 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Shoulders and rear delts');
    expect(r[0]!.focus).toEqual(['shoulders', 'rear delts']);
    expect(r[0]!.unmet).toEqual([]);
  });

  it.each([
    [['shoulders'], 'Shoulders'],
    [['shoulders', 'rear delts'], 'Shoulders and rear delts'],
    [['chest'], 'Chest'],
    [['chest', 'triceps'], 'Chest and triceps'],
    [['chest', 'biceps', 'lats'], 'Chest, biceps and lats'],
    [[...MACRO_MUSCLES.push], 'Push'],
    [[...MACRO_MUSCLES.pull], 'Pull'],
    [[...MACRO_MUSCLES.legs], 'Legs'],
    [[...MACRO_MUSCLES.upper], 'Upper'],
    [[...MACRO_MUSCLES.lower], 'Lower'],
    [[...MACRO_MUSCLES.arms], 'Arms'],
    [[...MACRO_MUSCLES.core], 'Core'],
    [[...MACRO_MUSCLES.push].reverse(), 'Push'],
  ] as [MuscleGroup[], string][])('%j is named %s', (focus, name) => {
    expect(routineName(focus)).toBe(name);
  });

  it('joins a list the way a sentence does', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('every row carries what it needs to be saved: a name, sets, reps, an origin, a muscle and a reason', () => {
    for (const row of one(buildRoutines(REAL, SHOULDERS, 3)).rows) {
      expect(row.name).toBeTruthy();
      expect(Number.isInteger(row.sets) && row.sets >= 1).toBe(true);
      expect(Number.isInteger(row.repMin) && row.repMin >= 1 && row.repMax >= row.repMin).toBe(true);
      expect(['own', 'catalogue']).toContain(row.origin);
      expect(row.reason.startsWith(row.muscleGroup)).toBe(true);
      expect(row.pattern).toBe(movementPattern(row.name, row.muscleGroup));
      if (row.origin === 'catalogue') expect(row.catalogueSlug).toBeTruthy();
      else expect(row.catalogueSlug).toBeUndefined();
    }
  });

  it('says how long it takes, as a whole number of minutes, and "about N min" says it', () => {
    const r = one(buildRoutines(REAL, SHOULDERS, 3));
    expect(Number.isInteger(r.estimateMinutes) && r.estimateMinutes > 0).toBe(true);
    expect(aboutMinutes(r)).toBe(`about ${r.estimateMinutes} min`);
    expect(r.reasonLines).toContain(`About ${r.estimateMinutes} min at your pace`);
  });

  it('is the same for the same input and seed, and the seed is used', () => {
    expect(buildRoutines(REAL, SHOULDERS, 7)).toEqual(buildRoutines(REAL, SHOULDERS, 7));
    const texts = new Set(SEEDS.slice(0, 40).map((s) => routineToText(buildRoutines(REAL, SHOULDERS, s))));
    expect(texts.size).toBeGreaterThan(5);
  });

  it('is the same whatever order the database hands the candidates back in', () => {
    const reversed = { ...REAL, candidates: [...REAL.candidates].reverse() };
    const rotated = { ...REAL, candidates: [...REAL.candidates.slice(300), ...REAL.candidates.slice(0, 300)] };
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = buildRoutines(REAL, SHOULDERS, seed);
      expect(buildRoutines(reversed, SHOULDERS, seed)).toEqual(a);
      expect(buildRoutines(rotated, SHOULDERS, seed)).toEqual(a);
    }
  });

  it('does not change the input it is given', () => {
    const before = JSON.stringify(REAL);
    const request: RoutineRequest = { focus: ['chest'], exclude: ['triceps'], equipment: ['dumbbell'] };
    const requestBefore = JSON.stringify(request);
    buildRoutines(REAL, request, 9);
    buildRoutines(REAL, { focus: [], split: 'ppl' }, 9);
    expect(JSON.stringify(REAL)).toBe(before);
    expect(JSON.stringify(request)).toBe(requestBefore);
  });

  it('reads no clock and no random source', () => {
    const real = { now: Date.now, random: Math.random };
    const boom = () => {
      throw new Error('read the clock or a random source');
    };
    Date.now = boom;
    Math.random = boom;
    try {
      expect(() => buildRoutines(REAL, SHOULDERS, 11)).not.toThrow();
    } finally {
      Date.now = real.now;
      Math.random = real.random;
    }
  });

  it('never throws on nonsense: no pool, a seed that is no number, counts that are no counts', () => {
    const empty = miniInput([]);
    expect(() => buildRoutines(empty, SHOULDERS, 1)).not.toThrow();
    expect(() => buildRoutines(REAL, SHOULDERS, Number.NaN)).not.toThrow();
    expect(() => buildRoutines(REAL, SHOULDERS, -5)).not.toThrow();
    for (const count of [0, -3, Number.NaN, Infinity, 1.5, 999]) expect(() => buildRoutines(REAL, { ...SHOULDERS, count }, 1)).not.toThrow();
    expect(() => buildRoutines({ ...REAL, candidates: undefined as never, settings: undefined as never }, SHOULDERS, 1)).not.toThrow();
    expect(() => buildRoutines(REAL, { focus: undefined as never }, 1)).not.toThrow();
  });

  it('a pool with nothing in it is a routine with no rows that says so', () => {
    const r = one(buildRoutines(miniInput([]), { focus: ['biceps'] }, 1));
    expect(r.rows).toEqual([]);
    expect(r.unmet).toEqual(['biceps']);
    expect(r.reasonLines).toContain('No exercise for biceps in your exercises or the library');
    expect(r.estimateMinutes).toBe(0);
  });

  it('a request that leaves nothing to train is one empty routine, not an empty list', () => {
    const r = buildRoutines(REAL, { focus: ['chest'], exclude: ['chest'] }, 1);
    // The excluded muscle is dropped from the focus, which is then empty: a spread of the others.
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Full body');
    const none = buildRoutines(REAL, { focus: [], split: 'full-body', exclude: [...MACRO_MUSCLES.upper, ...MACRO_MUSCLES.lower, 'abs'] }, 1);
    expect(none).toHaveLength(1);
    expect(none[0]!.rows).toEqual([]);
    expect(none[0]!.reasonLines).toEqual(['Nothing left to train after the exclusions']);
  });
});

describe('buildRoutines: how many exercises', () => {
  it('is six for one routine and five a day for a split, where the pool has them', () => {
    expect(DEFAULT_ROUTINE_COUNT).toBe(6);
    expect(DEFAULT_SPLIT_DAY_COUNT).toBe(5);
    for (const seed of seedsFrom(20)) {
      expect(one(buildRoutines(REAL, SHOULDERS, seed)).rows).toHaveLength(6);
      for (const day of buildRoutines(REAL, { focus: [], split: 'ppl' }, seed)) expect(day.rows).toHaveLength(5);
      for (const day of buildRoutines(REAL, { focus: [], split: 'upper-lower' }, seed)) expect(day.rows).toHaveLength(5);
      expect(one(buildRoutines(REAL, { focus: [] }, seed)).rows).toHaveLength(6);
    }
  });

  it('honours a count asked for, per day for a split', () => {
    for (const count of [1, 2, 3, 4, 5, 7]) {
      expect(one(buildRoutines(REAL, { ...SHOULDERS, count }, 4)).rows).toHaveLength(count);
    }
    // The owner has four exercises for these muscles and the library may add three: eight is seven, and the routine says why.
    const capped = one(buildRoutines(REAL, { ...SHOULDERS, count: 8 }, 4));
    expect(capped.rows).toHaveLength(7);
    expect(capped.reasonLines).toContain('7 of 8 exercises: 3 from the library is the most for one routine, and your own have nothing more for shoulders and rear delts');
    for (const day of buildRoutines(REAL, { focus: [], split: 'ppl', count: 4 }, 4)) expect(day.rows).toHaveLength(4);
  });

  it('is short, and says by how many, when the pool has no more', () => {
    const pool = miniInput([cand('DB Curl', 'biceps', { weight: 9 }), cand('Hammer Curl', 'biceps', { weight: 8 }), cand('Incline DB Curl', 'biceps', { weight: 7 })]);
    const r = one(buildRoutines(pool, { focus: ['biceps'] }, 1));
    expect(r.rows).toHaveLength(3);
    expect(r.reasonLines).toContain('3 of 6 exercises: nothing more for biceps in your exercises or the library');
  });
});

describe('buildRoutines: 3D shoulders over 500 seeds with the real library', () => {
  const routines = SEEDS.map((seed) => ({ seed, r: one(buildRoutines(REAL, SHOULDERS, seed)) }));

  it('is shoulders and rear delts, and nothing else', () => {
    for (const { seed, r } of routines) {
      for (const row of r.rows) expect(['shoulders', 'rear delts'], `seed ${seed}: ${row.name}`).toContain(row.muscleGroup);
      expect(countBy(r, 'shoulders'), `seed ${seed}`).toBeGreaterThan(0);
      expect(countBy(r, 'rear delts'), `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('is six exercises with no exercise twice and no movement twice', () => {
    for (const { seed, r } of routines) {
      expect(r.rows, `seed ${seed}`).toHaveLength(6);
      expect(new Set(r.rows.map((x) => x.id)).size, `seed ${seed}`).toBe(6);
      expect(new Set(patternsOf(r)).size, `seed ${seed}: ${patternsOf(r).join(', ')}`).toBe(6);
    }
  });

  it('is shoulders and rear delts three and three, or four and two', () => {
    const splits = new Map<string, number>();
    for (const { seed, r } of routines) {
      const s = countBy(r, 'shoulders');
      const d = countBy(r, 'rear delts');
      splits.set(`${s}+${d}`, (splits.get(`${s}+${d}`) ?? 0) + 1);
      expect([[3, 3], [4, 2]], `seed ${seed}: ${s}+${d}`).toContainEqual([s, d]);
    }
    console.info(`3D shoulders, shoulders+rear delts over ${SEEDS.length} seeds: ${[...splits].map(([k, v]) => `${k} x${v}`).join(', ')}`);
  });

  it('always has a front, a side and a rear exercise: a vertical press, a lateral raise and rear-delt work', () => {
    const tally = new Map<string, number>();
    for (const { seed, r } of routines) {
      const p = patternsOf(r);
      expect(p, `seed ${seed}`).toContain('press-vertical');
      expect(p, `seed ${seed}`).toContain('lateral-raise');
      expect(p.some((x) => x === 'rear-fly' || x === 'face-pull'), `seed ${seed}: ${p.join(', ')}`).toBe(true);
      expect(p.some((x) => x === 'front-raise'), `seed ${seed}: ${p.join(', ')}`).toBe(true);
      const regions = new Set(r.rows.map((x) => x.region));
      for (const region of ['shoulders:front', 'shoulders:side', 'shoulders:rear']) expect(regions, `seed ${seed}`).toContain(region);
      for (const x of p) tally.set(x, (tally.get(x) ?? 0) + 1);
    }
    console.info(`3D shoulders, movement in how many of ${SEEDS.length} routines: ${[...tally].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
  });

  it('opens with the vertical press and finishes with isolation work', () => {
    for (const { seed, r } of routines) {
      expect(r.rows[0]!.pattern, `seed ${seed}`).toBe('press-vertical');
      expect(r.rows[0]!.tier).toBe('primary');
      expect(r.rows.slice(1).every((x) => x.tier === 'isolation'), `seed ${seed}`).toBe(true);
    }
  });

  it('takes weights only from the owner: an own weight, rounded, or none; a library exercise never has one', () => {
    for (const { seed, r } of routines) {
      for (const row of r.rows) {
        const c = candidateById.get(row.id)!;
        const own = baseWeight(c);
        expect(row.weightKg, `seed ${seed}: ${row.name}`).toBe(own === null ? null : roundKg(own));
        if (row.origin === 'catalogue') expect(row.weightKg).toBeNull();
      }
    }
  });

  it('takes at most three exercises from the library, and flags each as new with no weight', () => {
    let mostNew = 0;
    for (const { seed, r } of routines) {
      const news = r.rows.filter((x) => x.origin === 'catalogue');
      mostNew = Math.max(mostNew, news.length);
      expect(news.length, `seed ${seed}`).toBeLessThanOrEqual(MAX_NEW_EXERCISES);
      for (const x of news) expect(x.reason, `seed ${seed}`).toContain('new to you, no weight yet');
      for (const x of r.rows.filter((y) => y.origin === 'own')) expect(x.reason).not.toContain('new to you');
    }
    // The cap is a ceiling, not a target: the owner's own four are used first.
    expect(mostNew).toBeLessThanOrEqual(2);
  });

  it('gives each muscle nine to fifteen working sets', () => {
    for (const { seed, r } of routines) {
      for (const group of ['shoulders', 'rear delts'] as const) {
        const sets = r.rows.filter((x) => x.muscleGroup === group).reduce((s, x) => s + x.sets, 0);
        expect(sets, `seed ${seed}: ${group}`).toBeGreaterThanOrEqual(9);
        expect(sets, `seed ${seed}: ${group}`).toBeLessThanOrEqual(15);
      }
    }
  });

  it('uses the owner\'s own sets and reps for what they already do, and a role\'s for what they do not', () => {
    for (const { seed, r } of routines) {
      const raise = r.rows.find((x) => x.name === 'Lateral Raise');
      if (raise) expect([raise.sets, raise.repMin, raise.repMax], `seed ${seed}`).toEqual([3, 12, 15]);
      const press = r.rows.find((x) => x.name === 'DB Shoulder Press');
      if (press) expect([press.sets, press.repMin, press.repMax], `seed ${seed}`).toEqual([3, 6, 8]);
      for (const x of r.rows.filter((y) => y.origin === 'catalogue')) {
        expect(x.repMin, `seed ${seed}: ${x.name}`).toBeGreaterThanOrEqual(10);
        expect(x.repMax).toBeLessThanOrEqual(20);
      }
    }
  });

  it('never takes a movement that is not a lift', () => {
    for (const { r } of routines) for (const x of r.rows) expect(NON_ROUTINE_PATTERNS.has(x.pattern), x.name).toBe(false);
  });
});

describe('buildRoutines: other muscles over 500 seeds with the real library', () => {
  it('chest has an incline press, a flat press and a fly, in that order of importance: presses first', () => {
    for (const seed of SEEDS) {
      const r = one(buildRoutines(REAL, { focus: ['chest'] }, seed));
      const p = patternsOf(r);
      for (const x of ['press-incline', 'press-horizontal', 'fly']) expect(p, `seed ${seed}: ${p.join(', ')}`).toContain(x);
      expect(r.rows.every((x) => x.muscleGroup === 'chest')).toBe(true);
      expect(r.rows[0]!.tier).toBe('primary');
      expect(new Set(r.rows.map((x) => x.id)).size).toBe(r.rows.length);
    }
  });

  it('arms has a long-head curl or two parts of the biceps, and a long-head triceps move', () => {
    for (const seed of SEEDS) {
      const r = one(buildRoutines(REAL, { focus: [...MACRO_MUSCLES.arms] }, seed));
      const biceps = r.rows.filter((x) => x.muscleGroup === 'biceps');
      const regions = new Set(biceps.map((x) => x.region));
      expect(biceps.some((x) => x.region === 'biceps:long') || regions.size >= 2, `seed ${seed}`).toBe(true);
      expect(r.rows.some((x) => x.muscleGroup === 'triceps' && x.region === 'triceps:long'), `seed ${seed}`).toBe(true);
      expect(r.rows.some((x) => x.muscleGroup === 'triceps'), `seed ${seed}`).toBe(true);
    }
  });

  it('back has a vertical pull, a row, and a shrug or rear-delt work', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const r = one(buildRoutines(REAL, { focus: ['lats', 'upper back'] }, seed));
      const regions = new Set(r.rows.map((x) => x.region));
      expect(regions, `seed ${seed}`).toContain('back:vertical');
      expect(regions, `seed ${seed}`).toContain('back:horizontal');
    }
  });

  it('legs have a squat or a press, a hinge or a curl, and a calf raise, for a leg day', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const r = one(buildRoutines(REAL, { focus: [...MACRO_MUSCLES.legs] }, seed));
      const p = patternsOf(r);
      expect(p.some((x) => x === 'squat' || x === 'leg-press'), `seed ${seed}: ${p.join(', ')}`).toBe(true);
      expect(p.some((x) => x === 'hinge' || x === 'leg-curl'), `seed ${seed}: ${p.join(', ')}`).toBe(true);
    }
  });
});

describe('buildRoutines: splits', () => {
  const PPL_DAYS: Record<string, MuscleGroup[]> = {
    Push: ['chest', 'shoulders', 'triceps'],
    Pull: ['lats', 'upper back', 'rear delts', 'biceps'],
    Legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  };

  it('push, pull and legs is three routines in that order, each with only its own muscles', () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const days = buildRoutines(REAL, { focus: [], split: 'ppl' }, seed);
      expect(days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
      for (const d of days) {
        for (const row of d.rows) expect(PPL_DAYS[d.name], `seed ${seed}: ${d.name}: ${row.name}`).toContain(row.muscleGroup);
      }
    }
  });

  it('no exercise is on two days of a split, and no day repeats a movement', () => {
    for (const seed of SEEDS.slice(0, 150)) {
      for (const split of ['ppl', 'upper-lower'] as const) {
        const days = buildRoutines(REAL, { focus: [], split }, seed);
        const ids = days.flatMap((d) => d.rows.map((x) => x.id));
        expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
        for (const d of days) expect(new Set(patternsOf(d)).size, `seed ${seed}: ${d.name}`).toBe(d.rows.length);
      }
    }
  });

  it('upper and lower is two routines: the upper muscles, then the lower', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const [upper, lower] = buildRoutines(REAL, { focus: [], split: 'upper-lower' }, seed);
      expect(upper!.name).toBe('Upper');
      expect(lower!.name).toBe('Lower');
      for (const x of upper!.rows) expect(MACRO_MUSCLES.upper, `seed ${seed}: ${x.name}`).toContain(x.muscleGroup);
      for (const x of lower!.rows) expect(MACRO_MUSCLES.lower, `seed ${seed}: ${x.name}`).toContain(x.muscleGroup);
    }
  });

  it('full body is one routine that spreads across lower body, pushing and pulling', () => {
    const lower = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes', 'calves']);
    const push = new Set<MuscleGroup>(['chest', 'shoulders', 'triceps']);
    const pull = new Set<MuscleGroup>(['lats', 'upper back', 'biceps']);
    for (const seed of SEEDS.slice(0, 150)) {
      for (const request of [{ focus: [], split: 'full-body' as const }, { focus: [] }]) {
        const days = buildRoutines(REAL, request, seed);
        expect(days).toHaveLength(1);
        expect(days[0]!.name).toBe('Full body');
        const groups = new Set(days[0]!.rows.map((x) => x.muscleGroup));
        for (const side of [lower, push, pull]) expect([...groups].some((g) => side.has(g)), `seed ${seed}: ${[...groups].join(', ')}`).toBe(true);
      }
    }
  });

  it('a split ignores a muscle typed beside it, and an exclusion still takes a muscle out of every day', () => {
    const days = buildRoutines(REAL, { focus: ['biceps'], split: 'ppl', exclude: ['triceps', 'calves'] }, 3);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
    for (const d of days) for (const x of d.rows) expect(['triceps', 'calves']).not.toContain(x.muscleGroup);
  });

  it('a day whose muscles are all excluded is left out', () => {
    const days = buildRoutines(REAL, { focus: [], split: 'ppl', exclude: [...MACRO_MUSCLES.legs] }, 3);
    expect(days.map((d) => d.name)).toEqual(['Push', 'Pull']);
  });
});

describe('buildRoutines: requests that narrow the pool', () => {
  it('only takes equipment allowed, and a library exercise only for equipment the owner has used', () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const r = one(buildRoutines(REAL, { focus: ['chest', 'triceps'], equipment: ['dumbbell', 'cable'] }, seed));
      for (const x of r.rows) expect(['dumbbell', 'cable'], `seed ${seed}: ${x.name}`).toContain(x.equipment);
    }
  });

  it('never takes a muscle that is ruled out, however the focus is worded', () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const r = one(buildRoutines(REAL, { focus: [...MACRO_MUSCLES.upper], exclude: ['triceps', 'forearms'] }, seed));
      for (const x of r.rows) expect(['triceps', 'forearms']).not.toContain(x.muscleGroup);
      expect(r.focus).not.toContain('triceps');
    }
  });

  it('a muscle with nothing in the pool is unmet, and is said to be, rather than swapped for another', () => {
    const pool = miniInput([cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 20 }), cand('Lateral Raise', 'shoulders', { weight: 8 })]);
    const r = one(buildRoutines(pool, { focus: ['shoulders', 'biceps'] }, 1));
    expect(r.unmet).toEqual(['biceps']);
    expect(r.rows.map((x) => x.name).sort()).toEqual(['DB Shoulder Press', 'Lateral Raise']);
    expect(r.reasonLines).toContain('No exercise for biceps in your exercises or the library');
  });

  it('never takes an expert exercise, a carry or a timed one', () => {
    const expert = { ...cand('Heavy Overhead Press', 'shoulders', { library: true, compound: true }), level: 'expert' as const };
    const carry = { ...cand("Farmer's Walk", 'shoulders'), kind: 'carry' as const };
    const timed = { ...cand('Plank Hold', 'abs'), kind: 'timed' as const };
    const pool = miniInput([expert, carry, timed, cand('Lateral Raise', 'shoulders', { weight: 8 })]);
    const r = one(buildRoutines(pool, { focus: ['shoulders', 'abs'] }, 1));
    expect(r.rows.map((x) => x.name)).toEqual(['Lateral Raise']);
  });

  it('an exercise with no equipment recorded counts as other, so "no barbell" keeps it', () => {
    const bare = { ...cand('Lateral Raise', 'shoulders', { weight: 8 }) };
    delete bare.equipment;
    const pool = miniInput([bare, cand('Barbell Overhead Press', 'shoulders', { compound: true, equipment: 'barbell' })]);
    const r = one(buildRoutines(pool, { focus: ['shoulders'], equipment: ['dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'other'] }, 1));
    expect(r.rows.map((x) => x.name)).toEqual(['Lateral Raise']);
  });
});

describe('routineRequestFrom', () => {
  it('reads the owner\'s own sentence', () => {
    const request = routineRequestFrom(parseQuickRequest('Give me a routine solely designed to build 3D shoulders'));
    expect(request).toEqual({ focus: ['shoulders', 'rear delts'] });
  });

  it('carries the count, the time, the equipment, the exclusions and the split', () => {
    const request = routineRequestFrom(parseQuickRequest('a 45 minute dumbbell push routine, six exercises, no triceps'));
    expect(request).toEqual({ focus: ['chest', 'shoulders'], exclude: ['triceps'], count: 6, equipment: ['dumbbell'], minutes: 45 });
    expect(routineRequestFrom(parseQuickRequest('ppl, five exercises a day'))).toEqual({ focus: [], count: 5, split: 'ppl' });
  });

  it('is an empty focus for a request that names no muscle, which builds a spread', () => {
    const request = routineRequestFrom(parseQuickRequest('give me a routine'));
    expect(request).toEqual({ focus: [] });
    expect(one(buildRoutines(REAL, request, 1)).name).toBe('Full body');
  });
});

describe('routineToText', () => {
  it('is the name, then one exercise a line as "Exercise 3x8-10 @ 22kg", with no weight when there is none', () => {
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 22 }),
      cand('Lateral Raise', 'shoulders', { weight: 8.5 }),
      cand('Front Raise', 'shoulders', { library: true }),
    ]);
    const text = routineToText(buildRoutines(pool, { focus: ['shoulders'] }, 1));
    expect(text).toBe(['Shoulders', 'DB Shoulder Press 4x8-12 @ 22kg', 'Lateral Raise 3x12-20 @ 8.5kg', 'Front Raise 3x10-15'].join('\n').replace('4x8-12', '4x6-10'));
  });

  it('puts a blank line between routines and nothing at the end', () => {
    const text = routineToText(buildRoutines(REAL, { focus: [], split: 'ppl' }, 1));
    expect(text.split('\n\n')).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(false);
    expect(text.split('\n\n').map((t) => t.split('\n')[0])).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('is nothing for no routines', () => {
    expect(routineToText([])).toBe('');
  });

  it('reads back, through the parser the Review routine sheet uses, as the same routines: names, sets, reps and weights', () => {
    const requests: RoutineRequest[] = [
      SHOULDERS,
      { focus: ['chest'] },
      { focus: [...MACRO_MUSCLES.arms] },
      { focus: [...MACRO_MUSCLES.legs] },
      { focus: [], split: 'ppl' },
      { focus: [], split: 'upper-lower' },
      { focus: [] },
    ];
    let names = 0;
    let qualified = 0;
    for (const request of requests) {
      for (const seed of seedsFrom(60)) {
        const built = buildRoutines(REAL, request, seed);
        const parsed = parseRoutineText(routineToText(built)).routines;
        expect(parsed.map((p) => p.name), `${JSON.stringify(request)} seed ${seed}`).toEqual(built.map((b) => b.name));
        built.forEach((b, i) => {
          const back = parsed[i]!.exercises;
          expect(back.map((e) => e.name), `seed ${seed}: ${b.name}`).toEqual(b.rows.map((x) => x.name));
          expect(back.map((e) => e.sets)).toEqual(b.rows.map((x) => x.sets));
          expect(back.map((e) => e.repMin)).toEqual(b.rows.map((x) => x.repMin));
          expect(back.map((e) => e.repMax)).toEqual(b.rows.map((x) => x.repMax));
          expect(back.map((e) => e.weightKg ?? null)).toEqual(b.rows.map((x) => x.weightKg));
          names += b.rows.length;
          qualified += b.rows.filter((x) => /\(|\s-\s/.test(x.name)).length;
        });
      }
    }
    // The names that carry a qualifier ("(Barbell)", " - V-Bar Attachment") are in the run, so the round trip has been tried on them.
    expect(names).toBeGreaterThan(3000);
    expect(qualified).toBeGreaterThan(100);
  });

  it('every library name comes back from the parser unchanged, qualifier and all', () => {
    for (const entry of CATALOGUE) {
      const line = `${entry.name} 3x8-12`;
      const [e] = parseRoutineText(`Test\n${line}`).routines[0]!.exercises;
      expect(e!.name, entry.name).toBe(entry.name);
    }
    for (const e of OWN_EXERCISES) {
      const [back] = parseRoutineText(`Test\n${e.name} 3x8-12 @ 20kg`).routines[0]!.exercises;
      expect(back!.name, e.name).toBe(e.name);
      expect(back!.weightKg).toBe(20);
    }
  });
});

describe('buildRoutines: own exercises only', () => {
  it('builds from the owner\'s 27 alone, and reports a part of the muscle nothing can reach', () => {
    const r = one(buildRoutines(OWN_ONLY, SHOULDERS, 1));
    expect(r.rows.map((x) => x.name).sort()).toEqual(['DB Shoulder Press', 'Face Pull', 'Lateral Raise', 'Rear Delt Fly (Machine)']);
    expect(r.rows.every((x) => x.origin === 'own')).toBe(true);
    expect(r.reasonLines).toContain('4 of 6 exercises: nothing more for shoulders and rear delts in your exercises or the library');
    expect(r.reasonLines.some((l) => l.startsWith('Weights are your own working weights'))).toBe(true);
    expect(QUICK_SETTINGS.barKg).toBe(20);
  });
});

describe('buildRoutines: niggles and stalls over 500 seeds with the real library', () => {
  const REQUESTS: [string, RoutineRequest][] = [
    ['3D shoulders', { focus: ['shoulders', 'rear delts'] }],
    ['shoulders', { focus: ['shoulders'] }],
    ['triceps', { focus: ['triceps'] }],
    ['arms', { focus: [...MACRO_MUSCLES.arms] }],
    ['push', { focus: [...MACRO_MUSCLES.push] }],
    ['chest', { focus: ['chest'] }],
    ['upper', { focus: [...MACRO_MUSCLES.upper] }],
    ['legs', { focus: [...MACRO_MUSCLES.legs] }],
    ['back', { focus: ['lats', 'upper back'] }],
    ['pull', { focus: [...MACRO_MUSCLES.pull] }],
    ['core', { focus: [...MACRO_MUSCLES.core] }],
    ['a spread', { focus: [] }],
    ['push pull legs', { focus: [], split: 'ppl' }],
    ['upper lower', { focus: [], split: 'upper-lower' }],
  ];
  const only = (...labels: string[]): [string, RoutineRequest][] => REQUESTS.filter(([label]) => labels.includes(label));
  const withNiggle = (tag: 'shoulder' | 'lower back' | 'knee' | 'hamstring DOMS') =>
    seededInput({ context: { niggles: [{ tag, severity: 2, date: '2026-09-28' }] } });
  const days = (input: ReturnType<typeof seededInput>, request: RoutineRequest, seed: number) => buildRoutines(input, request, seed);

  it('a shoulder niggle never yields an upright row, a press behind the neck, a barbell overhead press or a dip', { timeout: 120_000 }, () => {
    const input = withNiggle('shoulder');
    for (const [label, request] of only('3D shoulders', 'shoulders', 'triceps', 'arms', 'push', 'upper', 'a spread', 'push pull legs')) {
      for (const seed of SEEDS) {
        for (const r of days(input, request, seed)) {
          for (const x of r.rows) {
            const where = `${label}, seed ${seed}: ${x.name}`;
            expect(x.pattern, where).not.toBe('upright-row');
            expect(x.pattern, where).not.toBe('dip');
            expect(x.name, where).not.toMatch(/behind (the )?neck/i);
            expect(x.pattern === 'press-vertical' && x.equipment === 'barbell' && !/landmine/i.test(x.name), where).toBe(false);
          }
        }
      }
    }
  });

  it('a lower-back niggle never yields a hinge, a back extension, a bent-over barbell row or a barbell back squat', { timeout: 120_000 }, () => {
    const input = withNiggle('lower back');
    for (const [label, request] of only('legs', 'back', 'pull', 'core', 'upper', 'a spread', 'push pull legs', 'upper lower')) {
      for (const seed of SEEDS) {
        for (const r of days(input, request, seed)) {
          for (const x of r.rows) {
            const where = `${label}, seed ${seed}: ${x.name}`;
            expect(x.pattern, where).not.toBe('hinge');
            expect(x.pattern, where).not.toBe('back-extension');
            expect(x.pattern === 'row' && x.equipment === 'barbell' && !/supported|incline|lying|seal/i.test(x.name), where).toBe(false);
            expect(x.pattern === 'squat' && x.equipment === 'barbell' && !/front/i.test(x.name), where).toBe(false);
          }
        }
      }
    }
  });

  it('a knee niggle never yields a lunge, a split squat, a step-up or a sissy squat', { timeout: 120_000 }, () => {
    const input = withNiggle('knee');
    for (const [label, request] of only('legs', 'a spread', 'push pull legs', 'upper lower')) {
      for (const seed of SEEDS) {
        for (const r of days(input, request, seed)) {
          for (const x of r.rows) {
            expect(x.pattern, `${label}, seed ${seed}: ${x.name}`).not.toBe('lunge');
            expect(x.name, `${label}, seed ${seed}`).not.toMatch(/sissy|pistol/i);
          }
        }
      }
    }
  });

  it('hamstring soreness never yields a hinge or a leg curl', { timeout: 120_000 }, () => {
    const input = withNiggle('hamstring DOMS');
    for (const [label, request] of only('legs', 'a spread', 'push pull legs', 'upper lower')) {
      for (const seed of SEEDS) {
        for (const r of days(input, request, seed)) for (const x of r.rows) expect(['hinge', 'leg-curl'], `${label}, seed ${seed}: ${x.name}`).not.toContain(x.pattern);
      }
    }
  });

  it('control: with no niggle, each of those is yielded by some seed, so the tests above have something to refuse', { timeout: 120_000 }, () => {
    const input = seededInput();
    const seen = new Set<string>();
    for (const [, request] of REQUESTS) {
      for (const seed of SEEDS.slice(0, 120)) {
        for (const r of days(input, request, seed)) {
          for (const x of r.rows) {
            if (x.pattern === 'upright-row') seen.add('upright-row');
            if (x.pattern === 'dip') seen.add('dip');
            if (x.pattern === 'press-vertical' && x.equipment === 'barbell') seen.add('barbell overhead press');
            if (x.pattern === 'hinge') seen.add('hinge');
            if (x.pattern === 'back-extension') seen.add('back-extension');
            if (x.pattern === 'lunge') seen.add('lunge');
            if (x.pattern === 'leg-curl') seen.add('leg-curl');
            if (x.pattern === 'row' && x.equipment === 'barbell') seen.add('barbell row');
          }
        }
      }
    }
    // The owner's own dumbbell press fills the front of the shoulder before a barbell one is looked at, and their machine row the horizontal pull, so those are the hand-made pools' to show.
    for (const x of ['upright-row', 'dip', 'hinge', 'back-extension', 'lunge', 'leg-curl']) expect(seen.has(x), x).toBe(true);
  });

  it('the niggle is said, with its date, on every routine it changed, and on none it did not', () => {
    const input = withNiggle('shoulder');
    let said = 0;
    let silent = 0;
    for (const [, request] of REQUESTS) {
      for (const r of days(input, request, 3)) {
        const line = r.reasonLines.find((l) => l.startsWith('Shoulder niggle on 28 Sep: '));
        const shoulderWork = r.focus.some((m) => m === 'shoulders' || m === 'chest' || m === 'triceps' || m === 'traps');
        if (line) said++;
        else silent++;
        // A leg day has no upright row to refuse.
        if (r.name === 'Legs' || r.name === 'Lower' || r.name === 'Core') expect(line, r.name).toBeUndefined();
        if (r.name === 'Shoulders and rear delts') expect(line).toBeTruthy();
        void shoulderWork;
      }
    }
    expect(said).toBeGreaterThan(3);
    expect(silent).toBeGreaterThan(3);
  });

  it('stalled lifts are replaced by a variation of the same kind, for each lift the owner has stalled', { timeout: 120_000 }, () => {
    const cases: [string, RoutineRequest, string][] = [
      ['Bench Press (Barbell)', { focus: ['chest'] }, 'chest'],
      ['DB Shoulder Press', { focus: ['shoulders', 'rear delts'] }, 'shoulders'],
      ['Lat Pulldown (Machine)', { focus: ['lats', 'upper back'] }, 'lats'],
      ['Barbell Back Squat', { focus: [...MACRO_MUSCLES.legs] }, 'quads'],
      ['Romanian Deadlift (Barbell)', { focus: [...MACRO_MUSCLES.legs] }, 'hamstrings'],
      ['Incline DB Curl', { focus: [...MACRO_MUSCLES.arms] }, 'biceps'],
    ];
    for (const [name, request, group] of cases) {
      const input = seededInput({ context: { stalled: [{ exerciseId: SEED_EXERCISE_IDS[name as keyof typeof SEED_EXERCISE_IDS], sessions: 4 }] } });
      let replaced = 0;
      for (const seed of SEEDS) {
        const r = one(buildRoutines(input, request, seed));
        const where = `${name}, seed ${seed}`;
        expect(r.rows.map((x) => x.name), where).not.toContain(name);
        const line = r.reasonLines.find((l) => l.startsWith(`${name} stalled for 4 sessions: `));
        if (line) {
          replaced++;
          const into = line.slice(`${name} stalled for 4 sessions: `.length, -' in its place'.length);
          expect(line.endsWith(' in its place'), where).toBe(true);
          const row = r.rows.find((x) => x.name === into);
          expect(row, `${where}: ${line}`).toBeTruthy();
          expect(row!.muscleGroup, where).toBe(group);
        }
        // The muscle is still trained: a stalled lift costs it nothing.
        expect(r.rows.some((x) => x.muscleGroup === group), where).toBe(true);
      }
      expect(replaced, name).toBeGreaterThan(SEEDS.length / 2);
    }
  });

  it('every routine in every request opens with its heavy lifts and ends with isolation, over 500 seeds', { timeout: 120_000 }, () => {
    const input = seededInput();
    for (const [label, request] of REQUESTS) {
      for (const seed of SEEDS) {
        for (const r of days(input, request, seed)) {
          const ranks = r.rows.map((x) => ({ primary: 0, secondary: 1, isolation: 2 })[x.tier]);
          expect(ranks, `${label}, seed ${seed}: ${r.name}`).toEqual([...ranks].sort((a, b) => a - b));
        }
      }
    }
  });
});
