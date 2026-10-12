import { beforeAll, describe, expect, it } from 'vitest';
import { amountPlan, choiceFromLabel, choiceFromMemory, itemFromAmount, kcalFor, recentChoices, searchChoices } from './foodChoice';
import { macrosOf } from './food';
import { loadUkFoodTable, type UkFoodTable } from '@/data/ukFoodTable';
import type { LabelNutrition } from './products';
import type { FoodMemory } from './types';

let table: UkFoodTable;
beforeAll(async () => {
  table = await loadUkFoodTable();
});

const none: FoodMemory[] = [];

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'f1',
    key: 'n:test',
    name: 'Test',
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 1 },
    source: 'user',
    timesUsed: 3,
    lastUsedAt: '2026-10-01T08:00:00.000Z',
    ...over,
  };
}

const CHICKEN: LabelNutrition = {
  code: '5000000000001',
  brand: 'Tesco',
  name: 'Chicken Breast Fillets',
  per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  packGrams: 400,
};

describe('searching the UK table for an everyday food', () => {
  it('finds eggs, with the table’s count unit, and opens on "1 egg"', () => {
    const [first] = searchChoices('egg', { ...table, memories: none });
    expect(first).toMatchObject({ name: 'Eggs, chicken, whole, raw', origin: 'table', source: 'table' });
    const plan = amountPlan(first!);
    expect(plan.unit).toMatchObject({ key: 'egg', grams: 50 });
    expect(plan.chips.map((c) => c.label)).toEqual(['1 egg', '2 eggs', '3 eggs']);
  });

  it('logs 2 eggs as 100 g at the table’s figures and teaches the unit', () => {
    const [eggs] = searchChoices('egg', { ...table, memories: none });
    const { options, unit } = amountPlan(eggs!);
    const item = itemFromAmount(eggs!, unit, 2, options);
    expect(item.portion).toBe('2 eggs (100 g)');
    expect(item.source).toBe('table');
    expect(item.nutrition).toMatchObject({ basis: 'weighed', grams: 100 });
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(131, 5);
    expect(item.unit).toEqual({ count: 2, unitGrams: 50, label: 'egg', plural: 'eggs' });
    expect(item.units.lastUnit).toBe('egg');
  });

  it('gives a food with no count unit grams, at 100 g', () => {
    const [rice] = searchChoices('white rice boiled', { ...table, memories: none });
    expect(rice).toBeDefined();
    const plan = amountPlan(rice!);
    expect(plan.unit.kind).toBe('grams');
    expect(plan.chips.map((c) => c.label)).toEqual(['100 g', '50 g', '200 g']);
  });

  it('shows a table food the owner has logged as their own record of it, with the table unit still offered', () => {
    const logged = memory({ key: 'n:eggs chicken whole raw', name: 'Eggs, chicken, whole, raw', source: 'user', per100: { kcal: 150, protein: 13, carbs: 0, fat: 10 }, lastUnit: 'g', typicalGrams: 120 });
    const found = searchChoices('egg', { ...table, memories: [logged] });
    const eggs = found.filter((c) => c.name === 'Eggs, chicken, whole, raw');
    expect(eggs).toHaveLength(1);
    expect(eggs[0]).toMatchObject({ origin: 'memory', source: 'user' });
    expect(eggs[0]!.per100.kcal).toBe(150);
    const plan = amountPlan(eggs[0]!);
    expect(plan.options.map((o) => o.key)).toEqual(['egg', 'g']);
    // Last used in grams, so it opens on grams, built around the usual 120 g.
    expect(plan.unit).toMatchObject({ key: 'g', grams: 120 });
  });

  it('puts remembered foods first', () => {
    const mine = memory({ key: 'n:egg mayo sandwich', name: 'Egg mayo sandwich' });
    const found = searchChoices('egg', { ...table, memories: [mine] });
    expect(found[0]!.name).toBe('Egg mayo sandwich');
  });
});

describe('the list before anything is typed', () => {
  it('is what the owner eats most, most recent first, each with its table unit', () => {
    const eggs = memory({ id: 'a', key: 'n:eggs chicken whole raw', name: 'Eggs, chicken, whole, raw', timesUsed: 10 });
    const oats = memory({ id: 'b', key: 'n:oats', name: 'Oats', timesUsed: 2 });
    const list = recentChoices([oats, eggs], table);
    expect(list.map((c) => c.name)).toEqual(['Eggs, chicken, whole, raw', 'Oats']);
    expect(amountPlan(list[0]!).unit.key).toBe('egg');
  });
});

describe('a product label as the food', () => {
  it('a 400 g chicken pack offers "Whole pack (400 g)" and "Half" and opens on the pack', () => {
    const choice = choiceFromLabel(CHICKEN);
    const plan = amountPlan(choice);
    expect(plan.unit).toMatchObject({ key: 'pack', grams: 400 });
    expect(plan.chips.map((c) => c.label)).toEqual(['Whole pack (400 g)', 'Half']);
  });

  it('logs the whole pack in one go, with the label’s standing and its pack remembered', () => {
    const choice = choiceFromLabel(CHICKEN);
    const { options, unit, chips } = amountPlan(choice);
    const item = itemFromAmount(choice, unit, chips[0]!.qty, options);
    expect(item).toMatchObject({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets', source: 'label', portion: '1 pack (400 g)' });
    expect(item.nutrition).toMatchObject({ basis: 'weighed', grams: 400 });
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(660, 5);
    expect(item.units).toMatchObject({ packGrams: 400, lastUnit: 'pack' });
    expect(item).not.toHaveProperty('unit');
  });

  it('logs half a pack as 200 g', () => {
    const choice = choiceFromLabel(CHICKEN);
    const { options, unit, chips } = amountPlan(choice);
    const item = itemFromAmount(choice, unit, chips[1]!.qty, options);
    expect(item.portion).toBe('½ pack (200 g)');
    expect(item.nutrition).toMatchObject({ grams: 200 });
  });

  it('keeps the label’s serving as a second unit', () => {
    const choice = choiceFromLabel({ ...CHICKEN, servingGrams: 100 });
    const { options, unit } = amountPlan(choice);
    expect(options.map((o) => o.key)).toEqual(['pack', 'serving', 'g']);
    expect(itemFromAmount(choice, unit, 1, options).units).toMatchObject({ packGrams: 400, servingGrams: 100 });
  });

  it('opens on the unit last used for that product', () => {
    const known = memory({ key: 'p:tesco chicken breast fillets', name: 'Tesco Chicken Breast Fillets', source: 'label', lastUnit: 'g', typicalGrams: 250 });
    const plan = amountPlan(choiceFromLabel({ ...CHICKEN, servingGrams: 100 }, known));
    expect(plan.unit).toMatchObject({ key: 'g', grams: 250 });
  });

  it('keeps the owner’s corrected figures over a fresh read of the label', () => {
    const corrected = memory({ source: 'user', per100: { kcal: 120, protein: 26, carbs: 0, fat: 1.5 } });
    const choice = choiceFromLabel(CHICKEN, corrected);
    expect(choice.per100.kcal).toBe(120);
    expect(choice.source).toBe('user');
    // The pack is still the label’s: it is fresher than anything remembered.
    expect(amountPlan(choice).unit).toMatchObject({ key: 'pack', grams: 400 });
  });

  it('uses the label’s figures over an equal-standing memory of an older read', () => {
    const older = memory({ source: 'label', per100: { kcal: 150, protein: 30, carbs: 0, fat: 3 } });
    expect(choiceFromLabel(CHICKEN, older).per100.kcal).toBe(165);
  });
});

describe('a remembered food as the food', () => {
  it('comes back with its pack when the label cannot be read again', () => {
    const m = memory({ name: 'Tesco Chicken Breast Fillets', brand: 'Tesco', product: 'Chicken Breast Fillets', source: 'label', packGrams: 400 });
    const plan = amountPlan(choiceFromMemory(m));
    expect(plan.chips.map((c) => c.label)).toEqual(['Whole pack (400 g)', 'Half']);
  });

  it('prices an amount from its per-100 g figures', () => {
    expect(kcalFor({ per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } }, 200)).toBeCloseTo(330, 5);
  });
});
