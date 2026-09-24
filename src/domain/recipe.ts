/**
 * Cooked meals: a recipe's ingredients, its totals, and what "my share of it" comes to.
 * Pure functions only — no IO, no clock, no database.
 *
 * An ingredient's weight (`RecipeIngredient.grams`) is always the resolved total for that
 * ingredient in the recipe — never a per-portion figure. What is eaten of the *recipe* is a
 * fraction applied afterwards, at portion basis (see `shareNutrition`), because a raw-ingredient
 * gram weight on a cooked, mixed plate would mislead: 300 g of finished chilli is not 300 g of
 * raw mince.
 */

import { addMacros, displayMacros, fromPer100, fromPortion, macrosOf, scaleMacros, trustOf, ZERO, type FoodSource, type Macros, type Nutrition } from './food';
import type { RecipeIngredient } from './types';
import { fmtNum, plural } from './format';

/** Grams for a count-style amount — "3 eggs" at 50 g each. Never negative. */
export function countToGrams(count: number, unitGrams: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(unitGrams)) return 0;
  return Math.max(0, count) * Math.max(0, unitGrams);
}

/** One ingredient's macros for the weight actually recorded on it. */
export function ingredientMacros(i: RecipeIngredient): Macros {
  return macrosOf(fromPer100(i.per100, i.grams));
}

/** Total weight of the recipe, in grams. */
export function recipeTotalGrams(ings: RecipeIngredient[]): number {
  return ings.reduce((sum, i) => sum + i.grams, 0);
}

/**
 * The recipe's totals at display precision: round each ingredient's macros then sum, exactly the
 * way `foodRepo.sumItems` totals a meal's items from `displayMacros`. Doing it the other way round
 * — summing the exact figures and rounding once — produces a total that disagrees with the sum of
 * the rounded rows shown next to it, which is a maths error as far as anyone reading it is
 * concerned (see `displayMacros`'s doc comment in `./food`).
 */
export function recipeDisplayTotals(ings: RecipeIngredient[]): Macros {
  return ings.reduce((acc, i) => addMacros(acc, displayMacros(fromPer100(i.per100, i.grams))), ZERO);
}

function isFiniteMacros(m: Macros): boolean {
  return Number.isFinite(m.kcal) && Number.isFinite(m.protein) && Number.isFinite(m.carbs) && Number.isFinite(m.fat);
}

/**
 * Whether the recipe is ready to save. True only when there is at least one ingredient and every
 * one of them has a resolved weight and usable figures — a recipe with no ingredients, or one with
 * an ingredient still waiting for an amount, is not complete. Save stays disabled until this is
 * true; a new ingredient card starts with `grams: 0` and never a plausible-looking default.
 */
export function recipeIsComplete(ings: RecipeIngredient[]): boolean {
  if (ings.length === 0) return false;
  return ings.every((i) => i.grams > 0 && isFiniteMacros(i.per100));
}

/** How many ingredients still need an amount entered. */
export function amountsNeeded(ings: RecipeIngredient[]): number {
  return ings.filter((i) => i.grams <= 0).length;
}

export type ShareInput = { mode: 'portions'; made: number; eaten: number } | { mode: 'weigh'; dishGrams: number; plateGrams: number };

/**
 * What fraction of the recipe a share represents, or `null` when the inputs make no sense (a
 * zero or negative denominator, or a non-finite number). Deliberately not clamped to 1: eating a
 * second helping is real, and "never show a number that flatters" means a share above 100% of the
 * recipe must say so rather than being quietly capped.
 */
export function shareFraction(s: ShareInput): number | null {
  if (s.mode === 'portions') {
    const { made, eaten } = s;
    if (!Number.isFinite(made) || !Number.isFinite(eaten) || made <= 0 || eaten < 0) return null;
    return eaten / made;
  }
  const { dishGrams, plateGrams } = s;
  if (!Number.isFinite(dishGrams) || !Number.isFinite(plateGrams) || dishGrams <= 0 || plateGrams < 0) return null;
  return plateGrams / dishGrams;
}

/** A plain-language label for a share, independent of whether it is valid: "1 of 2 portions",
 * "0.5 of 1 portion", "300 g of 900 g". The portion word pluralises on how many the recipe made,
 * not on how many were eaten — "1 of 2 portions" reads right, "1 of 2 portion" does not. */
export function shareLabel(s: ShareInput): string {
  if (s.mode === 'portions') return `${fmtNum(s.eaten)} of ${plural(s.made, 'portion')}`;
  return `${fmtNum(s.plateGrams)} g of ${fmtNum(s.dishGrams)} g`;
}

/**
 * The nutrition for a share of the recipe, at portion basis. The exact (unrounded) totals across
 * every ingredient are scaled by `fraction` — never the weighed basis, because a cooked dish's
 * ingredient weights do not correspond to what is on the plate once it is mixed and served.
 */
export function shareNutrition(ings: RecipeIngredient[], fraction: number): Nutrition {
  const totals = ings.reduce((acc, i) => addMacros(acc, ingredientMacros(i)), ZERO);
  return fromPortion(scaleMacros(totals, fraction));
}

/**
 * The weakest-trust source among a recipe's ingredients — the recipe as a whole can only be
 * trusted as much as its least trustworthy figure. The empty-array branch is defensive only: the
 * UI never has a reason to call this before there is at least one ingredient (`recipeIsComplete`
 * already requires one to save), so 'user' — the highest trust, the identity element for "take the
 * weakest" — is returned rather than a value that would misleadingly look load-bearing.
 */
export function combinedSource(sources: FoodSource[]): FoodSource {
  if (sources.length === 0) return 'user';
  return sources.reduce((weakest, s) => (trustOf(s) < trustOf(weakest) ? s : weakest));
}
