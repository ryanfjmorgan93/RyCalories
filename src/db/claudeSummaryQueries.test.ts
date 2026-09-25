import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addMeal } from './foodRepo';
import { getSettings, logBodyweight, resetToSeed, saveSettings } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { loadClaudeSummaryInput } from './claudeSummaryQueries';
import { buildClaudeSummary, type ClaudeSummaryInclude } from '@/domain/claudeSummary';
import { fromPortion, type Macros } from '@/domain/food';
import type { Session, SetLog } from '@/domain/types';

const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const HIP_THRUST = SEED_EXERCISE_IDS['Hip Thrust (Barbell)'];
const BACK_SQUAT = SEED_EXERCISE_IDS['Barbell Back Squat'];
const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const SQUAT_ROUTINE = SEED_ROUTINE_IDS['Lower (Squat)'];

const ASOF = '2026-09-25'; // a Friday
const WINDOWS = { trainingDays: 10, foodDays: 5, bodyweightDays: 10 };
const INCLUDE_ALL: ClaudeSummaryInclude = { training: true, food: true, bodyweight: true, routines: true };

/** Local timestamp for `date` at hh:mm, mirroring the pattern in trendQueries.test.ts. */
function ts(date: string, hh: number, mm = 0): string {
  const d = new Date(`${date}T00:00:00`);
  d.setHours(hh, mm);
  return d.toISOString();
}

async function meal(date: string, macros: Macros) {
  await addMeal({ name: 'Meal', date }, [{ name: 'Food', portion: '1', nutrition: fromPortion(macros) }]);
}

beforeEach(async () => {
  await resetToSeed();
  // resetToSeed drops in a bodyweight reading dated "today" (the real clock), which would
  // otherwise land inside or outside this test's fixed window unpredictably.
  await db.bodyweight.clear();
});

describe('loadClaudeSummaryInput + buildClaudeSummary, end to end', () => {
  it('loads sessions (with a warm-up), meals on some days, and bodyweights, and builds the export text', async () => {
    // A finished session with a warm-up (must be excluded from the text) and two exercises.
    const s1: Session = {
      id: 's1',
      routineId: HINGE,
      title: 'Lower (Hinge)',
      startedAt: ts('2026-09-23', 18, 0),
      endedAt: ts('2026-09-23', 18, 58),
      durationSec: 58 * 60,
    };
    const s1Sets: SetLog[] = [
      { id: 's1-1', sessionId: 's1', routineExerciseId: null, exerciseId: RDL, index: 0, type: 'warmup', weight: 60, reps: 5, completedAt: ts('2026-09-23', 18, 1) },
      { id: 's1-2', sessionId: 's1', routineExerciseId: null, exerciseId: RDL, index: 1, type: 'working', weight: 110, reps: 8, completedAt: ts('2026-09-23', 18, 2) },
      { id: 's1-3', sessionId: 's1', routineExerciseId: null, exerciseId: RDL, index: 2, type: 'working', weight: 110, reps: 8, completedAt: ts('2026-09-23', 18, 3) },
      { id: 's1-4', sessionId: 's1', routineExerciseId: null, exerciseId: RDL, index: 3, type: 'working', weight: 110, reps: 7, completedAt: ts('2026-09-23', 18, 4) },
      { id: 's1-5', sessionId: 's1', routineExerciseId: null, exerciseId: HIP_THRUST, index: 0, type: 'working', weight: 80, reps: 10, completedAt: ts('2026-09-23', 18, 10) },
      { id: 's1-6', sessionId: 's1', routineExerciseId: null, exerciseId: HIP_THRUST, index: 1, type: 'working', weight: 80, reps: 10, completedAt: ts('2026-09-23', 18, 11) },
    ];

    // A deload session with no duration recorded (startedAt === endedAt) and only a warm-up set —
    // its one exercise has no counted sets, so the built text still shows the session header alone.
    const s2: Session = {
      id: 's2',
      routineId: SQUAT_ROUTINE,
      title: 'Lower (Squat)',
      startedAt: ts('2026-09-20', 17, 0),
      endedAt: ts('2026-09-20', 17, 0),
      deload: true,
    };
    const s2Sets: SetLog[] = [
      { id: 's2-1', sessionId: 's2', routineExerciseId: null, exerciseId: BACK_SQUAT, index: 0, type: 'warmup', weight: 40, reps: 5, completedAt: ts('2026-09-20', 17, 1) },
    ];

    await db.sessions.bulkPut([s1, s2]);
    await db.setLogs.bulkPut([...s1Sets, ...s2Sets]);

    // Food: logged on three of the five days in the window, nothing on the other two.
    await meal('2026-09-22', { kcal: 2400, protein: 160, carbs: 250, fat: 75 });
    await meal('2026-09-23', { kcal: 2500, protein: 180, carbs: 240, fat: 80 });
    await meal('2026-09-25', { kcal: 2330, protein: 166, carbs: 263, fat: 82 });

    // Bodyweight: four readings inside the 10-day window, one well outside it.
    await logBodyweight('2026-09-20', 83.9);
    await logBodyweight('2026-09-22', 83.7);
    await logBodyweight('2026-09-24', 83.5);
    await logBodyweight('2026-09-25', 83.4);
    await logBodyweight('2026-09-10', 85.0);

    await saveSettings({
      calorieStart: 2500,
      calorieStep: 0,
      calorieStepDays: 14,
      calorieCeiling: 2500,
      calorieStartDate: '2026-01-01',
      proteinTarget: 170,
      proteinTargetLegDay: 190,
    });
    const settings = await getSettings();

    const input = await loadClaudeSummaryInput(ASOF, INCLUDE_ALL, settings, WINDOWS);

    // --- the loaded input ---
    expect(input.training.sessions.map((s) => s.date)).toEqual(['2026-09-23', '2026-09-20']); // newest first
    const hinge = input.training.sessions[0];
    expect(hinge.minutes).toBe(58);
    expect(hinge.deload).toBeFalsy();
    expect(hinge.exercises.map((e) => e.name)).toEqual(['Romanian Deadlift (Barbell)', 'Hip Thrust (Barbell)']);
    // The raw load still carries the warm-up — filtering it out is buildClaudeSummary's job.
    expect(hinge.exercises[0].sets).toHaveLength(4);
    expect(hinge.exercises[0].sets.some((s) => s.type === 'warmup')).toBe(true);
    const squatSession = input.training.sessions[1];
    expect(squatSession.minutes).toBeNull(); // no durationSec and endedAt === startedAt: genuinely unknown
    expect(squatSession.deload).toBe(true);
    expect(squatSession.exercises).toHaveLength(1);
    expect(squatSession.exercises[0].sets).toEqual([expect.objectContaining({ type: 'warmup' })]);

    expect(input.food.perDay.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
    expect(input.food.perDay.find((d) => d.date === '2026-09-21')?.macros).toBeNull();
    expect(input.food.perDay.find((d) => d.date === '2026-09-22')?.macros).toEqual({ kcal: 2400, protein: 160, carbs: 250, fat: 75 });
    expect(input.food.calorieTarget).toBe(2500);
    expect(input.food.proteinTarget).toBe(170);
    expect(input.food.proteinTargetLegDay).toBe(190);

    // Bodyweight is passed through unfiltered here; the domain does the window filtering.
    expect(input.bodyweight.readings.map((b) => b.date).sort()).toContain('2026-09-10');

    const hingeRoutine = input.routines.find((r) => r.name === 'Lower (Hinge)');
    expect(hingeRoutine?.items[0]).toEqual({ name: 'Romanian Deadlift (Barbell)', line: '4 × 6–8 @ 110 kg' });

    // --- the built text ---
    const { text, counts } = buildClaudeSummary(input);
    expect(counts).toEqual({ sessions: 2, foodDays: 5, foodDaysLogged: 3, weighIns: 4, routines: 5 });

    expect(text).toContain('TRAINING · 16 Sep – 25 Sep · 2 sessions');
    expect(text).toContain('Wed 23 Sep · Lower (Hinge) · 58 min');
    expect(text).toContain('  Romanian Deadlift (Barbell): 110 × 8, 8, 7');
    expect(text).toContain('  Hip Thrust (Barbell): 80 × 10, 10');
    expect(text).not.toContain('60 × 5'); // the warm-up
    expect(text).toContain('Sun 20 Sep · Lower (Squat) · deload'); // no minutes clause
    expect(text).not.toContain('  Barbell Back Squat:'); // all-warm-up exercise omitted entirely from TRAINING

    expect(text).toContain('FOOD · 21 Sep – 25 Sep · 3 of 5 days logged');
    expect(text).toContain('Averages over the 3 logged days: 2,410 kcal · protein 169 g · carbs 251 g · fat 79 g');
    expect(text).toContain('Targets: 2,500 kcal · protein 170 g (leg days 190 g)');
    expect(text).toContain('Fri 25 Sep: 2,330 kcal · P 166 · C 263 · F 82');
    expect(text).toContain('Thu 24 Sep: not logged');
    expect(text).toContain('Mon 21 Sep: not logged');

    expect(text).toContain('BODYWEIGHT · 16 Sep – 25 Sep · 4 weigh-ins');
    expect(text).toContain('Latest 83.4 kg (25 Sep) · 7-day average 83.6 kg · first in window 83.9 kg (20 Sep)');
    expect(text).not.toContain('10 Sep'); // the out-of-window reading's date

    expect(text).toContain('Lower (Hinge): Romanian Deadlift (Barbell) 4 × 6–8 @ 110 kg;');
  });

  it('always loads counts for every section, even when excluded from the text', async () => {
    await meal('2026-09-25', { kcal: 2000, protein: 150, carbs: 200, fat: 60 });
    const settings = await getSettings();
    const excludeFood: ClaudeSummaryInclude = { training: true, food: false, bodyweight: true, routines: true };
    const input = await loadClaudeSummaryInput(ASOF, excludeFood, settings, WINDOWS);
    const { text, counts } = buildClaudeSummary(input);
    expect(counts.foodDaysLogged).toBe(1);
    expect(text).not.toContain('FOOD');
  });
});
