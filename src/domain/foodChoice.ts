/**
 * A food picked in the Add food sheet, whatever it came from — something remembered, a row of the
 * bundled UK table, or a product label — reduced to what the amount step needs: its name, its
 * per-100 g figures, where they came from, and every unit it can be counted in. Pure functions
 * only: no IO, no clock, no database; the table and food memory are handed in already loaded.
 *
 * This is also the shape a Claude reader hands over later: whatever it recognised becomes a
 * `FoodChoice` (source 'model', units from its own estimate) and goes through the same
 * `itemFromAmount`, so a photographed meal and a tapped chip log the same kind of item.
 */

import { fromPer100, macrosOf, trustOf, type FoodSource, type Macros, type Nutrition } from './food';
import { normalise, rankMemories } from './foodMemory';
import { amountChips, defaultUnit, portionText, unitOptions, type AmountChip, type UnitOption, type UnitSource } from './foodUnits';
import { searchFoods, type FoodAlias, type IngredientCandidate, type TableFood } from './ingredientMatch';
import { displayName, type LabelNutrition } from './products';
import type { FoodMemory, ItemUnits } from './types';

export type ChoiceOrigin = 'memory' | 'table' | 'label';

export interface FoodChoice {
  /** Identity within a result list. */
  key: string;
  name: string;
  brand?: string;
  product?: string;
  per100: Macros;
  /** Where the figures came from; becomes the item's `source`. */
  source: FoodSource;
  origin: ChoiceOrigin;
  /** Everything known about how this food is counted. */
  units: UnitSource;
}

/** The item an amount produces. Structurally a `NewMealItem` (db/foodRepo) — this module cannot import it. */
export interface AmountItem {
  name: string;
  portion: string;
  nutrition: Nutrition;
  source: FoodSource;
  brand?: string;
  product?: string;
  unit?: { count: number; unitGrams: number; label: string; plural: string };
  units: ItemUnits;
}

type TableUnit = NonNullable<UnitSource['tableUnit']>;

export function choiceFromMemory(m: FoodMemory, tableUnit?: TableUnit): FoodChoice {
  return {
    key: `memory:${m.key}`,
    name: m.name,
    ...(m.brand ? { brand: m.brand } : {}),
    ...(m.product ? { product: m.product } : {}),
    per100: m.per100,
    source: m.source,
    origin: 'memory',
    units: { memory: m, ...(tableUnit ? { tableUnit } : {}) },
  };
}

/**
 * A product label as a choice. Its pack and serving come straight off the label, uncapped.
 *
 * `known` is the remembered food for the same product, when the owner has eaten it before: its
 * last unit, corrected unit weights and usual portion come along, so the chips open where they
 * left off. Its figures replace the label's only when they outrank a label — the owner's own
 * correction is not undone by a fresh read of the pack.
 */
export function choiceFromLabel(l: LabelNutrition, known?: FoodMemory): FoodChoice {
  const name = displayName(l);
  const base: FoodChoice = {
    key: `label:${l.code || normalise(name)}`,
    name,
    ...(l.brand ? { brand: l.brand } : {}),
    ...(l.name ? { product: l.name } : {}),
    per100: l.per100,
    source: 'label',
    origin: 'label',
    units: {
      ...(l.packGrams !== undefined ? { packGrams: l.packGrams } : {}),
      ...(l.servingGrams !== undefined ? { servingGrams: l.servingGrams } : {}),
    },
  };
  if (!known) return base;
  const units = { ...base.units, memory: known };
  return trustOf(known.source) > trustOf('label') ? { ...base, per100: known.per100, source: known.source, units } : { ...base, units };
}

/**
 * The count-style unit of each table food that has one, by the food's folded name: one egg is
 * 50 g whichever way the food was found. Built once per alias list.
 */
const aliasUnits = new WeakMap<FoodAlias[], Map<string, TableUnit>>();

function tableUnitIndex(foods: TableFood[], aliases: FoodAlias[]): Map<string, TableUnit> {
  const cached = aliasUnits.get(aliases);
  if (cached) return cached;
  const withUnit = aliases.filter((a) => a.unit);
  const wanted = new Set(withUnit.map((a) => a.code));
  const nameOf = new Map<string, string>();
  for (const f of foods) if (wanted.has(f.code)) nameOf.set(f.code, normalise(f.name));
  const index = new Map<string, TableUnit>();
  for (const a of withUnit) {
    const name = nameOf.get(a.code);
    if (name && !index.has(name)) index.set(name, { label: a.unit!.label, plural: a.unit!.plural, grams: a.unit!.grams });
  }
  // Only worth keeping once the table has really loaded: an empty `foods` would cache an empty index.
  if (foods.length > 0) aliasUnits.set(aliases, index);
  return index;
}

/**
 * Search everything offline: remembered foods, then the table. Results are one per food. A table
 * row the owner has already logged is shown as the remembered food — its figures may be theirs and
 * its last unit is theirs — and either way the table's count-style unit for it (one egg, one
 * slice) is still offered.
 */
export function searchChoices(
  query: string,
  sources: { foods: TableFood[]; aliases: FoodAlias[]; memories: FoodMemory[] },
  limit = 12,
): FoodChoice[] {
  const byKey = new Map(sources.memories.map((m) => [m.key, m]));
  const tableUnits = tableUnitIndex(sources.foods, sources.aliases);
  const out: FoodChoice[] = [];
  const seen = new Set<string>();
  for (const c of searchFoods(query, sources, limit)) {
    const choice = candidateChoice(c, byKey, tableUnits);
    if (seen.has(choice.key)) continue;
    seen.add(choice.key);
    out.push(choice);
  }
  return out;
}

/** The remembered foods as choices, most eaten and most recent first — the list before anything is typed. */
export function recentChoices(
  memories: FoodMemory[],
  table: { foods: TableFood[]; aliases: FoodAlias[] },
  limit = 8,
): FoodChoice[] {
  const tableUnits = tableUnitIndex(table.foods, table.aliases);
  return rankMemories('', memories, limit).map(({ memory }) => choiceFromMemory(memory, tableUnits.get(normalise(memory.name))));
}

function candidateChoice(c: IngredientCandidate, memoriesByKey: Map<string, FoodMemory>, tableUnits: Map<string, TableUnit>): FoodChoice {
  if (c.key.startsWith('memory:')) {
    const m = memoriesByKey.get(c.key.slice('memory:'.length));
    if (m) return choiceFromMemory(m, tableUnits.get(normalise(m.name)));
  }
  // A table row. If the owner has logged this very food, theirs is the better record of it.
  const twin = memoriesByKey.get(`n:${normalise(c.name)}`);
  if (twin) return choiceFromMemory(twin, tableUnits.get(normalise(twin.name)) ?? c.unit);
  const unit = c.unit ?? tableUnits.get(normalise(c.name));
  return {
    key: c.key,
    name: c.name,
    per100: c.per100,
    source: c.source,
    origin: 'table',
    units: unit ? { tableUnit: unit } : {},
  };
}

/** What the amount step shows for a food: its units, the one it opens on, and that unit's chips. */
export function amountPlan(choice: FoodChoice): { options: UnitOption[]; unit: UnitOption; chips: AmountChip[] } {
  const options = unitOptions(choice.units);
  const unit = defaultUnit(options, choice.units);
  return { options, unit, chips: amountChips(unit) };
}

export function kcalFor(choice: Pick<FoodChoice, 'per100'>, grams: number): number {
  return macrosOf(fromPer100(choice.per100, grams)).kcal;
}

/**
 * The item for `qty` of `unit` of a food. The item carries everything `rememberFood` needs to
 * bring the same chips back next time: the pack and serving weights, the item units, and the unit
 * just used.
 */
export function itemFromAmount(choice: FoodChoice, unit: UnitOption, qty: number, options: UnitOption[]): AmountItem {
  const grams = Math.round(unit.grams * qty * 10) / 10;
  const pack = options.find((o) => o.kind === 'pack');
  const serving = options.find((o) => o.kind === 'serving');
  const extra = options
    .filter((o) => o.kind === 'item' && o.key !== unit.key)
    .map((o) => ({ label: o.noun, plural: o.nouns, grams: o.grams }));
  return {
    name: choice.name,
    portion: portionText(unit, qty),
    nutrition: fromPer100(choice.per100, grams),
    source: choice.source,
    ...(choice.brand ? { brand: choice.brand } : {}),
    ...(choice.product ? { product: choice.product } : {}),
    ...(unit.kind === 'item' ? { unit: { count: qty, unitGrams: unit.grams, label: unit.noun, plural: unit.nouns } } : {}),
    units: {
      ...(pack ? { packGrams: pack.grams } : {}),
      ...(serving ? { servingGrams: serving.grams } : {}),
      ...(extra.length > 0 ? { extra } : {}),
      lastUnit: unit.key,
    },
  };
}
