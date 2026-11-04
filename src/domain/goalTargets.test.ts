import { describe, expect, it } from 'vitest';
import { goalTargets, type TargetInputs } from './goalTargets';

// An 82 kg lifter with 67.4 kg lean mass, an InBody BMR of 1,840, 8,000 steps, four 60-minute sessions.
const BODY: TargetInputs = { goal: 'recomp', weightKg: 82, leanMassKg: 67.4, bmrKcal: 1840, stepsPerDay: 8000, sessionsPerWeek: 4, sessionMinutes: 60 };

describe('maintenance', () => {
  it('is worked out from the scan, steps and training until it can be measured', () => {
    const t = goalTargets(BODY)!;
    // 1,840 × 1.35 = 2,484; 8,000 × 82 × 0.5/1,330 = 247; 4 × 4 × 82 × 1 / 7 = 187; 2,918.
    expect(t.maintenance).toBe(2918);
    expect(t.lines[0]).toBe(
      'Maintenance ≈2,918 kcal: 1,840 resting (your InBody BMR) × 1.35 for everyday living and digestion = 2,484, + 247 for 8,000 steps a day, + 187 for 4 sessions a week of 60 min. Replaced by your measured maintenance once two weeks of food and weigh-ins are in.',
    );
  });

  it('is the measured figure whenever there is one', () => {
    const t = goalTargets({ ...BODY, measured: { kcal: 2650, days: 28 } })!;
    expect(t.maintenance).toBe(2650);
    expect(t.lines[0]).toBe('Maintenance 2,650 kcal: measured from your food and weigh-ins over 28 days.');
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
    expect(t.lines.slice(1)).toEqual([
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
    const lean = goalTargets({ ...BODY, goal: 'lean_gain', measured: { kcal: 2650, days: 21 } })!;
    // 0.25% × 82 = 0.205 kg a week × 7,700 / 7 = 226 → 2,876 → 2,900.
    expect(lean).toMatchObject({ kcal: 2900, protein: 165 });
    expect(lean.lines[1]).toBe('Calories 2,900: maintenance + 226 to gain ≈0.21 kg a week (0.25% of bodyweight, 7,700 kcal a kg).');
    expect(goalTargets({ ...BODY, goal: 'faster_gain', measured: { kcal: 2650, days: 21 } })!.kcal).toBe(3100);
  });

  it('lose at 0.75% a week with more protein, and never set fat below 0.6 g a kg', () => {
    const loss = goalTargets({ ...BODY, goal: 'fat_loss', measured: { kcal: 2650, days: 21 } })!;
    // 0.75% × 82 = 0.615 kg a week × 7,700 / 7 = 676.5, rounded to 676 off → 1,974 → 1,950. 25% of it is 54 g of fat.
    expect(loss).toMatchObject({ kcal: 1950, protein: 180, fat: 55 });
    expect(loss.lines[1]).toBe('Calories 1,950: maintenance − 676 to lose ≈0.61 kg a week (0.75% of bodyweight, 7,700 kcal a kg).');
    const lowCal = goalTargets({ ...BODY, goal: 'fat_loss', measured: { kcal: 1700, days: 21 } })!;
    expect(lowCal.fat).toBe(50); // 25% of 1,000 is 28 g, under 0.6 × 82 = 49.2 → 50
  });

  it('fall back to protein from bodyweight with no lean mass', () => {
    const t = goalTargets({ ...BODY, leanMassKg: undefined })!;
    expect(t.protein).toBe(180);
    expect(t.lines[2]).toBe('Protein 180 g: 2.2 g per kg of bodyweight (no lean mass from a scan yet).');
  });
});
