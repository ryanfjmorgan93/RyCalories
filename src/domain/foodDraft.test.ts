import { describe, expect, it } from 'vitest';
import { applyLabel, applyMemory, blankDraft, draftFrom, draftToItem, editAmount, editNutrition, nutritionFrom } from './foodDraft';
import { fromPer100, fromPortion, macrosOf } from './food';
import { unitOptions } from './foodUnits';
import type { LabelNutrition } from './products';
import type { FoodMemory } from './types';

const FLAPJACK: LabelNutrition = {
  code: '5901234123457',
  brand: 'Trek',
  name: 'Protein Flapjack',
  per100: { kcal: 400, protein: 20, carbs: 45, fat: 15 },
  servingGrams: 50,
};

const CHICKEN: LabelNutrition = {
  code: '5000000000001',
  brand: 'Tesco',
  name: 'Chicken Breast Fillets',
  per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  packGrams: 400,
};

const scanned = (l: LabelNutrition) => applyLabel(blankDraft(), l, { fromScan: true });
const optionsOf = (d: ReturnType<typeof scanned>) => unitOptions({ ...(d.packGrams ? { packGrams: d.packGrams } : {}), ...(d.servingGrams ? { servingGrams: d.servingGrams } : {}) });

describe('what counts as the user’s own data', () => {
  it('a scanned label is the label’s', () => {
    const d = scanned(FLAPJACK);
    expect(d).toMatchObject({ source: 'label', fromLabel: true, grams: 50, kcal: 400 });
  });

  it('editing the weight of a scanned label keeps it a label’s', () => {
    const d = editAmount(scanned(FLAPJACK), { grams: 120, unitKey: 'g' });
    expect(d).toMatchObject({ source: 'label', fromLabel: true, grams: 120, kcal: 400 });
    expect(draftToItem(d, { options: optionsOf(d) }).source).toBe('label');
  });

  it('tapping a unit chip keeps it a label’s too', () => {
    const d = editAmount(scanned(CHICKEN), { grams: 200, unitKey: 'pack' });
    expect(d.source).toBe('label');
    expect(d.fromLabel).toBe(true);
  });

  it('editing the portion text keeps the source', () => {
    const d = editAmount({ ...draftFrom({ name: 'Soup', portion: '1 bowl', nutrition: fromPortion({ kcal: 220, protein: 8, carbs: 30, fat: 7 }), source: 'label' }) }, { portion: '1 big bowl' });
    expect(d).toMatchObject({ source: 'label', portion: '1 big bowl' });
  });

  it('a guess whose weight is edited is still a guess', () => {
    const d = editAmount(draftFrom({ name: 'Curry', portion: '300 g', nutrition: fromPer100({ kcal: 150, protein: 8, carbs: 12, fat: 8 }, 300), source: 'model' }), { grams: 250 });
    expect(draftToItem(d, { options: unitOptions({}) }).source).toBe('model');
  });

  it.each(['kcal', 'protein', 'carbs', 'fat'] as const)('overruling the %s figure makes it the user’s own', (field) => {
    const d = editNutrition(scanned(FLAPJACK), field, 17);
    expect(d).toMatchObject({ source: 'user', fromLabel: false, [field]: 17 });
    expect(draftToItem(d, { options: optionsOf(d) }).source).toBe('user');
  });

  it('accepting the Atwater correction (a calorie edit) is overruling the figure', () => {
    expect(editNutrition(scanned(FLAPJACK), 'kcal', 405).source).toBe('user');
  });

  it('changing the weight does not undo a figure the user already overruled', () => {
    const d = editAmount(editNutrition(scanned(FLAPJACK), 'kcal', 380), { grams: 80 });
    expect(d.source).toBe('user');
  });
});

describe('the saved portion text', () => {
  it('names a changed amount in the food’s own units', () => {
    const d = editAmount(scanned(CHICKEN), { grams: 400, unitKey: 'pack' });
    expect(draftToItem(d, { options: optionsOf(d) }).portion).toBe('1 pack (400 g)');
    const half = editAmount(d, { grams: 200, unitKey: 'pack' });
    expect(draftToItem(half, { options: optionsOf(half) }).portion).toBe('½ pack (200 g)');
  });

  it('never leaves a label’s serving text beside a weight that has moved on', () => {
    // Applying the label wrote "1 serving (50 g)"; the weight is then typed over.
    const d = editAmount(scanned(FLAPJACK), { grams: 120, unitKey: 'g' });
    expect(d.portion).toBe('1 serving (50 g)');
    expect(draftToItem(d, { options: optionsOf(d) }).portion).toBe('120 g');
  });

  it('keeps the text of an amount nobody touched — a recipe share is not rewritten by an edit elsewhere', () => {
    const d = draftFrom({ name: 'Chilli', portion: '1 of 4 portions', nutrition: fromPer100({ kcal: 120, protein: 9, carbs: 10, fat: 5 }, 350), source: 'user' });
    expect(draftToItem(editNutrition(d, 'protein', 10), { options: unitOptions({}) }).portion).toBe('1 of 4 portions');
  });

  it('keeps a whole-portion item’s own text', () => {
    const d = draftFrom({ name: 'Soup', portion: '1 bowl', nutrition: fromPortion({ kcal: 220, protein: 8, carbs: 30, fat: 7 }) });
    expect(draftToItem(d, { options: unitOptions({}) }).portion).toBe('1 bowl');
  });
});

describe('what the sheet teaches food memory', () => {
  it('hands over the pack and serving a label stated, uncapped, and the unit used', () => {
    const d = editAmount(scanned({ ...CHICKEN, servingGrams: 100 }), { grams: 400, unitKey: 'pack' });
    const item = draftToItem(d, { options: optionsOf(d) });
    expect(item.units).toEqual({ packGrams: 400, servingGrams: 100, lastUnit: 'pack' });
  });

  it('teaches an item unit as a count when that was how the amount was chosen', () => {
    const options = unitOptions({ tableUnit: { label: 'egg', plural: 'eggs', grams: 50 } });
    const d = editAmount(draftFrom({ name: 'Eggs', portion: '', nutrition: fromPer100({ kcal: 131, protein: 12.6, carbs: 0, fat: 9 }, 100), source: 'table' }), { grams: 100, unitKey: 'egg' });
    expect(draftToItem(d, { options }).unit).toEqual({ count: 2, unitGrams: 50, label: 'egg', plural: 'eggs' });
  });

  it('carries the barcode of a pack the user typed in', () => {
    const d = blankDraft();
    expect(draftToItem({ ...d, name: 'Mystery bar' }, { options: unitOptions({}), barcode: '5012345678900' }).barcode).toBe('5012345678900');
  });

  it('a remembered food brings its pack and serving with it', () => {
    const m: FoodMemory = {
      id: 'f',
      key: 'p:tesco chicken',
      name: 'Tesco Chicken',
      per100: CHICKEN.per100,
      source: 'label',
      packGrams: 400,
      servingGrams: 100,
      timesUsed: 1,
      lastUsedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(applyMemory(m)).toMatchObject({ packGrams: 400, servingGrams: 100, source: 'label', fromLabel: true });
  });
});

describe('the eaten figure', () => {
  it('follows the weight', () => {
    const d = editAmount(scanned(CHICKEN), { grams: 200 });
    expect(macrosOf(nutritionFrom(d)).kcal).toBeCloseTo(330, 5);
  });
});
