import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { calorieTargetOn } from './nutrition';
import { calorieChange, proteinChange } from './targetChange';
import { DEFAULT_SETTINGS, type Settings } from './types';

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, id: 'settings', createdAt: '2026-01-01T00:00:00.000Z', ...over });
const TODAY = '2026-10-12';

describe('calorieChange', () => {
  it('makes the proposal the daily target from today, held there: start and ceiling both become the figure', () => {
    const s = settings({ calorieStartDate: '2026-09-01' });
    const c = calorieChange(s, 2400, TODAY)!;
    expect(c.patch).toEqual({ calorieStart: 2400, calorieStartDate: TODAY, calorieCeiling: 2400 });
    expect(calorieTargetOn(TODAY, { ...s, ...c.patch })?.kcal).toBe(2400);
    // 41 days in is two 14-day steps: 1,900 + 2 × 200.
    expect(calorieTargetOn(TODAY, s)?.kcal).toBe(2300);
    expect(c.line).toBe('Calories set to 2,400 a day from today.');
  });

  it('does not keep climbing: "hold at 2,600" is still 2,600 months later, not 2,800 and 3,000', () => {
    // The defaults step 200 kcal every 14 days up to 3,000, and the reverse diet was well under way.
    const s = settings({ calorieStartDate: '2026-09-01' });
    const after = { ...s, ...calorieChange(s, 2600, TODAY)!.patch };
    for (const days of [0, 13, 14, 28, 42, 100, 365]) {
      const t = calorieTargetOn(addDays(TODAY, days), after);
      expect(t?.kcal, `${days} days on`).toBe(2600);
      expect(t?.nextStepOn, `${days} days on`).toBeNull();
    }
    // The old behaviour, for contrast: only the start moved, so the stepper carried on.
    const old = { ...s, calorieStart: 2600, calorieStartDate: TODAY };
    expect(calorieTargetOn(addDays(TODAY, 14), old)?.kcal).toBe(2800);
    expect(calorieTargetOn(addDays(TODAY, 28), old)?.kcal).toBe(3000);
  });

  it('holds a proposal below the old ceiling as well as above it', () => {
    const above = calorieChange(settings({ calorieStartDate: '2026-09-01', calorieCeiling: 2200 }), 2400, TODAY)!;
    expect(above.patch.calorieCeiling).toBe(2400);
    const below = calorieChange(settings({ calorieStartDate: '2026-09-01', calorieCeiling: 3000 }), 2400, TODAY)!;
    expect(below.patch.calorieCeiling).toBe(2400);
    expect(above.line).toBe(below.line);
  });

  it('sets a target where there was none', () => {
    const c = calorieChange(settings(), 2400, TODAY)!;
    expect(c.line).toBe('Calories set to 2,400 a day from today.');
    expect(calorieTargetOn(TODAY, { ...settings(), ...c.patch })?.kcal).toBe(2400);
  });

  it('the owner can still restart a ramp from Targets: raising the ceiling resumes the steps from the held figure', () => {
    const base = settings({ calorieStartDate: '2026-09-01' });
    const held = { ...base, ...calorieChange(base, 2400, TODAY)!.patch };
    // What Settings → Targets does on Save: the ceiling field, on its own, is a plain settings patch.
    const restarted = { ...held, calorieCeiling: 3000 };
    expect(calorieTargetOn(TODAY, restarted)?.kcal).toBe(2400);
    expect(calorieTargetOn(addDays(TODAY, 14), restarted)?.kcal).toBe(2600);
    expect(calorieTargetOn(addDays(TODAY, 14), restarted)?.nextStepOn).toBe(addDays(TODAY, 28));
  });

  it('is null only when the target already is the proposal and already holds there', () => {
    const holding = settings({ calorieStartDate: TODAY, calorieStart: 2400, calorieCeiling: 2400 });
    expect(calorieChange(holding, 2400, TODAY)).toBeNull();
    // Today's figure is 2,400 but the stepper is still climbing, so accepting still has something to do.
    const climbing = settings({ calorieStartDate: TODAY, calorieStart: 2400 });
    const c = calorieChange(climbing, 2400, TODAY)!;
    expect(c.patch.calorieCeiling).toBe(2400);
    expect(c.line).toBe('Calories set to 2,400 a day from today.');
  });
});

describe('proteinChange', () => {
  it('moves the daily target and keeps the lower-body day\'s gap', () => {
    const c = proteinChange(settings({ proteinTarget: 170, proteinTargetLegDay: 200 }), 190)!;
    expect(c.patch).toEqual({ proteinTarget: 190, proteinTargetLegDay: 220 });
    expect(c.line).toBe('Protein target changed from 170 g to 190 g (lower-body days 200 g to 220 g).');
  });

  it('keeps a lower-body day that matches the daily target matching it', () => {
    expect(proteinChange(settings({ proteinTarget: 180, proteinTargetLegDay: 180 }), 190)!.patch).toEqual({ proteinTarget: 190, proteinTargetLegDay: 190 });
  });

  it('is null when the target already is the proposal', () => {
    expect(proteinChange(settings({ proteinTarget: 190 }), 190)).toBeNull();
  });
});
