import { describe, expect, it } from 'vitest';
import {
  atwaterKcal,
  checkAtwater,
  fromPer100,
  fromPortion,
  gramsOf,
  isPackaged,
  itemMacros,
  macrosOf,
  mayOverwrite,
  reconcileMacros,
  scaleNutrition,
  totalMacros,
  weigh,
  withGrams,
  type FoodItem,
  type Macros,
} from './food';

const rice: Macros = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 };

function item(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'i1',
    name: 'Rice',
    portion: '1 bowl',
    source: 'model',
    nutrition: fromPer100(rice, 200),
    ...over,
  };
}

describe('weighed portions derive their macros', () => {
  it('scales per-100g values by the weight', () => {
    expect(macrosOf(fromPer100(rice, 200))).toEqual({ kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 });
  });

  it('a 100 g portion is exactly the per-100g figures', () => {
    expect(macrosOf(fromPer100(rice, 100))).toEqual(rice);
  });

  it('a zero-weight portion contributes nothing', () => {
    expect(macrosOf(fromPer100(rice, 0))).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('the portion bug is unrepresentable', () => {
  // The Kotlin original scaled calories and macros but left grams untouched, so a doubled
  // portion reported 200 g of calories against a 100 g weight. Here weight is the only input.
  it('changing the weight moves the macros with it', () => {
    const n = withGrams(fromPer100(rice, 100), 200);
    expect(gramsOf(n)).toBe(200);
    expect(macrosOf(n).kcal).toBe(260);
  });

  it('scaling a weighed portion scales its weight, keeping the two consistent', () => {
    const n = scaleNutrition(fromPer100(rice, 100), 2);
    expect(gramsOf(n)).toBe(200);
    expect(macrosOf(n).kcal).toBe(260);
    // The invariant the old model broke: derived macros always match the stated weight.
    expect(macrosOf(n).kcal).toBeCloseTo((rice.kcal * gramsOf(n)!) / 100, 6);
  });

  it('holds after repeated rescaling', () => {
    let n = fromPer100(rice, 100);
    for (const f of [2, 0.5, 1.5, 3]) n = scaleNutrition(n, f);
    expect(macrosOf(n).kcal).toBeCloseTo((rice.kcal * gramsOf(n)!) / 100, 6);
  });
});

describe('unweighed portions', () => {
  const bowl = fromPortion({ kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 });

  it('report no weight and scale their macros directly', () => {
    expect(gramsOf(bowl)).toBeNull();
    expect(macrosOf(scaleNutrition(bowl, 0.5)).kcal).toBe(130);
  });

  it('ignore an attempt to set a weight they do not have', () => {
    expect(withGrams(bowl, 300)).toEqual(bowl);
  });

  it('become weighed when a weight is learned, without changing what was eaten', () => {
    const weighed = weigh(bowl, 200);
    expect(gramsOf(weighed)).toBe(200);
    expect(macrosOf(weighed).kcal).toBeCloseTo(260, 6);
    // And per-100g is now recoverable, which is what food memory needs.
    expect(macrosOf(withGrams(weighed, 100)).kcal).toBeCloseTo(130, 6);
  });

  it('refuse a nonsensical weight', () => {
    expect(weigh(bowl, 0)).toEqual(bowl);
    expect(weigh(bowl, -5)).toEqual(bowl);
  });
});

describe('totals', () => {
  it('sum every item and stay zero when empty', () => {
    expect(totalMacros([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const total = totalMacros([item(), item({ id: 'i2', nutrition: fromPortion({ kcal: 100, protein: 10, carbs: 5, fat: 2 }) })]);
    expect(total.kcal).toBe(360);
    expect(total.protein).toBeCloseTo(15.4, 6);
  });

  it('follow an edited item without a separate recalculation step', () => {
    const edited = item({ nutrition: withGrams(item().nutrition, 100) });
    expect(itemMacros(edited).kcal).toBe(130);
    expect(totalMacros([edited]).kcal).toBe(130);
  });
});

describe('Atwater cross-check', () => {
  it('computes energy from macros', () => {
    expect(atwaterKcal({ kcal: 0, protein: 10, carbs: 20, fat: 5 })).toBe(165);
  });

  it('accepts figures that agree', () => {
    expect(checkAtwater({ kcal: 165, protein: 10, carbs: 20, fat: 5 }).ok).toBe(true);
  });

  it('catches a hallucinated calorie figure the macros contradict', () => {
    // A model claiming 250 kcal for 20 g protein, 30 g carbs and 30 g fat: the macros alone
    // are 470 kcal. Clamping each field separately never notices.
    const check = checkAtwater({ kcal: 250, protein: 20, carbs: 30, fat: 30 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('impossible');
    expect(check.implied).toBe(470);
  });

  it('treats macros implying more energy than stated as the more serious error', () => {
    // 30 g of fat is 270 kcal, so 200 kcal is impossible — 35% over.
    expect(checkAtwater({ kcal: 200, protein: 0, carbs: 0, fat: 30 }).reason).toBe('impossible');
    // Whereas unexplained energy in the other direction needs to be much larger to flag,
    // because alcohol carries 7 kcal/g and appears in no macro field.
    // 5 g protein, 25 g carbs and 2 g fat imply 138 kcal, so 155 stated is an 11% shortfall: fine.
    expect(checkAtwater({ kcal: 155, protein: 5, carbs: 25, fat: 2 }).ok).toBe(true);
    // 400 kcal against the same macros leaves 262 kcal unaccounted for, which is not.
    expect(checkAtwater({ kcal: 400, protein: 5, carbs: 25, fat: 2 }).reason).toBe('unexplained');
  });

  it('tolerates the fibre convention over-implying by a few per cent', () => {
    // Fibre sits inside carbohydrate on UK labels but yields ~2 kcal/g, not 4, so a high-fibre
    // food legitimately implies slightly more energy than it states.
    expect(checkAtwater({ kcal: 250, protein: 0, carbs: 0, fat: 30 }).ok).toBe(true);
  });

  it('does not chase its own tail on a near-zero food', () => {
    // A diet squash: 3 kcal with 0.3 g of carbs implies 1.2 kcal. Judged on relative drift alone
    // that is a 60% shortfall, and accepting the correction gives 1 kcal, itself 20% under its own
    // implied 1.2 — a warning that could never be cleared, on a correct label.
    expect(checkAtwater({ kcal: 3, protein: 0, carbs: 0.3, fat: 0 }).ok).toBe(true);
    expect(checkAtwater({ kcal: 2, protein: 0.1, carbs: 0, fat: 0 }).ok).toBe(true);
    expect(reconcileMacros({ kcal: 3, protein: 0, carbs: 0.3, fat: 0 }).corrected).toBe(false);
  });

  it('still flags a real disagreement on a small food', () => {
    // The floor is absolute and small, so it excuses rounding without excusing error.
    expect(checkAtwater({ kcal: 20, protein: 0, carbs: 0, fat: 5 }).reason).toBe('impossible');
  });

  it('trusts the macros over the calorie figure when they disagree', () => {
    const { macros, corrected, reason } = reconcileMacros({ kcal: 250, protein: 20, carbs: 30, fat: 30 });
    expect(corrected).toBe(true);
    expect(reason).toBe('impossible');
    expect(macros.kcal).toBe(470);
    expect(macros.fat).toBe(30);
  });

  it('tolerates rounding in real label values', () => {
    // A real cereal label: stated 379 kcal, macros imply 380.
    expect(checkAtwater({ kcal: 379, protein: 11, carbs: 72, fat: 4 }).ok).toBe(true);
  });
});

describe('trust hierarchy', () => {
  it('lets better evidence overwrite worse', () => {
    expect(mayOverwrite('model', 'label')).toBe(true);
    expect(mayOverwrite('model', 'user')).toBe(true);
    expect(mayOverwrite('memory', 'label')).toBe(true);
  });

  it('never lets a model guess overwrite a correction or a label', () => {
    expect(mayOverwrite('user', 'model')).toBe(false);
    expect(mayOverwrite('label', 'model')).toBe(false);
    expect(mayOverwrite('label', 'memory')).toBe(false);
  });

  it('allows a source to refresh itself', () => {
    expect(mayOverwrite('user', 'user')).toBe(true);
    expect(mayOverwrite('model', 'model')).toBe(true);
  });
});

describe('packaging detection', () => {
  it('recognises branded products', () => {
    expect(isPackaged({ brand: 'Trek', product: 'Protein Flapjack' })).toBe(true);
    expect(isPackaged({ product: 'Protein Flapjack' })).toBe(true);
  });

  it('treats the words a model uses for "not packaged" as not packaged', () => {
    // These previously triggered a pointless network lookup on every home-cooked plate.
    expect(isPackaged({ brand: 'homemade' })).toBe(false);
    expect(isPackaged({ brand: 'Generic' })).toBe(false);
    expect(isPackaged({ brand: 'unknown', product: '' })).toBe(false);
  });

  it('treats absent or blank packaging text as not packaged', () => {
    expect(isPackaged({})).toBe(false);
    expect(isPackaged({ brand: '   ', product: '' })).toBe(false);
  });
});
