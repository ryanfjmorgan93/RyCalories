import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  displayName,
  parseGrams,
  parseProduct,
  plausiblePack,
  portionGrams,
  portionLabel,
  tokenScore,
  tokens,
  type LabelNutrition,
} from './products';

function label(over: Partial<LabelNutrition> = {}): LabelNutrition {
  return {
    code: '1',
    brand: 'Trek',
    name: 'Protein Flapjack',
    per100: { kcal: 400, protein: 15, carbs: 45, fat: 15 },
    ...over,
  };
}

describe('tokenising', () => {
  it('drops packaging words that carry no identity', () => {
    expect([...tokens('Trek Protein Flapjack Bar')]).toEqual(['trek', 'protein', 'flapjack']);
  });

  it('singularises so a plural still matches', () => {
    expect(tokens('flapjacks').has('flapjack')).toBe(true);
  });

  it('does not maul a word that genuinely ends in double s', () => {
    expect(tokens('swiss').has('swiss')).toBe(true);
  });

  it('ignores punctuation and case', () => {
    expect([...tokens("Nature's  Way—Oats!")]).toEqual(['nature', 'way', 'oat']);
  });
});

describe('scoring is symmetric', () => {
  it('is 1 for an exact token match', () => {
    expect(tokenScore(tokens('Trek Protein Flapjack'), tokens('Trek Protein Flapjack'))).toBe(1);
  });

  it('penalises a candidate stuffed with unrelated words', () => {
    // Recall-only scoring gave this a perfect 1.0, which is how a variety multipack outranked
    // the actual product.
    const q = tokens('Trek Protein Flapjack');
    const bloated = tokenScore(q, tokens('Trek Protein Flapjack Multipack Variety Selection Box Assorted'));
    const exact = tokenScore(q, tokens('Trek Protein Flapjack'));
    expect(bloated).toBeLessThan(exact);
  });

  it('is zero when nothing overlaps', () => {
    expect(tokenScore(tokens('Trek Flapjack'), tokens('Heinz Beans'))).toBe(0);
  });

  it('is zero against an empty side', () => {
    expect(tokenScore(new Set(), tokens('Trek'))).toBe(0);
    expect(tokenScore(tokens('Trek'), new Set())).toBe(0);
  });
});

describe('the brand rule (ROADMAP §1.1)', () => {
  const rival = label({ code: '2', brand: 'Aldi', name: 'Protein Flapjack', per100: { kcal: 300, protein: 8, carbs: 50, fat: 8 } });

  it('refuses a rival manufacturer however well the product name matches', () => {
    // The old scoring gave this 0.67 and wrote Aldi's numbers onto a Trek bar behind a
    // badge asserting they came off the real label.
    expect(bestMatch({ text: 'Protein Flapjack', brand: 'Trek' }, [rival])).toBeNull();
  });

  it('still finds the right one when it is in the list', () => {
    const m = bestMatch({ text: 'Protein Flapjack', brand: 'Trek' }, [rival, label()]);
    expect(m?.label.brand).toBe('Trek');
  });

  it('matches a brand case-insensitively and through punctuation', () => {
    const m = bestMatch({ text: 'Protein Flapjack', brand: 'trek!' }, [label()]);
    expect(m?.label.brand).toBe('Trek');
  });

  it('allows any brand when the query names none', () => {
    expect(bestMatch({ text: 'Protein Flapjack' }, [rival])?.label.brand).toBe('Aldi');
  });

  it('returns nothing rather than a weak guess', () => {
    expect(bestMatch({ text: 'Protein Flapjack', brand: 'Trek' }, [])).toBeNull();
    expect(bestMatch({ text: 'chicken' }, [label()])).toBeNull();
  });

  it('returns nothing for a query with no usable words', () => {
    expect(bestMatch({ text: '  !! ' }, [label()])).toBeNull();
  });
});

describe('choosing between plausible matches', () => {
  it('prefers an entry that knows its own portion', () => {
    const vague = label({ code: 'a', name: 'Protein Flapjack' });
    const precise = label({ code: 'b', name: 'Protein Flapjack', servingGrams: 50 });
    expect(bestMatch({ text: 'Protein Flapjack', brand: 'Trek' }, [vague, precise])?.label.code).toBe('b');
  });

  it('borrows a pack size from another flavour of the same brand', () => {
    const winner = label({ code: 'a', name: 'Protein Flapjack Cocoa' });
    const sibling = label({ code: 'b', name: 'Protein Flapjack Peanut', packGrams: 50 });
    const m = bestMatch({ text: 'Protein Flapjack Cocoa', brand: 'Trek' }, [winner, sibling]);
    expect(m?.label.code).toBe('a');
    expect(m?.label.packGrams).toBe(50);
  });

  it('does not borrow an implausible pack size', () => {
    const winner = label({ code: 'a', name: 'Protein Flapjack Cocoa' });
    const sibling = label({ code: 'b', name: 'Protein Flapjack Peanut', packGrams: 1000 });
    expect(bestMatch({ text: 'Protein Flapjack Cocoa', brand: 'Trek' }, [winner, sibling])?.label.packGrams).toBeUndefined();
  });

  it('does not borrow across brands', () => {
    const winner = label({ code: 'a', brand: '', name: 'Protein Flapjack' });
    const other = label({ code: 'b', brand: '', name: 'Protein Flapjack Peanut', packGrams: 50 });
    expect(bestMatch({ text: 'Protein Flapjack' }, [winner, other])?.label.packGrams).toBeUndefined();
  });

  it('is deterministic when two candidates tie', () => {
    const a = label({ code: 'a', name: 'Protein Flapjack Alpha' });
    const b = label({ code: 'b', name: 'Protein Flapjack Alpha' });
    const first = bestMatch({ text: 'Protein Flapjack Alpha', brand: 'Trek' }, [a, b])?.label.code;
    const second = bestMatch({ text: 'Protein Flapjack Alpha', brand: 'Trek' }, [b, a])?.label.code;
    expect(first).toBe(second);
  });
});

describe('parsing a product record', () => {
  const raw = {
    code: '5060029000000',
    product_name: 'Protein Flapjack',
    brands: 'Trek, Natural Balance Foods',
    quantity: '50 g',
    serving_size: '50 g',
    serving_quantity: 50,
    nutriments: { 'energy-kcal_100g': 400, proteins_100g: 15, carbohydrates_100g: 45, fat_100g: 15 },
  };

  it('reads the fields that matter and keeps only the first brand', () => {
    const l = parseProduct(raw)!;
    expect(l.brand).toBe('Trek');
    expect(l.per100).toEqual({ kcal: 400, protein: 15, carbs: 45, fat: 15 });
    expect(l.servingGrams).toBe(50);
  });

  it('refuses an entry with no energy figure rather than inventing zero', () => {
    // A crowd-sourced blank must not become "0 kcal" behind a label badge.
    expect(parseProduct({ ...raw, nutriments: { proteins_100g: 15 } })).toBeNull();
  });

  it('refuses an entry with no name', () => {
    expect(parseProduct({ ...raw, product_name: '   ' })).toBeNull();
  });

  it('refuses anything that is not a product', () => {
    expect(parseProduct(null)).toBeNull();
    expect(parseProduct('nope')).toBeNull();
    expect(parseProduct({ product_name: 'x' })).toBeNull();
  });

  it('treats a missing macro as zero but never as negative', () => {
    const l = parseProduct({ ...raw, nutriments: { 'energy-kcal_100g': 400, fat_100g: -3 } })!;
    expect(l.per100).toEqual({ kcal: 400, protein: 0, carbs: 0, fat: 0 });
  });

  it('reads numbers that arrive as strings', () => {
    const l = parseProduct({ ...raw, nutriments: { 'energy-kcal_100g': '400', proteins_100g: '15' } })!;
    expect(l.per100.kcal).toBe(400);
    expect(l.per100.protein).toBe(15);
  });

  it('only takes a bare energy-kcal when the unit really is kcal', () => {
    expect(parseProduct({ ...raw, nutriments: { 'energy-kcal': 400 } })?.per100.kcal).toBe(400);
    expect(parseProduct({ ...raw, nutriments: { 'energy-kcal': 1600, 'energy-kcal_unit': 'kJ' } })).toBeNull();
  });

  it('falls back to the text quantity when there is no numeric one', () => {
    const l = parseProduct({ ...raw, serving_quantity: 0, serving_size: '45 g', quantity: '6 x 50g' })!;
    expect(l.servingGrams).toBe(45);
    expect(l.packGrams).toBe(50);
  });
});

describe('quantity text', () => {
  it('reads grams and millilitres', () => {
    expect(parseGrams('50 g')).toBe(50);
    expect(parseGrams('50g')).toBe(50);
    expect(parseGrams('330 ml')).toBe(330);
    expect(parseGrams('1,5 g')).toBe(1.5);
  });

  it('takes the last figure in a multipack, which is the unit size', () => {
    expect(parseGrams('6 x 50g')).toBe(50);
  });

  it('gives nothing for text with no weight', () => {
    expect(parseGrams('')).toBeUndefined();
    expect(parseGrams('one bar')).toBeUndefined();
    expect(parseGrams('0 g')).toBeUndefined();
  });

  it('rejects an implausible pack as a portion', () => {
    expect(plausiblePack(50)).toBe(50);
    expect(plausiblePack(1000)).toBeUndefined();
    expect(plausiblePack(undefined)).toBeUndefined();
  });
});

describe('portioning', () => {
  it('prefers the stated serving, then a plausible pack, then what we had, then 100 g', () => {
    expect(portionGrams(label({ servingGrams: 45, packGrams: 90 }))).toBe(45);
    expect(portionGrams(label({ packGrams: 90 }))).toBe(90);
    expect(portionGrams(label({ packGrams: 2000 }), 75)).toBe(75);
    expect(portionGrams(label())).toBe(100);
  });

  it('describes the portion without inventing precision', () => {
    expect(portionLabel(label({ servingGrams: 45 }), 45)).toBe('1 serving (45 g)');
    expect(portionLabel(label({ packGrams: 50 }), 50)).toBe('1 pack (50 g)');
    expect(portionLabel(label(), 137)).toBe('137 g');
  });
});

describe('display name', () => {
  it('title-cases a shouting entry', () => {
    expect(displayName(label({ brand: 'TREK', name: 'PROTEIN FLAPJACK' }))).toBe('Trek Protein Flapjack');
  });

  it('leaves a properly cased entry alone', () => {
    expect(displayName(label({ brand: 'Trek', name: 'Protein Flapjack' }))).toBe('Trek Protein Flapjack');
  });

  it('copes with a missing brand', () => {
    expect(displayName(label({ brand: '' }))).toBe('Protein Flapjack');
    expect(displayName(label({ brand: '', name: '' }))).toBe('');
  });
});
