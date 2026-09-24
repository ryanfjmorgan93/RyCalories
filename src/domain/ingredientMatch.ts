/**
 * Matching a plain ingredient name — recognised from a photo or typed by hand — to a food with
 * real figures: the app's own curated alias for the bundled UK food table, something remembered
 * from before, or a token search of the table itself. Pure functions only — no IO, no clock, no
 * database; the table and food memory are handed in already loaded.
 *
 * The three shapes below (`TableFood`, `FoodUnit`, `FoodAlias`) are structural, not a shared
 * import: `src/data/ukFoodTable.ts` (built alongside this file, in a separate slice) declares its
 * own copies with the same fields, and its `loadUkFoodTable()` loader's return value satisfies
 * these interfaces without either file importing the other.
 */

import { normalise } from './foodMemory';
import { MATCH_THRESHOLD, tokenScore, tokens } from './products';
import { trustOf, type FoodSource, type Macros } from './food';
import type { FoodMemory } from './types';

/** One row of the bundled UK CoFID food table. */
export interface TableFood {
  code: string;
  name: string;
  per100: Macros;
}

/** A count-style amount for a table food, e.g. {label:'egg', plural:'eggs', grams:50}. `grams` is
 * an app ESTIMATE of one unit's weight, not a measured fact — see the plan's CoFID notes. */
export interface FoodUnit {
  label: string;
  plural: string;
  grams: number;
}

/** A curated mapping from plain words to one CoFID row, with an optional unit for count entry. */
export interface FoodAlias {
  words: string[];
  code: string;
  unit?: FoodUnit;
}

/** A food matchIngredient can offer, whatever it came from. */
export interface IngredientCandidate {
  key: string;
  name: string;
  per100: Macros;
  source: FoodSource;
  brand?: string;
  product?: string;
  unit?: FoodUnit;
  code?: string;
}

export interface MatchSources {
  aliases: FoodAlias[];
  foods: TableFood[];
  memories: FoodMemory[];
}

export interface MatchResult {
  best: IngredientCandidate | null;
  alternatives: IngredientCandidate[];
}

const MAX_ALTERNATIVES = 5;

/**
 * Match one recognised or typed name to a food. Tried in order, first hit wins:
 *
 *   1. a `FoodMemory` whose name matches (singular/plural-insensitive) and whose figures are at
 *      least as trustworthy as the table's — what the owner has actually logged before, including
 *      a pack they scanned and any unit weight they corrected ("one egg is 55 g, not 50");
 *   2. a curated alias, whose words include the name — the app's own judgement that this word
 *      means this exact CoFID row. If a lower-trust memory of the same food exists, its learned
 *      unit weight still rides along;
 *   3. any other exactly-named memory (lower trust than the table — nothing writes one today);
 *   4. a token search across the whole table, reusing `tokens`/`tokenScore` from `products.ts`
 *      (not `bestMatch`, which is brand-gated for Open Food Facts and has nothing to gate here).
 *
 * Memory comes before the alias because the alias is a default and the memory is the owner's
 * answer to it. With the alias first, a corrected egg weight or a scanned bacon pack would be
 * remembered and then never used again, since the alias would always answer first.
 */
export function matchIngredient(name: string, sources: MatchSources): MatchResult {
  const key = singularKey(name);
  if (!key) return { best: null, alternatives: [] };

  const memory = matchMemory(key, sources.memories, sources.aliases);
  if (memory && trustOf(memory.source) >= trustOf('table')) return { best: memory, alternatives: [] };

  const alias = matchAlias(key, sources.aliases, sources.foods);
  if (alias) {
    // A memory too weak to win outright can still know this food's unit weight better than the
    // alias's estimate does.
    const unit = memory?.unit ?? alias.unit;
    return { best: { ...alias, ...(unit ? { unit } : {}) }, alternatives: [] };
  }

  if (memory) return { best: memory, alternatives: [] };

  return matchTokens(name, sources.foods);
}

function matchAlias(key: string, aliases: FoodAlias[], foods: TableFood[]): IngredientCandidate | null {
  for (const alias of aliases) {
    if (!alias.words.some((w) => singularKey(w) === key)) continue;
    const food = foods.find((f) => f.code === alias.code);
    // A dangling alias (its code is not in the table handed in) is not a match — keep looking
    // rather than failing the whole lookup over one bad row.
    if (!food) continue;
    return {
      key: `table:${food.code}`,
      name: food.name,
      per100: food.per100,
      source: 'table',
      code: food.code,
      ...(alias.unit ? { unit: alias.unit } : {}),
    };
  }
  return null;
}

/**
 * Exact-name match against remembered food. Deliberately not fuzzy — a fuzzy match here would
 * make an ingredient silently resolve to some other remembered food with a similar name, which
 * for a number that then gets trusted at the memory's own source is worse than falling through to
 * the table search, which is honest about being a guess (it is offered as `alternatives` too).
 *
 * Preferred over the table's own token search when both would match, because a remembered food is
 * what the owner actually eats — the whole point of FoodMemory. When more than one memory shares
 * the normalised name (unusual, but two brands can share a plain name), the more established one
 * wins: most-used, then most recently used, then its key, so the choice is deterministic.
 */
function matchMemory(key: string, memories: FoodMemory[], aliases: FoodAlias[]): IngredientCandidate | null {
  const matches = memories.filter((m) => singularKey(m.name) === key);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.timesUsed - a.timesUsed || b.lastUsedAt.localeCompare(a.lastUsedAt) || a.key.localeCompare(b.key));
  const memory = matches[0]!;
  return {
    key: `memory:${memory.key}`,
    name: memory.name,
    per100: memory.per100,
    source: memory.source,
    ...(memory.brand ? { brand: memory.brand } : {}),
    ...(memory.product ? { product: memory.product } : {}),
    ...(memory.unitGrams !== undefined ? { unit: memoryUnit(memory, key, aliases) } : {}),
  };
}

/**
 * A remembered unit weight, named the way it was learned ("rasher"), else the way this food's
 * alias names it, else by the food's own name as a last resort.
 */
function memoryUnit(memory: FoodMemory, key: string, aliases: FoodAlias[]): FoodUnit {
  const grams = memory.unitGrams!;
  if (memory.unitLabel) return { label: memory.unitLabel, plural: memory.unitPlural ?? memory.unitLabel, grams };
  const aliasUnit = aliases.find((a) => a.unit && a.words.some((w) => singularKey(w) === key))?.unit;
  if (aliasUnit) return { label: aliasUnit.label, plural: aliasUnit.plural, grams };
  return { label: memory.name, plural: memory.name, grams };
}

/**
 * Token search over the full table. Same "strictly greater than threshold" rule as
 * `products.ts`'s `bestMatch` — a bare tie at the threshold is one shared word out of two, which
 * is not a match — but no brand gate, because a plain table row has no brand to gate on.
 * Deterministic tie-break: score, then the shorter (more specific) name, then the CoFID code, so
 * the same query always returns the same food.
 */
function matchTokens(name: string, foods: TableFood[]): MatchResult {
  const qTokens = tokens(name);
  if (qTokens.size === 0) return { best: null, alternatives: [] };

  const scored: { food: TableFood; score: number }[] = [];
  for (const food of foods) {
    const score = tokenScore(qTokens, tokens(food.name));
    if (score > MATCH_THRESHOLD) scored.push({ food, score });
  }
  if (scored.length === 0) return { best: null, alternatives: [] };

  scored.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || a.food.code.localeCompare(b.food.code));

  const toCandidate = (food: TableFood): IngredientCandidate => ({
    key: `table:${food.code}`,
    name: food.name,
    per100: food.per100,
    source: 'table',
    code: food.code,
  });

  const [top, ...rest] = scored;
  return { best: toCandidate(top!.food), alternatives: rest.slice(0, MAX_ALTERNATIVES).map((s) => toCandidate(s.food)) };
}

/** `normalise` folds case, accents and punctuation; this adds the same crude singularisation
 * `foodMemory`'s internal `words()` and `mealAnalysis`'s deduping use, so "egg" and "eggs" —
 * whichever way an alias, a memory or the model spelt it — fold to the same key. */
function singularKey(s: string): string {
  return normalise(s)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export interface FoodGroup {
  /** Every recognised name that resolved to this one candidate, in first-seen order. */
  names: string[];
  candidate: IngredientCandidate;
}

/**
 * Fold a list of recognised names and the candidate each matched into one card per distinct
 * food — "egg" and "eggs" said separately by a chatty model, or a typed list naming the same
 * ingredient twice, become one ingredient with two names attached rather than two duplicate
 * cards. Names with no match are returned separately, in the order they were given.
 */
export function mergeByFood(matches: Array<{ name: string; candidate: IngredientCandidate | null }>): { merged: FoodGroup[]; unmatched: string[] } {
  const merged: FoodGroup[] = [];
  const byKey = new Map<string, FoodGroup>();
  const unmatched: string[] = [];

  for (const { name, candidate } of matches) {
    if (!candidate) {
      unmatched.push(name);
      continue;
    }
    const existing = byKey.get(candidate.key);
    if (existing) {
      existing.names.push(name);
      continue;
    }
    const group: FoodGroup = { names: [name], candidate };
    byKey.set(candidate.key, group);
    merged.push(group);
  }

  return { merged, unmatched };
}
