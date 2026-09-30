/**
 * The exercise library the owner adds from: the bundled diagrams (src/data/exerciseDemos.ts) and
 * the catalogue (src/domain/catalogue.ts). Nothing here is a database row until it is added; these
 * are the pure halves of that step. The database half is src/db/catalogueRepo.ts.
 *
 * Pure: no IO, no imports of the data files (the shapes below are structural).
 */
import { LOWER_BODY_GROUPS } from './catalogue';
import { normaliseName } from './exerciseMatch';
import type { Equipment, Exercise, MuscleGroup } from './types';

/** What the library sheet shows at most, diagrams and catalogue together. */
export const LIBRARY_RESULT_CAP = 30;

/** The parts of a bundled diagram entry that make an Exercise. */
export interface DemoLike {
  slug: string;
  name: string;
  /** The demo library's own spelling: "Barbell", "Pull-up Bar", "Bodyweight". */
  equipment: string;
  muscleGroup: MuscleGroup | null;
}

export function equipmentFromDemo(raw: string): Equipment {
  switch (raw) {
    case 'Barbell':
      return 'barbell';
    case 'Dumbbell':
      return 'dumbbell';
    case 'Machine':
      return 'machine';
    case 'Cable':
      return 'cable';
    case 'Bodyweight':
    case 'Pull-up Bar':
      return 'bodyweight';
    case 'Kettlebell':
      return 'kettlebell';
    default:
      return 'other';
  }
}

function incrementFor(equipment: Equipment): number {
  if (equipment === 'barbell') return 2.5;
  if (equipment === 'dumbbell') return 2;
  if (equipment === 'machine' || equipment === 'cable') return 5;
  return 2.5;
}

/** The Exercise a bundled diagram becomes. `demo` is the diagram's slug, which is also its dedupe key. */
export function exerciseFromDemo(d: DemoLike): Omit<Exercise, 'id' | 'createdAt'> {
  const equipment = equipmentFromDemo(d.equipment);
  const muscleGroup: MuscleGroup = d.muscleGroup ?? 'other';
  const isCompound = d.equipment === 'Barbell';
  return {
    name: d.name,
    kind: 'reps',
    muscleGroup,
    isCompound,
    isLowerBody: LOWER_BODY_GROUPS.has(muscleGroup),
    unilateral: false,
    defaultRestSec: isCompound ? 150 : 75,
    defaultIncrement: incrementFor(equipment),
    equipment,
    demo: d.slug,
  };
}

type Findable = Pick<Exercise, 'name' | 'demo'> & { aliases?: string[]; createdAt?: string };

/**
 * The exercise a library entry already is, or undefined. Adding it must not make a second row for
 * the same movement, so a row matches when it carries the entry's picture key, or has the same name
 * once case, apostrophes and spacing are ignored (an alias counts as a name: the Hevy import treats
 * it the same way). The picture key wins over a name; a name wins over an alias; then the oldest.
 */
export function findExistingExercise<E extends Findable>(exercises: readonly E[], demoKey: string, name: string): E | undefined {
  const key = normaliseName(name);
  let best: E | undefined;
  let bestRank = Infinity;
  for (const e of exercises) {
    let rank = Infinity;
    if (e.demo === demoKey) rank = 0;
    else if (key !== '' && normaliseName(e.name) === key) rank = 1;
    else if (key !== '' && (e.aliases ?? []).some((a) => normaliseName(a) === key)) rank = 2;
    if (rank === Infinity) continue;
    const older = best !== undefined && rank === bestRank && (e.createdAt ?? '') < (best.createdAt ?? '');
    if (rank < bestRank || older) {
      best = e;
      bestRank = rank;
    }
  }
  return best;
}

export type LibraryResult<D, C> = { kind: 'demo'; demo: D } | { kind: 'catalogue'; entry: C };

/**
 * One list from the two searches, at most `cap` long. Diagrams come first (they are the ones the app
 * already carried), catalogue entries after. When both overflow the cap neither side may crowd the
 * other out: each keeps at least half of it, and a side with less than its half gives the rest away.
 */
export function mergeLibraryResults<D, C>(demos: readonly D[], entries: readonly C[], cap = LIBRARY_RESULT_CAP): LibraryResult<D, C>[] {
  if (cap <= 0) return [];
  const half = Math.floor(cap / 2);
  const demoCount = Math.min(demos.length, Math.max(half, cap - entries.length));
  const entryCount = Math.min(entries.length, cap - demoCount);
  return [
    ...demos.slice(0, demoCount).map((demo): LibraryResult<D, C> => ({ kind: 'demo', demo })),
    ...entries.slice(0, entryCount).map((entry): LibraryResult<D, C> => ({ kind: 'catalogue', entry })),
  ];
}
