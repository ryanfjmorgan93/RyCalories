#!/usr/bin/env node
/**
 * Build step (also runnable standalone as `npm run media`).
 *
 * For every exercise in @bryllim/workout-guide's manifest, converts its three 512×512 PNG frames
 * to 4-colour palette PNG at 384px wide into public/exercises/<slug>/{1,2,3}.png, skipping files that
 * are already newer than their source so re-runs are fast. Also picks up bespoke demos committed
 * under assets/custom-demos/ (see assets/custom-demos/manifest.json) — SVG/PNG/JPEG frames run
 * through the same sharp pipeline (resize + recompress) so they're indistinguishable in weight from
 * the generated ones, except that a manifest entry marked `"photo": true` skips the 4-colour palette
 * quantisation that would posterise a photograph (see PHOTO_ note below). Then writes
 * src/data/exerciseDemos.ts deterministically (sorted by slug).
 *
 * Usage: node scripts/exercise-media.mjs
 */

import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PKG_ROOT = fileURLToPath(new URL('../node_modules/@bryllim/workout-guide/', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/exercises/', import.meta.url));
const DATA_FILE = fileURLToPath(new URL('../src/data/exerciseDemos.ts', import.meta.url));
const CUSTOM_ROOT = fileURLToPath(new URL('../assets/custom-demos/', import.meta.url));

const WIDTH = 384;
// Most frames are monochrome line art on a transparent background. A 4-colour palette PNG keeps
// them crisp at a quarter of the size of lossy WebP (measured: ~4 KB a frame against ~15 KB).
// Photo demos (manifest `"photo": true`) skip this — see convertFrame below.
const COLOURS = 4;
const TARGET_BYTES = 8 * 1024 * 1024;

/** @type {{id:string, slug:string, name:string, exerciseType:string, equipment:string, primaryMuscle:string, secondaryMuscles:string[], isStretch:boolean, frames:{index:number,path:string}[]}[]} */
const manifest = JSON.parse(await readFile(join(PKG_ROOT, 'manifest.json'), 'utf8'));

/** workout-guide primaryMuscle -> Iron's MuscleGroup (null when there is no equivalent). */
const MUSCLE_MAP = {
  Adductors: 'adductors',
  Back: 'upper back',
  Biceps: 'biceps',
  Calves: 'calves',
  Chest: 'chest',
  Core: 'abs',
  Forearms: 'forearms',
  Glutes: 'glutes',
  Hamstrings: 'hamstrings',
  Hips: 'glutes',
  Lats: 'lats',
  Legs: 'quads',
  'Lower Back': 'lower back',
  Mobility: null,
  // No workout-guide category has a neck entry — this key exists only for bespoke demos
  // committed under assets/custom-demos/ (e.g. "neck").
  Neck: 'neck',
  'Posterior Chain': 'hamstrings',
  Quads: 'quads',
  'Rear Delts': 'rear delts',
  Shoulders: 'shoulders',
  Triceps: 'triceps',
  'Upper Back': 'upper back',
};

/** @type {Record<string, string[]>} */
let instructionsBySlug = {};
try {
  instructionsBySlug = JSON.parse(await readFile(fileURLToPath(new URL('../src/data/exerciseInstructions.json', import.meta.url)), 'utf8'));
} catch {
  console.warn('src/data/exerciseInstructions.json not found — demos will have no instructions. Run scripts/fetch-instructions.mjs first.');
}

// ---------------------------------------------------------------------------
// Bespoke, hand-drawn demos committed under assets/custom-demos/ (manifest.json + <slug>/<n>.svg).
// Not present in the @bryllim/workout-guide package (e.g. "neck", which the package has no
// muscle group or exercises for at all).

/** @type {{slug:string, name:string, equipment:string, primaryMuscle:string, secondaryMuscles:string[], instructions:string[], photo?:boolean}[]} */
let customManifest = [];
try {
  customManifest = JSON.parse(await readFile(join(CUSTOM_ROOT, 'manifest.json'), 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const packageSlugs = new Set(manifest.map((ex) => ex.slug));
const seenCustomSlugs = new Set();
for (const custom of customManifest) {
  if (packageSlugs.has(custom.slug)) {
    throw new Error(
      `assets/custom-demos/manifest.json: slug "${custom.slug}" collides with a @bryllim/workout-guide package slug. Rename the custom demo.`,
    );
  }
  if (seenCustomSlugs.has(custom.slug)) {
    throw new Error(`assets/custom-demos/manifest.json: duplicate slug "${custom.slug}".`);
  }
  seenCustomSlugs.add(custom.slug);
}

/**
 * Reads assets/custom-demos/<slug>/<n>.{svg,png,jpg,jpeg}, sorted by n — frame count comes from
 * whatever files are actually present, not a fixed number. Throws if the folder or frames are
 * missing.
 */
function customFrames(slug) {
  const dir = join(CUSTOM_ROOT, slug);
  if (!existsSync(dir)) {
    throw new Error(`assets/custom-demos/${slug}/ is missing (referenced by assets/custom-demos/manifest.json).`);
  }
  const frames = readdirSync(dir)
    .map((f) => /^(\d+)\.(svg|png|jpe?g)$/.exec(f))
    .filter((m) => m !== null)
    .map((m) => ({ index: Number(m[1]), path: join(dir, m[0]) }))
    .sort((a, b) => a.index - b.index);
  if (frames.length === 0) {
    throw new Error(`assets/custom-demos/${slug}/ has no <n>.{svg,png,jpg,jpeg} frames.`);
  }
  return frames;
}

/**
 * Normalised shape shared by package and custom demos, used for both the PNG conversion pass and
 * the exerciseDemos.ts generation below.
 * @typedef {{slug:string, name:string, equipment:string, primaryMuscle:string, secondaryMuscles:string[], frames:{index:number, srcPath:string}[], instructions:string[]|null, photo:boolean}} DemoSource
 */

/** @type {DemoSource[]} */
const packageSources = manifest.map((ex) => ({
  slug: ex.slug,
  name: ex.name,
  equipment: ex.equipment,
  primaryMuscle: ex.primaryMuscle,
  secondaryMuscles: ex.secondaryMuscles,
  frames: ex.frames.map((f) => ({ index: f.index, srcPath: join(PKG_ROOT, f.path) })),
  // null means "look up in instructionsBySlug below", distinct from a custom demo's explicit [].
  instructions: null,
  // The whole package is monochrome line art.
  photo: false,
}));

/** @type {DemoSource[]} */
const customSources = customManifest.map((ex) => ({
  slug: ex.slug,
  name: ex.name,
  equipment: ex.equipment,
  primaryMuscle: ex.primaryMuscle,
  secondaryMuscles: ex.secondaryMuscles,
  frames: customFrames(ex.slug).map((f) => ({ index: f.index, srcPath: f.path })),
  instructions: ex.instructions ?? [],
  photo: ex.photo ?? false,
}));

const allSources = [...packageSources, ...customSources];

mkdirSync(OUT_DIR, { recursive: true });

async function convertFrame(srcPath, destPath, photo) {
  const srcStat = statSync(srcPath);
  if (existsSync(destPath)) {
    const destStat = statSync(destPath);
    if (destStat.mtimeMs >= srcStat.mtimeMs) return false; // already up to date
  }
  const pipeline = sharp(srcPath).resize({ width: WIDTH });
  // Line art is flat colour on a transparent ground, so a 4-colour palette keeps it crisp at a
  // quarter of lossy WebP's size (measured: ~4 KB a frame against ~15 KB). A photo has continuous
  // tone — the same quantisation would posterise it into blotches, so photos skip palette/colours
  // and just get resized + recompressed losslessly.
  if (photo) {
    await pipeline.png({ compressionLevel: 9 }).toFile(destPath);
  } else {
    await pipeline.png({ palette: true, colours: COLOURS, compressionLevel: 9 }).toFile(destPath);
  }
  return true;
}

let converted = 0;
let skipped = 0;

for (const ex of allSources) {
  const destDir = join(OUT_DIR, ex.slug);
  mkdirSync(destDir, { recursive: true });
  for (const frame of ex.frames) {
    const destPath = join(destDir, `${frame.index}.png`);
    const didConvert = await convertFrame(frame.srcPath, destPath, ex.photo);
    if (didConvert) converted++;
    else skipped++;
  }
}

console.log(`Converted ${converted} frame(s), skipped ${skipped} already up to date.`);

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else total += statSync(full).size;
  }
  return total;
}

const totalBytes = dirSizeBytes(OUT_DIR);
const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
console.log(`public/exercises total size: ${totalMB} MB (target <= 8 MB) at ${WIDTH}px.`);
if (totalBytes > TARGET_BYTES) {
  console.warn(
    `WARNING: public/exercises exceeds the 8 MB target at ${WIDTH}px (${totalMB} MB). Lower WIDTH or COLOURS and re-measure.`,
  );
}

// ---------------------------------------------------------------------------
// src/data/exerciseDemos.ts

const sorted = [...allSources].sort((a, b) => a.slug.localeCompare(b.slug));

/** @param {string} s */
function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const demoEntries = sorted.map((ex) => {
  const muscleGroup = MUSCLE_MAP[ex.primaryMuscle];
  const muscleGroupLiteral = muscleGroup === undefined ? 'null' : muscleGroup === null ? 'null' : `'${esc(muscleGroup)}'`;
  if (muscleGroup === undefined) {
    throw new Error(`No MuscleGroup mapping for workout-guide primaryMuscle "${ex.primaryMuscle}" (slug ${ex.slug})`);
  }
  const instructions = ex.instructions ?? instructionsBySlug[ex.slug] ?? [];
  const secondary = ex.secondaryMuscles.map((m) => `'${esc(m)}'`).join(', ');
  const instructionsLiteral = instructions.map((s) => `'${esc(s)}'`).join(', ');
  return `  {
    slug: '${esc(ex.slug)}',
    name: '${esc(ex.name)}',
    equipment: '${esc(ex.equipment)}',
    primaryMuscle: '${esc(ex.primaryMuscle)}',
    secondaryMuscles: [${secondary}],
    muscleGroup: ${muscleGroupLiteral},
    frames: ${ex.frames.length},
    instructions: [${instructionsLiteral}],
    photo: ${ex.photo},
  },`;
});

const fileContents = `/* AUTO-GENERATED by scripts/exercise-media.mjs — edit that script, not this file. */
import type { MuscleGroup } from '@/domain/types';

export interface ExerciseDemo {
  slug: string;
  name: string;
  equipment: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  /** Iron's group for the primary muscle, null when it has no equivalent. */
  muscleGroup: MuscleGroup | null;
  frames: number;
  /** Instructions from free-exercise-db when matched. */
  instructions: string[];
  /** True for a real photograph (object-cover, no palette quantisation, no light-theme invert). False for line art. */
  photo: boolean;
}

export const EXERCISE_DEMOS: ExerciseDemo[] = [
${demoEntries.join('\n')}
];

const BY_SLUG = new Map(EXERCISE_DEMOS.map((d) => [d.slug, d]));

export function findDemo(slug: string): ExerciseDemo | undefined {
  return BY_SLUG.get(slug);
}

export function demoFrameUrl(slug: string, frame: number): string {
  return \`/exercises/\${slug}/\${frame}.png\`;
}

/**
 * The workout-guide manifest's own curation order (major/canonical lifts first, e.g. "Bench Press"
 * before its variants), used only to break search ties — not exported, and unrelated to the
 * alphabetical order of EXERCISE_DEMOS above. Bespoke assets/custom-demos/ entries are appended
 * after the package's own order.
 */
const MANIFEST_ORDER: string[] = [${allSources.map((ex) => `'${esc(ex.slug)}'`).join(', ')}];
const ORDER_INDEX = new Map(MANIFEST_ORDER.map((slug, i) => [slug, i]));
const byManifestOrder = (a: ExerciseDemo, b: ExerciseDemo) => (ORDER_INDEX.get(a.slug) ?? 0) - (ORDER_INDEX.get(b.slug) ?? 0);

/** 0 = exact name match, 1 = name starts with the query, 2 = name contains it elsewhere. */
function nameMatchTier(name: string, q: string): number {
  const lower = name.toLowerCase();
  if (lower === q) return 0;
  if (lower.startsWith(q)) return 1;
  return 2;
}

/** Case-insensitive substring search on name/equipment/primaryMuscle. Name matches sort first. */
export function searchDemos(query: string, limit = 20): ExerciseDemo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const nameHits: ExerciseDemo[] = [];
  const otherHits: ExerciseDemo[] = [];
  for (const demo of EXERCISE_DEMOS) {
    if (demo.name.toLowerCase().includes(q)) {
      nameHits.push(demo);
    } else if (demo.equipment.toLowerCase().includes(q) || demo.primaryMuscle.toLowerCase().includes(q)) {
      otherHits.push(demo);
    }
  }
  nameHits.sort((a, b) => nameMatchTier(a.name, q) - nameMatchTier(b.name, q) || byManifestOrder(a, b));
  otherHits.sort(byManifestOrder);
  return [...nameHits, ...otherHits].slice(0, limit);
}

export interface Attribution {
  name: string;
  url: string;
  licence: string;
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    name: 'Workout Guide (Bryl Lim)',
    url: 'https://bryllim.com',
    licence: 'CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    name: 'Everkinetic',
    url: 'https://github.com/everkinetic/data',
    licence: 'CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    name: 'free-exercise-db',
    url: 'https://github.com/yuhonas/free-exercise-db',
    licence: 'Unlicense (public domain) — https://unlicense.org/',
  },
];
`;

mkdirSync(dirname(DATA_FILE), { recursive: true });
writeFileSync(DATA_FILE, fileContents);
console.log(`Wrote ${DATA_FILE} (${sorted.length} demos).`);
