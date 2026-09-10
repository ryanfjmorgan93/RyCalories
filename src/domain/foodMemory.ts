/**
 * Remembering food you have eaten before. Pure functions only — no IO, no clock, no database.
 *
 * The point of this module is that most food is repeat food. Typing a name, a weight and four
 * macro numbers is fine once; doing it for the same porridge every morning is the difference
 * between a logger you use and one you abandon.
 *
 * What is remembered is deliberately per 100 g, never a portion. Portions genuinely vary — the
 * same cereal is 40 g one day and 65 g the next — so the weight is offered as a starting point
 * and nothing more, while the per-100g figures, which do not vary, are what carry across.
 */

import { gramsOf, isPackaged, macrosOf, mayOverwrite, scaleMacros, type Macros, type Nutrition } from './food';
import type { FoodMemory, MealItem } from './types';

/** Text reduced to its identifying words, for keys and for search. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    // Strip the combining marks NFKD just split off, BEFORE the next line turns anything
    // non-alphanumeric into a space — otherwise "crème" decomposes and then splits into "cre me".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The key two entries must share to be considered the same food.
 *
 * A packaged product is keyed on brand and product, because that pair identifies a specific label.
 * Everything else is keyed on its name — "chicken thigh" is chicken thigh however it was typed.
 */
export function memoryKey(item: Pick<MealItem, 'name' | 'brand' | 'product'>): string {
  if (isPackaged(item)) {
    const brand = normalise(item.brand ?? '');
    const product = normalise(item.product ?? '') || normalise(item.name);
    return `p:${[brand, product].filter(Boolean).join(' ')}`;
  }
  return `n:${normalise(item.name)}`;
}

/**
 * What to store for a food just logged, or null when there is nothing worth remembering.
 *
 * Only weighed portions can be remembered, because only they yield per-100g figures. An unweighed
 * "1 bowl" records how much was in that particular bowl and nothing generalisable — storing it
 * per 100 g would be inventing a number.
 */
export function memoryFrom(item: Pick<MealItem, 'name' | 'brand' | 'product' | 'source' | 'nutrition'>): Omit<FoodMemory, 'id' | 'timesUsed' | 'lastUsedAt'> | null {
  const grams = gramsOf(item.nutrition);
  if (grams === null || grams <= 0) return null;
  const per100 = perHundred(item.nutrition);
  if (!per100) return null;
  return {
    key: memoryKey(item),
    name: item.name.trim(),
    ...(item.brand ? { brand: item.brand } : {}),
    ...(item.product ? { product: item.product } : {}),
    per100,
    typicalGrams: grams,
    source: item.source,
  };
}

function perHundred(n: Nutrition): Macros | null {
  if (n.basis === 'weighed') return n.per100;
  const grams = gramsOf(n);
  if (grams === null || grams <= 0) return null;
  return scaleMacros(macrosOf(n), 100 / grams);
}

/**
 * Fold a newly logged food into what is already remembered.
 *
 * The trust hierarchy decides the numbers: a model's guess must not overwrite a figure the user
 * typed or one read off a label, because a remembered guess wearing the same badge as a label is
 * how a wrong number becomes permanent. The usage count and the portion weight always advance —
 * those are facts about what happened, not claims about the food.
 */
export function mergeMemory(
  existing: FoodMemory,
  incoming: Omit<FoodMemory, 'id' | 'timesUsed' | 'lastUsedAt'>,
  at: string,
): FoodMemory {
  const takeNumbers = mayOverwrite(existing.source, incoming.source);
  return {
    ...existing,
    name: takeNumbers ? incoming.name || existing.name : existing.name,
    ...(incoming.brand ? { brand: incoming.brand } : {}),
    ...(incoming.product ? { product: incoming.product } : {}),
    per100: takeNumbers ? incoming.per100 : existing.per100,
    source: takeNumbers ? incoming.source : existing.source,
    // The most recent portion is the better suggestion: it is what you actually ate last time.
    ...(incoming.typicalGrams !== undefined ? { typicalGrams: incoming.typicalGrams } : {}),
    timesUsed: existing.timesUsed + 1,
    lastUsedAt: at,
  };
}

/**
 * A name split into identifying words, crudely singularised so a search for "oat" finds "oats".
 * Without this, a plural in the stored name demotes the food to a prefix match and a staple can
 * sit below something eaten once.
 */
function words(s: string): string[] {
  return normalise(s)
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

export interface RankedMemory {
  memory: FoodMemory;
  score: number;
}

/**
 * Order remembered foods for a search box.
 *
 * With no query this is "what I eat most, most recently" — the list that makes a repeated
 * breakfast one tap. With a query it is a prefix-and-word match over the name and brand, still
 * weighted by how often the food is eaten, so "oat" puts your porridge oats above the oat milk
 * you bought once.
 */
export function rankMemories(query: string, memories: FoodMemory[], limit = 8): RankedMemory[] {
  const q = normalise(query);
  const terms = q ? words(q) : [];
  const ranked: RankedMemory[] = [];

  for (const memory of memories) {
    const haystack = normalise([memory.brand, memory.name].filter(Boolean).join(' '));
    const hay = words(haystack);
    let match = 0;
    if (terms.length === 0) {
      match = 1;
    } else {
      for (const term of terms) {
        if (hay.some((w) => w === term)) match += 1;
        else if (hay.some((w) => w.startsWith(term))) match += 0.8;
        else if (haystack.includes(term)) match += 0.4;
        else {
          match = -1;
          break;
        }
      }
      if (match < 0) continue;
      match /= terms.length;
    }
    ranked.push({ memory, score: match + familiarity(memory) });
  }

  ranked.sort((a, b) => b.score - a.score || b.memory.lastUsedAt.localeCompare(a.memory.lastUsedAt) || a.memory.key.localeCompare(b.memory.key));
  return ranked.slice(0, limit);
}

/**
 * How familiar a food is, as a small bonus that reorders equally good text matches but can never
 * outrank a better one — the cap is deliberately below the smallest gap between match tiers, so
 * an exact word beats a prefix however often the other food is eaten. Logarithmic, so the fortieth
 * time you eat something counts for much less than the second; otherwise one staple would bury
 * everything else for ever.
 */
function familiarity(m: FoodMemory): number {
  return Math.min(0.15, Math.log10(1 + Math.max(0, m.timesUsed)) / 4);
}
