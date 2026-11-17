/**
 * The weekly shop (CONTEXT.md; docs/superpowers/specs/2026-11-17-weekly-shop-design.md): the food to
 * buy for the coming week, in packs, worked out from what the owner already eats and read against
 * the week's targets. Pure: the eating, the remembered packs and what the owner changed come in.
 */
import { addMacros, scaleMacros, ZERO, type Macros } from './food';
import { addDays, mondayOf } from './dates';

export const AISLES = ['Fruit and veg', 'Meat and fish', 'Dairy and eggs', 'Bakery', 'Cupboard', 'Frozen', 'Other'] as const;
export type Aisle = (typeof AISLES)[number];

/** The Monday of the week being shopped for: the week after the coming Sunday (on a Sunday, tomorrow's). */
export function shopWeek(today: string): string {
  return mondayOf(addDays(today, 7));
}

/** A UK table code's food group read as an aisle (CoFID's first two digits). */
export function aisleOfCode(code: string): Aisle {
  switch (code.slice(0, 2)) {
    case '11':
    case '17':
      return 'Cupboard';
    case '12':
      return 'Dairy and eggs';
    case '13':
    case '14':
      return 'Fruit and veg';
    case '16':
    case '18':
    case '19':
      return 'Meat and fish';
    default:
      return 'Other';
  }
}

/** One food eaten in the window, already one that can be bought (not a Claude estimate). */
export interface Eaten {
  key: string;
  name: string;
  date: string;
  /** Grams eaten when it was weighed; null when only its macros are known (a portion). */
  grams: number | null;
  macros: Macros;
}

/** What is remembered about how a food comes: a pack's weight, or one of it (an egg). */
export interface PackFacts {
  packGrams?: number;
  unitGrams?: number;
  unitLabel?: string;
  unitPlural?: string;
}

/** The owner's fixes for a food, kept across weeks. */
export interface FoodFix {
  /** One pack, in grams (or portions for a food logged by the portion). */
  pack?: number;
  aisle?: Aisle;
}

/** The owner's changes to a line, kept for the week being planned. */
export interface LineState {
  /** Set by − and +: from then on the week's amount is the packs bought. */
  packs?: number;
  inAlready?: boolean;
  ticked?: boolean;
}

export interface ShopLine {
  key: string;
  name: string;
  aisle: Aisle;
  /** 'g' when the food was weighed, 'portion' when only portions were logged. */
  unit: 'g' | 'portion';
  /** The macros of one unit: one gram, or one portion. */
  per: Macros;
  /** What will be eaten this week, in units. */
  week: number;
  /** One pack, in units. */
  pack: number;
  /** One pack is one of a count unit ("egg"/"eggs"), when it is. */
  count?: { one: string; many: string };
  packs: number;
  inAlready: boolean;
  ticked: boolean;
}

/**
 * Each food eaten in the window as a line: its amount per logged day × 7 (never per calendar day:
 * an unlogged day is not a day of eating nothing), its pack, and what the owner changed.
 * `loggedDays` counts days with any food logged, estimates included. Strongest protein first.
 */
export function shopLines(
  eaten: Eaten[],
  loggedDays: number,
  facts: Record<string, PackFacts>,
  fixes: Record<string, FoodFix>,
  state: Record<string, LineState>,
  aisleOf: (name: string) => Aisle | undefined,
): ShopLine[] {
  if (loggedDays <= 0) return [];
  const byKey = new Map<string, Eaten[]>();
  for (const e of eaten) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);

  const lines: ShopLine[] = [];
  for (const [key, rows] of byKey) {
    const weighed = rows.filter((r) => r.grams !== null && r.grams > 0);
    const name = rows[rows.length - 1]!.name;
    const f = facts[key] ?? {};
    const fix = fixes[key] ?? {};
    let unit: ShopLine['unit'];
    let per: Macros;
    let amount: number;
    if (weighed.length > 0) {
      const grams = weighed.reduce((s, r) => s + r.grams!, 0);
      per = scaleMacros(weighed.reduce((m, r) => addMacros(m, r.macros), ZERO), 1 / grams);
      // A portion of a food also weighed elsewhere counts by its calories, at the weighed figures.
      const portions = rows.filter((r) => !weighed.includes(r));
      amount = grams + (per.kcal > 0 ? portions.reduce((s, r) => s + r.macros.kcal / per.kcal, 0) : 0);
      unit = 'g';
    } else {
      per = scaleMacros(rows.reduce((m, r) => addMacros(m, r.macros), ZERO), 1 / rows.length);
      amount = rows.length;
      unit = 'portion';
    }
    const countPack = unit === 'g' && fix.pack === undefined && !f.packGrams && f.unitGrams && f.unitLabel;
    const pack = fix.pack ?? (unit === 'g' ? (f.packGrams ?? f.unitGrams ?? 100) : 1);
    const s = state[key] ?? {};
    const eatenWeek = (amount / loggedDays) * 7;
    const packs = s.packs ?? Math.ceil(eatenWeek / pack - 1e-9);
    lines.push({
      key,
      name,
      aisle: fix.aisle ?? aisleOf(name) ?? 'Other',
      unit,
      per,
      week: s.packs !== undefined ? s.packs * pack : eatenWeek,
      pack,
      count: countPack ? { one: f.unitLabel!, many: f.unitPlural ?? `${f.unitLabel}s` } : undefined,
      packs,
      inAlready: !!s.inAlready,
      ticked: !!s.ticked,
    });
  }
  return lines.sort((a, b) => lineFigures(b).protein - lineFigures(a).protein || a.name.localeCompare(b.name));
}

/** A line's calories and protein for the week, whole numbers, so the totals add up from them. */
export function lineFigures(line: ShopLine): { kcal: number; protein: number } {
  return { kcal: Math.round(line.per.kcal * line.week), protein: Math.round(line.per.protein * line.week) };
}

/** What the list reaches: the sum of its lines as shown, in-already lines included (they are eaten). */
export function shopTotals(lines: ShopLine[]): { kcal: number; protein: number } {
  return lines.reduce(
    (t, l) => {
      const f = lineFigures(l);
      return { kcal: t.kcal + f.kcal, protein: t.protein + f.protein };
    },
    { kcal: 0, protein: 0 },
  );
}

/** The week's targets: each day's calorie target summed (null when a day has none), and protein × 7. */
export function weekTargets(dailyKcal: (number | null)[], dailyProtein: number): { kcal: number | null; protein: number } {
  return {
    kcal: dailyKcal.some((k) => k === null) ? null : dailyKcal.reduce<number>((s, k) => s + k!, 0),
    protein: dailyProtein * dailyKcal.length,
  };
}

/**
 * More of the same: one pack at a time of the line with the most protein per calorie, until the
 * protein target is met, at most `cap` packs. Returns the packs for each line it changed.
 */
export function moreOfTheSame(lines: ShopLine[], proteinTarget: number, cap = 20): Record<string, number> {
  const best = lines
    .filter((l) => l.per.protein > 0 && l.per.kcal > 0)
    .sort((a, b) => b.per.protein / b.per.kcal - a.per.protein / a.per.kcal)[0];
  if (!best) return {};
  let protein = shopTotals(lines).protein;
  let packs = best.packs;
  let added = 0;
  // Each added pack moves the line to what is bought, as − and + do.
  while (protein < proteinTarget && added < cap) {
    packs += 1;
    added += 1;
    protein = shopTotals(lines.map((l) => (l === best ? { ...l, packs, week: packs * l.pack } : l))).protein;
  }
  return added > 0 ? { [best.key]: packs } : {};
}

/** A weight as the shop says it: "560 g", "1.4 kg". */
export function fmtWeight(grams: number): string {
  if (grams < 1000) return `${Math.round(grams)} g`;
  return `${Math.round(grams / 100) / 10} kg`;
}

/** What to pick up: "2 × 750 g", "14 eggs", "3 portions". */
export function packText(line: ShopLine): string {
  if (line.count) return `${line.packs} ${line.packs === 1 ? line.count.one : line.count.many}`;
  if (line.unit === 'portion') return `${line.packs} ${line.packs === 1 ? 'portion' : 'portions'}`;
  return `${line.packs} × ${fmtWeight(line.pack)}`;
}

/** What will be eaten this week: "1.4 kg", "14 eggs", "5 portions". */
export function weekText(line: ShopLine): string {
  if (line.count) {
    const n = Math.round(line.week / line.pack);
    return `${n} ${n === 1 ? line.count.one : line.count.many}`;
  }
  if (line.unit === 'portion') {
    const n = Math.round(line.week * 10) / 10;
    return `${n} ${n === 1 ? 'portion' : 'portions'}`;
  }
  return fmtWeight(line.week);
}

