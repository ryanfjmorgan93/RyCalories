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
import { appNameKeys, catalogueRepeats, entryKeys, seedNamesFromSource } from '../../scripts/lib/normalise.mjs';
import { FRAME_BUDGET_BYTES, FRAME_WIDTH, MUSCLE_OVERRIDES, NOT_LIFTING, REVIEWED_DUPLICATES } from '../../scripts/lib/catalogueRules.mjs';
import { loadCatalogue, loadCatalogueSteps } from './catalogue';

const FRAMES_DIR = fileURLToPath(new URL('../../assets/catalogue-frames/', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const entries: CatalogueEntry[] = JSON.parse(read('./exerciseCatalogue.json'));
const steps: Record<string, string[]> = JSON.parse(read('./exerciseCatalogueSteps.json'));
const slugs = entries.map((e) => e.slug);

/** Entries the dataset has no instructions for. Pinned so a lost steps file cannot pass as "the dataset had none". */
const WITHOUT_STEPS = ['iron-cross', 'one-arm-kettlebell-swings', 'side-jackknife'];

/**
 * The count, stated: 518 once the 876 dataset entries are cut to the four lifting categories, the
 * ones the app has and the 21 reviewed repeats of it or of each other (539 before those).
 */
const MIN_ENTRIES = 500;
const MAX_ENTRIES = 540;

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

/**
 * What a review of the committed data found, pinned by real entry names so a regeneration that
 * loses a rule shows up here. The rules themselves are in scripts/lib (and tested in
 * catalogueMapping.test.ts); these read the output.
 */
describe('exerciseCatalogue.json, reviewed', () => {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const entry = (name: string): CatalogueEntry => {
    const e = byName.get(name);
    if (!e) throw new Error(`The catalogue has no entry named "${name}".`);
    return e;
  };
  const named = (re: RegExp) => entries.filter((e) => re.test(e.name));

  it('files the powerlifting bench variants as chest work and leaves the triceps presses as triceps', () => {
    for (const n of ['Bench Press - Powerlifting', 'Bench Press with Chains', 'Reverse Band Bench Press', 'Board Press', 'Pin Presses', 'Floor Press', 'Floor Press with Chains', 'One Arm Floor Press', 'Dumbbell Floor Press']) {
      expect(entry(n).muscleGroup, n).toBe('chest');
    }
    for (const n of ['Smith Machine Close-Grip Bench Press', 'Reverse Triceps Bench Press', 'Weighted Bench Dip']) expect(entry(n).muscleGroup, n).toBe('triceps');
  });

  it('files every deadlift as lower back, except the Romanian, stiff-legged and one-legged hinges, which are hamstrings', () => {
    const deadlifts = named(/dead ?lift/i);
    expect(deadlifts.length).toBeGreaterThan(15);
    const hinges = /romanian|stiff|one-legged/i;
    for (const e of deadlifts) expect(e.muscleGroup, e.name).toBe(hinges.test(e.name) ? 'hamstrings' : 'lower back');
  });

  it('files every pullover as lats', () => {
    const pullovers = named(/pullover/i);
    expect(pullovers.length).toBeGreaterThanOrEqual(4);
    for (const e of pullovers) expect(e.muscleGroup, e.name).toBe('lats');
  });

  it('files the clean, snatch and jerk families as full body, bar the deadlifts, the shrugs and a forearm drill', () => {
    const family = named(/\b(clean|snatch|jerk)\b/i).filter((e) => !/dead ?lift|shrug|bottoms-up/i.test(e.name));
    expect(family.length).toBeGreaterThan(40);
    for (const e of family) expect(e.muscleGroup, e.name).toBe('full body');
    expect(entry('Clean Shrug').muscleGroup).toBe('traps');
    expect(entry('Snatch Shrug').muscleGroup).toBe('traps');
    expect(entry('Clean Deadlift').muscleGroup).toBe('lower back');
    expect(entry('Snatch Deadlift').muscleGroup).toBe('lower back');
  });

  it('files an override exactly where scripts/lib says, for every entry that is one', () => {
    let applied = 0;
    for (const [name, group] of Object.entries(MUSCLE_OVERRIDES)) {
      const e = byName.get(name);
      if (!e) continue;
      applied++;
      expect(e.muscleGroup, name).toBe(group);
    }
    expect(applied).toBeGreaterThan(50);
  });

  it('files hip adduction as adductors where the catalogue has it', () => {
    for (const e of named(/hip adduction/i)) expect(e.muscleGroup, e.name).toBe('adductors');
  });

  it('gives the pulling and dipping work the dataset calls "other" the bodyweight-plus kind, and assisted work the reps kind', () => {
    for (const n of ['Muscle Up', 'Kipping Muscle Up', 'One Arm Chin-Up', 'Ring Dips', 'Rocky Pull-Ups/Pulldowns', 'Weighted Bench Dip', 'Suspended Push-Up', 'Mixed Grip Chin', 'Gironda Sternum Chins', 'Side To Side Chins', 'Rope Climb', 'V-Bar Pullup']) {
      expect(entry(n).kind, n).toBe('bodyweight_plus');
    }
    expect(entry('Band Assisted Pull-Up').kind).toBe('reps');
    expect(entry('Dip Machine').kind).toBe('reps');
    // What the kind is for: a 0 kg working weight is allowed, so the lift can start at bodyweight.
    expect(exerciseFromCatalogue(entry('Muscle Up')).kind).toBe('bodyweight_plus');
  });

  it('never gives an EZ-bar movement the barbell equipment', () => {
    const ez = named(/\bE-?Z\b/i);
    expect(ez.length).toBeGreaterThanOrEqual(2);
    for (const e of ez) expect(e.equipment, e.name).not.toBe('barbell');
    expect(entry('Close-Grip EZ Bar Curl').equipment).toBe('other');
    expect(entry('Decline EZ Bar Triceps Extension').equipment).toBe('other');
  });

  it('files body-only abdominal work as isolation, so a crunch gets an isolation rest', () => {
    const bodyOnlyAbs = entries.filter((e) => e.muscleGroup === 'abs' && e.equipment === 'bodyweight');
    expect(bodyOnlyAbs.length).toBeGreaterThan(20);
    for (const e of bodyOnlyAbs) {
      expect(e.isCompound, e.name).toBe(false);
      expect(exerciseFromCatalogue(e).defaultRestSec, e.name).toBe(75);
    }
    // Loaded ab work is left as the dataset has it.
    expect(entry('Barbell Ab Rollout').isCompound).toBe(true);
    expect(entry('Kettlebell Windmill').isCompound).toBe(true);
  });

  it('files the named isolation moves as isolation', () => {
    for (const n of ['Dumbbell Raise', 'External Rotation with Band', 'Cable Internal Rotation', 'High Cable Curls']) expect(entry(n).isCompound, n).toBe(false);
    expect(entry('Cable Shoulder Press').isCompound).toBe(true);
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

  /**
   * Written by hand from the dataset's and the app's own names, not from the script's lists or its
   * normaliser: a repeat that only a person can see (a synonym such as "Wood Chop" and "Woodchop",
   * or "Crossover" and "Fly") is exactly what the name matcher cannot. Each pair is the catalogue
   * entry and what the app already had under another name.
   */
  const REPEATS_OF_THE_APP: [catalogue: string, app: string][] = [
    ['Alternate Hammer Curl', 'Hammer Curl'],
    ['Alternate Incline Dumbbell Curl', 'Incline DB Curl'],
    ['Standing One-Arm Dumbbell Triceps Extension', 'Single Arm Dumbbell Tricep Extension'],
    ['Standing Cable Wood Chop', 'Cable Woodchop'],
    ['Cable Hip Adduction', 'Cable Standing Hip Adduction'],
    ['Monster Walk', 'Banded Monster Walk'],
    ['Flat Bench Lying Leg Raise', 'Lying Leg Raise'],
    ['Ball Leg Curl', 'Stability Ball Hamstring Curl'],
    ['Plie Dumbbell Squat', 'Dumbbell Sumo Squat'],
    ['Alternate Heel Touchers', 'Heel Tap'],
    ['Seated Leg Tucks', 'Seated Knee Tuck'],
    ['Knee/Hip Raise On Parallel Bars', "Captain's Chair Knee Raise"],
    ['Cable Crossover', 'Cable Fly'],
    ['Incline Push-Up Medium', 'Incline Push-up'],
    ['Push-Ups With Feet Elevated', 'Decline Push-up'],
    ['Lying Dumbbell Tricep Extension', 'Two Dumbbell Skullcrusher'],
    ['Lying Triceps Press', 'Skull Crusher'],
    ['Smith Machine Calf Raise', 'Standing Calf Raise (Smith Machine)'],
    ['Smith Single-Leg Split Squat', 'Smith Machine Split Squat'],
  ];
  /** Two dataset entries for one exercise: `[the one left out, the one kept]`. */
  const REPEATS_WITHIN_THE_CATALOGUE: [dropped: string, kept: string][] = [
    ['Decline Smith Press', 'Smith Machine Decline Press'],
    ['Squat with Bands', 'Squats - With Bands'],
  ];

  it('names, for each known repeat, something the app really has', () => {
    const appNames = new Set([...manifest.map((d) => d.name), ...custom.map((d) => d.name), ...seeds.flatMap((s) => [s.name, ...s.aliases])].map((n) => n.toLowerCase()));
    for (const [, app] of REPEATS_OF_THE_APP) expect(appNames.has(app.toLowerCase()), app).toBe(true);
  });

  it('holds none of the repeats a person found that the name matcher could not', () => {
    const names = new Set(entries.map((e) => e.name));
    for (const [name] of REPEATS_OF_THE_APP) expect(names.has(name), name).toBe(false);
    for (const [dropped, kept] of REPEATS_WITHIN_THE_CATALOGUE) {
      expect(names.has(dropped), dropped).toBe(false);
      expect(names.has(kept), kept).toBe(true);
    }
  });

  it('keeps each of those repeats on the reviewed list, which the script checks against the dataset on every run', () => {
    const reviewed = new Set(REVIEWED_DUPLICATES.map(([name]) => name));
    for (const [name] of REPEATS_OF_THE_APP) expect(reviewed.has(name), name).toBe(true);
    for (const [dropped] of REPEATS_WITHIN_THE_CATALOGUE) expect(reviewed.has(dropped), dropped).toBe(true);
  });

  it('lists no exercise twice: no two entries answer to the same name key', () => {
    expect(catalogueRepeats(entries)).toEqual([]);
  });

  it('would notice two entries that are one exercise', () => {
    const twins = [
      { name: 'Decline Smith Press', equipment: 'machine' },
      { name: 'Smith Machine Decline Press', equipment: 'machine' },
      { name: 'Squat with Bands', equipment: 'other' },
      { name: 'Squats - With Bands', equipment: 'other' },
      { name: 'Barbell Curl', equipment: 'barbell' },
    ];
    expect(catalogueRepeats(twins).map((r) => r.names)).toEqual([
      ['Decline Smith Press', 'Smith Machine Decline Press'],
      ['Squat with Bands', 'Squats - With Bands'],
    ]);
    // The same name twice is a slug collision the script already refuses, not a pair to report.
    expect(catalogueRepeats([twins[4]!, twins[4]!])).toEqual([]);
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
