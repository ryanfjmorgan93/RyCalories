/**
 * Open Food Facts product matching. Pure functions only — no network, no cache, no clock.
 *
 * Ported from the Kotlin `ProductLookup`, with the bug its own roadmap listed first
 * (ROADMAP §1.1) fixed here rather than carried across.
 *
 * The original scored a candidate as `|query ∩ candidate| / |query|` with **no requirement that
 * the brand match**. "Trek Protein Flapjack" reduces to {trek, protein, flapjack}; a different
 * manufacturer's "Protein Flapjack" scores 0.67, passes the 0.5 gate, and its nutrition is written
 * onto the food behind a badge asserting the numbers came off a real label. Confidently wrong is
 * worse than an admitted guess, because the badge is what makes it trustworthy.
 *
 * Two changes follow from that:
 *   - When the query names a brand, a candidate must share a brand token. No exceptions.
 *   - Scoring is symmetric (F1 of the token sets) rather than recall-only, so a candidate that
 *     matches every query token but carries five unrelated ones of its own is no longer perfect.
 */

import type { Macros } from './food';

/** Nutrition as a product label states it: always per 100 g. */
export interface LabelNutrition {
  /** Barcode, when the result came from one. */
  code: string;
  brand: string;
  name: string;
  per100: Macros;
  /** Stated serving weight in grams, when the database knows one. */
  servingGrams?: number;
  /** Whole-pack weight in grams, when the database knows one. */
  packGrams?: number;
}

/** What we ask Open Food Facts to return. Fewer fields, smaller response, faster on a phone. */
export const OFF_FIELDS = 'code,product_name,brands,quantity,serving_size,serving_quantity,product_quantity,nutriments';

/**
 * Words that carry no identity. "Bar" and "pack" are packaging, not product, and matching on them
 * is how one brand's flapjack becomes another's.
 */
const STOP = new Set([
  'the', 'and', 'with', 'of', 'a', 'an', 'in', 'for',
  'bar', 'bars', 'pack', 'packs', 'snack', 'snacks',
  'flavour', 'flavours', 'flavor', 'flavors',
  'original', 'new', 'size',
]);

/** Lowercase, split on non-alphanumerics, drop stop words, singularise crudely. */
export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    // flapjacks == flapjack, but gas stays gas.
    out.add(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Symmetric token similarity (F1). Recall alone rewards a candidate for containing the query's
 * words while ignoring how much else it contains, which is exactly how a "Protein Flapjack
 * Multipack Variety Selection" outscores the actual product.
 */
export function tokenScore(query: Set<string>, candidate: Set<string>): number {
  if (query.size === 0 || candidate.size === 0) return 0;
  const shared = intersectionSize(query, candidate);
  if (shared === 0) return 0;
  const precision = shared / candidate.size;
  const recall = shared / query.size;
  return (2 * precision * recall) / (precision + recall);
}

/** "50 g", "50g", "6 x 50g", "330 ml" → the last number before a unit. Anything else → undefined. */
export function parseGrams(text: string): number | undefined {
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/gi)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  const n = Number(last[1]!.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function num(o: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!o) return undefined;
  const v = o[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A pack weight only counts as a portion if it is plausibly one sitting. */
const PACK_MIN_G = 10;
const PACK_MAX_G = 300;

export function plausiblePack(grams: number | undefined): number | undefined {
  return grams !== undefined && grams >= PACK_MIN_G && grams <= PACK_MAX_G ? grams : undefined;
}

/**
 * Turn one Open Food Facts product object into label nutrition, or null when it is unusable.
 * The database is crowd-sourced and patchy: a product with no name or no energy figure is no use,
 * and pretending otherwise is how a food ends up with 0 kcal and a badge saying that is a fact.
 */
export function parseProduct(p: unknown): LabelNutrition | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const n = o['nutriments'] as Record<string, unknown> | undefined;
  if (!n || typeof n !== 'object') return null;

  let kcal = num(n, 'energy-kcal_100g');
  if (kcal === undefined) {
    // Some entries only carry a bare energy-kcal. Take it only if the unit really is kcal.
    const unit = typeof n['energy-kcal_unit'] === 'string' ? (n['energy-kcal_unit'] as string) : 'kcal';
    if (unit.toLowerCase() === 'kcal') kcal = num(n, 'energy-kcal');
  }
  if (kcal === undefined || kcal < 0) return null;

  const name = String(o['product_name'] ?? '').trim();
  if (!name) return null;

  const brand = String(o['brands'] ?? '').split(',')[0]?.trim() ?? '';
  const servingGrams = positive(num(o, 'serving_quantity')) ?? parseGrams(String(o['serving_size'] ?? ''));
  const packGrams = positive(num(o, 'product_quantity')) ?? parseGrams(String(o['quantity'] ?? ''));

  return {
    code: String(o['code'] ?? ''),
    brand,
    name,
    per100: {
      kcal,
      protein: nonNegative(num(n, 'proteins_100g')),
      carbs: nonNegative(num(n, 'carbohydrates_100g')),
      fat: nonNegative(num(n, 'fat_100g')),
    },
    ...(servingGrams !== undefined ? { servingGrams } : {}),
    ...(packGrams !== undefined ? { packGrams } : {}),
  };
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && n > 0 ? n : undefined;
}

function nonNegative(n: number | undefined): number {
  return n !== undefined && n >= 0 ? n : 0;
}

export interface MatchQuery {
  /** What the user or the model called it, e.g. "Protein Flapjack". */
  text: string;
  /** The brand, when one is known. Its presence makes brand agreement mandatory. */
  brand?: string;
}

export interface Match {
  label: LabelNutrition;
  score: number;
}

/** Below this, a match is a guess wearing a label's clothes. */
export const MATCH_THRESHOLD = 0.5;

/**
 * Pick the best candidate for a query, or null when nothing is good enough.
 *
 * The brand rule is the important part and is deliberately absolute: if the query names a brand,
 * a candidate whose brand shares no token with it is discarded however well the product name
 * matches. Returning nothing is a correct answer; returning a rival manufacturer's numbers is not.
 */
export function bestMatch(query: MatchQuery, candidates: LabelNutrition[], threshold = MATCH_THRESHOLD): Match | null {
  const qBrand = query.brand ? tokens(query.brand) : new Set<string>();
  const qTokens = tokens(`${query.brand ?? ''} ${query.text}`);
  if (qTokens.size === 0) return null;

  const scored: Match[] = [];
  for (const label of candidates) {
    if (qBrand.size > 0 && intersectionSize(qBrand, tokens(label.brand)) === 0) continue;
    const score = tokenScore(qTokens, tokens(`${label.brand} ${label.name}`));
    if (score >= threshold) scored.push({ label, score });
  }
  if (scored.length === 0) return null;

  // Tie-break towards entries that know their own portion size: a correct match you cannot
  // portion is only half an answer. Name then barcode break the remaining ties, so the same query
  // always returns the same product — without them the answer depends on the order the database
  // happened to return its hits in, which is not a property a food log should have.
  scored.sort(
    (a, b) =>
      effectiveScore(b) - effectiveScore(a) ||
      a.label.name.localeCompare(b.label.name) ||
      a.label.code.localeCompare(b.label.code),
  );
  const best = scored[0]!;

  // Entries are patchy. If the winner has no portion size, borrow one from another entry of the
  // same brand — another flavour of the same bar is the same pack.
  if (best.label.servingGrams === undefined && best.label.packGrams === undefined) {
    const sibling = scored
      .map((m) => m.label)
      .find((l) => l !== best.label && sameBrand(l, best.label) && (l.servingGrams !== undefined || plausiblePack(l.packGrams) !== undefined));
    if (sibling) {
      const borrowed = sibling.servingGrams ?? plausiblePack(sibling.packGrams);
      if (borrowed !== undefined) return { ...best, label: { ...best.label, packGrams: borrowed } };
    }
  }
  return best;
}

function effectiveScore(m: Match): number {
  const knowsPortion = m.label.servingGrams !== undefined || m.label.packGrams !== undefined;
  return m.score + (knowsPortion ? 0.1 : 0);
}

function sameBrand(a: LabelNutrition, b: LabelNutrition): boolean {
  return a.brand.trim().toLowerCase() === b.brand.trim().toLowerCase() && a.brand.trim() !== '';
}

/**
 * The portion to use for a label, in grams: its own serving, else a plausible pack, else whatever
 * weight the food already had, else 100 g.
 */
export function portionGrams(label: LabelNutrition, existingGrams?: number): number {
  return label.servingGrams ?? plausiblePack(label.packGrams) ?? positive(existingGrams) ?? 100;
}

/** How to describe that portion, without inventing precision the database did not supply. */
export function portionLabel(label: LabelNutrition, grams: number): string {
  if (label.servingGrams !== undefined && grams === label.servingGrams) return `1 serving (${Math.round(grams)} g)`;
  if (label.packGrams !== undefined && grams === label.packGrams) return `1 pack (${Math.round(grams)} g)`;
  return `${Math.round(grams)} g`;
}

/** "TREK PROTEIN FLAPJACK" is shouting; title-case it. Mixed case is left exactly as found. */
export function displayName(label: LabelNutrition): string {
  const joined = [label.brand, label.name].filter((s) => s.trim()).join(' ').trim();
  if (!joined) return '';
  if (joined !== joined.toUpperCase()) return joined;
  return joined
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
