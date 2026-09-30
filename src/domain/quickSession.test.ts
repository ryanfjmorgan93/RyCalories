import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_EXERCISES, SEED_ROUTINES, SEED_ROUTINE_EXERCISES } from '../db/seed';
import { resolveOptions, type QuickOptions } from './quickRequest';
import { restSecondsFor } from './rest';
import {
  estimateMinutes,
  generateQuickSession,
  paceFactor,
  type Candidate,
  type QuickInput,
  type QuickPlan,
  type QuickRow,
} from './quickSession';
import type { MuscleGroup, RoutineExercise } from './types';

// ---------------------------------------------------------------------------
// Fixtures

const SETTINGS: QuickInput['settings'] = {
  restCompoundSec: 150,
  restIsolationSec: 75,
  restCarrySec: 90,
  barKg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

function cand(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    name: over.id,
    muscleGroup: 'chest',
    kind: 'reps',
    isCompound: false,
    isLowerBody: false,
    unilateral: false,
    defaultIncrement: 2.5,
    defaultRestSec: 75,
    origin: 'own',
    ...over,
  };
}

function input(candidates: Candidate[], over: Partial<QuickInput> = {}): QuickInput {
  return { candidates, recency: {}, weeklySets: {}, settings: SETTINGS, pace: 1, ...over };
}

function opts(over: Partial<QuickOptions> = {}): QuickOptions {
  return resolveOptions(over);
}

/** `per` dumbbell isolation exercises for each muscle, all with a known weight. */
function groupPool(muscles: MuscleGroup[], per = 3, over: Partial<Candidate> = {}): Candidate[] {
  return muscles.flatMap((m) =>
    Array.from({ length: per }, (_, i) =>
      cand({ id: `${m}-${i}`, name: `${m} ${i}`, muscleGroup: m, equipment: 'dumbbell', base: { sets: 3, repMin: 10, repMax: 12, weightKg: 20, mode: 'normal' }, ...over }),
    ),
  );
}

const rowMuscles = (plan: QuickPlan): MuscleGroup[] => plan.rows.map((r) => r.candidate.muscleGroup);
const rowIds = (plan: QuickPlan): string[] => plan.rows.map((r) => r.candidate.id);
const seeds = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);

/** A deterministic shuffle (test-side; the domain never sees a random source). */
function shuffled<T>(items: T[], salt: number): T[] {
  const out = [...items];
  let s = salt * 2654435761 + 12345;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The 27 seeded exercises as candidates, with the working weight their seeded routine gives them. */
function seedCandidates(): Candidate[] {
  return SEED_EXERCISES.map((e) => {
    const rx = SEED_ROUTINE_EXERCISES.find((r) => r.exerciseId === e.id);
    return cand({
      id: e.id,
      name: e.name,
      muscleGroup: e.muscleGroup,
      equipment: e.equipment,
      kind: e.kind,
      isCompound: e.isCompound,
      isLowerBody: e.isLowerBody,
      unilateral: e.unilateral,
      defaultIncrement: e.defaultIncrement,
      defaultRestSec: e.defaultRestSec,
      standard: e.standard,
      base: rx ? { sets: rx.targetSets, repMin: rx.repMin, repMax: rx.repMax, weightKg: rx.mode === 'normal' ? rx.currentWeight : null, mode: rx.mode } : undefined,
    });
  });
}

/** Everything the exclusions apply to, plus a catalogue, so every rule has something to bite on. */
function bigPool(): Candidate[] {
  const own = seedCandidates();
  const extras: Candidate[] = [
    cand({ id: 'x-rdl-db', name: 'Romanian Deadlift (Dumbbell)', muscleGroup: 'hamstrings', equipment: 'dumbbell', isLowerBody: true, base: { sets: 3, repMin: 8, repMax: 10, weightKg: 30, mode: 'normal' } }),
    cand({ id: 'x-gm', name: 'Good Morning (Barbell)', muscleGroup: 'lower back', equipment: 'barbell', isLowerBody: true, base: { sets: 3, repMin: 8, repMax: 10, weightKg: 50, mode: 'normal' } }),
    cand({ id: 'x-dl', name: 'Deadlift (Barbell)', muscleGroup: 'hamstrings', equipment: 'barbell', isCompound: true, isLowerBody: true, standard: 'deadlift', base: { sets: 3, repMin: 5, repMax: 5, weightKg: 120, mode: 'normal' } }),
    cand({ id: 'x-ohp', name: 'Overhead Press (Barbell)', muscleGroup: 'shoulders', equipment: 'barbell', isCompound: true, standard: 'press', base: { sets: 3, repMin: 6, repMax: 8, weightKg: 45, mode: 'normal' } }),
    cand({ id: 'x-row-bb', name: 'Bent Over Row (Barbell)', muscleGroup: 'upper back', equipment: 'barbell', isCompound: true, base: { sets: 3, repMin: 8, repMax: 10, weightKg: 60, mode: 'normal' } }),
    cand({ id: 'x-curl-bb', name: 'Barbell Curl', muscleGroup: 'biceps', equipment: 'barbell', base: { sets: 3, repMin: 8, repMax: 12, weightKg: 40, mode: 'normal' } }),
    cand({ id: 'x-plank', name: 'Plank', muscleGroup: 'abs', kind: 'timed', equipment: 'bodyweight' }),
    cand({ id: 'x-burpee', name: 'Burpee', muscleGroup: 'full body', equipment: 'bodyweight', isCompound: true }),
    cand({ id: 'x-misc', name: 'Miscellany', muscleGroup: 'other' }),
    cand({ id: 'x-press-machine', name: 'Chest Press (Machine)', muscleGroup: 'chest', equipment: 'machine', isCompound: true, standard: 'bench', base: { sets: 3, repMin: 8, repMax: 10, weightKg: 60, mode: 'normal' } }),
  ];
  const catalogue: Candidate[] = [];
  const groups: MuscleGroup[] = ['chest', 'lats', 'quads', 'hamstrings', 'shoulders', 'biceps', 'triceps', 'calves', 'abs', 'glutes', 'upper back', 'rear delts'];
  const equipment = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell'] as const;
  const levels = ['beginner', 'intermediate', 'expert'] as const;
  groups.forEach((m, gi) => {
    for (let i = 0; i < 4; i++) {
      catalogue.push(
        cand({
          id: `cat-${m}-${i}`,
          name: `Catalogue ${m} ${i}`,
          muscleGroup: m,
          equipment: equipment[(gi + i) % equipment.length],
          isCompound: i === 0,
          origin: 'catalogue',
          catalogueSlug: `cat-${m}-${i}`,
          level: levels[(gi + i) % levels.length],
        }),
      );
    }
  });
  return [...own, ...extras, ...catalogue];
}

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Determinism and purity

describe('generateQuickSession: determinism', () => {
  const pool = bigPool();
  const options = opts({ includeNew: true });

  it('the same input and seed give an identical plan', () => {
    for (const seed of seeds(25)) {
      expect(generateQuickSession(input(pool), options, seed)).toEqual(generateQuickSession(input(pool), options, seed));
    }
  });

  it('the seed is used: different seeds do not all give the same plan', () => {
    const plans = new Set(seeds(30).map((s) => rowIds(generateQuickSession(input(pool), options, s)).join(',')));
    expect(plans.size).toBeGreaterThan(10);
  });

  it('returns the seed it was given, as an unsigned 32-bit number', () => {
    expect(generateQuickSession(input(pool), options, 12345).seed).toBe(12345);
    expect(generateQuickSession(input(pool), options, -1).seed).toBe(4294967295);
    expect(generateQuickSession(input(pool), options, Number.NaN).seed).toBe(0);
  });

  it('the order the candidates arrive in changes nothing (IndexedDB hands rows back in uuid order)', () => {
    const recency: QuickInput['recency'] = { chest: 3, lats: 6, quads: 9, biceps: 4, calves: 12, abs: 7 };
    for (const seed of seeds(20)) {
      const expected = generateQuickSession(input(pool, { recency }), options, seed);
      const orders = [[...pool].reverse(), shuffled(pool, seed), shuffled(pool, seed + 100), [...pool.slice(17), ...pool.slice(0, 17)]];
      for (const candidates of orders) {
        expect(generateQuickSession(input(candidates, { recency }), options, seed)).toEqual(expected);
      }
    }
  });

  it('nor does the order the recency and target maps were built in', () => {
    const a = input(pool, { recency: { chest: 3, lats: 6, quads: 9 }, weeklyTargets: { chest: 10, lats: 12 }, weeklySets: { chest: 2 } });
    const b = input(pool, { recency: { quads: 9, lats: 6, chest: 3 }, weeklyTargets: { lats: 12, chest: 10 }, weeklySets: { chest: 2 } });
    for (const seed of seeds(15)) {
      expect(generateQuickSession(a, options, seed)).toEqual(generateQuickSession(b, options, seed));
    }
  });

  it('reads no clock and no random source: with both made to throw, everything still runs', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random was read');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now was read');
    });
    const plan = generateQuickSession(input(pool), options, 7);
    expect(plan.rows.length).toBeGreaterThan(0);
    expect(estimateMinutes(plan.rows, 1.2)).toBeGreaterThan(0);
    expect(paceFactor([{ durationSec: 3000, modelledSec: 2500 }])).toBe(1);
  });

  it('does not change the input it is given', () => {
    const snapshot = JSON.stringify(pool);
    const inp = input(pool, { recency: { chest: 1 }, weeklyTargets: { chest: 8 } });
    const inpSnapshot = JSON.stringify(inp);
    const o = opts({ includeNew: true, focus: ['chest', 'lats'], exclude: ['quads'] });
    const oSnapshot = JSON.stringify(o);
    generateQuickSession(inp, o, 3);
    expect(JSON.stringify(pool)).toBe(snapshot);
    expect(JSON.stringify(inp)).toBe(inpSnapshot);
    expect(JSON.stringify(o)).toBe(oSnapshot);
  });
});

describe('generateQuickSession: never throws', () => {
  const pool = bigPool();

  it('a candidate handed in twice under one id is one candidate', () => {
    const twice = [...groupPool(['chest'], 2), ...groupPool(['chest'], 2)];
    const plan = generateQuickSession(input(twice), opts({ focus: ['chest'], count: 2 }), 1);
    expect(rowIds(plan).sort()).toEqual(['chest-0', 'chest-1']);
    expect(generateQuickSession(input(twice), opts({ focus: ['chest'], count: 4 }), 1).rows).toHaveLength(2);
  });

  it('an empty pool is an empty plan', () => {
    const plan = generateQuickSession(input([]), opts(), 1);
    expect(plan).toEqual({ rows: [], estimateMin: 0, shortfall: 3, unmet: [], relaxed: false, focus: [], seed: 1 });
  });

  it('an empty pool with a count asked for is short by exactly that count', () => {
    expect(generateQuickSession(input([]), opts({ count: 5 }), 1).shortfall).toBe(5);
  });

  it('survives nonsense numbers everywhere', () => {
    const weird: Candidate[] = [
      cand({ id: 'w1', defaultIncrement: Number.NaN, defaultRestSec: Number.NaN, base: { sets: 0, repMin: -1, repMax: 0, weightKg: Number.NaN, mode: 'normal' } }),
      cand({ id: 'w2', muscleGroup: 'lats', defaultIncrement: 0, defaultRestSec: -50, daysSinceUsed: Number.NaN, base: { sets: 2.5, repMin: 5, repMax: 3, weightKg: -10, mode: 'normal' } }),
      cand({ id: 'w3', muscleGroup: 'quads', equipment: 'barbell', defaultIncrement: Number.POSITIVE_INFINITY, base: { sets: 3, repMin: 5, repMax: 5, weightKg: Number.POSITIVE_INFINITY, mode: 'normal' } }),
    ];
    const bad = input(weird, {
      recency: { chest: Number.NaN, lats: 5, quads: Number.POSITIVE_INFINITY },
      weeklySets: { chest: Number.NaN },
      weeklyTargets: { chest: Number.NaN, lats: -3 },
      settings: { restCompoundSec: Number.NaN, restIsolationSec: -1, restCarrySec: 0, barKg: Number.NaN, plates: [Number.NaN, 20] },
      pace: Number.NaN,
    });
    for (const light of [false, true]) {
      const plan = generateQuickSession(bad, opts({ effort: light ? 'light' : 'normal', count: Number.NaN, minutes: Number.NaN }), Number.NaN);
      expect(Number.isFinite(plan.estimateMin)).toBe(true);
      expect(rowIds(plan)).toContain('w2');
      for (const r of plan.rows) {
        expect(Number.isFinite(r.restSec)).toBe(true);
        expect(r.restSec).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(r.sets) && r.sets >= 1).toBe(true);
        expect(r.repMax).toBeGreaterThanOrEqual(r.repMin);
        if (r.weightKg !== null) expect(Number.isFinite(r.weightKg) && r.weightKg >= 0).toBe(true);
      }
    }
  });

  it('survives missing maps, a missing pool and odd counts', () => {
    const partial = { candidates: pool, settings: SETTINGS, pace: 1 } as unknown as QuickInput;
    expect(() => generateQuickSession(partial, opts(), 1)).not.toThrow();
    expect(() => generateQuickSession({} as QuickInput, opts(), 1)).not.toThrow();
    for (const count of [0, -3, 0.4, 1e9, Number.POSITIVE_INFINITY]) {
      expect(() => generateQuickSession(input(pool), opts({ count }), 5), String(count)).not.toThrow();
    }
  });

  it('a count that is not a whole positive number is ignored and the count is derived from the minutes', () => {
    for (const count of [0, -3, 0.4, Number.NaN]) {
      const plan = generateQuickSession(input(pool), opts({ count }), 5);
      const derived = generateQuickSession(input(pool), opts(), 5);
      expect(plan, String(count)).toEqual(derived);
    }
  });

  it('a seed outside the usual range still gives one fixed plan', () => {
    for (const seed of [-7, 1e12, 0.5, 2 ** 32 + 3]) {
      expect(generateQuickSession(input(pool), opts(), seed)).toEqual(generateQuickSession(input(pool), opts(), seed));
    }
  });
});

// ---------------------------------------------------------------------------
// Invariants across many seeds

describe('generateQuickSession: 500 seeds', () => {
  const pool = bigPool();
  const recency: QuickInput['recency'] = { chest: 3, lats: 6, quads: 9, biceps: 4, calves: 12, abs: 7, glutes: 5, shoulders: 8 };
  const configs: { label: string; options: QuickOptions }[] = [
    { label: 'normal, derived, new allowed', options: opts({ includeNew: true }) },
    { label: 'light, derived, new allowed', options: opts({ effort: 'light', includeNew: true }) },
    { label: 'normal, count 8, new allowed', options: opts({ count: 8, includeNew: true }) },
    { label: 'light, count 6, new allowed', options: opts({ effort: 'light', count: 6, includeNew: true }) },
    { label: 'normal, focus on chest and lats, new allowed', options: opts({ focus: ['chest', 'lats'], count: 4, includeNew: true }) },
    { label: 'normal, derived, new not allowed', options: opts({ includeNew: false }) },
  ];

  const plansFor = (options: QuickOptions): QuickPlan[] => seeds(500).map((s) => generateQuickSession(input(pool, { recency }), options, s));

  it('takes at most two catalogue exercises, and none unless asked for; the cap is actually reached', () => {
    let reachedTwo = false;
    for (const { label, options } of configs) {
      for (const plan of plansFor(options)) {
        const catalogue = plan.rows.filter((r) => r.candidate.origin === 'catalogue').length;
        expect(catalogue, label).toBeLessThanOrEqual(options.includeNew ? 2 : 0);
        if (catalogue === 2) reachedTwo = true;
      }
    }
    expect(reachedTwo).toBe(true);
  });

  it('never takes an expert catalogue exercise, but does take the levels below', () => {
    const seen = new Set<string | undefined>();
    for (const plan of plansFor(opts({ includeNew: true, count: 8 }))) {
      for (const r of plan.rows) if (r.candidate.origin === 'catalogue') seen.add(r.candidate.level);
    }
    expect(seen.has('expert')).toBe(false);
    expect(seen.has('beginner')).toBe(true);
    expect(seen.has('intermediate')).toBe(true);
  });

  it('never has more than two rows for one muscle, or one exercise twice', () => {
    for (const { label, options } of configs) {
      for (const plan of plansFor(options)) {
        const perMuscle = new Map<MuscleGroup, number>();
        for (const m of rowMuscles(plan)) perMuscle.set(m, (perMuscle.get(m) ?? 0) + 1);
        for (const [m, n] of perMuscle) expect(n, `${label}: ${m}`).toBeLessThanOrEqual(2);
        expect(new Set(rowIds(plan)).size, label).toBe(plan.rows.length);
      }
    }
  });

  it('never takes a carry, a timed exercise, or a muscle group of "other" or "full body"', () => {
    for (const { label, options } of configs) {
      for (const plan of plansFor(options)) {
        for (const r of plan.rows) {
          expect(['carry', 'timed'], label).not.toContain(r.candidate.kind);
          expect(['other', 'full body'], label).not.toContain(r.candidate.muscleGroup);
        }
      }
    }
  });

  it('a light session never holds a barbell compound, a hinge or a standard lift', () => {
    let rows = 0;
    for (const options of [opts({ effort: 'light', includeNew: true }), opts({ effort: 'light', count: 8, includeNew: true })]) {
      for (const plan of plansFor(options)) {
        for (const r of plan.rows) {
          rows++;
          const c = r.candidate;
          expect(c.equipment === 'barbell' && c.isCompound, c.name).toBe(false);
          expect(c.name, c.name).not.toMatch(/deadlift|good.?morning|romanian|rdl|hyperextension|back extension/i);
          expect(c.standard, c.name).toBeUndefined();
        }
      }
    }
    expect(rows).toBeGreaterThan(2000);
  });

  it('a normal session may hold them: the light exclusions are not applied to every plan', () => {
    const names = new Set<string>();
    for (const plan of plansFor(opts({ count: 8 }))) for (const r of plan.rows) names.add(r.candidate.name);
    expect(names.has('Barbell Back Squat') || names.has('Bench Press (Barbell)') || names.has('Romanian Deadlift (Barbell)')).toBe(true);
  });

  it('light weights are at most 65% of the base, on the increment grid and never negative', () => {
    let weighed = 0;
    for (const plan of plansFor(opts({ effort: 'light', count: 8, includeNew: true }))) {
      for (const r of plan.rows) {
        const base = r.candidate.base?.weightKg;
        if (r.weightKg === null) continue;
        weighed++;
        expect(base, r.candidate.name).toBeDefined();
        expect(r.weightKg, r.candidate.name).toBeGreaterThanOrEqual(0);
        expect(r.weightKg, r.candidate.name).toBeLessThanOrEqual(base! * 0.65 + 1e-9);
        const steps = r.weightKg / r.candidate.defaultIncrement;
        expect(Math.abs(steps - Math.round(steps)), `${r.candidate.name} ${r.weightKg} on a ${r.candidate.defaultIncrement} kg grid`).toBeLessThan(1e-9);
      }
    }
    expect(weighed).toBeGreaterThan(500);
  });

  it('the estimate is always what estimateMinutes says of the rows', () => {
    for (const { label, options } of configs) {
      for (const plan of plansFor(options).slice(0, 100)) {
        expect(plan.estimateMin, label).toBe(estimateMinutes(plan.rows, 1));
      }
    }
  });

  it('a row for a known weight is normal and one without is calibrating with no weight', () => {
    for (const plan of plansFor(opts({ includeNew: true }))) {
      for (const r of plan.rows) {
        if (r.weightKg === null) expect(r.mode).toBe('calibrating');
        else expect(r.mode).toBe('normal');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Focus

describe('generateQuickSession: focus chosen by need', () => {
  const muscles: MuscleGroup[] = ['chest', 'lats', 'quads', 'biceps', 'abs', 'calves'];
  const pool = groupPool(muscles);

  it('takes the muscles left longest, two exercises each, for a count of four', () => {
    // Spaced wider than the seeded wobble on need (3 days), so the order is the same for every seed.
    const recency = { chest: 2, lats: 3, quads: 6, biceps: 10, abs: 14, calves: 2 };
    for (const seed of seeds(40)) {
      const plan = generateQuickSession(input(pool, { recency }), opts({ count: 4 }), seed);
      expect([...new Set(rowMuscles(plan))].sort()).toEqual(['abs', 'biceps']);
      expect(plan.rows).toHaveLength(4);
      expect(plan.focus).toEqual(['abs', 'biceps']);
      expect(plan.relaxed).toBe(false);
    }
  });

  it('takes ceil(count / 2) groups, and at least two', () => {
    // chest and lats were trained under two days ago, so they sit out; the rest are spaced past the wobble.
    const recency = { chest: 0, lats: 1, quads: 2, biceps: 6, abs: 10, calves: 14 };
    const groupsFor = (count: number) => new Set(rowMuscles(generateQuickSession(input(pool, { recency }), opts({ count }), 3)));
    expect(groupsFor(1).size).toBe(1);
    expect(groupsFor(2)).toEqual(new Set(['calves', 'abs']));
    expect(groupsFor(3)).toEqual(new Set(['calves', 'abs']));
    expect(groupsFor(5)).toEqual(new Set(['calves', 'abs', 'biceps']));
    expect(groupsFor(6)).toEqual(new Set(['calves', 'abs', 'biceps']));
    expect(groupsFor(8)).toEqual(new Set(['calves', 'abs', 'biceps', 'quads']));
  });

  it('reports as its focus the muscles that got an exercise, not the ones it was ready to use', () => {
    const recency = { chest: 0, lats: 1, quads: 2, biceps: 6, abs: 10, calves: 14 };
    for (const count of [1, 3, 5]) {
      const plan = generateQuickSession(input(pool, { recency }), opts({ count }), 3);
      expect([...plan.focus].sort()).toEqual([...new Set(rowMuscles(plan))].sort());
    }
    // The order is the order of need.
    expect(generateQuickSession(input(pool, { recency }), opts({ count: 5 }), 3).focus).toEqual(['calves', 'abs', 'biceps']);
  });

  it('Shuffle can swap muscles that are about equally due, but never a rested one for an overdue one', () => {
    const many: MuscleGroup[] = ['chest', 'lats', 'quads', 'biceps', 'abs', 'calves', 'glutes', 'triceps'];
    // Two muscles far overdue, four about equally due (6 to 8 days), two trained yesterday.
    const recency = { abs: 14, calves: 13, chest: 8, lats: 7, quads: 6, biceps: 7, glutes: 1, triceps: 0 };
    const focusSets = new Set<string>();
    for (const seed of seeds(80)) {
      const plan = generateQuickSession(input(groupPool(many, 3), { recency }), opts({ count: 6 }), seed);
      const used = new Set(rowMuscles(plan));
      expect(used.has('abs'), `seed ${seed}`).toBe(true);
      expect(used.has('calves'), `seed ${seed}`).toBe(true);
      expect(used.has('glutes'), `seed ${seed}`).toBe(false);
      expect(used.has('triceps'), `seed ${seed}`).toBe(false);
      focusSets.add([...used].sort().join('+'));
    }
    // The middle muscle of the three slots is not always the same one.
    expect(focusSets.size).toBeGreaterThan(2);
  });

  it('a muscle never trained counts as fourteen days, the most any muscle is worth', () => {
    // chest was 9 days ago, so it always loses to the two never trained (more than the wobble apart); and neither of those beats the other.
    const seen = new Set<string>();
    for (const seed of seeds(60)) {
      const plan = generateQuickSession(input(groupPool(['chest', 'lats', 'quads'], 2), { recency: { chest: 9 } }), opts({ count: 2 }), seed);
      for (const m of rowMuscles(plan)) seen.add(m);
    }
    expect(seen).toEqual(new Set(['lats', 'quads']));
  });

  it('days beyond fourteen are capped, so a very old muscle does not always come first', () => {
    const taken = new Set<string>();
    for (const seed of seeds(60)) {
      const plan = generateQuickSession(input(groupPool(['chest', 'lats', 'quads'], 2), { recency: { quads: 100, lats: 14, chest: 14 } }), opts({ count: 2 }), seed);
      for (const m of rowMuscles(plan)) taken.add(m);
    }
    expect(taken).toEqual(new Set(['chest', 'lats', 'quads']));
    // ...and the tie among three groups is not always broken the same way.
    const firstPairs = new Set(seeds(60).map((s) => [...new Set(rowMuscles(generateQuickSession(input(groupPool(['chest', 'lats', 'quads'], 2), { recency: { quads: 100, lats: 14, chest: 14 } }), opts({ count: 2 }), s)))].sort().join('+')));
    expect(firstPairs.size).toBeGreaterThan(1);
    // Uncapped, quads on 100 days would be in every plan.
    expect(firstPairs.has('chest+lats')).toBe(true);
  });

  it('a shortfall against the weekly target adds two days of need for every missing set', () => {
    const p = groupPool(['chest', 'lats', 'quads'], 3);
    const recency = { chest: 3, lats: 8, quads: 6 };
    const without = generateQuickSession(input(p, { recency }), opts({ count: 2 }), 1);
    expect([...new Set(rowMuscles(without))].sort()).toEqual(['lats', 'quads']);
    const behind = generateQuickSession(input(p, { recency, weeklyTargets: { chest: 10 }, weeklySets: { chest: 0 } }), opts({ count: 2 }), 1);
    expect([...new Set(rowMuscles(behind))].sort()).toEqual(['chest', 'lats']);
    // Two missing sets are worth four days: 3 + 4 = 7 beats quads on 6 but not lats on 8.
    const two = generateQuickSession(input(p, { recency, weeklyTargets: { chest: 10 }, weeklySets: { chest: 8 } }), opts({ count: 2 }), 1);
    expect([...new Set(rowMuscles(two))].sort()).toEqual(['chest', 'lats']);
    // One missing set is worth two days: 3 + 2 = 5 does not beat quads on 6.
    const one = generateQuickSession(input(p, { recency, weeklyTargets: { chest: 10 }, weeklySets: { chest: 9 } }), opts({ count: 2 }), 1);
    expect([...new Set(rowMuscles(one))].sort()).toEqual(['lats', 'quads']);
  });

  it('a muscle over its weekly target gains nothing and loses nothing from it: it keeps the need its days give it', () => {
    const p = groupPool(['chest', 'lats', 'quads'], 3);
    const recency = { chest: 14, lats: 8, quads: 6 };
    const none = generateQuickSession(input(p, { recency }), opts({ count: 2 }), 1);
    expect([...new Set(rowMuscles(none))].sort()).toEqual(['chest', 'lats']);
    // 25 sets against a target of 10 must not pull chest below lats and quads.
    const over = generateQuickSession(input(p, { recency, weeklyTargets: { chest: 10 }, weeklySets: { chest: 25 } }), opts({ count: 2 }), 1);
    expect(over).toEqual(none);
  });

  it('a muscle trained fewer than two days ago is left out', () => {
    const p = groupPool(['chest', 'lats', 'quads', 'biceps'], 3);
    for (const seed of seeds(30)) {
      const plan = generateQuickSession(input(p, { recency: { chest: 0, lats: 1 } }), opts({ count: 4 }), seed);
      expect(rowMuscles(plan)).not.toContain('chest');
      expect(rowMuscles(plan)).not.toContain('lats');
      expect(plan.relaxed).toBe(false);
    }
  });

  it('two days ago is rested: the boundary is fewer than two, not two or fewer', () => {
    const p = groupPool(['chest', 'lats'], 3);
    const atTwo = generateQuickSession(input(p, { recency: { chest: 2, lats: 2 } }), opts({ count: 4 }), 1);
    expect([...new Set(rowMuscles(atTwo))].sort()).toEqual(['chest', 'lats']);
    expect(atTwo.relaxed).toBe(false);
    const atOne = generateQuickSession(input(p, { recency: { chest: 1, lats: 2 } }), opts({ count: 4 }), 1);
    expect(rowMuscles(atOne)).toEqual(['lats', 'lats']);
    expect(atOne.relaxed).toBe(false);
  });

  it('when every muscle was trained under two days ago the rule is dropped, and the plan says so', () => {
    const p = groupPool(['chest', 'lats', 'quads'], 3);
    const plan = generateQuickSession(input(p, { recency: { chest: 0, lats: 1, quads: 1 } }), opts({ count: 4 }), 2);
    expect(plan.relaxed).toBe(true);
    expect(plan.rows).toHaveLength(4);
    // Relaxed, need still decides: the longest-ago of them comes first.
    expect(rowMuscles(plan).filter((m) => m === 'chest')).toHaveLength(0);
  });

  it('relaxed is false when nothing had to be dropped, and when there is no pool at all', () => {
    const p = groupPool(['chest', 'lats'], 3);
    expect(generateQuickSession(input(p, { recency: {} }), opts({ count: 3 }), 1).relaxed).toBe(false);
    expect(generateQuickSession(input([], { recency: { chest: 0 } }), opts({ count: 3 }), 1).relaxed).toBe(false);
  });

  it('with the rule kept, a count the rested muscles cannot fill is short rather than reaching into the tired ones', () => {
    const p = groupPool(['chest', 'lats', 'quads'], 3);
    const plan = generateQuickSession(input(p, { recency: { chest: 0, lats: 0 } }), opts({ count: 4 }), 1);
    expect(rowMuscles(plan)).toEqual(['quads', 'quads']);
    expect(plan.shortfall).toBe(2);
    expect(plan.relaxed).toBe(false);
  });

  it('adds muscle groups as the first ones run dry, so a derived plan can still reach its minutes', () => {
    // Two exercises per muscle and a 40 minute target: more than four groups are needed.
    const p = groupPool(['chest', 'lats', 'quads', 'biceps', 'abs', 'calves'], 2);
    const plan = generateQuickSession(input(p), opts({ minutes: 40 }), 4);
    expect(new Set(rowMuscles(plan)).size).toBeGreaterThan(2);
    expect(plan.estimateMin).toBeGreaterThanOrEqual(40);
  });
});

describe('generateQuickSession: a typed focus', () => {
  const muscles: MuscleGroup[] = ['chest', 'lats', 'quads', 'biceps', 'abs'];
  const pool = groupPool(muscles);

  it('wins: it trains a muscle that was trained today', () => {
    const plan = generateQuickSession(input(pool, { recency: { chest: 0, lats: 0, quads: 0, biceps: 0, abs: 0 } }), opts({ focus: ['chest'], count: 2 }), 1);
    expect(rowMuscles(plan)).toEqual(['chest', 'chest']);
    expect(plan.relaxed).toBe(false);
    expect(plan.focus).toEqual(['chest']);
  });

  it('only ever draws from the focus', () => {
    for (const seed of seeds(60)) {
      const plan = generateQuickSession(input(pool), opts({ focus: ['lats', 'biceps'], count: 4 }), seed);
      expect(new Set(rowMuscles(plan))).toEqual(new Set(['lats', 'biceps']));
    }
  });

  it('with more muscles than exercises, takes the neediest muscles', () => {
    const recency = { chest: 5, lats: 9, quads: 8, biceps: 2, abs: 7 };
    const plan = generateQuickSession(input(pool, { recency }), opts({ focus: ['chest', 'lats', 'quads', 'biceps', 'abs'], count: 3 }), 1);
    expect(new Set(rowMuscles(plan))).toEqual(new Set(['lats', 'quads', 'abs']));
  });

  it('a focus muscle with nothing to pick is unmet and is not swapped for another muscle', () => {
    for (const seed of seeds(30)) {
      const plan = generateQuickSession(input(pool), opts({ focus: ['calves', 'chest'], count: 3 }), seed);
      expect(plan.unmet).toEqual(['calves']);
      // Only the muscles that were named are trained: chest, which was named, takes the count.
      expect(new Set(rowMuscles(plan))).toEqual(new Set(['chest']));
      expect(plan.rows).toHaveLength(3);
      expect(plan.shortfall).toBe(0);
    }
  });

  it('a muscle group that names no muscle can be typed but is never trained: it is unmet', () => {
    const p = [...pool, cand({ id: 'burpee', muscleGroup: 'full body' }), cand({ id: 'misc', muscleGroup: 'other' })];
    const plan = generateQuickSession(input(p), opts({ focus: ['full body', 'other'], count: 2 }), 1);
    expect(plan.rows).toEqual([]);
    expect(plan.unmet).toEqual(['full body', 'other']);
  });

  it('a focus that no exercise can serve gives no rows, all of it unmet, and is short by the whole count', () => {
    const plan = generateQuickSession(input(pool), opts({ focus: ['calves'], count: 4 }), 1);
    expect(plan.rows).toEqual([]);
    expect(plan.unmet).toEqual(['calves']);
    expect(plan.shortfall).toBe(4);
    expect(plan.estimateMin).toBe(0);
  });

  it('a muscle that has candidates only in the catalogue is unmet while new exercises are off', () => {
    const withCatalogue = [...pool, cand({ id: 'cat-calf', muscleGroup: 'calves', origin: 'catalogue', catalogueSlug: 'cat-calf' })];
    expect(generateQuickSession(input(withCatalogue), opts({ focus: ['calves'], count: 2 }), 1).unmet).toEqual(['calves']);
    const on = generateQuickSession(input(withCatalogue), opts({ focus: ['calves'], count: 2, includeNew: true }), 1);
    expect(on.unmet).toEqual([]);
    expect(rowIds(on)).toEqual(['cat-calf']);
  });

  it('a muscle named on its own can fill the whole count', () => {
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(groupPool(['biceps'], 5)), opts({ focus: ['biceps'], count: 4 }), seed);
      expect(rowMuscles(plan)).toEqual(['biceps', 'biceps', 'biceps', 'biceps']);
      expect(plan.shortfall).toBe(0);
    }
  });

  it('a muscle named on its own takes only what it has, and the rest is a shortfall', () => {
    const plan = generateQuickSession(input(groupPool(['biceps'], 3)), opts({ focus: ['biceps'], count: 4 }), 1);
    expect(plan.rows).toHaveLength(3);
    expect(plan.shortfall).toBe(1);
  });

  it('a focus is not widened to make up a count: with two muscles named, two each is the most', () => {
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(groupPool(['biceps', 'triceps'], 5)), opts({ focus: ['biceps', 'triceps'], count: 4 }), seed);
      expect(rowMuscles(plan).filter((m) => m === 'biceps')).toHaveLength(2);
      expect(rowMuscles(plan).filter((m) => m === 'triceps')).toHaveLength(2);
    }
    // ...and a focus of three muscles asked for four gives no muscle a third exercise.
    const three = generateQuickSession(input(groupPool(['biceps', 'triceps', 'forearms'], 5)), opts({ focus: ['biceps', 'triceps', 'forearms'], count: 4 }), 1);
    const per = new Map<MuscleGroup, number>();
    for (const m of rowMuscles(three)) per.set(m, (per.get(m) ?? 0) + 1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
    expect(three.rows).toHaveLength(4);
  });

  it('with no muscle named, no muscle takes more than two however few muscles have exercises', () => {
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(groupPool(['biceps'], 6)), opts({ count: 4 }), seed);
      expect(plan.rows).toHaveLength(2);
      expect(plan.shortfall).toBe(2);
    }
  });

  it('a muscle ruled out is removed from the focus and from the pool', () => {
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(pool), opts({ focus: ['chest', 'lats'], exclude: ['chest'], count: 2 }), seed);
      expect(new Set(rowMuscles(plan))).toEqual(new Set(['lats']));
      expect(plan.focus).toEqual(['lats']);
      expect(plan.unmet).toEqual([]);
    }
  });

  it('with no focus, a muscle ruled out is never chosen', () => {
    for (const seed of seeds(40)) {
      const plan = generateQuickSession(input(pool, { recency: { chest: 14, lats: 3 } }), opts({ exclude: ['chest', 'quads'], count: 6 }), seed);
      for (const m of rowMuscles(plan)) expect(['chest', 'quads']).not.toContain(m);
      expect(plan.unmet).toEqual([]);
    }
  });

  it('a focus that is all ruled out falls back to choosing by need', () => {
    const plan = generateQuickSession(input(pool), opts({ focus: ['chest'], exclude: ['chest'], count: 2 }), 1);
    expect(plan.rows).toHaveLength(2);
    expect(rowMuscles(plan)).not.toContain('chest');
  });
});

// ---------------------------------------------------------------------------
// Equipment

describe('generateQuickSession: equipment', () => {
  const pool = [
    cand({ id: 'a', muscleGroup: 'chest', equipment: 'dumbbell' }),
    cand({ id: 'b', muscleGroup: 'chest', equipment: 'cable' }),
    cand({ id: 'c', muscleGroup: 'lats', equipment: 'machine' }),
    cand({ id: 'd', muscleGroup: 'lats', equipment: 'barbell' }),
    cand({ id: 'e', muscleGroup: 'quads' }),
    cand({ id: 'f', muscleGroup: 'quads', equipment: 'bodyweight' }),
  ];

  it('keeps only the equipment allowed, and drops an exercise with none recorded', () => {
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(pool), opts({ equipment: ['dumbbell', 'cable'], count: 6 }), seed);
      expect(rowIds(plan).sort()).toEqual(['a', 'b']);
    }
  });

  it('reads an exercise with no equipment recorded as "other"', () => {
    expect(rowIds(generateQuickSession(input(pool), opts({ equipment: ['other'], count: 6 }), 1))).toEqual(['e']);
  });

  it('an empty list allows everything', () => {
    expect(generateQuickSession(input(pool), opts({ equipment: [], count: 6 }), 1).rows).toHaveLength(6);
  });

  it('a filter that leaves a focus muscle nothing makes it unmet', () => {
    const plan = generateQuickSession(input(pool), opts({ equipment: ['dumbbell'], focus: ['lats'], count: 2 }), 1);
    expect(plan.unmet).toEqual(['lats']);
  });
});

// ---------------------------------------------------------------------------
// Count and shortfall

describe('generateQuickSession: how many', () => {
  const muscles: MuscleGroup[] = ['chest', 'lats', 'quads', 'biceps', 'abs', 'calves'];
  const pool = groupPool(muscles, 3);

  it('an explicit count is honoured, including below the derived minimum of three', () => {
    for (const count of [1, 2, 3, 5, 8]) {
      expect(generateQuickSession(input(pool), opts({ count }), 9).rows, `count ${count}`).toHaveLength(count);
    }
  });

  it('an explicit count beats the minutes', () => {
    expect(generateQuickSession(input(pool), opts({ count: 2, minutes: 90 }), 1).rows).toHaveLength(2);
    expect(generateQuickSession(input(pool), opts({ count: 8, minutes: 10 }), 1).rows).toHaveLength(8);
  });

  it('a count above what the pool holds gives a shorter plan and says by how many', () => {
    const small = groupPool(['chest'], 2).concat(groupPool(['lats'], 1));
    const plan = generateQuickSession(input(small), opts({ count: 6 }), 1);
    expect(plan.rows).toHaveLength(3);
    expect(plan.shortfall).toBe(3);
  });

  it('a count the pool meets has no shortfall', () => {
    expect(generateQuickSession(input(pool), opts({ count: 6 }), 1).shortfall).toBe(0);
  });

  it('a derived plan of fewer than three, because the pool has fewer, is short by the difference', () => {
    const plan = generateQuickSession(input(groupPool(['chest'], 2)), opts(), 1);
    expect(plan.rows).toHaveLength(2);
    expect(plan.shortfall).toBe(1);
  });

  it('a derived plan that reaches its minutes has no shortfall', () => {
    expect(generateQuickSession(input(pool), opts({ minutes: 30 }), 1).shortfall).toBe(0);
  });
});

describe('generateQuickSession: deriving the count from the minutes', () => {
  // Every exercise costs 60 + 3 x 40 + 2 x 75 = 330 s = 5.5 min, so the arithmetic is checkable by hand.
  const uniform = groupPool(['chest', 'lats', 'quads', 'biceps', 'abs', 'calves', 'glutes', 'triceps'], 2);

  it('adds rows until the estimate first reaches the target', () => {
    const cases: [number, number, number][] = [
      [20, 4, 22], // 3 rows = 17 min, short of 20, so a fourth: 22
      [30, 6, 33], // 5 rows = 28 min, so a sixth: 33
      [40, 8, 44], // 7 rows = 39 min, so an eighth: 44
    ];
    for (const [minutes, rows, estimate] of cases) {
      for (const seed of seeds(10)) {
        const plan = generateQuickSession(input(uniform), opts({ minutes }), seed);
        expect(plan.rows, `${minutes} min`).toHaveLength(rows);
        expect(plan.estimateMin, `${minutes} min`).toBe(estimate);
      }
    }
  });

  it('stops at a target it meets exactly, without one more for luck', () => {
    // 60 + 3 x 40 + 2 x 210 = 600 s: ten minutes an exercise.
    const tenEach = groupPool(['chest', 'lats', 'quads', 'biceps', 'abs'], 2, { defaultRestSec: 210 });
    for (const [minutes, rows] of [[30, 3], [40, 4], [50, 5]] as const) {
      const plan = generateQuickSession(input(tenEach), opts({ minutes }), 2);
      expect(plan.rows, `${minutes} min`).toHaveLength(rows);
      expect(plan.estimateMin, `${minutes} min`).toBe(minutes);
    }
  });

  it('never goes below three rows or above eight, and does not clamp the estimate to make up for it', () => {
    const tiny = generateQuickSession(input(uniform), opts({ minutes: 10 }), 1);
    expect(tiny.rows).toHaveLength(3);
    expect(tiny.estimateMin).toBe(17);
    const huge = generateQuickSession(input(uniform), opts({ minutes: 90 }), 1);
    expect(huge.rows).toHaveLength(8);
    expect(huge.estimateMin).toBe(44);
  });

  it('measures against the owner\'s pace', () => {
    const slow = generateQuickSession(input(uniform, { pace: 1.5 }), opts({ minutes: 40 }), 1);
    // 5 rows x 5.5 min x 1.5 = 41.25 reaches 40.
    expect(slow.rows).toHaveLength(5);
    expect(slow.estimateMin).toBe(41);
    const fast = generateQuickSession(input(uniform, { pace: 0.6 }), opts({ minutes: 20 }), 1);
    expect(fast.estimateMin).toBeGreaterThanOrEqual(20);
    expect(estimateMinutes(fast.rows, 0.6)).toBe(fast.estimateMin);
  });

  it('where it can, stays at or under 45 minutes rather than adding a heavy exercise that overshoots', () => {
    // Each muscle offers a long exercise (4 x 150 s rest, 11 min) and a short one (5.5 min).
    const mixed: Candidate[] = ['chest', 'lats', 'quads', 'biceps'].flatMap((m) => [
      cand({ id: `${m}-long`, muscleGroup: m as MuscleGroup, isCompound: true, defaultRestSec: 150, base: { sets: 4, repMin: 6, repMax: 8, weightKg: 60, mode: 'normal' } }),
      cand({ id: `${m}-short`, muscleGroup: m as MuscleGroup, base: { sets: 3, repMin: 10, repMax: 12, weightKg: 20, mode: 'normal' } }),
    ]);
    for (const seed of seeds(200)) {
      const plan = generateQuickSession(input(mixed), opts({ minutes: 40 }), seed);
      expect(plan.estimateMin, `seed ${seed}`).toBeGreaterThanOrEqual(40);
      expect(plan.estimateMin, `seed ${seed}`).toBeLessThanOrEqual(45);
    }
  });

  it('when it has to overshoot, it overshoots by the cheapest exercise available and no more', () => {
    // Eight muscles in a fixed order of need, one exercise each: four short (5.5 min), two long
    // (11 min), then a long and a short. After the six, the plan is at 44 min and nothing fits under
    // 45: the short one of the last two must be taken, not the long one next in turn.
    const short = { sets: 3, repMin: 10, repMax: 12, weightKg: 20, mode: 'normal' as const };
    const long = { sets: 4, repMin: 6, repMax: 8, weightKg: 60, mode: 'normal' as const };
    const order: MuscleGroup[] = ['chest', 'lats', 'quads', 'biceps', 'abs', 'calves', 'glutes', 'triceps'];
    const kinds = [short, short, short, short, long, long, long, short];
    const scripted = order.map((m, i) => cand({ id: m, muscleGroup: m, isCompound: kinds[i] === long, defaultRestSec: kinds[i] === long ? 150 : 75, base: kinds[i] }));
    // A fixed order of need that the seeded wobble on need (3 days) cannot upset: every muscle equally
    // rested, and a shortfall against the weekly target that steps down by two sets (four days of need).
    const weeklyTargets = Object.fromEntries(order.map((m, i) => [m, 30 - 2 * i]));
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(scripted, { weeklyTargets }), opts({ focus: order, minutes: 45 }), seed);
      expect(rowIds(plan).sort(), `seed ${seed}`).toEqual(['abs', 'biceps', 'calves', 'chest', 'lats', 'quads', 'triceps']);
      expect(plan.estimateMin, `seed ${seed}`).toBe(50);
    }
  });

  it('a muscle taken out of turn to fit the time still counts against its own limit of two', () => {
    // Chest and lats each offer one long exercise (16 min) and one short; quads and biceps offer
    // three short. Near the ceiling the long ones stop fitting and the short ones are taken from
    // whichever muscle has them, so quads and biceps are reached out of turn.
    const long = (m: MuscleGroup) => cand({ id: `${m}-long`, muscleGroup: m, isCompound: true, defaultRestSec: 240, base: { sets: 4, repMin: 6, repMax: 8, weightKg: 60, mode: 'normal' } });
    const short = (m: MuscleGroup, i: number) => cand({ id: `${m}-short${i}`, muscleGroup: m, base: { sets: 3, repMin: 10, repMax: 12, weightKg: 20, mode: 'normal' } });
    const pool = [long('chest'), short('chest', 0), long('lats'), short('lats', 0), ...[0, 1, 2].map((i) => short('quads', i)), ...[0, 1, 2].map((i) => short('biceps', i))];
    const recency = { chest: 14, lats: 13, quads: 12, biceps: 11 };
    for (const seed of seeds(12)) {
      const plan = generateQuickSession(input(pool, { recency }), opts({ minutes: 50 }), seed);
      const perMuscle = new Map<MuscleGroup, number>();
      for (const m of rowMuscles(plan)) perMuscle.set(m, (perMuscle.get(m) ?? 0) + 1);
      for (const [m, n] of perMuscle) expect(n, `seed ${seed}: ${m}`).toBeLessThanOrEqual(2);
      expect(new Set(rowIds(plan)).size).toBe(plan.rows.length);
    }
  });

  it('a plan is never more than the cheapest exercise over, in a pool with cheap exercises to spare', () => {
    // Each muscle has one long exercise and four short ones; two per muscle at most.
    const rich: Candidate[] = ['chest', 'lats', 'quads', 'biceps', 'abs', 'calves'].flatMap((m) => [
      cand({ id: `${m}-long`, muscleGroup: m as MuscleGroup, isCompound: true, defaultRestSec: 150, base: { sets: 4, repMin: 6, repMax: 8, weightKg: 60, mode: 'normal' } }),
      ...[0, 1, 2, 3].map((i) => cand({ id: `${m}-short${i}`, muscleGroup: m as MuscleGroup, base: { sets: 3, repMin: 10, repMax: 12, weightKg: 20, mode: 'normal' } })),
    ]);
    for (const minutes of [30, 40, 45, 50, 60]) {
      for (const seed of seeds(80)) {
        const plan = generateQuickSession(input(rich), opts({ minutes }), seed);
        const perMuscle = new Map<MuscleGroup, number>();
        for (const m of rowMuscles(plan)) perMuscle.set(m, (perMuscle.get(m) ?? 0) + 1);
        for (const n of perMuscle.values()) expect(n, `${minutes} min, seed ${seed}`).toBeLessThanOrEqual(2);
        if (plan.rows.length < 8) expect(plan.estimateMin, `${minutes} min, seed ${seed}`).toBeGreaterThanOrEqual(minutes);
      }
    }
  });

  it('when nothing can keep it under 45 it still returns the plan, with its true estimate', () => {
    const heavy = groupPool(['chest', 'lats', 'quads', 'biceps'], 2, { isCompound: true, defaultRestSec: 150, base: { sets: 5, repMin: 5, repMax: 5, weightKg: 60, mode: 'normal' } });
    // One row: 60 + 200 + 4 x 150 = 860 s = 14.3 min. Three rows is 43; four is 57.
    const plan = generateQuickSession(input(heavy), opts({ minutes: 45 }), 1);
    expect(plan.estimateMin).toBeGreaterThan(45);
    expect(plan.estimateMin).toBe(estimateMinutes(plan.rows, 1));
  });

  it('is capacity-limited, not padded: a pool too small to reach the target returns what it has', () => {
    const plan = generateQuickSession(input(groupPool(['chest', 'lats'], 2)), opts({ minutes: 40 }), 1);
    expect(plan.rows).toHaveLength(4);
    expect(plan.estimateMin).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// Time

describe('estimateMinutes', () => {
  const compound = cand({ id: 'c', isCompound: true, defaultRestSec: 150 });
  const row = (over: Partial<Pick<QuickRow, 'sets' | 'restSec'>> & { candidate?: Candidate } = {}) => ({ sets: 3, restSec: 150, candidate: compound, ...over });

  it('is 60 s of setup, 40 s a set and the rests between sets, in whole minutes', () => {
    // 60 + 3 x 40 + 2 x 150 = 480 s.
    expect(estimateMinutes([row()], 1)).toBe(8);
    // 60 + 4 x 40 + 3 x 75 = 445 s = 7.4 min.
    expect(estimateMinutes([row({ sets: 4, restSec: 75 })], 1)).toBe(7);
  });

  it('there is no rest after the last set: a single set is setup plus work', () => {
    expect(estimateMinutes([row({ sets: 1 })], 1)).toBe(2);
  });

  it('is nothing for nothing', () => {
    expect(estimateMinutes([], 1)).toBe(0);
  });

  it('scales by pace and rounds to the nearest minute', () => {
    expect(estimateMinutes([row()], 1.25)).toBe(10);
    expect(estimateMinutes([row()], 0.5)).toBe(4);
    expect(estimateMinutes([row()], 1.1)).toBe(9);
  });

  it('reads a pace that is no number, or not positive, as 1', () => {
    for (const pace of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) expect(estimateMinutes([row()], pace)).toBe(8);
  });

  it('doubles the work time of a unilateral exercise and nothing else', () => {
    const both = cand({ id: 'both', unilateral: false });
    const one = cand({ id: 'one', unilateral: true });
    const four = (c: Candidate) => Array.from({ length: 4 }, () => row({ sets: 3, restSec: 75, candidate: c }));
    // 4 x (60 + 120 + 150) = 22 min, against 4 x (60 + 240 + 150) = 30 min.
    expect(estimateMinutes(four(both), 1)).toBe(22);
    expect(estimateMinutes(four(one), 1)).toBe(30);
  });

  it('a generated plan with unilateral exercises is longer by exactly their extra work', () => {
    const make = (unilateral: boolean) => groupPool(['chest', 'lats', 'quads', 'biceps'], 1, { unilateral });
    const a = generateQuickSession(input(make(false)), opts({ count: 4 }), 3);
    const b = generateQuickSession(input(make(true)), opts({ count: 4 }), 3);
    expect(rowIds(a)).toEqual(rowIds(b));
    expect(b.estimateMin - a.estimateMin).toBe(8);
  });

  it('eight compounds come to well over the 45 minute ceiling and are not clamped into it', () => {
    const compounds = groupPool(['chest', 'lats', 'quads', 'hamstrings'], 2, { isCompound: true, defaultRestSec: 150, base: { sets: 4, repMin: 6, repMax: 8, weightKg: 60, mode: 'normal' } });
    const plan = generateQuickSession(input(compounds), opts({ count: 8 }), 1);
    expect(plan.rows).toHaveLength(8);
    // 8 x (60 + 4 x 40 + 3 x 150) = 5360 s.
    expect(plan.estimateMin).toBe(89);
  });

  it('one short exercise is not padded up to the bottom of the window either', () => {
    const plan = generateQuickSession(input(groupPool(['chest'], 3)), opts({ count: 1 }), 1);
    expect(plan.rows).toHaveLength(1);
    expect(plan.estimateMin).toBe(6);
  });
});

describe('paceFactor', () => {
  const s = (durationSec: number, modelledSec = 1000) => ({ durationSec, modelledSec });

  it('is 1 with fewer than three usable sessions', () => {
    expect(paceFactor([])).toBe(1);
    expect(paceFactor([s(1200)])).toBe(1);
    expect(paceFactor([s(1200), s(1200)])).toBe(1);
  });

  it('is the median of actual over modelled', () => {
    expect(paceFactor([s(1100), s(1200), s(1300)])).toBeCloseTo(1.2, 10);
    expect(paceFactor([s(1300), s(1100), s(900)])).toBeCloseTo(1.1, 10);
  });

  it('the median of an even number is the mean of the middle two', () => {
    expect(paceFactor([s(1000), s(1100), s(1300), s(1500)])).toBeCloseTo(1.2, 10);
  });

  it('one wild session does not move the median', () => {
    expect(paceFactor([s(1000), s(1000), s(1000), s(9000)])).toBeCloseTo(1, 10);
  });

  it('is held to 0.6 at the fast end and 1.6 at the slow end', () => {
    expect(paceFactor([s(100), s(200), s(300)])).toBe(0.6);
    expect(paceFactor([s(3000), s(4000), s(5000)])).toBe(1.6);
    expect(paceFactor([s(1600), s(1600), s(1600)])).toBeCloseTo(1.6, 10);
  });

  it('drops zero, negative and over-three-hour durations, and those do not count towards the three', () => {
    const stale = [s(0), s(-500), s(3 * 3600 + 1), s(20000)];
    expect(paceFactor([s(1200), s(1200), ...stale])).toBe(1);
    expect(paceFactor([s(1200), s(1200), s(1200), ...stale])).toBeCloseTo(1.2, 10);
    // Exactly three hours is still a session.
    expect(paceFactor([s(3 * 3600, 10000), s(3 * 3600, 10000), s(3 * 3600, 10000)])).toBeCloseTo(1.08, 10);
  });

  it('drops a session with no modelled time or a value that is no number', () => {
    const junk = [s(1200, 0), s(1200, -1), s(Number.NaN), s(1200, Number.NaN), s(Number.POSITIVE_INFINITY)];
    expect(paceFactor([s(1100), s(1100), ...junk])).toBe(1);
    expect(paceFactor([s(1100), s(1100), s(1100), ...junk])).toBeCloseTo(1.1, 10);
  });
});

// ---------------------------------------------------------------------------
// Prescription

describe('generateQuickSession: prescription', () => {
  const only = (c: Candidate, options: Partial<QuickOptions> = {}, over: Partial<QuickInput> = {}): QuickRow => {
    const plan = generateQuickSession(input([c], over), opts({ count: 1, ...options }), 1);
    expect(plan.rows).toHaveLength(1);
    return plan.rows[0];
  };

  describe('normal effort', () => {
    it("copies the owner's own sets, reps and weight", () => {
      const r = only(cand({ id: 'a', isCompound: true, base: { sets: 4, repMin: 6, repMax: 8, weightKg: 82.5, mode: 'normal' } }));
      expect(r).toMatchObject({ sets: 4, repMin: 6, repMax: 8, weightKg: 82.5, mode: 'normal' });
    });

    it('a compound with no base is 3 x 8-10 to be calibrated, an isolation 3 x 10-15', () => {
      expect(only(cand({ id: 'a', isCompound: true }))).toMatchObject({ sets: 3, repMin: 8, repMax: 10, weightKg: null, mode: 'calibrating' });
      expect(only(cand({ id: 'a', isCompound: false }))).toMatchObject({ sets: 3, repMin: 10, repMax: 15, weightKg: null, mode: 'calibrating' });
    });

    it('a base still calibrating keeps its sets and reps but has no weight to show', () => {
      const r = only(cand({ id: 'a', base: { sets: 4, repMin: 8, repMax: 12, weightKg: 30, mode: 'calibrating' } }));
      expect(r).toMatchObject({ sets: 4, repMin: 8, repMax: 12, weightKg: null, mode: 'calibrating' });
    });

    it('a base with no weight is calibrating', () => {
      expect(only(cand({ id: 'a', base: { sets: 3, repMin: 10, repMax: 12, weightKg: null, mode: 'normal' } }))).toMatchObject({ weightKg: null, mode: 'calibrating' });
    });

    it('an added weight of zero is a weight, for an exercise done on bodyweight', () => {
      const r = only(cand({ id: 'a', kind: 'bodyweight_plus', base: { sets: 3, repMin: 10, repMax: 15, weightKg: 0, mode: 'normal' } }));
      expect(r).toMatchObject({ weightKg: 0, mode: 'normal' });
    });

    it('a base with impossible sets or reps falls back to the defaults for those, keeping the weight', () => {
      const r = only(cand({ id: 'a', isCompound: true, base: { sets: 0, repMin: 12, repMax: 8, weightKg: 50, mode: 'normal' } }));
      expect(r).toMatchObject({ sets: 3, repMin: 8, repMax: 10, weightKg: 50, mode: 'normal' });
    });
  });

  describe('light effort', () => {
    it('is two sets for an isolation and three for a compound, of 10-15, whatever the base says', () => {
      const iso = only(cand({ id: 'a', equipment: 'dumbbell', base: { sets: 5, repMin: 3, repMax: 5, weightKg: 20, mode: 'normal' } }), { effort: 'light' });
      const comp = only(cand({ id: 'b', equipment: 'dumbbell', isCompound: true, base: { sets: 5, repMin: 3, repMax: 5, weightKg: 20, mode: 'normal' } }), { effort: 'light' });
      expect(iso).toMatchObject({ sets: 2, repMin: 10, repMax: 15 });
      expect(comp).toMatchObject({ sets: 3, repMin: 10, repMax: 15 });
    });

    it('is 65% of the base, floored to the increment', () => {
      // 40 x 0.65 = 26 → 25 on a 5 kg grid; 9 x 0.65 = 5.85 → 5 on a 1 kg grid; 60 x 0.65 = 39 → 38 on a 2 kg grid.
      const w = (base: number, increment: number) => only(cand({ id: 'a', equipment: 'machine', defaultIncrement: increment, base: { sets: 3, repMin: 8, repMax: 10, weightKg: base, mode: 'normal' } }), { effort: 'light' }).weightKg;
      expect(w(40, 5)).toBe(25);
      expect(w(9, 1)).toBe(5);
      expect(w(60, 2)).toBe(38);
    });

    it('never rounds up past 65%: a weight that lands exactly on the grid stays', () => {
      const r = only(cand({ id: 'a', equipment: 'machine', defaultIncrement: 5, base: { sets: 3, repMin: 8, repMax: 10, weightKg: 100, mode: 'normal' } }), { effort: 'light' });
      expect(r.weightKg).toBe(65);
    });

    it('loads a barbell with the plates the owner has', () => {
      // 60 x 0.65 = 39 → 37.5 on a 2.5 grid, which is 20 + 2 x 8.75: plates 5 + 2.5 + 1.25 a side.
      const r = only(cand({ id: 'a', equipment: 'barbell', base: { sets: 3, repMin: 8, repMax: 12, weightKg: 60, mode: 'normal' } }), { effort: 'light' });
      expect(r.weightKg).toBe(37.5);
      // With only 5 kg plates the nearest loadable weight below is 30.
      const coarse = only(cand({ id: 'a', equipment: 'barbell', base: { sets: 3, repMin: 8, repMax: 12, weightKg: 60, mode: 'normal' } }), { effort: 'light' }, { settings: { ...SETTINGS, plates: [5] } });
      expect(coarse.weightKg).toBe(30);
    });

    it('a barbell that cannot be loaded that light has no weight to give: it is calibrating, not a heavier one', () => {
      // 25 x 0.65 = 16.25, but the bar alone is 20.
      const r = only(cand({ id: 'a', equipment: 'barbell', base: { sets: 3, repMin: 8, repMax: 12, weightKg: 25, mode: 'normal' } }), { effort: 'light' });
      expect(r.weightKg).toBeNull();
      expect(r.mode).toBe('calibrating');
    });

    it('a base of zero stays zero', () => {
      const r = only(cand({ id: 'a', kind: 'bodyweight_plus', equipment: 'bodyweight', base: { sets: 3, repMin: 10, repMax: 15, weightKg: 0, mode: 'normal' } }), { effort: 'light' });
      expect(r).toMatchObject({ weightKg: 0, mode: 'normal' });
    });

    it('with no known weight, is calibrating with none', () => {
      for (const base of [undefined, { sets: 3, repMin: 8, repMax: 10, weightKg: null, mode: 'normal' as const }, { sets: 3, repMin: 8, repMax: 10, weightKg: 40, mode: 'calibrating' as const }]) {
        const r = only(cand({ id: 'a', equipment: 'machine', base }), { effort: 'light' });
        expect(r.weightKg).toBeNull();
        expect(r.mode).toBe('calibrating');
        expect(r).toMatchObject({ sets: 2, repMin: 10, repMax: 15 });
      }
    });
  });

  it("takes each exercise's own rest, and the settings when it has none", () => {
    expect(only(cand({ id: 'a', defaultRestSec: 90 })).restSec).toBe(90);
    expect(only(cand({ id: 'a', defaultRestSec: 0, isCompound: true })).restSec).toBe(150);
    expect(only(cand({ id: 'a', defaultRestSec: 0, isCompound: false })).restSec).toBe(75);
    expect(only(cand({ id: 'a', defaultRestSec: 0, isCompound: true }), {}, { settings: { ...SETTINGS, restCompoundSec: 200 } }).restSec).toBe(200);
  });

  it('shows the days since the muscle was trained, and none for a muscle never trained', () => {
    expect(only(cand({ id: 'a', muscleGroup: 'lats' }), {}, { recency: { lats: 6 } }).daysSince).toBe(6);
    expect(only(cand({ id: 'a', muscleGroup: 'lats' }), {}, { recency: {} }).daysSince).toBeNull();
  });

  it('puts the compound lifts first, and keeps the order they were chosen in otherwise', () => {
    const p = [
      cand({ id: 'i1', muscleGroup: 'chest' }),
      cand({ id: 'i2', muscleGroup: 'lats' }),
      cand({ id: 'c1', muscleGroup: 'quads', isCompound: true }),
      cand({ id: 'c2', muscleGroup: 'biceps', isCompound: true }),
    ];
    for (const seed of seeds(20)) {
      const plan = generateQuickSession(input(p), opts({ count: 4 }), seed);
      expect(plan.rows.map((r) => r.candidate.isCompound)).toEqual([true, true, false, false]);
    }
  });
});

// ---------------------------------------------------------------------------
// What the choice prefers

describe('generateQuickSession: choosing between exercises for a muscle', () => {
  /** Share of 600 seeds, count 1 and a typed muscle, in which `id` is the one chosen. */
  const share = (pool: Candidate[], id: string, options: Partial<QuickOptions> = {}): number => {
    const wins = seeds(600).filter((s) => rowIds(generateQuickSession(input(pool), opts({ focus: ['chest'], count: 1, ...options }), s))[0] === id).length;
    return wins / 600;
  };
  const base = { sets: 3, repMin: 8, repMax: 12, weightKg: 30, mode: 'normal' as const };

  it('prefers an exercise it has a working weight for, without ruling the others out', () => {
    const p = [cand({ id: 'known', base }), cand({ id: 'unknown' })];
    const s = share(p, 'known');
    expect(s).toBeGreaterThan(0.58);
    expect(s).toBeLessThan(0.75);
  });

  it('prefers one not used in the last two days, without ruling the used one out', () => {
    const p = [cand({ id: 'fresh', base }), cand({ id: 'used', base, daysSinceUsed: 1 })];
    const s = share(p, 'used');
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.3);
    // Two days is no longer recent.
    const twoDays = share([cand({ id: 'fresh', base }), cand({ id: 'used', base, daysSinceUsed: 2 })], 'used');
    expect(twoDays).toBeGreaterThan(0.4);
  });

  it('on a light day prefers a machine, a cable and an isolation; on a normal day it does not', () => {
    const p = [cand({ id: 'cable', equipment: 'cable', base }), cand({ id: 'dumbbell-compound', equipment: 'dumbbell', isCompound: true, base })];
    expect(share(p, 'cable', { effort: 'light' })).toBeGreaterThan(0.7);
    const normal = share(p, 'cable');
    expect(normal).toBeGreaterThan(0.4);
    expect(normal).toBeLessThan(0.6);
  });

  it('a catalogue exercise is a garnish beside the own ones, not most of the plan', () => {
    const own = [cand({ id: 'own1', base }), cand({ id: 'own2', base })];
    const catalogue = Array.from({ length: 30 }, (_, i) => cand({ id: `cat${i}`, origin: 'catalogue', catalogueSlug: `cat${i}` }));
    let cat = 0;
    let total = 0;
    for (const seed of seeds(500)) {
      const plan = generateQuickSession(input([...own, ...catalogue]), opts({ focus: ['chest'], count: 2, includeNew: true }), seed);
      total += plan.rows.length;
      cat += plan.rows.filter((r) => r.candidate.origin === 'catalogue').length;
    }
    // Thirty new exercises against two own would be 90% catalogue if every exercise weighed the same.
    expect(cat / total).toBeGreaterThan(0.15);
    expect(cat / total).toBeLessThan(0.5);
  });

  it('a muscle with only catalogue exercises still gets them, up to two', () => {
    const catalogue = Array.from({ length: 5 }, (_, i) => cand({ id: `cat${i}`, origin: 'catalogue', catalogueSlug: `cat${i}` }));
    const plan = generateQuickSession(input(catalogue), opts({ focus: ['chest'], count: 4, includeNew: true }), 1);
    expect(plan.rows).toHaveLength(2);
    expect(plan.shortfall).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Light exclusions, one at a time

describe('generateQuickSession: what a light session leaves out', () => {
  const fine = cand({ id: 'fine', muscleGroup: 'chest', equipment: 'dumbbell', isCompound: true, name: 'Dumbbell Press' });
  const excluded: [string, Partial<Candidate>][] = [
    ['a barbell compound', { equipment: 'barbell', isCompound: true, name: 'Barbell Row' }],
    ['a lift with a strength standard', { equipment: 'machine', isCompound: true, name: 'Chest Press', standard: 'bench' }],
    ['a deadlift', { equipment: 'dumbbell', name: 'Dumbbell Deadlift' }],
    ['a Romanian deadlift', { equipment: 'dumbbell', name: 'Romanian Deadlift (Dumbbell)' }],
    ['an RDL', { equipment: 'dumbbell', name: 'Single Leg RDL' }],
    ['a good morning', { equipment: 'dumbbell', name: 'Good Morning' }],
    ['a good-morning with a hyphen', { equipment: 'barbell', name: 'Good-Morning' }],
    ['a hyperextension', { equipment: 'bodyweight', name: 'Hyperextension' }],
    ['a back extension', { equipment: 'bodyweight', name: 'Back Extension' }],
  ];

  it.each(excluded)('leaves out %s, and keeps it on a normal day', (_label, over) => {
    const c = cand({ id: 'x', muscleGroup: 'chest', ...over });
    const light = generateQuickSession(input([fine, c]), opts({ effort: 'light', focus: ['chest'], count: 2 }), 1);
    expect(rowIds(light)).toEqual(['fine']);
    const normal = generateQuickSession(input([fine, c]), opts({ focus: ['chest'], count: 2 }), 1);
    expect(rowIds(normal).sort()).toEqual(['fine', 'x']);
  });

  it('keeps a barbell isolation, a dumbbell compound, a machine compound and a cable exercise', () => {
    const keep = [
      cand({ id: 'bb-curl', muscleGroup: 'chest', equipment: 'barbell', isCompound: false }),
      cand({ id: 'db-press', muscleGroup: 'chest', equipment: 'dumbbell', isCompound: true }),
      cand({ id: 'machine-row', muscleGroup: 'chest', equipment: 'machine', isCompound: true }),
      cand({ id: 'cable-fly', muscleGroup: 'chest', equipment: 'cable' }),
    ];
    const plan = generateQuickSession(input(keep), opts({ effort: 'light', focus: ['chest'], count: 4 }), 1);
    // Chest is named on its own, so it can take all four: none of the four was ruled out.
    expect(plan.rows).toHaveLength(4);
    for (const id of rowIds(plan)) expect(keep.map((k) => k.id)).toContain(id);
  });

  it('a light plan with nothing but excluded exercises is empty, not a heavy one', () => {
    const plan = generateQuickSession(input([cand({ id: 'x', equipment: 'barbell', isCompound: true })]), opts({ effort: 'light', count: 3 }), 1);
    expect(plan.rows).toEqual([]);
    expect(plan.shortfall).toBe(3);
  });
});

describe('generateQuickSession: carry and timed', () => {
  it('are never chosen, even as the only exercises for a typed muscle', () => {
    const p = [
      cand({ id: 'carry', muscleGroup: 'chest', kind: 'carry' }),
      cand({ id: 'timed', muscleGroup: 'chest', kind: 'timed' }),
      cand({ id: 'reps', muscleGroup: 'chest' }),
      cand({ id: 'bw', muscleGroup: 'chest', kind: 'bodyweight_plus' }),
    ];
    for (const seed of seeds(30)) {
      const plan = generateQuickSession(input(p), opts({ focus: ['chest'], count: 4 }), seed);
      expect(rowIds(plan).sort()).toEqual(['bw', 'reps']);
    }
    const onlyCarry = generateQuickSession(input([p[0]]), opts({ focus: ['chest'], count: 1 }), 1);
    expect(onlyCarry.rows).toEqual([]);
    expect(onlyCarry.unmet).toEqual(['chest']);
  });
});

// ---------------------------------------------------------------------------
// The estimate against the routines the app ships with

describe('the estimate against the five seeded routines', () => {
  /**
   * The seeds' `targetMinutes` are the owner's ceilings: the session clock only turns red past
   * them. So a model that is honest about time must land under them, never over. It lands under by
   * a fair way because it counts only setup, working sets and rests: no warm-up ramps for the
   * barbell lifts, no loading plates, no walking between stations, no phone.
   *
   * Band asserted for every routine: 65% to 100% of its target, at pace 1.
   *  - Never above 100%: the ceiling is the owner's own, and over it would be a number that
   *    flatters the plan.
   *  - Never below 65%: the lowest seeded routine models at 73%, so this leaves a margin for the
   *    constants to move a little, but a model that drops the rests altogether (about 41% on
   *    Lower (Hinge)) or the setup time fails it.
   *
   * Modelled at pace 1, against the target, per routine (every exercise, optional ones included,
   * each at its `targetSets`; rest from `restSecondsFor` with the seeded exercise's own default):
   *   Lower (Hinge)  49 min of 50  (98%; five of six are barbell or long-rest work, and the carry)
   *   Upper (Push)   33 min of 45  (73%; four exercises, three of them 3 sets)
   *   Lower (Squat)  37 min of 50  (74%; the split squat is unilateral and counted twice)
   *   Upper (Pull)   36 min of 45  (80%)
   *   Arms (Day 5)   57 min of 60  (95%; 42 min without its three optional exercises, 70%)
   */
  const expected: Record<string, number> = { 'Lower (Hinge)': 49, 'Upper (Push)': 33, 'Lower (Squat)': 37, 'Upper (Pull)': 36, 'Arms (Day 5)': 57 };

  const rowsFor = (routineId: string, includeOptional: boolean) =>
    SEED_ROUTINE_EXERCISES.filter((rx: RoutineExercise) => rx.routineId === routineId && (includeOptional || !rx.optional)).map((rx) => {
      const ex = SEED_EXERCISES.find((e) => e.id === rx.exerciseId)!;
      const candidate = cand({ id: ex.id, unilateral: ex.unilateral, isCompound: ex.isCompound, kind: ex.kind, defaultRestSec: ex.defaultRestSec });
      return { sets: rx.targetSets, restSec: restSecondsFor(rx, ex, SETTINGS), candidate };
    });

  it.each(SEED_ROUTINES.map((r) => [r.name, r.id, r.targetMinutes!] as const))('%s models within 65-100%% of its target', (name, id, target) => {
    const modelled = estimateMinutes(rowsFor(id, true), 1);
    expect(modelled, name).toBe(expected[name]);
    expect(modelled, name).toBeLessThanOrEqual(target);
    expect(modelled, name).toBeGreaterThanOrEqual(Math.floor(target * 0.65));
  });

  it('Arms without its optional exercises is 42 minutes, still above 65% of its target', () => {
    const arms = SEED_ROUTINES.find((r) => r.name === 'Arms (Day 5)')!;
    const modelled = estimateMinutes(rowsFor(arms.id, false), 1);
    expect(modelled).toBe(42);
    expect(modelled).toBeGreaterThanOrEqual(Math.floor(arms.targetMinutes! * 0.65));
  });

  it('the seeded routines really are the five the anchor assumes', () => {
    expect(SEED_ROUTINES.map((r) => r.name)).toEqual(Object.keys(expected));
  });
});
