import { describe, expect, it } from 'vitest';
import { parseRoutineText } from './routineText';

const first = (line: string) => parseRoutineText(`Day\n${line}`).routines[0]!.exercises[0]!;

describe('parseRoutineText: a qualifier that is part of the exercise name survives', () => {
  it.each([
    ['Bench Press (Barbell) 4x6-8 @ 65kg', 'Bench Press (Barbell)', 4, 6, 8, 65],
    ['Lying Leg Curl (Machine) 3x10-15', 'Lying Leg Curl (Machine)', 3, 10, 15, undefined],
    ['Romanian Deadlift (Barbell) 4x6-8 @ 110kg', 'Romanian Deadlift (Barbell)', 4, 6, 8, 110],
    ['Back Extension (Weighted Hyperextension) 3x10', 'Back Extension (Weighted Hyperextension)', 3, 10, 10, undefined],
    ['Triceps Pushdown - V-Bar Attachment 3x10-15 @ 30kg', 'Triceps Pushdown - V-Bar Attachment', 3, 10, 15, 30],
    ['Bench Press - Powerlifting 3x6-10', 'Bench Press - Powerlifting', 3, 6, 10, undefined],
    ['Push Press - Behind the Neck 3x8-12', 'Push Press - Behind the Neck', 3, 8, 12, undefined],
    ['Kettlebell Turkish Get-Up (Squat style) 3x8-12', 'Kettlebell Turkish Get-Up (Squat style)', 3, 8, 12, undefined],
    ['Calf Raise (Single Leg) 4x10-15', 'Calf Raise (Single Leg)', 4, 10, 15, undefined],
  ])('"%s" is %s', (line, name, sets, repMin, repMax, weightKg) => {
    const e = first(line);
    expect(e.name).toBe(name);
    expect(e.sets).toBe(sets);
    expect(e.repMin).toBe(repMin);
    expect(e.repMax).toBe(repMax);
    expect(e.weightKg).toBe(weightKg);
  });

  it('survives a note after the numbers: the note goes and the qualifier stays', () => {
    expect(first('Bench Press (Barbell) 3x8-10 (each side)').name).toBe('Bench Press (Barbell)');
    expect(first('Bench Press (Barbell) 3x8-10, rest 90s').name).toBe('Bench Press (Barbell)');
    expect(first('Triceps Pushdown - V-Bar Attachment 3x12 - go heavy').name).toBe('Triceps Pushdown - V-Bar Attachment');
  });

  it('still drops a parenthetical that is about the set, whichever side of the numbers it is on', () => {
    expect(first('Lateral raise 3x12-15 (each side)').name).toBe('Lateral raise');
    expect(first('Lateral raise (each side) 3x12-15').name).toBe('Lateral raise');
    expect(first('Plank (optional) 3x30s').name).toBe('Plank');
    expect(first('Squat (3 sec pause) 3x8').name).toBe('Squat');
  });

  it('still drops a lower-case remark after a dash, before or after the numbers', () => {
    expect(first('Squat - heavy 5x5').name).toBe('Squat');
    expect(first('Squat 5x5 - go heavy').name).toBe('Squat');
  });

  it('keeps the qualifier on an open-ended set count too', () => {
    const e = first('Pull-up (Assisted) 3xAMRAP');
    expect(e.name).toBe('Pull-up (Assisted)');
    expect(e.sets).toBe(3);
  });
});
