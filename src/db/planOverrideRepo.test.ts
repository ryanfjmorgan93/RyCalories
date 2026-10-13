import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from './backup';
import { db } from './db';
import {
  buildSummary,
  finishSession,
  keepOverrideInRoutine,
  logSet,
  resetToSeed,
  routineItems,
  setPlanOverride,
  setSlotFeel,
  startSession,
  updateRoutineExercise,
} from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import type { RoutineExercise } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const PULL = SEED_ROUTINE_IDS['Upper (Pull)'];
const DAY5 = SEED_ROUTINE_IDS['Arms (Day 5)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const HIP_THRUST = SEED_EXERCISE_IDS['Hip Thrust (Barbell)'];
const CARRY = SEED_EXERCISE_IDS["Farmer's Carry"];
const CURL = SEED_EXERCISE_IDS['DB Curl'];

async function rxFor(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  return (await routineItems(routineId)).find((i) => i.exercise.id === exerciseId)!.rx;
}

async function overridesOf(sessionId: string) {
  return (await db.sessions.get(sessionId))?.planOverrides;
}

async function logWorking(sessionId: string, rx: RoutineExercise, exerciseId: string, weight: number, reps: number[]) {
  for (const r of reps) await logSet({ sessionId, routineExerciseId: rx.id, exerciseId, type: 'working', weight, reps: r });
}

describe('setPlanOverride', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('stores an override on the session row and leaves the routine alone', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL); // 4 × 6–8 @ 110
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { targetSets: 2 } });
    expect(await rxFor(HINGE, RDL)).toEqual(rx);
  });

  it('merges a later patch into the earlier one', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await setPlanOverride(session.id, rx.id, { repMin: 8, repMax: 10 });
    await setPlanOverride(session.id, rx.id, { weight: 100 });
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { targetSets: 2, repMin: 8, repMax: 10, weight: 100 } });
  });

  it('a key given as undefined removes just that field', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2, weight: 100 });
    await setPlanOverride(session.id, rx.id, { weight: undefined });
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { targetSets: 2 } });
  });

  it('null clears the override, and clearing the last one removes the field from the session', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    const hip = await rxFor(HINGE, HIP_THRUST);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await setPlanOverride(session.id, hip.id, { targetSets: 1 });
    await setPlanOverride(session.id, rx.id, null);
    expect(await overridesOf(session.id)).toEqual({ [hip.id]: { targetSets: 1 } });
    await setPlanOverride(session.id, hip.id, null);
    const stored = await db.sessions.get(session.id);
    expect(stored?.planOverrides).toBeUndefined();
    expect('planOverrides' in (stored ?? {})).toBe(false);
  });

  it('an empty patch clears the override', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await setPlanOverride(session.id, rx.id, {});
    expect(await overridesOf(session.id)).toBeUndefined();
  });

  it('fields equal to the saved routine are not stored, so changing a number back clears it', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 4, repMin: 6, repMax: 10, weight: 110 });
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { repMax: 10 } });
    await setPlanOverride(session.id, rx.id, { repMax: 8 });
    expect(await overridesOf(session.id)).toBeUndefined();
  });

  it('ignores a routine-exercise that does not exist, and a finished session', async () => {
    const session = await startSession(HINGE);
    await setPlanOverride(session.id, 'no-such-rx', { targetSets: 2 });
    expect(await overridesOf(session.id)).toBeUndefined();

    const rx = await rxFor(HINGE, RDL);
    await logWorking(session.id, rx, RDL, 110, [8]);
    await finishSession(session.id, { choices: [] });
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    expect(await overridesOf(session.id)).toBeUndefined();
  });

  it('clamps and rounds what is stored', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 0, weight: 99.999 });
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { targetSets: 1, weight: 100 } });
  });

  it('rides along in a backup', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    const backup = await exportBackup();
    await resetToSeed();
    await importBackup(backup, 'replace');
    expect(await overridesOf(session.id)).toEqual({ [rx.id]: { targetSets: 2 } });
  });
});

describe('keepOverrideInRoutine', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('writes sets, rep range and weight to the saved routine-exercise, then clears the override', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 3, repMin: 8, repMax: 10, weight: 100 });
    await keepOverrideInRoutine(session.id, rx.id);
    expect(await rxFor(HINGE, RDL)).toMatchObject({ targetSets: 3, repMin: 8, repMax: 10, currentWeight: 100, increment: 5, mode: 'normal' });
    expect(await overridesOf(session.id)).toBeUndefined();
  });

  it('keeps only what was overridden: a sets-only change leaves the reps and weight', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await keepOverrideInRoutine(session.id, rx.id);
    expect(await rxFor(HINGE, RDL)).toMatchObject({ targetSets: 2, repMin: 6, repMax: 8, currentWeight: 110 });
  });

  it('an explicit set count replaces the routine\'s "up to" count (the Farmer\'s Carry is 3–4)', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, CARRY);
    expect(rx).toMatchObject({ targetSets: 3, targetSetsMax: 4 });
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await keepOverrideInRoutine(session.id, rx.id);
    const after = await rxFor(HINGE, CARRY);
    expect(after.targetSets).toBe(2);
    expect(after.targetSetsMax).toBeUndefined();
  });

  it('only that routine-exercise\'s override is kept; another slot\'s stays for today', async () => {
    const session = await startSession(HINGE);
    const rdl = await rxFor(HINGE, RDL);
    const hip = await rxFor(HINGE, HIP_THRUST);
    await setPlanOverride(session.id, rdl.id, { targetSets: 2 });
    await setPlanOverride(session.id, hip.id, { targetSets: 1 });
    await keepOverrideInRoutine(session.id, rdl.id);
    expect(await overridesOf(session.id)).toEqual({ [hip.id]: { targetSets: 1 } });
    expect((await rxFor(HINGE, HIP_THRUST)).targetSets).toBe(hip.targetSets);
  });

  it('goes through updateRoutineExercise: a linked exercise\'s weight is mirrored to its siblings', async () => {
    const pullRx = await rxFor(PULL, CURL);
    const day5Rx = await rxFor(DAY5, CURL);
    await updateRoutineExercise(pullRx.id, { linkProgression: true });
    await updateRoutineExercise(day5Rx.id, { linkProgression: true });
    const session = await startSession(PULL);
    await setPlanOverride(session.id, pullRx.id, { weight: 14, targetSets: 4 });
    await keepOverrideInRoutine(session.id, pullRx.id);
    expect(await rxFor(PULL, CURL)).toMatchObject({ currentWeight: 14, targetSets: 4 });
    // The weight is shared; the set count is not.
    expect((await rxFor(DAY5, CURL)).currentWeight).toBe(14);
    expect((await rxFor(DAY5, CURL)).targetSets).toBe(day5Rx.targetSets);
  });

  it('does nothing without an override, and nothing to a finished session', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await keepOverrideInRoutine(session.id, rx.id);
    expect(await rxFor(HINGE, RDL)).toEqual(rx);

    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await logWorking(session.id, rx, RDL, 110, [8, 8]);
    await finishSession(session.id, { choices: [] });
    await keepOverrideInRoutine(session.id, rx.id);
    expect((await rxFor(HINGE, RDL)).targetSets).toBe(4);
  });
});

describe('a session run on today\'s plan', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('control: two sets of a four-set lift is a missed session', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await logWorking(session.id, rx, RDL, 110, [8, 8]);
    const item = (await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'hold_missing_sets', workingSets: 2, targetSets: 4 });
  });

  it('cut to two sets today, doing two at the top is judged against two: no hold_missing_sets', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await logWorking(session.id, rx, RDL, 110, [8, 8]);

    const summary = await buildSummary(session.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'increase', toWeight: 115, workingSets: 2, targetSets: 2 });
    // The saved routine still says four sets.
    expect(item.rx?.targetSets).toBe(4);

    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id }] });
    const after = await rxFor(HINGE, RDL);
    expect(after.currentWeight).toBe(115);
    expect(after.targetSets).toBe(4);
    const stored = await db.decisions.where('sessionId').equals(session.id).toArray();
    expect(stored.find((d) => d.routineExerciseId === rx.id)?.rule).toBe('increase');
  });

  it('cut to two sets but only one done is still short of today\'s plan', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await logWorking(session.id, rx, RDL, 110, [8]);
    const item = (await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'hold_missing_sets', workingSets: 1, targetSets: 2 });
  });

  it('a wider rep range today moves the top of the range: 8s are no longer enough to go up', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { repMin: 8, repMax: 10 });
    await logWorking(session.id, rx, RDL, 110, [8, 8, 8, 8]);
    const item = (await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'hold', toWeight: 110 });
  });

  it('the effort chip still decides on top of today\'s plan', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { targetSets: 2 });
    await logWorking(session.id, rx, RDL, 110, [8, 8]);
    await setSlotFeel(session.id, rx.id, RDL, 3);
    expect((await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!.decision).toMatchObject({ rule: 'increase', toWeight: 120 });
    await setSlotFeel(session.id, rx.id, RDL, 1);
    expect((await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!.decision).toMatchObject({ rule: 'hold_hard', toWeight: 110 });
  });

  it('an override weight is only today\'s prescription: progression decides from what was lifted, reported from the routine\'s weight', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await setPlanOverride(session.id, rx.id, { weight: 100 });
    // Lifted the lighter weight for every set, all at the top of the range.
    await logWorking(session.id, rx, RDL, 100, [8, 8, 8, 8]);
    const item = (await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'increase', fromWeight: 110, sessionWeight: 100, toWeight: 105 });
    // The routine itself was never touched by the override.
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(110);
  });

  it('an override on one exercise does not change another\'s verdict', async () => {
    const session = await startSession(HINGE);
    const rdl = await rxFor(HINGE, RDL);
    const hip = await rxFor(HINGE, HIP_THRUST);
    await setPlanOverride(session.id, rdl.id, { targetSets: 2 });
    await logWorking(session.id, hip, HIP_THRUST, hip.currentWeight, [hip.repMax, hip.repMax]);
    const item = (await buildSummary(session.id)).items.find((i) => i.exercise.id === HIP_THRUST)!;
    expect(item.decision).toMatchObject({ rule: 'hold_missing_sets', targetSets: hip.targetSets });
  });
});

describe('what the Summary showed is what Save stores', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  /** Four sets at the top of the range on RDL: the Summary proposes 115. */
  async function shownProposal() {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await logWorking(session.id, rx, RDL, 110, [8, 8, 8, 8]);
    const shown = (await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!.decision!;
    expect(shown).toMatchObject({ rule: 'increase', fromWeight: 110, toWeight: 115 });
    return { session, rx, shown: { rule: shown.rule, fromWeight: shown.fromWeight, toWeight: shown.toWeight } };
  }

  it('control: with nothing carried, Save judges the plan as it is at that moment', async () => {
    const { session, rx } = await shownProposal();
    // The plan is made six sets while the Summary is open: four is now a miss.
    await setPlanOverride(session.id, rx.id, { targetSets: 6 });
    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id }] });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(110);
  });

  it('applies the weight the Accept button showed, and stores that decision, when the plan changed under it', async () => {
    const { session, rx, shown } = await shownProposal();
    await setPlanOverride(session.id, rx.id, { targetSets: 6 });
    expect((await buildSummary(session.id)).items.find((i) => i.exercise.id === RDL)!.decision).toMatchObject({ rule: 'hold_missing_sets', toWeight: 110 });

    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id, shown }] });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(115);
    const stored = (await db.decisions.where('sessionId').equals(session.id).toArray()).find((d) => d.routineExerciseId === rx.id)!;
    expect(stored).toMatchObject({ rule: 'increase', fromWeight: 110, toWeight: 115, accepted: true });
    expect(stored.overrideTo).toBeUndefined();
  });

  it('keeps an override of the shown proposal an override', async () => {
    const { session, rx, shown } = await shownProposal();
    await setPlanOverride(session.id, rx.id, { targetSets: 6 });
    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id, overrideTo: 112.5, shown }] });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(112.5);
    const stored = (await db.decisions.where('sessionId').equals(session.id).toArray()).find((d) => d.routineExerciseId === rx.id)!;
    expect(stored).toMatchObject({ rule: 'increase', toWeight: 115, accepted: false, overrideTo: 112.5 });
  });

  it('changes nothing when the plan did not move', async () => {
    const { session, rx, shown } = await shownProposal();
    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id, shown }] });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(115);
  });

  it('is ignored for a calibrating exercise, which has no weight to carry', async () => {
    const session = await startSession(HINGE);
    const carry = await rxFor(HINGE, CARRY);
    expect(carry.mode).toBe('calibrating');
    await logSet({ sessionId: session.id, routineExerciseId: carry.id, exerciseId: CARRY, type: 'working', weight: 40, reps: 1, distanceM: 30 });
    await finishSession(session.id, { choices: [{ routineExerciseId: carry.id, shown: { rule: 'increase', fromWeight: 0, toWeight: 50 } }] });
    expect(await rxFor(HINGE, CARRY)).toMatchObject({ mode: 'calibrating', currentWeight: carry.currentWeight });
  });
});
