import { describe, expect, it } from 'vitest';
import { mergeByFood, matchIngredient, type FoodAlias, type IngredientCandidate, type TableFood } from './ingredientMatch';
import type { Macros } from './food';
import type { FoodMemory } from './types';

const EGG: Macros = { kcal: 131, protein: 12.6, carbs: 0.8, fat: 9.5 };
const BACON: Macros = { kcal: 215, protein: 16.5, carbs: 0, fat: 17 };
const BACON_STREAKY: Macros = { kcal: 276, protein: 15, carbs: 0, fat: 24 };
const CHEDDAR: Macros = { kcal: 416, protein: 25.4, carbs: 0.1, fat: 34.9 };
const BREAD: Macros = { kcal: 219, protein: 9.4, carbs: 41.5, fat: 1.7 };

const FOODS: TableFood[] = [
  { code: '17-001', name: 'Eggs, chicken, whole, raw', per100: EGG },
  { code: '17-002', name: 'Bacon rashers, back, raw', per100: BACON },
  { code: '17-003', name: 'Bacon rashers, streaky, raw', per100: BACON_STREAKY },
  { code: '12-001', name: 'Cheese, Cheddar, English', per100: CHEDDAR },
  { code: '11-001', name: 'Bread, white, sliced', per100: BREAD },
];

const ALIASES: FoodAlias[] = [
  { words: ['egg', 'eggs'], code: '17-001', unit: { label: 'egg', plural: 'eggs', grams: 50 } },
  { words: ['bacon'], code: '17-002', unit: { label: 'rasher', plural: 'rashers', grams: 25 } },
];

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'm1',
    key: 'n:home chilli',
    name: 'Home chilli',
    per100: { kcal: 180, protein: 12, carbs: 10, fat: 9 },
    source: 'user',
    timesUsed: 3,
    lastUsedAt: '2026-03-01T08:00:00.000Z',
    ...over,
  };
}

describe('matching against a curated alias', () => {
  it('matches the exact word', () => {
    const { best } = matchIngredient('egg', { aliases: ALIASES, foods: FOODS, memories: [] });
    expect(best).not.toBeNull();
    expect(best!.key).toBe('table:17-001');
    expect(best!.source).toBe('table');
    expect(best!.name).toBe('Eggs, chicken, whole, raw');
    expect(best!.unit).toEqual({ label: 'egg', plural: 'eggs', grams: 50 });
  });

  it('matches singular and plural forms of the alias word the same way', () => {
    const a = matchIngredient('egg', { aliases: ALIASES, foods: FOODS, memories: [] });
    const b = matchIngredient('eggs', { aliases: ALIASES, foods: FOODS, memories: [] });
    expect(a.best?.key).toBe(b.best?.key);
  });

  it('returns no alternatives for a decisive alias match', () => {
    const { alternatives } = matchIngredient('bacon', { aliases: ALIASES, foods: FOODS, memories: [] });
    expect(alternatives).toEqual([]);
  });

  it('falls through to the next order step when the alias points at a code not in the table', () => {
    const danglingAliases: FoodAlias[] = [{ words: ['mystery'], code: 'does-not-exist' }];
    const { best } = matchIngredient('mystery', { aliases: danglingAliases, foods: FOODS, memories: [] });
    expect(best).toBeNull(); // no memory and no token match for "mystery" either
  });
});

describe('matching against food memory', () => {
  it('matches a remembered food by its exact normalised name', () => {
    const { best } = matchIngredient('home chilli', { aliases: [], foods: FOODS, memories: [memory()] });
    expect(best).not.toBeNull();
    expect(best!.key).toBe('memory:n:home chilli');
    expect(best!.source).toBe('user'); // the memory's own source, not a fixed badge
  });

  it('is preferred over a table token search when both would match', () => {
    // "cheddar cheese" also token-matches "Cheese, Cheddar, English" in the table (see the
    // token-search test below) — the memory must win regardless.
    const cheddarMemory = memory({ id: 'm2', key: 'n:cheddar cheese', name: 'Cheddar cheese', per100: { kcal: 400, protein: 24, carbs: 1, fat: 33 } });
    const { best } = matchIngredient('cheddar cheese', { aliases: [], foods: FOODS, memories: [cheddarMemory] });
    expect(best!.key).toBe('memory:n:cheddar cheese');
    expect(best!.source).toBe('user');
  });

  it('beats a curated alias for the same word when it is at least as trusted as the table', () => {
    // The owner scanned their own bacon: that pack's label is what they cook with, not the table's
    // back-bacon average the alias points at.
    const scanned = memory({ id: 'm3', key: 'p:tesco back bacon', name: 'Bacon', brand: 'Tesco', product: 'Back Bacon', source: 'label', per100: { kcal: 230, protein: 17, carbs: 0.5, fat: 18 } });
    const { best } = matchIngredient('bacon', { aliases: ALIASES, foods: FOODS, memories: [scanned] });
    expect(best!.key).toBe('memory:p:tesco back bacon');
    expect(best!.source).toBe('label');
    expect(best!.per100.kcal).toBe(230);
  });

  it('keeps a corrected unit weight: a table-trust memory of eggs at 55 g beats the alias estimate of 50 g', () => {
    const eggs = memory({ id: 'm7', key: 'n:egg', name: 'Egg', source: 'table', per100: EGG, unitGrams: 55, unitLabel: 'egg', unitPlural: 'eggs' });
    const { best } = matchIngredient('eggs', { aliases: ALIASES, foods: FOODS, memories: [eggs] });
    expect(best!.unit).toEqual({ label: 'egg', plural: 'eggs', grams: 55 });
  });

  it('loses to the alias when it is less trusted than the table, but its learned unit weight still rides along', () => {
    const guessed = memory({ id: 'm8', key: 'n:egg', name: 'Egg', source: 'model', per100: { kcal: 999, protein: 1, carbs: 1, fat: 1 }, unitGrams: 60, unitLabel: 'egg', unitPlural: 'eggs' });
    const { best } = matchIngredient('egg', { aliases: ALIASES, foods: FOODS, memories: [guessed] });
    expect(best!.key).toBe('table:17-001');
    expect(best!.per100.kcal).toBe(131); // the table's figures, not the weaker memory's
    expect(best!.unit).toEqual({ label: 'egg', plural: 'eggs', grams: 60 });
  });

  it('names a remembered unit the way it was learned', () => {
    const bacon = memory({ id: 'm9', key: 'n:bacon', name: 'Bacon', source: 'table', per100: BACON, unitGrams: 28, unitLabel: 'rasher', unitPlural: 'rashers' });
    const { best } = matchIngredient('bacon', { aliases: [], foods: FOODS, memories: [bacon] });
    expect(best!.unit).toEqual({ label: 'rasher', plural: 'rashers', grams: 28 });
  });

  it('borrows the alias unit name for a remembered weight learned without one', () => {
    const eggs = memory({ id: 'm10', key: 'n:egg', name: 'Egg', source: 'user', per100: EGG, unitGrams: 52 });
    const { best } = matchIngredient('egg', { aliases: ALIASES, foods: FOODS, memories: [eggs] });
    expect(best!.unit).toEqual({ label: 'egg', plural: 'eggs', grams: 52 });
  });

  it('builds a unit from unitGrams, labelled with the food\'s own name', () => {
    const withUnit = memory({ id: 'm4', key: 'n:home chilli', unitGrams: 220 });
    const { best } = matchIngredient('home chilli', { aliases: [], foods: FOODS, memories: [withUnit] });
    expect(best!.unit).toEqual({ label: 'Home chilli', plural: 'Home chilli', grams: 220 });
  });

  it('has no unit when the memory never learned one', () => {
    const { best } = matchIngredient('home chilli', { aliases: [], foods: FOODS, memories: [memory()] });
    expect(best!.unit).toBeUndefined();
  });

  it('picks the more established memory when names collide', () => {
    const rare = memory({ id: 'm5', key: 'p:aldi cheddar', name: 'Cheddar', timesUsed: 1, lastUsedAt: '2026-01-01T00:00:00.000Z' });
    const usual = memory({ id: 'm6', key: 'p:trek cheddar', name: 'Cheddar', timesUsed: 20, lastUsedAt: '2026-03-01T00:00:00.000Z' });
    const { best } = matchIngredient('cheddar', { aliases: [], foods: FOODS, memories: [rare, usual] });
    expect(best!.key).toBe('memory:p:trek cheddar');
  });
});

describe('token search over the table', () => {
  it('finds a food by name when there is no alias or memory', () => {
    // A single generic word against a three-word candidate name ("Cheese, Cheddar, English")
    // ties exactly at the threshold and is correctly rejected (see products.ts's own note on
    // why a bare 0.5 must not pass); two shared words clears it.
    const { best } = matchIngredient('cheddar cheese', { aliases: [], foods: FOODS, memories: [] });
    expect(best!.key).toBe('table:12-001');
    expect(best!.source).toBe('table');
    expect(best!.unit).toBeUndefined();
  });

  it('offers alternatives, capped at 5, when more than one food scores above the threshold', () => {
    const { best, alternatives } = matchIngredient('bacon rashers', { aliases: [], foods: FOODS, memories: [] });
    expect(best).not.toBeNull();
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.length).toBeLessThanOrEqual(5);
    // Neither the winner nor an alternative is duplicated.
    const keys = [best!.key, ...alternatives.map((a) => a.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('finds nothing for an unrelated word', () => {
    const { best, alternatives } = matchIngredient('kryptonite', { aliases: [], foods: FOODS, memories: [] });
    expect(best).toBeNull();
    expect(alternatives).toEqual([]);
  });

  it('breaks a tied score by the shorter, more specific name, then by code', () => {
    // Two "bacon rashers" entries score identically against the query "bacon rashers ...";
    // "back" (shorter) must win over "streaky".
    const { best } = matchIngredient('bacon rashers raw', { aliases: [], foods: FOODS, memories: [] });
    expect(best!.name).toBe('Bacon rashers, back, raw');
  });

  it('is deterministic regardless of the table\'s row order', () => {
    const reversed = [...FOODS].reverse();
    const a = matchIngredient('bacon rashers raw', { aliases: [], foods: FOODS, memories: [] });
    const b = matchIngredient('bacon rashers raw', { aliases: [], foods: reversed, memories: [] });
    expect(a.best?.key).toBe(b.best?.key);
  });
});

describe('mergeByFood', () => {
  it('merges two recognised names that resolve to the same candidate', () => {
    const eggCandidate: IngredientCandidate = { key: 'table:17-001', name: 'Eggs, chicken, whole, raw', per100: EGG, source: 'table' };
    const { merged, unmatched } = mergeByFood([
      { name: 'egg', candidate: eggCandidate },
      { name: 'eggs', candidate: eggCandidate },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.names).toEqual(['egg', 'eggs']);
    expect(unmatched).toEqual([]);
  });

  it('keeps distinct candidates separate', () => {
    const egg: IngredientCandidate = { key: 'table:17-001', name: 'Eggs, chicken, whole, raw', per100: EGG, source: 'table' };
    const bacon: IngredientCandidate = { key: 'table:17-002', name: 'Bacon rashers, back, raw', per100: BACON, source: 'table' };
    const { merged } = mergeByFood([
      { name: 'egg', candidate: egg },
      { name: 'bacon', candidate: bacon },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('collects unmatched names separately, in order', () => {
    const { merged, unmatched } = mergeByFood([
      { name: 'salt', candidate: null },
      { name: 'pepper', candidate: null },
    ]);
    expect(merged).toEqual([]);
    expect(unmatched).toEqual(['salt', 'pepper']);
  });
});
