/**
 * The weekly boss (docs/superpowers/specs/2026-11-12-boss-fight-design.md): the owner's own best set
 * on one lift, which the plan as it stands can beat. Pure: no IO, no clock, no database. A set's
 * size is the Level's (`setSize` in level.ts) and "beats" is bigger by more than float noise.
 */
import { bigger, setSize } from './level';

export interface BossSet {
  weight: number;
  reps: number;
}

export interface PlanAt {
  routineId: string;
  routineName: string;
  weight: number;
  repMin: number;
  repMax: number;
}

export interface Candidate {
  exerciseId: string;
  name: string;
  best: BossSet;
  plan: PlanAt;
}

const size = (s: BossSet) => setSize(s.weight, s.reps);

/** The fewest reps in the plan's range, at the plan's weight, that beat `best`; null when none does. */
export function attackFor(best: BossSet, plan: Pick<PlanAt, 'weight' | 'repMin' | 'repMax'>): BossSet | null {
  for (let reps = plan.repMin; reps <= plan.repMax; reps++) {
    if (bigger(setSize(plan.weight, reps), size(best))) return { weight: plan.weight, reps };
  }
  return null;
}

/** The hardest fight the plan still wins: the smallest margin of attack over boss; ties by name, A to Z. */
export function pickBoss(candidates: readonly Candidate[], bossedThisWeek: ReadonlySet<string>): Candidate | null {
  let pick: { c: Candidate; margin: number } | null = null;
  for (const c of candidates) {
    if (bossedThisWeek.has(c.exerciseId)) continue;
    const attack = attackFor(c.best, c.plan);
    if (!attack) continue;
    const margin = (size(attack) - size(c.best)) / size(c.best);
    if (!pick || margin < pick.margin - 1e-12 || (Math.abs(margin - pick.margin) <= 1e-12 && c.name.localeCompare(pick.c.name) < 0)) pick = { c, margin };
  }
  return pick?.c ?? null;
}

/**
 * Health as a whole percent: 0 only when beaten; 100 until the week's best set gets closer than the
 * floor (the last session's top set before the boss appeared, or 90% of the boss when there is none
 * below it); between, the gap left, rounded up and never under 1, so it never flatters.
 */
export function bossHealth(boss: BossSet, floorSize: number | null, weekBestSize: number | null, beaten: boolean): number {
  if (beaten) return 0;
  const top = size(boss);
  const floor = floorSize !== null && floorSize < top ? floorSize : 0.9 * top;
  if (weekBestSize === null || weekBestSize <= floor) return 100;
  return Math.max(1, Math.ceil((100 * (top - weekBestSize)) / (top - floor) - 1e-9));
}
