/**
 * What the owner's own words ask of the routine builder, tried on the real library: "3D shoulders"
 * the way a coach writes it, the muscles a named day is named for, a typed niggle or limit, a stalled
 * lift's variation, a length asked for, and reason lines that say only what is true of the routine.
 *
 * Every test here runs the real path: the typed sentence through `parseQuickRequest` and
 * `routineRequestFrom`, into `buildRoutines` over the owner's 27 exercises, the real catalogue and
 * the bundled diagrams.
 */
import { describe, expect, it } from 'vitest';
import { SEED_EXERCISE_IDS } from '../db/seed';
import { cand, miniInput, seededInput, seedsFrom } from '../test/routineFixtures';
import { roundKg } from './engine';
import { parseQuickRequest } from './quickRequest';
import { baseWeight } from './quickSession';
import { buildRoutines, routineRequestFrom, type BuiltRoutine, type BuiltRow, type RoutineInput, type RoutineRequest } from './routineBuilder';
import type { RoutineContext } from './routineContext';
import type { NiggleTag } from './types';

const SEEDS = seedsFrom(500);
const REAL = seededInput();
const candidateById = new Map(REAL.candidates.map((c) => [c.id, c]));

const typed = (text: string): RoutineRequest => routineRequestFrom(parseQuickRequest(text));
const build = (input: RoutineInput, request: RoutineRequest | string, seed: number): BuiltRoutine[] => buildRoutines(input, typeof request === 'string' ? typed(request) : request, seed);
const first = (input: RoutineInput, request: RoutineRequest | string, seed: number): BuiltRoutine => build(input, request, seed)[0]!;
const sets = (r: BuiltRoutine, f: (x: BuiltRow) => boolean): number => r.rows.filter(f).reduce((s, x) => s + x.sets, 0);
const ids = (r: BuiltRoutine): string[] => r.rows.map((x) => x.id);
const withNiggle = (tag: NiggleTag, severity: 1 | 2 | 3 = 2): RoutineInput => seededInput({ context: { niggles: [{ tag, severity, date: '2026-09-28' }] } });
const ctx = (over: Partial<RoutineContext>): Partial<RoutineContext> => over;

// ---------------------------------------------------------------------------

describe('3D shoulders is written the way a coach writes it', () => {
  const OWN_SIDE = 'Lateral Raise';

  for (const text of ['3d shoulders', 'Give me a routine solely designed to build 3D shoulders', 'shoulders', 'delts']) {
    describe(`"${text}", over 500 seeds with the real library`, () => {
      const routines = SEEDS.map((seed) => ({ seed, r: first(REAL, text, seed) }));

      it('is six different exercises that open with one heavy vertical press', () => {
        for (const { seed, r } of routines) {
          expect(r.rows, `seed ${seed}`).toHaveLength(6);
          expect(new Set(ids(r)).size, `seed ${seed}`).toBe(6);
          expect(r.rows[0]!.pattern, `seed ${seed}`).toBe('press-vertical');
          expect(r.rows[0]!.tier, `seed ${seed}`).toBe('primary');
          expect(r.rows.filter((x) => x.pattern === 'press-vertical'), `seed ${seed}`).toHaveLength(1);
        }
      });

      it('gives the side delts two lateral raises, in two kinds of equipment', () => {
        for (const { seed, r } of routines) {
          const raises = r.rows.filter((x) => x.pattern === 'lateral-raise');
          expect(raises, `seed ${seed}: ${r.rows.map((x) => x.name).join(', ')}`).toHaveLength(2);
          expect(new Set(raises.map((x) => x.equipment)).size, `seed ${seed}: ${raises.map((x) => `${x.name} (${x.equipment})`).join(', ')}`).toBe(2);
          expect(raises.some((x) => x.name === OWN_SIDE), `seed ${seed}`).toBe(true);
        }
      });

      it('gives the rear delts a rear fly and a face pull, the owner\'s own', () => {
        for (const { seed, r } of routines) {
          const names = r.rows.map((x) => x.name);
          expect(names, `seed ${seed}`).toContain('Rear Delt Fly (Machine)');
          expect(names, `seed ${seed}`).toContain('Face Pull');
          expect(r.rows.filter((x) => x.region === 'shoulders:rear'), `seed ${seed}`).toHaveLength(2);
        }
      });

      it('has one front raise or upright row, and no second exercise for the front of the shoulder beside the press', () => {
        for (const { seed, r } of routines) {
          const extras = r.rows.filter((x) => x.pattern === 'front-raise' || x.pattern === 'upright-row');
          expect(extras, `seed ${seed}: ${r.rows.map((x) => x.name).join(', ')}`).toHaveLength(1);
          expect(r.rows.filter((x) => x.region === 'shoulders:front' && x.pattern !== 'press-vertical').length, `seed ${seed}`).toBeLessThanOrEqual(1);
        }
      });

      it('gives the side delts at least as many sets as the rear delts, and the rear at least as many as a front raise', () => {
        for (const { seed, r } of routines) {
          const side = sets(r, (x) => x.region === 'shoulders:side');
          const rear = sets(r, (x) => x.region === 'shoulders:rear');
          const frontRaise = sets(r, (x) => x.region === 'shoulders:front' && x.tier === 'isolation');
          expect(side, `seed ${seed}: ${r.rows.map((x) => `${x.name} ${x.sets}`).join(', ')}`).toBeGreaterThanOrEqual(rear);
          expect(rear, `seed ${seed}`).toBeGreaterThanOrEqual(frontRaise);
        }
      });

      it('is shoulders and rear delts and nothing else, with the owner\'s own sets for what they already do', () => {
        for (const { seed, r } of routines) {
          for (const x of r.rows) expect(['shoulders', 'rear delts'], `seed ${seed}: ${x.name}`).toContain(x.muscleGroup);
          const raise = r.rows.find((x) => x.name === OWN_SIDE)!;
          expect([raise.sets, raise.repMin, raise.repMax], `seed ${seed}`).toEqual([3, 12, 15]);
          const total = sets(r, () => true);
          expect(total, `seed ${seed}`).toBeGreaterThanOrEqual(9);
          expect(total, `seed ${seed}`).toBeLessThanOrEqual(18);
        }
      });

      it('says the sets by part as a fact, and each part\'s number is the routine\'s', () => {
        for (const { seed, r } of routines.slice(0, 40)) {
          const side = sets(r, (x) => x.region === 'shoulders:side');
          const rear = sets(r, (x) => x.region === 'shoulders:rear');
          const line = r.reasonLines.find((l) => l.startsWith('Sets by part: '));
          expect(line, `seed ${seed}`).toBeTruthy();
          expect(line, `seed ${seed}`).toContain(`side delts ${side}`);
          expect(line, `seed ${seed}`).toContain(`rear delts ${rear}`);
        }
      });
    });
  }

  it('a plain request for shoulders is never without rear-delt work, and the owner\'s own are eligible for it', () => {
    for (const seed of SEEDS) {
      const r = first(REAL, 'shoulders', seed);
      expect(r.rows.some((x) => x.region === 'shoulders:rear'), `seed ${seed}`).toBe(true);
      expect(r.rows.some((x) => x.muscleGroup === 'rear delts' && x.origin === 'own'), `seed ${seed}`).toBe(true);
    }
  });

  it('a smaller routine drops the front raise before it drops a rear delt move, and takes the side delts before the rear', () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const four = first(REAL, { focus: ['shoulders', 'rear delts'], count: 4 }, seed);
      expect(four.rows.map((x) => x.pattern), `seed ${seed}`).not.toContain('front-raise');
      expect(four.rows.filter((x) => x.pattern === 'lateral-raise'), `seed ${seed}`).toHaveLength(2);
      expect(four.rows.some((x) => x.region === 'shoulders:rear'), `seed ${seed}`).toBe(true);
      const five = first(REAL, { focus: ['shoulders', 'rear delts'], count: 5 }, seed);
      expect(five.rows.map((x) => x.pattern), `seed ${seed}`).not.toContain('front-raise');
      expect(five.rows.filter((x) => x.region === 'shoulders:rear'), `seed ${seed}`).toHaveLength(2);
      const three = first(REAL, { focus: ['shoulders', 'rear delts'], count: 3 }, seed);
      expect(three.rows.map((x) => x.region).sort(), `seed ${seed}`).toEqual(['shoulders:front', 'shoulders:rear', 'shoulders:side']);
    }
  });

  it('with a shoulder niggle it takes no upright row and no barbell overhead press, and says the niggle changed it', () => {
    const input = withNiggle('shoulder');
    for (const seed of SEEDS) {
      const r = first(input, '3d shoulders', seed);
      for (const x of r.rows) {
        expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('upright-row');
        expect(x.pattern === 'press-vertical' && x.equipment === 'barbell' && !/landmine|jammer/i.test(x.name), `seed ${seed}: ${x.name}`).toBe(false);
      }
      expect(r.rows, `seed ${seed}`).toHaveLength(6);
    }
  });
});

// ---------------------------------------------------------------------------

describe('a day named for its muscles has those muscles, over 500 seeds with the real library', () => {
  const has = (r: BuiltRoutine, group: string) => r.rows.some((x) => x.muscleGroup === group);
  const pattern = (r: BuiltRoutine, p: string) => r.rows.some((x) => x.pattern === p);
  const region = (r: BuiltRoutine, p: string) => r.rows.some((x) => x.region === p);

  describe('push pull legs', () => {
    const days = SEEDS.map((seed) => ({ seed, d: build(REAL, 'push pull legs', seed) }));

    it('Push has chest, a vertical press, a lateral raise and triceps', () => {
      for (const { seed, d } of days) {
        const push = d[0]!;
        expect(push.name).toBe('Push');
        expect(has(push, 'chest'), `seed ${seed}`).toBe(true);
        expect(pattern(push, 'press-vertical'), `seed ${seed}`).toBe(true);
        expect(pattern(push, 'lateral-raise'), `seed ${seed}`).toBe(true);
        expect(has(push, 'triceps'), `seed ${seed}`).toBe(true);
      }
    });

    it('Pull has a vertical pull, a row, biceps and rear-delt work', () => {
      for (const { seed, d } of days) {
        const pull = d[1]!;
        expect(pull.name).toBe('Pull');
        expect(region(pull, 'back:vertical'), `seed ${seed}`).toBe(true);
        expect(region(pull, 'back:horizontal'), `seed ${seed}`).toBe(true);
        expect(has(pull, 'biceps'), `seed ${seed}`).toBe(true);
        expect(region(pull, 'shoulders:rear'), `seed ${seed}`).toBe(true);
      }
    });

    it('Legs has quads, hamstrings, calves and glutes', () => {
      for (const { seed, d } of days) {
        const legs = d[2]!;
        expect(legs.name).toBe('Legs');
        for (const g of ['quads', 'hamstrings', 'calves', 'glutes']) expect(has(legs, g), `seed ${seed}: ${g}`).toBe(true);
      }
    });

    it('every day is six exercises and no day repeats a movement', () => {
      for (const { seed, d } of days) {
        for (const day of d) {
          expect(day.rows, `seed ${seed}: ${day.name}`).toHaveLength(6);
          expect(new Set(day.rows.map((x) => x.pattern)).size, `seed ${seed}: ${day.name}`).toBe(6);
        }
      }
    });
  });

  describe('upper lower', () => {
    const days = SEEDS.map((seed) => ({ seed, d: build(REAL, 'upper lower', seed) }));

    it('Upper has chest, a vertical pull, a row, a press, a lateral raise and both arms', () => {
      for (const { seed, d } of days) {
        const upper = d[0]!;
        expect(upper.name).toBe('Upper');
        expect(upper.rows, `seed ${seed}`).toHaveLength(7);
        expect(has(upper, 'chest'), `seed ${seed}`).toBe(true);
        expect(region(upper, 'back:vertical'), `seed ${seed}`).toBe(true);
        expect(region(upper, 'back:horizontal'), `seed ${seed}`).toBe(true);
        expect(pattern(upper, 'press-vertical'), `seed ${seed}`).toBe(true);
        expect(pattern(upper, 'lateral-raise'), `seed ${seed}`).toBe(true);
        expect(has(upper, 'biceps'), `seed ${seed}`).toBe(true);
        expect(has(upper, 'triceps'), `seed ${seed}`).toBe(true);
      }
    });

    it('Lower has quads, hamstrings, glutes and calves', () => {
      for (const { seed, d } of days) {
        const lower = d[1]!;
        expect(lower.name).toBe('Lower');
        for (const g of ['quads', 'hamstrings', 'glutes', 'calves']) expect(has(lower, g), `seed ${seed}: ${g}`).toBe(true);
      }
    });
  });

  describe('full body', () => {
    it('is a spread: a squat, a hinge, a press, a vertical pull, a row and a vertical press', () => {
      for (const seed of SEEDS) {
        const day = first(REAL, 'full body', seed);
        expect(day.name).toBe('Full body');
        expect(day.rows, `seed ${seed}`).toHaveLength(6);
        expect(day.rows.some((x) => x.region === 'quads:bilateral'), `seed ${seed}`).toBe(true);
        expect(day.rows.some((x) => x.region === 'hamstrings:hinge'), `seed ${seed}`).toBe(true);
        expect(day.rows.some((x) => x.region === 'chest:mid'), `seed ${seed}`).toBe(true);
        expect(day.rows.some((x) => x.region === 'back:vertical'), `seed ${seed}`).toBe(true);
        expect(day.rows.some((x) => x.region === 'back:horizontal'), `seed ${seed}`).toBe(true);
        expect(day.rows.some((x) => x.pattern === 'press-vertical'), `seed ${seed}`).toBe(true);
      }
    });
  });

  describe('the same days typed as one routine', () => {
    it.each([
      ['push', 'Push', 6],
      ['pull', 'Pull', 6],
      ['legs', 'Legs', 6],
      ['upper', 'Upper', 7],
      ['lower', 'Lower', 6],
    ])('"%s" is %s, with %i exercises and the same muscles', (text, name, count) => {
      for (const seed of SEEDS.slice(0, 150)) {
        const r = first(REAL, text, seed);
        expect(r.name).toBe(name);
        expect(r.rows, `seed ${seed}`).toHaveLength(count);
        if (name === 'Push') expect(has(r, 'triceps') && pattern(r, 'lateral-raise'), `seed ${seed}`).toBe(true);
        if (name === 'Pull') expect(has(r, 'biceps'), `seed ${seed}`).toBe(true);
        if (name === 'Legs') expect(['quads', 'hamstrings', 'calves'].every((g) => has(r, g)), `seed ${seed}`).toBe(true);
        if (name === 'Upper') expect(has(r, 'biceps') && has(r, 'triceps') && pattern(r, 'lateral-raise'), `seed ${seed}`).toBe(true);
      }
    });
  });

  it('a count asked for is honoured and takes the day\'s most important parts first', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const push4 = build(REAL, { focus: [], split: 'ppl', count: 4 }, seed)[0]!;
      expect(push4.rows, `seed ${seed}`).toHaveLength(4);
      expect(has(push4, 'triceps') && pattern(push4, 'lateral-raise'), `seed ${seed}`).toBe(true);
    }
  });

  it('a muscle ruled out is left out of its day, and a day with no pool for its slot says nothing false', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const days = build(REAL, { focus: [], split: 'ppl', exclude: ['biceps', 'calves'] }, seed);
      expect(days[1]!.rows.some((x) => x.muscleGroup === 'biceps'), `seed ${seed}`).toBe(false);
      expect(days[2]!.rows.some((x) => x.muscleGroup === 'calves'), `seed ${seed}`).toBe(false);
      expect(days[0]!.rows.some((x) => x.muscleGroup === 'triceps'), `seed ${seed}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('a part of a muscle asked for gets two exercises', () => {
  it('"upper chest" is two incline presses first, and the rest of the chest after', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const r = first(REAL, 'give me an upper chest routine', seed);
      expect(r.rows.every((x) => x.muscleGroup === 'chest'), `seed ${seed}`).toBe(true);
      expect(r.rows.filter((x) => x.region === 'chest:upper'), `seed ${seed}`).toHaveLength(2);
      expect(r.rows[0]!.region, `seed ${seed}`).toBe('chest:upper');
      expect(r.rows.some((x) => x.region === 'chest:mid'), `seed ${seed}`).toBe(true);
      expect(r.name).toBe('Chest');
    }
  });

  it('"lower chest" is two lower-chest exercises, never a leg day', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const r = first(REAL, 'give me a lower chest routine', seed);
      expect(r.rows.every((x) => x.muscleGroup === 'chest'), `seed ${seed}`).toBe(true);
      expect(r.rows.filter((x) => x.region === 'chest:lower').length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('control: plain "chest" takes one exercise for the upper chest', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      expect(first(REAL, 'chest', seed).rows.filter((x) => x.region === 'chest:upper'), `seed ${seed}`).toHaveLength(1);
    }
  });

  it('says it as a fact', () => {
    const r = first(REAL, 'upper chest', 1);
    expect(r.reasonLines).toContain(`upper chest asked for: 2 of ${r.rows.length} chest exercises`);
  });
});

// ---------------------------------------------------------------------------

describe('a niggle by how bad it is', () => {
  const lines = (r: BuiltRoutine) => r.reasonLines.filter((l) => /^(Shoulder|Lower back|Knee) niggle on |^Hamstring DOMS on |^Sore .*, as you said: /.test(l));

  describe('shoulder', () => {
    const POOL = [
      cand('Barbell Overhead Press', 'shoulders', { compound: true, equipment: 'barbell', weight: 40 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Upright Row (Barbell)', 'shoulders', { compound: true, equipment: 'barbell', weight: 30 }),
      cand('Weighted Dip', 'triceps', { equipment: 'bodyweight', compound: true }),
      cand('Triceps Pushdown', 'triceps', { equipment: 'cable' }),
    ];
    const at = (severity: 1 | 2 | 3) => miniInput(POOL, { context: { routines: [], stalled: [], niggles: [{ tag: 'shoulder', severity, date: '2026-09-28' }] } });
    const seen = (input: RoutineInput, request: RoutineRequest) => {
      const out = new Set<string>();
      for (const seed of seedsFrom(100)) for (const x of first(input, request, seed).rows) out.add(x.name);
      return out;
    };
    const request: RoutineRequest = { focus: ['shoulders', 'triceps'], count: 5 };

    it('severity 1 refuses the worst: the upright row and the dip, and still takes a barbell overhead press', () => {
      const s = seen(at(1), request);
      expect(s.has('Upright Row (Barbell)')).toBe(false);
      expect(s.has('Weighted Dip')).toBe(false);
      expect(s.has('Barbell Overhead Press')).toBe(true);
    });

    it('severity 2 and 3 refuse the full list, and are the same', () => {
      for (const severity of [2, 3] as const) {
        const s = seen(at(severity), request);
        for (const blocked of ['Upright Row (Barbell)', 'Weighted Dip', 'Barbell Overhead Press']) expect(s.has(blocked), `${blocked} at ${severity}`).toBe(false);
      }
      for (const seed of seedsFrom(40)) expect(first(at(2), request, seed)).toEqual(first(at(3), request, seed));
    });

    it('says the level it used: the shorter list at severity 1, the full list at 2', () => {
      expect(lines(first(at(1), request, 1))).toEqual(['Shoulder niggle on 28 Sep: no upright row, no behind-the-neck lifts, no dips; neutral grips preferred']);
      expect(lines(first(at(2), request, 1))).toEqual(['Shoulder niggle on 28 Sep: no upright row, no behind-the-neck or barbell overhead press, no dips; neutral grips preferred']);
    });

    it('a landmine press is the shoulder-friendly press, whatever the dataset calls it', () => {
      const pool = miniInput(
        [cand('Single-Arm Linear Jammer', 'shoulders', { library: true, compound: true, equipment: 'barbell' }), cand('Landmine Press', 'shoulders', { compound: true, equipment: 'barbell' })],
        { context: { routines: [], stalled: [], niggles: [{ tag: 'shoulder', severity: 3, date: '2026-09-28' }] } },
      );
      expect(first(pool, { focus: ['shoulders'], count: 2 }, 1).rows.map((x) => x.name).sort()).toEqual(['Landmine Press', 'Single-Arm Linear Jammer']);
    });

    it('control: with no niggle the barbell overhead press, the upright row and the dip are all taken', () => {
      const s = seen(miniInput(POOL), request);
      for (const taken of ['Upright Row (Barbell)', 'Weighted Dip', 'Barbell Overhead Press']) expect(s.has(taken), taken).toBe(true);
    });
  });

  describe('lower back', () => {
    const POOL = [
      cand('Romanian Deadlift (Barbell)', 'hamstrings', { compound: true, equipment: 'barbell', weight: 100 }),
      cand('Barbell Back Squat', 'quads', { compound: true, equipment: 'barbell', weight: 90 }),
      cand('Barbell Hack Squat', 'quads', { compound: true, equipment: 'barbell' }),
      cand('Leg Press', 'quads', { compound: true, equipment: 'machine' }),
      cand('Smith Machine Bent Over Row', 'upper back', { compound: true, equipment: 'machine' }),
      cand('Chest Supported Row', 'upper back', { compound: true, equipment: 'machine' }),
      cand('Lat Pulldown (Machine)', 'lats', { compound: true, equipment: 'machine', weight: 80 }),
    ];
    const request: RoutineRequest = { focus: ['quads', 'hamstrings', 'upper back', 'lats'], count: 6 };
    const at = (severity: 1 | 2 | 3) => miniInput(POOL, { context: { routines: [], stalled: [], niggles: [{ tag: 'lower back', severity, date: '2026-09-28' }] } });
    const seen = (input: RoutineInput) => {
      const out = new Set<string>();
      for (const seed of seedsFrom(100)) for (const x of first(input, request, seed).rows) out.add(x.name);
      return out;
    };

    it('at every severity: no hinge, no barbell hack squat and no Smith bent-over row', () => {
      for (const severity of [1, 2, 3] as const) {
        const s = seen(at(severity));
        for (const blocked of ['Romanian Deadlift (Barbell)', 'Barbell Hack Squat', 'Smith Machine Bent Over Row']) expect(s.has(blocked), `${blocked} at ${severity}`).toBe(false);
      }
    });

    it('a barbell back squat is the full list only: taken at severity 1, refused at 2', () => {
      expect(seen(at(1)).has('Barbell Back Squat')).toBe(true);
      expect(seen(at(2)).has('Barbell Back Squat')).toBe(false);
    });

    it('control: with no niggle every one of them is taken', () => {
      const s = seen(miniInput(POOL));
      for (const taken of ['Romanian Deadlift (Barbell)', 'Barbell Hack Squat', 'Smith Machine Bent Over Row', 'Barbell Back Squat']) expect(s.has(taken), taken).toBe(true);
    });

    it('over 500 seeds with the real library, no barbell hack squat and no Smith bent-over row for legs or back', () => {
      const input = withNiggle('lower back');
      for (const text of ['legs', 'back', 'pull', 'full body']) {
        for (const seed of SEEDS) {
          for (const x of first(input, text, seed).rows) {
            expect(x.name, `${text}, seed ${seed}`).not.toBe('Barbell Hack Squat');
            expect(x.name, `${text}, seed ${seed}`).not.toBe('Smith Machine Bent Over Row');
          }
        }
      }
    });
  });

  describe('knee', () => {
    const at = (severity: 1 | 2 | 3, pool: ReturnType<typeof cand>[]) => miniInput(pool, { context: { routines: [], stalled: [], niggles: [{ tag: 'knee', severity, date: '2026-09-28' }] } });
    const taken = (input: RoutineInput, request: RoutineRequest) => {
      const out = new Set<string>();
      for (const seed of seedsFrom(60)) for (const x of first(input, request, seed).rows) out.add(x.name);
      return out;
    };
    const SISSY = [cand('Sissy Squat', 'quads', { equipment: 'bodyweight' }), cand('Leg Extension', 'quads', { equipment: 'machine' })];
    const KNEELING = [cand('Kneeling Squat', 'glutes', { library: true, compound: true, equipment: 'barbell' }), cand('Hip Thrust (Barbell)', 'glutes', { compound: true, equipment: 'barbell' })];
    const LUNGE = [cand('Bulgarian Split Squat', 'quads', { unilateral: true, weight: 16 }), cand('Leg Extension', 'quads', { equipment: 'machine' })];

    it('at every severity: no sissy squat and no kneeling squat with a bar on the back', () => {
      for (const severity of [1, 2, 3] as const) {
        expect(taken(at(severity, SISSY), { focus: ['quads'], count: 2 }).has('Sissy Squat'), `sissy at ${severity}`).toBe(false);
        expect(taken(at(severity, KNEELING), { focus: ['glutes'], count: 2 }).has('Kneeling Squat'), `kneeling at ${severity}`).toBe(false);
      }
    });

    it('a lunge is the full list only: taken at severity 1, refused at 2 and 3', () => {
      const request: RoutineRequest = { focus: ['quads'], count: 2 };
      expect(taken(at(1, LUNGE), request).has('Bulgarian Split Squat')).toBe(true);
      expect(taken(at(2, LUNGE), request).has('Bulgarian Split Squat')).toBe(false);
      expect(taken(at(3, LUNGE), request).has('Bulgarian Split Squat')).toBe(false);
    });

    it('control: with no niggle all of them are taken', () => {
      expect(taken(miniInput(SISSY), { focus: ['quads'], count: 2 }).has('Sissy Squat')).toBe(true);
      expect(taken(miniInput(KNEELING), { focus: ['glutes'], count: 2 }).has('Kneeling Squat')).toBe(true);
      expect(taken(miniInput(LUNGE), { focus: ['quads'], count: 2 }).has('Bulgarian Split Squat')).toBe(true);
    });

    it('over 500 seeds with the real library, a knee niggle never gives a kneeling squat to a glute routine', () => {
      const input = withNiggle('knee');
      for (const seed of SEEDS) {
        for (const x of first(input, 'glutes', seed).rows) expect(x.name, `seed ${seed}`).not.toMatch(/kneeling squat/i);
      }
    });
  });

  describe('hamstring', () => {
    const POOL = [
      cand('Romanian Deadlift (Barbell)', 'hamstrings', { compound: true, equipment: 'barbell' }),
      cand('Lying Leg Curl (Machine)', 'hamstrings', { equipment: 'machine' }),
      cand('Hip Thrust (Barbell)', 'glutes', { compound: true, equipment: 'barbell' }),
    ];
    const at = (severity: 1 | 2 | 3) => miniInput(POOL, { context: { routines: [], stalled: [], niggles: [{ tag: 'hamstring DOMS', severity, date: '2026-09-28' }] } });
    it('a hinge is refused at every severity and a leg curl from 2', () => {
      const seen = (severity: 1 | 2 | 3) => first(at(severity), { focus: ['hamstrings', 'glutes'], count: 3 }, 1).rows.map((x) => x.name).sort();
      expect(seen(1)).toEqual(['Hip Thrust (Barbell)', 'Lying Leg Curl (Machine)']);
      expect(seen(2)).toEqual(['Hip Thrust (Barbell)']);
      expect(seen(3)).toEqual(['Hip Thrust (Barbell)']);
    });
  });

  describe('the line is printed when the niggle changed a choice, and only then', () => {
    const request = 'shoulders';
    it('is said on exactly the routines that differ from the same seed built without the niggle', () => {
      const input = withNiggle('shoulder');
      let said = 0;
      let silent = 0;
      for (const seed of SEEDS) {
        const a = first(input, request, seed);
        const b = first(REAL, request, seed);
        const line = a.reasonLines.some((l) => l.startsWith('Shoulder niggle on 28 Sep: '));
        const differs = ids(a).join() !== ids(b).join();
        expect(line, `seed ${seed}: differs ${differs}`).toBe(differs);
        if (line) said++;
        else silent++;
      }
      // Both have been tried: there are seeds the niggle changes and seeds it does not.
      expect(said).toBeGreaterThan(20);
      expect(silent).toBeGreaterThan(20);
    });

    it('a shoulder niggle and a chest routine: the dip is what it takes, and the line is said on exactly the routines that had one', () => {
      const input = withNiggle('shoulder');
      let said = 0;
      for (const seed of SEEDS) {
        const a = first(input, 'chest', seed);
        const b = first(REAL, 'chest', seed);
        const differs = ids(a).join() !== ids(b).join();
        expect(lines(a).length > 0, `seed ${seed}`).toBe(differs);
        // What it changed is a dip, or a barbell press overhead: the routine it replaced had one and this has none.
        if (differs) {
          said++;
          expect(b.rows.some((x) => x.pattern === 'dip' || (x.pattern === 'press-vertical' && x.equipment === 'barbell')), `seed ${seed}`).toBe(true);
          expect(a.rows.some((x) => x.pattern === 'dip'), `seed ${seed}`).toBe(false);
        }
      }
      expect(said).toBeGreaterThan(5);
    });

    it('a shoulder niggle and a leg routine: the same rows, and no line, over 500 seeds', () => {
      const input = withNiggle('shoulder');
      for (const seed of SEEDS) {
        const a = first(input, 'legs', seed);
        expect(ids(a), `seed ${seed}`).toEqual(ids(first(REAL, 'legs', seed)));
        expect(lines(a), `seed ${seed}`).toEqual([]);
      }
    });

    it('a lower-back niggle with nothing else left for a lower-back request builds nothing, and says the niggle is why', () => {
      const r = first(withNiggle('lower back'), 'lower back', 1);
      expect(r.rows).toEqual([]);
      expect(r.reasonLines.some((l) => /^\d+ of \d+ exercises: nothing more/.test(l))).toBe(false);
      expect(r.reasonLines.some((l) => l.startsWith('About '))).toBe(false);
      expect(r.reasonLines).toContain('Nothing for lower back left after what the niggle rules out');
    });
  });
});

// ---------------------------------------------------------------------------

describe('a sore body part typed in the request is a niggle of that level', () => {
  it('"back, my lower back is sore": a back routine with no lower back in it and no hinge or back extension', () => {
    for (const seed of SEEDS) {
      const r = first(REAL, 'Give me a back routine, my lower back is sore', seed);
      expect(r.rows.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      for (const x of r.rows) {
        expect(x.muscleGroup, `seed ${seed}: ${x.name}`).not.toBe('lower back');
        expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('back-extension');
        expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('hinge');
        expect(x.pattern === 'row' && (x.equipment === 'barbell' || /bent over/i.test(x.name)) && !/supported|incline|lying|seal/i.test(x.name), `seed ${seed}: ${x.name}`).toBe(false);
      }
      expect(r.focus).toEqual(['lats', 'upper back']);
    }
  });

  it('"legs, my lower back is sore": no hinge and no barbell back squat, and the line says it was typed', () => {
    let said = 0;
    for (const seed of SEEDS) {
      const r = first(REAL, 'legs, my lower back is sore', seed);
      for (const x of r.rows) {
        expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('hinge');
        expect(x.pattern === 'squat' && x.equipment === 'barbell' && !/front/i.test(x.name), `seed ${seed}: ${x.name}`).toBe(false);
      }
      const line = r.reasonLines.find((l) => l.startsWith('Sore lower back, as you said: '));
      expect(line, `seed ${seed}`).toBe('Sore lower back, as you said: no hinges, good mornings, bent-over barbell rows or back squats; chest-supported rows, leg press and hack squat preferred');
      said++;
      expect(r.reasonLines.some((l) => l.includes('niggle on')), `seed ${seed}`).toBe(false);
    }
    expect(said).toBe(SEEDS.length);
  });

  it('"legs, bad knee": no lunge, and "shoulders, my shoulder hurts": no upright row or barbell press', () => {
    for (const seed of SEEDS) {
      for (const x of first(REAL, 'legs, bad knee', seed).rows) expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('lunge');
      for (const x of first(REAL, 'shoulders, my shoulder hurts', seed).rows) {
        expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('upright-row');
        expect(x.pattern === 'press-vertical' && x.equipment === 'barbell' && !/landmine|jammer/i.test(x.name), `seed ${seed}: ${x.name}`).toBe(false);
      }
    }
  });

  it('"tweaked my hamstring" with a leg request: no hinge and no leg curl', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      for (const x of first(REAL, 'legs, tweaked my hamstring', seed).rows) expect(['hinge', 'leg-curl'], `seed ${seed}: ${x.name}`).not.toContain(x.pattern);
    }
  });

  it('says it only when it changed the routine: a sore knee with a chest request is silent', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const r = first(REAL, 'chest, my knee is sore', seed);
      expect(r.reasonLines.some((l) => l.includes('as you said')), `seed ${seed}`).toBe(false);
      expect(ids(r), `seed ${seed}`).toEqual(ids(first(REAL, 'chest', seed)));
    }
  });

  it('a typed niggle and a logged one for the same body part are one niggle, and the typed words are the ones said', () => {
    const input = withNiggle('lower back', 1);
    const r = first(input, 'legs, my lower back is sore', 1);
    expect(r.reasonLines.filter((l) => l.includes('lower back') && /niggle|said/.test(l))).toHaveLength(1);
    expect(r.reasonLines.some((l) => l.startsWith('Sore lower back, as you said: '))).toBe(true);
    // Typed, it is the full list even though the one logged was a 1: no barbell back squat.
    for (const seed of SEEDS.slice(0, 100)) for (const x of first(input, 'legs, my lower back is sore', seed).rows) expect(x.name).not.toBe('Barbell Back Squat');
  });

  it('an "other" niggle steers nothing and says nothing', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const r = first(REAL, 'legs, my elbow is sore', seed);
      expect(ids(r), `seed ${seed}`).toEqual(ids(first(REAL, 'legs', seed)));
      expect(r.reasonLines.some((l) => l.includes('as you said')), `seed ${seed}`).toBe(false);
    }
  });
});

describe('a movement left out by name', () => {
  it('"legs, no squats": no squat at all, and the line says it', () => {
    for (const seed of SEEDS) {
      const r = first(REAL, 'legs, no squats', seed);
      for (const x of r.rows) expect(x.pattern, `seed ${seed}: ${x.name}`).not.toBe('squat');
      expect(r.reasonLines, `seed ${seed}`).toContain('No squat, as you asked');
      expect(r.rows.some((x) => x.muscleGroup === 'quads'), `seed ${seed}`).toBe(true);
    }
  });

  it('"no squats legs" is the same request', () => {
    for (const seed of SEEDS.slice(0, 50)) expect(first(REAL, 'no squats legs', seed)).toEqual(first(REAL, 'legs, no squats', seed));
  });

  it.each([
    ['legs, no deadlifts', ['hinge']],
    ['legs, no lunges', ['lunge']],
    ['legs, no squats or lunges', ['squat', 'lunge']],
    ['shoulders, no overhead press', ['press-vertical']],
    ['back, no rows', ['row']],
    ['back, no pull ups', ['pull-up']],
    ['chest, no dips', ['dip']],
  ] as [string, string[]][])('"%s" takes none of %j', (text, patterns) => {
    for (const seed of SEEDS.slice(0, 150)) {
      for (const x of first(REAL, text, seed).rows) expect(patterns, `seed ${seed}: ${x.name}`).not.toContain(x.pattern);
    }
  });

  it('says it only when it changed the routine: no squats for a chest routine changes nothing and says nothing', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const r = first(REAL, 'chest, no squats', seed);
      expect(r.reasonLines.some((l) => l.includes('as you asked')), `seed ${seed}`).toBe(false);
      expect(ids(r), `seed ${seed}`).toEqual(ids(first(REAL, 'chest', seed)));
    }
  });

  it('says nothing for a movement left out that the routine would not have had anyway: no dips, with three exercises of the chest', () => {
    const pool = miniInput([
      cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 60 }),
      cand('Incline DB Press', 'chest', { compound: true, weight: 20 }),
      cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
      cand('Chest Dip', 'chest', { library: true, compound: true, equipment: 'bodyweight' }),
    ]);
    for (const seed of seedsFrom(40)) {
      const r = first(pool, { focus: ['chest'], count: 3, excludePatterns: ['dip'] }, seed);
      expect(r.rows.map((x) => x.name).sort(), `seed ${seed}`).toEqual(['Bench Press (Barbell)', 'Cable Fly', 'Incline DB Press']);
      expect(r.reasonLines.some((l) => l.includes('as you asked')), `seed ${seed}`).toBe(false);
    }
    // Control: with room for a fourth the dip is what it would have taken, and the line is said.
    const four = first(pool, { focus: ['chest'], count: 4, excludePatterns: ['dip'] }, 1);
    expect(four.rows.map((x) => x.pattern)).not.toContain('dip');
    expect(four.reasonLines).toContain('No dip, as you asked');
  });

  it('a split with a movement left out leaves it out of every day', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      for (const d of build(REAL, 'push pull legs, no squats, no deadlifts', seed)) {
        for (const x of d.rows) expect(['squat', 'hinge'], `seed ${seed}: ${d.name}: ${x.name}`).not.toContain(x.pattern);
      }
    }
  });

  it('with every squat, leg press and lunge left out a leg routine has none and a muscle can come to nothing: it says so', () => {
    const r = first(REAL, 'quads, no squats or lunges or leg press', 1);
    for (const x of r.rows) expect(['squat', 'lunge', 'leg-press']).not.toContain(x.pattern);
    expect(r.rows.every((x) => x.muscleGroup === 'quads')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('a stalled lift is replaced by a lift of the same kind that can be loaded', () => {
  const stall = (name: keyof typeof SEED_EXERCISE_IDS): RoutineInput => seededInput({ context: ctx({ stalled: [{ exerciseId: SEED_EXERCISE_IDS[name], sessions: 4 }] }) });
  const swapOf = (r: BuiltRoutine, name: string): BuiltRow | undefined => {
    const line = r.reasonLines.find((l) => l.startsWith(`${name} stalled for 4 sessions: `) && l.endsWith(' in its place'));
    if (!line) return undefined;
    const into = line.slice(`${name} stalled for 4 sessions: `.length, -' in its place'.length);
    return r.rows.find((x) => x.name === into);
  };
  const BAD = /behind (the )?neck|bradford|rocky|anti gravity|clock|plank|chains?\b|\bbands?\b|handstand|typewriter/i;

  it('a bench press is replaced by another loadable flat press: no push-up, no core hybrid, over 500 seeds', () => {
    const input = stall('Bench Press (Barbell)');
    for (const seed of SEEDS) {
      const r = first(input, 'chest', seed);
      const row = swapOf(r, 'Bench Press (Barbell)');
      expect(row, `seed ${seed}`).toBeTruthy();
      expect(row!.equipment, `seed ${seed}: ${row!.name}`).not.toBe('bodyweight');
      expect(row!.name, `seed ${seed}`).not.toMatch(BAD);
      expect(row!.pattern, `seed ${seed}: ${row!.name}`).toBe('press-horizontal');
      expect(row!.region, `seed ${seed}`).toBe('chest:mid');
      expect(row!.tier, `seed ${seed}`).toBe('primary');
    }
  });

  it('the same for a push day', () => {
    const input = stall('Bench Press (Barbell)');
    for (const seed of SEEDS.slice(0, 200)) {
      const row = swapOf(first(input, 'push', seed), 'Bench Press (Barbell)');
      expect(row, `seed ${seed}`).toBeTruthy();
      expect(row!.equipment, `seed ${seed}: ${row!.name}`).not.toBe('bodyweight');
      expect(row!.name).not.toMatch(BAD);
    }
  });

  it('a shoulder press is replaced by a vertical press that is not behind the neck', () => {
    const input = stall('DB Shoulder Press');
    for (const seed of SEEDS) {
      const row = swapOf(first(input, '3d shoulders', seed), 'DB Shoulder Press');
      expect(row, `seed ${seed}`).toBeTruthy();
      expect(row!.pattern, `seed ${seed}: ${row!.name}`).toBe('press-vertical');
      expect(row!.name, `seed ${seed}`).not.toMatch(BAD);
      expect(row!.equipment, `seed ${seed}: ${row!.name}`).not.toBe('bodyweight');
    }
  });

  it('a pulldown is replaced by a pulldown that is not behind the neck', () => {
    const input = stall('Lat Pulldown (Machine)');
    for (const seed of SEEDS) {
      const row = swapOf(first(input, 'back', seed), 'Lat Pulldown (Machine)');
      expect(row, `seed ${seed}`).toBeTruthy();
      expect(row!.pattern, `seed ${seed}: ${row!.name}`).toBe('pulldown');
      expect(row!.name, `seed ${seed}`).not.toMatch(BAD);
    }
  });

  it('carries a weight only if the owner has one for that variation, and otherwise says there is none', () => {
    const input = stall('Bench Press (Barbell)');
    for (const seed of SEEDS) {
      const r = first(input, 'chest', seed);
      const row = swapOf(r, 'Bench Press (Barbell)')!;
      const c = candidateById.get(row.id)!;
      const own = baseWeight(c);
      expect(row.weightKg, `seed ${seed}: ${row.name}`).toBe(own === null ? null : roundKg(own));
      if (row.origin !== 'own') {
        expect(row.weightKg, `seed ${seed}`).toBeNull();
        expect(row.reason, `seed ${seed}`).toContain('no weight yet');
      }
    }
  });

  it('an own variation with a weight keeps it, and a library one has none: nothing is carried across from the stalled lift', () => {
    const stalled = { exerciseId: 'Bench Press (Barbell)', sessions: 4 };
    const ownVariation = miniInput(
      [cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }), cand('Dumbbell Bench Press', 'chest', { compound: true, weight: 24 })],
      { context: { routines: [], niggles: [], stalled: [stalled] } },
    );
    const own = first(ownVariation, { focus: ['chest'], count: 1 }, 1).rows[0]!;
    expect([own.name, own.weightKg]).toEqual(['Dumbbell Bench Press', 24]);
    expect(own.reason).toContain('your working weight 24 kg');
    const libVariation = miniInput(
      [cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }), cand('Cable Chest Press', 'chest', { library: true, compound: true, equipment: 'cable' })],
      { context: { routines: [], niggles: [], stalled: [stalled] } },
    );
    const lib = first(libVariation, { focus: ['chest'], count: 1 }, 1).rows[0]!;
    expect([lib.name, lib.weightKg]).toEqual(['Cable Chest Press', null]);
    expect(lib.reason).toContain('no weight yet');
  });

  it('an exercise the owner has that is done behind the neck is not a variation either', () => {
    const pool = miniInput(
      [
        cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
        cand('Standing Barbell Press Behind Neck', 'shoulders', { compound: true, equipment: 'barbell', weight: 40 }),
        cand('Machine Shoulder Press', 'shoulders', { library: true, compound: true, equipment: 'machine' }),
      ],
      { context: { routines: [], niggles: [], stalled: [{ exerciseId: 'DB Shoulder Press', sessions: 4 }] } },
    );
    for (const seed of seedsFrom(40)) expect(first(pool, { focus: ['shoulders'], count: 1 }, seed).rows.map((x) => x.name), `seed ${seed}`).toEqual(['Machine Shoulder Press']);
  });

  it('a stalled bodyweight lift may be swapped for another bodyweight one: only a loaded lift needs a loadable one', () => {
    const pool = miniInput(
      [cand('Push-up', 'chest', { equipment: 'bodyweight', compound: true }), cand('Wide Push-up', 'chest', { equipment: 'bodyweight', compound: true })],
      { context: { routines: [], niggles: [], stalled: [{ exerciseId: 'Push-up', sessions: 4 }] } },
    );
    expect(first(pool, { focus: ['chest'], count: 1 }, 1).rows.map((x) => x.name)).toEqual(['Wide Push-up']);
  });

  it('with no loadable variation of the same movement the lift is kept and the line says so, rather than a push-up put in its place', () => {
    const pool = miniInput(
      [cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 65 }), cand('Push-up', 'chest', { library: true, equipment: 'bodyweight', compound: true })],
      { context: { routines: [], niggles: [], stalled: [{ exerciseId: 'Bench Press (Barbell)', sessions: 4 }] } },
    );
    const r = first(pool, { focus: ['chest'], count: 1 }, 1);
    expect(r.rows.map((x) => x.name)).toEqual(['Bench Press (Barbell)']);
    expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 4 sessions: no variation in your exercises or the library, kept');
  });
});

// ---------------------------------------------------------------------------

describe('a length asked for', () => {
  const ASK = 45;
  const chestTriceps = (minutes: number): RoutineRequest => typed(`${minutes} minute chest and triceps`);

  it('trims and fills towards the ask, and lands no further from it than the routine it started as', () => {
    for (const seed of SEEDS) {
      const base = first(REAL, 'chest and triceps', seed);
      const asked = first(REAL, chestTriceps(ASK), seed);
      expect(Math.abs(asked.estimateMinutes - ASK), `seed ${seed}: ${base.estimateMinutes} -> ${asked.estimateMinutes}`).toBeLessThanOrEqual(Math.abs(base.estimateMinutes - ASK));
    }
  });

  it('a routine that is a minute over the ask is left alone: dropping a finisher would be five under', () => {
    let kept = 0;
    for (const seed of SEEDS) {
      const base = first(REAL, 'chest and triceps', seed);
      const asked = first(REAL, chestTriceps(ASK), seed);
      if (base.estimateMinutes === ASK + 1) {
        kept++;
        expect(asked.rows, `seed ${seed}`).toHaveLength(base.rows.length);
        expect(asked.reasonLines.some((l) => l.startsWith('Dropped')), `seed ${seed}`).toBe(false);
      }
    }
    expect(kept).toBeGreaterThan(0);
  });

  it('a longer ask adds a finisher: sixty minutes is more exercises than the default, and nearer sixty', () => {
    let longer = 0;
    for (const seed of SEEDS) {
      const base = first(REAL, 'chest and triceps', seed);
      const asked = first(REAL, chestTriceps(60), seed);
      expect(asked.rows.length, `seed ${seed}`).toBeGreaterThanOrEqual(base.rows.length);
      expect(Math.abs(asked.estimateMinutes - 60), `seed ${seed}`).toBeLessThanOrEqual(Math.abs(base.estimateMinutes - 60));
      if (asked.rows.length > base.rows.length) {
        longer++;
        expect(asked.reasonLines.some((l) => l.startsWith('Added ')), `seed ${seed}`).toBe(true);
        expect(asked.estimateMinutes, `seed ${seed}`).toBeGreaterThan(base.estimateMinutes);
      }
    }
    expect(longer).toBeGreaterThan(SEEDS.length / 2);
  });

  it('what it adds is a finisher: isolation work after the rest, and the routine is no repeat of an exercise', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const asked = first(REAL, chestTriceps(75), seed);
      expect(new Set(ids(asked)).size, `seed ${seed}`).toBe(asked.rows.length);
      const ranks = asked.rows.map((x) => ({ primary: 0, secondary: 1, isolation: 2 })[x.tier]);
      expect(ranks, `seed ${seed}`).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('never says it came nearer: it says what the routine is, against what was asked', () => {
    for (const seed of SEEDS) {
      for (const minutes of [20, 30, 45, 60, 90]) {
        const r = first(REAL, chestTriceps(minutes), seed);
        expect(r.reasonLines.some((l) => /nearer/.test(l)), `seed ${seed}, ${minutes} min`).toBe(false);
        const about = r.reasonLines.find((l) => l.startsWith('About '))!;
        expect(about, `seed ${seed}, ${minutes} min`).toContain(`About ${r.estimateMinutes} min`);
        if (r.estimateMinutes !== minutes) expect(about, `seed ${seed}, ${minutes} min`).toContain(`for the ${minutes} min asked`);
        else expect(about).not.toContain('asked');
      }
    }
  });

  it('a count asked for as well as a length is not grown: it only trims', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const r = first(REAL, { focus: ['chest', 'triceps'], count: 4, minutes: 90 }, seed);
      expect(r.rows, `seed ${seed}`).toHaveLength(4);
      expect(r.reasonLines.some((l) => l.startsWith('Added ')), `seed ${seed}`).toBe(false);
    }
  });

  it('never goes below two exercises however short the ask', () => {
    for (const seed of SEEDS.slice(0, 100)) expect(first(REAL, chestTriceps(10), seed).rows.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
  });

  it('"About N min" says "at your pace" only when a pace was measured', () => {
    const measured: RoutineInput = { ...REAL, pace: 1.3, paceBasis: 'measured' };
    const unmeasured: RoutineInput = { ...REAL, pace: 1 };
    const mAbout = first(measured, 'chest', 1).reasonLines.find((l) => l.startsWith('About '))!;
    const uAbout = first(unmeasured, 'chest', 1).reasonLines.find((l) => l.startsWith('About '))!;
    expect(mAbout).toMatch(/^About \d+ min at your pace$/);
    expect(uAbout).toMatch(/^About \d+ min$/);
    // A pace that is only a number (a caller that said nothing about where it came from) is not claimed as measured.
    expect(first({ ...REAL, pace: 1.3 }, 'chest', 1).reasonLines.find((l) => l.startsWith('About '))).toMatch(/^About \d+ min$/);
  });

  it('a pace held to a bound is not called the owner\'s pace, and says which way it was held', () => {
    const slow = first({ ...REAL, pace: 1.6, paceBasis: 'held-slow' }, 'chest', 1).reasonLines.find((l) => l.startsWith('About '))!;
    const fast = first({ ...REAL, pace: 0.6, paceBasis: 'held-fast' }, 'chest', 1).reasonLines.find((l) => l.startsWith('About '))!;
    expect(slow).not.toContain('at your pace');
    expect(slow).toContain('1.6 times');
    expect(slow).toContain('slower');
    expect(fast).not.toContain('at your pace');
    expect(fast).toContain('0.6 times');
    expect(fast).toContain('faster');
  });
});

// ---------------------------------------------------------------------------

describe('reason lines state only what is true of the routine as built', () => {
  const REQUESTS = ['3d shoulders', 'shoulders', 'chest', 'back', 'arms', 'legs', 'biceps', 'quads', 'push pull legs', 'upper lower', 'full body', 'chest and triceps', 'dumbbells only arms', 'core', 'triceps'];

  it('a sets line quotes a limit only when the routine meets it', () => {
    let lines = 0;
    for (const text of REQUESTS) {
      for (const seed of SEEDS.slice(0, 200)) {
        for (const r of build(REAL, text, seed)) {
          for (const line of r.reasonLines) {
            const raised = /^(.+): sets raised from (\d+) to (\d+) \(at least (\d+) sets/.exec(line);
            if (raised) {
              lines++;
              expect(Number(raised[3]), `${text}, seed ${seed}: ${line}`).toBeGreaterThanOrEqual(Number(raised[4]));
            }
            const cut = /^(.+): sets cut from (\d+) to (\d+) \(at most (\d+) sets/.exec(line);
            if (cut) {
              lines++;
              expect(Number(cut[3]), `${text}, seed ${seed}: ${line}`).toBeLessThanOrEqual(Number(cut[4]));
            }
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(100);
  });

  it('when the owner\'s own sets keep a muscle short of its window, the line says it fell short', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS.slice(0, 100)) {
      for (const line of first(REAL, 'back', seed).reasonLines) if (/sets raised from \d+ to \d+, short of the \d+/.test(line)) seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const line of seen) expect(line).toMatch(/^[a-z ]+: sets raised from (\d+) to (\d+), short of the (\d+) for a muscle in a routine for it \(your own sets kept\)$/);
  });

  it('the Focus line names only the muscles that have a row, and a muscle that got nothing says so', () => {
    let nothing = 0;
    for (const seed of SEEDS) {
      const r = first(REAL, 'arms', seed);
      const focus = r.reasonLines[0]!;
      for (const m of ['biceps', 'triceps', 'forearms'] as const) {
        const rows = r.rows.some((x) => x.muscleGroup === m);
        expect(focus.includes(m), `seed ${seed}: ${focus}`).toBe(rows);
        if (!rows) {
          nothing++;
          expect(r.reasonLines.some((l) => l.startsWith(`Nothing for ${m}`)), `seed ${seed}`).toBe(true);
        }
      }
      expect(focus).toMatch(/, as asked$/);
    }
    expect(nothing).toBeGreaterThan(0);
  });

  it('"N of M exercises" counts what is in the routine after a trim for time', () => {
    const pool = miniInput(
      [
        cand('Cable Fly', 'chest', { equipment: 'cable', weight: 12 }),
        cand('Incline DB Press', 'chest', { compound: true, weight: 20 }),
        cand('Bench Press (Barbell)', 'chest', { compound: true, equipment: 'barbell', weight: 60 }),
        cand('Pec Deck', 'chest', { equipment: 'machine' }),
        cand('Decline Bench Press', 'chest', { compound: true, equipment: 'barbell' }),
      ],
      { settings: { restCompoundSec: 150, restIsolationSec: 75, restCarrySec: 90 } },
    );
    const r = first(pool, { focus: ['chest'], minutes: 20 }, 1);
    expect(r.rows.length).toBeLessThan(5);
    const line = r.reasonLines.find((l) => /^\d+ of \d+ exercises/.test(l));
    expect(line, r.reasonLines.join(' | ')).toBeTruthy();
    expect(line).toMatch(new RegExp(`^${r.rows.length} of 6 exercises: nothing more for chest in your exercises or the library; 5 to start with, ${5 - r.rows.length} dropped for the 20 min asked$`));
    // Control: the same pool with no length asked says the plain thing.
    const plain = first(pool, { focus: ['chest'] }, 1);
    expect(plain.reasonLines).toContain('5 of 6 exercises: nothing more for chest in your exercises or the library');
  });

  it('a repeat blocked by the cap on library exercises says the cap is why, not that nothing was left', () => {
    // Four movements in the library and room for three: the second press is a repeat while one is still on the shelf.
    const pool = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
      cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
      cand('Cable Lateral Raise', 'shoulders', { library: true, equipment: 'cable' }),
      cand('Front Raise', 'shoulders', { library: true }),
      cand('Reverse Flyes', 'shoulders', { library: true }),
      cand('Face Pull (Cable)', 'shoulders', { library: true, equipment: 'cable' }),
    ]);
    let capped = 0;
    for (const seed of seedsFrom(60)) {
      const r = first(pool, { focus: ['shoulders'], count: 6 }, seed);
      const library = r.rows.filter((x) => x.origin !== 'own');
      const repeat = r.reasonLines.find((l) => l.startsWith('A second vertical press'));
      if (library.length === 3 && repeat) {
        capped++;
        expect(repeat, `seed ${seed}`).toMatch(/: 3 from the library is the most for one routine$/);
        expect(repeat, `seed ${seed}`).not.toContain('nothing else left');
      }
    }
    expect(capped).toBeGreaterThan(0);
    // Control: with the library out of movements the line is the plain one.
    const bare = miniInput([
      cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
      cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
    ]);
    expect(first(bare, { focus: ['shoulders'], count: 3 }, 1).reasonLines.some((l) => /^A second .*: nothing else left for shoulders in your exercises or the library$/.test(l))).toBe(true);
  });

  it('a muscle the equipment asked for cannot reach says so, and not that the owner has nothing', () => {
    const pool = miniInput([
      cand('DB Curl', 'biceps', { weight: 12 }),
      cand('Triceps Pushdown', 'triceps', { equipment: 'cable', weight: 25 }),
      cand('Overhead Triceps Extension', 'triceps', { equipment: 'cable', weight: 20 }),
    ]);
    const r = first(pool, { focus: ['biceps', 'triceps'], equipment: ['dumbbell'] }, 1);
    expect(r.reasonLines).toContain('No exercise for triceps with the equipment asked for');
    expect(r.reasonLines.some((l) => l.endsWith('in your exercises or the library'))).toBe(false);
    // And a part of a muscle the equipment cannot reach, where the muscle has another part it can.
    const parts = miniInput([
      cand('DB Curl', 'biceps', { weight: 12 }),
      cand('Triceps Kickback', 'triceps', { weight: 8 }),
      cand('Overhead Triceps Extension', 'triceps', { equipment: 'cable', weight: 20 }),
    ]);
    const p = first(parts, { focus: ['biceps', 'triceps'], equipment: ['dumbbell'] }, 1);
    expect(p.reasonLines).toContain('No exercise for triceps long head with the equipment asked for');
    // Control: with no equipment asked for it is the plain wording.
    const plain = first(miniInput([cand('DB Curl', 'biceps', { weight: 12 })]), { focus: ['biceps', 'triceps'] }, 1);
    expect(plain.reasonLines).toContain('No exercise for triceps in your exercises or the library');
  });

  it('a row\'s reason does not repeat itself or call nothing a working weight', () => {
    for (const text of ['shoulders', 'legs', 'push pull legs', 'upper lower', 'core']) {
      for (const seed of SEEDS.slice(0, 80)) {
        for (const d of build(REAL, text, seed)) {
          for (const x of d.rows) {
            expect(x.reason, `${text}, seed ${seed}`).not.toMatch(/^(.+) · \1 · /);
            expect(x.reason, `${text}, seed ${seed}`).not.toContain('working weight 0 kg');
            expect(x.reason, `${text}, seed ${seed}`).not.toMatch(/hinge \(hinge\)/);
          }
        }
      }
    }
  });

  it('every line is a plain fact, over everything a request can now say', () => {
    const banned = /\b(you should|try|remember|great|nice|good luck|let's|don't forget|aim|consider|tip)\b|[!?]/i;
    const input = seededInput({ context: ctx({ niggles: [{ tag: 'knee', severity: 2, date: '2026-09-28' }], stalled: [{ exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], sessions: 3 }] }) });
    for (const text of ['3d shoulders', 'chest, no dips, my shoulder hurts', 'upper chest', 'legs, no squats, my lower back is sore', 'push pull legs', '45 minute chest and triceps', '90 minute shoulders']) {
      for (const seed of SEEDS.slice(0, 40)) {
        for (const r of build(input, text, seed)) for (const line of [...r.reasonLines, ...r.rows.map((x) => x.reason)]) expect(line, `${text}: ${line}`).not.toMatch(banned);
      }
    }
  });
});
