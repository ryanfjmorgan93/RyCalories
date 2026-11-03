/**
 * Daily targets read from a body scan, each with the sum it came from so the owner can check it:
 *   - protein: 2.5 g per kg of lean (fat-free) mass, about 2.0 to 2.2 g per kg of bodyweight at
 *     12 to 20% body fat, the top of the range the research supports for building muscle;
 *   - calories: the scan's own BMR times an activity factor for the sessions a week the owner aims
 *     for (the standard 1.375 / 1.55 / 1.725), plus the surplus their weekly gain target needs
 *     (7,700 kcal a kilogram, spread over the week).
 * Pure: the scan and the settings are passed in. Nothing here applies a target; the Body card
 * offers them, and a tap applies them through domain/targetChange.ts.
 */
import type { BodyScan, Settings } from './types';

export const PROTEIN_PER_LEAN_KG = 2.5;
const KCAL_PER_KG = 7700;

export interface ScanTargets {
  protein: { grams: number; leanKg: number } | null;
  calories: { kcal: number; bmr: number; factor: number; sessions: number; maintenance: number; surplus: number; gain: [number, number] } | null;
}

/** Lean (fat-free) mass: as measured, else weight less fat mass, else weight less its body fat share. */
export function leanMassOf(s: Pick<BodyScan, 'leanMassKg' | 'weightKg' | 'bodyFatKg' | 'bodyFatPct'>): number | undefined {
  if (s.leanMassKg !== undefined) return s.leanMassKg;
  if (s.weightKg === undefined) return undefined;
  if (s.bodyFatKg !== undefined) return s.weightKg - s.bodyFatKg;
  if (s.bodyFatPct !== undefined) return s.weightKg * (1 - s.bodyFatPct / 100);
  return undefined;
}

export function activityFactor(sessionsPerWeek: number): number {
  return sessionsPerWeek <= 2 ? 1.375 : sessionsPerWeek <= 4 ? 1.55 : 1.725;
}

export function scanTargets(scan: BodyScan, settings: Pick<Settings, 'weeklySessionTarget' | 'weeklyGainTargetMin' | 'weeklyGainTargetMax'>): ScanTargets {
  const lean = leanMassOf(scan);
  const protein = lean !== undefined && lean > 0 ? { grams: Math.round((PROTEIN_PER_LEAN_KG * lean) / 5) * 5, leanKg: Math.round(lean * 10) / 10 } : null;

  let calories: ScanTargets['calories'] = null;
  if (scan.bmrKcal !== undefined && scan.bmrKcal > 0) {
    const sessions = settings.weeklySessionTarget ?? 3;
    const factor = activityFactor(sessions);
    const maintenance = Math.round(scan.bmrKcal * factor);
    const gain: [number, number] = [settings.weeklyGainTargetMin, settings.weeklyGainTargetMax];
    const surplus = Math.round(((gain[0] + gain[1]) / 2) * (KCAL_PER_KG / 7) / 10) * 10;
    calories = { kcal: Math.round((maintenance + surplus) / 50) * 50, bmr: Math.round(scan.bmrKcal), factor, sessions, maintenance, surplus, gain };
  }
  return { protein, calories };
}

const n = (v: number) => v.toLocaleString('en-GB');

/** The sums, one line each, as the Body card shows them. */
export function scanTargetLines(t: ScanTargets): string[] {
  const lines: string[] = [];
  if (t.calories) {
    const c = t.calories;
    const range = c.surplus > 0 ? `gaining ${c.gain[0]}–${c.gain[1]}` : `losing ${Math.abs(c.gain[1])}–${Math.abs(c.gain[0])}`;
    const goal = c.surplus === 0 ? '' : `, ${c.surplus > 0 ? '+' : '−'} ${n(Math.abs(c.surplus))} for ${range} kg a week`;
    lines.push(`≈${n(c.kcal)} kcal: BMR ${n(c.bmr)} × ${c.factor} (${c.sessions} sessions a week) = ${n(c.maintenance)} to maintain${goal}`);
  }
  if (t.protein) lines.push(`${n(t.protein.grams)} g protein: ${PROTEIN_PER_LEAN_KG} g per kg of lean mass (${t.protein.leanKg} kg)`);
  return lines;
}
