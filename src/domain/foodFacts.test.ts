import { describe, expect, it } from 'vitest';
import { fromPer100, fromPortion } from './food';
import { dayCommentDue, dayMomentFacts, mealMomentFacts, type FactMeal } from './foodFacts';

const dinner: FactMeal = {
  meal: { name: 'Dinner', slot: 'dinner' },
  items: [
    { name: 'Chicken breast', portion: '≈ 1 fillet (150 g)', nutrition: fromPer100({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, 150), source: 'table' },
    { name: 'Basmati rice', portion: '≈ 1 bowl (200 g)', nutrition: fromPer100({ kcal: 130, protein: 3, carbs: 28, fat: 0.3 }, 200), source: 'model' },
  ],
};
const day = { eaten: { kcal: 1480, protein: 120.4, carbs: 150, fat: 50 }, kcalTarget: 2400, proteinTarget: 160 };

describe('the facts for a meal just logged', () => {
  it('lists the foods with their amounts and calories, the meal totals and the day against its targets', () => {
    const f = mealMomentFacts(dinner, day);
    expect(f.meal).toBe('dinner');
    expect(f.foods).toEqual(['Chicken breast: ≈ 1 fillet (150 g), 248 kcal', 'Basmati rice: ≈ 1 bowl (200 g), 260 kcal']);
    expect(f['meal kcal']).toBe(508);
    expect(f['meal protein g']).toBe(53);
    expect(f['day so far kcal']).toBe(1480);
    expect(f['day so far protein g']).toBe(120);
    expect(f['calorie target']).toBe(2400);
    expect(f['protein target g']).toBe(160);
  });

  it('says once that some figures are estimates, and not when none are', () => {
    expect(mealMomentFacts(dinner, day).figures).toContain('estimates');
    const exact: FactMeal = {
      meal: { name: 'Snack', slot: 'snack' },
      items: [{ name: 'Apple', portion: '1 apple (180 g)', nutrition: fromPortion({ kcal: 95, protein: 0, carbs: 25, fat: 0 }), source: 'user' }],
    };
    expect(mealMomentFacts(exact, day).figures).toBeUndefined();
  });

  it('leaves out a target the settings do not have, and keeps a long meal short', () => {
    const many: FactMeal = {
      meal: { name: 'Buffet' },
      items: Array.from({ length: 11 }, (_, i) => ({ name: `Item ${i}`, portion: '1 portion', nutrition: fromPortion({ kcal: 10, protein: 1, carbs: 1, fat: 0 }) })),
    };
    const f = mealMomentFacts(many, { eaten: day.eaten, kcalTarget: null, proteinTarget: null });
    expect(f.meal).toBe('Buffet');
    expect(f['calorie target']).toBeUndefined();
    expect(f['protein target g']).toBeUndefined();
    expect((f.foods as string[]).length).toBe(9);
    expect((f.foods as string[]).at(-1)).toBe('and 3 more');
  });
});

describe('the facts for the day', () => {
  const breakfast: FactMeal = {
    meal: { name: 'Breakfast', slot: 'breakfast' },
    items: [{ name: 'Oats', portion: '60 g', nutrition: fromPer100({ kcal: 379, protein: 11, carbs: 60, fat: 8 }, 60), source: 'user' }],
  };

  it('gives the totals against the targets, what is left, and each meal in a line', () => {
    const f = dayMomentFacts([breakfast, dinner], day);
    expect(f.meals).toEqual(['breakfast: 227 kcal (Oats)', 'dinner: 508 kcal (Chicken breast, Basmati rice)']);
    expect(f['eaten kcal']).toBe(1480);
    expect(f['calories left (negative is over)']).toBe(920);
    expect(f.figures).toContain('estimates');
  });

  it('carries no clock, so asking again a minute later is the same question', () => {
    expect(JSON.stringify(dayMomentFacts([breakfast], day))).not.toMatch(/\d\d:\d\d/);
  });

  it('is due from eight in the evening, on today, once something is logged', () => {
    const at = (h: number) => new Date(2026, 9, 12, h, 0, 0);
    expect(dayCommentDue({ isToday: true, now: at(19), mealCount: 2 })).toBe(false);
    expect(dayCommentDue({ isToday: true, now: at(20), mealCount: 2 })).toBe(true);
    expect(dayCommentDue({ isToday: true, now: at(22), mealCount: 0 })).toBe(false);
    expect(dayCommentDue({ isToday: false, now: at(22), mealCount: 3 })).toBe(false);
  });
});
