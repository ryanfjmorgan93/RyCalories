import { describe, expect, it } from 'vitest';
import type { ClaudeSummaryInput, SummaryFoodDay, SummarySession } from './claudeSummary';
import {
  buildCoachPrompt,
  buildCoachSystemPrompt,
  buildWorkingWeightsBlock,
  coachContextLadder,
  namedExercises,
} from './coach';
import { addDays } from './dates';
import { parseRoutineText } from './routineText';

const AS_OF = '2026-09-25';

/** Two sessions a week for 26 weeks, newest first: bench on Push, squat and RDL on Legs. */
function sessions(): SummarySession[] {
  const out: SummarySession[] = [];
  for (let w = 0; w < 26; w++) {
    const push = addDays(AS_OF, -(w * 7 + 1));
    const legs = addDays(AS_OF, -(w * 7 + 4));
    const bench = 60 + (25 - w) * 1; // older weeks lighter
    out.push(
      {
        date: push,
        title: 'Push A',
        minutes: 55,
        exercises: [
          {
            name: 'Bench Press (Barbell)',
            kind: 'reps',
            sets: [
              { type: 'warmup', weight: 40, reps: 8 },
              { type: 'working', weight: bench, reps: 8 },
              { type: 'working', weight: bench, reps: 7 },
            ],
          },
          { name: 'Lateral Raise', kind: 'reps', sets: [{ type: 'working', weight: 10, reps: 15 }] },
        ],
      },
      {
        date: legs,
        title: 'Legs',
        minutes: 62,
        exercises: [
          { name: 'Barbell Back Squat', kind: 'reps', sets: [{ type: 'working', weight: 100, reps: 5 }] },
          { name: 'Romanian Deadlift (Barbell)', kind: 'reps', sets: [{ type: 'working', weight: 90, reps: 8 }] },
        ],
      },
    );
  }
  return out;
}

function foodDays(): SummaryFoodDay[] {
  return Array.from({ length: 28 }, (_, i) => ({
    date: addDays(AS_OF, -i),
    // Every third day unlogged: an average must not count those as zero.
    macros: i % 3 === 0 ? null : { kcal: 2400, protein: 160, carbs: 250, fat: 80 },
  }));
}

function input(): ClaudeSummaryInput {
  return {
    asOf: AS_OF,
    include: { training: true, food: true, bodyweight: true, routines: true },
    training: { days: 182, sessions: sessions() },
    food: { days: 28, perDay: foodDays(), calorieTarget: 2500, proteinTarget: 170 },
    bodyweight: { days: 56, readings: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, date: addDays(AS_OF, -i * 2), kg: 82 - i * 0.1 })) },
    routines: [{ name: 'Push A', items: [{ name: 'Bench Press (Barbell)', line: '3 × 6–8' }] }],
  };
}

describe('namedExercises', () => {
  const names = ['Bench Press (Barbell)', 'Barbell Back Squat', 'Bulgarian Split Squat', 'Romanian Deadlift (Barbell)', 'Lateral Raise'];

  it('a word of the name in the question names it', () => {
    expect(namedExercises('Why has my bench stalled?', names)).toEqual(['Bench Press (Barbell)']);
  });

  it('gym shorthand is expanded: RDL is the Romanian deadlift', () => {
    expect(namedExercises('How is my RDL going', names)).toEqual(['Romanian Deadlift (Barbell)']);
  });

  it('"squat" names every squat in the log, not a guess at one', () => {
    expect(namedExercises('squat plateau', names)).toEqual(['Barbell Back Squat', 'Bulgarian Split Squat']);
  });

  it('the equipment in brackets does not name an exercise', () => {
    expect(namedExercises('Should I buy a barbell?', ['Bench Press (Barbell)'])).toEqual([]);
  });

  it('a question naming nothing names nothing', () => {
    expect(namedExercises('How was last week?', names)).toEqual([]);
  });
});

describe('coachContextLadder — ask', () => {
  it('each rung is smaller than the one before, and the last holds none of the data', () => {
    for (const q of ['Why has my bench stalled?', 'How was last week?']) {
      const ladder = coachContextLadder(input(), q, 'ask');
      expect(ladder.length).toBeGreaterThan(3);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.text.length).toBeLessThan(ladder[i - 1]!.text.length);
      expect(ladder[ladder.length - 1]).toEqual({ text: '', label: 'none of your data' });
    }
  });

  it('the fullest rung for a general question: 8 weeks of training, 4 of food by day, bodyweight, routines', () => {
    const [full] = coachContextLadder(input(), 'How was last week?', 'ask');
    expect(full!.label).toBe('training 8 weeks · food 4 weeks · bodyweight 8 weeks · routines');
    expect(full!.text).toContain('TRAINING · 1 Aug – 25 Sep · 16 sessions');
    // Nothing older than the 8 weeks.
    expect(full!.text).not.toContain('Jul · Push A');
    expect(full!.text).toContain('ROUTINES');
  });

  it('a named exercise keeps its whole 26 weeks at the top, and outlasts everything else', () => {
    const ladder = coachContextLadder(input(), 'Why has my bench stalled?', 'ask');
    expect(ladder[0]!.label).toBe('Bench Press (Barbell) 26 weeks · other training 8 weeks · food 4 weeks · bodyweight 8 weeks · routines');
    // The oldest bench session (60 kg) is in; other exercises are only in the 8-week block.
    expect(ladder[0]!.text).toContain('TRAINING (Bench Press (Barbell))');
    expect(ladder[0]!.text).toMatch(/Bench Press \(Barbell\): 60 × 8, 7/);
    expect(ladder[0]!.text).toContain('OTHER TRAINING');
    // Every rung but the empty last one still has bench sets in it.
    for (const rung of ladder.slice(0, -1)) expect(rung.text, rung.label).toContain('Bench Press (Barbell): ');
    // …and the narrowest still quotes the latest bench session.
    expect(ladder[ladder.length - 2]!.text).toContain('Bench Press (Barbell): 85 × 8, 7');
  });

  it('food is averaged over logged days only, the count beside it, even with the day lines cut', () => {
    const ladder = coachContextLadder(input(), 'How was last week?', 'ask');
    const averages = ladder.find((r) => r.label.includes('food 4 weeks averages'))!;
    expect(averages.text).toContain('FOOD · 29 Aug – 25 Sep · 18 of 28 days logged');
    expect(averages.text).toContain('Averages over the 18 logged days: 2,400 kcal');
    expect(averages.text).not.toMatch(/: not logged/);
  });
});

describe('coachContextLadder — routine', () => {
  it('leads with working weights and routines, and ends with none of the data', () => {
    const ladder = coachContextLadder(input(), '3 days, upper/lower, 60 min', 'routine');
    expect(ladder[0]!.label).toBe('working weights · training 4 weeks · bodyweight 8 weeks summary · routines');
    for (const rung of ladder.slice(0, -1)) expect(rung.text).toContain('WORKING WEIGHTS');
    expect(ladder[ladder.length - 1]!.text).toBe('');
  });
});

describe('buildWorkingWeightsBlock', () => {
  it('the heaviest counted set of each exercise\'s latest session, warm-ups ignored', () => {
    const block = buildWorkingWeightsBlock(input());
    expect(block).toContain('Bench Press (Barbell): 85 × 8 (Thu 24 Sep)');
    expect(block).toContain('Barbell Back Squat: 100 × 5 (Mon 21 Sep)');
    expect(block).not.toContain('40 × 8');
  });
});

describe('prompts', () => {
  it('the routine prompt asks for exactly the lines Paste a routine reads', () => {
    const system = buildCoachSystemPrompt('routine');
    expect(system).toContain('Exercise name 3x8-10 @ 60kg');
    // A reply that follows it parses as a routine with numbers.
    const { routines } = parseRoutineText('Upper A\nBench press 3x8-10 @ 60kg\nRow 3x10');
    expect(routines[0]).toMatchObject({ name: 'Upper A', exercises: [{ name: 'Bench press', sets: 3, repMin: 8, repMax: 10, weightKg: 60 }, { name: 'Row' }] });
  });

  it('the ask prompt says to answer from the data and nothing more', () => {
    const system = buildCoachSystemPrompt('ask');
    expect(system).toContain('Answer only what is asked');
    expect(system).toContain('Not in your data.');
    expect(system).toContain('No tips, encouragement');
  });

  it('carries the data, the last question and answer only, then the new question', () => {
    const thread = [
      { role: 'user' as const, text: 'first' },
      { role: 'coach' as const, text: 'one' },
      { role: 'user' as const, text: 'second' },
      { role: 'coach' as const, text: 'two' },
    ];
    expect(buildCoachPrompt('DATA', thread, ' third ')).toBe('DATA\n\nUser: second\n\nCoach: two\n\nUser: third');
    expect(buildCoachPrompt('', [], 'q')).toBe('User: q');
  });
});
