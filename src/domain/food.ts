/**
 * Nutrition domain. Pure functions only — no IO, no clock, no database.
 *
 * The central modelling decision, and the reason this is not a direct port of the Kotlin
 * original: a portion's weight and its nutrition can never disagree, because they are never
 * stored as independent numbers.
 *
 * The old app stored absolute calories and macros alongside an optional `grams`, and its portion
 * multiplier scaled the macros while leaving `grams` untouched (MainViewModel.kt:275-300). Double
 * a 100 g portion and you got 200 g worth of calories labelled as 100 g. That is silently wrong on
 * its own, and it would have been corrosive to the food-memory strategy, which learns per-100g
 * values from exactly these numbers.
 *
 * Here a portion is one of two things and never both:
 *   - `weighed`  — a weight in grams plus nutrition per 100 g. Rescaling changes only the weight.
 *   - `portion`  — nutrition for an unweighed serving. There is nothing to rescale against.
 * Actual macros are always derived, never stored, so the two cannot drift apart.
 */

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Where a number came from. Drives both the UI badge and what may overwrite what. */
export type FoodSource = 'model' | 'label' | 'user' | 'memory';

/**
 * Trust order. A source may only be overwritten by one of equal or higher trust, which is what
 * stops a model guess from entrenching itself in food memory and lending it false authority.
 */
const TRUST: Record<FoodSource, number> = { model: 0, memory: 1, label: 2, user: 3 };

export function trustOf(source: FoodSource): number {
  return TRUST[source];
}

export function mayOverwrite(existing: FoodSource, incoming: FoodSource): boolean {
  return TRUST[incoming] >= TRUST[existing];
}

export type Nutrition =
  | { basis: 'weighed'; grams: number; per100: Macros }
  | { basis: 'portion'; macros: Macros };

export interface FoodItem {
  id: string;
  name: string;
  /** Free text as the model or the user described the serving, e.g. "1 bowl". Display only. */
  portion: string;
  brand?: string;
  product?: string;
  source: FoodSource;
  nutrition: Nutrition;
}

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function roundMacros(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), protein: round1(m.protein), carbs: round1(m.carbs), fat: round1(m.fat) };
}

/**
 * Macros at the precision they are displayed at: whole kilocalories, whole grams.
 *
 * Totals are summed from these rather than from the raw doubles, so that the arithmetic on screen
 * adds up. Rounding each part and the total independently is individually honest and collectively
 * wrong — four items showing 289 + 286 + 50 + 106 under a total reading 730 is a maths error as
 * far as anyone reading it is concerned. The cost is at most half a unit per item against figures
 * that come off labels accurate to about ±20%.
 */
export function displayMacros(n: Nutrition): Macros {
  const m = macrosOf(n);
  return { kcal: Math.round(m.kcal), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) };
}

export function scaleMacros(m: Macros, factor: number): Macros {
  return { kcal: m.kcal * factor, protein: m.protein * factor, carbs: m.carbs * factor, fat: m.fat * factor };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

/** The macros actually eaten for this portion. Always derived. */
export function macrosOf(n: Nutrition): Macros {
  return n.basis === 'weighed' ? scaleMacros(n.per100, n.grams / 100) : n.macros;
}

export function itemMacros(item: FoodItem): Macros {
  return macrosOf(item.nutrition);
}

/** Sum of every item. The only way totals are ever produced. */
export function totalMacros(items: FoodItem[]): Macros {
  return items.reduce((acc, i) => addMacros(acc, itemMacros(i)), ZERO);
}

/** Portion weight, when known. */
export function gramsOf(n: Nutrition): number | null {
  return n.basis === 'weighed' ? n.grams : null;
}

/**
 * Change a weighed portion's weight. Macros follow automatically — this is the operation the old
 * multiplier got wrong. A no-op on an unweighed portion, which has no weight to change.
 */
export function withGrams(n: Nutrition, grams: number): Nutrition {
  if (n.basis !== 'weighed') return n;
  return { basis: 'weighed', grams: Math.max(0, grams), per100: n.per100 };
}

/** Scale a portion. Weighed portions scale by weight; unweighed ones scale their macros. */
export function scaleNutrition(n: Nutrition, factor: number): Nutrition {
  const f = Math.max(0, factor);
  return n.basis === 'weighed'
    ? { basis: 'weighed', grams: n.grams * f, per100: n.per100 }
    : { basis: 'portion', macros: scaleMacros(n.macros, f) };
}

/**
 * Learning a portion's weight upgrades it to `weighed` without changing what was eaten: the
 * per-100g values are back-computed from the macros already recorded. This is how a user typing
 * a kitchen-scale weight, or a label lookup supplying a pack size, makes a portion rescalable.
 */
export function weigh(n: Nutrition, grams: number): Nutrition {
  if (grams <= 0) return n;
  if (n.basis === 'weighed') return withGrams(n, grams);
  return { basis: 'weighed', grams, per100: scaleMacros(n.macros, 100 / grams) };
}

/** Build a weighed portion straight from label values, which are always quoted per 100 g. */
export function fromPer100(per100: Macros, grams: number): Nutrition {
  return { basis: 'weighed', grams: Math.max(0, grams), per100 };
}

export function fromPortion(macros: Macros): Nutrition {
  return { basis: 'portion', macros };
}

// ---------------------------------------------------------------------------
// Plausibility

/** Energy implied by the macros alone, using Atwater factors. */
export function atwaterKcal(m: Macros): number {
  return 4 * m.protein + 4 * m.carbs + 9 * m.fat;
}

export interface AtwaterCheck {
  /** Energy the macros imply. */
  implied: number;
  /** Signed disagreement as a fraction of the stated calories. Positive when macros imply more. */
  drift: number;
  ok: boolean;
  reason?: 'impossible' | 'unexplained';
}

/**
 * Cross-check stated calories against the macros. A small model can produce 250 kcal alongside
 * 30 g of fat, which is 270 kcal from fat alone — individually each field looks reasonable and
 * clamping them separately never notices.
 *
 * The two directions are not equally suspicious, so they get different thresholds:
 *
 *   - Macros implying MORE energy than stated is close to a physical impossibility: that energy
 *     is in the food by definition. Only rounding and the fibre convention excuse it. Fibre is
 *     counted inside carbohydrate on UK and EU labels but yields roughly 2 kcal/g rather than 4,
 *     so a high-fibre food can legitimately over-imply by a few per cent. Hence a tight margin.
 *   - Stated energy exceeding the macros is merely unexplained, and sometimes genuinely correct:
 *     alcohol carries 7 kcal/g and appears in no macro field. Hence a loose margin.
 */
export function checkAtwater(m: Macros, overMargin = 0.1, underMargin = 0.25): AtwaterCheck {
  const implied = atwaterKcal(m);
  if (m.kcal <= 0) return { implied, drift: 0, ok: implied <= 0 };
  const drift = (implied - m.kcal) / m.kcal;
  // Purely relative margins have a fixed point at the bottom of the scale. A diet squash at
  // 3 kcal with 0.3 g of carbs implies 1.2 kcal — a 60% shortfall, so it is flagged; accepting
  // the correction sets 1 kcal, which is then 20% under its own implied 1.2 and flagged again,
  // for ever. Below an absolute floor the 4/4/9 factors and label rounding dominate and there is
  // no disagreement worth reporting.
  if (Math.abs(implied - m.kcal) <= ABSOLUTE_FLOOR_KCAL) return { implied, drift, ok: true };
  if (drift > overMargin) return { implied, drift, ok: false, reason: 'impossible' };
  if (-drift > underMargin) return { implied, drift, ok: false, reason: 'unexplained' };
  return { implied, drift, ok: true };
}

/** Energy disagreements smaller than this are rounding, not error. */
const ABSOLUTE_FLOOR_KCAL = 5;

/**
 * Replace an implausible calorie figure with the one the macros imply. Each macro is anchored to
 * a visible quantity of food; the calorie figure is a single leap, so it is the one to distrust.
 */
export function reconcileMacros(
  m: Macros,
  overMargin = 0.1,
  underMargin = 0.25,
): { macros: Macros; corrected: boolean; reason?: AtwaterCheck['reason'] } {
  const check = checkAtwater(m, overMargin, underMargin);
  if (check.ok || check.implied <= 0) return { macros: m, corrected: false };
  return { macros: { ...m, kcal: Math.round(check.implied) }, corrected: true, reason: check.reason };
}

// ---------------------------------------------------------------------------
// Packaging

const GENERIC_BRANDS = new Set(['homemade', 'home made', 'generic', 'own', 'unbranded', 'none', 'n/a', 'unknown']);

/**
 * Whether this looks like a packaged product worth looking up against a label database.
 * "Homemade" and "generic" are things a model says when it means "not packaged", and taking
 * them literally costs a pointless network round trip on every home-cooked plate.
 */
export function isPackaged(item: Pick<FoodItem, 'brand' | 'product'>): boolean {
  const brand = (item.brand ?? '').trim().toLowerCase();
  const product = (item.product ?? '').trim();
  if (brand && !GENERIC_BRANDS.has(brand)) return true;
  return product.length > 0 && !GENERIC_BRANDS.has(product.toLowerCase());
}
