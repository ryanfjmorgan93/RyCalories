/**
 * One block per rule the builder follows. Each has a fixture where the rule visibly changes the
 * outcome and a control where it does not, so a test cannot pass for a rule that was never applied.
 */
import { describe, expect, it } from 'vitest';
import { SEED_EXERCISE_IDS } from '../db/seed';
import { cand, miniInput, seededInput, seedsFrom } from '../test/routineFixtures';
import { MAX_NEW_EXERCISES, buildRoutines, type BuiltRoutine, type RoutineRequest } from './routineBuilder';
import type { ContextRoutine, RoutineContext } from './routineContext';
import { estimateMinutes } from './quickSession';
import { restSecondsFor } from './rest';
import type { MuscleGroup, NiggleTag } from './types';

const SEEDS_100 = seedsFrom(100);
const SEEDS_400 = seedsFrom(400);

const one = (r: BuiltRoutine[]): BuiltRoutine => r[0]!;
const names = (r: BuiltRoutine): string[] => r.rows.map((x) => x.name);
const tierRank = { primary: 0, secondary: 1, isolation: 2 } as const;

function context(over: Partial<RoutineContext> = {}): RoutineContext {
  return { routines: [], niggles: [], stalled: [], ...over };
}

function routine(name: string, exercises: [string, MuscleGroup, number, number, number][]): ContextRoutine {
  return {
    id: name,
    name,
    exercises: exercises.map(([exerciseId, muscleGroup, targetSets, repMin, repMax]) => ({ exerciseId, name: exerciseId, muscleGroup, pattern: muscleGroup, targetSets, repMin, repMax })),
  };
}

// ---------------------------------------------------------------------------

describe('rule: structure and order', () => {
  const PUSH_POOL = [
    cand('Bench Press (Barbell)', 'chest', { compound: true, weight: 60, equipment: 'barbell' }),
    cand('Incline DB Press', 'chest', { compound: true, weight: 20 }),
    cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
    cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
    cand('Lateral Raise', 'shoulders', { weight: 8 }),
    cand('Triceps Pushdown', 'triceps', { equipment: 'cable', weight: 25 }),
    cand('Overhead Triceps Extension', 'triceps', { equipment: 'cable', weight: 20 }),
  ];
  const PUSH: RoutineRequest = { focus: ['chest', 'shoulders', 'triceps'] };

  it('opens with a main lift for two different muscles, then the secondary lift, then isolation, the bigger muscle first', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(miniInput(PUSH_POOL), PUSH, seed));
      expect(names(r), `seed ${seed}`).toEqual([
        'Bench Press (Barbell)',
        'DB Shoulder Press',
        'Incline DB Press',
        'Lateral Raise',
        'Overhead Triceps Extension',
        'Triceps Pushdown',
      ]);
      expect(r.rows.map((x) => x.tier)).toEqual(['primary', 'primary', 'secondary', 'isolation', 'isolation', 'isolation']);
    }
  });

  it('never takes more than two main lifts, and one when the routine is short', () => {
    const squats = [cand('Barbell Back Squat', 'quads', { compound: true, equipment: 'barbell' }), cand('Leg Press', 'quads', { compound: true, equipment: 'machine' }), cand('Front Squat', 'quads', { compound: true, equipment: 'barbell' })];
    const long = one(buildRoutines(miniInput([...PUSH_POOL, ...squats]), { focus: ['chest', 'quads'], count: 6 }, 3));
    expect(long.rows.filter((x) => x.tier === 'primary').length).toBeLessThanOrEqual(2);
    const short = one(buildRoutines(miniInput(PUSH_POOL), { focus: ['chest'], count: 4 }, 3));
    expect(short.rows.filter((x) => x.tier === 'primary')).toHaveLength(1);
  });

  it('keeps the tiers in order whatever the seed, in the real library', () => {
    const real = seededInput();
    for (const request of [{ focus: ['chest'] }, { focus: ['biceps', 'triceps'] }, { focus: [], split: 'ppl' as const }, { focus: ['quads', 'hamstrings'] }] as RoutineRequest[]) {
      for (const seed of SEEDS_100) {
        for (const r of buildRoutines(real, request, seed)) {
          const ranks = r.rows.map((x) => tierRank[x.tier]);
          expect(ranks, `seed ${seed}: ${r.name}`).toEqual([...ranks].sort((a, b) => a - b));
          expect(r.rows.filter((x) => x.tier === 'primary').length).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('control: put the tiers out of order and this test would see it', () => {
    const r = one(buildRoutines(miniInput(PUSH_POOL), PUSH, 1));
    const ranks = r.rows.map((x) => tierRank[x.tier]);
    // The press is not first by the order the muscles were named in, nor by the order the exercises were drawn.
    expect(ranks[0]).toBe(0);
    expect(r.rows.map((x) => x.muscleGroup)).not.toEqual(['chest', 'chest', 'chest', 'shoulders', 'triceps', 'triceps'].slice().sort().reverse());
  });

  it('never takes two of one movement while another is on offer: a second press waits for the lateral raise', () => {
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
      cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Cable Lateral Raise', 'shoulders', { equipment: 'cable', weight: 5 }),
      cand('Front Raise', 'shoulders', { weight: 6 }),
    ]);
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 3 }, seed));
      expect(new Set(r.rows.map((x) => x.pattern)), `seed ${seed}`).toEqual(new Set(['press-vertical', 'lateral-raise', 'front-raise']));
      expect(r.reasonLines).toContain('One exercise per movement: vertical press, lateral raise and front raise');
    }
  });

  it('repeats a movement only when the muscle has nothing else, and says so on a line of its own', () => {
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
      cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Cable Lateral Raise', 'shoulders', { equipment: 'cable', weight: 5 }),
    ]);
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 4 }, seed));
      expect(r.rows).toHaveLength(4);
      expect(r.rows.map((x) => x.pattern).sort()).toEqual(['lateral-raise', 'lateral-raise', 'press-vertical', 'press-vertical']);
      // The first of each movement is a plain pick; the second says nothing else was left.
      const repeats = r.reasonLines.filter((l) => l.startsWith('A second '));
      expect(repeats).toHaveLength(2);
      expect(repeats.some((l) => /^A second vertical press, (DB Shoulder Press|Arnold Press): nothing else left for shoulders in your exercises or the library$/.test(l))).toBe(true);
      expect(repeats.some((l) => /^A second lateral raise, (Lateral Raise|Cable Lateral Raise): nothing else left for shoulders in your exercises or the library$/.test(l))).toBe(true);
      expect(r.reasonLines.some((l) => l.startsWith('One exercise per movement'))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe('rule: every part of a muscle before a second of one', () => {
  const SHOULDER_POOL = [
    cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
    cand('Lateral Raise', 'shoulders', { weight: 8 }),
    cand('Front Raise', 'shoulders', { weight: 6 }),
    cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
    cand('Cable Lateral Raise', 'shoulders', { equipment: 'cable' }),
    cand('Rear Delt Fly (Machine)', 'rear delts', { equipment: 'machine', weight: 30 }),
    cand('Face Pull', 'rear delts', { equipment: 'cable', weight: 20 }),
  ];

  it('takes a front, a side and a rear exercise for three, whatever the seed, with more than one on offer for each', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(miniInput(SHOULDER_POOL), { focus: ['shoulders', 'rear delts'], count: 3 }, seed));
      expect(new Set(r.rows.map((x) => x.region)), `seed ${seed}`).toEqual(new Set(['shoulders:front', 'shoulders:side', 'shoulders:rear']));
    }
  });

  it('control: a muscle with every part covered twice over does not take the same part three times for three exercises', () => {
    const r = one(buildRoutines(miniInput(SHOULDER_POOL), { focus: ['shoulders', 'rear delts'], count: 3 }, 1));
    const regions = r.rows.map((x) => x.region);
    expect(new Set(regions).size).toBe(3);
  });

  it('takes the upper chest, the flat press and the fly for a chest routine of three', () => {
    const pool = miniInput([
      cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 60 }),
      cand('Dumbbell Bench Press', 'chest', { compound: true, weight: 24 }),
      cand('Incline DB Press', 'chest', { compound: true, weight: 20 }),
      cand('Incline Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell' }),
      cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
      cand('Pec Deck', 'chest', { equipment: 'machine' }),
    ]);
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool, { focus: ['chest'], count: 3 }, seed));
      expect(r.rows.map((x) => x.pattern).sort(), `seed ${seed}`).toEqual(['fly', 'press-horizontal', 'press-incline']);
    }
  });

  it('says so when no exercise in the owner\'s list or the library reaches a part of the muscle', () => {
    const pool = miniInput([cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }), cand('Lateral Raise', 'shoulders', { weight: 8 })]);
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 3 }, 1));
    expect(r.reasonLines).toContain('No exercise for rear delts in your exercises or the library');
    expect(r.reasonLines.filter((l) => l.startsWith('No exercise for'))).toHaveLength(1);
  });

  it('control: a part the library can reach is not reported missing, though the owner has no exercise for it', () => {
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Reverse Pec Deck', 'shoulders', { library: true, equipment: 'machine' }),
    ]);
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 3 }, 1));
    expect(r.reasonLines.some((l) => l.startsWith('No exercise for'))).toBe(false);
    expect(r.rows.map((x) => x.region)).toContain('shoulders:rear');
  });

  it('a part of a muscle outside the muscles asked for is not reported: rear delts are not missing from a request for shoulders alone', () => {
    const real = seededInput();
    const r = one(buildRoutines(real, { focus: ['shoulders'] }, 1));
    expect(r.reasonLines.some((l) => l.startsWith('No exercise for'))).toBe(false);
  });

  it('a back routine takes a pulldown and a row for two', () => {
    const pool = miniInput([
      cand('Lat Pulldown (Machine)', 'lats', { compound: true, equipment: 'machine', weight: 80 }),
      cand('Pull-up', 'lats', { compound: true, equipment: 'bodyweight' }),
      cand('Seated Cable Row', 'upper back', { compound: true, equipment: 'cable', weight: 60 }),
      cand('Barbell Row', 'upper back', { compound: true, equipment: 'barbell' }),
    ]);
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool, { focus: ['lats', 'upper back'], count: 2 }, seed));
      expect(r.rows.map((x) => x.region).sort(), `seed ${seed}`).toEqual(['back:horizontal', 'back:vertical']);
    }
  });
});

// ---------------------------------------------------------------------------

describe('rule: sets and reps by role', () => {
  it('main lifts are 4 then 3 sets of 6 to 10, secondary lifts 3 of 8 to 12, isolation 3 of 10 to 15, raises 3 of 12 to 20', () => {
    const pool = miniInput([
      cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell' }),
      cand('Incline DB Press', 'chest', { compound: true }),
      cand('Cable Fly', 'chest', { equipment: 'cable' }),
      cand('Decline Bench Press', 'chest', { compound: true, equipment: 'barbell' }),
    ]);
    const r = one(buildRoutines(pool, { focus: ['chest'], count: 4 }, 1));
    const by = Object.fromEntries(r.rows.map((x) => [x.name, [x.sets, x.repMin, x.repMax]]));
    expect(by['Bench Press (Barbell)']).toEqual([4, 6, 10]);
    expect(by['Incline DB Press']).toEqual([3, 8, 12]);
    expect(by['Decline Bench Press']).toEqual([3, 8, 12]);
    expect(by['Cable Fly']).toEqual([3, 10, 15]);

    const shoulders = one(buildRoutines(miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true }),
      cand('Lateral Raise', 'shoulders'),
      cand('Front Raise', 'shoulders'),
    ]), { focus: ['shoulders'], count: 3 }, 1));
    const raise = shoulders.rows.find((x) => x.name === 'Lateral Raise')!;
    expect([raise.sets, raise.repMin, raise.repMax]).toEqual([3, 12, 20]);
    const front = shoulders.rows.find((x) => x.name === 'Front Raise')!;
    expect([front.sets, front.repMin, front.repMax]).toEqual([3, 10, 15]);
  });

  it('rear-delt raises and face pulls are 12 to 20 as well', () => {
    const r = one(buildRoutines(miniInput([cand('Rear Delt Fly (Machine)', 'rear delts', { equipment: 'machine' }), cand('Face Pull', 'rear delts', { equipment: 'cable' }), cand('Barbell Rear Delt Row', 'rear delts', { equipment: 'barbell', compound: true })]), { focus: ['rear delts'], count: 3 }, 1));
    for (const x of r.rows) expect([x.repMin, x.repMax], x.name).toEqual([12, 20]);
  });

  it('calves are 4 sets of 10 to 15 and abs 3 of 10 to 20', () => {
    const calves = one(buildRoutines(miniInput([cand('Standing Calf Raise', 'calves', { equipment: 'machine' }), cand('Seated Calf Raise', 'calves', { equipment: 'machine' })]), { focus: ['calves'], count: 2 }, 1));
    for (const x of calves.rows) expect([x.sets, x.repMin, x.repMax], x.name).toEqual([4, 10, 15]);
    const abs = one(buildRoutines(miniInput([cand('Cable Crunch', 'abs', { equipment: 'cable' }), cand('Hanging Leg Raise', 'abs', { equipment: 'bodyweight' }), cand('Plank', 'abs', { equipment: 'bodyweight' })]), { focus: ['abs'], count: 3 }, 1));
    for (const x of abs.rows) expect([x.sets, x.repMin, x.repMax], x.name).toEqual([3, 10, 20]);
  });

  it("the owner's own sets and reps win for an exercise they already do, and nothing else does", () => {
    const pool = miniInput(
      [cand('Lateral Raise', 'shoulders', { weight: 8 }), cand('Front Raise', 'shoulders', { weight: 6 }), cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 })],
      { context: context({ routines: [routine('Arms', [['Lateral Raise', 'shoulders', 5, 15, 20]])] }) },
    );
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 3 }, 1));
    const raise = r.rows.find((x) => x.name === 'Lateral Raise')!;
    expect([raise.sets, raise.repMin, raise.repMax]).toEqual([5, 15, 20]);
    const front = r.rows.find((x) => x.name === 'Front Raise')!;
    expect([front.sets, front.repMin, front.repMax]).toEqual([3, 10, 15]);
    // Control: without the routine the raise is the role's.
    const without = one(buildRoutines(miniInput(pool.candidates), { focus: ['shoulders'], count: 3 }, 1));
    const plain = without.rows.find((x) => x.name === 'Lateral Raise')!;
    expect([plain.sets, plain.repMin, plain.repMax]).toEqual([3, 12, 20]);
  });

  it('an exercise in two of the owner\'s routines takes the first one in their week', () => {
    const pool = miniInput([cand('Lateral Raise', 'shoulders', { weight: 8 })], {
      context: context({ routines: [routine('First', [['Lateral Raise', 'shoulders', 4, 12, 15]]), routine('Second', [['Lateral Raise', 'shoulders', 2, 8, 10]])] }),
    });
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 1 }, 1));
    expect([r.rows[0]!.sets, r.rows[0]!.repMin, r.rows[0]!.repMax]).toEqual([4, 12, 15]);
  });

  it('a prescription that makes no sense is not used', () => {
    const pool = miniInput([cand('Lateral Raise', 'shoulders', { weight: 8 })], {
      context: context({ routines: [routine('Bad', [['Lateral Raise', 'shoulders', 0, 20, 10]])] }),
    });
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 1 }, 1));
    // The role's reps (not 20 to 10), and the sets brought up to four, the most one exercise takes.
    expect([r.rows[0]!.sets, r.rows[0]!.repMin, r.rows[0]!.repMax]).toEqual([4, 12, 20]);
  });

  it('a muscle named on its own gets nine to fifteen sets: eighteen is trimmed from the end to fifteen, the main lift kept at four', () => {
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true }),
      cand('Upright Row (Barbell)', 'shoulders', { compound: true, equipment: 'barbell' }),
      cand('Lateral Raise', 'shoulders'),
      cand('Front Raise', 'shoulders'),
      cand('Reverse Fly (Dumbbell)', 'shoulders'),
      cand('Face Pull (Cable)', 'shoulders', { equipment: 'cable' }),
    ]);
    const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 6 }, 1));
    expect(r.rows).toHaveLength(6);
    expect(r.rows.reduce((s, x) => s + x.sets, 0)).toBe(15);
    expect(r.rows[0]!.sets).toBe(4);
    // Eighteen and a main lift of four make nineteen: four sets come off, from the last rows up.
    expect(r.rows.map((x) => x.sets)).toEqual([4, 3, 2, 2, 2, 2]);
  });

  it('one exercise for a muscle in a day of a split is brought up to four sets, which is the least a day gives a muscle', () => {
    const pool = miniInput([
      cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell' }),
      cand('DB Shoulder Press', 'shoulders', { compound: true }),
      cand('Triceps Pushdown', 'triceps', { equipment: 'cable' }),
    ]);
    const r = one(buildRoutines(pool, { focus: [], split: 'ppl', count: 3 }, 1));
    expect(r.name).toBe('Push');
    for (const x of r.rows) expect(x.sets, x.name).toBeGreaterThanOrEqual(4);
    expect(r.rows.find((x) => x.name === 'Triceps Pushdown')!.sets).toBe(4);
    // And the owner's own number for it is not changed to make it fit.
    const own = miniInput(pool.candidates, { context: context({ routines: [routine('Mine', [['Triceps Pushdown', 'triceps', 2, 12, 15]])] }) });
    expect(one(buildRoutines(own, { focus: [], split: 'ppl', count: 3 }, 1)).rows.find((x) => x.name === 'Triceps Pushdown')!.sets).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('rule: the week around it', () => {
  const MUSCLES: [string, MuscleGroup, boolean][] = [
    ['Barbell Back Squat', 'quads', true],
    ['Bench Press (Barbell)', 'chest', true],
    ['Lat Pulldown (Machine)', 'lats', true],
    ['DB Shoulder Press', 'shoulders', true],
  ];
  const pool = (over: Partial<ReturnType<typeof miniInput>> = {}) =>
    miniInput(MUSCLES.map(([n, g, c]) => cand(n, g, { compound: c, weight: 40 })), over);
  const crowded = routine('Crowded', [
    ['Barbell Back Squat', 'quads', 12, 6, 8],
    ['Bench Press (Barbell)', 'chest', 12, 6, 8],
    ['Lat Pulldown (Machine)', 'lats', 12, 6, 8],
  ]);

  it('a spread favours the muscle the owner\'s routines leave short', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool({ context: context({ routines: [crowded] }) }), { focus: [], count: 2 }, seed));
      expect(r.rows.map((x) => x.muscleGroup), `seed ${seed}`).toContain('shoulders');
    }
  });

  it('control: with no routines to read it is the bigger muscles that come first, and shoulders never', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool(), { focus: [], count: 2 }, seed));
      expect(r.rows.map((x) => x.muscleGroup), `seed ${seed}`).not.toContain('shoulders');
    }
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool({ context: context() }), { focus: [], count: 2 }, seed));
      expect(r.rows.map((x) => x.muscleGroup), `seed ${seed}`).not.toContain('shoulders');
    }
  });

  it('says it as a fact, for each muscle the routine trains', () => {
    const r = one(buildRoutines(pool({ context: context({ routines: [crowded] }) }), { focus: [], count: 2 }, 1));
    expect(r.reasonLines).toContain('shoulders get 0 sets a week in your routines; this routine adds 4');
    expect(r.reasonLines.some((l) => l.startsWith('chest gets 12 sets a week in your routines; this routine adds'))).toBe(true);
    // Singular and plural, and one set.
    const one1 = routine('One', [['DB Shoulder Press', 'shoulders', 1, 8, 10]]);
    const typed = one(buildRoutines(pool({ context: context({ routines: [one1] }) }), { focus: ['shoulders'], count: 1 }, 1));
    expect(typed.reasonLines).toContain('shoulders get 1 set a week in your routines; this routine adds 1');
  });

  it('says nothing about the week when the owner has no routines to read it from', () => {
    for (const ctx of [undefined, context(), context({ routines: [] })]) {
      const r = one(buildRoutines(pool(ctx ? { context: ctx } : {}), { focus: ['shoulders'], count: 1 }, 1));
      expect(r.reasonLines.some((l) => l.includes('a week in your routines'))).toBe(false);
    }
  });

  it('the owner\'s own weekly target is what a muscle is held up against: 30 sets a week is far from 12', () => {
    const chestHeavy = routine('Chest', [['Bench Press (Barbell)', 'chest', 12, 6, 8]]);
    const others = routine('Others', [['Barbell Back Squat', 'quads', 12, 6, 8], ['Lat Pulldown (Machine)', 'lats', 12, 6, 8], ['DB Shoulder Press', 'shoulders', 12, 6, 8]]);
    const ctx = context({ routines: [chestHeavy, others] });
    // With no target everything at 12 is past the ten sets a week used as the reference, so nothing is short and the bigger muscles win.
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool({ context: ctx }), { focus: [], count: 1 }, seed));
      expect(['quads', 'chest', 'lats'], `seed ${seed}`).toContain(r.rows[0]!.muscleGroup);
    }
    // A target of 30 for shoulders makes 12 a shortfall of 18.
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool({ context: ctx, weeklyTargets: { shoulders: 30 } }), { focus: [], count: 1 }, seed));
      expect(r.rows[0]!.muscleGroup, `seed ${seed}`).toBe('shoulders');
    }
  });

  it('a muscle asked for by name is not weighed against the week: it gets its exercises either way', () => {
    const r = one(buildRoutines(pool({ context: context({ routines: [crowded] }) }), { focus: ['chest'], count: 1 }, 1));
    expect(r.rows.map((x) => x.muscleGroup)).toEqual(['chest']);
  });
});

// ---------------------------------------------------------------------------

describe('rule: a niggle steers the choice', () => {
  const niggle = (tag: NiggleTag, date = '2026-09-28') => context({ niggles: [{ tag, severity: 2, date }] });

  describe('shoulder', () => {
    const SHOULDER_POOL = [
      cand('Barbell Overhead Press', 'shoulders', { compound: true, equipment: 'barbell', weight: 40 }),
      cand('Neutral Grip Dumbbell Press', 'shoulders', { compound: true }),
      cand('Machine Shoulder Press', 'shoulders', { compound: true, equipment: 'machine' }),
      cand('Standing Barbell Press Behind Neck', 'shoulders', { compound: true, equipment: 'barbell' }),
      cand('Upright Row (Barbell)', 'shoulders', { compound: true, equipment: 'barbell', weight: 30 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Cable Lateral Raise', 'shoulders', { equipment: 'cable' }),
      cand('Front Raise', 'shoulders'),
      cand('Weighted Dip', 'triceps', { equipment: 'bodyweight', compound: true }),
      cand('Triceps Pushdown', 'triceps', { equipment: 'cable' }),
    ];
    const request: RoutineRequest = { focus: ['shoulders', 'triceps'], count: 5 };

    it('never takes an upright row, a press behind the neck, a barbell overhead press or a dip', () => {
      for (const seed of SEEDS_100) {
        const r = one(buildRoutines(miniInput(SHOULDER_POOL, { context: niggle('shoulder') }), request, seed));
        for (const x of r.rows) {
          expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('upright-row');
          expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('dip');
          expect(x.name, `seed ${seed}`).not.toMatch(/behind neck|behind the neck/i);
          expect(x.pattern === 'press-vertical' && x.equipment === 'barbell', `seed ${seed}: ${x.name}`).toBe(false);
        }
      }
    });

    it('control: without the niggle each of them is taken by some seed', () => {
      const seen = new Set<string>();
      for (const seed of SEEDS_100) for (const x of one(buildRoutines(miniInput(SHOULDER_POOL), request, seed)).rows) seen.add(x.name);
      for (const blocked of ['Barbell Overhead Press', 'Standing Barbell Press Behind Neck', 'Upright Row (Barbell)', 'Weighted Dip']) expect(seen.has(blocked), blocked).toBe(true);
    });

    it('states it as a fact, with the date', () => {
      const r = one(buildRoutines(miniInput(SHOULDER_POOL, { context: niggle('shoulder') }), request, 1));
      expect(r.reasonLines).toContain('Shoulder niggle on 28 Sep: no upright row, no behind-the-neck or barbell overhead press, no dips; neutral grips preferred');
      const without = one(buildRoutines(miniInput(SHOULDER_POOL), request, 1));
      expect(without.reasonLines.some((l) => l.includes('niggle'))).toBe(false);
    });

    it('prefers a neutral grip among the presses that are left', () => {
      const presses = [cand('Neutral Grip Dumbbell Press', 'shoulders', { compound: true }), cand('Machine Shoulder Press', 'shoulders', { compound: true, equipment: 'machine' })];
      const pick = (ctx?: RoutineContext) =>
        SEEDS_400.filter((seed) => one(buildRoutines(miniInput(presses, ctx ? { context: ctx } : {}), { focus: ['shoulders'], count: 1 }, seed)).rows[0]!.name === 'Neutral Grip Dumbbell Press').length;
      const withNiggle = pick(niggle('shoulder'));
      const without = pick();
      expect(withNiggle / SEEDS_400.length).toBeGreaterThan(0.65);
      expect(without / SEEDS_400.length).toBeGreaterThan(0.4);
      expect(without / SEEDS_400.length).toBeLessThan(0.6);
    });

    it('a landmine press is not a barbell overhead press', () => {
      const pool = miniInput([cand('Landmine Press', 'shoulders', { compound: true, equipment: 'barbell' })], { context: niggle('shoulder') });
      expect(names(one(buildRoutines(pool, { focus: ['shoulders'], count: 1 }, 1)))).toEqual(['Landmine Press']);
    });
  });

  describe('lower back', () => {
    const POOL = [
      cand('Romanian Deadlift (Barbell)', 'hamstrings', { compound: true, equipment: 'barbell', weight: 100 }),
      cand('Lying Leg Curl (Machine)', 'hamstrings', { equipment: 'machine', weight: 40 }),
      cand('Back Extension', 'lower back', { equipment: 'bodyweight' }),
      cand('Barbell Back Squat', 'quads', { compound: true, equipment: 'barbell', weight: 90 }),
      cand('Leg Press', 'quads', { compound: true, equipment: 'machine' }),
      cand('Barbell Row', 'upper back', { compound: true, equipment: 'barbell', weight: 60 }),
      cand('Chest Supported Row', 'upper back', { compound: true, equipment: 'machine' }),
      cand('Lat Pulldown (Machine)', 'lats', { compound: true, equipment: 'machine', weight: 80 }),
    ];
    const request: RoutineRequest = { focus: ['quads', 'hamstrings', 'upper back', 'lats', 'lower back'], count: 6 };

    it('never takes a hinge, a back extension, a bent-over barbell row or a barbell back squat', () => {
      for (const seed of SEEDS_100) {
        const r = one(buildRoutines(miniInput(POOL, { context: niggle('lower back') }), request, seed));
        for (const x of r.rows) {
          expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('hinge');
          expect(x.pattern).not.toBe('back-extension');
          expect(x.name).not.toBe('Barbell Row');
          expect(x.name).not.toBe('Barbell Back Squat');
        }
      }
    });

    it('control: without it each is taken by some seed', () => {
      const seen = new Set<string>();
      for (const seed of SEEDS_100) for (const x of one(buildRoutines(miniInput(POOL), request, seed)).rows) seen.add(x.name);
      for (const blocked of ['Romanian Deadlift (Barbell)', 'Back Extension', 'Barbell Row', 'Barbell Back Squat']) expect(seen.has(blocked), blocked).toBe(true);
    });

    it('states it, and keeps the chest-supported row and the leg press', () => {
      const r = one(buildRoutines(miniInput(POOL, { context: niggle('lower back', '2026-10-01') }), request, 2));
      expect(r.reasonLines).toContain('Lower back niggle on 1 Oct: no hinges, good mornings, bent-over barbell rows or back squats; chest-supported rows, leg press and hack squat preferred');
      expect(names(r)).toContain('Chest Supported Row');
      expect(names(r)).toContain('Leg Press');
    });
  });

  describe('knee', () => {
    const POOL = [
      cand('Bulgarian Split Squat', 'quads', { unilateral: true, weight: 16 }),
      cand('Walking Lunge', 'quads', { unilateral: true }),
      cand('Sissy Squat', 'quads', { equipment: 'bodyweight' }),
      cand('Barbell Back Squat', 'quads', { compound: true, equipment: 'barbell' }),
      cand('Leg Press', 'quads', { compound: true, equipment: 'machine' }),
      cand('Leg Extension', 'quads', { equipment: 'machine' }),
      cand('Hip Thrust (Barbell)', 'glutes', { compound: true, equipment: 'barbell' }),
    ];

    it('never takes a lunge, a split squat or a sissy squat', () => {
      for (const seed of SEEDS_100) {
        const r = one(buildRoutines(miniInput(POOL, { context: niggle('knee') }), { focus: ['quads', 'glutes'], count: 4 }, seed));
        for (const x of r.rows) {
          expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('lunge');
          expect(x.name).not.toBe('Sissy Squat');
        }
      }
      const seen = new Set<string>();
      for (const seed of SEEDS_100) for (const x of one(buildRoutines(miniInput(POOL), { focus: ['quads', 'glutes'], count: 4 }, seed)).rows) seen.add(x.name);
      for (const blocked of ['Bulgarian Split Squat', 'Walking Lunge']) expect(seen.has(blocked), blocked).toBe(true);
    });

    it('a sissy squat is a squat that bends the knee too far, and is left out with the others', () => {
      const pool = (ctx?: RoutineContext) => miniInput([cand('Sissy Squat', 'quads', { equipment: 'bodyweight' }), cand('Leg Extension', 'quads', { equipment: 'machine' })], ctx ? { context: ctx } : {});
      expect(names(one(buildRoutines(pool(), { focus: ['quads'], count: 2 }, 1))).sort()).toEqual(['Leg Extension', 'Sissy Squat']);
      expect(names(one(buildRoutines(pool(niggle('knee')), { focus: ['quads'], count: 2 }, 1)))).toEqual(['Leg Extension']);
    });

    it('states it', () => {
      const r = one(buildRoutines(miniInput(POOL, { context: niggle('knee') }), { focus: ['quads'], count: 3 }, 1));
      expect(r.reasonLines).toContain('Knee niggle on 28 Sep: no lunges, jumps, deep or sissy squats; leg press, leg curl and hip thrust preferred');
    });
  });

  describe('hamstring DOMS', () => {
    const POOL = [
      cand('Romanian Deadlift (Barbell)', 'hamstrings', { compound: true, equipment: 'barbell' }),
      cand('Lying Leg Curl (Machine)', 'hamstrings', { equipment: 'machine' }),
      cand('Hip Thrust (Barbell)', 'glutes', { compound: true, equipment: 'barbell' }),
    ];

    it('never takes a hinge or a leg curl, and states it', () => {
      for (const seed of SEEDS_100) {
        const r = one(buildRoutines(miniInput(POOL, { context: niggle('hamstring DOMS') }), { focus: ['hamstrings', 'glutes'], count: 3 }, seed));
        expect(names(r), `seed ${seed}`).toEqual(['Hip Thrust (Barbell)']);
      }
      const r = one(buildRoutines(miniInput(POOL, { context: niggle('hamstring DOMS') }), { focus: ['hamstrings', 'glutes'], count: 3 }, 1));
      expect(r.reasonLines).toContain('Hamstring DOMS on 28 Sep: no hinges or leg curls');
      expect(names(one(buildRoutines(miniInput(POOL), { focus: ['hamstrings', 'glutes'], count: 3 }, 1))).sort()).toEqual(['Hip Thrust (Barbell)', 'Lying Leg Curl (Machine)', 'Romanian Deadlift (Barbell)']);
    });
  });

  describe('what a niggle does not do', () => {
    const POOL = [cand('Barbell Row', 'upper back', { compound: true, equipment: 'barbell' }), cand('Seated Cable Row', 'upper back', { compound: true, equipment: 'cable' })];

    it('says nothing, and changes nothing, for a routine it has no say in: a shoulder niggle and a back routine', () => {
      const seen = new Set<string>();
      for (const seed of SEEDS_100) {
        const r = one(buildRoutines(miniInput(POOL, { context: niggle('shoulder') }), { focus: ['upper back'], count: 2 }, seed));
        r.rows.forEach((x) => seen.add(x.name));
        expect(r.reasonLines.some((l) => l.includes('niggle'))).toBe(false);
      }
      expect([...seen].sort()).toEqual(['Barbell Row', 'Seated Cable Row']);
    });

    it('an "other" niggle steers nothing and says nothing', () => {
      const r = one(buildRoutines(miniInput(POOL, { context: niggle('other') }), { focus: ['upper back'], count: 2 }, 1));
      expect(r.reasonLines.some((l) => l.toLowerCase().includes('niggle'))).toBe(false);
      expect(r.rows).toHaveLength(2);
    });

    it('two niggles are two lines, in a fixed order, and the latest date of one tag is the one said', () => {
      const pool = miniInput(
        [
          cand('Upright Row (Barbell)', 'shoulders', { compound: true, equipment: 'barbell' }),
          cand('Lateral Raise', 'shoulders'),
          cand('Walking Lunge', 'quads'),
          cand('Leg Press', 'quads', { compound: true, equipment: 'machine' }),
        ],
        {
          context: context({
            niggles: [
              { tag: 'knee', severity: 1, date: '2026-09-20' },
              { tag: 'shoulder', severity: 2, date: '2026-09-25' },
              { tag: 'shoulder', severity: 3, date: '2026-09-29' },
            ],
          }),
        },
      );
      const r = one(buildRoutines(pool, { focus: ['shoulders', 'quads'], count: 4 }, 1));
      const lines = r.reasonLines.filter((l) => l.includes('niggle'));
      expect(lines).toEqual([
        'Shoulder niggle on 29 Sep: no upright row, no behind-the-neck or barbell overhead press, no dips; neutral grips preferred',
        'Knee niggle on 20 Sep: no lunges, jumps, deep or sissy squats; leg press, leg curl and hip thrust preferred',
      ]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('rule: a stalled lift is swapped for a variation', () => {
  const CHEST = [
    cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }),
    cand('Incline DB Press', 'chest', { compound: true, weight: 24 }),
    cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
  ];
  const stall = (exerciseId: string, sessions = 3) => context({ stalled: [{ exerciseId, sessions }] });

  it('is replaced, and the line says by what', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(miniInput(CHEST, { context: stall('Bench Press (Barbell)') }), { focus: ['chest'], count: 2 }, seed));
      expect(names(r), `seed ${seed}`).not.toContain('Bench Press (Barbell)');
      expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: Incline DB Press in its place');
    }
  });

  it('control: the same lift not stalled is the one chosen', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(miniInput(CHEST), { focus: ['chest'], count: 2 }, seed));
      expect(names(r), `seed ${seed}`).toContain('Bench Press (Barbell)');
      expect(r.reasonLines.some((l) => l.includes('stalled'))).toBe(false);
    }
  });

  it('prefers the same part of the muscle and a different kind of equipment', () => {
    const pool = miniInput(
      [
        cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }),
        cand('Smith Machine Bench Press', 'chest', { compound: true, equipment: 'barbell' }),
        cand('Dumbbell Bench Press', 'chest', { compound: true, equipment: 'dumbbell' }),
        cand('Incline DB Press', 'chest', { compound: true }),
      ],
      { context: stall('Bench Press (Barbell)', 4) },
    );
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, seed));
      expect(names(r), `seed ${seed}`).toEqual(['Dumbbell Bench Press']);
      expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 4 sessions: Dumbbell Bench Press in its place');
    }
  });

  it('takes the same part of the muscle before another part, even from the library', () => {
    const pool = miniInput(
      [
        cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }),
        cand('Dumbbell Bench Press with Neutral Grip', 'chest', { compound: true, library: true }),
        cand('Incline DB Press', 'chest', { compound: true }),
      ],
      { context: stall('Bench Press (Barbell)') },
    );
    for (const seed of SEEDS_100.slice(0, 30)) {
      const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, seed));
      expect(names(r), `seed ${seed}`).toEqual(['Dumbbell Bench Press with Neutral Grip']);
      expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: Dumbbell Bench Press with Neutral Grip in its place');
    }
  });

  it('with nothing in the same part, takes one of the owner\'s own for another part before one from the library', () => {
    const pool = miniInput(
      [
        cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }),
        cand('Smith Machine Incline Bench Press', 'chest', { compound: true, library: true, equipment: 'machine' }),
        cand('Incline DB Press', 'chest', { compound: true }),
      ],
      { context: stall('Bench Press (Barbell)') },
    );
    for (const seed of SEEDS_100.slice(0, 30)) {
      const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, seed));
      expect(names(r), `seed ${seed}`).toEqual(['Incline DB Press']);
      expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: Incline DB Press in its place');
    }
  });

  it('a variation is another lift of the same kind: a stalled press is not swapped for a fly', () => {
    const pool = miniInput([cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }), cand('Cable Fly', 'chest', { equipment: 'cable' })], { context: stall('Bench Press (Barbell)') });
    const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, 1));
    expect(names(r)).toEqual(['Bench Press (Barbell)']);
    expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: no variation in your exercises or the library, kept');
  });

  it('with nothing to swap it for, keeps the lift and says there was no variation', () => {
    const pool = miniInput([cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 })], { context: stall('Bench Press (Barbell)') });
    const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, 1));
    expect(names(r)).toEqual(['Bench Press (Barbell)']);
    expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: no variation in your exercises or the library, kept');
  });

  it('never swaps one stalled lift for another', () => {
    const pool = miniInput(CHEST, { context: context({ stalled: [{ exerciseId: 'Bench Press (Barbell)', sessions: 3 }, { exerciseId: 'Incline DB Press', sessions: 5 }] }) });
    for (const seed of SEEDS_100.slice(0, 30)) {
      const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, seed));
      expect(['Bench Press (Barbell)', 'Incline DB Press']).toContain(r.rows[0]!.name);
      // With both stalled and nothing else of a pressing kind, the one drawn is kept.
      expect(r.reasonLines.some((l) => l.endsWith('kept'))).toBe(true);
      expect(r.reasonLines.some((l) => l.endsWith(' in its place'))).toBe(false);
    }
  });

  it('a stall in the real library is replaced by a same-pattern variation over 500 seeds', () => {
    const real = seededInput({ context: stall(SEED_EXERCISE_IDS['Bench Press (Barbell)'], 3) });
    const flat = new Set<string>();
    for (const seed of seedsFrom(500)) {
      const r = one(buildRoutines(real, { focus: ['chest'] }, seed));
      expect(r.rows.map((x) => x.name), `seed ${seed}`).not.toContain('Bench Press (Barbell)');
      const line = r.reasonLines.find((l) => l.startsWith('Bench Press (Barbell) stalled for 3 sessions: '));
      expect(line, `seed ${seed}`).toBeTruthy();
      flat.add(line!);
      // Its place is taken by a pressing movement for the chest.
      expect(r.rows.some((x) => x.muscleGroup === 'chest' && x.pattern.startsWith('press')), `seed ${seed}`).toBe(true);
    }
    expect([...flat].every((l) => l.endsWith(' in its place'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('rule: familiar first, some new', () => {
  const OWN_AND_LIBRARY = [
    cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
    cand('Lateral Raise', 'shoulders', { weight: 8 }),
    cand('Cable Lateral Raise', 'shoulders', { library: true, equipment: 'cable' }),
    cand('Seated Dumbbell Shoulder Press', 'shoulders', { library: true, compound: true }),
    cand('Front Raise', 'shoulders', { library: true }),
  ];

  it('takes the owner\'s own exercise for a part of the muscle they can cover, and the library only for the one they cannot', () => {
    for (const seed of SEEDS_100) {
      const r = one(buildRoutines(miniInput(OWN_AND_LIBRARY), { focus: ['shoulders'], count: 3 }, seed));
      expect(names(r).sort(), `seed ${seed}`).toEqual(['DB Shoulder Press', 'Front Raise', 'Lateral Raise']);
      expect(r.rows.filter((x) => x.origin === 'catalogue').map((x) => x.name)).toEqual(['Front Raise']);
    }
  });

  it('control: with none of the owner\'s own, the library fills every part', () => {
    const libraryOnly = OWN_AND_LIBRARY.map((c) => (c.origin === 'own' ? { ...c, id: `cat:${c.id}`, origin: 'catalogue' as const, catalogueSlug: c.id } : c));
    const r = one(buildRoutines(miniInput(libraryOnly), { focus: ['shoulders'], count: 3 }, 1));
    expect(r.rows.every((x) => x.origin === 'catalogue')).toBe(true);
  });

  it('takes at most three from the library however many it is offered, and says the routine is short when the cap is why', () => {
    const pool = miniInput([
      cand('Seated Dumbbell Shoulder Press', 'shoulders', { library: true, compound: true }),
      cand('Cable Lateral Raise', 'shoulders', { library: true, equipment: 'cable' }),
      cand('Front Raise', 'shoulders', { library: true }),
      cand('Reverse Flyes', 'shoulders', { library: true }),
      cand('Dumbbell One-Arm Upright Row', 'shoulders', { library: true, compound: true }),
      cand('Cable Rope Rear-Delt Rows', 'shoulders', { library: true, equipment: 'cable' }),
    ]);
    for (const seed of SEEDS_100.slice(0, 30)) {
      const r = one(buildRoutines(pool, { focus: ['shoulders'], count: 6 }, seed));
      expect(r.rows.filter((x) => x.origin === 'catalogue')).toHaveLength(MAX_NEW_EXERCISES);
      expect(r.rows).toHaveLength(3);
      expect(r.reasonLines).toContain('3 of 6 exercises: 3 from the library is the most for one routine, and your own have nothing more for shoulders');
    }
  });

  it('of the owner\'s own, one with a working weight is drawn about twice as often as one without', () => {
    const pool = miniInput([cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }), cand('Arnold Press', 'shoulders', { compound: true })]);
    const known = SEEDS_400.filter((seed) => one(buildRoutines(pool, { focus: ['shoulders'], count: 1 }, seed)).rows[0]!.name === 'DB Shoulder Press').length;
    expect(known / SEEDS_400.length).toBeGreaterThan(0.6);
    expect(known / SEEDS_400.length).toBeLessThan(0.74);
  });

  it('an exercise done yesterday is as good a pick as any other: a routine is for a later day', () => {
    const pool = miniInput([cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18, daysSinceUsed: 0 }), cand('Arnold Press', 'shoulders', { compound: true, weight: 18, daysSinceUsed: 12 })]);
    const yesterday = SEEDS_400.filter((seed) => one(buildRoutines(pool, { focus: ['shoulders'], count: 1 }, seed)).rows[0]!.name === 'DB Shoulder Press').length;
    expect(yesterday / SEEDS_400.length).toBeGreaterThan(0.4);
    expect(yesterday / SEEDS_400.length).toBeLessThan(0.6);
  });

  it('never gives a library exercise a weight, and never invents one for an own exercise with none', () => {
    const r = one(buildRoutines(miniInput(OWN_AND_LIBRARY), { focus: ['shoulders'], count: 3 }, 1));
    for (const x of r.rows) {
      if (x.origin === 'catalogue' || x.name === 'DB Shoulder Press' && false) expect(x.weightKg).toBeNull();
    }
    expect(r.rows.find((x) => x.name === 'DB Shoulder Press')!.weightKg).toBe(18);
    expect(r.rows.find((x) => x.name === 'Front Raise')!.weightKg).toBeNull();
    const calibrating = { ...cand('DB Shoulder Press', 'shoulders', { compound: true }), base: { sets: 3, repMin: 8, repMax: 10, weightKg: null, mode: 'calibrating' as const } };
    expect(one(buildRoutines(miniInput([calibrating]), { focus: ['shoulders'], count: 1 }, 1)).rows[0]!.weightKg).toBeNull();
  });

  it('a library exercise carries its slug, and its reason says it is new', () => {
    const r = one(buildRoutines(miniInput(OWN_AND_LIBRARY), { focus: ['shoulders'], count: 3 }, 1));
    const front = r.rows.find((x) => x.name === 'Front Raise')!;
    expect(front.catalogueSlug).toBe('front-raise');
    expect(front.id).toBe('cat:front-raise');
    expect(front.reason).toBe('shoulders · front delts (front raise) · new to you, no weight yet');
  });
});

// ---------------------------------------------------------------------------

describe('rule: time', () => {
  const REAL = seededInput({ recency: { shoulders: 6 } });
  const SHOULDERS: RoutineRequest = { focus: ['shoulders', 'rear delts'] };

  it('says how long it takes at the owner\'s pace: slower at 1.5 and longer for it', () => {
    const base = one(buildRoutines(REAL, SHOULDERS, 1));
    const slow = one(buildRoutines({ ...REAL, pace: 1.5 }, SHOULDERS, 1));
    expect(slow.estimateMinutes).toBeGreaterThan(base.estimateMinutes);
    expect(slow.reasonLines).toContain(`About ${slow.estimateMinutes} min at your pace`);
  });

  it('is exactly the time the short-session model gives the rows', () => {
    const r = one(buildRoutines(REAL, SHOULDERS, 1));
    const byId = new Map(REAL.candidates.map((c) => [c.id, c]));
    const rows = r.rows.map((x) => {
      const c = byId.get(x.id)!;
      const restSec = restSecondsFor(null, { defaultRestSec: c.defaultRestSec, kind: c.kind, isCompound: c.isCompound }, { restCompoundSec: 150, restIsolationSec: 75, restCarrySec: 90 });
      return { sets: x.sets, restSec, candidate: c };
    });
    expect(r.estimateMinutes).toBe(estimateMinutes(rows, 1));
    expect(estimateMinutes(rows, 1.5)).toBe(one(buildRoutines({ ...REAL, pace: 1.5 }, SHOULDERS, 1)).estimateMinutes);
  });

  it('a duration asked for drops finishers first and never the main lift', () => {
    const full = one(buildRoutines(REAL, SHOULDERS, 1));
    const asked = one(buildRoutines(REAL, { ...SHOULDERS, minutes: 28 }, 1));
    expect(asked.rows.length).toBeLessThan(full.rows.length);
    expect(asked.rows[0]!.tier).toBe('primary');
    expect(asked.rows[0]!.name).toBe(full.rows[0]!.name);
    expect(asked.estimateMinutes).toBeLessThanOrEqual(28);
    expect(asked.estimateMinutes).toBeLessThan(full.estimateMinutes);
    const dropped = full.rows.filter((x) => !asked.rows.some((y) => y.id === x.id));
    // What was dropped is isolation work.
    expect(dropped.every((x) => x.tier === 'isolation')).toBe(true);
    expect(asked.reasonLines.some((l) => l.startsWith('Dropped ') && l.endsWith(' to come nearer the 28 min asked'))).toBe(true);
  });

  it('control: a duration the routine already fits in changes nothing and adds nothing', () => {
    const full = one(buildRoutines(REAL, SHOULDERS, 1));
    const roomy = one(buildRoutines(REAL, { ...SHOULDERS, minutes: 90 }, 1));
    expect(roomy).toEqual(full);
    expect(roomy.reasonLines.some((l) => l.startsWith('Dropped'))).toBe(false);
  });

  it('keeps a part of every muscle while it trims: a second exercise for a part goes before the only one', () => {
    for (const seed of SEEDS_100.slice(0, 60)) {
      const full = one(buildRoutines(REAL, SHOULDERS, seed));
      const asked = one(buildRoutines(REAL, { ...SHOULDERS, minutes: full.estimateMinutes - 5 }, seed));
      expect(asked.rows.length, `seed ${seed}`).toBeLessThan(full.rows.length);
      const regions = new Set(asked.rows.map((x) => x.region));
      for (const region of ['shoulders:front', 'shoulders:side', 'shoulders:rear']) expect(regions, `seed ${seed}`).toContain(region);
    }
  });

  it('never goes below two exercises, and never clamps the time to the minutes asked', () => {
    const tiny = one(buildRoutines(REAL, { ...SHOULDERS, minutes: 5 }, 1));
    expect(tiny.rows).toHaveLength(2);
    expect(tiny.rows[0]!.tier).toBe('primary');
    expect(tiny.estimateMinutes).toBeGreaterThan(5);
    expect(tiny.reasonLines).toContain(`About ${tiny.estimateMinutes} min at your pace`);
  });

  it('a split reads the duration per day', () => {
    for (const d of buildRoutines(REAL, { focus: [], split: 'ppl', minutes: 30 }, 1)) {
      expect(d.estimateMinutes, d.name).toBeLessThanOrEqual(30);
    }
  });
});

// ---------------------------------------------------------------------------

describe('reasons, word for word', () => {
  const POOL = miniInput(
    [
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 22 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Rear Delt Fly (Machine)', 'rear delts', { equipment: 'machine' }),
      cand('Front Raise', 'shoulders', { library: true }),
    ],
    { recency: { shoulders: 6, 'rear delts': 12 } },
  );

  it('says what each row is for', () => {
    const r = one(buildRoutines(POOL, { focus: ['shoulders', 'rear delts'], count: 4 }, 1));
    expect(r.rows.map((x) => [x.name, x.reason])).toEqual([
      ['DB Shoulder Press', 'shoulders · front delts (vertical press) · last trained 6 days ago · your working weight 22 kg'],
      ['Lateral Raise', 'shoulders · side delts (lateral raise) · last trained 6 days ago · your working weight 8 kg'],
      ['Front Raise', 'shoulders · front delts (front raise) · new to you, no weight yet'],
      ['Rear Delt Fly (Machine)', 'rear delts · rear delts (rear fly) · last trained 12 days ago · no weight yet'],
    ]);
  });

  it('says what the routine is, as lines', () => {
    const r = one(buildRoutines(POOL, { focus: ['shoulders', 'rear delts'], count: 4 }, 1));
    expect(r.reasonLines).toEqual([
      'Focus: shoulders and rear delts, as asked',
      'One exercise per movement: vertical press, lateral raise, front raise and rear fly',
      'Weights are your own working weights; new exercises have none yet',
      `About ${r.estimateMinutes} min at your pace`,
    ]);
  });

  it('words the days since: today, yesterday, never', () => {
    const pool = (recency: Partial<Record<MuscleGroup, number>>) => miniInput([cand('Lateral Raise', 'shoulders', { weight: 8 })], { recency });
    const reason = (recency: Partial<Record<MuscleGroup, number>>) => one(buildRoutines(pool(recency), { focus: ['shoulders'], count: 1 }, 1)).rows[0]!.reason;
    expect(reason({ shoulders: 0 })).toBe('shoulders · side delts (lateral raise) · trained today · your working weight 8 kg');
    expect(reason({ shoulders: 1 })).toBe('shoulders · side delts (lateral raise) · last trained yesterday · your working weight 8 kg');
    expect(reason({})).toBe('shoulders · side delts (lateral raise) · not trained yet · your working weight 8 kg');
  });

  it('gives a split day its name in the focus line, and a spread says no muscle was asked for', () => {
    const real = seededInput();
    expect(buildRoutines(real, { focus: [], split: 'ppl' }, 1).map((d) => d.reasonLines[0]!.replace(/^Focus: .* \(/, '('))).toEqual(['(push day)', '(pull day)', '(legs day)']);
    expect(one(buildRoutines(real, { focus: [] }, 1)).reasonLines[0]).toMatch(/^Focus: .*, no muscle asked for$/);
  });

  it('weights line: own weights alone, own with none logged, and new exercises', () => {
    const own = miniInput([cand('Lateral Raise', 'shoulders', { weight: 8 })]);
    expect(one(buildRoutines(own, { focus: ['shoulders'], count: 1 }, 1)).reasonLines).toContain('Weights are your own working weights');
    const none = miniInput([cand('Lateral Raise', 'shoulders')]);
    expect(one(buildRoutines(none, { focus: ['shoulders'], count: 1 }, 1)).reasonLines).toContain('Weights are your own working weights; exercises with none logged have none yet');
    const fresh = miniInput([cand('Lateral Raise', 'shoulders', { library: true })]);
    expect(one(buildRoutines(fresh, { focus: ['shoulders'], count: 1 }, 1)).reasonLines).toContain('Weights are your own working weights; new exercises have none yet');
  });

  it('every line is a plain fact: no question, no encouragement, no advice', () => {
    const real = seededInput({ context: context({ niggles: [{ tag: 'shoulder', severity: 2, date: '2026-09-28' }], stalled: [{ exerciseId: 'Bench Press (Barbell)', sessions: 3 }] }) });
    const banned = /\b(you should|try|remember|great|nice|good luck|let's|don't forget|aim|consider|tip)\b|[!?]/i;
    for (const request of [{ focus: ['shoulders', 'rear delts'] }, { focus: ['chest'] }, { focus: [], split: 'ppl' }, { focus: [] }] as RoutineRequest[]) {
      for (const seed of seedsFrom(40)) {
        for (const r of buildRoutines(real, request, seed)) {
          for (const line of [...r.reasonLines, ...r.rows.map((x) => x.reason)]) expect(line, line).not.toMatch(banned);
        }
      }
    }
  });
});
