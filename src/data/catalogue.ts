/**
 * Lazy loaders for the exercise catalogue (see src/domain/catalogue.ts). Each data file is its own
 * chunk, fetched the first time something asks and kept after that. Nothing else may import the two
 * JSON files: a static import would put them in the main bundle (src/data/catalogue.test.ts checks).
 */
import type { CatalogueEntry } from '@/domain/catalogue';

let entries: Promise<CatalogueEntry[]> | undefined;
let steps: Promise<Record<string, string[]>> | undefined;

/** Every catalogue entry, sorted by slug. A failed load is not remembered, so the next call tries again. */
export function loadCatalogue(): Promise<CatalogueEntry[]> {
  entries ??= import('./exerciseCatalogue.json').then(
    (m) => m.default as CatalogueEntry[],
    (e: unknown) => {
      entries = undefined;
      throw e;
    },
  );
  return entries;
}

/** The dataset's instructions for one entry, or null when it has none (or the slug is unknown). */
export async function loadCatalogueSteps(slug: string): Promise<string[] | null> {
  steps ??= import('./exerciseCatalogueSteps.json').then(
    (m) => m.default as Record<string, string[]>,
    (e: unknown) => {
      steps = undefined;
      throw e;
    },
  );
  const all = await steps;
  return Object.hasOwn(all, slug) ? all[slug] : null;
}
