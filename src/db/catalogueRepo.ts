/**
 * Adding to the exercise library: the bundled diagrams and the catalogue become Exercise rows here,
 * and only here. Both are idempotent: an entry the owner already has (same picture key, or the same
 * name) comes back as that row, never a second one. The check and the write share one transaction,
 * so two quick taps cannot both miss.
 */
import { db } from './db';
import { createExercise } from './repo';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';
import { catalogueDemoKey, exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { matchExercise } from '@/domain/exerciseMatch';
import { buildExerciseList, candidatesFromRows, exerciseFromDemo, findExistingExercise, type DemoLike } from '@/domain/library';
import type { Exercise } from '@/domain/types';

/** The exercise for a catalogue entry: the row already holding it, or a new one. */
export async function addCatalogueExercise(entry: CatalogueEntry): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const existing = findExistingExercise(await db.exercises.toArray(), catalogueDemoKey(entry.slug), entry.name);
    return existing ?? createExercise(exerciseFromCatalogue(entry));
  });
}

/** The exercise for a bundled diagram: the row already holding it, or a new one. */
export async function addDemoExercise(demo: DemoLike): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const existing = findExistingExercise(await db.exercises.toArray(), demo.slug, demo.name);
    return existing ?? createExercise(exerciseFromDemo(demo));
  });
}

/**
 * What a name means across everything the owner can use: one of their exercises, or a library entry
 * (a bundled diagram or the catalogue) they have not added yet. Matched the way a pasted routine is
 * (`candidatesFromRows`), so the coach and the paste review agree on a name. A library entry is not
 * written until `add` is called, so a change that fails its checks leaves no new row behind. If the
 * catalogue cannot be loaded, the owner's exercises and the diagrams still answer.
 *
 * Nobody reviews this answer before it is written, unlike a paste, so a library entry is taken only
 * when the name says exactly it (its own name, or the same words once plurals and shorthand are
 * folded: "incline db rows" is Dumbbell Incline Row). A looser guess comes back as `closest`, for the
 * caller to offer by name rather than add: "Zercher Squat Of Doom" is not quietly Zercher Squat.
 */
export type ExercisePick =
  | { kind: 'owned'; exercise: Exercise }
  | { kind: 'library'; name: string; add: () => Promise<Exercise> }
  | { kind: 'closest'; name: string };

export async function findExerciseAnywhere(name: string): Promise<ExercisePick | null> {
  const owned = await db.exercises.toArray();
  let entries: CatalogueEntry[] = [];
  try {
    entries = await loadCatalogue();
  } catch {
    // The diagrams and the owner's own exercises are still there to match.
  }
  const rows = buildExerciseList({ owned, demos: EXERCISE_DEMOS, entries });
  const m = matchExercise(name, candidatesFromRows(rows));
  const row = m ? rows.find((r) => r.key === m.id) : undefined;
  if (!row) return null;
  if (row.exercise) return { kind: 'owned', exercise: row.exercise };
  if (m!.via === 'fuzzy' && m!.score < 1 - 1e-9) return { kind: 'closest', name: row.name };
  const { demo, entry } = row;
  if (demo) return { kind: 'library', name: row.name, add: () => addDemoExercise(demo) };
  if (entry) return { kind: 'library', name: row.name, add: () => addCatalogueExercise(entry) };
  return null;
}
