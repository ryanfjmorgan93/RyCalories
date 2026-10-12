/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addMeal } from '@/db/foodRepo';
import { logBodyweight, logSet, resetToSeed, routineItems, startSession } from '@/db/repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from '@/db/seed';
import { toDateKey } from '@/domain/dates';
import { fromPortion } from '@/domain/food';
import type { BodyScan, RoutineExercise, Session } from '@/domain/types';
import { bodyScansBlock, buildCoachContext, buildStableContext, buildVolatileContext, effectiveRx, estimateTokens, MAX_CONTEXT_TOKENS, noteShortId, notesBlock, otherExercisesBlock } from './context';

const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const NOW = new Date(2026, 9, 12, 14, 35, 0);
const TODAY = toDateKey(NOW);

function dayKey(daysAgo: number): string {
  return toDateKey(new Date(2026, 9, 12 - daysAgo));
}

/** `count` finished sessions on alternate days, each with four exercises of three sets. */
async function seedHistory(count: number, everyDays = 2): Promise<void> {
  const exercises = ['Bench Press (Barbell)', 'DB Shoulder Press', 'Triceps Pushdown', 'Lateral Raise'] as const;
  for (let n = 1; n <= count; n++) {
    const day = new Date(2026, 9, 12 - n * everyDays, 9, 0, 0);
    const id = `hist-${n}`;
    await db.sessions.put({ id, routineId: PUSH, title: 'Upper (Push)', startedAt: day.toISOString(), endedAt: new Date(day.getTime() + 3_600_000).toISOString(), durationSec: 3600 });
    for (const [i, name] of exercises.entries()) {
      for (let s = 0; s < 3; s++) {
        await db.setLogs.put({ id: `${id}-${i}-${s}`, sessionId: id, routineExerciseId: null, exerciseId: SEED_EXERCISE_IDS[name], index: s, type: 'working', weight: 60 + i * 5, reps: 8 + s, completedAt: day.toISOString() });
      }
    }
  }
}

async function seedFood(days: number): Promise<void> {
  for (let d = 1; d <= days; d++) {
    await addMeal({ name: 'Lunch', slot: 'lunch', date: dayKey(d) }, [
      { name: 'Chicken', portion: '150 g', nutrition: fromPortion({ kcal: 250, protein: 46, carbs: 0, fat: 6 }), source: 'user' },
      { name: 'Rice', portion: '200 g', nutrition: fromPortion({ kcal: 260, protein: 5, carbs: 56, fat: 1 }), source: 'user' },
    ]);
  }
}

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
  await db.bodyweight.clear();
  await db.coachNotes.clear();
  await db.coachMessages.clear();
  await db.bodyScans.clear();
});

describe('the pure sections', () => {
  it('lists notes with the short id the forget tool takes', () => {
    expect(notesBlock([])).toContain('None yet.');
    const block = notesBlock([
      { id: 'abcdef12-0000-4000-8000-000000000000', createdAt: '2026-10-02T08:00:00.000Z', text: ' Prefers cables ' },
      { id: '11112222-0000-4000-8000-000000000000', createdAt: '2026-10-01T08:00:00.000Z', text: 'Left knee twinges' },
    ]);
    expect(block.split('\n').slice(1)).toEqual(['[11112222] Left knee twinges (2026-10-01)', '[abcdef12] Prefers cables (2026-10-02)']);
    expect(noteShortId('abcdef12-0000')).toBe('abcdef12');
  });

  it('says there are no scans rather than leaving the coach to guess, and gives deltas when there are two', () => {
    expect(bodyScansBlock([])).toContain('No scans imported.');
    const scan = (date: string, extra: Partial<BodyScan>): BodyScan => ({ id: date, date, source: 'csv', importedAt: `${date}T00:00:00.000Z`, ...extra });
    const block = bodyScansBlock([
      scan('2026-08-10', { weightKg: 80.4, skeletalMuscleKg: 37.5, bodyFatKg: 14 }),
      scan('2026-09-14', { weightKg: 81.2, skeletalMuscleKg: 38.1, bodyFatKg: 14.2, bodyFatPct: 17.5, bmrKcal: 1820 }),
    ]);
    const lines = block.split('\n');
    expect(lines[1]).toBe('2026-09-14: 81.2 kg · skeletal muscle 38.1 kg · body fat 14.2 kg (17.5 %) · BMR 1,820 kcal');
    expect(lines[2]).toBe('2026-08-10: 80.4 kg · skeletal muscle 37.5 kg · body fat 14 kg');
    expect(lines[3]).toBe('Change since 2026-08-10: weight +0.8 kg · skeletal muscle +0.6 kg · body fat +0.2 kg');
  });

  it('lists the exercises that are in no routine, and nothing when every one is used', () => {
    const exercises = [{ id: 'a', name: 'Face Pull' }, { id: 'b', name: 'Bench' }, { id: 'c', name: 'Cable Row' }];
    expect(otherExercisesBlock(exercises, new Set(['b']))).toContain('Cable Row; Face Pull');
    expect(otherExercisesBlock(exercises, new Set(['a', 'b', 'c']))).toBeNull();
    expect(otherExercisesBlock(exercises, new Set(), 2)).toContain('and 1 more');
  });

  it('applies a plan override to a routine-exercise without touching the original', () => {
    const rx = { id: 'x', routineId: 'r', exerciseId: 'e', order: 0, targetSets: 4, targetSetsMax: 5, repMin: 6, repMax: 8, currentWeight: 65, increment: 2.5, mode: 'calibrating', optional: false } as RoutineExercise;
    expect(effectiveRx(rx, undefined)).toEqual({ rx, changed: false });
    const { rx: eff, changed } = effectiveRx(rx, { targetSets: 3, weight: 60 });
    expect(changed).toBe(true);
    expect(eff).toMatchObject({ targetSets: 3, targetSetsMax: undefined, repMin: 6, currentWeight: 60, mode: 'normal' });
    expect(rx).toMatchObject({ targetSets: 4, currentWeight: 65, mode: 'calibrating' });
  });
});

describe('buildCoachContext', () => {
  it('holds the owner\'s picture: goals, notes, routines, scans, history, today and the date', async () => {
    await seedHistory(6);
    await seedFood(10);
    await logBodyweight(dayKey(1), 80.2);
    await db.coachNotes.put({ id: 'abcdef12-0000-4000-8000-000000000000', createdAt: '2026-10-01T08:00:00.000Z', text: 'Left knee twinges on deep squats' });
    await db.bodyScans.put({ id: 'b1', date: '2026-09-14', source: 'csv', weightKg: 81.2, skeletalMuscleKg: 38.1, importedAt: '2026-09-14T00:00:00.000Z' });
    await addMeal({ name: 'Breakfast', slot: 'breakfast', date: TODAY }, [{ name: 'Eggs on toast', portion: '2 eggs', nutrition: fromPortion({ kcal: 320, protein: 20, carbs: 22, fat: 16 }), source: 'model' }]);

    const ctx = await buildCoachContext({ now: NOW });
    const t = ctx.text;
    expect(t).toContain('GOALS: bodyweight 80–82 kg');
    expect(t).toContain('[abcdef12] Left knee twinges on deep squats');
    expect(t).toContain('ROUTINES\nLower (Hinge): Romanian Deadlift (Barbell) 4 × 6–8 @ 110 kg');
    expect(t).toContain('Upper (Push): Bench Press (Barbell) 4 × 6–8 @ 65 kg');
    expect(t).toContain('BODY SCANS (InBody)\n2026-09-14: 81.2 kg · skeletal muscle 38.1 kg');
    expect(t).toMatch(/TRAINING · .* · 6 sessions/);
    expect(t).toContain('Bench Press (Barbell): 60 × 8, 9, 10');
    expect(t).toMatch(/FOOD · .* · 10 of 20 days logged/);
    expect(t).toMatch(/BODYWEIGHT · .* 1 weigh-in/);
    expect(t).toContain('NOW: Monday, 12 October 2026 at 14:35');
    expect(t).toContain("TODAY'S FOOD · eaten 320 kcal · P 20 · C 22 · F 16");
    expect(t).toContain('Breakfast: Eggs on toast 2 eggs (≈320 kcal, P ≈20)');
    expect(t).toContain('No session is live right now.');
    expect(t).toContain('Last finished session: Upper (Push), 2 days ago.');
    // The summary's own closing line is an instruction for pasting into another app, not for the coach.
    expect(t).not.toContain('If you write me a routine');
    // Nothing the stable part holds is dated today.
    expect(ctx.stable).not.toContain('Eggs on toast');
    expect(ctx.stable.indexOf('COACH NOTES')).toBeLessThan(ctx.stable.indexOf('ROUTINES'));
    expect(ctx.text).toBe(`${ctx.stable}\n\n${ctx.volatile}`);
  });

  it('keeps the stable part byte for byte the same while only today\'s things change, so the cache holds', async () => {
    await seedHistory(4);
    await seedFood(5);
    const before = await buildCoachContext({ now: NOW });

    await addMeal({ name: 'Lunch', slot: 'lunch', date: TODAY }, [{ name: 'Soup', portion: '1 bowl', nutrition: fromPortion({ kcal: 200, protein: 8, carbs: 25, fat: 7 }) }]);
    await logBodyweight(TODAY, 81);
    const session = await startSession(PUSH);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], type: 'working', weight: 65, reps: 8 });
    await db.coachMessages.put({ id: 'c1', at: new Date(2026, 9, 12, 9, 0).toISOString(), role: 'coach', text: 'Morning.', moment: 'open' });
    const after = await buildCoachContext({ now: new Date(2026, 9, 12, 15, 10, 0) });

    expect(after.stable).toBe(before.stable);
    expect(after.volatile).not.toBe(before.volatile);
    expect(after.volatile).toContain('Soup 1 bowl');
    expect(after.volatile).toContain('Weighed in today: 81 kg.');
    expect(after.volatile).toContain('Morning.');
  });

  it('changes the stable part only when the notes, routines or history change', async () => {
    await seedHistory(2);
    const a = await buildStableContext({ now: NOW });
    await db.coachNotes.put({ id: 'n1', createdAt: '2026-10-12T08:00:00.000Z', text: 'Shoulder is sore' });
    const b = await buildStableContext({ now: NOW });
    expect(b).not.toBe(a);
    expect(b).toContain('Shoulder is sore');
  });

  it('shows the live session with what is done, what is left, and what changed for today', async () => {
    const session = await startSession(PUSH);
    const items = await routineItems(PUSH);
    const bench = items.find((i) => i.exercise.name === 'Bench Press (Barbell)')!;
    const incline = items.find((i) => i.exercise.name === 'Incline DB Press')!;
    for (const reps of [8, 7]) {
      await logSet({ sessionId: session.id, routineExerciseId: bench.rx.id, exerciseId: bench.exercise.id, type: 'working', weight: 65, reps });
    }
    // `planOverrides` is on Session once the training-engine work lands; written as the plain row field it is.
    const changes = {
      planOverrides: { [bench.rx.id]: { targetSets: 3 } },
      skippedRoutineExerciseIds: [incline.rx.id],
      swaps: { [incline.rx.id]: SEED_EXERCISE_IDS['Hammer Curl'] },
      extraExerciseIds: [SEED_EXERCISE_IDS['Face Pull']],
    };
    await db.sessions.update(session.id, changes as Partial<Session>);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: SEED_EXERCISE_IDS['Face Pull'], type: 'working', weight: 20, reps: 15 });

    const volatile = await buildVolatileContext({ now: new Date(Date.parse(session.startedAt) + 25 * 60_000) });
    const live = volatile.split('\n\n').find((p) => p.startsWith('LIVE SESSION'))!;
    expect(live).toContain('LIVE SESSION · Upper (Push)');
    expect(live).toContain('25 min ago');
    expect(live).toContain('Bench Press (Barbell): 3 × 6–8 @ 65 kg [changed for today] · done: 65 × 8, 7 · 1 set to go');
    expect(live).toContain('Incline DB Press: swapped for Hammer Curl');
    expect(live).toContain('DB Shoulder Press: 3 × 6–8 · calibrating · done: none yet · 3 sets to go');
    expect(live).toContain('Face Pull (added today): 20 × 15');
  });

  it('does not repeat what the coach has said earlier today, and does not show yesterday\'s lines', async () => {
    await db.coachMessages.bulkPut([
      { id: 'a', at: new Date(2026, 9, 11, 20, 0).toISOString(), role: 'coach', text: 'Yesterday\'s line' },
      { id: 'b', at: new Date(2026, 9, 12, 8, 5).toISOString(), role: 'coach', text: 'Morning! "Discipline is choosing between what you want now and what you want most."', moment: 'open' },
      { id: 'c', at: new Date(2026, 9, 12, 8, 6).toISOString(), role: 'user', text: 'Thanks' },
    ]);
    const volatile = await buildVolatileContext({ now: NOW });
    expect(volatile).toContain('WHAT YOU HAVE ALREADY SAID TODAY');
    expect(volatile).toContain('08:05 Morning!');
    expect(volatile).not.toContain("Yesterday's line");
    expect(volatile).not.toContain('Thanks');
  });

  it('stays inside about 6K tokens however much history there is, and steps the history down, not the notes', async () => {
    await seedHistory(21, 2);
    await seedFood(21);
    for (let d = 1; d <= 40; d++) await logBodyweight(dayKey(d), 80 + d / 100);
    await db.coachNotes.put({ id: 'n1', createdAt: '2026-10-01T08:00:00.000Z', text: 'Left knee twinges on deep squats' });

    const roomy = await buildCoachContext({ now: NOW });
    expect(roomy.tokens).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    expect(roomy.tokens).toBe(estimateTokens(roomy.text));

    const tight = await buildCoachContext({ now: NOW, maxTokens: 1500 });
    expect(tight.tokens).toBeLessThan(roomy.tokens);
    expect(tight.tokens).toBeLessThanOrEqual(1500);
    // The history gave way; the notes, routines and today did not.
    expect(tight.text).toContain('Left knee twinges on deep squats');
    expect(tight.text).toContain('ROUTINES');
    expect(tight.text).toContain("TODAY'S FOOD");
    expect(tight.text).toMatch(/Averages over the/);
    expect(tight.text.match(/Upper \(Push\) ·/g)?.length ?? 0).toBeLessThan(roomy.text.match(/Upper \(Push\) ·/g)?.length ?? 0);
  });
});
