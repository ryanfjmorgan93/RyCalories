/**
 * The committed catalogue, read straight from disk: src/data/exerciseCatalogue*.json and
 * assets/catalogue-frames/. CI runs `npm test` before the build, so the frames are read from
 * assets/ (the committed source) and never from public/ (built later, gitignored).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEED_EXERCISES } from '@/db/seed';
import { CATALOGUE_FRAME_COUNT, catalogueDemoKey, exerciseFromCatalogue, LOWER_BODY_GROUPS, type CatalogueEntry } from '@/domain/catalogue';
import { EQUIPMENT_KINDS, MUSCLE_GROUPS } from '@/domain/types';
import { appNameKeys, entryKeys, seedNamesFromSource } from '../../scripts/lib/normalise.mjs';
import { FRAME_BUDGET_BYTES, FRAME_WIDTH, NOT_LIFTING, REVIEWED_DUPLICATES } from '../../scripts/lib/catalogueRules.mjs';
import { loadCatalogue, loadCatalogueSteps } from './catalogue';

const FRAMES_DIR = fileURLToPath(new URL('../../assets/catalogue-frames/', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const entries: CatalogueEntry[] = JSON.parse(read('./exerciseCatalogue.json'));
const steps: Record<string, string[]> = JSON.parse(read('./exerciseCatalogueSteps.json'));
const slugs = entries.map((e) => e.slug);

/** Entries the dataset has no instructions for. Pinned so a lost steps file cannot pass as "the dataset had none". */
const WITHOUT_STEPS = ['iron-cross', 'one-arm-kettlebell-swings', 'side-jackknife'];

/** The count, stated: about 540 once the 876 dataset entries are cut to the four lifting categories and the ones the app has. */
const MIN_ENTRIES = 500;
const MAX_ENTRIES = 580;

/** Width and height of a WebP, read from its header (lossy, extended or lossless). */
function webpSize(b: Buffer): { width: number; height: number } {
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (fourcc === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (fourcc === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Not a WebP chunk: "${fourcc}"`);
}

describe('exerciseCatalogue.json', () => {
  it(`holds ${MIN_ENTRIES} to ${MAX_ENTRIES} entries`, () => {
    expect(entries.length).toBeGreaterThanOrEqual(MIN_ENTRIES);
    expect(entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
  });

  it('has unique slugs of lowercase letters, digits and hyphens, sorted', () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s, s).toMatch(/^[a-z0-9-]+$/);
    expect(slugs).toEqual([...slugs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('has valid fields on every entry and nothing else', () => {
    for (const e of entries) {
      expect(Object.keys(e), e.slug).toEqual(['slug', 'name', 'muscleGroup', 'equipment', 'kind', 'isCompound', 'unilateral', 'level']);
      expect(MUSCLE_GROUPS, e.slug).toContain(e.muscleGroup);
      expect(EQUIPMENT_KINDS, e.slug).toContain(e.equipment);
      expect(['reps', 'bodyweight_plus', 'carry', 'timed'], e.slug).toContain(e.kind);
      expect(['beginner', 'intermediate', 'expert'], e.slug).toContain(e.level);
      expect(typeof e.isCompound, e.slug).toBe('boolean');
      expect(typeof e.unilateral, e.slug).toBe('boolean');
      expect(e.name, e.slug).toBe(e.name.trim());
      expect(e.name.length, e.slug).toBeGreaterThan(0);
      expect(e.name, e.slug).not.toContain('_');
    }
  });

  it('has unique names, so the picker never shows the same one twice', () => {
    const lower = entries.map((e) => e.name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('turns every entry into an Exercise with sane defaults and a unique demo key', () => {
    const keys = new Set<string>();
    for (const e of entries) {
      const x = exerciseFromCatalogue(e);
      expect([75, 90, 150], e.slug).toContain(x.defaultRestSec);
      expect([1, 2, 2.5, 5], e.slug).toContain(x.defaultIncrement);
      expect(x.isLowerBody, e.slug).toBe(LOWER_BODY_GROUPS.has(e.muscleGroup));
      expect(x.demo).toBe(catalogueDemoKey(e.slug));
      keys.add(x.demo!);
    }
    expect(keys.size).toBe(entries.length);
  });
});

describe('assets/catalogue-frames', () => {
  const folders = readdirSync(FRAMES_DIR, { withFileTypes: true });

  it('has one folder per entry and no other folder', () => {
    expect(folders.every((d) => d.isDirectory())).toBe(true);
    const names = folders.map((d) => d.name).sort();
    const missing = slugs.filter((s) => !names.includes(s));
    const stray = names.filter((n) => !slugs.includes(n));
    expect({ missing, stray }).toEqual({ missing: [], stray: [] });
  });

  it(`holds exactly ${CATALOGUE_FRAME_COUNT} frames in each, 1.webp and 2.webp, that are real WebP files ${FRAME_WIDTH} px wide`, () => {
    for (const slug of slugs) {
      const files = readdirSync(join(FRAMES_DIR, slug)).sort();
      expect(files, slug).toEqual(['1.webp', '2.webp']);
      for (const f of files) {
        const bytes = readFileSync(join(FRAMES_DIR, slug, f));
        expect(bytes.toString('ascii', 0, 4), `${slug}/${f} starts with RIFF`).toBe('RIFF');
        expect(bytes.toString('ascii', 8, 12), `${slug}/${f} is WEBP`).toBe('WEBP');
        expect(bytes.readUInt32LE(4) + 8, `${slug}/${f} RIFF length matches the file`).toBe(bytes.length);
        const { width, height } = webpSize(bytes);
        expect(width, `${slug}/${f} width`).toBe(FRAME_WIDTH);
        expect(height, `${slug}/${f} height`).toBeGreaterThan(0);
      }
    }
  });

  it('is under the byte budget in total', () => {
    let total = 0;
    for (const slug of slugs) for (const f of readdirSync(join(FRAMES_DIR, slug))) total += statSync(join(FRAMES_DIR, slug, f)).size;
    expect(total).toBeGreaterThan(entries.length * CATALOGUE_FRAME_COUNT * 1000);
    expect(total).toBeLessThan(FRAME_BUDGET_BYTES);
  });
});

describe('exerciseCatalogueSteps.json', () => {
  it('has steps only for entries that exist, each a non-empty list of trimmed lines', () => {
    for (const [slug, lines] of Object.entries(steps)) {
      expect(slugs, slug).toContain(slug);
      expect(Array.isArray(lines), slug).toBe(true);
      expect(lines.length, slug).toBeGreaterThan(0);
      for (const l of lines) {
        expect(typeof l, slug).toBe('string');
        expect(l, slug).toBe(l.trim());
        expect(l.length, slug).toBeGreaterThan(0);
      }
    }
  });

  it('has steps for every entry except the ones the dataset has none for', () => {
    const without = slugs.filter((s) => !(s in steps));
    expect(without).toEqual(WITHOUT_STEPS);
  });
});

describe('what the app already has', () => {
  const seedSource = read('../db/seed.ts');
  const seeds = seedNamesFromSource(seedSource);
  const manifest: { name: string; equipment?: string }[] = JSON.parse(readFileSync(new URL('../../node_modules/@bryllim/workout-guide/manifest.json', import.meta.url), 'utf8'));
  const custom: { name: string; equipment?: string }[] = JSON.parse(readFileSync(new URL('../../assets/custom-demos/manifest.json', import.meta.url), 'utf8'));
  const appKeys = appNameKeys({ demos: [...manifest, ...custom], seeds });

  it('reads every seeded exercise, with its aliases, from src/db/seed.ts', () => {
    expect(seeds.map((s) => s.name)).toEqual(SEED_EXERCISES.map((s) => s.name));
    expect(seeds.map((s) => s.aliases)).toEqual(SEED_EXERCISES.map((s) => s.aliases ?? []));
  });

  it('compares against all 303 demos and the 27 seeded exercises', () => {
    expect(manifest.length + custom.length).toBe(303);
    expect(seeds.length).toBe(27);
    expect(appKeys.size).toBeGreaterThan(1000);
  });

  it('would notice a repeat: the dataset’s own spellings of exercises the app has do match', () => {
    const wouldMatch = (name: string, equipment: string) => entryKeys(name, equipment).some((k) => appKeys.has(k));
    expect(wouldMatch('Hammer Curls', 'dumbbell')).toBe(true);
    expect(wouldMatch('Barbell Hip Thrust', 'barbell')).toBe(true);
    expect(wouldMatch('Seated Cable Rows', 'cable')).toBe(true);
    expect(wouldMatch('Decline Barbell Bench Press', 'barbell')).toBe(true);
    expect(wouldMatch('Farmer’s Walk', 'other')).toBe(true);
    expect(wouldMatch('Cable Bench Press', 'cable')).toBe(false);
  });

  it('holds no entry that repeats a demo or a seeded exercise under the singularising normaliser', () => {
    const repeats: string[] = [];
    for (const e of entries) {
      const hit = entryKeys(e.name, e.equipment).map((k) => appKeys.get(k)).find(Boolean);
      if (hit) repeats.push(`${e.name}  ~  ${hit}`);
    }
    expect(repeats).toEqual([]);
  });

  it('holds none of the reviewed repeats or the movements that are not lifting', () => {
    const names = new Set(entries.map((e) => e.name));
    for (const [name] of REVIEWED_DUPLICATES) expect(names.has(name), name).toBe(false);
    for (const name of NOT_LIFTING) expect(names.has(name), name).toBe(false);
  });
});

describe('loaders', () => {
  it('load the same entries the file holds', async () => {
    expect(await loadCatalogue()).toEqual(entries);
  });

  it('keep what they loaded instead of loading it again', () => {
    expect(loadCatalogue()).toBe(loadCatalogue());
  });

  it('load one entry’s steps, and null where there are none', async () => {
    expect(await loadCatalogueSteps('barbell-curl')).toEqual(steps['barbell-curl']);
    expect((await loadCatalogueSteps('barbell-curl'))!.length).toBeGreaterThan(0);
    for (const s of WITHOUT_STEPS) expect(await loadCatalogueSteps(s), s).toBeNull();
    expect(await loadCatalogueSteps('not-a-real-exercise')).toBeNull();
    expect(await loadCatalogueSteps('')).toBeNull();
  });

  it('do not mistake an object property for a slug', async () => {
    for (const s of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(await loadCatalogueSteps(s), s).toBeNull();
  });

  it('are the only code that imports the two JSON files', () => {
    const srcDir = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(d.name) && !/\.test\.(ts|tsx)$/.test(d.name)) files.push(p);
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(50);
    // A static import or re-export names the file outside parentheses; the loaders use import('./x.json').
    const staticImport = /(?:^|\n)\s*(?:import|export)\b[^(;]*?['"][^'"]*exerciseCatalogue(?:Steps)?(?:\.json)?['"]/;
    const offenders = files.filter((f) => staticImport.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(srcDir.length))).toEqual([]);
    const loader = readFileSync(join(srcDir, 'data/catalogue.ts'), 'utf8');
    expect(loader).toContain("import('./exerciseCatalogue.json')");
    expect(loader).toContain("import('./exerciseCatalogueSteps.json')");
  });
});
