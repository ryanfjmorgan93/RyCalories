import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadRoutineContext, loadRoutineInput } from './routineBuildQueries';
import { startQuickSession } from './quickRepo';
import { resetToSeed, routineItems, stallStatus } from './repo';
import { SEED_EXERCISE_IDS, SEED_EXERCISES, SEED_ROUTINE_IDS } from './seed';
import { buildRoutines } from '@/domain/routineBuilder';
import type { QuickPlan, QuickRow } from '@/domain/quickSession';
import type { Exercise, Niggle, ProgressionRule, Session, Settings } from '@/domain/types';

const TODAY = '2026-09-30';
/** An ISO timestamp at local noon, `days` before TODAY. */
const noon = (days: number): string => new Date(2026, 8, 30 - days, 12, 0, 0).toISOString();

const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const BENCH = SEED_EXERCISE_IDS['Bench Press (Barbell)'];
const LATERAL = SEED_EXERCISE_IDS['Lateral Raise'];

beforeEach(async () => {
  await resetToSeed();
});

/** A finished session `daysAgo` before TODAY, with the niggles given. */
async function session(id: string, daysAgo: number, niggles?: Niggle[], routineId = ''): Promise<Session> {
  const s: Session = { id, routineId, title: id, startedAt: noon(daysAgo), endedAt: noon(daysAgo), durationSec: 1800, ...(niggles ? { niggles } : {}) };
  await db.sessions.put(s);
  return s;
}

/** Decisions for a routine-exercise, oldest first, a week apart and the last a week before TODAY. */
async function decide(routineExerciseId: string, rules: { rule: ProgressionRule; from: number; to: number }[]): Promise<void> {
  await db.decisions.bulkPut(
    rules.map((r, i) => ({
      id: `${routineExerciseId}:${i}`,
      sessionId: `s${i}`,
      routineExerciseId,
      fromWeight: r.from,
      toWeight: r.to,
      rule: r.rule,
      accepted: true,
      decidedAt: noon(7 * (rules.length - i)),
    })),
  );
}

const benchRx = async () => (await db.routineExercises.where('routineId').equals(PUSH).toArray()).find((rx) => rx.exerciseId === BENCH)!;
const context = () => loadRoutineContext(TODAY);

describe('loadRoutineContext: the owner\'s routines', () => {
  it('has each of the five seeded routines with its exercises in their order, as the routine screen lists them', async () => {
    const { routines } = await context();
    expect(routines.map((r) => r.name)).toEqual(['Lower (Hinge)', 'Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)']);
    for (const r of routines) {
      const items = await routineItems(r.id);
      expect(r.exercises.map((e) => e.exerciseId)).toEqual(items.map((i) => i.exercise.id));
      expect(r.exercises.map((e) => [e.targetSets, e.repMin, e.repMax])).toEqual(items.map((i) => [i.rx.targetSets, i.rx.repMin, i.rx.repMax]));
    }
  });

  it('leaves out an archived routine and a quick session\'s hidden one', async () => {
    await db.routines.update(SEED_ROUTINE_IDS['Arms (Day 5)'], { archived: true });
    const row = (e: Exercise): QuickRow => ({
      candidate: { id: e.id, name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, kind: e.kind, isCompound: e.isCompound, isLowerBody: e.isLowerBody, unilateral: e.unilateral, defaultIncrement: e.defaultIncrement, defaultRestSec: e.defaultRestSec, origin: 'own' },
      sets: 2, repMin: 10, repMax: 15, weightKg: 8, mode: 'normal', restSec: 75, daysSince: null,
    });
    const exercise = (await db.exercises.get(LATERAL))!;
    const plan: QuickPlan = { rows: [row(exercise)], estimateMin: 10, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 };
    const quick = await startQuickSession(plan, [], 'normal');
    expect((await db.routines.get(quick.routineId))!.quick).toBe(true);

    const { routines } = await context();
    expect(routines.map((r) => r.name)).toEqual(['Lower (Hinge)', 'Upper (Push)', 'Lower (Squat)', 'Upper (Pull)']);
    expect(routines.some((r) => r.id === quick.routineId)).toBe(false);
    // Lateral Raise is only in the arms routine and the hidden one: neither counts towards the week.
    expect(routines.flatMap((r) => r.exercises).some((e) => e.exerciseId === LATERAL)).toBe(false);
  });
});

describe('loadRoutineContext: niggles from the last fortnight', () => {
  it('reports a niggle with the day of the session it was logged on', async () => {
    await session('s1', 3, [{ tag: 'shoulder', severity: 2, note: 'pinch' }]);
    expect((await context()).niggles).toEqual([{ tag: 'shoulder', severity: 2, date: '2026-09-27' }]);
  });

  it('ignores a niggle from more than 14 days ago, and keeps one from exactly 14', async () => {
    await session('old', 15, [{ tag: 'knee', severity: 3 }]);
    await session('edge', 14, [{ tag: 'lower back', severity: 1 }]);
    await session('long-ago', 90, [{ tag: 'shoulder', severity: 3 }]);
    expect((await context()).niggles).toEqual([{ tag: 'lower back', severity: 1, date: '2026-09-16' }]);
  });

  it('puts the newest first, and reads every niggle of a session', async () => {
    await session('a', 10, [{ tag: 'knee', severity: 1 }]);
    await session('b', 2, [{ tag: 'shoulder', severity: 2 }, { tag: 'lower back', severity: 1 }]);
    expect((await context()).niggles.map((n) => `${n.date} ${n.tag}`)).toEqual(['2026-09-28 lower back', '2026-09-28 shoulder', '2026-09-20 knee']);
  });

  it('ignores a session that logged no niggle', async () => {
    await session('quiet', 2);
    await session('empty', 3, []);
    expect((await context()).niggles).toEqual([]);
  });
});

describe('loadRoutineContext: stalled exercises', () => {
  const HOLD = { rule: 'hold_missing_sets' as const, from: 65, to: 65 };

  it('reports an exercise held at one weight for three sessions in a row, as the routine\'s own stall check does', async () => {
    const rx = await benchRx();
    await decide(rx.id, [HOLD, HOLD, HOLD]);
    expect((await context()).stalled).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
    // The same answer the Exercise screen's stall chip reads.
    expect(await stallStatus(rx.id)).toMatchObject({ kind: 'stalled', sessions: 3, weight: 65 });
  });

  it('counts how long it has lasted, past three', async () => {
    const rx = await benchRx();
    await decide(rx.id, [{ rule: 'increase', from: 62.5, to: 65 }, HOLD, HOLD, HOLD, HOLD]);
    expect((await context()).stalled).toEqual([{ exerciseId: BENCH, sessions: 4 }]);
  });

  it('reports nothing for one that moved, was deloaded, or has fewer than three sessions', async () => {
    const rx = await benchRx();
    await decide(rx.id, [HOLD, HOLD, { rule: 'increase', from: 65, to: 67.5 }]); // the newest moved
    expect((await context()).stalled).toEqual([]);
    expect(await stallStatus(rx.id)).toBeNull();

    await db.decisions.clear();
    await decide(rx.id, [HOLD, { rule: 'deload', from: 65, to: 60 }, HOLD]);
    expect((await context()).stalled).toEqual([]);

    await db.decisions.clear();
    await decide(rx.id, [HOLD, HOLD]);
    expect((await context()).stalled).toEqual([]);
  });

  it('a calibrating or lock-in session says nothing about a stall', async () => {
    const rx = await benchRx();
    await decide(rx.id, [HOLD, { rule: 'calibrating', from: 0, to: 0 }, { rule: 'lock_in', from: 65, to: 65 }, HOLD, HOLD]);
    expect((await context()).stalled).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
  });

  it('ignores a stall on a quick session\'s hidden routine', async () => {
    const exercise = (await db.exercises.get(LATERAL))!;
    const plan: QuickPlan = {
      rows: [
        {
          candidate: { id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup, equipment: exercise.equipment, kind: exercise.kind, isCompound: false, isLowerBody: false, unilateral: false, defaultIncrement: 1, defaultRestSec: 75, origin: 'own' },
          sets: 2, repMin: 10, repMax: 15, weightKg: 8, mode: 'normal', restSec: 75, daysSince: null,
        },
      ],
      estimateMin: 10, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1,
    };
    const quick = await startQuickSession(plan, [], 'normal');
    const [hidden] = await db.routineExercises.where('routineId').equals(quick.routineId).toArray();
    await decide(hidden!.id, [{ rule: 'hold', from: 8, to: 8 }, { rule: 'hold', from: 8, to: 8 }, { rule: 'hold', from: 8, to: 8 }]);
    expect((await context()).stalled).toEqual([]);
  });
});

describe('loadRoutineInput: everything the builder reads', () => {
  const settings = async (): Promise<Settings> => (await db.settings.get('settings'))!;

  it('holds the owner\'s exercises and the library, with the context beside them', async () => {
    await session('hurt', 2, [{ tag: 'shoulder', severity: 2 }]);
    await decide((await benchRx()).id, [
      { rule: 'hold_missing_sets', from: 65, to: 65 },
      { rule: 'hold_missing_sets', from: 65, to: 65 },
      { rule: 'hold_missing_sets', from: 65, to: 65 },
    ]);
    const input = await loadRoutineInput({ today: TODAY, settings: await settings() });
    expect(input.candidates.filter((c) => c.origin === 'own')).toHaveLength(SEED_EXERCISES.length);
    expect(input.candidates.some((c) => c.origin === 'catalogue')).toBe(true);
    expect(input.context!.routines).toHaveLength(5);
    expect(input.context!.niggles.map((n) => n.tag)).toEqual(['shoulder']);
    expect(input.context!.stalled).toEqual([{ exerciseId: BENCH, sessions: 3 }]);
  });

  it('holds the bundled diagrams as well, none of them one of the owner\'s own exercises', async () => {
    const input = await loadRoutineInput({ today: TODAY, settings: await settings() });
    const diagrams = input.candidates.filter((c) => c.origin === 'diagram');
    expect(diagrams.length).toBeGreaterThan(100);
    expect(diagrams.every((c) => c.id === `demo:${c.demoSlug}` && !!c.demoSlug)).toBe(true);
    // Nothing the owner has is offered a second time as its diagram: the seeds carry their diagram's slug.
    const owned = new Set(SEED_EXERCISES.map((e) => e.demo).filter(Boolean));
    expect(diagrams.some((c) => owned.has(c.demoSlug))).toBe(false);
    expect(new Set(input.candidates.map((c) => c.id)).size).toBe(input.candidates.length);
  });

  it('a fresh install, with not one set logged, is built 3D shoulders to six exercises, library ones included, on the equipment its routines use', async () => {
    expect(await db.setLogs.count()).toBe(0);
    const input = await loadRoutineInput({ today: TODAY, settings: await settings() });
    const equipment = new Set(input.candidates.filter((c) => c.origin !== 'own').map((c) => c.equipment));
    expect(equipment).toEqual(new Set(['bodyweight', 'barbell', 'dumbbell', 'machine', 'cable']));
    const taken = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const [r] = buildRoutines(input, { focus: ['shoulders', 'rear delts'] }, seed);
      expect(r!.rows, `seed ${seed}`).toHaveLength(6);
      for (const x of r!.rows.filter((y) => y.origin !== 'own')) taken.add(`${x.origin}:${x.equipment}`);
    }
    expect([...taken].some((t) => !t.endsWith(':bodyweight'))).toBe(true);
  });

  it('is what the builder needs: with a niggle and a stall in the owner\'s data, the routine steers round both', async () => {
    // Logged sets on every seeded exercise, so the equipment the owner has used is the equipment they have.
    await db.sessions.put({ id: 'hist', routineId: '', title: 'Past', startedAt: noon(40), endedAt: noon(40), durationSec: 3600 });
    await db.setLogs.bulkPut(SEED_EXERCISES.map((e, i) => ({ id: `h${i}`, sessionId: 'hist', routineExerciseId: null, exerciseId: e.id, index: 0, type: 'working' as const, weight: 10, reps: 8, completedAt: noon(40) })));
    await session('hurt', 2, [{ tag: 'shoulder', severity: 2 }]);
    await decide((await benchRx()).id, [
      { rule: 'hold_missing_sets', from: 65, to: 65 },
      { rule: 'hold_missing_sets', from: 65, to: 65 },
      { rule: 'hold_missing_sets', from: 65, to: 65 },
    ]);
    const input = await loadRoutineInput({ today: TODAY, settings: await settings() });
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const [chest] = buildRoutines(input, { focus: ['chest'] }, seed);
      expect(chest!.rows.map((r) => r.name), `seed ${seed}`).not.toContain('Bench Press (Barbell)');
      expect(chest!.reasonLines.some((l) => l.startsWith('Bench Press (Barbell) stalled for 3 sessions')), `seed ${seed}`).toBe(true);
      const [shoulders] = buildRoutines(input, { focus: ['shoulders'] }, seed);
      expect(shoulders!.reasonLines.some((l) => l.startsWith('Shoulder niggle on 28 Sep')), `seed ${seed}`).toBe(true);
    }
  });
});
