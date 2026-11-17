/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addMeal } from '@/db/foodRepo';
import { getSettings, resetToSeed } from '@/db/repo';
import { dietScore, type DietAnswer } from '@/domain/dietCheck';
import { fromPortion } from '@/domain/food';
import { fakeClaude, lastUserText, offlineFetch, systemText, text } from '@/test/fakeClaude';
import { checkDiet, DIET_SCHEMA, TOO_FEW_DAYS } from './dietCheck';
import { setApiKey } from './key';
import { strictSchemaProblems } from './schema';
import { spendThisMonth } from './spend';
import { resetMemory } from './store';

const KEY = 'sk-ant-api03-DIETKEYDIETKEYDIETKEYDIETKEYDIETqrst';
const NOW = new Date(2026, 10, 17, 12, 0, 0);

const ANSWER: DietAnswer = {
  headline: 'Calories and protein are sorted.',
  detail: 'The points are in veg and fibre.',
  whole_foods: { points: 19, line: 'Mostly plain meat and rice.' },
  fruit_veg: { points: 9, line: '≈ 2 portions a day.' },
  fibre: { points: 12, line: '≈ 16 g a day.' },
  processed_salt: { points: 14, line: 'Processed meat most days.' },
  working: ['Protein at every meal.'],
  add: [{ what: 'Frozen broccoli, 150 g', why: 'Fibre for ≈ 50 kcal.' }],
  cut: [],
  regulars: [
    { name: 'Fridge Raiders', verdict: 'fine', body_fat: 'It will not put fat round your stomach.', the_catch: 'Salty.', better: 'Chicken pieces.' },
    { name: 'Made-up food', verdict: 'cut', body_fat: 'Not in the diary.', the_catch: '', better: '' },
  ],
};

async function eat(day: number, name = 'Fridge Raiders') {
  await addMeal({ name: 'Snack', date: `2026-11-${String(day).padStart(2, '0')}` }, [{ name, portion: '1 pack', nutrition: fromPortion({ kcal: 110, protein: 13, carbs: 1, fat: 6 }), source: 'label' }]);
}

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  setApiKey(KEY);
  await resetToSeed();
  await db.meals.clear();
  await db.mealItems.clear();
});

describe('checkDiet', () => {
  it('sends the diary to Sonnet 5.5 for a structured answer, cleans it and keeps it', async () => {
    for (const d of [14, 15, 16]) await eat(d);
    const fake = fakeClaude({ content: [text(JSON.stringify(ANSWER))], usage: { input_tokens: 7000, output_tokens: 900 } });
    const check = await checkDiet({ fetch: fake.fetch, now: NOW });

    expect(dietScore(check)).toBe(54);
    expect(check.loggedDays).toBe(3);
    // Only the food that is in the diary, with the diary's count.
    expect(check.regulars).toEqual([expect.objectContaining({ name: 'Fridge Raiders', times: 3, verdict: 'fine' })]);
    expect((await getSettings()).dietCheck).toEqual(check);

    const body = fake.requests[0]!.body;
    expect(fake.requests).toHaveLength(1);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(systemText(body)).toContain('This is the diet check');
    expect(lastUserText(body)).toContain('3 of 28 days logged');
    expect(lastUserText(body)).toContain('- Fridge Raiders: 3 times on 3 days · usually 1 pack · each 110 kcal');
    expect(spendThisMonth()).toBeGreaterThan(0);
  });

  it('asks nothing with too few logged days', async () => {
    await eat(16);
    const fake = fakeClaude({ content: [text(JSON.stringify(ANSWER))] });
    await expect(checkDiet({ fetch: fake.fetch, now: NOW })).rejects.toMatchObject({ kind: 'other', message: TOO_FEW_DAYS });
    expect(fake.requests).toHaveLength(0);
  });

  it('keeps nothing when the answer cannot be read, or the call fails, and does not retry', async () => {
    for (const d of [14, 15, 16]) await eat(d);
    const garbled = fakeClaude({ content: [text('Here is my reading of your diet.')] });
    await expect(checkDiet({ fetch: garbled.fetch, now: NOW })).rejects.toMatchObject({ kind: 'other' });
    const down = offlineFetch();
    await expect(checkDiet({ fetch: down.fetch, now: NOW })).rejects.toMatchObject({ kind: 'offline' });
    expect(down.requests).toHaveLength(1);
    expect((await getSettings()).dietCheck).toBeUndefined();
  });

  it('uses a schema strict output accepts', () => {
    expect(strictSchemaProblems(DIET_SCHEMA).problems).toEqual([]);
  });
});
