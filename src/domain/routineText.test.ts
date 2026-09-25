import { describe, expect, it } from 'vitest';
import { parseRoutineText } from './routineText';

/** Convenience: parse text expected to be exactly one routine, and return its exercise lines. */
function exercisesOf(text: string): ReturnType<typeof parseRoutineText>['routines'][number]['exercises'] {
  const { routines } = parseRoutineText(text);
  expect(routines).toHaveLength(1);
  return routines[0]!.exercises;
}

describe('parseRoutineText — exercise line shapes', () => {
  it('"Bench press 4x6-8"', () => {
    const [l] = exercisesOf('Bench press 4x6-8');
    expect(l).toMatchObject({ name: 'Bench press', sets: 4, repMin: 6, repMax: 8 });
    expect(l!.weightKg).toBeUndefined();
    expect(l!.seconds).toBeUndefined();
  });

  it('"Bench press 4 x 6–8 @ 80kg" (en-dash range, bare @kg)', () => {
    const [l] = exercisesOf('Bench press 4 x 6–8 @ 80kg');
    expect(l).toMatchObject({ name: 'Bench press', sets: 4, repMin: 6, repMax: 8, weightKg: 80 });
  });

  it('"Bench Press: 4 x 6-8 @ 80 kg" (colon after name, spaced kg)', () => {
    const [l] = exercisesOf('Bench Press: 4 x 6-8 @ 80 kg');
    expect(l).toMatchObject({ name: 'Bench Press', sets: 4, repMin: 6, repMax: 8, weightKg: 80 });
  });

  it('"Bench press — 3 sets of 8-10" (em-dash, "sets of" phrasing)', () => {
    const [l] = exercisesOf('Bench press — 3 sets of 8-10');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 8, repMax: 10 });
  });

  it('"Bench press 3 sets x 10 reps"', () => {
    const [l] = exercisesOf('Bench press 3 sets x 10 reps');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 10, repMax: 10 });
  });

  it('"Bench press (3x10)" (parenthesised numbers)', () => {
    const [l] = exercisesOf('Bench press (3x10)');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 10, repMax: 10 });
  });

  it('"3x10 Bench press" (numbers before the name)', () => {
    const [l] = exercisesOf('3x10 Bench press');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 10, repMax: 10 });
  });

  it('"Plank 3x30s" (seconds, no space before the marker)', () => {
    const [l] = exercisesOf('Plank 3x30s');
    expect(l).toMatchObject({ name: 'Plank', sets: 3, repMin: 30, repMax: 30, seconds: true });
  });

  it('"Side plank 3 x 45 sec" (seconds, spelled out with a space)', () => {
    const [l] = exercisesOf('Side plank 3 x 45 sec');
    expect(l).toMatchObject({ name: 'Side plank', sets: 3, repMin: 45, repMax: 45, seconds: true });
  });

  it('"Bench press 3x8-10, 80kg" (trailing comma weight)', () => {
    const [l] = exercisesOf('Bench press 3x8-10, 80kg');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 8, repMax: 10, weightKg: 80 });
  });

  it('"Bench press 3x8-10 at 80 kg" ("at" weight)', () => {
    const [l] = exercisesOf('Bench press 3x8-10 at 80 kg');
    expect(l).toMatchObject({ name: 'Bench press', sets: 3, repMin: 8, repMax: 10, weightKg: 80 });
  });

  it('"Squat 5x5 @ 100" (bare number after @ is kg; single number → repMin=repMax)', () => {
    const [l] = exercisesOf('Squat 5x5 @ 100');
    expect(l).toMatchObject({ name: 'Squat', sets: 5, repMin: 5, repMax: 5, weightKg: 100 });
  });

  it('"Lateral raise 3x12-15 (each side)" — trailing parenthetical never lands in the name', () => {
    const [l] = exercisesOf('Lateral raise 3x12-15 (each side)');
    expect(l).toMatchObject({ name: 'Lateral raise', sets: 3, repMin: 12, repMax: 15 });
  });

  it('strips a trailing "- notes" aside from the name', () => {
    const [l] = exercisesOf('Overhead press 3x8 - warm up first');
    expect(l!.name).toBe('Overhead press');
    expect(l).toMatchObject({ sets: 3, repMin: 8, repMax: 8 });
  });

  it('strips a trailing ", RPE 8" from the name', () => {
    const [l] = exercisesOf('Leg press 4x10, RPE 8');
    expect(l!.name).toBe('Leg press');
    expect(l).toMatchObject({ sets: 4, repMin: 10, repMax: 10 });
  });

  it('strips a trailing "rest 90s" from the name', () => {
    const [l] = exercisesOf('Calf raise 4x15 rest 90s');
    expect(l!.name).toBe('Calf raise');
    expect(l).toMatchObject({ sets: 4, repMin: 15, repMax: 15 });
  });
});

describe('parseRoutineText — decimals', () => {
  it('accepts a decimal weight written with a dot', () => {
    const [l] = exercisesOf('Bench press 3x8 @ 62.5kg');
    expect(l!.weightKg).toBe(62.5);
  });

  it('accepts a decimal weight written with a comma', () => {
    const [l] = exercisesOf('Bench press 3x8 @ 62,5kg');
    expect(l!.weightKg).toBe(62.5);
  });
});

describe('parseRoutineText — headings', () => {
  it('an en-dash "Day N – Name" line is a heading, kept as written (dashes normalised)', () => {
    const { routines } = parseRoutineText('Day 1 – Upper\nBench press 4x6-8');
    expect(routines[0]!.name).toBe('Day 1 - Upper');
  });

  it('a short first line with no numbers is a heading', () => {
    const { routines } = parseRoutineText('Upper A\nBench press 4x6-8');
    expect(routines[0]!.name).toBe('Upper A');
  });

  it('a fully-bold line is a heading even without a trailing colon or Day/Week prefix', () => {
    const { routines } = parseRoutineText('Some intro line.\n\n**Upper A**\nBench press 4x6-8');
    expect(routines[0]!.name).toBe('Upper A');
  });

  it('a line ending in ":" is a heading', () => {
    const { routines } = parseRoutineText('Upper A:\nBench press 4x6-8');
    expect(routines[0]!.name).toBe('Upper A');
  });

  it('a markdown "###" heading is a heading, marker stripped', () => {
    const { routines } = parseRoutineText('### Upper A\nBench press 4x6-8');
    expect(routines[0]!.name).toBe('Upper A');
  });

  it('a line following a blank line is a heading even mid-way through the text', () => {
    const { routines } = parseRoutineText('Upper A\nBench press 4x6-8\n\nLower A\nSquat 4x6-8');
    expect(routines.map((r) => r.name)).toEqual(['Upper A', 'Lower A']);
  });
});

describe('parseRoutineText — prose', () => {
  it('a line over six words with no numbers is ignored, even when it ends with ":"', () => {
    const { routines, ignored } = parseRoutineText(
      "Here's a 3-day upper/lower split you can run for a few weeks:\nBench press 4x6-8",
    );
    expect(ignored).toEqual(["Here's a 3-day upper/lower split you can run for a few weeks:"]);
    expect(routines).toHaveLength(1);
    expect(routines[0]!.name).toBe('Pasted routine');
  });

  it('a line ending in "." is ignored regardless of length', () => {
    const { ignored } = parseRoutineText('Bench press 4x6-8\nLet me know if you want changes.');
    expect(ignored).toEqual(['Let me know if you want changes.']);
  });

  it('a line ending in "!" or "?" is ignored', () => {
    const { ignored } = parseRoutineText('Bench press 4x6-8\nReady to go!\nAny questions?');
    expect(ignored).toEqual(['Ready to go!', 'Any questions?']);
  });
});

describe('parseRoutineText — pattern-less exercise lines', () => {
  it('a short line with no numbers, not first/after-blank/colon/bold/Day-prefixed, is an exercise with no numbers', () => {
    const [a, b, c] = exercisesOf('Upper A\nBench press 4x6-8\nFace pulls\nLateral raise 3x12-15');
    expect(a).toMatchObject({ name: 'Bench press' });
    expect(b).toEqual({ raw: 'Face pulls', name: 'Face pulls' });
    expect(c).toMatchObject({ name: 'Lateral raise' });
  });
});

describe('parseRoutineText — routine structure', () => {
  it('routines with no exercises are dropped', () => {
    const { routines } = parseRoutineText('Upper A\n\nLower A\nSquat 4x6-8');
    expect(routines).toHaveLength(1);
    expect(routines[0]!.name).toBe('Lower A');
  });

  it('names an unheaded routine "Pasted routine"', () => {
    const { routines } = parseRoutineText('Bench press 4x6-8\nSquat 4x6-8');
    expect(routines).toHaveLength(1);
    expect(routines[0]!.name).toBe('Pasted routine');
    expect(routines[0]!.exercises).toHaveLength(2);
  });

  it('keeps duplicate exercise lines (supersets and repeats are real)', () => {
    const [a, b] = exercisesOf('Upper A\nDB curl 3x10\nDB curl 3x10');
    expect(a).toMatchObject({ name: 'DB curl' });
    expect(b).toMatchObject({ name: 'DB curl' });
  });

  it('splits into multiple routines at each heading', () => {
    const { routines } = parseRoutineText('Upper A\nBench press 4x6-8\n\nLower A\nSquat 4x6-8\nRDL 3x8');
    expect(routines).toHaveLength(2);
    expect(routines[0]).toEqual({ name: 'Upper A', exercises: [{ raw: 'Bench press 4x6-8', name: 'Bench press', sets: 4, repMin: 6, repMax: 8 }] });
    expect(routines[1]!.name).toBe('Lower A');
    expect(routines[1]!.exercises).toHaveLength(2);
  });
});

describe('parseRoutineText — a realistic multi-day Claude answer', () => {
  const TEXT = `Here's a 3-day upper/lower split you can run this block, one session per row below:

**Day 1 – Upper**
1. Bench press 4x6-8 @ 80kg
2. Bent-over row 4x6-8
3. Lateral raise 3x12-15 (each side)
4. Face pulls

**Day 2 – Lower**
1. Back squat 4x5 @ 100kg
2. Romanian deadlift 3x8-10, 60kg
3. Leg curl 3x12

Day 3 – Full body:
- Deadlift 1x5 @ 120kg
- Plank 3x30s
- Side plank 3 x 45 sec

Let me know if you want a deload week built in too.`;

  const { routines, ignored } = parseRoutineText(TEXT);

  it('ignores the intro sentence and the closing note as prose', () => {
    expect(ignored).toEqual([
      "Here's a 3-day upper/lower split you can run this block, one session per row below:",
      'Let me know if you want a deload week built in too.',
    ]);
  });

  it('finds three routines, named from the bold/colon headings with markdown and dashes normalised', () => {
    expect(routines.map((r) => r.name)).toEqual(['Day 1 - Upper', 'Day 2 - Lower', 'Day 3 - Full body']);
  });

  it('parses every numbered/bulleted exercise line, including the pattern-less one', () => {
    expect(routines[0]!.exercises.map((e) => e.name)).toEqual(['Bench press', 'Bent-over row', 'Lateral raise', 'Face pulls']);
    expect(routines[0]!.exercises[0]).toMatchObject({ sets: 4, repMin: 6, repMax: 8, weightKg: 80 });
    expect(routines[0]!.exercises[3]).toEqual({ raw: '4. Face pulls', name: 'Face pulls' });

    expect(routines[1]!.exercises.map((e) => e.name)).toEqual(['Back squat', 'Romanian deadlift', 'Leg curl']);
    expect(routines[1]!.exercises[1]).toMatchObject({ sets: 3, repMin: 8, repMax: 10, weightKg: 60 });

    expect(routines[2]!.exercises.map((e) => e.name)).toEqual(['Deadlift', 'Plank', 'Side plank']);
    expect(routines[2]!.exercises[1]).toMatchObject({ sets: 3, repMin: 30, repMax: 30, seconds: true });
    expect(routines[2]!.exercises[2]).toMatchObject({ sets: 3, repMin: 45, repMax: 45, seconds: true });
  });
});

describe('parseRoutineText — what a chatbot actually writes (review findings)', () => {
  it('superset positions "A1.", "A2)", "B1:", "1a." are list markers, not part of the name', () => {
    const ex = exercisesOf('Day 1\nA1. Bench press 3x10\nA2) Row 3x10\nB1: Curl 3x12\n1a. Dips 3x8');
    expect(ex.map((e) => e.name)).toEqual(['Bench press', 'Row', 'Curl', 'Dips']);
  });

  it('minutes are seconds ×60, flagged as seconds, and "min" never lands in the name', () => {
    const [plank, side, hang] = exercisesOf('Core\nPlank 3x1 min\nSide plank 3 x 1-2 mins\nDead hang 2x1.5 minutes');
    expect(plank).toMatchObject({ name: 'Plank', sets: 3, repMin: 60, repMax: 60, seconds: true });
    expect(side).toMatchObject({ name: 'Side plank', sets: 3, repMin: 60, repMax: 120, seconds: true });
    expect(hang).toMatchObject({ name: 'Dead hang', sets: 2, repMin: 90, repMax: 90, seconds: true });
  });

  it('two exercises on one line are two exercises, each with its own numbers', () => {
    const ex = exercisesOf('Day 1\nSuperset: Bench press 3x10, Row 3x12\nClean and press 3x5 and Pull-up 3x8');
    expect(ex).toEqual([
      expect.objectContaining({ name: 'Bench press', sets: 3, repMin: 10 }),
      expect.objectContaining({ name: 'Row', sets: 3, repMin: 12 }),
      // "and" inside a name is not a separator when a clearer one exists between the two groups.
      expect.objectContaining({ name: 'Clean and press', sets: 3, repMin: 5 }),
      expect.objectContaining({ name: 'Pull-up', sets: 3, repMin: 8 }),
    ]);
  });

  it('a weight after a comma stays with the exercise before it when the line splits', () => {
    const [bench, row] = exercisesOf('Bench press 3x8, 80kg, Row 3x10');
    expect(bench).toMatchObject({ name: 'Bench press', weightKg: 80 });
    expect(row).toMatchObject({ name: 'Row' });
    expect(row!.weightKg).toBeUndefined();
  });

  it('a top set and back-off on one line stay one exercise, with no numbers left in its name', () => {
    const [l, ...rest] = exercisesOf('Squat 1x5 @ 100kg, 3x8 @ 80kg');
    expect(rest).toEqual([]);
    expect(l).toMatchObject({ name: 'Squat', sets: 1, repMin: 5, weightKg: 100 });
  });

  it('warm-up, cool-down, tempo, rest and notes lines are not exercises; "Tempo squat" still is', () => {
    const { routines, ignored } = parseRoutineText(
      'Day 1 - Upper\nWarm-up: 5 min bike\nBench press 3x8\nTempo 3-1-1\nRest 90s between sets\nNotes: add 2.5kg when you hit 10\nCool down: 5 min walk\nTempo squat 3x5',
    );
    expect(routines).toHaveLength(1);
    expect(routines[0]!.exercises.map((e) => e.name)).toEqual(['Bench press', 'Tempo squat']);
    expect(ignored).toEqual(['Warm-up: 5 min bike', 'Tempo 3-1-1', 'Rest 90s between sets', 'Notes: add 2.5kg when you hit 10', 'Cool down: 5 min walk']);
  });

  it('a "Warm-up:" block is left out up to the next heading, and the routine carries on after it', () => {
    const { routines, ignored } = parseRoutineText(
      'Day 1 - Upper\nWarm-up:\n- Bike 5 min\n- Band pull-aparts 2x15\nMain:\n- Bench 4x6\nCool-down (5 min):\n- Stretch\n\nDay 2\nSquat 3x5',
    );
    expect(routines.map((r) => r.name)).toEqual(['Day 1 - Upper', 'Day 2']);
    expect(routines[0]!.exercises.map((e) => e.name)).toEqual(['Bench']);
    expect(ignored).toEqual(['Warm-up:', '- Bike 5 min', '- Band pull-aparts 2x15', 'Cool-down (5 min):', '- Stretch']);
  });

  it('a warm-up block also ends at a short "Upper A:" heading with no blank line before it', () => {
    const { routines } = parseRoutineText('Warm-up:\n- Bike 5 min\nUpper A:\nBench 4x6');
    expect(routines).toEqual([{ name: 'Upper A', exercises: [expect.objectContaining({ name: 'Bench' })] }]);
  });

  it('"Superset 1:", "Circuit (3 rounds):" and "Giant set" group exercises inside the day; the day keeps its name', () => {
    const { routines } = parseRoutineText(
      'Day 1 - Upper\nSuperset 1:\nBench press 3x10\nRow 3x10\nSuperset 2 (3 rounds):\nCurl 3x12\nCircuit (3 rounds):\nPush-ups 3x10\nGiant set\nDips 3x8',
    );
    expect(routines).toHaveLength(1);
    expect(routines[0]!.name).toBe('Day 1 - Upper');
    expect(routines[0]!.exercises.map((e) => e.name)).toEqual(['Bench press', 'Row', 'Curl', 'Push-ups', 'Dips']);
  });

  it('a weight range starts at its lower end and none of it lands in the name', () => {
    const [bench, squat, row] = exercisesOf('Day 1\nBench press 3x8 @ 70-80kg\nSquat 3x5 at 100 to 110 kg\nRow 3x10, 60-70kg');
    expect(bench).toMatchObject({ name: 'Bench press', weightKg: 70 });
    expect(squat).toMatchObject({ name: 'Squat', weightKg: 100 });
    expect(row).toMatchObject({ name: 'Row', weightKg: 60 });
  });

  it('"each leg", "per side", "/side", "to failure", "RPE 7-8" and tempo counts are not part of the name', () => {
    const ex = exercisesOf(
      'Day 1\nLunges 3x10 each leg\nBulgarian split squat 3x8 per side @ 20kg\nPush-ups 3x12 to failure\nBench 3x8 RPE 7-8\nSquat 3x5 3-1-1 tempo\nRDL 3x8 tempo 3-0-1-0\nSide plank 3x30s /side',
    );
    expect(ex.map((e) => e.name)).toEqual(['Lunges', 'Bulgarian split squat', 'Push-ups', 'Bench', 'Squat', 'RDL', 'Side plank']);
    expect(ex[1]).toMatchObject({ sets: 3, repMin: 8, weightKg: 20 });
  });

  it('AMRAP, max and failure as the reps keep the sets and leave the reps to the exercise', () => {
    const ex = exercisesOf('Day 1\nPush-ups 3xAMRAP\nDips 3 x max\nPull-ups 3 sets to failure\nChin-ups 3 sets of max reps\nInverted row 3 sets, AMRAP');
    expect(ex.map((e) => e.name)).toEqual(['Push-ups', 'Dips', 'Pull-ups', 'Chin-ups', 'Inverted row']);
    for (const e of ex) {
      expect(e.sets).toBe(3);
      expect(e.repMin).toBeUndefined();
      expect(e.repMax).toBeUndefined();
    }
  });
});

describe('parseRoutineText — garbage in', () => {
  it('never throws, and yields an empty result for empty input', () => {
    expect(() => parseRoutineText('')).not.toThrow();
    expect(parseRoutineText('')).toEqual({ routines: [], ignored: [] });
  });

  it('never throws on unstructured noise, and produces no routines from it', () => {
    // Every non-blank line here is either over six "words" or ends in sentence punctuation, so
    // by the prose rule none of it can accidentally read as a heading or an exercise.
    const noise =
      '   \n\t\n#### ??? *** this is not a real routine at all, just noise.\n' +
      '@@@ ### $$$ %%% ^^^ &&& not real either, definitely more than six tokens here.\n\n' +
      '漢字 émoji 🏋️‍♂️ null undefined NaN — none of this means anything.\n\n\n';
    expect(() => parseRoutineText(noise)).not.toThrow();
    const { routines } = parseRoutineText(noise);
    expect(routines).toEqual([]);
  });

  it('never throws on a huge wall of repeated whitespace and punctuation', () => {
    const noise = Array.from({ length: 500 }, () => '.,;:!?-—–**__##').join('\n');
    expect(() => parseRoutineText(noise)).not.toThrow();
  });
});
