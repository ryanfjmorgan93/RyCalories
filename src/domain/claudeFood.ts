/**
 * What Claude read off a photo or a sentence, turned into the items the day is made of. Pure
 * functions only: no IO, no clock, no database; the remembered foods and the UK table are handed in
 * already loaded.
 *
 * The rule (docs/adr/0004): Claude's figures are estimates, trusted least. So each food it names is
 * looked up in what the app already knows first (a remembered food, the curated UK aliases, the
 * table itself). A match keeps its own per-100 g figures and its own source, and Claude only says
 * how much was eaten. Only a food nothing matches gets Claude's figures, with the `model` source.
 *
 * Either way the item is built by `itemFromAmount`, the function a tapped chip uses, so a
 * photographed meal and a chip produce the same kind of item. Every amount Claude supplied is an
 * estimate, and says so: the item's portion text starts with "≈", and a `model` item is "≈" by its
 * source (see `isEstimate`).
 */

import { fromPortion, scaleMacros, trustOf, type FoodSource, type Macros, type Nutrition } from './food';
import { plural } from './format';
import { normalise, unitKeyOf } from './foodMemory';
import { amountPlan, choiceFromMemory, itemFromAmount, type AmountItem, type FoodChoice } from './foodChoice';
import type { UnitOption } from './foodUnits';
import { matchIngredient, type IngredientCandidate, type MatchSources } from './ingredientMatch';
import { tokens } from './products';
import type { FoodMemory, Meal, MealSlot } from './types';

/** The mark for a figure or an amount Claude estimated. */
export const ESTIMATE_MARK = '≈';

/** One food as Claude read it. Structurally `MealReadingItem` (src/ai/vision.ts), which this module cannot import. */
export interface ReadItem {
  name: string;
  amount: number;
  unit: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
}

/** An item as the day stores it (structurally `NewMealItem`, db/foodRepo). */
export type ReadMealItem = AmountItem;

/** Whether what a row shows is partly Claude's: its figures (source `model`) or its amount (a "≈" portion). */
export function isEstimate(item: { source?: FoodSource; portion: string }): boolean {
  return item.source === 'model' || item.portion.startsWith(ESTIMATE_MARK);
}

// ---------------------------------------------------------------------------
// Claude's own figures

function wholeAmount(r: ReadItem): Macros {
  return { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat };
}

/** Claude's figures per 100 g, or null when it gave no weight to divide by. */
export function per100Of(r: ReadItem): Macros | null {
  return r.grams > 0 ? scaleMacros(wholeAmount(r), 100 / r.grams) : null;
}

/** Units that mean "grams" rather than a thing to count. */
const WEIGHT_UNITS = new Set(['g', 'gram', 'grams', 'gramme', 'grammes', 'ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters']);

/** Abbreviations that are the same one or many: "2 tbsp", not "2 tbsps". */
const INVARIANT_UNITS = new Set(['tbsp', 'tsp', 'oz', 'lb', 'cl', 'dl', 'kg']);

/** "slices" to "slice": enough to find the same word among a food's own units, and to say one of it. */
export function singularUnit(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (INVARIANT_UNITS.has(u)) return u;
  if (/rries$/.test(u)) return `${u.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z|o)es$/.test(u)) return u.slice(0, -2);
  if (u.length > 2 && u.endsWith('s') && !u.endsWith('ss')) return u.slice(0, -1);
  return u;
}

function pluraliseUnit(singular: string): string {
  if (INVARIANT_UNITS.has(singular)) return singular;
  if (/(ch|sh|ss|x|z)$/.test(singular)) return `${singular}es`;
  if (/[^aeiou]y$/.test(singular)) return `${singular.slice(0, -1)}ies`;
  return `${singular}s`;
}

/** What Claude counted in, as a unit option of `grams / amount` each, or null when it counted in grams or gave nothing to count. */
function claudeUnit(r: ReadItem): UnitOption | null {
  const word = r.unit.trim();
  const singular = singularUnit(word);
  const key = unitKeyOf(singular);
  if (!word || !key || WEIGHT_UNITS.has(key) || WEIGHT_UNITS.has(normalise(word)) || !(r.amount > 0) || !(r.grams > 0)) return null;
  const nouns = word.toLowerCase() === singular ? pluraliseUnit(singular) : word.toLowerCase();
  return { key, kind: 'item', label: singular, noun: singular, nouns, grams: r.grams / r.amount };
}

function gramsOption(choice: FoodChoice): { options: UnitOption[]; grams: UnitOption } {
  const options = amountPlan(choice).options;
  return { options, grams: options.find((o) => o.kind === 'grams')! };
}

function estimated(item: AmountItem): AmountItem {
  return { ...item, portion: `${ESTIMATE_MARK} ${item.portion}` };
}

/** Claude's figures as a food of its own: the least-trusted source, counted only in grams. */
function modelChoice(r: ReadItem, per100: Macros): FoodChoice {
  return { key: `model:${normalise(r.name)}`, name: r.name.trim(), per100, source: 'model', origin: 'model', units: {} };
}

function fromModel(r: ReadItem): AmountItem {
  const per100 = per100Of(r);
  if (!per100) {
    // No weight, so no per-100 g to remember: the whole amount as a portion, as Claude gave it.
    const nutrition: Nutrition = fromPortion(wholeAmount(r));
    const said = `${r.amount} ${r.unit}`.trim();
    return { name: r.name.trim(), portion: `${ESTIMATE_MARK} ${said || '1 portion'}`, nutrition, source: 'model', units: {} };
  }
  const choice = modelChoice(r, per100);
  const { options, grams } = gramsOption(choice);
  const unit = claudeUnit(r);
  if (unit) return estimated(itemFromAmount(choice, unit, r.amount, [unit, ...options]));
  return estimated(itemFromAmount(choice, { ...grams, grams: 1 }, r.grams, options));
}

// ---------------------------------------------------------------------------
// Foods the app already knows

/** The crude plural folding `ingredientMatch` applies to names, so "egg" and "eggs" are one word. */
function fold(s: string): string {
  return normalise(s)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Whether two energy densities (kcal per 100 g) could be the same food. A raw rice row against a
 * photographed bowl of cooked rice is 360 against 130: the same name, not the same food. Close
 * enough is within 60% either way, or within 30 kcal for the very light foods where a ratio is noise.
 */
export function densitiesAgree(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi - lo <= 30 || hi <= lo * 1.6;
}

/** Whether the match is the owner's own entry or a word the app's aliases name outright, rather than a guess from word overlap. */
function isDirect(best: IngredientCandidate, name: string, sources: MatchSources): boolean {
  if (best.key.startsWith('memory:')) return true;
  const key = fold(name);
  return sources.aliases.some((a) => a.code === best.code && a.words.some((w) => fold(w) === key));
}

/** The table row, or the remembered food that stands for it, as a choice (what a tapped search result would be). */
function choiceFromCandidate(c: IngredientCandidate, memories: FoodMemory[]): FoodChoice {
  const byKey = new Map(memories.map((m) => [m.key, m]));
  if (c.key.startsWith('memory:')) {
    const m = byKey.get(c.key.slice('memory:'.length));
    if (m) return choiceFromMemory(m);
  }
  // A table row the owner has already logged is their record of it: their figures, their units.
  const twin = byKey.get(`n:${normalise(c.name)}`);
  if (twin) return choiceFromMemory(twin, c.unit);
  return {
    key: c.key,
    name: c.name,
    per100: c.per100,
    source: c.source,
    origin: 'table',
    units: c.unit ? { tableUnit: c.unit } : {},
  };
}

/**
 * The food the app already knows for a name Claude gave, or null.
 *
 * Not a match: a remembered estimate (no better than the fresh one), a word-overlap guess from the
 * table that does not cover every word Claude used, and a table row whose energy density is far
 * from what Claude saw (cooked against raw). The owner's own entries and their labels are kept
 * whatever Claude thinks: they are the better figures.
 */
export function knownFood(r: ReadItem, sources: MatchSources): FoodChoice | null {
  const { best } = matchIngredient(r.name, sources);
  if (!best || trustOf(best.source) <= trustOf('model')) return null;
  const owners = trustOf(best.source) >= trustOf('label');
  if (!owners) {
    if (!isDirect(best, r.name, sources)) {
      const named = tokens(r.name);
      const row = tokens(best.name);
      if (named.size === 0 || ![...named].every((t) => row.has(t))) return null;
    }
    const seen = per100Of(r);
    if (seen && !densitiesAgree(seen.kcal, best.per100.kcal)) return null;
  }
  return choiceFromCandidate(best, sources.memories);
}

/**
 * How much of a known food was eaten. A count Claude gave in a unit the food has (two eggs, with
 * the owner's own egg weight) is used as the count; anything else is Claude's weight. Null when
 * Claude gave neither a usable count nor a weight.
 */
function knownAmount(choice: FoodChoice, r: ReadItem): AmountItem | null {
  const plan = amountPlan(choice);
  const key = unitKeyOf(singularUnit(r.unit));
  const counted = plan.options.find((o) => o.kind === 'item' && o.key === key);
  if (counted && r.amount > 0) {
    const weight = counted.grams * r.amount;
    // Their unit weight stands unless it puts the amount at odds with what Claude saw.
    if (!(r.grams > 0) || (weight >= r.grams * 0.5 && weight <= r.grams * 2)) {
      return estimated(itemFromAmount(choice, counted, r.amount, plan.options));
    }
  }
  if (!(r.grams > 0)) return null;
  const { options, grams } = gramsOption(choice);
  const unit = claudeUnit(r);
  const item = unit
    ? itemFromAmount(choice, unit, r.amount, [unit, ...options])
    : itemFromAmount(choice, { ...grams, grams: 1 }, r.grams, options);
  // Claude's word for the unit and its weight are a guess: they say what was eaten this once, and
  // must not teach a food the owner or the table already knows a unit weight of its own.
  const { packGrams, servingGrams } = item.units;
  const taught: AmountItem = {
    ...item,
    units: { ...(packGrams !== undefined ? { packGrams } : {}), ...(servingGrams !== undefined ? { servingGrams } : {}) },
  };
  delete taught.unit;
  return estimated(taught);
}

/** One food Claude read as the item to log: the known food at Claude's amount, else Claude's own figures. */
export function itemFromReading(r: ReadItem, sources: MatchSources): ReadMealItem {
  const known = knownFood(r, sources);
  if (known) {
    const item = knownAmount(known, r);
    if (item) return item;
  }
  return fromModel(r);
}

export function itemsFromReadings(readings: readonly ReadItem[], sources: MatchSources): ReadMealItem[] {
  return readings.map((r) => itemFromReading(r, sources));
}

// ---------------------------------------------------------------------------
// The meal around them

type Confidence = NonNullable<Meal['confidence']>;
const LEVEL: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** A meal is as sure as its least sure item. */
export function readingConfidence(readings: readonly Pick<ReadItem, 'confidence'>[]): Confidence {
  let lowest: Confidence = 'high';
  for (const r of readings) if (LEVEL[r.confidence] < LEVEL[lowest]) lowest = r.confidence;
  return lowest;
}

/** The foods in a few words, for the meal's note: "Scrambled eggs, wholemeal toast". */
export function readingSummary(readings: readonly Pick<ReadItem, 'name'>[], max = 120): string {
  const names = readings.map((r) => r.name.trim()).filter(Boolean);
  const text = names.join(', ');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Logged 3 items to Dinner · 640 kcal ≈": what the Undo bar says. */
export function loggedLine(count: number, slot: MealSlot, kcal: number): string {
  return `Logged ${plural(count, 'item')} to ${slot[0]!.toUpperCase()}${slot.slice(1)} · ${Math.round(kcal)} kcal ${ESTIMATE_MARK}`;
}
