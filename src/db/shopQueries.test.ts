import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addMeal } from './foodRepo';
import { saveSettings, getSettings, wipeAll } from './repo';
import { loadShop, setShopFood, setShopLine } from './shopQueries';
import { fromPer100, fromPortion } from '@/domain/food';
import { memoryKey } from '@/domain/foodMemory';
import { lineFigures } from '@/domain/weeklyShop';

// Tuesday 17 November 2026: the window is 20 October to 16 November, the week shopped for 23 November.
const TODAY = '2026-11-17';
const CHICKEN = 'Chicken, thighs, casseroled, meat and skin'; // UK table 18-317, so Meat and fish
const RICE = 'Rice, white, basmati, raw'; // 11-857, so Cupboard

const per = (kcal: number, protein: number) => ({ kcal, protein, carbs: 0, fat: 0 });

async function eat(date: string, name: string, grams: number, kcal: number, protein: number, extra: object = {}) {
  await addMeal({ name: 'Lunch', slot: 'lunch', date }, [{ name, portion: `${grams} g`, nutrition: fromPer100(per(kcal, protein), grams), source: 'table', ...extra }]);
}

beforeEach(async () => {
  await wipeAll();
  await getSettings();
});

describe('loadShop', () => {
  it('learns from the 28 days before today, per logged day, without Claude\'s estimates', async () => {
    await eat('2026-11-10', CHICKEN, 200, 230, 25);
    await eat('2026-11-12', CHICKEN, 200, 230, 25);
    // A takeaway Claude estimated: a logged day, but nothing to buy.
    await addMeal({ name: 'Dinner', date: '2026-11-11' }, [{ name: 'Chicken burrito', portion: '1', nutrition: fromPortion(per(900, 40)), source: 'model' }]);
    await eat(TODAY, CHICKEN, 500, 230, 25); // today is still being eaten
    await eat('2026-10-19', CHICKEN, 500, 230, 25); // 29 days back: outside

    const shop = await loadShop(TODAY, await getSettings());
    expect(shop.week).toBe('2026-11-23');
    expect(shop.loggedDays).toBe(3);
    expect(shop.lines.map((l) => l.name)).toEqual([CHICKEN]);
    const [chicken] = shop.lines;
    expect(chicken!.week).toBeCloseTo((400 / 3) * 7);
    expect(chicken!.aisle).toBe('Meat and fish');
  });

  it('counts a recipe share as its ingredients, in proportion', async () => {
    await db.recipes.put({
      id: 'r1',
      name: 'Chicken and rice',
      portionsMade: 3,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      ingredients: [
        { id: 'i1', name: RICE, source: 'table', grams: 300, per100: per(350, 8) },
        { id: 'i2', name: CHICKEN, source: 'table', grams: 600, per100: per(230, 25) },
      ],
    });
    // A third of 1,050 + 1,380 kcal.
    await addMeal({ name: 'Dinner', date: '2026-11-16' }, [{ name: 'Chicken and rice', portion: '1 portion', nutrition: fromPortion(per(810, 58)), source: 'user', recipeId: 'r1' }]);

    const shop = await loadShop(TODAY, await getSettings());
    const byName = Object.fromEntries(shop.lines.map((l) => [l.name, l]));
    expect(byName[RICE]!.week).toBeCloseTo(100 * 7);
    expect(byName[RICE]!.aisle).toBe('Cupboard');
    expect(byName[CHICKEN]!.week).toBeCloseTo(200 * 7);
    expect(byName['Chicken and rice']).toBeUndefined();
  });

  it('takes the remembered pack, then the owner\'s fixes and this week\'s changes, and only this week\'s', async () => {
    await eat('2026-11-16', CHICKEN, 200, 230, 25, { units: { packGrams: 750 } });
    const key = memoryKey({ name: CHICKEN });
    let [line] = (await loadShop(TODAY, await getSettings())).lines;
    expect(line!.pack).toBe(750);
    expect(line!.packs).toBe(2);

    await setShopFood(key, { pack: 1000, aisle: 'Frozen' });
    await setShopLine('2026-11-23', key, { packs: 3, inAlready: true });
    [line] = (await loadShop(TODAY, await getSettings())).lines;
    expect(line).toMatchObject({ pack: 1000, aisle: 'Frozen', packs: 3, week: 3000, inAlready: true });

    // The Monday after, the next week starts fresh; the fixes stay.
    [line] = (await loadShop('2026-11-23', await getSettings())).lines;
    expect(line).toMatchObject({ pack: 1000, aisle: 'Frozen', inAlready: false });
  });

  it('reads the week\'s targets: each day\'s calories summed, protein × 7, and totals from the lines', async () => {
    await eat('2026-11-16', CHICKEN, 200, 230, 25);
    await saveSettings({ calorieStart: 2600, calorieStep: 0, calorieStartDate: '2026-11-01', proteinTarget: 190 });
    const shop = await loadShop(TODAY, await getSettings());
    expect(shop.targets).toEqual({ kcal: 18200, protein: 1330 });
    expect(shop.totals).toEqual(lineFigures(shop.lines[0]!));
  });

  it('has no calorie target before one is set', async () => {
    const s = await getSettings();
    await db.settings.put({ ...s, calorieStartDate: undefined });
    expect((await loadShop(TODAY, await getSettings())).targets.kcal).toBeNull();
  });
});
