import { roundKg } from './engine';
import { fmtNum } from './format';

export interface PlateOptions {
  barKg: number;
  /** plate sizes available in pairs, any order, e.g. [25, 20, 15, 10, 5, 2.5, 1.25] */
  plates: number[];
}

export const DEFAULT_PLATES: PlateOptions = {
  barKg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

export interface PlateLoad {
  /** Plates on ONE side, heaviest first, e.g. [20, 20, 5, 1.25]. */
  perSide: number[];
  /** Total on the bar with those plates (bar + 2 × Σ perSide). */
  loaded: number;
  /** targetKg − loaded, ≥ 0, when the target cannot be made exactly with the plates available. */
  remainder: number;
}

const QUARTER = 0.25;

/** True when `n` is (within float noise) a whole number of 0.25 kg. */
function isQuarterMultiple(n: number): boolean {
  return Math.abs(Math.round(n / QUARTER) * QUARTER - n) < 1e-9;
}

/**
 * Heaviest-first greedy walk with unlimited plates of each size. This is what `platesPerSide` used
 * to do unconditionally; it commits to a plate and can never backtrack off it, so it is kept only
 * as the fallback for plate sets `exactPerSide` cannot represent (see below).
 */
function greedyPerSide(perSideTargetKg: number, sortedDesc: number[]): number[] {
  let remaining = roundKg(perSideTargetKg);
  const perSide: number[] = [];
  for (const plate of sortedDesc) {
    while (remaining - plate >= -1e-9) {
      perSide.push(plate);
      remaining = roundKg(remaining - plate);
    }
  }
  return perSide;
}

/** Above this, an exact per-side search would allocate an array too large to be worth it; a
 *  target this far past the bar never happens on a real bar, so the greedy walk is fine here. */
const MAX_EXACT_UNITS = 8000; // 2,000 kg per side, in 0.25 kg units

/**
 * Exact per-side combination for a target ≥ 0, via unbounded knapsack in units of 0.25 kg (every
 * real plate divides evenly into that unit): `count[sum]` holds the fewest plates that make `sum`
 * exactly and `via[sum]` the plate used last to reach it. Picks the largest reachable sum ≤ the
 * target and reconstructs heaviest-first from `via`.
 */
function exactPerSide(perSideTargetKg: number, sortedDesc: number[]): number[] {
  if (perSideTargetKg <= 0) return [];
  const targetUnits = Math.round(perSideTargetKg / QUARTER);
  if (targetUnits <= 0) return [];
  if (targetUnits > MAX_EXACT_UNITS) return greedyPerSide(perSideTargetKg, sortedDesc);

  const plateUnits = sortedDesc.map((p) => Math.round(p / QUARTER));
  const count = new Array<number>(targetUnits + 1).fill(Infinity);
  const via = new Array<number>(targetUnits + 1).fill(-1);
  count[0] = 0;
  for (let sum = 1; sum <= targetUnits; sum++) {
    for (const pu of plateUnits) {
      if (pu > sum) continue;
      const withPlate = count[sum - pu] + 1;
      if (withPlate < count[sum]) {
        count[sum] = withPlate;
        via[sum] = pu;
      }
    }
  }

  let bestSum = 0;
  for (let sum = targetUnits; sum >= 0; sum--) {
    if (count[sum] < Infinity) {
      bestSum = sum;
      break;
    }
  }

  const perSideUnits: number[] = [];
  let sum = bestSum;
  while (sum > 0) {
    const pu = via[sum];
    perSideUnits.push(pu);
    sum -= pu;
  }
  perSideUnits.sort((a, b) => b - a);
  return perSideUnits.map((u) => roundKg(u * QUARTER));
}

/**
 * Exact search over the plates available: the combination on ONE side that gets closest to (or
 * exactly hits) the target, trying every count of every plate rather than committing greedily to
 * the heaviest one first. Null when targetKg < barKg or inputs are not finite. Floating maths
 * cleaned with roundKg.
 */
export function platesPerSide(targetKg: number, opts: PlateOptions): PlateLoad | null {
  if (!Number.isFinite(targetKg) || !Number.isFinite(opts.barKg)) return null;
  if (!opts.plates.every((p) => Number.isFinite(p))) return null;
  if (targetKg < opts.barKg) return null;

  const sorted = [...opts.plates].filter((p) => p > 0).sort((a, b) => b - a);
  const perSideTarget = roundKg((targetKg - opts.barKg) / 2);

  // Every real plate is a multiple of 0.25 kg, which is what the exact search below assumes; a
  // plate that is not (malformed input) can't be represented in that unit, so fall back to the
  // old greedy walk for the whole call rather than mixing units.
  const perSide = sorted.every(isQuarterMultiple)
    ? exactPerSide(perSideTarget, sorted)
    : greedyPerSide(perSideTarget, sorted);

  const loadedPerSide = roundKg(perSide.reduce((a, b) => a + b, 0));
  const loaded = roundKg(opts.barKg + 2 * loadedPerSide);
  const remainder = roundKg(Math.max(0, targetKg - loaded));
  return { perSide, loaded, remainder };
}

/**
 * The nearest load ≤ targetKg that the plates can make exactly (barKg when target < bar + smallest
 * pair).
 */
export function roundToPlates(targetKg: number, opts: PlateOptions): number {
  const load = platesPerSide(targetKg, opts);
  return load ? load.loaded : roundKg(opts.barKg);
}

/**
 * "20 + 20 + 5 + 1.25 per side" style; "bar only" when perSide is empty; append " (+0.5 kg short)"
 * when remainder > 0. Uses fmtNum for numbers.
 */
export function plateLabel(load: PlateLoad): string {
  const base = load.perSide.length === 0 ? 'bar only' : `${load.perSide.map(fmtNum).join(' + ')} per side`;
  return load.remainder > 0 ? `${base} (+${fmtNum(load.remainder)} kg short)` : base;
}
