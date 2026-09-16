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

/**
 * Greedy from the heaviest plate; unlimited plates of each size. Null when targetKg < barKg or
 * inputs are not finite. Floating maths cleaned with roundKg.
 */
export function platesPerSide(targetKg: number, opts: PlateOptions): PlateLoad | null {
  if (!Number.isFinite(targetKg) || !Number.isFinite(opts.barKg)) return null;
  if (!opts.plates.every((p) => Number.isFinite(p))) return null;
  if (targetKg < opts.barKg) return null;

  const sorted = [...opts.plates].filter((p) => p > 0).sort((a, b) => b - a);
  let remaining = roundKg((targetKg - opts.barKg) / 2);
  const perSide: number[] = [];
  for (const plate of sorted) {
    while (remaining - plate >= -1e-9) {
      perSide.push(plate);
      remaining = roundKg(remaining - plate);
    }
  }

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
