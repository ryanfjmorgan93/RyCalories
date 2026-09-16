/**
 * Strength standards as bodyweight multiples of e1RM. Pure functions only — no IO, no clock,
 * no database.
 */

export type StrengthStandard = 'squat' | 'bench' | 'deadlift' | 'press' | 'row';

export const STRENGTH_STANDARDS: StrengthStandard[] = ['squat', 'bench', 'deadlift', 'press', 'row'];

export type StrengthLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'elite';

const LEVELS: StrengthLevel[] = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

/** Bodyweight multiples of e1RM per level, beginner → elite. */
export const STANDARDS_TABLE: Record<StrengthStandard, Record<StrengthLevel, number>> = {
  squat: { beginner: 0.75, novice: 1.25, intermediate: 1.5, advanced: 2, elite: 2.5 },
  bench: { beginner: 0.5, novice: 0.75, intermediate: 1, advanced: 1.5, elite: 2 },
  deadlift: { beginner: 1, novice: 1.5, intermediate: 2, advanced: 2.5, elite: 3 },
  press: { beginner: 0.35, novice: 0.55, intermediate: 0.8, advanced: 1.1, elite: 1.4 },
  row: { beginner: 0.5, novice: 0.75, intermediate: 1, advanced: 1.25, elite: 1.5 },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function strengthLevel(
  standard: StrengthStandard,
  e1rmKg: number,
  bodyweightKg: number,
): { level: StrengthLevel | 'untrained'; ratio: number; next: { level: StrengthLevel; ratio: number; kg: number } | null } {
  if (bodyweightKg <= 0) throw new Error('bodyweightKg must be greater than zero');

  const table = STANDARDS_TABLE[standard];
  const ratio = round2(e1rmKg / bodyweightKg);

  let level: StrengthLevel | 'untrained' = 'untrained';
  for (const l of LEVELS) {
    if (ratio >= table[l]) level = l;
  }

  const currentIndex = level === 'untrained' ? -1 : LEVELS.indexOf(level);
  const nextLevel = LEVELS[currentIndex + 1];
  const next = nextLevel
    ? { level: nextLevel, ratio: table[nextLevel], kg: round2(table[nextLevel] * bodyweightKg) }
    : null;

  return { level, ratio, next };
}
