import { describe, expect, it } from 'vitest';
import { fromPer100, fromPortion } from './food';
import { mealSignature, usualsFor, type PastMeal, type UsualItem, type UsualMeal } from './usualMeals';

const oats = (grams = 80): UsualItem => ({ name: 'Porridge oats', portion: `${grams} g`, nutrition: fromPer100({ kcal: 379, protein: 11, carbs: 60, fat: 8 }, grams), source: 'label' });
const whey: UsualItem = { name: 'Whey protein', portion: '1 scoop', nutrition: fromPortion({ kcal: 120, protein: 24, carbs: 3, fat: 1.5 }), source: 'user' };
const chicken: UsualItem = { name: 'Chicken thigh', portion: '250 g', nutrition: fromPer100({ kcal: 209, protein: 26, carbs: 0, fat: 11 }, 250), source: 'label' };

const breakfast: PastMeal = { name: 'Breakfast', slot: 'breakfast', items: [oats(), whey] };
const bigBreakfast: PastMeal = { name: 'Breakfast', slot: 'breakfast', items: [oats(120), whey] };
const lunch: PastMeal = { name: 'Lunch', slot: 'lunch', items: [chicken] };

describe('mealSignature', () => {
  it('is the name and the foods with their amounts, whatever the case', () => {
    expect(mealSignature(' breakfast ', [oats(), whey])).toBe(mealSignature('Breakfast', [oats(), whey]));
    expect(mealSignature('Breakfast', [oats(), whey])).not.toBe(mealSignature('Breakfast', [oats(120), whey]));
    expect(mealSignature('Breakfast', [oats()])).not.toBe(mealSignature('Brunch', [oats()]));
  });
});

describe('usualsFor', () => {
  it('offers a meal logged twice in the slot, and not one logged once', () => {
    const offered = usualsFor('breakfast', [], [breakfast, bigBreakfast, breakfast]);
    expect(offered.map((o) => o.key)).toEqual([mealSignature('Breakfast', breakfast.items)]);
    expect(offered[0]!.savedId).toBeUndefined();
  });

  it('keeps to the slot asked for', () => {
    expect(usualsFor('lunch', [], [breakfast, breakfast, lunch])).toEqual([]);
    expect(usualsFor('lunch', [], [lunch, breakfast, lunch]).map((o) => o.name)).toEqual(['Lunch']);
  });

  it('puts the most often first, and the more recent of a tie first', () => {
    const history = [bigBreakfast, breakfast, breakfast, bigBreakfast, breakfast];
    expect(usualsFor('breakfast', [], history).map((o) => o.items[0]!.portion)).toEqual(['80 g', '120 g']);
    expect(usualsFor('breakfast', [], [bigBreakfast, breakfast, breakfast, bigBreakfast]).map((o) => o.items[0]!.portion)).toEqual(['120 g', '80 g']);
  });

  it('leads with the saved ones for the slot, a slotless one included, and does not repeat them from the history', () => {
    const saved: UsualMeal[] = [
      { id: 'a', name: 'Lunch', slot: 'lunch', items: [chicken] },
      { id: 'b', name: 'Shake', items: [whey] },
      { id: 'c', name: 'Breakfast', slot: 'breakfast', items: [oats(), whey] },
    ];
    const offered = usualsFor('breakfast', saved, [breakfast, breakfast, bigBreakfast, bigBreakfast]);
    expect(offered.map((o) => [o.name, o.savedId])).toEqual([
      ['Shake', 'b'],
      ['Breakfast', 'c'],
      ['Breakfast', undefined],
    ]);
    expect(offered[2]!.items[0]!.portion).toBe('120 g');
  });

  it('does not offer what is already on the day, and stops at the limit', () => {
    const skip = new Set([mealSignature('Breakfast', breakfast.items)]);
    expect(usualsFor('breakfast', [], [breakfast, breakfast, bigBreakfast, bigBreakfast], skip).map((o) => o.items[0]!.portion)).toEqual(['120 g']);
    expect(usualsFor('breakfast', [{ id: 'c', name: 'Breakfast', slot: 'breakfast', items: [oats(), whey] }], [], skip)).toEqual([]);
    expect(usualsFor('breakfast', [], [breakfast, breakfast, bigBreakfast, bigBreakfast], new Set(), 1)).toHaveLength(1);
  });

  it('ignores an empty meal', () => {
    const empty: PastMeal = { name: 'Snack', slot: 'snack', items: [] };
    expect(usualsFor('snack', [], [empty, empty])).toEqual([]);
  });
});
