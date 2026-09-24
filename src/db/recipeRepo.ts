/**
 * Recipes: cooked meals saved as ingredients + portions made, for one-tap reuse. The maths (share
 * fractions, portion-basis totals, completeness) lives in src/domain/recipe.ts — this module is
 * only IO: saving/listing/reading/deleting a `Recipe` row, teaching FoodMemory its ingredients, and
 * logging a share of it as an ordinary meal item.
 */
import { addItem, addMeal, rememberFood, type NewMealItem } from './foodRepo';
import { db } from './db';
import { nowIso } from '@/domain/dates';
import { fromPer100 } from '@/domain/food';
import { uuid } from '@/domain/ids';
import { combinedSource, recipeIsComplete, shareFraction, shareLabel, shareNutrition, type ShareInput } from '@/domain/recipe';
import type { MealSlot, Recipe, RecipeIngredient } from '@/domain/types';

export interface SaveRecipeInput {
  /** Present when editing an existing recipe (its id, minted when the recipe was first created).
   * Absent for a brand-new recipe — a fresh id is minted here, before the write. */
  id?: string;
  name: string;
  ingredients: RecipeIngredient[];
  portionsMade: number;
}

/**
 * Save a new or edited recipe as one `put` (the ingredients are embedded on the row, so this is
 * atomic — no child table). `createdAt` is kept across an edit; `updatedAt` always advances.
 *
 * Refuses an incomplete recipe with a plain `Error`. The builder UI disables Save until
 * `recipeIsComplete` is true — this is the backstop for anything that reaches here regardless.
 */
export async function saveRecipe(input: SaveRecipeInput): Promise<string> {
  if (!recipeIsComplete(input.ingredients)) {
    throw new Error('Cannot save a recipe until every ingredient has an amount and figures.');
  }
  const id = input.id ?? uuid();
  const now = nowIso();
  const existing = input.id ? await db.recipes.get(input.id) : undefined;
  const portionsMade = Number.isFinite(input.portionsMade) ? Math.max(1, input.portionsMade) : 1;
  const row: Recipe = {
    id,
    name: input.name.trim() || 'Recipe',
    ingredients: input.ingredients,
    portionsMade,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.recipes.put(row);
  // After the commit, never inside it: remembering ingredients is a convenience and must not be
  // able to fail (or roll back) the save the user actually asked for — same reasoning as
  // foodRepo.addMeal remembering its items only once they are safely written.
  await rememberIngredients(row.ingredients);
  return id;
}

/** Every saved recipe, newest-updated first. */
export async function listRecipes(): Promise<Recipe[]> {
  return (await db.recipes.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  return db.recipes.get(id);
}

/**
 * Delete a recipe. Logged meal items are facts about what was eaten, not references that must stay
 * valid — `MealItem.recipeId` is deliberately unindexed and never cascaded to, so deleting a recipe
 * never touches anything already logged from it (see the field's doc comment in domain/types.ts).
 */
export async function deleteRecipe(id: string): Promise<void> {
  await db.recipes.delete(id);
}

/**
 * Teach FoodMemory every ingredient's per-100g figures and, for a count-style amount, its unit
 * weight — saving a recipe with "3 eggs" at 50 g each creates or updates a FoodMemory row carrying
 * `unitGrams: 50` and `unitLabel: 'egg'`, via the same `rememberFood` a logged meal item uses.
 * Best-effort per ingredient: one bad row must not lose the memory of the others, and none of this
 * can undo the recipe save that already committed.
 */
async function rememberIngredients(ings: RecipeIngredient[]): Promise<void> {
  for (const i of ings) {
    try {
      await rememberFood({
        name: i.name,
        portion: `${i.grams} g`,
        ...(i.brand ? { brand: i.brand } : {}),
        ...(i.product ? { product: i.product } : {}),
        source: i.source,
        nutrition: fromPer100(i.per100, i.grams),
        ...(i.unit ? { unit: i.unit } : {}),
      });
    } catch {
      /* best-effort, per ingredient — see doc comment above */
    }
  }
}

export type LogShareTarget = { mealId: string } | { newMeal: { date: string; slot?: MealSlot; name?: string } };

export interface LogShareInput {
  recipe: Recipe;
  share: ShareInput;
  into: LogShareTarget;
}

/**
 * The single meal item a share of `recipe` represents, at portion basis — see domain/recipe.ts's
 * `shareNutrition` for why a cooked dish's share is scaled from its exact totals rather than from
 * any single ingredient's weighed figure. This is the one thing `logShare` writes; split out so
 * the recipe builder's unsaved `NewMeal` (held in local state until Save, same as `MealEditScreen`)
 * can append a share to its in-memory item list with no database write at all.
 *
 * Throws a plain `Error` when the share itself makes no sense (an invalid or exactly zero
 * fraction) — logging "0 of 2 portions" would produce a meal item worth nothing, silently.
 */
export function shareItem(recipe: Recipe, share: ShareInput): NewMealItem {
  const fraction = shareFraction(share);
  if (!fraction) throw new Error('Cannot log a zero, or invalid, share of this recipe.');
  return {
    name: recipe.name,
    portion: shareLabel(share),
    nutrition: shareNutrition(recipe.ingredients, fraction),
    source: combinedSource(recipe.ingredients.map((i) => i.source)),
    recipeId: recipe.id,
  };
}

/**
 * Log a share of a recipe as ONE meal item. Writes through the existing `addItem`/`addMeal`, so it
 * gets their transactional guarantees (an existing meal gains one item; a new meal is created with
 * its one item in the same transaction) for free. Returns the meal id logged into.
 */
export async function logShare(input: LogShareInput): Promise<string> {
  const item = shareItem(input.recipe, input.share);

  if ('mealId' in input.into) {
    await addItem(input.into.mealId, item);
    return input.into.mealId;
  }
  const { date, slot, name } = input.into.newMeal;
  return addMeal({ name: name ?? input.recipe.name, date, slot }, [item]);
}
