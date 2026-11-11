/**
 * Home's strength figure (ui/StrengthBody.tsx): how strongly each muscle on the robot is lit, and by
 * what. Pure: no IO.
 *
 * Two scales, never mixed in one region. Legs, chest and back are lit by how the owner's squat,
 * bench and deadlift stand against lifters of their sex, bodyweight and age (standards.ts: the
 * published bands, then real meet results), because those are the only lifts any open, licensed
 * data ranks. Every other muscle is lit by the owner's own best Level on it (level.ts), which
 * compares them only with their own start. The screen draws the two in different colours.
 */
import type { StrengthStanding } from './standards';
import type { MuscleGroup } from './types';

export type RankedLift = 'squat' | 'bench' | 'deadlift';

/** The muscles each ranked lift stands for on the figure. */
export const RANKED_GROUPS: Record<RankedLift, MuscleGroup[]> = {
  squat: ['quads', 'glutes'],
  bench: ['chest'],
  deadlift: ['hamstrings', 'lower back'],
};

/** Beginner, intermediate, advanced, highly advanced: the stronger the band, the brighter the region. */
const RANK_OPACITY: Record<StrengthStanding['level'], number> = { Beginner: 0.3, Intermediate: 0.55, Advanced: 0.8, 'Highly advanced': 1 };

export type RegionShade =
  | { kind: 'ranked'; lift: RankedLift; standing: StrengthStanding; opacity: number }
  | { kind: 'own'; level: number; exercise: string; opacity: number };

/** A Level as brightness: level 1 faint, rising 0.06 a level, never as bright as the strongest rank. */
export function ownOpacity(level: number): number {
  return Math.min(0.8, 0.3 + 0.06 * (Math.max(1, level) - 1));
}

/**
 * Each muscle's shade. A ranked lift lights its muscles (and wins over an own level there); every
 * other muscle takes the best Level among the owner's exercises for it. Whole-body and unsorted
 * exercises have no place on the figure.
 */
export function bodyShades(
  ranked: Partial<Record<RankedLift, StrengthStanding>>,
  levels: readonly { group: MuscleGroup; level: number; exercise: string }[],
): Map<MuscleGroup, RegionShade> {
  const out = new Map<MuscleGroup, RegionShade>();
  for (const l of levels) {
    if (l.group === 'full body' || l.group === 'other') continue;
    const had = out.get(l.group);
    if (had?.kind === 'own' && had.level >= l.level) continue;
    out.set(l.group, { kind: 'own', level: l.level, exercise: l.exercise, opacity: ownOpacity(l.level) });
  }
  for (const lift of Object.keys(RANKED_GROUPS) as RankedLift[]) {
    const standing = ranked[lift];
    if (!standing) continue;
    for (const group of RANKED_GROUPS[lift]) out.set(group, { kind: 'ranked', lift, standing, opacity: RANK_OPACITY[standing.level] });
  }
  return out;
}
