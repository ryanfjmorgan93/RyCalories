import { describe, expect, it } from 'vitest';
import { memoryFrom, memoryKey, mergeMemory, normalise, rankMemories } from './foodMemory';
import { fromPer100, fromPortion, weigh, type Macros } from './food';
import type { FoodMemory, MealItem } from './types';

const OATS: Macros = { kcal: 379, protein: 11, carbs: 60, fat: 8 };

function item(over: Partial<MealItem> = {}): MealItem {
  return {
    id: 'i1',
    mealId: 'm1',
    index: 0,
    name: 'Porridge oats',
    portion: '80 g',
    source: 'user',
    nutrition: fromPer100(OATS, 80),
    ...over,
  };
}

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'f1',
    key: 'n:porridge oats',
    name: 'Porridge oats',
    per100: OATS,
    source: 'user',
    timesUsed: 1,
    lastUsedAt: '2026-03-01T08:00:00.000Z',
    ...over,
  };
}

describe('normalising text', () => {
  it('reduces a name to its identifying words', () => {
    expect(normalise("Nature's Way — Oats!")).toBe('nature s way oats');
  });

  it('folds accents so the same food is one food', () => {
    expect(normalise('Crème Fraîche')).toBe(normalise('Creme Fraiche'));
  });

  it('is empty for text with nothing in it', () => {
    expect(normalise('   —  ')).toBe('');
  });
});

describe('what counts as the same food', () => {
  it('keys a packaged product on its brand and product', () => {
    expect(memoryKey({ name: 'Flapjack', brand: 'Trek', product: 'Protein Flapjack' })).toBe('p:trek protein flapjack');
  });

  it('keys anything unbranded on its name', () => {
    expect(memoryKey({ name: 'Chicken thigh' })).toBe('n:chicken thigh');
  });

  it('treats the same food typed differently as the same food', () => {
    expect(memoryKey({ name: 'chicken  thigh' })).toBe(memoryKey({ name: 'Chicken Thigh!' }));
  });

  it('does not treat a generic brand as packaging', () => {
    // "Homemade" is what a model says when it means "not packaged".
    expect(memoryKey({ name: 'Chilli', brand: 'homemade' })).toBe('n:chilli');
  });

  it('keeps two brands of the same product apart', () => {
    expect(memoryKey({ name: 'Flapjack', brand: 'Trek', product: 'Protein Flapjack' })).not.toBe(
      memoryKey({ name: 'Flapjack', brand: 'Aldi', product: 'Protein Flapjack' }),
    );
  });
});

describe('what is worth remembering', () => {
  it('remembers a weighed food per 100 g, with the portion as a suggestion', () => {
    const m = memoryFrom(item())!;
    expect(m.per100).toEqual(OATS);
    expect(m.typicalGrams).toBe(80);
    expect(m.key).toBe('n:porridge oats');
  });

  it('refuses an unweighed portion rather than inventing a per-100g figure', () => {
    // "1 bowl" says how much was in that bowl and nothing that generalises.
    expect(memoryFrom(item({ nutrition: fromPortion({ kcal: 300, protein: 9, carbs: 48, fat: 6 }) }))).toBeNull();
  });

  it('remembers a portion once it has been weighed', () => {
    const weighed = weigh(fromPortion({ kcal: 300, protein: 9, carbs: 48, fat: 6 }), 80);
    const m = memoryFrom(item({ nutrition: weighed }))!;
    expect(m.per100.kcal).toBeCloseTo(375, 6);
    expect(m.typicalGrams).toBe(80);
  });

  it('refuses a zero-weight portion', () => {
    expect(memoryFrom(item({ nutrition: fromPer100(OATS, 0) }))).toBeNull();
  });
});

describe('folding a new logging into what is remembered', () => {
  const at = '2026-04-01T08:00:00.000Z';

  it('counts the use and moves the suggested portion to the latest one', () => {
    const merged = mergeMemory(memory(), memoryFrom(item({ nutrition: fromPer100(OATS, 65) }))!, at);
    expect(merged.timesUsed).toBe(2);
    expect(merged.typicalGrams).toBe(65);
    expect(merged.lastUsedAt).toBe(at);
  });

  it('lets a label correct a remembered guess', () => {
    const guessed = memory({ source: 'model', per100: { kcal: 300, protein: 5, carbs: 50, fat: 5 } });
    const merged = mergeMemory(guessed, memoryFrom(item({ source: 'label' }))!, at);
    expect(merged.per100).toEqual(OATS);
    expect(merged.source).toBe('label');
  });

  it('never lets a model guess overwrite what the user typed', () => {
    // A remembered guess wearing the same badge as a correction is how a wrong number
    // becomes permanent.
    const corrected = memory({ source: 'user', per100: OATS });
    const merged = mergeMemory(corrected, memoryFrom(item({ source: 'model', nutrition: fromPer100({ kcal: 1, protein: 0, carbs: 0, fat: 0 }, 80) }))!, at);
    expect(merged.per100).toEqual(OATS);
    expect(merged.source).toBe('user');
  });

  it('still counts the use and the portion when it refuses the numbers', () => {
    const corrected = memory({ source: 'user', timesUsed: 3 });
    const merged = mergeMemory(corrected, memoryFrom(item({ source: 'model', nutrition: fromPer100({ kcal: 1, protein: 0, carbs: 0, fat: 0 }, 55) }))!, at);
    expect(merged.timesUsed).toBe(4);
    expect(merged.typicalGrams).toBe(55);
  });

  it('keeps the identity fields it already had when it refuses the numbers', () => {
    const existing = memory({ source: 'label', name: 'Trek Protein Flapjack', brand: 'Trek' });
    const merged = mergeMemory(existing, memoryFrom(item({ source: 'model', name: 'flapjack thing' }))!, at);
    expect(merged.name).toBe('Trek Protein Flapjack');
    expect(merged.brand).toBe('Trek');
  });
});

describe('ranking for the search box', () => {
  const porridge = memory({ key: 'n:porridge oats', name: 'Porridge oats', timesUsed: 40, lastUsedAt: '2026-03-10T08:00:00.000Z' });
  const oatMilk = memory({ id: 'f2', key: 'n:oat milk', name: 'Oat milk', timesUsed: 1, lastUsedAt: '2026-03-02T08:00:00.000Z' });
  const chicken = memory({ id: 'f3', key: 'n:chicken thigh', name: 'Chicken thigh', timesUsed: 10, lastUsedAt: '2026-03-09T08:00:00.000Z' });
  const all = [oatMilk, chicken, porridge];

  it('with no query, offers what is eaten most and most recently', () => {
    expect(rankMemories('', all).map((r) => r.memory.name)).toEqual(['Porridge oats', 'Chicken thigh', 'Oat milk']);
  });

  it('matches on a word and leaves out what does not match', () => {
    expect(rankMemories('oat', all).map((r) => r.memory.name)).toEqual(['Porridge oats', 'Oat milk']);
  });

  it('finds a plural by its singular, so a staple is not demoted to a prefix match', () => {
    // "oat" must match "Porridge oats" as a whole word. Treating it as a mere prefix would put
    // the oat milk bought once above the porridge eaten every morning.
    expect(rankMemories('oat', all)[0]?.memory.name).toBe('Porridge oats');
    expect(rankMemories('oats', all)[0]?.memory.name).toBe('Porridge oats');
  });

  it('puts an exact word above a prefix, however familiar the other food is', () => {
    const chick = memory({ id: 'f5', key: 'n:chick', name: 'Chick', timesUsed: 0, lastUsedAt: '2026-01-01T00:00:00.000Z' });
    // Chicken thigh is eaten ten times and only prefix-matches; "Chick" matches exactly.
    expect(rankMemories('chick', [chicken, chick])[0]?.memory.name).toBe('Chick');
  });

  it('requires every word of the query to match something', () => {
    expect(rankMemories('porridge chicken', all)).toEqual([]);
  });

  it('finds a food by its brand', () => {
    const trek = memory({ id: 'f4', key: 'p:trek protein flapjack', name: 'Protein Flapjack', brand: 'Trek' });
    expect(rankMemories('trek', [...all, trek]).map((r) => r.memory.name)).toEqual(['Protein Flapjack']);
  });

  it('never lets familiarity outrank a better text match', () => {
    // Porridge is eaten 40 times to the chicken's 10, but "chick" is not in it.
    expect(rankMemories('chick', all).map((r) => r.memory.name)).toEqual(['Chicken thigh']);
  });

  it('is stable and bounded', () => {
    expect(rankMemories('', all, 2).map((r) => r.memory.name)).toEqual(['Porridge oats', 'Chicken thigh']);
    expect(rankMemories('', [...all].reverse()).map((r) => r.memory.name)).toEqual(rankMemories('', all).map((r) => r.memory.name));
  });

  it('copes with nothing remembered yet', () => {
    expect(rankMemories('oat', [])).toEqual([]);
  });
});
