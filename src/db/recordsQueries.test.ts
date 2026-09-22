import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { bestsForExercise, e1rmSeries, recentRecords, recordsForNewSets } from './recordsQueries';
import { logBodyweight, logSet, resetToSeed, startSession } from './repo';
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
