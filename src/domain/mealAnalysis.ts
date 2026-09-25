/**
 * Parsing the on-device model's answer to "what's in this photo?". Pure functions only — no IO,
 * no clock, no database, and this file never calls the model itself (that is `NanoPlugin` /
 * `src/state/nano.ts`).
 *
 * The model only ever names ingredients — never amounts, never nutrition: the numbers come from a
 * scanned pack, a food logged before, or the bundled UK food table, never the AI. This file's whole job is turning whatever text the model produced into a small, bounded
 * list of plain names, in the same defensive style as `products.ts`'s `parseProduct`: a small
 * on-device model can wrap its JSON in commentary or a code fence, or return something that isn't
 * JSON at all, and none of that may ever throw into the caller.
 */

import { normalise } from './foodMemory';

/** The system instruction sent with every meal-photo request. Short and plain, for a small model
 * under a hard token budget. */
export const MEAL_PHOTO_SYSTEM =
  'You identify foods in a photo of a home-cooked meal. Reply with JSON only, no other text: ' +
  '{"dish": string, "ingredients": string[]}. Use plain, generic ingredient names such as "egg", ' +
  '"cheddar" or "bacon" — never brand names. Do not include amounts, weights, nutrition figures ' +
  'or any other commentary.';

/** The user-turn prompt sent alongside the photo. */
export const MEAL_PHOTO_PROMPT =
  'List the separate foods and ingredients visible in this home-cooked meal. Reply with JSON ' +
  'only: {"dish": "short name for the dish", "ingredients": ["ingredient", "ingredient"]}.';

export interface MealAnalysis {
  dish?: string;
  ingredients: string[];
}

/**
 * The system instruction sent with a typed "what did you eat out?" request — "Estimate a meal
 * out" in the recipe builder. Breaks a described dish into its separate components, each with a
 * total weight, so the bundled UK table can supply figures for every part. Still names only —
 * never nutrition — the same rule `MEAL_PHOTO_SYSTEM` follows, just with a weight attached to
 * each name this time (see `RecipeIngredient.amountEstimated`: an amount from the model is always
 * marked, never trusted the way a typed or weighed one is).
 */
export const MEAL_ESTIMATE_SYSTEM =
  'You break a takeaway, restaurant or home-cooked dish the user describes into its separate ' +
  'components, each with a total weight in grams for the whole dish. Reply with JSON only, no ' +
  'other text: {"dish": string, "parts": [{"name": string, "grams": number}]}. One entry per ' +
  'distinct component — two burger patties is one entry at 300 g, never two entries. Use plain, ' +
  'generic names that suit a UK food table, such as "beef burger", "burger bun", "cheddar", ' +
  '"back bacon" or "mayonnaise" — never brand names. Do not include nutrition figures or any ' +
  'other commentary.';

/** The user-turn prompt for a typed meal-out description. */
export function mealEstimatePrompt(text: string): string {
  return (
    `What did you eat: "${text}". Reply with JSON only: {"dish": "short name for the dish", ` +
    '"parts": [{"name": "component", "grams": number}]}.'
  );
}

export interface MealEstimatePart {
  name: string;
  /** Absent when the model gave no usable weight for this part — "no amount", never 0. */
  grams?: number;
}

export interface MealEstimate {
  dish?: string;
  parts: MealEstimatePart[];
}

const MAX_NAME_LEN = 40;
const MAX_DISH_LEN = 60;
const MAX_INGREDIENTS = 12;
const MAX_PARTS = 12;
const MAX_GRAMS = 3000;

/**
 * Turn the model's raw text response into a dish name and a bounded, deduplicated list of
 * ingredient names. Never throws — anything that cannot be made sense of becomes
 * `{ ingredients: [] }`, which the caller treats as "recognised nothing" rather than an error.
 */
export function parseMealAnalysis(raw: string): MealAnalysis {
  const data = extractJson(raw);
  if (data === undefined) return { ingredients: [] };

  const rawIngredients = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.ingredients) ? data.ingredients : [];
  const ingredients = dedupeNames(cleanNames(rawIngredients));

  const dish = !Array.isArray(data) && isRecord(data) ? cleanDish(data.dish) : undefined;

  return dish !== undefined ? { dish, ingredients } : { ingredients };
}

/**
 * Turn the model's raw text response to a meal-out estimate into a dish name and a bounded,
 * deduplicated list of `{name, grams?}` parts. Same tolerant, never-throwing style as
 * `parseMealAnalysis` — garbage becomes `{ parts: [] }`, which the caller treats as "estimated
 * nothing" (`recognise-none`), never an error.
 */
export function parseMealEstimate(raw: string): MealEstimate {
  const data = extractJson(raw);
  if (data === undefined) return { parts: [] };

  const rawParts = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.parts) ? data.parts : [];
  const parts = dedupeParts(cleanParts(rawParts));

  const dish = !Array.isArray(data) && isRecord(data) ? cleanDish(data.dish) : undefined;

  return dish !== undefined ? { dish, parts } : { parts };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function cleanDish(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DISH_LEN ? trimmed : undefined;
}

function cleanNames(list: unknown[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Drop duplicates that differ only by case, whitespace or a trailing plural — "egg" and "eggs"
 * are the same ingredient said twice. Keeps the first-seen spelling and caps the result, so a
 * chatty model cannot turn one photo into an unbounded list of question cards.
 */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = singularKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_INGREDIENTS) break;
  }
  return out;
}

/** Each raw part must be an object with a usable `name`; `grams`, if present, must be a finite
 * number strictly between 0 and 3,000 g or it is dropped (the ingredient keeps its name but no
 * amount — "no amount", never a misleading 0). */
function cleanParts(list: unknown[]): MealEstimatePart[] {
  const out: MealEstimatePart[] = [];
  for (const v of list) {
    if (!isRecord(v) || typeof v.name !== 'string') continue;
    const name = v.name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LEN) continue;
    const grams = cleanGrams(v.grams);
    out.push(grams !== undefined ? { name, grams } : { name });
  }
  return out;
}

function cleanGrams(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_GRAMS ? v : undefined;
}

/**
 * Drop duplicates that differ only by case, whitespace or a trailing plural — same rule as
 * `dedupeNames` — but SUM their grams rather than discarding the later entry: "two patties" said
 * as two separate 150 g parts must total 300 g, not silently lose one. Caps at 12 distinct parts,
 * same as `dedupeNames`'s ingredient cap.
 */
function dedupeParts(parts: MealEstimatePart[]): MealEstimatePart[] {
  const seen = new Map<string, MealEstimatePart>();
  const out: MealEstimatePart[] = [];
  for (const part of parts) {
    const key = singularKey(part.name);
    const existing = seen.get(key);
    if (existing) {
      if (part.grams !== undefined) existing.grams = (existing.grams ?? 0) + part.grams;
      continue;
    }
    if (out.length >= MAX_PARTS) break;
    const copy: MealEstimatePart = { ...part };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** `normalise` from foodMemory folds case, accents and punctuation; this adds the same crude
 * singularisation `foodMemory`'s internal `words()` uses, so "egg" and "eggs" fold to one key. */
function singularKey(name: string): string {
  return normalise(name)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Find a JSON value inside arbitrary text: a fenced ```json``` (or bare ```) block, the whole
 * trimmed string, an embedded `{...}` object, or an embedded `[...]` array — tried in that order,
 * first one that parses wins. Returns `undefined` rather than throwing when nothing does.
 */
function extractJson(raw: string): unknown {
  const candidates: string[] = [];

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) candidates.push(fence[1].trim());

  const trimmed = raw.trim();
  if (trimmed) candidates.push(trimmed);

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) candidates.push(raw.slice(objStart, objEnd + 1));

  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(raw.slice(arrStart, arrEnd + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
