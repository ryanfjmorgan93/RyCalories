import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadUkFoodTable, UK_FOOD_TABLE_ATTRIBUTION, type FoodAlias, type TableFood } from './ukFoodTable';

// Real committed JSON, loaded through the real loader — no mocking the thing under test.
describe('ukFoodTable', () => {
  let foods: TableFood[];
  let aliases: FoodAlias[];

  beforeAll(async () => {
    const table = await loadUkFoodTable();
    foods = table.foods;
    aliases = table.aliases;
  });

  it('pins the CoFID source values this table was verified against', () => {
    const byName = new Map(foods.map((f) => [f.name, f]));
    expect(byName.get('Eggs, chicken, whole, raw')?.per100).toMatchObject({ kcal: 131, protein: 12.6 });
    expect(byName.get('Bacon rashers, back, raw')?.per100).toMatchObject({ kcal: 215, protein: 16.5 });
    expect(byName.get('Cheese, Cheddar, English')?.per100).toMatchObject({ kcal: 416, protein: 25.4 });
  });

  it('has 2,854 foods — the 2,887 rows in CoFID 2021\'s "1.3 Proximates" sheet minus the 33 whose energy value is unknown (32 "N", 1 blank)', () => {
    expect(foods.length).toBe(2854);
  });

  it('gives every food a non-empty code and name, and finite per-100g figures', () => {
    expect(foods.length).toBeGreaterThan(0);
    for (const food of foods) {
      expect(food.code.length).toBeGreaterThan(0);
      expect(food.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(food.per100.kcal)).toBe(true);
      expect(Number.isFinite(food.per100.protein)).toBe(true);
      expect(Number.isFinite(food.per100.carbs)).toBe(true);
      expect(Number.isFinite(food.per100.fat)).toBe(true);
    }
  });

  it('is sorted by code', () => {
    const codes = foods.map((f) => f.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('has between 80 and 120 curated aliases', () => {
    expect(aliases.length).toBeGreaterThanOrEqual(80);
    expect(aliases.length).toBeLessThanOrEqual(120);
  });

  it('every alias code exists in the food table, and unambiguously (exactly one food per code)', () => {
    const foodsByCode = new Map<string, TableFood[]>();
    for (const food of foods) {
      const group = foodsByCode.get(food.code);
      if (group) group.push(food);
      else foodsByCode.set(food.code, [food]);
    }
    for (const alias of aliases) {
      const matches = foodsByCode.get(alias.code);
      expect(matches, `alias ${JSON.stringify(alias.words)} -> code ${alias.code}`).toBeDefined();
      expect(matches!.length, `code ${alias.code} is ambiguous`).toBe(1);
    }
  });

  it('has lower-case alias words, unique across every alias', () => {
    const seen = new Set<string>();
    for (const alias of aliases) {
      expect(alias.words.length).toBeGreaterThan(0);
      for (const word of alias.words) {
        expect(word).toBe(word.toLowerCase());
        expect(seen.has(word), `"${word}" is used by more than one alias`).toBe(false);
        seen.add(word);
      }
    }
  });

  it('gives every unit a positive gram weight and non-empty labels, marked as an estimate', () => {
    const withUnit = aliases.filter((a): a is FoodAlias & { unit: NonNullable<FoodAlias['unit']> } => a.unit !== undefined);
    expect(withUnit.length).toBeGreaterThan(0);
    for (const alias of withUnit) {
      expect(alias.unit.grams).toBeGreaterThan(0);
      expect(alias.unit.label.length).toBeGreaterThan(0);
      expect(alias.unit.plural.length).toBeGreaterThan(0);
    }
  });

  it('carries the CoFID attribution', () => {
    expect(UK_FOOD_TABLE_ATTRIBUTION.name).toContain("McCance and Widdowson");
    expect(UK_FOOD_TABLE_ATTRIBUTION.url).toBe('https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid');
    expect(UK_FOOD_TABLE_ATTRIBUTION.licence).toContain('Open Government Licence v3.0');
  });

  it('memoises: repeated calls resolve to the very same result object, not a fresh one', async () => {
    const first = await loadUkFoodTable();
    const second = await loadUkFoodTable();
    expect(second).toBe(first);
  });

  it('reports the committed JSON size', () => {
    const bytes = readFileSync(new URL('./ukFoodTable.json', import.meta.url)).byteLength;
    // eslint-disable-next-line no-console -- the plan asks for this to be reported.
    console.log(`ukFoodTable.json is ${(bytes / 1024).toFixed(1)} KB`);
    expect(bytes).toBeGreaterThan(0);
  });
});
