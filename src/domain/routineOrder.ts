/**
 * Which routine to offer first: the one whose muscles have rested longest. Pure: no IO, no clock
 * (the caller passes `muscleRecency` as of today and each routine's muscles).
 *
 * A routine trains a few body regions (Legs, Back, ...). Each region was last trained some days
 * ago, taken from the most recently trained of its muscles (`muscleRecency` in `./volume`, which
 * counts quick sessions too: a light session still trains the muscle). Routines are ordered by
 * the average of those days, weighted by how many of the routine's exercises hit each region, most
 * rested first, and each carries the label for its most rested region: "Back last trained 6 days
 * ago". Archived and quick routines are not offered.
 */
import { MACRO_MUSCLES } from './quickRequest';
import type { MuscleGroup, Routine } from './types';

export type TrainingRegion = 'Legs' | 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Core';

/** The muscles that make up each region. Neck, full body and other belong to none. */
export const REGION_MUSCLES: Record<TrainingRegion, readonly MuscleGroup[]> = {
  Legs: MACRO_MUSCLES.legs,
  Chest: ['chest'],
  Back: ['lats', 'upper back', 'traps'],
  Shoulders: ['shoulders', 'rear delts'],
  Arms: MACRO_MUSCLES.arms,
  Core: MACRO_MUSCLES.core,
};

export const TRAINING_REGIONS = Object.keys(REGION_MUSCLES) as TrainingRegion[];

/** The region a muscle belongs to, or null (neck, full body, other). */
export function regionOfMuscle(muscle: MuscleGroup): TrainingRegion | null {
  return TRAINING_REGIONS.find((r) => REGION_MUSCLES[r].includes(muscle)) ?? null;
}

/** Days since each region was last trained: the most recent of its muscles. A region never trained is absent. */
export function regionRecency(recency: Partial<Record<MuscleGroup, number>>): Partial<Record<TrainingRegion, number>> {
  const out: Partial<Record<TrainingRegion, number>> = {};
  for (const region of TRAINING_REGIONS) {
    const days = REGION_MUSCLES[region].map((m) => recency[m]).filter((d): d is number => typeof d === 'number');
    if (days.length > 0) out[region] = Math.min(...days);
  }
  return out;
}

/** "Back last trained 6 days ago" · "Legs last trained yesterday" · "Chest trained today" · "Core not trained yet". */
export function restLabel(region: TrainingRegion, daysSince: number | null): string {
  if (daysSince === null) return `${region} not trained yet`;
  if (daysSince <= 0) return `${region} trained today`;
  if (daysSince === 1) return `${region} last trained yesterday`;
  return `${region} last trained ${daysSince} days ago`;
}

type RoutineForRest = Pick<Routine, 'id' | 'order' | 'archived' | 'quick'>;

export interface RoutineRest<R extends RoutineForRest = Routine> {
  routine: R;
  /** Days since the routine's most rested region was last trained; null when that region never has been (or the routine trains none). */
  daysSince: number | null;
  /** The regions the routine trains, most rested first (never trained leads). Empty when none of its exercises map to one. */
  regions: TrainingRegion[];
  /** The line for its most rested region, e.g. "Back last trained 6 days ago"; null when it has no region. */
  label: string | null;
}

/** A region the routine barely touches (under a fifth of its exercises) does not make it a routine for that region. */
const MIN_SHARE = 0.2;
/** A region never trained counts as this many days when routines are ranked. */
const NEVER_DAYS = 365;

/**
 * Non-archived, non-quick routines, most rested first. `musclesOf` maps a routine id to the muscle
 * group of each of its exercises (one entry per exercise); `recency` is `muscleRecency` as of today.
 * Routines with no region come last; ties keep the routine order.
 */
export function routinesByRest<R extends RoutineForRest>(
  routines: readonly R[],
  musclesOf: ReadonlyMap<string, readonly MuscleGroup[]>,
  recency: Partial<Record<MuscleGroup, number>>,
): RoutineRest<R>[] {
  const byRegion = regionRecency(recency);
  const scored = routines
    .filter((r) => !r.archived && !r.quick)
    .map((routine) => {
      const counts = new Map<TrainingRegion, number>();
      for (const m of musclesOf.get(routine.id) ?? []) {
        const region = regionOfMuscle(m);
        if (region) counts.set(region, (counts.get(region) ?? 0) + 1);
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const top = Math.max(0, ...counts.values());
      const kept = [...counts.entries()].filter(([, n]) => n / total >= MIN_SHARE || n === top);
      // Most rested first; a region never trained leads.
      const ranked = kept
        .map(([region, n]) => ({ region, n, days: byRegion[region] ?? null }))
        .sort((a, b) => (b.days ?? NEVER_DAYS) - (a.days ?? NEVER_DAYS) || b.n - a.n || TRAINING_REGIONS.indexOf(a.region) - TRAINING_REGIONS.indexOf(b.region));
      const weight = ranked.reduce((sum, x) => sum + x.n, 0);
      const score = weight === 0 ? -1 : ranked.reduce((sum, x) => sum + (x.days ?? NEVER_DAYS) * x.n, 0) / weight;
      const head = ranked[0];
      const rest: RoutineRest<R> = {
        routine,
        daysSince: head ? head.days : null,
        regions: ranked.map((x) => x.region),
        label: head ? restLabel(head.region, head.days) : null,
      };
      return { rest, score };
    });
  scored.sort((a, b) => b.score - a.score || a.rest.routine.order - b.rest.routine.order);
  return scored.map((s) => s.rest);
}
