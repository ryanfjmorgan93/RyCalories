/**
 * @vitest-environment jsdom
 */
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_ERROR_MESSAGES, ClaudeError, type ClaudeErrorKind } from '@/ai/client';
import { clearApiKey, setApiKey } from '@/ai/key';
import { setCap } from '@/ai/spend';
import { resetMemory } from '@/ai/store';
import { db } from '@/db/db';
import { getMeal, undoLoggedItems } from '@/db/foodRepo';
import { lookupBarcode, rememberBarcodeLabel } from '@/db/productRepo';
import { wipeAll } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { macrosOf } from '@/domain/food';
import { fakeClaude, lastUserText, text } from '@/test/fakeClaude';
import { blockedLine, foodErrorLine, keepMealPhoto, logMealText, logReadings, readFailureLine, sweepKeptPhotos, type ReadKind } from './claudeFood';

const KEY = 'sk-ant-api03-FOODKEYFOODKEYFOODKEYFOODkeyz';
const TODAY = toDateKey();

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  setApiKey(KEY);
  await wipeAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const json = (value: unknown) => text(JSON.stringify(value));

describe('the line for a failure', () => {
  it('says what to do instead when Claude cannot be asked right now', () => {
    expect(foodErrorLine('no_key', 'photo')).toBe('Add your Claude key in Settings to log from a photo.');
    expect(foodErrorLine('offline', 'photo')).toBe('Photos need signal. Search or scan instead.');
    expect(foodErrorLine('over_cap', 'photo')).toBe(`${CLAUDE_ERROR_MESSAGES.over_cap} Search or scan instead.`);

    expect(foodErrorLine('no_key', 'describe')).toContain('describing');
    expect(foodErrorLine('offline', 'describe')).toBe('Describing a meal needs signal. Search or scan instead.');

    expect(foodErrorLine('no_key', 'label')).toBe('Add your Claude key in Settings to read a label.');
    expect(foodErrorLine('offline', 'label')).toBe('Reading a label needs signal. Type it in instead.');
    expect(foodErrorLine('over_cap', 'label')).toMatch(/Type it in instead\.$/);

    expect(foodErrorLine('no_key', 'sheet')).toContain('photo of the sheet');
    expect(foodErrorLine('offline', 'sheet')).toBe('Reading a photo needs signal. Import the file instead.');
  });

  it("keeps Claude's own plain message for the rest, and never goes blank", () => {
    const kinds: ClaudeErrorKind[] = ['bad_key', 'busy', 'refused', 'other'];
    const reads: ReadKind[] = ['photo', 'describe', 'label', 'sheet'];
    for (const kind of kinds) {
      for (const what of reads) {
        expect(foodErrorLine(kind, what)).toBe(CLAUDE_ERROR_MESSAGES[kind]);
      }
    }
    expect(foodErrorLine('other', 'label', "I couldn't read the numbers on that label. Try a clearer photo.")).toBe(
      "I couldn't read the numbers on that label. Try a clearer photo.",
    );
  });

  it('reads any thrown value as its line', () => {
    expect(readFailureLine(new ClaudeError('offline'), 'photo')).toBe('Photos need signal. Search or scan instead.');
    expect(readFailureLine(new Anthropic.APIConnectionError({ message: 'down' }), 'photo')).toBe('Photos need signal. Search or scan instead.');
    expect(readFailureLine(new ClaudeError('other', 'Stopped.'), 'photo')).toBe('Stopped.');
    expect(readFailureLine(new Error('boom'), 'describe')).toBe(CLAUDE_ERROR_MESSAGES.other);
    // Nothing in the line can carry the key.
    expect(readFailureLine(new Error(`bad ${KEY}`), 'describe')).not.toContain(KEY);
  });

  it('is said before the camera opens: no key, no signal, the cap, and nothing when all is well', () => {
    expect(blockedLine('photo')).toBeNull();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(blockedLine('photo')).toBe('Photos need signal. Search or scan instead.');
    vi.restoreAllMocks();

    setCap(0);
    expect(blockedLine('photo')).toContain('paused until the 1st');
    setCap(15);

    clearApiKey();
    expect(blockedLine('photo')).toBe('Add your Claude key in Settings to log from a photo.');
    expect(blockedLine('describe')).toContain('Add your Claude key in Settings');
  });
});

describe('logging what was described', () => {
  const MEAL = {
    items: [
      { name: 'Egg', amount: 2, unit: 'eggs', grams: 100, kcal: 150, protein: 12, carbs: 1, fat: 10, confidence: 'high' },
      { name: 'Sourdough toast', amount: 2, unit: 'slices', grams: 80, kcal: 210, protein: 8, carbs: 40, fat: 1, confidence: 'medium' },
    ],
  };

  it('puts every item on the day under the slot, known foods on their own figures, with the words kept', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    const result = await logMealText('two eggs on sourdough toast', { date: TODAY, slot: 'breakfast' }, () => false, { fetch: fake.fetch });

    expect(lastUserText(fake.requests[0]!.body)).toContain('two eggs on sourdough toast');
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    // The egg is the UK table's 131 kcal per 100 g (not Claude's 150); the toast is Claude's 210.
    expect(result!.kcal).toBe(131 + 210);
    expect(result!.items.map((i) => i.source)).toEqual(['table', 'model']);

    const meal = await getMeal(result!.logged.mealId);
    expect(meal!.meal).toMatchObject({ slot: 'breakfast', date: TODAY, enteredText: 'two eggs on sourdough toast', confidence: 'medium' });
    expect(meal!.meal.photoPath).toBeUndefined();
    expect(meal!.items.map((i) => i.name)).toEqual(['Eggs, chicken, whole, raw', 'Sourdough toast']);
    expect(meal!.items.map((i) => i.portion)).toEqual(['≈ 2 eggs (100 g)', '≈ 2 slices (80 g)']);
    expect(macrosOf(meal!.items[0]!.nutrition).kcal).toBeCloseTo(131, 6);
    expect(meal!.macros.kcal).toBe(341);
  });

  it('remembers the foods, the estimate as an estimate', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    await logMealText('eggs and toast', { date: TODAY, slot: 'lunch' }, () => false, { fetch: fake.fetch });
    const foods = await db.foods.toArray();
    expect(foods.find((f) => f.name === 'Sourdough toast')).toMatchObject({ source: 'model', unitGrams: 40 });
    expect(foods.find((f) => f.name === 'Eggs, chicken, whole, raw')).toMatchObject({ source: 'table' });
  });

  it("logs a cooked plate as Claude's estimate when the owner's own food of that name is the raw one, and leaves theirs untouched", async () => {
    // The owner's "Rice" is the dry grain off the pack (360 kcal per 100 g). Claude saw a bowl of
    // cooked rice; taking the owner's figure for 180 g of it would log ~648 kcal instead of ~234.
    const raw = { id: 'rice1', key: 'n:rice', name: 'Rice', per100: { kcal: 360, protein: 7, carbs: 79, fat: 0.6 }, source: 'user' as const, typicalGrams: 75, timesUsed: 4, lastUsedAt: '2026-10-01T08:00:00.000Z' };
    await db.foods.put(raw);
    const cooked = { items: [{ name: 'Rice', amount: 1, unit: 'bowl', grams: 180, kcal: 234, protein: 5, carbs: 52, fat: 0.5, confidence: 'medium' }] };
    const fake = fakeClaude({ content: [json(cooked)] });
    const result = await logMealText('a bowl of rice', { date: TODAY, slot: 'dinner' }, () => false, { fetch: fake.fetch });

    expect(result!.items.map((i) => i.source)).toEqual(['model']);
    expect(result!.kcal).toBe(234);
    const meal = await getMeal(result!.logged.mealId);
    expect(meal!.items[0]).toMatchObject({ name: 'Rice', source: 'model', portion: '≈ 1 bowl (180 g)' });
    expect(meal!.macros.kcal).toBe(234);

    // The owner's food is exactly as it was: not a figure, not a usual portion, not a new unit, not a use.
    expect(await db.foods.toArray()).toEqual([raw]);
  });

  it('can be undone, taking the meal with it', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    const result = await logMealText('eggs and toast', { date: TODAY, slot: 'dinner' }, () => false, { fetch: fake.fetch });
    await undoLoggedItems(result!.logged);
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
  });

  it('adds to the slot rather than starting a second meal, and keeps what the first one had', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    const first = await logMealText('eggs and toast', { date: TODAY, slot: 'lunch' }, () => false, { fetch: fake.fetch });
    const second = await logMealText('more toast', { date: TODAY, slot: 'lunch' }, () => false, { fetch: fake.fetch });
    expect(second!.logged.mealId).toBe(first!.logged.mealId);
    expect(second!.logged.createdMeal).toBe(false);
    expect(await db.mealItems.count()).toBe(4);
    expect((await getMeal(first!.logged.mealId))!.meal.enteredText).toBe('eggs and toast');
  });

  it('logs nothing once the owner has cancelled', async () => {
    const fake = fakeClaude({ content: [json(MEAL)] });
    expect(await logMealText('eggs and toast', { date: TODAY, slot: 'lunch' }, () => true, { fetch: fake.fetch })).toBeNull();
    expect(await db.meals.count()).toBe(0);
  });

  it('says so when there was no food in it, and when there was nothing said', async () => {
    const fake = fakeClaude({ content: [json({ items: [] })] });
    await expect(logMealText('hmm', { date: TODAY, slot: 'lunch' }, () => false, { fetch: fake.fetch })).rejects.toThrow(/couldn't find any food/);
    await expect(logMealText('   ', { date: TODAY, slot: 'lunch' })).rejects.toThrow(/Say or type what you ate/);
    expect(await db.meals.count()).toBe(0);
  });

  it('fails with the plain line, and logs nothing, when Claude cannot be reached', async () => {
    const fake = fakeClaude({ status: 529, error: { type: 'overloaded_error', message: 'busy' } });
    const failure = await logMealText('eggs', { date: TODAY, slot: 'lunch' }, () => false, { fetch: fake.fetch }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ClaudeError);
    expect(readFailureLine(failure, 'describe')).toBe(CLAUDE_ERROR_MESSAGES.busy);
    expect(await db.meals.count()).toBe(0);
  });
});

describe('a label remembered against its barcode', () => {
  const LABEL = { code: '', brand: 'Tesco', name: 'Chicken Breast Fillets', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, packGrams: 400 };

  it('is found by the next scan with no connection at all', async () => {
    expect(await rememberBarcodeLabel('5000000009999', LABEL)).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const found = await lookupBarcode('5000000009999');
    expect(found.from).toBe('cache');
    expect(found.label).toMatchObject({ code: '5000000009999', brand: 'Tesco', name: 'Chicken Breast Fillets', packGrams: 400 });
  });

  it('replaces the cached miss that sent the owner to photograph it', async () => {
    await db.productCache.put({ key: 'code:5000000009999', per100: null, missVersion: 2, fetchedAt: new Date().toISOString() });
    expect((await lookupBarcode('5000000009999')).from).toBe('cache');
    expect((await lookupBarcode('5000000009999')).label).toBeNull();
    await rememberBarcodeLabel('5000000009999', LABEL);
    expect((await lookupBarcode('5000000009999')).label?.name).toBe('Chicken Breast Fillets');
  });

  it('needs a real barcode', async () => {
    expect(await rememberBarcodeLabel('12', LABEL)).toBe(false);
    expect(await rememberBarcodeLabel('', LABEL)).toBe(false);
    expect(await db.productCache.count()).toBe(0);
  });
});

describe('kept meal photos', () => {
  const IMAGE = { base64: 'AAAA', cachePath: 'meal-photos/x.jpg' };

  it('are kept under the data directory, and swept once no meal points at them', async () => {
    const path = await keepMealPhoto(IMAGE);
    expect(path).toMatch(/^meals\/[0-9a-f-]+\.jpg$/);

    // A meal owns it: a sweep an hour on leaves it.
    await db.meals.put({ id: 'm1', date: TODAY, loggedAt: new Date().toISOString(), name: 'Dinner', slot: 'dinner', photoPath: path! });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await sweepKeptPhotos();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    expect((await Filesystem.readdir({ path: 'meals', directory: Directory.Data })).files).toHaveLength(1);

    // The meal goes (undone, deleted): the next sweep takes the photo.
    await db.meals.delete('m1');
    await sweepKeptPhotos();
    expect((await Filesystem.readdir({ path: 'meals', directory: Directory.Data })).files).toHaveLength(0);
  });

  it('are kept when the photographed meal is logged into a slot that already has a meal', async () => {
    // Dinner already exists (typed earlier); the photo is of more food for it. The photo used to
    // be written only when the call created the meal, so here it was orphaned and swept.
    await db.meals.put({ id: 'dinner1', date: TODAY, loggedAt: new Date().toISOString(), name: 'Dinner', slot: 'dinner' });
    const path = await keepMealPhoto(IMAGE);
    const readings = [{ name: 'Sourdough toast', amount: 2, unit: 'slices', grams: 80, kcal: 210, protein: 8, carbs: 40, fat: 1, confidence: 'medium' as const }];
    const result = await logReadings({ date: TODAY, slot: 'dinner' }, readings, { enteredText: 'toast', photoPath: path! });
    expect(result.logged).toMatchObject({ mealId: 'dinner1', createdMeal: false });
    expect((await getMeal('dinner1'))!.meal.photoPath).toBe(path);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await sweepKeptPhotos();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    expect((await Filesystem.readdir({ path: 'meals', directory: Directory.Data })).files.map((f) => `meals/${f.name}`)).toEqual([path]);

    // Taking the log back takes the photo off the meal, and the next sweep removes the file.
    await undoLoggedItems(result.logged);
    expect((await getMeal('dinner1'))!.meal.photoPath).toBeUndefined();
    await sweepKeptPhotos();
    expect((await Filesystem.readdir({ path: 'meals', directory: Directory.Data })).files).toHaveLength(0);
  });

  it('are not swept in the first minutes, when their meal may not be written yet', async () => {
    const path = await keepMealPhoto(IMAGE);
    await sweepKeptPhotos();
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const left = await Filesystem.readdir({ path: 'meals', directory: Directory.Data });
    expect(left.files.map((f) => `meals/${f.name}`)).toEqual([path]);
  });
});
