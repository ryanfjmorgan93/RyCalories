/**
 * Natural units for logging food: the amount in the terms the food comes in — a pack, half a
 * pack, two eggs — with grams as one option among them rather than the only one. Pure functions
 * only: no IO, no clock, no database.
 *
 * Where a food's units come from, in the order they are offered:
 *   1. the label's own pack (`packGrams`) and stated serving (`servingGrams`);
 *   2. the bundled UK table's alias unit — one egg, one slice, one rasher (an app estimate);
 *   3. what this owner has remembered for the food: a corrected unit weight, any further units;
 *   4. grams, always last and always there.
 *
 * Nothing here caps what may be offered. A 400 g pack of chicken is a perfectly good pack to eat
 * whole; the old `plausiblePack` limit (10 to 300 g) was a guard on pre-filling a weight, not on
 * offering a choice, and it is why "whole pack" never appeared for chicken.
 */

import { fmtGrams } from './format';
import { unitKeyOf } from './foodMemory';
import type { FoodMemory } from './types';

export type UnitKind = 'pack' | 'serving' | 'item' | 'grams';

/** One way to count a food. */
export interface UnitOption {
  /**
   * Stable short key — 'pack', 'serving', 'g', or the folded item label ('egg'). This, not the
   * display `label`, is what is stored as `FoodMemory.lastUnit`: a pack's label carries its
   * weight, and a different-sized pack of the same food must still be "the pack".
   */
  key: string;
  kind: UnitKind;
  /** For display and lists: "pack (400 g)", "serving (30 g)", "egg", "g". */
  label: string;
  /** What one of it is called, and several of it: "pack"/"packs", "egg"/"eggs". */
  noun: string;
  nouns: string;
  /** Grams in ONE of this unit. For the grams unit, the size the chips are built around. */
  grams: number;
}

/** Everything that can tell us what units a food has. All of it optional. */
export interface UnitSource {
  /** From the label just read (a scan or a lookup). Fresher than the remembered figure. */
  packGrams?: number;
  servingGrams?: number;
  /** The UK table alias's count-style unit — an app estimate of one item's weight. */
  tableUnit?: { label: string; plural?: string; grams: number };
  /** The remembered food, when there is one. */
  memory?: Pick<FoodMemory, 'packGrams' | 'servingGrams' | 'unitGrams' | 'unitLabel' | 'unitPlural' | 'units' | 'lastUnit' | 'typicalGrams'>;
}

const PACK_KEY = 'pack';
const SERVING_KEY = 'serving';
const GRAMS_KEY = 'g';
/** The weight the grams chips are built around when nothing says what this owner usually eats. */
export const DEFAULT_GRAMS = 100;
/** Past this, "2 packs" stops being a plausible thing to offer as a one-tap chip. */
const DOUBLE_PACK_MAX_G = 150;
/** An item lighter than this is counted up (1, 2, 3); a heavier one can sensibly be halved. */
const HALVABLE_ITEM_MIN_G = 60;

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Every unit a food can be counted in, in the order they are offered. Always ends with grams, so
 * the list is never empty.
 */
export function unitOptions(src: UnitSource): UnitOption[] {
  const out: UnitOption[] = [];

  const pack = positive(src.packGrams) ?? positive(src.memory?.packGrams);
  if (pack !== undefined) {
    out.push({ key: PACK_KEY, kind: 'pack', label: `pack (${fmtGrams(pack)})`, noun: 'pack', nouns: 'packs', grams: pack });
  }
  const serving = positive(src.servingGrams) ?? positive(src.memory?.servingGrams);
  if (serving !== undefined) {
    out.push({ key: SERVING_KEY, kind: 'serving', label: `serving (${fmtGrams(serving)})`, noun: 'serving', nouns: 'servings', grams: serving });
  }

  // Count-style units. A later source for the same item REPLACES the grams of an earlier one
  // (the table says an egg is 50 g, the owner's corrected 55 g is what they actually eat) and
  // keeps its position, so correcting a unit never reshuffles the chips.
  const put = (label: string | undefined, plural: string | undefined, grams: number | undefined) => {
    const g = positive(grams);
    const key = label ? unitKeyOf(label) : '';
    if (!label || g === undefined || !key || key === PACK_KEY || key === SERVING_KEY || key === GRAMS_KEY) return;
    const noun = label.trim();
    const nouns = (plural ?? '').trim() || noun;
    const at = out.findIndex((o) => o.kind === 'item' && o.key === key);
    const option: UnitOption = { key, kind: 'item', label: noun, noun, nouns, grams: g };
    if (at === -1) out.push(option);
    else out[at] = option;
  };
  if (src.tableUnit) put(src.tableUnit.label, src.tableUnit.plural, src.tableUnit.grams);
  const m = src.memory;
  if (m) {
    put(m.unitLabel ?? (m.unitGrams !== undefined ? 'item' : undefined), m.unitPlural, m.unitGrams);
    for (const u of m.units ?? []) put(u.label, u.plural, u.grams);
  }

  // Grams last. Built around what this owner usually eats when that is known, else 100 g, so
  // "Half" and "Double" of it are the useful chips rather than 50 g and 200 g of everything.
  const typical = positive(m?.typicalGrams);
  const base = typical !== undefined ? Math.max(1, Math.round(typical)) : DEFAULT_GRAMS;
  out.push({ key: GRAMS_KEY, kind: 'grams', label: 'g', noun: 'g', nouns: 'g', grams: base });
  return out;
}

/**
 * The unit a food opens on: the one last used for it, else the first of the list — which is the
 * pack for a packaged food, else its serving, else the table's or the owner's item unit, else
 * grams.
 */
export function defaultUnit(options: UnitOption[], src: UnitSource): UnitOption {
  const last = src.memory?.lastUnit;
  return (last ? options.find((o) => o.key === last) : undefined) ?? options[0]!;
}

/** One tappable amount: how much of a unit, what that comes to in grams, and what to call it. */
export interface AmountChip {
  /** Stable id for a test or a key: `${unit.key}-${qty}`. */
  id: string;
  /** How many of the unit. */
  qty: number;
  /** The total weight, to one decimal place. */
  grams: number;
  label: string;
}

export function chipGrams(unit: UnitOption, qty: number): number {
  return round1(unit.grams * qty);
}

/**
 * The one-tap amounts for a unit, the default amount first.
 *
 *   pack      Whole pack (400 g) · Half · (2 packs only for a small pack)
 *   serving   1 serving (30 g) · Half a serving · 2 servings
 *   item      1 egg · 2 eggs · 3 eggs (a light item) | 1 bun · ½ bun · 2 buns (a heavy one)
 *   grams     100 g · 50 g · 200 g
 *
 * "Some" and a typed weight are not here: they are a field, not a chip.
 */
export function amountChips(unit: UnitOption): AmountChip[] {
  const chip = (qty: number, label: string): AmountChip => ({ id: `${unit.key}-${qty}`, qty, grams: chipGrams(unit, qty), label });
  switch (unit.kind) {
    case 'pack':
      return [
        chip(1, `Whole pack (${fmtGrams(unit.grams)})`),
        chip(0.5, 'Half'),
        ...(unit.grams <= DOUBLE_PACK_MAX_G ? [chip(2, '2 packs')] : []),
      ];
    case 'serving':
      return [chip(1, `1 serving (${fmtGrams(unit.grams)})`), chip(0.5, 'Half a serving'), chip(2, '2 servings')];
    case 'item':
      return unit.grams < HALVABLE_ITEM_MIN_G
        ? [chip(1, `1 ${unit.noun}`), chip(2, `2 ${unit.nouns}`), chip(3, `3 ${unit.nouns}`)]
        : [chip(1, `1 ${unit.noun}`), chip(0.5, `½ ${unit.noun}`), chip(2, `2 ${unit.nouns}`)];
    case 'grams':
      return [chip(1, fmtGrams(unit.grams)), chip(0.5, fmtGrams(round1(unit.grams / 2))), chip(2, fmtGrams(unit.grams * 2))];
  }
}

const FRACTIONS: Array<[number, string]> = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

/** "½", "1", "1½", "2.5"; null when the quantity has no tidy spelling. */
function quantityText(qty: number): string | null {
  const whole = Math.floor(qty + 1e-9);
  const rest = qty - whole;
  if (Math.abs(rest) < 1e-9) return String(whole);
  const frac = FRACTIONS.find(([v]) => Math.abs(rest - v) < 1e-6);
  if (!frac) return null;
  return whole === 0 ? frac[1] : `${whole}${frac[1]}`;
}

/**
 * What to write on the meal item for `qty` of `unit`, the way a person would say it:
 * "1 pack (400 g)", "½ pack (200 g)", "2 eggs (100 g)", "35% of a pack (140 g)", "150 g".
 */
export function portionText(unit: UnitOption, qty: number): string {
  const grams = chipGrams(unit, qty);
  if (unit.kind === 'grams') return fmtGrams(grams);
  const total = fmtGrams(grams);
  const text = quantityText(qty);
  if (text === null) {
    // A fraction with no spelling ("0.35 of a pack"): a percentage reads better than a decimal.
    if (qty < 1) return `${Math.round(qty * 100)}% of a ${unit.noun} (${total})`;
    return `${Math.round(qty * 100) / 100} ${unit.nouns} (${total})`;
  }
  const noun = qty <= 1 ? unit.noun : unit.nouns;
  return `${text} ${noun} (${total})`;
}

/** Quantities worth naming when going from a weight back to an amount: ¼ ⅓ ½ ⅔ ¾, then whole and half counts. */
const NAMEABLE: number[] = [...FRACTIONS.map(([v]) => v), ...Array.from({ length: 20 }, (_, i) => (i + 2) / 2)];

/**
 * Describe a weight in the units the food has, for a weight the owner typed or edited rather than
 * tapped: 400 g of a 400 g pack is "1 pack (400 g)", 100 g of eggs "2 eggs (100 g)". Anything that
 * is not a tidy multiple of any unit — and anything with no unit but grams — is just "150 g".
 */
export function describeAmount(grams: number, options: UnitOption[]): string {
  if (!(grams > 0)) return fmtGrams(0);
  for (const unit of options) {
    if (unit.kind === 'grams') continue;
    const qty = NAMEABLE.find((q) => Math.abs(q * unit.grams - grams) <= 0.5);
    if (qty !== undefined) return portionText(unit, qty);
  }
  return fmtGrams(round1(grams));
}

/** How many of a unit a weight is, e.g. 200 g of a 400 g pack is 0.5. */
export function quantityOf(unit: UnitOption, grams: number): number {
  return unit.grams > 0 ? grams / unit.grams : 0;
}
