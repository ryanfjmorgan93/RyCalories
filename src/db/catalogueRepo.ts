/**
 * Adding to the exercise library: the bundled diagrams and the catalogue become Exercise rows here,
 * and only here. Both are idempotent: an entry the owner already has (same picture key, or the same
 * name) comes back as that row, never a second one. The check and the write share one transaction,
 * so two quick taps cannot both miss.
 */
import { db } from './db';
import { createExercise } from './repo';
import { catalogueDemoKey, exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { exerciseFromDemo, findExistingExercise, type DemoLike } from '@/domain/library';
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
