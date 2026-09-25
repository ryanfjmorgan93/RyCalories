import { describe, expect, it } from 'vitest';
import { MEAL_ESTIMATE_SYSTEM, MEAL_PHOTO_PROMPT, MEAL_PHOTO_SYSTEM, mealEstimatePrompt, parseMealAnalysis, parseMealEstimate } from './mealAnalysis';

describe('prompt text', () => {
  it('asks for JSON only, with plain generic ingredient names and no amounts or nutrition', () => {
    expect(MEAL_PHOTO_SYSTEM).toMatch(/JSON/);
    expect(MEAL_PHOTO_SYSTEM).toMatch(/dish/);
    expect(MEAL_PHOTO_SYSTEM).toMatch(/ingredients/);
    expect(MEAL_PHOTO_SYSTEM.toLowerCase()).toMatch(/no.*(amount|nutrition)|nutrition figures/);
    expect(MEAL_PHOTO_PROMPT).toMatch(/JSON/);
  });

  it('is short, for a small on-device model under a token budget', () => {
    expect(MEAL_PHOTO_SYSTEM.length).toBeLessThan(600);
    expect(MEAL_PHOTO_PROMPT.length).toBeLessThan(400);
  });
});

describe('parsing plain JSON', () => {
  it('parses a clean object with dish and ingredients', () => {
    const raw = '{"dish": "Omelette", "ingredients": ["egg", "cheddar", "bacon"]}';
    expect(parseMealAnalysis(raw)).toEqual({ dish: 'Omelette', ingredients: ['egg', 'cheddar', 'bacon'] });
  });

  it('parses an object with no dish', () => {
    const raw = '{"ingredients": ["rice", "chicken"]}';
    expect(parseMealAnalysis(raw)).toEqual({ ingredients: ['rice', 'chicken'] });
  });

  it('accepts a bare top-level array as the ingredient list', () => {
    expect(parseMealAnalysis('["egg", "cheddar"]')).toEqual({ ingredients: ['egg', 'cheddar'] });
  });
});

describe('finding JSON inside prose', () => {
  it('extracts an object embedded in surrounding text', () => {
    const raw = 'Here is what I see: {"dish": "Fry-up", "ingredients": ["bacon", "egg"]} — enjoy!';
    expect(parseMealAnalysis(raw)).toEqual({ dish: 'Fry-up', ingredients: ['bacon', 'egg'] });
  });

  it('extracts an object from a ```json fence', () => {
    const raw = 'Sure, here it is:\n```json\n{"dish": "Chilli", "ingredients": ["mince", "beans"]}\n```\nHope that helps.';
    expect(parseMealAnalysis(raw)).toEqual({ dish: 'Chilli', ingredients: ['mince', 'beans'] });
  });

  it('extracts an object from a bare fence with no "json" tag', () => {
    const raw = '```\n{"dish": "Salad", "ingredients": ["lettuce", "tomato"]}\n```';
    expect(parseMealAnalysis(raw)).toEqual({ dish: 'Salad', ingredients: ['lettuce', 'tomato'] });
  });

  it('extracts a bare array embedded in prose', () => {
    const raw = 'The ingredients are: ["egg", "bacon"] as far as I can tell.';
    expect(parseMealAnalysis(raw)).toEqual({ ingredients: ['egg', 'bacon'] });
  });
});

describe('garbage never throws and yields nothing', () => {
  it('handles plain prose with no JSON at all', () => {
    expect(parseMealAnalysis('I cannot see clearly what is in this photo, sorry.')).toEqual({ ingredients: [] });
  });

  it('handles an empty string', () => {
    expect(parseMealAnalysis('')).toEqual({ ingredients: [] });
  });

  it('handles malformed JSON', () => {
    expect(parseMealAnalysis('{"dish": "Omelette", "ingredients": [egg, cheddar]}')).toEqual({ ingredients: [] });
  });

  it('handles a JSON value that is neither an object nor an array', () => {
    expect(parseMealAnalysis('42')).toEqual({ ingredients: [] });
    expect(parseMealAnalysis('"just a string"')).toEqual({ ingredients: [] });
    expect(parseMealAnalysis('null')).toEqual({ ingredients: [] });
  });

  it('handles an object whose ingredients field is missing or the wrong type', () => {
    expect(parseMealAnalysis('{"dish": "Omelette"}')).toEqual({ dish: 'Omelette', ingredients: [] });
    expect(parseMealAnalysis('{"dish": "Omelette", "ingredients": "egg, cheddar"}')).toEqual({ dish: 'Omelette', ingredients: [] });
  });
});

describe('cleaning names', () => {
  it('trims whitespace and drops empty strings', () => {
    expect(parseMealAnalysis('{"ingredients": ["  egg  ", "", "   ", "bacon"]}')).toEqual({ ingredients: ['egg', 'bacon'] });
  });

  it('drops names longer than 40 characters', () => {
    const long = 'a'.repeat(41);
    const ok = 'a'.repeat(40);
    expect(parseMealAnalysis(JSON.stringify({ ingredients: [long, ok] }))).toEqual({ ingredients: [ok] });
  });

  it('drops non-string entries', () => {
    expect(parseMealAnalysis('{"ingredients": ["egg", 5, null, {"x":1}, ["nested"], true, "bacon"]}')).toEqual({
      ingredients: ['egg', 'bacon'],
    });
  });

  it('drops a dish name over 60 characters instead of truncating it', () => {
    const longDish = 'a'.repeat(61);
    expect(parseMealAnalysis(JSON.stringify({ dish: longDish, ingredients: ['egg'] }))).toEqual({ ingredients: ['egg'] });
  });

  it('drops a non-string dish', () => {
    expect(parseMealAnalysis('{"dish": 5, "ingredients": ["egg"]}')).toEqual({ ingredients: ['egg'] });
  });
});

describe('deduping case, whitespace and plural insensitively', () => {
  it('treats "egg" and "eggs" as the same ingredient', () => {
    expect(parseMealAnalysis('{"ingredients": ["egg", "Eggs", "EGG "]}')).toEqual({ ingredients: ['egg'] });
  });

  it('keeps the first-seen spelling', () => {
    expect(parseMealAnalysis('{"ingredients": ["Cheddar", "cheddar"]}')).toEqual({ ingredients: ['Cheddar'] });
  });

  it('does not fold unrelated words that merely share a prefix', () => {
    expect(parseMealAnalysis('{"ingredients": ["egg", "eggplant"]}')).toEqual({ ingredients: ['egg', 'eggplant'] });
  });
});

describe('capping at 12', () => {
  it('keeps only the first 12 distinct ingredients', () => {
    const names = Array.from({ length: 15 }, (_, i) => `ingredient${i}`);
    const result = parseMealAnalysis(JSON.stringify({ ingredients: names }));
    expect(result.ingredients).toHaveLength(12);
    expect(result.ingredients).toEqual(names.slice(0, 12));
  });

  it('caps after deduping, not before', () => {
    const names = ['egg', 'eggs', ...Array.from({ length: 14 }, (_, i) => `ingredient${i}`)];
    const result = parseMealAnalysis(JSON.stringify({ ingredients: names }));
    expect(result.ingredients).toHaveLength(12);
    expect(result.ingredients[0]).toBe('egg');
  });
});

describe('MEAL_ESTIMATE_SYSTEM and mealEstimatePrompt', () => {
  it('asks for JSON only, with plain generic component names, weights and no nutrition or commentary', () => {
    expect(MEAL_ESTIMATE_SYSTEM).toMatch(/JSON/);
    expect(MEAL_ESTIMATE_SYSTEM).toMatch(/dish/);
    expect(MEAL_ESTIMATE_SYSTEM).toMatch(/parts/);
    expect(MEAL_ESTIMATE_SYSTEM).toMatch(/grams/);
    expect(MEAL_ESTIMATE_SYSTEM.toLowerCase()).toMatch(/no.*nutrition|nutrition figures/);
    expect(MEAL_ESTIMATE_SYSTEM.length).toBeLessThan(700);
  });

  it('embeds the user\'s own text and asks for JSON only', () => {
    const prompt = mealEstimatePrompt('Five Guys double bacon cheeseburger');
    expect(prompt).toContain('Five Guys double bacon cheeseburger');
    expect(prompt).toMatch(/JSON/);
    expect(prompt).toMatch(/parts/);
  });
});

describe('parseMealEstimate', () => {
  it('parses a clean object with dish and parts', () => {
    const raw = '{"dish": "Cheeseburger", "parts": [{"name": "beef patty", "grams": 150}, {"name": "burger bun", "grams": 90}]}';
    expect(parseMealEstimate(raw)).toEqual({
      dish: 'Cheeseburger',
      parts: [
        { name: 'beef patty', grams: 150 },
        { name: 'burger bun', grams: 90 },
      ],
    });
  });

  it('parses an object with no dish', () => {
    expect(parseMealEstimate('{"parts": [{"name": "rice", "grams": 200}]}')).toEqual({ parts: [{ name: 'rice', grams: 200 }] });
  });

  it('accepts a bare top-level array as the part list', () => {
    expect(parseMealEstimate('[{"name": "egg", "grams": 50}]')).toEqual({ parts: [{ name: 'egg', grams: 50 }] });
  });

  it('extracts an object embedded in prose or a fence, same as parseMealAnalysis', () => {
    const prose = 'Here you go: {"dish": "Fry-up", "parts": [{"name": "bacon", "grams": 50}]} enjoy!';
    expect(parseMealEstimate(prose)).toEqual({ dish: 'Fry-up', parts: [{ name: 'bacon', grams: 50 }] });

    const fenced = '```json\n{"dish": "Chilli", "parts": [{"name": "mince", "grams": 300}]}\n```';
    expect(parseMealEstimate(fenced)).toEqual({ dish: 'Chilli', parts: [{ name: 'mince', grams: 300 }] });
  });

  it('drops a bad grams value to "no amount" rather than the whole part', () => {
    const raw = '{"parts": [{"name": "cheddar", "grams": "a lot"}, {"name": "bacon", "grams": -5}, {"name": "egg", "grams": 3001}, {"name": "mayo", "grams": 0}]}';
    expect(parseMealEstimate(raw)).toEqual({
      parts: [{ name: 'cheddar' }, { name: 'bacon' }, { name: 'egg' }, { name: 'mayo' }],
    });
  });

  it('accepts a grams value right up to the 3,000 g ceiling', () => {
    expect(parseMealEstimate('{"parts": [{"name": "family chilli", "grams": 3000}]}')).toEqual({ parts: [{ name: 'family chilli', grams: 3000 }] });
  });

  it('dedupes parts by normalised, plural-insensitive name, SUMMING their grams', () => {
    const raw = '{"dish": "Double cheeseburger", "parts": [{"name": "beef burger", "grams": 150}, {"name": "Beef burgers", "grams": 150}]}';
    expect(parseMealEstimate(raw)).toEqual({ dish: 'Double cheeseburger', parts: [{ name: 'beef burger', grams: 300 }] });
  });

  it('keeps a part with an amount when the duplicate that follows has none', () => {
    const raw = '{"parts": [{"name": "bacon", "grams": 50}, {"name": "bacon"}]}';
    expect(parseMealEstimate(raw)).toEqual({ parts: [{ name: 'bacon', grams: 50 }] });
  });

  it('caps at 12 distinct parts, after deduping', () => {
    const parts = [{ name: 'egg', grams: 50 }, { name: 'eggs', grams: 50 }, ...Array.from({ length: 14 }, (_, i) => ({ name: `part${i}`, grams: 10 }))];
    const result = parseMealEstimate(JSON.stringify({ parts }));
    expect(result.parts).toHaveLength(12);
    expect(result.parts[0]).toEqual({ name: 'egg', grams: 100 });
  });

  it('garbage never throws and yields nothing', () => {
    expect(parseMealEstimate('I could not follow that, sorry.')).toEqual({ parts: [] });
    expect(parseMealEstimate('')).toEqual({ parts: [] });
    expect(parseMealEstimate('{"dish": "X", "parts": [broken]}')).toEqual({ parts: [] });
    expect(parseMealEstimate('42')).toEqual({ parts: [] });
    expect(parseMealEstimate('{"dish": "X"}')).toEqual({ dish: 'X', parts: [] });
  });

  it('drops non-object part entries and parts with no usable name', () => {
    const raw = '{"parts": [{"name": "egg", "grams": 50}, "bacon", 5, null, {"grams": 30}, {"name": "", "grams": 10}]}';
    expect(parseMealEstimate(raw)).toEqual({ parts: [{ name: 'egg', grams: 50 }] });
  });
});
