import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { bestsForExercise, e1rmSeries, levelChange, recentRecords, recordsForNewSets } from './recordsQueries';
import { buildSummary, logBodyweight, logSet, resetToSeed, startSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { e1rm } from '@/domain/strength';
import type { RoutineExercise } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const BACK_EXTENSION = SEED_EXERCISE_IDS['Back Extension']; // bodyweight_plus

async function rxFor(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  const rxs = await db.routineExercises.where('routineId').equals(routineId).toArray();
  return rxs.find((r) => r.exerciseId === exerciseId)!;
}

beforeEach(async () => {
  await resetToSeed();
});

describe('recordsForNewSets', () => {
  it('a second heavier set in the same session is a record against the first', async () => {
    // Establish a history baseline: 100 kg completed.
    const s1 = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    for (const r of [8, 8, 8, 8]) await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: r });
    await db.sessions.update(s1.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const s2 = await startSession(HINGE);
    const set1 = await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 105, reps: 8 });
    const set2 = await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8 });

    const records = await recordsForNewSets(RDL, s2.id, [set1, set2]);
    const weightRecords = records.filter((r) => r.kind === 'weight');
    expect(weightRecords).toHaveLength(2);
    expect(weightRecords[0]).toMatchObject({ value: 105, previous: 100, previousSource: 'app', setIndex: 0 });
    expect(weightRecords[1]).toMatchObject({ value: 110, previous: 105, previousSource: 'app', setIndex: 1 });
  });

  it('attributes a Hevy-imported prior best to hevy', async () => {
    const rx = await rxFor(HINGE, RDL);
    // A Hevy-imported completed session, never gone through startSession/finishSession.
    await db.sessions.put({
      id: 'hevy-session-1',
      routineId: '',
      title: 'Imported',
      startedAt: '2026-08-01T18:00:00.000Z',
      endedAt: '2026-08-01T19:00:00.000Z',
      source: 'hevy',
    });
    await db.setLogs.put({
      id: 'hevy-set-1',
      sessionId: 'hevy-session-1',
      routineExerciseId: null,
      exerciseId: RDL,
      index: 0,
      type: 'working',
      weight: 100,
      reps: 8,
      completedAt: '2026-08-01T18:05:00.000Z',
    });

    const session = await startSession(HINGE);
    const set = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 105, reps: 8 });
    const records = await recordsForNewSets(RDL, session.id, [set]);
    const weightRecord = records.find((r) => r.kind === 'weight')!;
    expect(weightRecord).toMatchObject({ value: 105, previous: 100, previousSource: 'hevy' });
  });

  it('e1RM records for bodyweight_plus use the bodyweight on or before the session day', async () => {
    await logBodyweight('2026-09-01', 80);
    const items = await db.routineExercises.where('exerciseId').equals(BACK_EXTENSION).toArray();
    const rx = items[0];
    // A prior completed session, so this isn't a first-ever session for the exercise.
    const s0 = await startSession(rx.routineId);
    await logSet({ sessionId: s0.id, routineExerciseId: rx.id, exerciseId: BACK_EXTENSION, type: 'working', weight: 5, reps: 8 });
    await db.sessions.update(s0.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const session = await startSession(rx.routineId);
    await db.sessions.update(session.id, { startedAt: '2026-09-05T18:00:00.000Z' });
    const set = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: BACK_EXTENSION, type: 'working', weight: 10, reps: 8 });
    const records = await recordsForNewSets(BACK_EXTENSION, session.id, [set]);
    const e1rmRecord = records.find((r) => r.kind === 'e1rm')!;
    expect(e1rmRecord.value).toBe(e1rm(90, 8)); // 80 kg bodyweight + 10 kg added
  });
});

describe('recordsForNewSets: gating', () => {
  it('a first-ever session shows no record at all, even when a later set beats an earlier one', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    const set1 = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 60, reps: 8 });
    const set2 = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 80, reps: 8 });
    const records = await recordsForNewSets(RDL, session.id, [set1, set2]);
    expect(records).toEqual([]);
  });

  it('a real prior completed session unlocks records as before', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await db.sessions.update(s1.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const s2 = await startSession(HINGE);
    const set = await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 105, reps: 8 });
    const records = await recordsForNewSets(RDL, s2.id, [set]);
    expect(records.find((r) => r.kind === 'weight')).toMatchObject({ value: 105, previous: 100 });
  });

  it('prior history from a Hevy import alone is still history', async () => {
    const rx = await rxFor(HINGE, RDL);
    await db.sessions.put({
      id: 'hevy-session-gate',
      routineId: '',
      title: 'Imported',
      startedAt: '2026-08-01T18:00:00.000Z',
      endedAt: '2026-08-01T19:00:00.000Z',
      source: 'hevy',
    });
    await db.setLogs.put({
      id: 'hevy-set-gate',
      sessionId: 'hevy-session-gate',
      routineExerciseId: null,
      exerciseId: RDL,
      index: 0,
      type: 'working',
      weight: 100,
      reps: 8,
      completedAt: '2026-08-01T18:05:00.000Z',
    });

    const session = await startSession(HINGE);
    const set = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 105, reps: 8 });
    const records = await recordsForNewSets(RDL, session.id, [set]);
    expect(records.find((r) => r.kind === 'weight')).toMatchObject({ value: 105, previous: 100, previousSource: 'hevy' });
  });

  it('a calibrating slot never shows a record, even against real prior history', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await db.sessions.update(s1.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const s2 = await startSession(HINGE);
    const set = await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 150, reps: 8 });
    const records = await recordsForNewSets(RDL, s2.id, [set], { calibrating: true });
    expect(records).toEqual([]);
  });

  it('an in-progress session for the same exercise never counts as prior history', async () => {
    // Only one session can be "active" through startSession at a time, so build both sessions
    // directly — this mirrors how a Hevy import or a second device could leave an unfinished
    // session in the table regardless.
    const rx = await rxFor(HINGE, RDL);
    await db.sessions.put({ id: 'in-progress-other', routineId: HINGE, title: 'Other', startedAt: '2026-09-01T18:00:00.000Z' });
    await db.setLogs.put({
      id: 'in-progress-set',
      sessionId: 'in-progress-other',
      routineExerciseId: rx.id,
      exerciseId: RDL,
      index: 0,
      type: 'working',
      weight: 100,
      reps: 8,
      completedAt: '2026-09-01T18:05:00.000Z',
    });

    await db.sessions.put({ id: 'current-session', routineId: HINGE, title: 'Current', startedAt: '2026-09-05T18:00:00.000Z' });
    const set = {
      id: 'current-set',
      sessionId: 'current-session',
      routineExerciseId: rx.id,
      exerciseId: RDL,
      index: 0,
      type: 'working' as const,
      weight: 105,
      reps: 8,
      completedAt: '2026-09-05T18:05:00.000Z',
    };
    await db.setLogs.put(set);
    const records = await recordsForNewSets(RDL, 'current-session', [set]);
    expect(records).toEqual([]);
  });
});

describe('bestsForExercise', () => {
  it('reflects the best across every completed session', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    for (const r of [8, 8, 8, 8]) await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: r });
    await db.sessions.update(s1.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const bests = await bestsForExercise(RDL);
    expect(bests.weight).toBe(100);
  });
});

describe('recentRecords', () => {
  it('returns records newest first', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await db.sessions.update(s1.id, { startedAt: '2026-09-01T18:00:00.000Z', endedAt: '2026-09-01T19:00:00.000Z' });

    const s2 = await startSession(HINGE);
    await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8 });
    await db.sessions.update(s2.id, { startedAt: '2026-09-05T18:00:00.000Z', endedAt: '2026-09-05T19:00:00.000Z' });

    const records = await recentRecords(10);
    expect(records.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(new Date(records[0].date).getTime()).toBeGreaterThanOrEqual(new Date(records[records.length - 1].date).getTime());
    const latest = records.find((r) => r.sessionId === s2.id && r.record.kind === 'weight');
    expect(latest?.record.value).toBe(110);
  });

  it('a set logged while the lift was calibrating is never a record, but a later session still has to beat it', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await db.sessions.update(s1.id, { startedAt: '2026-09-01T18:00:00.000Z', endedAt: '2026-09-01T19:00:00.000Z' });

    // The lift was put back into calibration and kept there at finish: its decision row says so.
    const s2 = await startSession(HINGE);
    await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 150, reps: 8 });
    await db.sessions.update(s2.id, { startedAt: '2026-09-05T18:00:00.000Z', endedAt: '2026-09-05T19:00:00.000Z' });
    await db.decisions.put({ id: 'd-cal', sessionId: s2.id, routineExerciseId: rx.id, fromWeight: 0, toWeight: 0, rule: 'calibrating', accepted: true, decidedAt: '2026-09-05T19:00:00.000Z' });

    // 140 kg beats the old 100 kg best but not the 150 kg calibration lift, so it is no record.
    const s3 = await startSession(HINGE);
    await logSet({ sessionId: s3.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 140, reps: 8 });
    await db.sessions.update(s3.id, { startedAt: '2026-09-09T18:00:00.000Z', endedAt: '2026-09-09T19:00:00.000Z' });

    const records = await recentRecords(50);
    expect(records.filter((r) => r.sessionId === s2.id)).toEqual([]);
    expect(records.filter((r) => r.sessionId === s3.id && r.record.kind === 'weight')).toEqual([]);

    // And the positive control: a set that beats everything, logged outside calibration, is one.
    const s4 = await startSession(HINGE);
    await logSet({ sessionId: s4.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 155, reps: 8 });
    await db.sessions.update(s4.id, { startedAt: '2026-09-12T18:00:00.000Z', endedAt: '2026-09-12T19:00:00.000Z' });
    const after = await recentRecords(50);
    expect(after.find((r) => r.sessionId === s4.id && r.record.kind === 'weight')?.record.value).toBe(155);
  });
});

describe('e1rmSeries', () => {
  it('produces one point per completed session, oldest first', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s1 = await startSession(HINGE);
    await logSet({ sessionId: s1.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 5 });
    await db.sessions.update(s1.id, { startedAt: '2026-09-01T18:00:00.000Z', endedAt: '2026-09-01T19:00:00.000Z' });

    const s2 = await startSession(HINGE);
    await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 105, reps: 5 });
    await db.sessions.update(s2.id, { startedAt: '2026-09-05T18:00:00.000Z', endedAt: '2026-09-05T19:00:00.000Z' });

    const series = await e1rmSeries(RDL);
    expect(series).toHaveLength(2);
    expect(series[0].t).toBeLessThan(series[1].t);
    expect(series[1].y).toBe(e1rm(105, 5));
  });
});

describe('levelChange: an exercise\'s Level around a session', () => {
  /** A session of RDL working sets ([kg, reps]) begun on a September day; ended unless `open`. */
  async function rdlSession(day: number, sets: [number, number][], opts: { open?: boolean; quick?: 'light' | 'normal' } = {}) {
    const s = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    const at = `2026-09-${String(day).padStart(2, '0')}`;
    await db.sessions.update(s.id, { startedAt: `${at}T18:00:00.000Z`, ...(opts.open ? {} : { endedAt: `${at}T19:00:00.000Z` }), ...(opts.quick ? { quick: opts.quick } : {}) });
    const logs = [];
    for (const [weight, reps] of sets) logs.push(await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight, reps }));
    return { id: s.id, logs };
  }
  const start = async () => {
    for (const day of [1, 3, 5]) await rdlSession(day, [[100, 8]]);
  };

  it('reads the open session\'s sets, and judges a new set against the ones before it', async () => {
    await start();
    const live = await rdlSession(7, [[104, 8], [105, 8]], { open: true });
    // 104 is 4% over the start of 100 × 8, 105 is 5%: Level 2.
    const whole = await levelChange(RDL, live.id);
    expect(whole.from).toMatchObject({ level: 1, gainPct: 0, startIn: 0 });
    expect(whole.to).toMatchObject({ level: 2, gainPct: 5, best: { weight: 105, reps: 8 }, start: { weight: 100, reps: 8 } });
    const first = await levelChange(RDL, live.id, [live.logs[0]!.id, live.logs[1]!.id]);
    expect(first.from!.level).toBe(1);
    const second = await levelChange(RDL, live.id, [live.logs[1]!.id]);
    expect(second.from).toMatchObject({ level: 1, gainPct: 4 });
    expect(second.to!.level).toBe(2);
  });

  it('reads a past session as it stood: a later, heavier one is not its history', async () => {
    await start();
    const fourth = await rdlSession(7, [[105, 8]]);
    await rdlSession(9, [[130, 8]]);
    const then = await levelChange(RDL, fourth.id);
    expect(then.from!.level).toBe(1);
    expect(then.to).toMatchObject({ level: 2, gainPct: 5 });
  });

  it('counts nothing from a light quick session, its own or an earlier one', async () => {
    await start();
    const light = await rdlSession(7, [[130, 8]], { quick: 'light' });
    expect(await levelChange(RDL, light.id)).toMatchObject({ from: { level: 1 }, to: { level: 1, gainPct: 0 } });
    const next = await rdlSession(9, [[100, 8]], { open: true });
    expect((await levelChange(RDL, next.id)).to).toMatchObject({ level: 1, gainPct: 0 });
  });

  it('is still setting the start in the third session', async () => {
    await rdlSession(1, [[100, 8]]);
    await rdlSession(3, [[100, 8]]);
    const third = await rdlSession(5, [[120, 8]], { open: true });
    expect((await levelChange(RDL, third.id)).from).toMatchObject({ level: 1, startIn: 1 });
    // The third session is part of the start, so its heavy set is the start, not a gain.
    expect((await levelChange(RDL, third.id)).to).toMatchObject({ level: 1, gainPct: 0, startIn: 0, start: { weight: 120, reps: 8 } });
  });

  it('sizes a bodyweight lift with the weigh-in on or before the session\'s day, for both sides', async () => {
    const rx = (await db.routineExercises.where('exerciseId').equals(BACK_EXTENSION).first())!;
    const ids: string[] = [];
    for (const [day, added] of [[1, 10], [3, 10], [5, 10], [7, 20], [9, 10]] as const) {
      const s = await startSession(rx.routineId);
      await db.sessions.update(s.id, { startedAt: `2026-09-0${day}T18:00:00.000Z`, endedAt: `2026-09-0${day}T19:00:00.000Z` });
      await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId: BACK_EXTENSION, type: 'working', weight: added, reps: 10 });
      ids.push(s.id);
    }
    // No weigh-in: a bodyweight lift has no size, so no level.
    expect(await levelChange(BACK_EXTENSION, ids[3]!)).toEqual({ from: null, to: null });
    await logBodyweight('2026-08-30', 80);
    await logBodyweight('2026-09-08', 90);
    // The fourth session, at 80 kg: 100 against 90 is 11.1% over. The 90 kg of the day after is not its weigh-in.
    const fourth = await levelChange(BACK_EXTENSION, ids[3]!);
    expect(fourth.from).toMatchObject({ level: 1, gainPct: 0 });
    expect(fourth.to).toMatchObject({ level: 3, gainPct: 11 });
    // The fifth, at 90 kg, reads the same sets as 110 against 100: 10% over, with nothing crossed by the change of weight.
    const fifth = await levelChange(BACK_EXTENSION, ids[4]!);
    expect(fifth.from).toMatchObject({ level: 3, gainPct: 10 });
    expect(fifth.to).toMatchObject({ level: 3, gainPct: 10 });
  });

  it('holds at the best ever: a lighter session lowers nothing', async () => {
    await start();
    await rdlSession(7, [[105, 8]]);
    const lighter = await rdlSession(9, [[90, 8]], { open: true });
    expect(await levelChange(RDL, lighter.id)).toMatchObject({ from: { level: 2, gainPct: 5 }, to: { level: 2, gainPct: 5, best: { weight: 105, reps: 8 } } });
  });

  it('is on the summary for an exercise added to the session, too', async () => {
    await start();
    const s = await startSession(SEED_ROUTINE_IDS['Upper (Push)']);
    await db.sessions.update(s.id, { startedAt: '2026-09-07T18:00:00.000Z', endedAt: '2026-09-07T19:00:00.000Z', extraExerciseIds: [RDL] });
    await logSet({ sessionId: s.id, routineExerciseId: null, exerciseId: RDL, type: 'working', weight: 105, reps: 8 });
    const extra = (await buildSummary(s.id)).items.find((i) => i.status === 'extra')!;
    expect(extra.exercise.id).toBe(RDL);
    expect(extra.levelUp).toEqual({ from: 1, to: 2 });
  });

  it('is on the summary of the session that crossed it, and on no other exercise', async () => {
    await start();
    const fourth = await rdlSession(7, [[111, 8]]);
    const summary = await buildSummary(fourth.id);
    const rdl = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(rdl.levelUp).toEqual({ from: 1, to: 3 });
    expect(summary.items.filter((i) => i.exercise.id !== RDL).every((i) => i.levelUp === null)).toBe(true);
    // The session before it crossed nothing.
    const third = (await db.sessions.toArray()).find((x) => x.startedAt.startsWith('2026-09-05'))!;
    expect((await buildSummary(third.id)).items.find((i) => i.exercise.id === RDL)!.levelUp).toBeNull();
  });
});
