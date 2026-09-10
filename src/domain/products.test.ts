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

describe('the brand is a gate, not a score', () => {
  it('refuses a candidate that shares only the brand', () => {
    // Scoring the brand as well as gating on it meant brand agreement alone could clear the
    // threshold: "Heinz Ketchup" vs "Heinz Mayonnaise" scored exactly 0.5 and matched, with no
    // product word in common.
    const mayo = label({ code: '9', brand: 'Heinz', name: 'Mayonnaise', per100: { kcal: 721, protein: 1, carbs: 1, fat: 79 } });
    expect(bestMatch({ text: 'Ketchup', brand: 'Heinz' }, [mayo])).toBeNull();
    expect(bestMatch({ text: 'Heinz Ketchup', brand: 'Heinz' }, [mayo])).toBeNull();
  });

  it('is not fooled by a multi-word brand, which is where the hole was widest', () => {
    const butter = label({ code: '9', brand: 'Yeo Valley', name: 'Yeo Valley Salted Butter', per100: { kcal: 744, protein: 0.6, carbs: 0.6, fat: 82 } });
    expect(bestMatch({ text: 'Natural Yoghurt', brand: 'Yeo Valley' }, [butter])).toBeNull();
  });

  it('still matches the real product once the brand is set aside', () => {
    const real = label({ brand: 'Trek', name: 'TREK PROTEIN FLAPJACKS' });
    expect(bestMatch({ text: 'Protein Flapjack', brand: 'Trek' }, [real])?.label.code).toBe('1');
    // And when the brand was typed into the name field instead of the brand field.
    expect(bestMatch({ text: 'Trek Protein Flapjack' }, [real])?.label.code).toBe('1');
  });

  it('will not pick an arbitrary product when the query is only the brand', () => {
    expect(bestMatch({ text: 'Heinz', brand: 'Heinz' }, [label({ brand: 'Heinz', name: 'Mayonnaise' })])).toBeNull();
  });
});

describe('numbers that distinguish one variant from another', () => {
  const fage = (pct: string, kcal: number, fat: number) =>
    label({ code: pct, brand: 'Fage', name: `Fage Total ${pct}%`, per100: { kcal, protein: 9, carbs: 3, fat } });
  const all = [fage('0', 54, 0), fage('2', 70, 2), fage('5', 93, 5)];

  it('keeps a lone digit, so three real products stay three products', () => {
    // Dropping single-character tokens reduced all three to {fage,total}, so asking for the 5%
    // returned the 0% — 54 kcal and 0 g fat — at a perfect score with no ambiguity signalled.
    expect(tokens('Fage Total 5%').has('5')).toBe(true);
    expect(bestMatch({ text: 'Fage Total 5%', brand: 'Fage' }, all)?.label.per100.kcal).toBe(93);
    expect(bestMatch({ text: 'Fage Total 0%', brand: 'Fage' }, all)?.label.per100.kcal).toBe(54);
  });

  it('returns nothing rather than the wrong strength when the one asked for is absent', () => {
    expect(bestMatch({ text: 'Fage Total 5%', brand: 'Fage' }, [fage('0', 54, 0)])).toBeNull();
  });

  it('still drops a lone letter, which is initials and noise', () => {
    expect(tokens('M S Protein Flapjack').has('m')).toBe(false);
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

  it('borrows a serving as a serving, not as a pack', () => {
    // Borrowing a sibling's 45 g SERVING into packGrams made portionLabel announce
    // "1 pack (45 g)" for a 500 g box — a false statement about the packet, written onto the meal.
    const winner = label({ code: 'a', name: 'Crunchy Nut Granola' });
    const sibling = label({ code: 'b', name: 'Crunchy Nut Granola Chocolate', servingGrams: 45, packGrams: 500 });
    const m = bestMatch({ text: 'Crunchy Nut Granola', brand: 'Trek' }, [winner, sibling]);
    expect(m?.label.servingGrams).toBe(45);
    expect(m?.label.packGrams).toBeUndefined();
    expect(portionLabel(m!.label, portionGrams(m!.label))).toBe('1 serving (45 g)');
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

  it('reads a brand however Open Food Facts happens to type it', () => {
    // Comma-separated from the barcode endpoint, an array from the search endpoint.
    expect(parseProduct({ ...raw, brands: 'Trek, Natural Balance Foods' })?.brand).toBe('Trek');
    expect(parseProduct({ ...raw, brands: ['Trek', 'Natural Balance Foods'] })?.brand).toBe('Trek');
    expect(parseProduct({ ...raw, brands: [] })?.brand).toBe('');
    expect(parseProduct({ ...raw, brands: null })?.brand).toBe('');
  });

  it('reads a name given as a language map rather than rendering it as [object Object]', () => {
    expect(parseProduct({ ...raw, product_name: { fr: 'Flapjack protéiné', en: 'Protein Flapjack' } })?.name).toBe('Protein Flapjack');
    expect(parseProduct({ ...raw, product_name: { fr: 'Flapjack protéiné' } })?.name).toBe('Flapjack protéiné');
    expect(parseProduct({ ...raw, product_name: {} })).toBeNull();
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

  it('does not repeat a brand the product name already carries', () => {
    // Open Food Facts entries usually include the brand in the name. Prefixing it again gave
    // "Trek TREK PROTEIN FLAPJACKS" on a real record.
    expect(displayName(label({ brand: 'Trek', name: 'TREK PROTEIN FLAPJACKS' }))).toBe('Trek Protein Flapjacks');
    expect(displayName(label({ brand: 'Trek', name: 'Trek Protein Flapjack' }))).toBe('Trek Protein Flapjack');
  });

  it('title-cases each part on its own merits', () => {
    // A properly-cased brand beside a shouting name used to leave the name shouting, because the
    // test was applied to the joined string.
    expect(displayName(label({ brand: 'Aldi', name: 'PROTEIN FLAPJACK' }))).toBe('Aldi Protein Flapjack');
  });

  it('still prefixes a brand the name does not lead with', () => {
    expect(displayName(label({ brand: 'Trek', name: 'Protein Flapjack' }))).toBe('Trek Protein Flapjack');
    expect(displayName(label({ brand: 'Trek', name: 'Cocoa Trek Bar' }))).toBe('Trek Cocoa Trek Bar');
  });

  it('leaves a properly cased entry alone', () => {
    expect(displayName(label({ brand: 'Trek', name: 'Protein Flapjack' }))).toBe('Trek Protein Flapjack');
  });

  it('copes with a missing brand', () => {
    expect(displayName(label({ brand: '' }))).toBe('Protein Flapjack');
    expect(displayName(label({ brand: '', name: '' }))).toBe('');
  });
});
