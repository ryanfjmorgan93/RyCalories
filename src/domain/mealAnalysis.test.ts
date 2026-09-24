import { describe, expect, it } from 'vitest';
import { MEAL_PHOTO_PROMPT, MEAL_PHOTO_SYSTEM, parseMealAnalysis } from './mealAnalysis';

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
