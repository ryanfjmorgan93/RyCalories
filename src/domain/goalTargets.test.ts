import { describe, expect, it } from 'vitest';
import { goalTargets, type TargetInputs } from './goalTargets';

// An 82 kg lifter with 67.4 kg lean mass, an InBody BMR of 1,840, 8,000 steps, 16 hour-long sessions logged in 4 weeks.
const BODY: TargetInputs = { goal: 'recomp', weightKg: 82, leanMassKg: 67.4, bmrKcal: 1840, stepsPerDay: 8000, training: { sessions: 16, minutes: 960, days: 28 } };
// Measured: ate 2,650 a day and held weight, so maintenance is 2,650.
const HELD = { intakeAvg: 2650, loggedDays: 24, totalDays: 27, deltaKg: 0, spanDays: 21 };

describe('maintenance', () => {
  it('is estimated from the scan, steps and the sessions logged until it can be measured, and says what measuring needs', () => {
    const t = goalTargets({ ...BODY, measuredGate: 'Still needs food logged on 22 of the last 27 days (15 so far)' })!;
    // 1,840 × 1.35 = 2,484; 8,000 × 82 × 0.5/1,330 = 247; 4 METs × 82 kg × 16 h / 28 days = 187; 2,918.
    expect(t.maintenance).toBe(2918);
    expect(t.lines[0]).toBe(
      'Maintenance ≈2,918 kcal, estimated: 1,840 resting (your InBody BMR) × 1.35 for everyday living and digestion = 2,484, + 247 for 8,000 steps a day, + 187 for your 16 sessions in the last 4 weeks (960 min in all).',
    );
    expect(t.lines.at(-1)).toBe(
      'The exact figure is measured: average food eaten − weight change × 7,700 kcal ÷ days, over the last 4 weeks. It counts everything you burn and replaces the estimate once it has the data. Still needs food logged on 22 of the last 27 days (15 so far).',
    );
    expect(goalTargets({ ...BODY, training: { sessions: 0, minutes: 0, days: 28 } })!.lines[0]).toContain('+ 0 for no sessions logged in the last 4 weeks.');
  });

  it('is measured whenever it can be: food eaten against weight change, the sum shown with the owner\'s numbers', () => {
    const t = goalTargets({ ...BODY, measured: { intakeAvg: 2500.4, loggedDays: 24, totalDays: 27, deltaKg: -0.432, spanDays: 21 } })!;
    // 0.43 × 7,700 ÷ 21 = 157.7 → 158 a day from the body; 2,500 + 158 = 2,658.
    expect(t.maintenance).toBe(2658);
    expect(t.lines[0]).toBe(
      "Maintenance 2,658 kcal, measured: you ate 2,500 kcal a day on average (24 of 27 days logged) and lost 0.43 kg in 21 days (first week's weigh-ins against last week's): 0.43 × 7,700 ÷ 21 = 158 a day drawn from your body, so 2,500 + 158. This counts everything you burned, whatever you did.",
    );
    expect(t.lines.at(-1)).toMatch(/^Carbs/);
    const gained = goalTargets({ ...BODY, measured: { intakeAvg: 3000, loggedDays: 27, totalDays: 27, deltaKg: 0.3, spanDays: 21 } })!;
    expect(gained.maintenance).toBe(2890); // 0.30 × 7,700 ÷ 21 = 110 stored
    expect(gained.lines[0]).toContain('gained 0.30 kg in 21 days');
    expect(gained.lines[0]).toContain('= 110 a day stored, so 3,000 − 110.');
    expect(goalTargets({ ...BODY, measured: HELD })!.lines[0]).toContain('and your weight held, so maintenance is what you ate.');
  });

  it('uses Cunningham from lean mass without a BMR, assumes steps it cannot read, and gives up with neither', () => {
    const t = goalTargets({ ...BODY, bmrKcal: undefined, stepsPerDay: undefined })!;
    expect(t.lines[0]).toContain('1,983 resting (500 + 22 × 67.4 kg lean mass)');
    expect(t.lines[0]).toContain('6,000 steps a day (assumed: steps not read)');
    expect(goalTargets({ ...BODY, bmrKcal: undefined, leanMassKg: undefined })).toBeNull();
  });
});

describe('a recomp', () => {
  it('eats at maintenance, with protein from lean mass, fat a quarter of calories and carbs the rest', () => {
    const t = goalTargets(BODY)!;
    expect(t).toMatchObject({ kcal: 2900, protein: 175, fat: 80, carbs: 370 });
    expect(t.lines.slice(1, 5)).toEqual([
      'Calories 2,900: maintenance, for a recomp.',
      'Protein 175 g: 2.6 g per kg of lean mass (67.4 kg; 2.6 to 3.5 for a recomp in trained lifters).',
      'Fat 80 g: 25% of calories (20 to 35% is the usual range).',
      'Carbs 370 g: the rest (4.5 g per kg of bodyweight).',
    ]);
    // The macros come back to the calories, within the rounding.
    expect(Math.abs(t.protein * 4 + t.fat * 9 + t.carbs * 4 - t.kcal)).toBeLessThanOrEqual(20);
  });
});

describe('the other goals', () => {
  it('gain at their rate of bodyweight a week, with protein from bodyweight', () => {
    const lean = goalTargets({ ...BODY, goal: 'lean_gain', measured: HELD })!;
    // 0.25% × 82 = 0.205 kg a week × 7,700 / 7 = 226 → 2,876 → 2,900.
    expect(lean).toMatchObject({ kcal: 2900, protein: 165 });
    expect(lean.lines[1]).toBe('Calories 2,900: maintenance + 226 to gain ≈0.21 kg a week (0.25% of bodyweight, 7,700 kcal a kg).');
    expect(goalTargets({ ...BODY, goal: 'faster_gain', measured: HELD })!.kcal).toBe(3100);
  });

  it('lose at 0.75% a week with more protein, and never set fat below 0.6 g a kg', () => {
    const loss = goalTargets({ ...BODY, goal: 'fat_loss', measured: HELD })!;
    // 0.75% × 82 = 0.615 kg a week × 7,700 / 7 = 676.5, rounded to 676 off → 1,974 → 1,950. 25% of it is 54 g of fat.
    expect(loss).toMatchObject({ kcal: 1950, protein: 180, fat: 55 });
    expect(loss.lines[1]).toBe('Calories 1,950: maintenance − 676 to lose ≈0.61 kg a week (0.75% of bodyweight, 7,700 kcal a kg).');
    const lowCal = goalTargets({ ...BODY, goal: 'fat_loss', measured: { ...HELD, intakeAvg: 1700 } })!;
    expect(lowCal.fat).toBe(50); // 25% of 1,000 is 28 g, under 0.6 × 82 = 49.2 → 50
  });

  it('fall back to protein from bodyweight with no lean mass', () => {
    const t = goalTargets({ ...BODY, leanMassKg: undefined })!;
    expect(t.protein).toBe(180);
    expect(t.lines[2]).toBe('Protein 180 g: 2.2 g per kg of bodyweight (no lean mass from a scan yet).');
  });
});
