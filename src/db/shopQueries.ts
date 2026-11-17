import { db } from './db';
import { getSettings, saveSettings } from './repo';
import { loadUkFoodTable } from '@/data/ukFoodTable';
import { addDays } from '@/domain/dates';
import { gramsOf, macrosOf, scaleMacros } from '@/domain/food';
import { memoryKey, normalise } from '@/domain/foodMemory';
import { calorieTargetOn } from '@/domain/nutrition';
import type { Settings } from '@/domain/types';
import {
  aisleOfName,
  shopLines,
  shopTotals,
  shopWeek,
  weekTargets,
  type Eaten,
  type FoodFix,
  type LineState,
  type PackFacts,
  type ShopLine,
} from '@/domain/weeklyShop';

/** The window the shop learns from: the 28 days before today (today is still being eaten). */
const WINDOW_DAYS = 28;

export interface ShopView {
  week: string;
  lines: ShopLine[];
  targets: { kcal: number | null; protein: number };
  totals: { kcal: number; protein: number };
  loggedDays: number;
}

/**
 * The weekly shop for the week after the coming Sunday, from the last 28 days of food: every food
 * that can be bought (Claude's estimates left out, a recipe share counted as its ingredients), with
 * the packs remembered, the owner's fixes and this week's changes.
 */
export async function loadShop(today: string, settings: Settings): Promise<ShopView> {
  const week = shopWeek(today);
  const from = addDays(today, -WINDOW_DAYS);
  const to = addDays(today, -1);
  const meals = await db.meals.where('date').between(from, to, true, true).toArray();
  const items = await db.mealItems.where('mealId').anyOf(meals.map((m) => m.id)).toArray();
  const [recipes, foods, table] = await Promise.all([db.recipes.toArray(), db.foods.toArray(), loadUkFoodTable().catch(() => null)]);
  const dateOf = new Map(meals.map((m) => [m.id, m.date]));
  const recipeOf = new Map(recipes.map((r) => [r.id, r]));
  const memory = new Map(foods.map((f) => [f.key, f]));

  const loggedDays = new Set(items.map((i) => dateOf.get(i.mealId))).size;
  const eaten: Eaten[] = [];
  for (const item of items) {
    const date = dateOf.get(item.mealId)!;
    const recipe = item.recipeId ? recipeOf.get(item.recipeId) : undefined;
    if (recipe) {
      // A share of a recipe is its ingredients, in proportion to the share's calories.
      const whole = recipe.ingredients.reduce((s, i) => s + (i.per100.kcal * i.grams) / 100, 0);
      const share = whole > 0 ? macrosOf(item.nutrition).kcal / whole : 0;
      for (const ing of recipe.ingredients) {
        if (ing.source === 'model' || ing.amountEstimated || ing.grams <= 0 || share <= 0) continue;
        const grams = ing.grams * share;
        eaten.push({ key: memoryKey(ing), name: ing.name, date, grams, macros: scaleMacros(ing.per100, grams / 100) });
      }
      continue;
    }
    const key = memoryKey(item);
    if (item.source === 'model' || (item.source === 'memory' && memory.get(key)?.source === 'model')) continue;
    eaten.push({ key, name: item.name, date, grams: gramsOf(item.nutrition), macros: macrosOf(item.nutrition) });
  }

  const facts: Record<string, PackFacts> = {};
  for (const f of foods) facts[f.key] = { packGrams: f.packGrams, unitGrams: f.unitGrams, unitLabel: f.unitLabel, unitPlural: f.unitPlural };
  const codes = new Map((table?.foods ?? []).map((f) => [normalise(f.name), f.code]));
  const aisleOf = (name: string) => aisleOfName(name, codes.get(normalise(name)));
  const state = settings.shop?.week === week ? settings.shop.lines : {};
  const lines = shopLines(eaten, loggedDays, facts, settings.shopFoods ?? {}, state, aisleOf);

  const days = Array.from({ length: 7 }, (_, i) => calorieTargetOn(addDays(week, i), settings)?.kcal ?? null);
  return { week, lines, targets: weekTargets(days, settings.proteinTarget), totals: shopTotals(lines), loggedDays };
}

/** Change one line of the week being planned; a new week starts from nothing. */
export async function setShopLine(week: string, key: string, patch: LineState): Promise<void> {
  const s = await getSettings();
  const lines = s.shop?.week === week ? s.shop.lines : {};
  await saveSettings({ shop: { week, lines: { ...lines, [key]: { ...lines[key], ...patch } } } });
}

/** Set the packs of several lines at once (More of the same). */
export async function setShopPacks(week: string, packs: Record<string, number>): Promise<void> {
  const s = await getSettings();
  const lines = { ...(s.shop?.week === week ? s.shop.lines : {}) };
  for (const [key, n] of Object.entries(packs)) lines[key] = { ...lines[key], packs: n };
  await saveSettings({ shop: { week, lines } });
}

/** Remember a pack or an aisle for a food, for every week after. */
export async function setShopFood(key: string, fix: FoodFix): Promise<void> {
  const s = await getSettings();
  await saveSettings({ shopFoods: { ...s.shopFoods, [key]: { ...s.shopFoods?.[key], ...fix } } });
}
