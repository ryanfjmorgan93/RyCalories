import { beforeEach, describe, expect, it } from 'vitest';
import { addMeal, itemsForMeal, mealsOnDay, suggestFoods } from './foodRepo';
import { db } from './db';
import { deleteRecipe, getRecipe, listRecipes, logShare, saveRecipe } from './recipeRepo';
import { wipeAll } from './repo';
import { macrosOf } from '@/domain/food';
import { toDateKey } from '@/domain/dates';
import type { RecipeIngredient } from '@/domain/types';

const TODAY = toDateKey();

function eggs(overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: 'ri-eggs',
    name: 'Eggs',
    source: 'table',
    grams: 150,
    per100: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.9 },
    unit: { count: 3, unitGrams: 50, label: 'egg', plural: 'eggs' },
    ...overrides,
  };
}

function cheddar(overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: 'ri-cheddar',
    name: 'Cheddar',
    source: 'table',
    grams: 100,
    per100: { kcal: 416, protein: 25.4, carbs: 0.1, fat: 34.4 },
    ...overrides,
  };
}

/** An ingredient with no amount entered yet — a new card's starting state (see recipeIsComplete). */
function unfinished(): RecipeIngredient {
  return { id: 'ri-unfinished', name: 'Bacon', source: 'user', grams: 0, per100: { kcal: NaN, protein: NaN, carbs: NaN, fat: NaN } };
}

beforeEach(async () => {
  await wipeAll();
});

describe('saving a recipe', () => {
  it('round-trips through a save and a read back', async () => {
    const id = await saveRecipe({ name: 'Omelette', ingredients: [eggs(), cheddar()], portionsMade: 2 });
    const recipe = await getRecipe(id);
    expect(recipe?.name).toBe('Omelette');
    expect(recipe?.portionsMade).toBe(2);
    expect(recipe?.ingredients.map((i) => i.name)).toEqual(['Eggs', 'Cheddar']);
  });

  it('mints the id in JS before the write, and lists newest-updated first', async () => {
    const a = await saveRecipe({ name: 'A', ingredients: [eggs()], portionsMade: 1 });
    const b = await saveRecipe({ name: 'B', ingredients: [eggs()], portionsMade: 1 });
    expect(a).not.toBe(b);
    expect((await listRecipes()).map((r) => r.id)).toEqual([b, a]);
  });

  it('trims the name and falls back to Recipe for a blank one', async () => {
    const id = await saveRecipe({ name: '   ', ingredients: [eggs()], portionsMade: 1 });
    expect((await getRecipe(id))?.name).toBe('Recipe');
  });

  it('floors portionsMade at 1', async () => {
    const id = await saveRecipe({ name: 'Solo', ingredients: [eggs()], portionsMade: 0 });
    expect((await getRecipe(id))?.portionsMade).toBe(1);
  });

  it('keeps id and createdAt on an edit, and advances updatedAt', async () => {
    const id = await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 1 });
    const before = (await getRecipe(id))!;

    const edited = await saveRecipe({ id, name: 'Omelette v2', ingredients: [eggs(), cheddar()], portionsMade: 2 });
    const after = (await getRecipe(id))!;

    expect(edited).toBe(id);
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.name).toBe('Omelette v2');
    expect(after.ingredients).toHaveLength(2);
    expect(await db.recipes.count()).toBe(1); // one `put`, not a second row
  });

  it('refuses an incomplete recipe', async () => {
    await expect(saveRecipe({ name: 'Half-built', ingredients: [eggs(), unfinished()], portionsMade: 1 })).rejects.toThrow();
    expect(await db.recipes.count()).toBe(0);
  });

  it('refuses a recipe with no ingredients at all', async () => {
    await expect(saveRecipe({ name: 'Empty', ingredients: [], portionsMade: 1 })).rejects.toThrow();
  });

  it('remembers "3 eggs" as a FoodMemory row with unitGrams 50 and unitLabel egg', async () => {
    await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 1 });
    const remembered = await suggestFoods('egg');
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.unitGrams).toBe(50);
    expect(remembered[0]!.unitLabel).toBe('egg');
    expect(remembered[0]!.unitPlural).toBe('eggs');
    expect(remembered[0]!.per100).toEqual(eggs().per100);
  });

  it('remembers every ingredient, not only the one with a unit', async () => {
    await saveRecipe({ name: 'Omelette', ingredients: [eggs(), cheddar()], portionsMade: 1 });
    expect((await suggestFoods('')).map((f) => f.name).sort()).toEqual(['Cheddar', 'Eggs']);
  });
});

describe('deleting a recipe', () => {
  it('leaves logged items alone', async () => {
    const id = await saveRecipe({ name: 'Omelette', ingredients: [eggs(), cheddar()], portionsMade: 2 });
    const recipe = (await getRecipe(id))!;
    const mealId = await logShare({ recipe, share: { mode: 'portions', made: 2, eaten: 1 }, into: { newMeal: { date: TODAY } } });

    await deleteRecipe(id);

    expect(await getRecipe(id)).toBeUndefined();
    expect((await listRecipes())).toHaveLength(0);
    const items = await itemsForMeal(mealId);
    expect(items).toHaveLength(1);
    expect(items[0]!.recipeId).toBe(id); // the fact of where it came from survives the recipe's own deletion
  });

  it('does not mind being asked for a recipe that never existed', async () => {
    await expect(deleteRecipe('missing')).resolves.toBeUndefined();
  });
});

describe('logging a share', () => {
  it('portions 1 of 2 gives exactly half the unrounded total, not half of a rounded one', async () => {
    // 214.5 + 50 = 264.5 kcal total — deliberately not a round number, so a share taken from
    // ROUNDED per-ingredient figures (132 or 133, say) would disagree with the true half (132.25).
    const ingredients = [eggs({ grams: 150 }), cheddar({ grams: 12 })]; // 214.5 + 49.92 = 264.42
    const recipe = await getRecipe(await saveRecipe({ name: 'Omelette', ingredients, portionsMade: 2 }));
    const totalKcal = ingredients.reduce((sum, i) => sum + (i.per100.kcal * i.grams) / 100, 0);

    const mealId = await logShare({ recipe: recipe!, share: { mode: 'portions', made: 2, eaten: 1 }, into: { newMeal: { date: TODAY } } });
    const item = (await itemsForMeal(mealId))[0]!;

    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(totalKcal / 2, 9);
    expect(item.portion).toBe('1 of 2 portions');
  });

  it('weighing 300 g of a 900 g dish gives exactly a third', async () => {
    const ingredients = [eggs({ grams: 300 }), cheddar({ grams: 600 })]; // dish totals 900 g
    const recipe = (await getRecipe(await saveRecipe({ name: 'Bake', ingredients, portionsMade: 1 })))!;
    const totalKcal = ingredients.reduce((sum, i) => sum + (i.per100.kcal * i.grams) / 100, 0);

    const mealId = await logShare({ recipe, share: { mode: 'weigh', dishGrams: 900, plateGrams: 300 }, into: { newMeal: { date: TODAY } } });
    const item = (await itemsForMeal(mealId))[0]!;

    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(totalKcal / 3, 9);
    expect(item.portion).toBe('300 g of 900 g');
  });

  it('appends to an existing meal', async () => {
    const mealId = await addMeal({ name: 'Lunch', date: TODAY }, []);
    const recipe = (await getRecipe(await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 1 })))!;

    const returned = await logShare({ recipe, share: { mode: 'portions', made: 1, eaten: 1 }, into: { mealId } });

    expect(returned).toBe(mealId);
    const items = await itemsForMeal(mealId);
    expect(items).toHaveLength(1);
    expect(items[0]!.recipeId).toBe(recipe.id);
    expect(items[0]!.name).toBe('Omelette');
  });

  it('creates a new meal when none is given', async () => {
    const recipe = (await getRecipe(await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 1 })))!;

    const mealId = await logShare({ recipe, share: { mode: 'portions', made: 1, eaten: 1 }, into: { newMeal: { date: TODAY, slot: 'breakfast' } } });

    const day = await mealsOnDay(TODAY);
    expect(day.map((m) => m.meal.id)).toContain(mealId);
    const meal = day.find((m) => m.meal.id === mealId)!;
    expect(meal.meal.slot).toBe('breakfast');
    expect(meal.items[0]!.recipeId).toBe(recipe.id);
  });

  it('writes exactly one meal item for the share, however many ingredients the recipe has', async () => {
    const recipe = (await getRecipe(await saveRecipe({ name: 'Omelette', ingredients: [eggs(), cheddar()], portionsMade: 2 })))!;
    const mealId = await logShare({ recipe, share: { mode: 'portions', made: 2, eaten: 1 }, into: { newMeal: { date: TODAY } } });
    expect(await itemsForMeal(mealId)).toHaveLength(1);
  });

  it('refuses a zero share', async () => {
    const recipe = (await getRecipe(await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 2 })))!;
    await expect(logShare({ recipe, share: { mode: 'portions', made: 2, eaten: 0 }, into: { newMeal: { date: TODAY } } })).rejects.toThrow();
  });

  it('refuses an invalid share (zero portions made)', async () => {
    const recipe = (await getRecipe(await saveRecipe({ name: 'Omelette', ingredients: [eggs()], portionsMade: 2 })))!;
    await expect(logShare({ recipe, share: { mode: 'portions', made: 0, eaten: 1 }, into: { newMeal: { date: TODAY } } })).rejects.toThrow();
  });

  it('does not clamp a share above the whole recipe', async () => {
    // "Never a number that flatters": seconds are real, so eating 2 of 1 portion is allowed and
    // logs at double the recipe's total, not capped back to 100%.
    const ingredients = [eggs({ grams: 100 })];
    const recipe = (await getRecipe(await saveRecipe({ name: 'Solo egg', ingredients, portionsMade: 1 })))!;
    const totalKcal = (ingredients[0]!.per100.kcal * ingredients[0]!.grams) / 100;

    const mealId = await logShare({ recipe, share: { mode: 'portions', made: 1, eaten: 2 }, into: { newMeal: { date: TODAY } } });
    const item = (await itemsForMeal(mealId))[0]!;
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(totalKcal * 2, 9);
  });
});
