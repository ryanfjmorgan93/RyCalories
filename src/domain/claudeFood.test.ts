import { describe, expect, it } from 'vitest';
import {
  densitiesAgree,
  isEstimate,
  itemFromReading,
  itemsFromReadings,
  knownFood,
  loggedLine,
  per100Of,
  readingConfidence,
  readingSummary,
  singularUnit,
  type ReadItem,
} from './claudeFood';
import { macrosOf, type Macros } from './food';
import { matchIngredient, type FoodAlias, type MatchSources, type TableFood } from './ingredientMatch';
import type { FoodMemory } from './types';

const EGG: Macros = { kcal: 131, protein: 12.6, carbs: 0.8, fat: 9.5 };
const RAW_RICE: Macros = { kcal: 360, protein: 7, carbs: 79, fat: 0.6 };
const CHICKEN: Macros = { kcal: 106, protein: 24, carbs: 0, fat: 1.1 };

const FOODS: TableFood[] = [
  { code: '17-001', name: 'Eggs, chicken, whole, raw', per100: EGG },
  { code: '20-001', name: 'Rice, white, basmati, raw', per100: RAW_RICE },
  { code: '18-001', name: 'Chicken, breast, skinless, raw', per100: CHICKEN },
  { code: '18-002', name: 'Chicken, roast, meat only', per100: { kcal: 177, protein: 27, carbs: 0, fat: 7.5 } },
];

const ALIASES: FoodAlias[] = [
  { words: ['egg', 'eggs'], code: '17-001', unit: { label: 'egg', plural: 'eggs', grams: 50 } },
  { words: ['rice'], code: '20-001' },
  { words: ['chicken breast'], code: '18-001' },
];

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'm1',
    key: 'n:porridge oats',
    name: 'Porridge oats',
    per100: { kcal: 379, protein: 11, carbs: 60, fat: 8 },
    source: 'user',
    timesUsed: 5,
    lastUsedAt: '2026-10-01T08:00:00.000Z',
    ...over,
  };
}

const sources = (memories: FoodMemory[] = []): MatchSources => ({ foods: FOODS, aliases: ALIASES, memories });

function reading(over: Partial<ReadItem> = {}): ReadItem {
  return { name: 'Sourdough toast', amount: 2, unit: 'slices', grams: 80, kcal: 210, protein: 8, carbs: 40, fat: 1, confidence: 'medium', ...over };
}

describe('a food the app does not know', () => {
  it("takes Claude's figures as the least-trusted source, counted in Claude's own unit and marked as an estimate", () => {
    const item = itemFromReading(reading(), sources());
    expect(item.source).toBe('model');
    expect(item.name).toBe('Sourdough toast');
    expect(item.portion).toBe('≈ 2 slices (80 g)');
    expect(item.nutrition).toMatchObject({ basis: 'weighed', grams: 80 });
    // The whole amount is exactly what Claude said it was.
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(210, 6);
    expect(macrosOf(item.nutrition).protein).toBeCloseTo(8, 6);
    // 80 g over two slices: the unit weight a model memory can offer next time.
    expect(item.unit).toEqual({ count: 2, unitGrams: 40, label: 'slice', plural: 'slices' });
    expect(isEstimate(item)).toBe(true);
  });

  it('counts in grams when Claude did', () => {
    const item = itemFromReading(reading({ name: 'Cooked mince', amount: 150, unit: 'g', grams: 150, kcal: 330 }), sources());
    expect(item.portion).toBe('≈ 150 g');
    expect(item.unit).toBeUndefined();
  });

  it('says one of a unit in the singular and several in the plural', () => {
    expect(itemFromReading(reading({ amount: 1, unit: 'slice', grams: 40, kcal: 105 }), sources()).portion).toBe('≈ 1 slice (40 g)');
    expect(itemFromReading(reading({ amount: 0.5, unit: 'bowl', grams: 150, kcal: 200 }), sources()).portion).toBe('≈ ½ bowl (150 g)');
  });

  it('keeps the whole amount as a portion when Claude gave no weight', () => {
    const item = itemFromReading(reading({ name: 'Latte', amount: 1, unit: 'mug', grams: 0, kcal: 120, protein: 7, carbs: 10, fat: 5 }), sources());
    expect(item.source).toBe('model');
    expect(item.nutrition).toEqual({ basis: 'portion', macros: { kcal: 120, protein: 7, carbs: 10, fat: 5 } });
    expect(item.portion).toBe('≈ 1 mug');
  });

  it('works out per 100 g only when there is a weight', () => {
    expect(per100Of(reading())).toEqual({ kcal: 262.5, protein: 10, carbs: 50, fat: 1.25 });
    expect(per100Of(reading({ grams: 0 }))).toBeNull();
  });
});

describe('a food the owner already has', () => {
  it("keeps the owner's own figures and source, with Claude's weight as the amount", () => {
    const own = memory();
    const item = itemFromReading(reading({ name: 'Porridge oats', amount: 1, unit: 'bowl', grams: 60, kcal: 190, protein: 5, carbs: 30, fat: 4 }), sources([own]));
    expect(item.source).toBe('user');
    expect(item.nutrition).toEqual({ basis: 'weighed', grams: 60, per100: own.per100 });
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(227.4, 6);
    // The amount is still Claude's estimate, and says so.
    expect(item.portion).toBe('≈ 1 bowl (60 g)');
    expect(isEstimate(item)).toBe(true);
  });

  it("does not teach a food that is known its unit weight from Claude's guess", () => {
    const item = itemFromReading(reading({ name: 'Porridge oats', amount: 1, unit: 'bowl', grams: 60 }), sources([memory({ packGrams: 1000 })]));
    expect(item.unit).toBeUndefined();
    expect(item.units).toEqual({ packGrams: 1000 });
  });

  it('keeps a label figure over Claude when the two describe the same food, even if they differ a little', () => {
    const label = memory({ key: 'p:fage total 0', name: 'Fage Total 0%', brand: 'Fage', product: 'Total 0%', per100: { kcal: 54, protein: 10, carbs: 4, fat: 0.2 }, source: 'label' });
    // Claude's 100 kcal over 170 g is 59 per 100 g: the label's 54 stands.
    const item = itemFromReading(reading({ name: 'Fage Total 0%', amount: 1, unit: 'tub', grams: 170, kcal: 100 }), sources([label]));
    expect(item.source).toBe('label');
    expect((item.nutrition as { per100: Macros }).per100.kcal).toBe(54);
  });

  // Finding 7: the raw-against-cooked guard used to run only for the table, so the owner's own raw
  // "Rice" (360 kcal per 100 g) took Claude's 180 g of cooked rice at face value: ~648 kcal for a
  // plate that is ~235.
  describe('when the owner\'s food is a different state of it from the one Claude saw', () => {
    const rawRice = () => memory({ key: 'n:rice', name: 'Rice', per100: RAW_RICE, source: 'user', typicalGrams: 75 });
    const cookedPlate = () => reading({ name: 'Rice', amount: 1, unit: 'bowl', grams: 180, kcal: 234, protein: 5, carbs: 52, fat: 0.5 });

    it("uses Claude's estimate for that food instead of the owner's raw figures", () => {
      const item = itemFromReading(cookedPlate(), sources([rawRice()]));
      expect(item.source).toBe('model');
      expect(item.portion).toBe('≈ 1 bowl (180 g)');
      expect(macrosOf(item.nutrition).kcal).toBeCloseTo(234, 6);
      expect(knownFood(cookedPlate(), sources([rawRice()]))).toBeNull();
    });

    it("keeps the estimate out of the owner's remembered food", () => {
      // The estimate must not teach the raw rice a 180 g portion or a bowl.
      expect(itemFromReading(cookedPlate(), sources([rawRice()]))).toMatchObject({ remember: false });
    });

    it('still uses the owner\'s figures when Claude saw the same state of the food', () => {
      // 60 g of dry rice: 216 kcal is 360 per 100 g.
      const dry = reading({ name: 'Rice', amount: 60, unit: 'g', grams: 60, kcal: 216, protein: 4, carbs: 47, fat: 0.4 });
      const item = itemFromReading(dry, sources([rawRice()]));
      expect(item.source).toBe('user');
      expect(macrosOf(item.nutrition).kcal).toBeCloseTo(216, 6);
      expect(item).not.toHaveProperty('remember');
    });

    it('applies to a label too: a pack of dry pasta is not a bowl of cooked pasta', () => {
      const dryPasta = memory({ key: 'p:tesco fusilli', name: 'Tesco Fusilli', brand: 'Tesco', product: 'Fusilli', per100: { kcal: 352, protein: 12, carbs: 71, fat: 1.5 }, source: 'label' });
      const bowl = reading({ name: 'Tesco Fusilli', amount: 1, unit: 'bowl', grams: 220, kcal: 330, protein: 11, carbs: 66, fat: 2 });
      const item = itemFromReading(bowl, sources([dryPasta]));
      expect(item.source).toBe('model');
      expect(macrosOf(item.nutrition).kcal).toBeCloseTo(330, 6);
      expect(item).toMatchObject({ remember: false });
    });

    it('does not reach a remembered estimate or a plain unmatched food: they remember as before', () => {
      expect(itemFromReading(reading(), sources())).not.toHaveProperty('remember');
      const old = memory({ key: 'n:sourdough toast', name: 'Sourdough toast', per100: { kcal: 300, protein: 9, carbs: 55, fat: 3 }, source: 'model' });
      expect(itemFromReading(reading(), sources([old]))).not.toHaveProperty('remember');
    });
  });

  it("prefers the owner's remembered egg weight when Claude counted eggs", () => {
    // The owner's eggs are 60 g, not the table's 50.
    const eggs = memory({ key: 'n:egg', name: 'Egg', per100: EGG, source: 'user', unitGrams: 60, unitLabel: 'egg', unitPlural: 'eggs' });
    const item = itemFromReading(reading({ name: 'Egg', amount: 2, unit: 'eggs', grams: 110, kcal: 160 }), sources([eggs]));
    expect(item.source).toBe('user');
    expect(item.portion).toBe('≈ 2 eggs (120 g)');
    expect(item.nutrition).toMatchObject({ grams: 120 });
  });
});

describe('a food in the UK table', () => {
  it("uses the table's figures and its own egg weight for a count it knows", () => {
    const item = itemFromReading(reading({ name: 'Egg', amount: 2, unit: 'eggs', grams: 110, kcal: 160, protein: 13, carbs: 1, fat: 11 }), sources());
    expect(item.source).toBe('table');
    expect(item.name).toBe('Eggs, chicken, whole, raw');
    expect(item.portion).toBe('≈ 2 eggs (100 g)');
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(131 * 1, 6);
    expect(isEstimate(item)).toBe(true);
  });

  it("falls back to Claude's weight when its count is at odds with the table's unit weight", () => {
    // "2 eggs" at 50 g is 100 g; Claude saw 250 g, so it was not two ordinary eggs.
    const item = itemFromReading(reading({ name: 'Eggs', amount: 2, unit: 'eggs', grams: 250, kcal: 330 }), sources());
    expect(item.source).toBe('table');
    expect(item.nutrition).toMatchObject({ grams: 250 });
  });

  it('does not take a raw row for a cooked food', () => {
    // Same word, "rice", but 360 kcal against 130 per 100 g: cooked rice is not raw rice.
    const rice = reading({ name: 'Rice', amount: 1, unit: 'cup', grams: 150, kcal: 195, protein: 4, carbs: 43, fat: 0.4 });
    expect(knownFood(rice, sources())).toBeNull();
    expect(itemFromReading(rice, sources()).source).toBe('model');
  });

  it('does not take a loose word match that leaves out words Claude used', () => {
    // "Chicken" alone scores well enough against "Chicken curry" to be found, but it is not curry.
    const plain: MatchSources = { ...sources(), foods: [...FOODS, { code: '18-009', name: 'Chicken', per100: CHICKEN }] };
    const curry = reading({ name: 'Chicken curry', amount: 1, unit: 'bowl', grams: 300, kcal: 450, protein: 30, carbs: 20, fat: 28 });
    expect(matchIngredient(curry.name, plain).best?.name).toBe('Chicken');
    expect(knownFood(curry, plain)).toBeNull();
    // Every word of the name found in the row is a match.
    const roast = reading({ name: 'Roast chicken', amount: 1, unit: 'portion', grams: 150, kcal: 266, protein: 40, carbs: 0, fat: 11 });
    expect(knownFood(roast, sources())?.name).toBe('Chicken, roast, meat only');
  });

  it('takes an alias for a name that also fits', () => {
    const chicken = reading({ name: 'Chicken breast', amount: 1, unit: 'fillet', grams: 150, kcal: 165, protein: 36, carbs: 0, fat: 2 });
    expect(knownFood(chicken, sources())?.source).toBe('table');
  });
});

describe('a remembered estimate', () => {
  it("is no better than Claude's fresh one, so the fresh one is used", () => {
    const old = memory({ key: 'n:sourdough toast', name: 'Sourdough toast', per100: { kcal: 300, protein: 9, carbs: 55, fat: 3 }, source: 'model' });
    const item = itemFromReading(reading(), sources([old]));
    expect(item.source).toBe('model');
    expect((item.nutrition as { per100: Macros }).per100.kcal).toBeCloseTo(262.5, 6);
  });
});

describe('a whole plate', () => {
  it('is one item per food, each its own way', () => {
    const items = itemsFromReadings(
      [
        reading({ name: 'Egg', amount: 2, unit: 'eggs', grams: 100, kcal: 150 }),
        reading({ name: 'Sourdough toast' }),
        reading({ name: 'Porridge oats', amount: 40, unit: 'g', grams: 40, kcal: 150 }),
      ],
      sources([memory()]),
    );
    expect(items.map((i) => i.source)).toEqual(['table', 'model', 'user']);
    expect(items.every(isEstimate)).toBe(true);
  });
});

describe('the pieces', () => {
  it('finds the singular of a unit word', () => {
    expect(singularUnit('slices')).toBe('slice');
    expect(singularUnit('Eggs')).toBe('egg');
    expect(singularUnit('glasses')).toBe('glass');
    expect(singularUnit('sandwiches')).toBe('sandwich');
    expect(singularUnit('potatoes')).toBe('potato');
    expect(singularUnit('strawberries')).toBe('strawberry');
    expect(singularUnit('tbsp')).toBe('tbsp');
    expect(singularUnit('bowl')).toBe('bowl');
  });

  it('judges energy densities by ratio, and by the gap for light foods', () => {
    expect(densitiesAgree(131, 150)).toBe(true);
    expect(densitiesAgree(360, 130)).toBe(false);
    // 8 against 25 kcal per 100 g is a factor of three and a trifle.
    expect(densitiesAgree(8, 25)).toBe(true);
    expect(densitiesAgree(100, 200)).toBe(false);
  });

  it('is as confident as its least confident item', () => {
    expect(readingConfidence([{ confidence: 'high' }, { confidence: 'medium' }])).toBe('medium');
    expect(readingConfidence([{ confidence: 'high' }, { confidence: 'low' }, { confidence: 'medium' }])).toBe('low');
    expect(readingConfidence([{ confidence: 'high' }])).toBe('high');
  });

  it('summarises the foods in a few words', () => {
    expect(readingSummary([{ name: 'Scrambled eggs' }, { name: ' Wholemeal toast ' }])).toBe('Scrambled eggs, Wholemeal toast');
    expect(readingSummary([{ name: 'A long name'.repeat(20) }], 40)).toHaveLength(40);
    expect(readingSummary([{ name: 'A long name'.repeat(20) }], 40).endsWith('…')).toBe(true);
  });

  it('says what was logged, with the mark', () => {
    expect(loggedLine(3, 'dinner', 639.6)).toBe('Logged 3 items to Dinner · 640 kcal ≈');
    expect(loggedLine(1, 'snack', 90)).toBe('Logged 1 item to Snack · 90 kcal ≈');
  });

  it('calls an item an estimate by its source or by its amount', () => {
    expect(isEstimate({ source: 'model', portion: '2 slices (80 g)' })).toBe(true);
    expect(isEstimate({ source: 'table', portion: '≈ 2 eggs (100 g)' })).toBe(true);
    expect(isEstimate({ source: 'table', portion: '2 eggs (100 g)' })).toBe(false);
    expect(isEstimate({ portion: '1 bowl' })).toBe(false);
  });
});
