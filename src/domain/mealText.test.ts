import { describe, expect, it } from 'vitest';
import { parseMealText } from './mealText';

describe('splitting the text into separate foods', () => {
  it('splits on commas', () => {
    expect(parseMealText('eggs, bacon, cheddar').map((i) => i.name)).toEqual(['eggs', 'bacon', 'cheddar']);
  });

  it('splits on semicolons and newlines', () => {
    expect(parseMealText('eggs; bacon\ncheddar').map((i) => i.name)).toEqual(['eggs', 'bacon', 'cheddar']);
  });

  it('splits on the standalone word "and"', () => {
    expect(parseMealText('eggs and bacon').map((i) => i.name)).toEqual(['eggs', 'bacon']);
  });

  it('does not split "and" inside another word', () => {
    expect(parseMealText('3 sandwiches').map((i) => i.name)).toEqual(['sandwiches']);
  });

  it('trims whitespace and drops empty segments from doubled delimiters', () => {
    expect(parseMealText('  eggs ,, bacon ,  ').map((i) => i.name)).toEqual(['eggs', 'bacon']);
  });

  it('is empty for empty text', () => {
    expect(parseMealText('')).toEqual([]);
    expect(parseMealText('   ')).toEqual([]);
  });

  it('parses the plan\'s own example end to end', () => {
    expect(parseMealText('3 eggs, 30g cheddar, 2 rashers bacon')).toEqual([
      { name: 'eggs', count: 3 },
      { name: 'cheddar', grams: 30 },
      { name: 'bacon', count: 2, unit: 'rasher' },
    ]);
  });
});

describe('leading counts', () => {
  it('"3 eggs" becomes a count with no unit', () => {
    expect(parseMealText('3 eggs')).toEqual([{ name: 'eggs', count: 3 }]);
  });

  it('leaves a food with no leading amount alone', () => {
    expect(parseMealText('salt')).toEqual([{ name: 'salt' }]);
    expect(parseMealText('olive oil')).toEqual([{ name: 'olive oil' }]);
  });
});

describe('gram and kilogram amounts', () => {
  it('"30g cheddar" and "30 g cheddar" both parse the same way', () => {
    expect(parseMealText('30g cheddar')).toEqual([{ name: 'cheddar', grams: 30 }]);
    expect(parseMealText('30 g cheddar')).toEqual([{ name: 'cheddar', grams: 30 }]);
  });

  it('converts kg to grams', () => {
    expect(parseMealText('1.5kg mince')).toEqual([{ name: 'mince', grams: 1500 }]);
    expect(parseMealText('1 kg flour')).toEqual([{ name: 'flour', grams: 1000 }]);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseMealText('1,5kg mince')).toEqual([{ name: 'mince', grams: 1500 }]);
  });
});

describe('count-style unit words', () => {
  it('"2 rashers bacon" and "2 rashers of bacon" both give a rasher unit', () => {
    expect(parseMealText('2 rashers bacon')).toEqual([{ name: 'bacon', count: 2, unit: 'rasher' }]);
    expect(parseMealText('2 rashers of bacon')).toEqual([{ name: 'bacon', count: 2, unit: 'rasher' }]);
  });

  it('recognises slice and clove, singular and plural', () => {
    expect(parseMealText('2 slices of bread')).toEqual([{ name: 'bread', count: 2, unit: 'slice' }]);
    expect(parseMealText('1 slice ham')).toEqual([{ name: 'ham', count: 1, unit: 'slice' }]);
    expect(parseMealText('3 cloves garlic')).toEqual([{ name: 'garlic', count: 3, unit: 'clove' }]);
    expect(parseMealText('1 clove of garlic')).toEqual([{ name: 'garlic', count: 1, unit: 'clove' }]);
  });

  it('does not treat "egg" as a unit word — it is the ingredient name', () => {
    expect(parseMealText('one egg')).toEqual([{ name: 'egg', count: 1 }]);
  });

  it('leaves an unrecognised unit word as part of the name rather than guessing', () => {
    const [result] = parseMealText('2 tbsp olive oil');
    expect(result?.count).toBe(2);
    expect(result?.unit).toBeUndefined();
    expect(result?.name).toContain('olive oil');
  });
});

describe('word numbers', () => {
  it('recognises "a", "an" and "one" through "ten"', () => {
    expect(parseMealText('a rasher of bacon')).toEqual([{ name: 'bacon', count: 1, unit: 'rasher' }]);
    expect(parseMealText('an egg')).toEqual([{ name: 'egg', count: 1 }]);
    expect(parseMealText('ten eggs')).toEqual([{ name: 'eggs', count: 10 }]);
    expect(parseMealText('four slices of bread')).toEqual([{ name: 'bread', count: 4, unit: 'slice' }]);
  });

  it('leaves an unrecognised leading word as ordinary text, not a count', () => {
    expect(parseMealText('chicken breast')).toEqual([{ name: 'chicken breast' }]);
  });
});

describe('decimals', () => {
  it('accepts a decimal count with either separator', () => {
    expect(parseMealText('2.5 slices ham')).toEqual([{ name: 'ham', count: 2.5, unit: 'slice' }]);
    expect(parseMealText('2,5 slices ham')).toEqual([{ name: 'ham', count: 2.5, unit: 'slice' }]);
  });
});

describe('the plan\'s worked example with "and"', () => {
  it('parses "3 eggs, 30g cheddar and 2 rashers of bacon" into three items', () => {
    expect(parseMealText('3 eggs, 30g cheddar and 2 rashers of bacon')).toEqual([
      { name: 'eggs', count: 3 },
      { name: 'cheddar', grams: 30 },
      { name: 'bacon', count: 2, unit: 'rasher' },
    ]);
  });
});
