/**
 * The exercise library the owner adds from: the bundled diagrams (src/data/exerciseDemos.ts) and
 * the catalogue (src/domain/catalogue.ts). Nothing here is a database row until it is added; these
 * are the pure halves of that step. The database half is src/db/catalogueRepo.ts.
 *
 * Pure: no IO, no imports of the data files (the shapes below are structural).
 */
import { catalogueDemoKey, LOWER_BODY_GROUPS, matchTier, type CatalogueEntry } from './catalogue';
import { normaliseName } from './exerciseMatch';
import { MUSCLE_GROUPS, type Equipment, type Exercise, type MuscleGroup } from './types';

/** What the exercise form's diagram picker shows at most, diagrams and catalogue together. */
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

// ---------------------------------------------------------------------------
// The one list: every exercise the owner can use, theirs first, then the whole library.

/** A bundled diagram as the list reads it: DemoLike plus the diagram's own muscle label, for the ones with no group. */
export type ListDemo = DemoLike & { primaryMuscle?: string };

/** One line of the exercise list: an exercise the owner has, or a library entry they could add. */
export interface ExerciseListRow {
  /** Unique within a list: an owned row's exercise id, else the picture key ('arnold-press', 'cat:cable-fly'). */
  key: string;
  name: string;
  /** null for a diagram with no group of its own (a mobility drill); the filters file it under 'other'. */
  muscleGroup: MuscleGroup | null;
  /** What the row says for the muscle: the group, else the diagram's own muscle in lower case, else 'other'. */
  muscleLabel: string;
  /** Lower case. '' for an owned exercise with none set. */
  equipment: string;
  owned: boolean;
  exercise?: Exercise;
  demo?: ListDemo;
  entry?: CatalogueEntry;
  /** The picture key an exercise made from this row carries (an owned row: its own, when it has one). */
  pictureKey?: string;
}

const collator = new Intl.Collator('en-GB');
function byName(a: { name: string; key: string }, b: { name: string; key: string }): number {
  return collator.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Everything the owner can use as one list: their own exercises first, alphabetical, then every
 * diagram and catalogue entry they do not already have, alphabetical. A library entry is dropped
 * when it already is one of their exercises by the rule `findExistingExercise` applies (same
 * picture key, same name, or the name is one of an exercise's aliases, ignoring case, apostrophes
 * and spacing), so adding it can never make a second row for a movement already on the list.
 */
export function buildExerciseList(input: { owned: readonly Exercise[]; demos: readonly ListDemo[]; entries: readonly CatalogueEntry[] }): ExerciseListRow[] {
  const ownedKeys = new Set<string>();
  const ownedNames = new Set<string>();
  const mine: ExerciseListRow[] = [];
  for (const e of input.owned) {
    if (e.demo !== undefined) ownedKeys.add(e.demo);
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const k = normaliseName(n);
      if (k !== '') ownedNames.add(k);
    }
    mine.push({
      key: e.id,
      name: e.name,
      muscleGroup: e.muscleGroup,
      muscleLabel: e.muscleGroup,
      equipment: (e.equipment ?? '').toLowerCase(),
      owned: true,
      exercise: e,
      pictureKey: e.demo,
    });
  }
  const taken = (pictureKey: string, name: string) => ownedKeys.has(pictureKey) || ownedNames.has(normaliseName(name));

  const library: ExerciseListRow[] = [];
  for (const d of input.demos) {
    if (taken(d.slug, d.name)) continue;
    library.push({
      key: d.slug,
      name: d.name,
      muscleGroup: d.muscleGroup,
      muscleLabel: d.muscleGroup ?? (d.primaryMuscle ? d.primaryMuscle.toLowerCase() : 'other'),
      equipment: d.equipment.toLowerCase(),
      owned: false,
      demo: d,
      pictureKey: d.slug,
    });
  }
  for (const entry of input.entries) {
    const key = catalogueDemoKey(entry.slug);
    if (taken(key, entry.name)) continue;
    library.push({ key, name: entry.name, muscleGroup: entry.muscleGroup, muscleLabel: entry.muscleGroup, equipment: entry.equipment, owned: false, entry, pictureKey: key });
  }
  return [...mine.sort(byName), ...library.sort(byName)];
}

export function listCounts(rows: readonly ExerciseListRow[]): { owned: number; library: number } {
  let owned = 0;
  for (const r of rows) if (r.owned) owned++;
  return { owned, library: rows.length - owned };
}

/** Whether the catalogue half of the library has arrived: the diagrams are always there. */
export type CatalogueStatus = 'loading' | 'ready' | 'failed';

/**
 * The fact line over the list. A total is only claimed once the catalogue has loaded: while it is
 * on its way the line says the count is what has arrived so far, and if it never arrives it says so.
 */
export function libraryCountsLine(counts: { owned: number; library: number }, status: CatalogueStatus): string {
  const base = `${counts.owned} yours · ${counts.library} in the library`;
  if (status === 'loading') return `${base} so far`;
  if (status === 'failed') return `${base} · catalogue not loaded`;
  return base;
}

/** The muscle group a row is filed under: diagrams with none sit under 'other', as they will once added. */
export function groupOfRow(row: ExerciseListRow): MuscleGroup {
  return row.muscleGroup ?? 'other';
}

export interface ListFilter {
  /** 'yours' keeps only the owner's own rows. Default 'all'. */
  scope?: 'all' | 'yours';
  /** One muscle group, or 'all'. Default 'all'. */
  muscle?: MuscleGroup | 'all';
  /** Words that must each be found in the name, the muscle, the equipment (or an owned exercise's aliases). */
  query?: string;
  /** Ids of owned exercises to leave out (a picker's "already in the routine"). */
  excludeIds?: readonly string[];
}

/**
 * The rows that pass the filter. With no query the list keeps its own order (owned first, then the
 * library, each alphabetical). With one, matches are ranked as `searchCatalogue` ranks them (name
 * starts with it, then each word starts a word of the name, then the words are in the name, then
 * found through muscle or equipment), owned rows still ahead of library rows, ties alphabetical.
 */
export function filterExerciseList(rows: readonly ExerciseListRow[], filter: ListFilter = {}): ExerciseListRow[] {
  const { scope = 'all', muscle = 'all', query = '', excludeIds = [] } = filter;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const excluded = excludeIds.length > 0 ? new Set(excludeIds) : null;

  const kept: { row: ExerciseListRow; tier: number }[] = [];
  for (const row of rows) {
    if (scope === 'yours' && !row.owned) continue;
    if (muscle !== 'all' && groupOfRow(row) !== muscle) continue;
    if (excluded && row.exercise && excluded.has(row.exercise.id)) continue;
    if (tokens.length === 0) {
      kept.push({ row, tier: 0 });
      continue;
    }
    const name = row.name.toLowerCase();
    const aliases = (row.exercise?.aliases ?? []).join(' ').toLowerCase();
    const tier = matchTier(tokens, name, `${name} ${groupOfRow(row)} ${row.muscleLabel} ${row.equipment} ${aliases}`);
    if (tier !== null) kept.push({ row, tier });
  }
  if (tokens.length > 0) kept.sort((a, b) => Number(b.row.owned) - Number(a.row.owned) || a.tier - b.tier || byName(a.row, b.row));
  return kept.map((k) => k.row);
}

/** The muscle groups present in a list, in the app's own order: the chips that would find something. */
export function groupsInList(rows: readonly ExerciseListRow[]): MuscleGroup[] {
  const present = new Set(rows.map(groupOfRow));
  return MUSCLE_GROUPS.filter((g) => present.has(g));
}

/** Rows drawn at a time: enough to fill a phone twice over, few enough that 800 pictures are not all asked for. */
export const LIST_PAGE_SIZE = 60;

/** How many of `total` rows are drawn after `pages` pages, and whether any are left. */
export function pageWindow(total: number, pages: number, size = LIST_PAGE_SIZE): { shown: number; more: boolean } {
  const shown = Math.max(0, Math.min(total, Math.max(1, pages) * size));
  return { shown, more: shown < total };
}
