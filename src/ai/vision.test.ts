/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClaude, lastUserText, text } from '@/test/fakeClaude';
import { clearApiKey, setApiKey } from './key';
import { spendThisMonth } from './spend';
import { resetMemory } from './store';
import { cleanMealItems, readInbodySheet, readLabelPhoto, readMealPhoto, readMealText, stripDataUrl } from './vision';

beforeEach(() => {
  localStorage.clear();
  resetMemory();
  setApiKey('sk-ant-api03-VISIONKEYVISIONKEYVISIONKEYvwxy');
});

const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD';
const json = (value: unknown) => text(JSON.stringify(value));

const MEAL = {
  items: [
    { name: 'Scrambled eggs', amount: 3, unit: 'eggs', grams: 150, kcal: 240, protein: 19, carbs: 2, fat: 17, confidence: 'high' },
    { name: 'Wholemeal toast', amount: 2, unit: 'slices', grams: 72, kcal: 170, protein: 7, carbs: 30, fat: 2, confidence: 'medium' },
  ],
};

describe('readMealPhoto', () => {
  it('sends the photo as a JPEG image with a structured-output schema and returns the items', async () => {
    const fake = fakeClaude({ content: [json(MEAL)], usage: { input_tokens: 1800, output_tokens: 250 } });
    const items = await readMealPhoto(`data:image/jpeg;base64,${JPEG}`, { fetch: fake.fetch });

    expect(items).toEqual([
      { name: 'Scrambled eggs', amount: 3, unit: 'eggs', grams: 150, kcal: 240, protein: 19, carbs: 2, fat: 17, confidence: 'high' },
      { name: 'Wholemeal toast', amount: 2, unit: 'slices', grams: 72, kcal: 170, protein: 7, carbs: 30, fat: 2, confidence: 'medium' },
    ]);

    const body = fake.requests[0]!.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    // The schema the API sees keeps the confidence enum and closes every object.
    const item = body.output_config.format.schema.properties.items.items;
    expect(item.properties.confidence.enum).toEqual(['low', 'medium', 'high']);
    expect(item.additionalProperties).toBe(false);
    expect(body.thinking).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    const content = body.messages[0].content as { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } });
    expect(content[1]!.type).toBe('text');
    expect(content[1]!.text).toContain('photo of a meal');
    expect(JSON.stringify(body.system)).toContain('You are reading, not coaching');
    expect(spendThisMonth()).toBeCloseTo(1800 * 2e-6 + 250 * 10e-6, 9);
  });

  it('returns nothing for a photo with no food', async () => {
    const fake = fakeClaude({ content: [json({ items: [] })] });
    expect(await readMealPhoto(JPEG, { fetch: fake.fetch })).toEqual([]);
  });

  it('corrects a calorie figure the macros contradict, and drops items whose numbers cannot be real', () => {
    const items = cleanMealItems([
      { name: 'Oily salmon', amount: 1, unit: 'fillet', grams: 150, kcal: 250, protein: 30, carbs: 0, fat: 30, confidence: 'low' },
      { name: '', amount: 1, unit: 'x', grams: 1, kcal: 1, protein: 0, carbs: 0, fat: 0, confidence: 'low' },
      { name: 'Negative', amount: 1, unit: 'x', grams: 1, kcal: -3, protein: 0, carbs: 0, fat: 0, confidence: 'low' },
      { name: 'Nothing eaten', amount: 0, unit: 'x', grams: 1, kcal: 100, protein: 0, carbs: 0, fat: 0, confidence: 'low' },
      { name: 'Banquet', amount: 1, unit: 'table', grams: 9000, kcal: 9000, protein: 0, carbs: 0, fat: 0, confidence: 'low' },
    ]);
    expect(items).toHaveLength(1);
    // 30 g protein + 30 g fat imply 390 kcal; 250 was stated.
    expect(items[0]).toMatchObject({ name: 'Oily salmon', kcal: 390 });
  });

  it('strips a data URL prefix from the image', () => {
    expect(stripDataUrl(`data:image/jpeg;base64,${JPEG}`)).toBe(JPEG);
    expect(stripDataUrl(` ${JPEG} `)).toBe(JPEG);
  });
});

describe('readMealText', () => {
  it('reads a described meal at low effort with no image', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    const items = await readMealText('three scrambled eggs and two slices of toast', { fetch: fake.fetch });
    expect(items.map((i) => i.name)).toEqual(['Scrambled eggs', 'Wholemeal toast']);
    const body = fake.requests[0]!.body;
    expect(body.output_config.effort).toBe('low');
    expect(typeof body.messages[0].content).toBe('string');
    expect(lastUserText(body)).toContain('three scrambled eggs and two slices of toast');
  });

  it('sends nothing for an empty description', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    expect(await readMealText('   ', { fetch: fake.fetch })).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('readLabelPhoto', () => {
  it('returns per-100 g values and the serving and pack weights', async () => {
    const fake = fakeClaude({
      content: [json({ name: 'Chicken fries', brand: 'Iceland', per100: { kcal: 232, protein: 14, carbs: 17, fat: 12 }, serving_grams: 100, pack_grams: 400 })],
    });
    const label = await readLabelPhoto(JPEG, { fetch: fake.fetch });
    expect(label).toEqual({ name: 'Chicken fries', brand: 'Iceland', per100: { kcal: 232, protein: 14, carbs: 17, fat: 12 }, servingGrams: 100, packGrams: 400 });
    const body = fake.requests[0]!.body;
    expect(body.output_config.format.schema.required).toEqual(['name', 'per100']);
    expect(body.messages[0].content[0].source.data).toBe(JPEG);
  });

  it('leaves out what the label did not give', async () => {
    const fake = fakeClaude({ content: [json({ name: 'Porridge oats', brand: '  ', per100: { kcal: 372, protein: 11, carbs: 60, fat: 8 }, serving_grams: 0 })] });
    expect(await readLabelPhoto(JPEG, { fetch: fake.fetch })).toEqual({ name: 'Porridge oats', per100: { kcal: 372, protein: 11, carbs: 60, fat: 8 } });
  });

  it('refuses numbers that cannot be per 100 g, with a line the owner can act on', async () => {
    const fake = fakeClaude({ content: [json({ name: 'Mystery', per100: { kcal: 3500, protein: 11, carbs: 60, fat: 8 } })] });
    await expect(readLabelPhoto(JPEG, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'other', message: expect.stringContaining('clearer photo') });
  });
});

describe('readInbodySheet', () => {
  it('maps the printed values to BodyScan\'s names', async () => {
    const fake = fakeClaude({
      content: [json({ date: '2026-09-14', weight_kg: 81.2, skeletal_muscle_kg: 38.1, body_fat_kg: 14.2, body_fat_pct: 17.5, bmr_kcal: 1820, visceral_fat_level: 5, inbody_score: 78 })],
    });
    expect(await readInbodySheet(JPEG, { fetch: fake.fetch })).toEqual({
      date: '2026-09-14',
      weightKg: 81.2,
      skeletalMuscleKg: 38.1,
      bodyFatKg: 14.2,
      bodyFatPct: 17.5,
      bmrKcal: 1820,
      visceralFatLevel: 5,
      inbodyScore: 78,
    });
    expect(fake.requests[0]!.body.output_config.effort).toBe('medium');
  });

  it('drops a measure that is outside anything a body can be, and a date that is not a date', async () => {
    const fake = fakeClaude({ content: [json({ date: '14/09/26', weight_kg: 4, body_fat_pct: 90, skeletal_muscle_kg: 38, ecw_ratio: 0.39 })] });
    expect(await readInbodySheet(JPEG, { fetch: fake.fetch })).toEqual({ skeletalMuscleKg: 38, ecwRatio: 0.39 });
  });

  it('returns an empty reading when the sheet could not be read', async () => {
    const fake = fakeClaude({ content: [json({})] });
    expect(await readInbodySheet(JPEG, { fetch: fake.fetch })).toEqual({});
  });
});

describe('when the answer is not what was asked for', () => {
  it.each([
    ['not JSON', text('Here is your meal: eggs and toast.')],
    ['the wrong shape', json({ food: [] })],
    ['a wrong type', json({ items: [{ name: 'Eggs', amount: 'three', unit: 'eggs', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, confidence: 'high' }] })],
    ['an unknown confidence', json({ items: [{ name: 'Eggs', amount: 3, unit: 'eggs', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, confidence: 'certain' }] })],
  ])('says so plainly for %s', async (_label, block) => {
    const fake = fakeClaude({ content: [block] });
    await expect(readMealPhoto(JPEG, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'other', message: expect.stringContaining('Try again') });
  });

  it('is a refusal, not a reading, when Claude declines', async () => {
    const fake = fakeClaude({ stop_reason: 'refusal', content: [] });
    await expect(readMealPhoto(JPEG, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('sends nothing with no key', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [json(MEAL)] });
    await expect(readMealPhoto(JPEG, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'no_key' });
    expect(fake.requests).toHaveLength(0);
  });
});
