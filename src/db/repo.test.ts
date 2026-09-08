import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, exportCsv, importBackup } from './backup';
import { db } from './db';
import {
  addExtraExercise,
  buildSummary,
  deleteSet,
  ensureSeeded,
  exerciseHistory,
  finishSession,
  getActiveSession,
  lockInRoutineExercise,
  logBodyweight,
  logSet,
  previousSets,
  resetToSeed,
  routineItems,
  saveSettings,
  setSkipped,
  stallStatus,
  startSession,
  updateSession,
  wipeAll,
} from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import type { RoutineExercise } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const SQUAT = SEED_ROUTINE_IDS['Lower (Squat)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const BACK_SQUAT = SEED_EXERCISE_IDS['Barbell Back Squat'];

async function rxFor(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  const items = await routineItems(routineId);
  return items.find((i) => i.exercise.id === exerciseId)!.rx;
}

/** Log a full RDL session at `weight` with the given reps and finish it, returning the summary. */
async function rdlSession(reps: number[], weight = 110, opts: { overrideTo?: number; startedAt?: string } = {}) {
  const session = await startSession(HINGE);
  if (opts.startedAt) await updateSession(session.id, { startedAt: opts.startedAt });
  const rx = await rxFor(HINGE, RDL);
  for (const r of reps) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight, reps: r });
  return finishSession(session.id, { choices: [{ routineExerciseId: rx.id, overrideTo: opts.overrideTo }] });
}

describe('seeding', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('loads the library, five routines, 29 routine-exercises, bodyweight and settings', async () => {
    expect(await db.exercises.count()).toBe(27);
    expect(await db.routines.count()).toBe(5);
    expect(await db.routineExercises.count()).toBe(29);
    expect(await db.bodyweight.count()).toBe(1);
    expect((await db.bodyweight.toArray())[0].kg).toBe(74);
    const s = await db.settings.get('settings');
    expect(s).toMatchObject({ units: 'kg', theme: 'dark', calorieStart: 1900, proteinTargetLegDay: 200 });
    expect(s?.calorieStartDate).toBeUndefined();
  });

  it('ensureSeeded is a no-op once seeded', async () => {
    await db.routines.update(HINGE, { name: 'Renamed' });
    await ensureSeeded();
    expect((await db.routines.get(HINGE))?.name).toBe('Renamed');
  });

  it('seeds the §10 routine-exercises with the right modes and cues', async () => {
    const hinge = await routineItems(HINGE);
    expect(hinge.map((i) => i.exercise.name)).toEqual([
      'Romanian Deadlift (Barbell)', 'Hip Thrust (Barbell)', 'Lying Leg Curl (Machine)', 'Back Extension', "Farmer's Carry", 'Seated Calf Raise',
    ]);
    expect(hinge[0].rx).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8, currentWeight: 110, increment: 5, mode: 'normal', cue: 'Straps. 3-sec lower. Depth over load.' });
    expect(hinge[4].rx).toMatchObject({ mode: 'calibrating', distanceMinM: 30, distanceMaxM: 40, targetSets: 3, targetSetsMax: 4 });
    expect(hinge[4].exercise.kind).toBe('carry');
    const day5 = await routineItems(SEED_ROUTINE_IDS['Arms (Day 5)']);
    expect(day5.filter((i) => i.rx.optional).map((i) => i.exercise.name)).toEqual(['Cable Crunch', 'Neck', 'Standing Calf Raise']);
    const squat = await routineItems(SQUAT);
    expect(squat.every((i) => i.rx.mode === 'calibrating')).toBe(true);
    expect(squat[1].exercise.unilateral).toBe(true);
  });

  it('stamps the reverse-diet start date on the first settings save', async () => {
    const s = await saveSettings({ proteinTarget: 175 });
    expect(s.calorieStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const s2 = await saveSettings({ proteinTarget: 180 });
    expect(s2.calorieStartDate).toBe(s.calorieStartDate);
  });
});

describe('sessions and progression (acceptance §11)', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('#2 — RDL 110 × 8,8,8,8 proposes 115, Accept stores it, next session prescribes 115', async () => {
    const session = await startSession(HINGE);
    expect((await getActiveSession())?.id).toBe(session.id);
    const rx = await rxFor(HINGE, RDL);
    for (const r of [8, 8, 8, 8]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });

    const summary = await buildSummary(session.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'increase', fromWeight: 110, toWeight: 115 });
    expect(summary.workingSetsDone).toBe(4);

    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id }] });
    expect(await getActiveSession()).toBeUndefined();
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(115);
    const decision = await db.decisions.where('routineExerciseId').equals(rx.id).first();
    expect(decision).toMatchObject({ fromWeight: 110, toWeight: 115, rule: 'increase', accepted: true });
    expect(decision?.overrideTo).toBeUndefined();
    const done = await db.sessions.get(session.id);
    expect(done?.endedAt).toBeTruthy();
    expect(typeof done?.durationSec).toBe('number');
  });

  it('#3 — RDL 110 × 8,8,7,6 holds at 110', async () => {
    const summary = await rdlSession([8, 8, 7, 6]);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'hold', toWeight: 110 });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(110);
  });

  it('#4 — overriding 115 to 112.5 prescribes 112.5 and the log shows the override', async () => {
    await rdlSession([8, 8, 8, 8], 110, { overrideTo: 112.5 });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(112.5);
    const d = (await db.decisions.toArray()).find((x) => x.rule === 'increase')!;
    expect(d).toMatchObject({ fromWeight: 110, toWeight: 115, accepted: false, overrideTo: 112.5 });
  });

  it('#5 — Back Squat starts calibrating, records anything, then locks in', async () => {
    const session = await startSession(SQUAT);
    const rx = await rxFor(SQUAT, BACK_SQUAT);
    expect(rx.mode).toBe('calibrating');
    for (const [w, r] of [[60, 8], [70, 8], [80, 6], [80, 6]] as const)
      await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: BACK_SQUAT, type: 'working', weight: w, reps: r });
    const summary = await buildSummary(session.id);
    const item = summary.items.find((i) => i.exercise.id === BACK_SQUAT)!;
    expect(item.decision?.rule).toBe('calibrating');
    expect(item.lockIn).toEqual({ suggested: 80 });

    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id, lockInAt: 80 }] });
    const after = await rxFor(SQUAT, BACK_SQUAT);
    expect(after).toMatchObject({ mode: 'normal', currentWeight: 80 });
    const d = await db.decisions.where('routineExerciseId').equals(rx.id).first();
    expect(d).toMatchObject({ rule: 'lock_in', toWeight: 80, accepted: true });

    // Next session at 80 × 8,8,8,8 → 85.
    const s2 = await startSession(SQUAT);
    for (let i = 0; i < 4; i++) await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: BACK_SQUAT, type: 'working', weight: 80, reps: 8 });
    const sum2 = await buildSummary(s2.id);
    expect(sum2.items.find((i) => i.exercise.id === BACK_SQUAT)!.decision).toMatchObject({ rule: 'increase', toWeight: 85 });
  });

  it('calibrating without lock-in stays calibrating and records a calibrating decision', async () => {
    const session = await startSession(SQUAT);
    const rx = await rxFor(SQUAT, BACK_SQUAT);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: BACK_SQUAT, type: 'working', weight: 60, reps: 8 });
    await finishSession(session.id, { choices: [] });
    expect((await rxFor(SQUAT, BACK_SQUAT)).mode).toBe('calibrating');
    expect((await db.decisions.toArray())[0].rule).toBe('calibrating');
  });

  it('lock-in outside a session works from the detail page', async () => {
    const rx = await rxFor(SQUAT, BACK_SQUAT);
    await lockInRoutineExercise(rx.id, 77.5);
    expect(await rxFor(SQUAT, BACK_SQUAT)).toMatchObject({ mode: 'normal', currentWeight: 77.5 });
  });

  it('warm-ups are ignored and missing sets hold', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'warmup', weight: 60, reps: 5 });
    for (const r of [8, 8, 8]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
    const summary = await buildSummary(session.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.decision).toMatchObject({ rule: 'hold_missing_sets', toWeight: 110, workingSets: 3 });
    expect(summary.setsDone).toBe(4);
    expect(summary.workingSetsDone).toBe(3);
  });

  it('carry never gets a decision; not-done and skipped exercises are reported, not decided', async () => {
    const session = await startSession(HINGE);
    const items = await routineItems(HINGE);
    const carry = items.find((i) => i.exercise.kind === 'carry')!;
    await logSet({ sessionId: session.id, routineExerciseId: carry.rx.id, exerciseId: carry.exercise.id, type: 'working', weight: 56, distanceM: 40 });
    await setSkipped(session.id, items[1].rx.id, true);
    const summary = await buildSummary(session.id);
    const byId = (id: string) => summary.items.find((i) => i.rx?.id === id)!;
    expect(byId(carry.rx.id).decision?.rule).toBe('not_applicable');
    expect(byId(items[1].rx.id).status).toBe('skipped');
    expect(byId(items[0].rx.id).status).toBe('not_done');
    await finishSession(session.id, { choices: [] });
    expect(await db.decisions.count()).toBe(0);
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(110);
  });

  it('extra exercises log sets without progression', async () => {
    const session = await startSession(HINGE);
    const facePull = SEED_EXERCISE_IDS['Face Pull'];
    await addExtraExercise(session.id, facePull);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: facePull, type: 'working', weight: 50, reps: 15 });
    const summary = await buildSummary(session.id);
    const extra = summary.items.find((i) => i.status === 'extra')!;
    expect(extra.exercise.id).toBe(facePull);
    expect(extra.sets).toHaveLength(1);
    expect(extra.decision).toBeNull();
  });

  it('deleting a set closes the index gap', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    const a = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8 });
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 7 });
    const c = await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 6 });
    expect(c.index).toBe(2);
    await deleteSet(a.id);
    const rest = (await db.setLogs.where('sessionId').equals(session.id).toArray()).sort((x, y) => x.index - y.index);
    expect(rest.map((s) => [s.index, s.reps])).toEqual([[0, 7], [1, 6]]);
  });

  it('previous session sets come from the last completed session for that routine-exercise', async () => {
    await rdlSession([6, 6, 6, 5], 110, { startedAt: '2026-09-01T18:00:00.000Z' });
    await rdlSession([7, 7, 6, 6], 110, { startedAt: '2026-09-04T18:00:00.000Z' });
    const live = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    const prev = await previousSets(rx.id, RDL, live.id);
    expect(prev?.startedAt).toBe('2026-09-04T18:00:00.000Z');
    expect(prev?.sets.map((s) => s.reps)).toEqual([7, 7, 6, 6]);
  });

  it('flags a stall after three sessions at the same weight, not before', async () => {
    const rx = await rxFor(HINGE, RDL);
    await rdlSession([6, 6, 6, 6], 110, { startedAt: '2026-09-01T18:00:00.000Z' });
    await rdlSession([7, 6, 6, 6], 110, { startedAt: '2026-09-04T18:00:00.000Z' });
    expect(await stallStatus(rx.id)).toBeNull();
    // Third session: the summary should already show the stall before saving.
    const s3 = await startSession(HINGE);
    for (const r of [7, 7, 6, 6]) await logSet({ sessionId: s3.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
    const summary = await buildSummary(s3.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.suggestions).toContainEqual({ kind: 'stalled', sessions: 3, weight: 110 });
    await finishSession(s3.id, { choices: [] });
    expect(await stallStatus(rx.id)).toEqual({ kind: 'stalled', sessions: 3, weight: 110 });
    // A successful increase clears it.
    await rdlSession([8, 8, 8, 8], 110, { startedAt: '2026-09-10T18:00:00.000Z' });
    expect(await stallStatus(rx.id)).toBeNull();
  });

  it('suggests hold/drop after two consecutive sessions with 2+ sets below repMin', async () => {
    const rx = await rxFor(HINGE, RDL);
    await rdlSession([5, 5, 6, 6], 110, { startedAt: '2026-09-01T18:00:00.000Z' });
    const s2 = await startSession(HINGE);
    for (const r of [5, 4, 6, 6]) await logSet({ sessionId: s2.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
    const summary = await buildSummary(s2.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.suggestions).toContainEqual({ kind: 'regression', holdWeight: 110, dropWeight: 105, setsBelowMin: 2 });
  });

  it('suggests a double increment when every set hit repMax at RIR ≥ 3', async () => {
    const session = await startSession(HINGE);
    const rx = await rxFor(HINGE, RDL);
    for (let i = 0; i < 4; i++) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8, rir: 3 });
    const summary = await buildSummary(session.id);
    const item = summary.items.find((i) => i.exercise.id === RDL)!;
    expect(item.suggestions).toContainEqual({ kind: 'double_increment', toWeight: 120, minRir: 3 });
    await finishSession(session.id, { choices: [{ routineExerciseId: rx.id, overrideTo: 120 }] });
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(120);
  });

  it('builds exercise history with top weight per session', async () => {
    await rdlSession([6, 6, 6, 5], 110, { startedAt: '2026-09-01T18:00:00.000Z' });
    await rdlSession([8, 8, 8, 8], 110, { startedAt: '2026-09-04T18:00:00.000Z' });
    const history = await exerciseHistory(RDL);
    expect(history).toHaveLength(2);
    expect(history[0].topWeight).toBe(110);
    expect(history[0].session.startedAt).toBe('2026-09-04T18:00:00.000Z');
    expect(history[0].volume).toBe(110 * 32);
  });

  it('bodyweight upserts by date', async () => {
    await logBodyweight('2026-09-08', 74.2);
    await logBodyweight('2026-09-08', 74.4, 'evening');
    const rows = await db.bodyweight.where('date').equals('2026-09-08').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kg: 74.4, note: 'evening' });
  });
});

describe('backup and export', () => {
  beforeEach(async () => {
    await resetToSeed();
    await rdlSession([8, 8, 8, 8]);
  });

  it('JSON backup round-trips through a wipe', async () => {
    const backup = await exportBackup();
    expect(backup.tables.setLogs).toHaveLength(4);
    expect(backup.tables.decisions).toHaveLength(1);
    await wipeAll();
    expect(await db.setLogs.count()).toBe(0);
    await importBackup(backup, 'replace');
    expect(await db.setLogs.count()).toBe(4);
    expect(await db.routineExercises.count()).toBe(29);
    expect((await rxFor(HINGE, RDL)).currentWeight).toBe(115);
    // Merging the same backup again changes nothing.
    await importBackup(backup, 'merge');
    expect(await db.setLogs.count()).toBe(4);
    expect(await db.sessions.count()).toBe(1);
  });

  it('flat CSV has one row per set', async () => {
    const csv = await exportCsv();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^session_id,session_start,/);
    expect(lines[1]).toContain('Romanian Deadlift (Barbell)');
    expect(lines[1]).toContain(',working,110,8,');
  });
});
