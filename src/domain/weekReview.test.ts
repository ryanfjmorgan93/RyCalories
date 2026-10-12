import { describe, expect, it } from 'vitest';
import { summarise, type DayRecord } from './trends';
import { buildReviewFacts, inReviewWindow, isMonday, recordLines, reviewWindow, scanFacts, weightFacts, type WeekReviewInput } from './weekReview';

// Monday 12 October 2026: the week reviewed is Monday 5 to Sunday 11.
const TODAY = '2026-10-12';

function week(over: Partial<DayRecord>[]): DayRecord[] {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  return days.map((date, i) => ({ date, trained: false, ...(over[i] ?? {}) }));
}

const logged = (kcal: number, protein: number): Partial<DayRecord> => ({ kcal, protein, kcalTarget: 2300, proteinTarget: 170 });

const input = (over: Partial<WeekReviewInput> = {}): WeekReviewInput => ({
  today: TODAY,
  sessions: [
    { date: '2026-10-05', title: 'Upper (Push)' },
    { date: '2026-10-08', title: 'Lower (Squat)' },
  ],
  setsByRegion: { Legs: 12, Chest: 9, Back: 0 },
  records: [],
  trend: summarise(week([logged(2200, 160), logged(2400, 180), logged(2000, 150), {}, logged(2300, 175), {}, {}])),
  targets: { calories: 2300, protein: 170, proteinLegDay: 200 },
  bodyweight: [],
  scans: [],
  ...over,
});

describe('reviewWindow', () => {
  it('is the seven days before today', () => {
    expect(reviewWindow(TODAY)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('knows a Monday', () => {
    expect(isMonday('2026-10-12')).toBe(true);
    expect(isMonday('2026-10-13')).toBe(false);
    expect(isMonday('2026-10-11')).toBe(false);
  });

  it('places a timestamp on its local day', () => {
    expect(inReviewWindow(new Date(2026, 9, 5, 0, 30).toISOString(), '2026-10-05', '2026-10-11')).toBe(true);
    expect(inReviewWindow(new Date(2026, 9, 11, 23, 30).toISOString(), '2026-10-05', '2026-10-11')).toBe(true);
    expect(inReviewWindow(new Date(2026, 9, 12, 8, 0).toISOString(), '2026-10-05', '2026-10-11')).toBe(false);
  });
});

describe('buildReviewFacts', () => {
  it('reports training, food against target, and the targets in force', () => {
    const f = buildReviewFacts(input());
    expect(f.period).toBe('5 Oct to 11 Oct');
    expect(f.sessions).toBe(2);
    expect(f.sessionNames).toEqual(['Upper (Push)', 'Lower (Squat)']);
    expect(f.setsByRegion).toEqual(['Legs 12', 'Chest 9']);
    expect(f.daysFoodLogged).toBe('4 of 7');
    expect(f.averageCalories).toBe(2225);
    expect(f.averageCalorieTarget).toBe(2300);
    expect(f.averageProteinGrams).toBe(166);
    expect(f.proteinTargetMetOnDays).toBe('2 of 4');
    expect(f.currentCalorieTarget).toBe(2300);
    expect(f.currentProteinTargetGrams).toBe(170);
    expect(f.currentProteinTargetLowerBodyDayGrams).toBe(200);
  });

  it('says so when few days stand behind the averages', () => {
    expect(buildReviewFacts(input()).foodLoggedForFewDays).toBeUndefined(); // 4 of 7 is over half
    const thin = buildReviewFacts(input({ trend: summarise(week([logged(2200, 160), {}, {}, {}, {}, {}, {}])) }));
    expect(thin.daysFoodLogged).toBe('1 of 7');
    expect(thin.foodLoggedForFewDays).toBe(true);
  });

  it('leaves out food figures when nothing was logged, rather than reporting zero', () => {
    const f = buildReviewFacts(input({ trend: summarise(week([])) }));
    expect(f.daysFoodLogged).toBe('0 of 7');
    expect(f.averageCalories).toBeUndefined();
    expect(f.averageProteinGrams).toBeUndefined();
    expect(f.proteinTargetMetOnDays).toBeUndefined();
  });

  it('leaves out training, records, weight and scan when there are none', () => {
    const f = buildReviewFacts(input({ sessions: [], setsByRegion: {} }));
    expect(f.sessions).toBe(0);
    expect(f.sessionNames).toBeUndefined();
    expect(f.setsByRegion).toBeUndefined();
    expect(f.personalRecords).toBeUndefined();
    expect(f.weight).toBeUndefined();
    expect(f.bodyScan).toBeUndefined();
  });

  it('leaves the calorie target out when none is set', () => {
    expect(buildReviewFacts(input({ targets: { calories: null, protein: 170, proteinLegDay: 200 } })).currentCalorieTarget).toBeUndefined();
  });
});

describe('recordLines', () => {
  it('gives one line per exercise, its heaviest record, in name order', () => {
    expect(
      recordLines([
        { exercise: 'Bench Press', kind: 'e1rm', weight: 80, reps: 6 },
        { exercise: 'Bench Press', kind: 'weight', weight: 82.5, reps: 4 },
        { exercise: 'Barbell Row', kind: 'weight', weight: 70, reps: 8 },
      ]),
    ).toEqual(['Barbell Row: 70 kg × 8', 'Bench Press: 82.5 kg × 4']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ exercise: `Lift ${i}`, kind: 'weight' as const, weight: 50 + i }));
    expect(recordLines(many)).toHaveLength(5);
  });
});

describe('weightFacts', () => {
  it('gives the latest reading and the change from about a week before', () => {
    const f = weightFacts(
      [
        { date: '2026-10-05', kg: 82.1 },
        { date: '2026-10-12', kg: 82.4 },
      ],
      TODAY,
    );
    expect(f.weight).toBe('82.4 kg on 2026-10-12, +0.3 kg from 82.1 kg on 2026-10-05');
    expect(f.weightChangeKg).toBe(0.3);
  });

  it('gives just the latest reading when nothing is about a week older', () => {
    expect(weightFacts([{ date: '2026-10-11', kg: 82 }, { date: '2026-10-10', kg: 82.2 }], TODAY)).toEqual({ weight: '82 kg on 2026-10-11' });
  });

  it('ignores readings after today and is empty with none', () => {
    expect(weightFacts([{ date: '2026-10-13', kg: 90 }], TODAY)).toEqual({});
    expect(weightFacts([], TODAY)).toEqual({});
  });
});

describe('scanFacts', () => {
  const scan = (date: string, muscle: number, fat: number, weight: number) => ({ date, weightKg: weight, skeletalMuscleKg: muscle, bodyFatKg: fat, bodyFatPct: Math.round((fat / weight) * 1000) / 10 });

  it('gives the latest scan and the change since the one before', () => {
    const s = scanFacts([scan('2026-09-04', 36.1, 14.2, 81), scan('2026-10-02', 36.7, 14.0, 82)]);
    expect(s).toContain('latest scan 2026-10-02, since 2026-09-04:');
    expect(s).toContain('skeletal muscle +0.6 kg');
    expect(s).toContain('body fat −0.2 kg');
  });

  it('gives just the date with one scan, and nothing with none', () => {
    expect(scanFacts([scan('2026-10-02', 36.7, 14, 82)])).toBe('latest scan 2026-10-02');
    expect(scanFacts([])).toBeUndefined();
  });
});
