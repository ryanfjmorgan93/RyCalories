import { describe, expect, it } from 'vitest';
import { calorieTargetOn } from './nutrition';
import { calorieChange, proteinChange } from './targetChange';
import { DEFAULT_SETTINGS, type Settings } from './types';

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, id: 'settings', createdAt: '2026-01-01T00:00:00.000Z', ...over });
const TODAY = '2026-10-12';

describe('calorieChange', () => {
  it('starts the stepper at the proposed figure from today, so today\'s target is exactly that', () => {
    const s = settings({ calorieStartDate: '2026-09-01' });
    const c = calorieChange(s, 2400, TODAY)!;
    expect(c.patch).toEqual({ calorieStart: 2400, calorieStartDate: TODAY });
    expect(calorieTargetOn(TODAY, { ...s, ...c.patch })?.kcal).toBe(2400);
    // 41 days in is two 14-day steps: 1,900 + 2 × 200.
    expect(calorieTargetOn(TODAY, s)?.kcal).toBe(2300);
    expect(c.line).toBe('Calorie target changed from 2,300 to 2,400 kcal from today.');
  });

  it('sets a target where there was none', () => {
    const c = calorieChange(settings(), 2400, TODAY)!;
    expect(c.line).toBe('Calorie target set to 2,400 kcal from today.');
    expect(calorieTargetOn(TODAY, { ...settings(), ...c.patch })?.kcal).toBe(2400);
  });

  it('raises the ceiling when the proposal is above it, and says so', () => {
    const s = settings({ calorieStartDate: '2026-09-01', calorieCeiling: 2200 });
    const c = calorieChange(s, 2400, TODAY)!;
    expect(c.patch.calorieCeiling).toBe(2400);
    expect(c.line).toContain('The ceiling went up to 2,400 kcal too.');
    expect(calorieTargetOn(TODAY, { ...s, ...c.patch })?.kcal).toBe(2400);
  });

  it('leaves the ceiling alone when the proposal is under it', () => {
    const c = calorieChange(settings({ calorieStartDate: '2026-09-01' }), 2400, TODAY)!;
    expect('calorieCeiling' in c.patch).toBe(false);
  });

  it('is null when today\'s target already is the proposal', () => {
    const s = settings({ calorieStartDate: TODAY, calorieStart: 2400 });
    expect(calorieChange(s, 2400, TODAY)).toBeNull();
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
