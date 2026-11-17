/**
 * The diet check (docs/superpowers/specs/2026-11-17-diet-check-design.md): the coach's reading of
 * what the owner actually ate over the last 4 weeks, scored on the food itself rather than the
 * calories, with a verdict on the foods they eat most. Pure: the diary rows come in, and so does
 * the coach's answer, which is cleaned here before anything is shown or stored.
 */
import type { Macros } from './food';
import { normalise } from './foodMemory';

/** How far back the check reads, today included. */
export const DIET_WINDOW_DAYS = 28;
/** Fewer logged days than this is not a diet to read. */
export const DIET_MIN_DAYS = 3;
/** Each of the four parts is out of this, so the score is out of 100. */
export const PART_MAX = 25;

export const DIET_PARTS = [
  { key: 'whole_foods', name: 'Whole foods' },
  { key: 'fruit_veg', name: 'Fruit and veg' },
  { key: 'fibre', name: 'Fibre' },
  { key: 'processed_salt', name: 'Processed and salt' },
] as const;
export type DietPartKey = (typeof DIET_PARTS)[number]['key'];

export type Verdict = 'keep' | 'fine' | 'swap' | 'cut';
export const VERDICT_LABEL: Record<Verdict, string> = { keep: 'Keep', fine: 'Fine', swap: 'Swap', cut: 'Cut back' };

/** One food logged in the window. */
export interface DietRow {
  /** The key two entries share when they are the same food (`memoryKey`). */
  key: string;
  name: string;
  date: string;
  portion: string;
  macros: Macros;
  /** One of Claude's estimates rather than a label, the UK table or the owner's own figures. */
  estimate: boolean;
}

/** A food as the coach is told about it: how often, how much, and what one serving of it is. */
export interface DietFood {
  name: string;
  times: number;
  days: number;
  /** The amount it was most often logged as. */
  portion: string;
  /** One serving on average. */
  each: Macros;
  /** Its share of every calorie logged in the window, as a whole percentage. */
  kcalShare: number;
  estimate: boolean;
}

export interface DietDigest {
  from: string;
  to: string;
  loggedDays: number;
  /** Most eaten first, at most 40. */
  foods: DietFood[];
}

/** What was eaten in the window, food by food, most eaten first. */
export function dietDigest(rows: DietRow[], from: string, to: string): DietDigest {
  const inWindow = rows.filter((r) => r.date >= from && r.date <= to);
  const total = inWindow.reduce((s, r) => s + r.macros.kcal, 0);
  const groups = new Map<string, DietRow[]>();
  for (const r of inWindow) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
  const foods: (DietFood & { kcal: number })[] = [...groups.values()].map((g) => {
    const n = g.length;
    const sum = (f: (m: Macros) => number) => g.reduce((s, r) => s + f(r.macros), 0);
    const portions = new Map<string, number>();
    for (const r of g) portions.set(r.portion, (portions.get(r.portion) ?? 0) + 1);
    const kcal = sum((m) => m.kcal);
    return {
      name: g[g.length - 1]!.name,
      times: n,
      days: new Set(g.map((r) => r.date)).size,
      portion: [...portions].sort((a, b) => b[1] - a[1])[0]![0],
      each: { kcal: Math.round(kcal / n), protein: Math.round(sum((m) => m.protein) / n), carbs: Math.round(sum((m) => m.carbs) / n), fat: Math.round(sum((m) => m.fat) / n) },
      kcalShare: total > 0 ? Math.round((kcal / total) * 100) : 0,
      estimate: g.some((r) => r.estimate),
      kcal,
    };
  });
  foods.sort((a, b) => b.times - a.times || b.kcal - a.kcal || a.name.localeCompare(b.name));
  return {
    from,
    to,
    loggedDays: new Set(inWindow.map((r) => r.date)).size,
    foods: foods.slice(0, 40).map(({ kcal: _kcal, ...f }) => f),
  };
}

/** The digest as the lines the coach reads. */
export function digestText(d: DietDigest): string {
  const head = `FOOD LOGGED ${d.from} to ${d.to}: ${d.loggedDays} of ${DIET_WINDOW_DAYS} days logged. Each food: times logged, days it appeared on, its usual amount, one serving's figures, its share of all calories logged.`;
  const lines = d.foods.map(
    (f) =>
      `- ${f.name}: ${f.times} times on ${f.days} ${f.days === 1 ? 'day' : 'days'} · usually ${f.portion} · each ${f.estimate ? '≈ ' : ''}${f.each.kcal} kcal, P ${f.each.protein} C ${f.each.carbs} F ${f.each.fat} · ${f.kcalShare}% of calories`,
  );
  return [head, ...lines].join('\n');
}

export interface DietPart {
  key: DietPartKey;
  name: string;
  points: number;
  line: string;
}

export interface DietAdvice {
  what: string;
  why: string;
}

export interface DietRegular {
  name: string;
  /** From the diary, never from the coach. */
  times: number;
  days: number;
  verdict: Verdict;
  /** What it does for their body fat and their goal. */
  bodyFat: string;
  /** What is against it; empty when nothing is. */
  theCatch: string;
  /** A better option; empty when it is already the right food. */
  better: string;
}

/** A finished check, as it is stored and shown. */
export interface DietCheck {
  at: string;
  from: string;
  to: string;
  loggedDays: number;
  headline: string;
  detail: string;
  parts: DietPart[];
  working: string[];
  add: DietAdvice[];
  cut: DietAdvice[];
  regulars: DietRegular[];
}

/** The score: the four parts added up, so it is never a number its own breakdown does not make. */
export function dietScore(check: Pick<DietCheck, 'parts'>): number {
  return check.parts.reduce((s, p) => s + p.points, 0);
}

/** The coach's answer as the schema asks for it (src/ai/dietCheck.ts). */
export interface DietAnswer {
  headline: string;
  detail: string;
  whole_foods: { points: number; line: string };
  fruit_veg: { points: number; line: string };
  fibre: { points: number; line: string };
  processed_salt: { points: number; line: string };
  working: string[];
  add: DietAdvice[];
  cut: DietAdvice[];
  regulars: { name: string; verdict: Verdict; body_fat: string; the_catch: string; better: string }[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const advice = (list: DietAdvice[]) =>
  list
    .map((a) => ({ what: clean(a.what), why: clean(a.why) }))
    .filter((a) => a.what)
    .slice(0, 3);

/**
 * The coach's answer made safe to show: points held to 0–25 whole numbers, text tidied, lists kept
 * short, and a verdict only on a food that is in the diary (with the diary's own counts). Null when
 * the answer has no headline or a part with nothing said.
 */
export function cleanDietCheck(answer: DietAnswer, digest: DietDigest, at: string): DietCheck | null {
  const parts: DietPart[] = DIET_PARTS.map(({ key, name }) => ({
    key,
    name,
    points: Math.min(PART_MAX, Math.max(0, Math.round(Number(answer[key].points) || 0))),
    line: clean(answer[key].line),
  }));
  const headline = clean(answer.headline);
  if (!headline || parts.some((p) => !p.line)) return null;
  const byName = new Map(digest.foods.map((f) => [normalise(f.name), f]));
  const seen = new Set<string>();
  const regulars: DietRegular[] = [];
  for (const r of answer.regulars) {
    const food = byName.get(normalise(r.name));
    if (!food || seen.has(food.name) || !clean(r.body_fat)) continue;
    seen.add(food.name);
    regulars.push({ name: food.name, times: food.times, days: food.days, verdict: r.verdict, bodyFat: clean(r.body_fat), theCatch: clean(r.the_catch), better: clean(r.better) });
  }
  return {
    at,
    from: digest.from,
    to: digest.to,
    loggedDays: digest.loggedDays,
    headline,
    detail: clean(answer.detail),
    parts,
    working: answer.working.map(clean).filter(Boolean).slice(0, 3),
    add: advice(answer.add),
    cut: advice(answer.cut),
    regulars: regulars.slice(0, 8),
  };
}
