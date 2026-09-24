import { describe, expect, it } from 'vitest';
import {
  amountsNeeded,
  combinedSource,
  countToGrams,
  gapsCount,
  ingredientGap,
  ingredientMacros,
  recipeDisplayTotals,
  recipeIsComplete,
  recipeTotalGrams,
  shareFraction,
  shareLabel,
  shareNutrition,
  toIngredient,
} from './recipe';
import { ZERO, type Macros } from './food';
import type { IngredientCandidate } from './ingredientMatch';
import type { RecipeIngredient } from './types';

const EGG: Macros = { kcal: 131, protein: 12.6, carbs: 0.8, fat: 9.5 };
const BACON: Macros = { kcal: 215, protein: 16.5, carbs: 0, fat: 17 };

function ing(over: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: 'i1',
    name: 'Eggs',
    source: 'table',
    grams: 150,
    per100: EGG,
    ...over,
  };
}

describe('countToGrams', () => {
  it('multiplies count by the per-unit weight', () => {
    expect(countToGrams(3, 50)).toBe(150);
  });

  it('never goes negative', () => {
    expect(countToGrams(-2, 50)).toBe(0);
    expect(countToGrams(3, -10)).toBe(0);
  });

  it('treats a non-finite input as zero', () => {
    expect(countToGrams(NaN, 50)).toBe(0);
    expect(countToGrams(3, Infinity)).toBe(0);
  });
});

describe('ingredientMacros', () => {
  it('scales per-100g values by the ingredient weight', () => {
    expect(ingredientMacros(ing({ grams: 100 }))).toEqual(EGG);
    expect(ingredientMacros(ing({ grams: 50 })).kcal).toBeCloseTo(65.5, 6);
  });

  it('is zero for an ingredient with no amount yet', () => {
    expect(ingredientMacros(ing({ grams: 0 }))).toEqual(ZERO);
  });
});

describe('recipeTotalGrams', () => {
  it('sums the ingredient weights', () => {
    const ings = [ing({ grams: 150 }), ing({ id: 'i2', name: 'Bacon', per100: BACON, grams: 50 })];
    expect(recipeTotalGrams(ings)).toBe(200);
  });

  it('is zero for no ingredients', () => {
    expect(recipeTotalGrams([])).toBe(0);
  });
});

describe('recipeDisplayTotals rounds then sums, like foodRepo.sumItems', () => {
  it('matches the naive sum-then-round when there is nothing to disagree about', () => {
    const ings = [ing({ grams: 100 })];
    expect(recipeDisplayTotals(ings)).toEqual({ kcal: 131, protein: 13, carbs: 1, fat: 10 });
  });

  it('equals the sum of the individually displayed rows even where naive rounding would disagree', () => {
    // Three ingredients each implying an exact 33.5 kcal (670 kcal/100g at 5g). Each row displays
    // as 34 kcal (Math.round rounds .5 up), so the total shown beside them must read 102 — not
    // the 101 a single round-the-final-sum would give (100.5 → 101).
    const flat: Macros = { kcal: 670, protein: 0, carbs: 0, fat: 0 };
    const ings: RecipeIngredient[] = [
      ing({ id: 'a', per100: flat, grams: 5 }),
      ing({ id: 'b', per100: flat, grams: 5 }),
      ing({ id: 'c', per100: flat, grams: 5 }),
    ];
    const exactTotalKcal = ings.reduce((sum, i) => sum + (i.per100.kcal * i.grams) / 100, 0);
    expect(exactTotalKcal).toBe(100.5);
    expect(Math.round(exactTotalKcal)).toBe(101); // the naive (wrong) approach

    const displayed = recipeDisplayTotals(ings);
    expect(displayed.kcal).toBe(102); // 34 + 34 + 34 — the sum of what each row actually shows
  });
});

describe('recipeIsComplete', () => {
  it('is false with no ingredients', () => {
    expect(recipeIsComplete([])).toBe(false);
  });

  it('is false while any ingredient has no amount', () => {
    expect(recipeIsComplete([ing({ grams: 100 }), ing({ id: 'i2', grams: 0 })])).toBe(false);
  });

  it('is false when a figure is not finite', () => {
    expect(recipeIsComplete([ing({ per100: { kcal: NaN, protein: 0, carbs: 0, fat: 0 } })])).toBe(false);
  });

  it('is true once every ingredient has a positive weight and finite figures', () => {
    expect(recipeIsComplete([ing({ grams: 100 }), ing({ id: 'i2', per100: BACON, grams: 30 })])).toBe(true);
  });
});

describe('amountsNeeded', () => {
  it('counts ingredients with no amount entered', () => {
    const ings = [ing({ grams: 0 }), ing({ id: 'i2', grams: 50 }), ing({ id: 'i3', grams: 0 })];
    expect(amountsNeeded(ings)).toBe(2);
  });

  it('is zero once every ingredient has an amount', () => {
    expect(amountsNeeded([ing({ grams: 50 })])).toBe(0);
  });
});

describe('shareFraction', () => {
  it('divides eaten by made in portions mode', () => {
    expect(shareFraction({ mode: 'portions', made: 2, eaten: 1 })).toBe(0.5);
  });

  it('is not clamped above 1 — seconds are real', () => {
    expect(shareFraction({ mode: 'portions', made: 2, eaten: 3 })).toBe(1.5);
  });

  it('is null for a zero or negative number of portions made', () => {
    expect(shareFraction({ mode: 'portions', made: 0, eaten: 1 })).toBeNull();
    expect(shareFraction({ mode: 'portions', made: -1, eaten: 1 })).toBeNull();
  });

  it('is null for a negative or non-finite amount eaten', () => {
    expect(shareFraction({ mode: 'portions', made: 2, eaten: -1 })).toBeNull();
    expect(shareFraction({ mode: 'portions', made: 2, eaten: NaN })).toBeNull();
  });

  it('divides plate by dish in weigh mode', () => {
    expect(shareFraction({ mode: 'weigh', dishGrams: 900, plateGrams: 300 })).toBeCloseTo(1 / 3, 10);
  });

  it('is null for a zero or negative dish weight', () => {
    expect(shareFraction({ mode: 'weigh', dishGrams: 0, plateGrams: 300 })).toBeNull();
    expect(shareFraction({ mode: 'weigh', dishGrams: -900, plateGrams: 300 })).toBeNull();
  });

  it('is null for a negative plate weight', () => {
    expect(shareFraction({ mode: 'weigh', dishGrams: 900, plateGrams: -1 })).toBeNull();
  });
});

describe('shareLabel', () => {
  it('reads "N of M portions", pluralising on the number made', () => {
    expect(shareLabel({ mode: 'portions', made: 2, eaten: 1 })).toBe('1 of 2 portions');
  });

  it('keeps "portion" singular when only one was made, whatever the amount eaten', () => {
    expect(shareLabel({ mode: 'portions', made: 1, eaten: 0.5 })).toBe('0.5 of 1 portion');
  });

  it('reads "plate g of dish g" in weigh mode', () => {
    expect(shareLabel({ mode: 'weigh', dishGrams: 900, plateGrams: 300 })).toBe('300 g of 900 g');
  });
});

describe('shareNutrition', () => {
  it('is the exact unrounded totals scaled by the fraction, at portion basis', () => {
    const ings = [ing({ grams: 300 }), ing({ id: 'i2', name: 'Bacon', per100: BACON, grams: 100 })];
    const n = shareNutrition(ings, 0.5);
    expect(n.basis).toBe('portion');
    // Egg 300g: 393 kcal exact; bacon 100g: 215 kcal exact. Total 608, half = 304.
    expect(n.basis === 'portion' && n.macros.kcal).toBeCloseTo(304, 6);
  });

  it('is not clamped above the recipe total either', () => {
    const ings = [ing({ grams: 200 })]; // 262 kcal exact
    const n = shareNutrition(ings, 1.5);
    expect(n.basis === 'portion' && n.macros.kcal).toBeCloseTo(393, 6);
  });

  it('is zero macros for a recipe with no ingredients', () => {
    const n = shareNutrition([], 1);
    expect(n.basis === 'portion' && n.macros).toEqual(ZERO);
  });
});

describe('combinedSource', () => {
  it('picks the weakest trust among the sources', () => {
    expect(combinedSource(['table', 'user', 'label'])).toBe('table');
    expect(combinedSource(['label', 'user'])).toBe('label');
    expect(combinedSource(['model', 'user', 'table'])).toBe('model');
  });

  it('is stable whatever order the sources come in', () => {
    expect(combinedSource(['user', 'model', 'label'])).toBe('model');
    expect(combinedSource(['model', 'label', 'user'])).toBe('model');
  });

  it('is a single source unchanged', () => {
    expect(combinedSource(['memory'])).toBe('memory');
  });

  it('defends the empty case without pretending it is meaningful', () => {
    // Unreachable in practice — recipeIsComplete requires at least one ingredient before a
    // recipe can be saved — but must still return something typed as FoodSource.
    expect(combinedSource([])).toBe('user');
  });
});

describe('ingredientGap', () => {
  const UNKNOWN: Macros = { kcal: Number.NaN, protein: Number.NaN, carbs: Number.NaN, fat: Number.NaN };

  it('is null for an ingredient with an amount and figures', () => {
    expect(ingredientGap(ing())).toBeNull();
  });

  it('asks for an amount when there is none', () => {
    expect(ingredientGap(ing({ grams: 0 }))).toBe('amount');
  });

  it('asks for figures first when nothing matched, even with an amount', () => {
    expect(ingredientGap(ing({ per100: UNKNOWN, grams: 100 }))).toBe('figures');
    expect(ingredientGap(ing({ per100: UNKNOWN, grams: 0 }))).toBe('figures');
  });

  it('gapsCount counts every ingredient that is not ready, and agrees with recipeIsComplete', () => {
    const ings = [ing(), ing({ id: 'i2', grams: 0 }), ing({ id: 'i3', per100: UNKNOWN })];
    expect(gapsCount(ings)).toBe(2);
    expect(recipeIsComplete(ings)).toBe(false);
    expect(gapsCount([ing()])).toBe(0);
    expect(recipeIsComplete([ing()])).toBe(true);
  });
});

describe('toIngredient', () => {
  it('starts at grams 0 and all-NaN figures for a name nothing matched', () => {
    const i = toIngredient(null, 'bacon', 'id-1');
    expect(i).toEqual({ id: 'id-1', name: 'Bacon', source: 'user', grams: 0, per100: { kcal: NaN, protein: NaN, carbs: NaN, fat: NaN } });
  });

  it('capitalises only the first letter of the typed or recognised name', () => {
    expect(toIngredient(null, 'bacon rashers', 'id-1').name).toBe('Bacon rashers');
    expect(toIngredient(null, '  egg', 'id-1').name).toBe('Egg');
  });

  it('takes a table candidate\'s figures and foodKey, but keeps the typed name, not the table row\'s', () => {
    const candidate: IngredientCandidate = { key: 'table:17-001', name: 'Eggs, chicken, whole, raw', per100: EGG, source: 'table' };
    const i = toIngredient(candidate, 'egg', 'id-1');
    expect(i.name).toBe('Egg');
    expect(i.foodKey).toBe('table:17-001');
    expect(i.per100).toEqual(EGG);
    expect(i.source).toBe('table');
    expect(i.grams).toBe(0);
    expect(i.brand).toBeUndefined();
    expect(i.product).toBeUndefined();
  });

  it('builds a count-style unit from the candidate\'s, at count 0', () => {
    const candidate: IngredientCandidate = { key: 'table:17-001', name: 'Eggs, chicken, whole, raw', per100: EGG, source: 'table', unit: { label: 'egg', plural: 'eggs', grams: 50 } };
    const i = toIngredient(candidate, 'eggs', 'id-1');
    expect(i.unit).toEqual({ count: 0, unitGrams: 50, label: 'egg', plural: 'eggs' });
  });

  it('has no unit when the candidate has none', () => {
    const candidate: IngredientCandidate = { key: 'table:12-001', name: 'Cheese, Cheddar, English', per100: { kcal: 416, protein: 25.4, carbs: 0.1, fat: 34.4 }, source: 'table' };
    expect(toIngredient(candidate, 'cheddar', 'id-1').unit).toBeUndefined();
  });

  it('keeps a memory candidate\'s own name, brand and product, instead of the typed name', () => {
    const candidate: IngredientCandidate = {
      key: 'memory:p:tesco back bacon',
      name: 'Bacon',
      per100: { kcal: 230, protein: 17, carbs: 0.5, fat: 18 },
      source: 'label',
      brand: 'Tesco',
      product: 'Back Bacon',
    };
    const i = toIngredient(candidate, 'streaky bacon rashers', 'id-1');
    expect(i.name).toBe('Bacon'); // the memory's own name, not "Streaky bacon rashers"
    expect(i.brand).toBe('Tesco');
    expect(i.product).toBe('Back Bacon');
    expect(i.source).toBe('label'); // the memory's own source rides along too
    expect(i.foodKey).toBe('memory:p:tesco back bacon');
  });
});

