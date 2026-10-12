/**
 * The food being typed or edited in the food sheet, as a plain value with pure transitions. Pure
 * functions only: no IO, no clock, no database.
 *
 * Pulled out of `ui/FoodItemSheet.tsx` so the one rule that sheet must keep can be tested without
 * a DOM: **what counts as the user's own data.**
 *
 *   - Changing the AMOUNT — the weight, the unit chip, the portion text — says nothing about the
 *     food. A scanned label eaten at 250 g instead of 100 g is still that label's figures.
 *   - Changing the NUTRITION — calories, protein, carbs, fat, or accepting the Atwater
 *     correction — is the user overruling the figures. Only that makes the item their own
 *     (`source: 'user'`, the top of the trust order, which no label lookup may overwrite).
 *
 * The sheet used to treat every edit as the second kind, so a scanned label edited for weight
 * became untouchable 'user' data and a later, better label could never replace it.
 */

import { fromPer100, fromPortion, type FoodSource, type Macros, type Nutrition } from './food';
import { describeAmount, quantityOf, type UnitOption } from './foodUnits';
import { displayName, portionGrams, portionLabel, type LabelNutrition } from './products';
import type { FoodMemory, ItemUnits } from './types';

export type Basis = 'weighed' | 'portion';

export interface Draft {
  name: string;
  portion: string;
  basis: Basis;
  brand?: string;
  product?: string;
  /** Where these numbers came from. Carried through so the trust hierarchy still applies. */
  source?: FoodSource;
  /**
   * The name and figures on screen are a label's — a product's, not the user's. Cleared by
   * editing the nutrition, never by editing the weight.
   */
  fromLabel?: boolean;
  grams: number | null;
  /** Per 100 g when weighed; for the whole serving when not. */
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The pack and serving weights the food is known by, so the unit chips can offer them. */
  packGrams?: number;
  servingGrams?: number;
  /** The unit chip last tapped, by key. Taught to food memory on save. */
  unitKey?: string;
  /** The amount was changed on this sheet: the saved portion text is rewritten to match. */
  amountTouched?: boolean;
}

/** The part of a meal item a draft is built from. Structurally a `NewMealItem` (db/foodRepo). */
export interface DraftItem {
  name: string;
  portion: string;
  nutrition: Nutrition;
  source?: FoodSource;
  brand?: string;
  product?: string;
}

/** What a draft becomes on Save. Structurally a `NewMealItem`. */
export interface SavedDraft extends DraftItem {
  source: FoodSource;
  barcode?: string;
  unit?: { count: number; unitGrams: number; label: string; plural: string };
  units?: ItemUnits;
}

export function blankDraft(): Draft {
  return { name: '', portion: '', basis: 'weighed', grams: 100, kcal: null, protein: null, carbs: null, fat: null };
}

export function draftFrom(item?: DraftItem): Draft {
  if (!item) return blankDraft();
  const n = item.nutrition;
  const m = n.basis === 'weighed' ? n.per100 : n.macros;
  return {
    name: item.name,
    portion: item.portion,
    basis: n.basis,
    ...(item.brand ? { brand: item.brand } : {}),
    ...(item.product ? { product: item.product } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.source === 'label' ? { fromLabel: true } : {}),
    grams: n.basis === 'weighed' ? n.grams : null,
    kcal: m.kcal,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
  };
}

export function macrosFrom(d: Draft): Macros {
  return { kcal: d.kcal ?? 0, protein: d.protein ?? 0, carbs: d.carbs ?? 0, fat: d.fat ?? 0 };
}

export function nutritionFrom(d: Draft): Nutrition {
  return d.basis === 'weighed' ? fromPer100(macrosFrom(d), d.grams ?? 0) : fromPortion(macrosFrom(d));
}

/**
 * Change the amount: the weight, the unit it was counted in, or the portion text. The food is the
 * same food, so its source — and whether it is still a label's — is left exactly as it was.
 */
export function editAmount(d: Draft, patch: { grams?: number | null; unitKey?: string | undefined; portion?: string }): Draft {
  return {
    ...d,
    ...(patch.grams !== undefined ? { grams: patch.grams, amountTouched: true } : {}),
    ...('unitKey' in patch ? { unitKey: patch.unitKey } : {}),
    ...(patch.portion !== undefined ? { portion: patch.portion } : {}),
  };
}

export type NutritionField = 'kcal' | 'protein' | 'carbs' | 'fat';

/**
 * Overrule a figure. This, and only this, makes the draft the user's own data — they typed the
 * number, so the next label lookup must not overwrite it. Also what accepting the Atwater
 * correction does to the calories.
 */
export function editNutrition(d: Draft, field: NutritionField, value: number | null): Draft {
  return { ...d, [field]: value, source: 'user', fromLabel: false };
}

/**
 * Put a label's figures on a draft. `fromScan`: a barcode names one product, so its identity
 * replaces whatever was there; a name lookup keeps the brand the user typed.
 */
export function applyLabel(d: Draft, l: LabelNutrition, opts?: { fromScan?: boolean }): Draft {
  const grams = portionGrams(l, d.grams ?? undefined);
  return {
    ...d,
    name: displayName(l) || d.name,
    brand: opts?.fromScan ? l.brand || undefined : l.brand || d.brand,
    product: opts?.fromScan ? l.name || undefined : l.name || d.product,
    basis: 'weighed',
    grams,
    portion: portionLabel(l, grams),
    kcal: l.per100.kcal,
    protein: l.per100.protein,
    carbs: l.per100.carbs,
    fat: l.per100.fat,
    source: 'label',
    fromLabel: true,
    // The pack and serving the label states, uncapped: the chips offer a 400 g pack even though
    // the weight is only pre-filled from a pack that could plausibly be one sitting.
    packGrams: l.packGrams,
    servingGrams: l.servingGrams,
    unitKey: undefined,
    amountTouched: false,
  };
}

/** A remembered food as a draft: its figures, its usual weight, and the standing it had. */
export function applyMemory(m: FoodMemory): Draft {
  return {
    name: m.name,
    portion: '',
    basis: 'weighed',
    grams: m.typicalGrams ?? 100,
    kcal: m.per100.kcal,
    protein: m.per100.protein,
    carbs: m.per100.carbs,
    fat: m.per100.fat,
    brand: m.brand,
    product: m.product,
    // Carried across, so a remembered label keeps its standing and a remembered guess does not
    // acquire one it never had.
    source: m.source,
    fromLabel: m.source === 'label',
    packGrams: m.packGrams,
    servingGrams: m.servingGrams,
  };
}

/**
 * The item a draft saves as. A weighed amount that was changed here is re-described in the
 * food's own units ("1 pack (400 g)", "2 eggs (100 g)"), so the saved portion text can never
 * disagree with the weight beside it; one left alone keeps its text.
 */
export function draftToItem(d: Draft, opts: { options: UnitOption[]; barcode?: string }): SavedDraft {
  const weighed = d.basis === 'weighed';
  const grams = d.grams ?? 0;
  const portion = weighed
    ? d.amountTouched || !d.portion.trim()
      ? describeAmount(grams, opts.options)
      : d.portion.trim()
    : d.portion.trim() || '1 serving';
  const chosen = d.unitKey ? opts.options.find((o) => o.key === d.unitKey) : undefined;
  const teach: ItemUnits = {
    ...(d.packGrams ? { packGrams: d.packGrams } : {}),
    ...(d.servingGrams ? { servingGrams: d.servingGrams } : {}),
    ...(chosen ? { lastUnit: chosen.key } : {}),
  };
  return {
    name: d.name.trim(),
    portion,
    nutrition: nutritionFrom(d),
    source: d.source ?? 'user',
    ...(d.brand ? { brand: d.brand } : {}),
    ...(d.product ? { product: d.product } : {}),
    ...(opts.barcode ? { barcode: opts.barcode } : {}),
    ...(weighed && chosen?.kind === 'item' && grams > 0
      ? { unit: { count: quantityOf(chosen, grams), unitGrams: chosen.grams, label: chosen.noun, plural: chosen.nouns } }
      : {}),
    ...(weighed && Object.keys(teach).length > 0 ? { units: teach } : {}),
  };
}
