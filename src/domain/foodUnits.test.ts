import { describe, expect, it } from 'vitest';
import { amountChips, chipGrams, defaultUnit, describeAmount, portionText, quantityOf, unitOptions, type UnitSource } from './foodUnits';
import type { FoodMemory } from './types';

function memory(over: Partial<FoodMemory> = {}): FoodMemory {
  return {
    id: 'm1',
    key: 'n:test',
    name: 'Test',
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 1 },
    source: 'user',
    timesUsed: 1,
    lastUsedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

const labels = (src: UnitSource) => unitOptions(src).map((o) => o.label);
const chipLabels = (src: UnitSource) => amountChips(defaultUnit(unitOptions(src), src)).map((c) => c.label);

describe('unitOptions', () => {
  it('offers a 400 g pack as a pack — the old 300 g cap is gone', () => {
    const options = unitOptions({ packGrams: 400 });
    expect(options.map((o) => o.label)).toEqual(['pack (400 g)', 'g']);
    expect(options[0]).toMatchObject({ key: 'pack', kind: 'pack', grams: 400 });
  });

  it('offers even a kilo bag as a pack: offering is not pre-filling', () => {
    expect(labels({ packGrams: 1000 })).toContain('pack (1,000 g)');
  });

  it('puts the label pack and serving first, then the table unit, then the remembered one, then grams', () => {
    const src: UnitSource = {
      packGrams: 400,
      servingGrams: 100,
      tableUnit: { label: 'fillet', plural: 'fillets', grams: 120 },
      memory: memory({ unitGrams: 15, unitLabel: 'strip', unitPlural: 'strips' }),
    };
    expect(unitOptions(src).map((o) => o.key)).toEqual(['pack', 'serving', 'fillet', 'strip', 'g']);
    expect(unitOptions(src).map((o) => o.kind)).toEqual(['pack', 'serving', 'item', 'item', 'grams']);
  });

  it('reads the UK table unit: one egg, one slice, one rasher', () => {
    const options = unitOptions({ tableUnit: { label: 'egg', plural: 'eggs', grams: 50 } });
    expect(options.map((o) => o.label)).toEqual(['egg', 'g']);
    expect(options[0]).toMatchObject({ noun: 'egg', nouns: 'eggs', grams: 50 });
  });

  it('lets a remembered unit weight correct the table estimate without reordering the chips', () => {
    const options = unitOptions({
      tableUnit: { label: 'egg', plural: 'eggs', grams: 50 },
      memory: memory({ unitGrams: 55, unitLabel: 'egg', unitPlural: 'eggs' }),
    });
    expect(options.filter((o) => o.kind === 'item')).toHaveLength(1);
    expect(options[0]).toMatchObject({ key: 'egg', grams: 55 });
  });

  it('reads the pack and serving back from memory when no label was read this time (offline)', () => {
    const options = unitOptions({ memory: memory({ packGrams: 400, servingGrams: 100 }) });
    expect(options.map((o) => o.key)).toEqual(['pack', 'serving', 'g']);
  });

  it('prefers the label just read over the remembered pack', () => {
    const options = unitOptions({ packGrams: 650, memory: memory({ packGrams: 400 }) });
    expect(options[0]!.grams).toBe(650);
  });

  it('reads further remembered units, skipping nonsense', () => {
    const options = unitOptions({
      memory: memory({
        units: [
          { label: 'slice', plural: 'slices', grams: 35 },
          { label: 'broken', grams: 0 },
          { label: 'pack', grams: 99 },
        ],
      }),
    });
    expect(options.map((o) => o.key)).toEqual(['slice', 'g']);
  });

  it('always ends with grams, so the list is never empty', () => {
    expect(unitOptions({}).map((o) => o.key)).toEqual(['g']);
  });

  it('builds the grams chips around the usual portion when one is remembered, else 100 g', () => {
    expect(unitOptions({}).at(-1)!.grams).toBe(100);
    expect(unitOptions({ memory: memory({ typicalGrams: 82.4 }) }).at(-1)!.grams).toBe(82);
  });
});

describe('defaultUnit', () => {
  it('is the pack for a packaged food', () => {
    const src: UnitSource = { packGrams: 400, servingGrams: 100 };
    expect(defaultUnit(unitOptions(src), src).key).toBe('pack');
  });

  it('falls to the serving when the pack is not known', () => {
    const src: UnitSource = { servingGrams: 30 };
    expect(defaultUnit(unitOptions(src), src).key).toBe('serving');
  });

  it('is the table unit when there is no pack', () => {
    const src: UnitSource = { tableUnit: { label: 'egg', plural: 'eggs', grams: 50 } };
    expect(defaultUnit(unitOptions(src), src).key).toBe('egg');
  });

  it('is 100 g when nothing else is known', () => {
    const d = defaultUnit(unitOptions({}), {});
    expect(d).toMatchObject({ key: 'g', grams: 100 });
  });

  it('becomes the last unit used', () => {
    const src: UnitSource = { packGrams: 500, servingGrams: 40, memory: memory({ lastUnit: 'serving' }) };
    expect(defaultUnit(unitOptions(src), src).key).toBe('serving');
  });

  it('survives the pack changing size: the last unit is "pack", not "pack (400 g)"', () => {
    const src: UnitSource = { packGrams: 650, memory: memory({ lastUnit: 'pack', packGrams: 400 }) };
    expect(defaultUnit(unitOptions(src), src)).toMatchObject({ key: 'pack', grams: 650 });
  });

  it('ignores a last unit the food no longer has', () => {
    const src: UnitSource = { packGrams: 400, memory: memory({ lastUnit: 'serving' }) };
    expect(defaultUnit(unitOptions(src), src).key).toBe('pack');
  });
});

describe('amountChips', () => {
  it('a 400 g pack offers "Whole pack (400 g)" and "Half"', () => {
    const labelsOf = chipLabels({ packGrams: 400 });
    expect(labelsOf).toEqual(['Whole pack (400 g)', 'Half']);
  });

  it('the whole pack comes first, the default one-tap amount', () => {
    const chips = amountChips(unitOptions({ packGrams: 400 })[0]!);
    expect(chips[0]).toMatchObject({ qty: 1, grams: 400 });
    expect(chips[1]).toMatchObject({ qty: 0.5, grams: 200 });
  });

  it('offers two of a small pack, but not two 400 g packs of chicken', () => {
    expect(chipLabels({ packGrams: 40 })).toEqual(['Whole pack (40 g)', 'Half', '2 packs']);
    expect(chipLabels({ packGrams: 400 })).not.toContain('2 packs');
  });

  it('a serving offers 1, half and 2', () => {
    const chips = amountChips(unitOptions({ servingGrams: 30 })[0]!);
    expect(chips.map((c) => [c.label, c.grams])).toEqual([
      ['1 serving (30 g)', 30],
      ['Half a serving', 15],
      ['2 servings', 60],
    ]);
  });

  it('a light item counts up: 1 egg, 2 eggs, 3 eggs', () => {
    const chips = amountChips(unitOptions({ tableUnit: { label: 'egg', plural: 'eggs', grams: 50 } })[0]!);
    expect(chips.map((c) => [c.label, c.grams])).toEqual([
      ['1 egg', 50],
      ['2 eggs', 100],
      ['3 eggs', 150],
    ]);
  });

  it('a heavy item can be halved: 1 bun, ½ bun, 2 buns', () => {
    const chips = amountChips(unitOptions({ tableUnit: { label: 'bun', plural: 'buns', grams: 60 } })[0]!);
    expect(chips.map((c) => c.label)).toEqual(['1 bun', '½ bun', '2 buns']);
  });

  it('grams chips are built around the base weight', () => {
    const chips = amountChips(unitOptions({})[0]!);
    expect(chips.map((c) => [c.label, c.grams])).toEqual([
      ['100 g', 100],
      ['50 g', 50],
      ['200 g', 200],
    ]);
  });

  it('weights are to one decimal place, never a long float', () => {
    const unit = unitOptions({ servingGrams: 33.3 })[0]!;
    expect(chipGrams(unit, 0.5)).toBe(16.7);
    expect(chipGrams(unit, 3)).toBe(99.9);
  });
});

describe('portionText', () => {
  const pack = unitOptions({ packGrams: 400 })[0]!;
  const egg = unitOptions({ tableUnit: { label: 'egg', plural: 'eggs', grams: 50 } })[0]!;
  const serving = unitOptions({ servingGrams: 30 })[0]!;
  const grams = unitOptions({})[0]!;

  it('says it the way a person would', () => {
    expect(portionText(pack, 1)).toBe('1 pack (400 g)');
    expect(portionText(pack, 0.5)).toBe('½ pack (200 g)');
    expect(portionText(pack, 0.25)).toBe('¼ pack (100 g)');
    expect(portionText(egg, 1)).toBe('1 egg (50 g)');
    expect(portionText(egg, 2)).toBe('2 eggs (100 g)');
    expect(portionText(egg, 1.5)).toBe('1½ eggs (75 g)');
    expect(portionText(serving, 2)).toBe('2 servings (60 g)');
    expect(portionText(grams, 1.5)).toBe('150 g');
  });

  it('uses a percentage for a share with no tidy spelling', () => {
    expect(portionText(pack, 0.35)).toBe('35% of a pack (140 g)');
  });
});

describe('describeAmount', () => {
  const options = unitOptions({ packGrams: 400, servingGrams: 100, tableUnit: { label: 'fillet', plural: 'fillets', grams: 120 } });

  it('names a weight that is a tidy multiple of a unit', () => {
    expect(describeAmount(400, options)).toBe('1 pack (400 g)');
    expect(describeAmount(200, options)).toBe('½ pack (200 g)');
    expect(describeAmount(240, options)).toBe('2 fillets (240 g)');
  });

  it('falls back to grams for anything else', () => {
    expect(describeAmount(173, options)).toBe('173 g');
    expect(describeAmount(100, unitOptions({}))).toBe('100 g');
  });

  it('is not fooled by zero', () => {
    expect(describeAmount(0, options)).toBe('0 g');
  });
});

describe('quantityOf', () => {
  it('goes back from a weight to a count', () => {
    expect(quantityOf(unitOptions({ packGrams: 400 })[0]!, 200)).toBe(0.5);
  });
});
