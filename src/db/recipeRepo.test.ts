import { beforeEach, describe, expect, it } from 'vitest';
import { addMeal, itemsForMeal, mealsOnDay, suggestFoods } from './foodRepo';
import { db } from './db';
import { deleteRecipe, getRecipe, listRecipes, logShare, saveRecipe, shareItem } from './recipeRepo';
import { wipeAll } from './repo';
import { macrosOf } from '@/domain/food';
import { recipeDisplayTotals } from '@/domain/recipe';
import { toDateKey } from '@/domain/dates';
import type { Recipe, RecipeIngredient } from '@/domain/types';

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

/** A plain in-memory Recipe — no database involved, for shareItem's pure tests. */
function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    name: 'Omelette',
    ingredients: [eggs(), cheddar()],
    portionsMade: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await wipeAll();
});

describe('shareItem', () => {
  it('is the exact item logShare writes — same name, portion, macros, source and recipeId', () => {
    const r = recipe();
    const item = shareItem(r, { mode: 'portions', made: 2, eaten: 1 });
    expect(item.name).toBe('Omelette');
    expect(item.portion).toBe('1 of 2 portions');
    expect(item.recipeId).toBe('r1');
    expect(item.source).toBe('table'); // both ingredients are source 'table'
    // Eggs 150g @ 143 kcal/100g = 214.5, shown 215; cheddar 100g @ 416 kcal/100g = 416. Half of
    // the 631 the review shows — not of the unrounded 630.5.
    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(315.5, 6);
  });

  it('needs no database at all — usable on MealEditScreen\'s unsaved NewMeal', () => {
    const r = recipe({ id: 'unsaved-recipe' });
    const item = shareItem(r, { mode: 'weigh', dishGrams: 900, plateGrams: 300 });
    expect(item.portion).toBe('300 g of 900 g');
    expect(item.recipeId).toBe('unsaved-recipe');
  });

  it('throws for a zero or invalid share, the same as logShare does', () => {
    const r = recipe();
    expect(() => shareItem(r, { mode: 'portions', made: 2, eaten: 0 })).toThrow();
    expect(() => shareItem(r, { mode: 'portions', made: 0, eaten: 1 })).toThrow();
  });
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

  it('never teaches typicalGrams from an ingredient\'s batch weight — a memory first created by a recipe save has none', async () => {
    // 900 g of mince for the whole "Family chilli", not a portion anyone ate.
    const mince: RecipeIngredient = {
      id: 'ri-mince',
      name: 'Beef mince',
      source: 'table',
      grams: 900,
      per100: { kcal: 250, protein: 26, carbs: 0, fat: 17 },
    };
    await saveRecipe({ name: 'Family chilli', ingredients: [mince], portionsMade: 6 });
    const remembered = (await suggestFoods('beef mince'))[0]!;
    expect(remembered.per100).toEqual(mince.per100); // the per-100g figures are still learned
    expect(remembered.typicalGrams).toBeUndefined();
  });

  it('does not overwrite an existing typicalGrams (from a real logged portion) with a recipe\'s batch weight', async () => {
    // A single 150 g serving of beef mince, logged plainly before this recipe ever existed.
    await addMeal({ name: 'Fry-up', date: TODAY }, [
      { name: 'Beef mince', portion: '150 g', source: 'user', nutrition: { basis: 'weighed', grams: 150, per100: { kcal: 250, protein: 26, carbs: 0, fat: 17 } } },
    ]);
    expect((await suggestFoods('beef mince'))[0]!.typicalGrams).toBe(150);

    const mince: RecipeIngredient = {
      id: 'ri-mince',
      name: 'Beef mince',
      source: 'table',
      grams: 900,
      per100: { kcal: 250, protein: 26, carbs: 0, fat: 17 },
    };
    await saveRecipe({ name: 'Family chilli', ingredients: [mince], portionsMade: 6 });

    expect((await suggestFoods('beef mince'))[0]!.typicalGrams).toBe(150); // untouched by the 900 g batch
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
  it('portions 1 of 2 gives exactly half the total the review shows', async () => {
    // 214.5 + 49.92 = 264.42 kcal unrounded; the rows show 215 + 50 = 265. Half of what is shown.
    const ingredients = [eggs({ grams: 150 }), cheddar({ grams: 12 })];
    const recipe = await getRecipe(await saveRecipe({ name: 'Omelette', ingredients, portionsMade: 2 }));
    const shownKcal = recipeDisplayTotals(ingredients).kcal;

    const mealId = await logShare({ recipe: recipe!, share: { mode: 'portions', made: 2, eaten: 1 }, into: { newMeal: { date: TODAY } } });
    const item = (await itemsForMeal(mealId))[0]!;

    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(shownKcal / 2, 9);
    expect(item.portion).toBe('1 of 2 portions');
  });

  it('weighing 300 g of a 900 g dish gives exactly a third of the total shown', async () => {
    const ingredients = [eggs({ grams: 300 }), cheddar({ grams: 600 })]; // dish totals 900 g
    const recipe = (await getRecipe(await saveRecipe({ name: 'Bake', ingredients, portionsMade: 1 })))!;
    const shownKcal = recipeDisplayTotals(ingredients).kcal;

    const mealId = await logShare({ recipe, share: { mode: 'weigh', dishGrams: 900, plateGrams: 300 }, into: { newMeal: { date: TODAY } } });
    const item = (await itemsForMeal(mealId))[0]!;

    expect(macrosOf(item.nutrition).kcal).toBeCloseTo(shownKcal / 3, 9);
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
