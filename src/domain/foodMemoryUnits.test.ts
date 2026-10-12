import { describe, expect, it } from 'vitest';
import { memoryFrom, mergeMemory } from './foodMemory';
import { fromPer100, type Macros } from './food';
import type { FoodMemory, MealItem } from './types';

const CHICKEN: Macros = { kcal: 165, protein: 31, carbs: 0, fat: 3.6 };
const at = '2026-10-12T12:00:00.000Z';

function item(over: Partial<MealItem> & { units?: Parameters<typeof memoryFrom>[0]['units'] } = {}) {
  return {
    name: 'Chicken breast fillets',
    brand: 'Tesco',
    product: 'Chicken Breast Fillets',
    source: 'label' as const,
    nutrition: fromPer100(CHICKEN, 400),
    ...over,
  };
}

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'f1',
    key: 'p:tesco chicken breast fillets',
    name: 'Chicken breast fillets',
    per100: CHICKEN,
    source: 'label',
    timesUsed: 1,
    lastUsedAt: '2026-10-01T08:00:00.000Z',
    ...over,
  };
}

describe('remembering a food’s units', () => {
  it('keeps the pack and serving weights so the chips survive offline', () => {
    const m = memoryFrom(item({ units: { packGrams: 400, servingGrams: 100, lastUnit: 'pack' } }))!;
    expect(m.packGrams).toBe(400);
    expect(m.servingGrams).toBe(100);
    expect(m.lastUnit).toBe('pack');
  });

  it('keeps further count-style units, named, once each', () => {
    const m = memoryFrom(
      item({
        units: {
          extra: [
            { label: 'fillet', plural: 'fillets', grams: 120 },
            { label: 'Fillet', grams: 130 },
            { label: 'nothing', grams: 0 },
            { label: '', grams: 5 },
          ],
        },
      }),
    )!;
    expect(m.units).toEqual([{ label: 'fillet', plural: 'fillets', grams: 120 }]);
  });

  it('writes nothing for units it was not given', () => {
    const m = memoryFrom(item())!;
    expect(m).not.toHaveProperty('packGrams');
    expect(m).not.toHaveProperty('servingGrams');
    expect(m).not.toHaveProperty('units');
    expect(m).not.toHaveProperty('lastUnit');
  });

  it('refuses a pack weight that is not a weight', () => {
    const m = memoryFrom(item({ units: { packGrams: Number.NaN, servingGrams: -5 } }))!;
    expect(m).not.toHaveProperty('packGrams');
    expect(m).not.toHaveProperty('servingGrams');
  });
});

describe('merging units into what is already remembered', () => {
  it('takes the newest pack and serving: they are facts about the pack on the shelf', () => {
    const merged = mergeMemory(memory({ packGrams: 400, servingGrams: 100 }), memoryFrom(item({ units: { packGrams: 650 } }))!, at);
    expect(merged.packGrams).toBe(650);
    expect(merged.servingGrams).toBe(100);
  });

  it('keeps the pack when this logging did not know it', () => {
    const merged = mergeMemory(memory({ packGrams: 400 }), memoryFrom(item())!, at);
    expect(merged.packGrams).toBe(400);
  });

  it('follows the last unit used', () => {
    const merged = mergeMemory(memory({ lastUnit: 'pack' }), memoryFrom(item({ units: { lastUnit: 'g' } }))!, at);
    expect(merged.lastUnit).toBe('g');
  });

  it('adds a unit it did not have and updates one it did', () => {
    const merged = mergeMemory(
      memory({ units: [{ label: 'fillet', grams: 120 }] }),
      memoryFrom(item({ units: { extra: [{ label: 'fillet', grams: 130 }, { label: 'strip', grams: 20 }] } }))!,
      at,
    );
    expect(merged.units).toEqual([
      { label: 'fillet', grams: 130 },
      { label: 'strip', grams: 20 },
    ]);
  });

  it('does not let a guess overwrite a unit weight the owner corrected', () => {
    const corrected = memory({ source: 'user', units: [{ label: 'fillet', grams: 150 }] });
    const merged = mergeMemory(corrected, memoryFrom(item({ source: 'model', units: { extra: [{ label: 'fillet', grams: 90 }] } }))!, at);
    expect(merged.units).toEqual([{ label: 'fillet', grams: 150 }]);
  });
});
