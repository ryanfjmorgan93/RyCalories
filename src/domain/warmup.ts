import { roundKg } from './engine';
import { roundToPlates, type PlateOptions } from './plates';

export interface WarmupSet {
  weight: number;
  reps: number;
}

export interface WarmupOptions extends PlateOptions {
  /** Steps as fractions of the working weight with their reps, default [[0.5, 5], [0.7, 3], [0.9, 1]]. */
  steps?: [fraction: number, reps: number][];
}

const DEFAULT_STEPS: [number, number][] = [
  [0.5, 5],
  [0.7, 3],
  [0.9, 1],
];

/**
 * A warm-up ramp for a barbell lift: the empty bar × 10 first (only when workingKg > barKg), then
 * each step at roundToPlates(fraction × workingKg), dropping a step whose weight is ≤ the previous
 * step's weight or ≤ the bar. Empty array when workingKg ≤ barKg or not finite. Weights via roundKg.
 */
export function warmupRamp(workingKg: number, opts: WarmupOptions): WarmupSet[] {
  if (!Number.isFinite(workingKg) || workingKg <= opts.barKg) return [];

  const steps = opts.steps ?? DEFAULT_STEPS;
  const barWeight = roundKg(opts.barKg);
  const result: WarmupSet[] = [{ weight: barWeight, reps: 10 }];
  let previous = barWeight;

  for (const [fraction, reps] of steps) {
    const weight = roundKg(roundToPlates(fraction * workingKg, opts));
    if (weight <= previous || weight <= opts.barKg) continue;
    result.push({ weight, reps });
    previous = weight;
  }

  return result;
}
