#!/usr/bin/env node
/**
 * Builds the exercise catalogue from free-exercise-db (public domain, Unlicense). Run by hand, needs
 * the network, and is NOT part of `prebuild`: CI never fetches anything. The output is committed.
 *
 *   src/data/exerciseCatalogue.json        [{ slug, name, muscleGroup, equipment, kind, isCompound, unilateral, level }]
 *   src/data/exerciseCatalogueSteps.json   { [slug]: string[] }  the dataset's own instructions, verbatim
 *   assets/catalogue-frames/<slug>/{1,2}.webp   two photos per entry, 320 px wide, committed (the build copies
 *                                               them to public/catalogue/)
 *
 * Only exercises the app does not already have are kept: the workout-guide demos, the bespoke demos
 * under assets/custom-demos/ and the seeded exercises with their aliases are matched by name (see
 * scripts/lib/normalise.mjs), plus a reviewed list of repeats the names cannot show
 * (scripts/lib/catalogueRules.mjs). Every exclusion is printed so it can be reviewed. The kept
 * entries are also held against each other: two that answer to one name key stop the run.
 * The same file holds the reviewed muscle-group and isolation overrides (by dataset name); a name
 * there that is no longer in the dataset stops the run too.
 *
 * Frames already on disk are skipped, so a re-run without --force changes nothing.
 *
 * Usage:
 *   node scripts/build-exercise-catalogue.mjs               data files and frames
 *   node scripts/build-exercise-catalogue.mjs --force       fetch and convert every frame again
 *   node scripts/build-exercise-catalogue.mjs --data-only   data files only, no photos
 */

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { appNameKeys, catalogueRepeats, entryKeys, seedNamesFromSource } from './lib/normalise.mjs';
import { mapEntry } from './lib/mapEntry.mjs';
import { FRAME_BUDGET_BYTES, FRAME_WIDTH, ISOLATION_OVERRIDES, MUSCLE_OVERRIDES, NOT_LIFTING, REVIEWED_DUPLICATES } from './lib/catalogueRules.mjs';

const DATASET_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const PHOTO_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

const CATEGORIES = new Set(['strength', 'powerlifting', 'strongman', 'olympic weightlifting']);
const MIN_IMAGES = 2;
const FRAME_COUNT = 2;
const WEBP_QUALITY = 55;
const WEBP_EFFORT = 6;
const CONCURRENCY = 8;
const ATTEMPTS = 5;

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DATA_ONLY = args.has('--data-only');

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const MANIFEST = path('../node_modules/@bryllim/workout-guide/manifest.json');
const CUSTOM_MANIFEST = path('../assets/custom-demos/manifest.json');
const SEED_SOURCE = path('../src/db/seed.ts');
const CATALOGUE_OUT = path('../src/data/exerciseCatalogue.json');
const STEPS_OUT = path('../src/data/exerciseCatalogueSteps.json');
const FRAMES_DIR = path('../assets/catalogue-frames/');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with retries and backoff on network errors, 429 and 5xx. Any other status is final. */
async function fetchBytes(url) {
  let last;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) throw Object.assign(last, { final: true });
    } catch (e) {
      if (e.final) throw e;
      last = e;
    }
    await sleep(500 * 2 ** attempt);
  }
  throw last;
}

/** Runs `worker` over `items` with at most `limit` in flight. Returns the failures instead of stopping at the first. */
async function pool(items, limit, worker) {
  const failures = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await worker(item);
        } catch (e) {
          failures.push({ item, error: e });
        }
      }
    }),
  );
  return failures;
}

const compactArray = (rows) => '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';
const compactObject = (obj) => '{\n' + Object.keys(obj).map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',\n') + '\n}\n';
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function tally(rows, key) {
  const counts = {};
  for (const r of rows) counts[r[key]] = (counts[r[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || byCodepoint(a[0], b[0])));
}

// --- what the app already has ------------------------------------------------------------------

const demos = [...JSON.parse(await readFile(MANIFEST, 'utf8')), ...JSON.parse(await readFile(CUSTOM_MANIFEST, 'utf8'))];
const seeds = seedNamesFromSource(await readFile(SEED_SOURCE, 'utf8'));
if (seeds.length === 0) throw new Error(`Found no seeded exercises in ${SEED_SOURCE}; has its layout changed?`);
const appKeys = appNameKeys({ demos, seeds });
console.log(`App side: ${demos.length} demos, ${seeds.length} seeded exercises, ${appKeys.size} name keys.`);

// --- the dataset --------------------------------------------------------------------------------

console.log(`Fetching ${DATASET_URL} ...`);
const dataset = JSON.parse((await fetchBytes(DATASET_URL)).toString('utf8'));
console.log(`Downloaded ${dataset.length} dataset entries.`);

const reviewed = new Map(REVIEWED_DUPLICATES);
const notLifting = new Set(NOT_LIFTING);
const names = new Set(dataset.map((e) => e.name));
for (const n of [...reviewed.keys(), ...notLifting, ...Object.keys(MUSCLE_OVERRIDES), ...ISOLATION_OVERRIDES]) {
  if (!names.has(n)) throw new Error(`scripts/lib/catalogueRules.mjs names "${n}", which is not in the dataset.`);
}

const dropped = { category: 0, images: 0 };
const excluded = [];
const kept = [];
for (const raw of dataset) {
  if (!CATEGORIES.has(raw.category)) {
    dropped.category++;
    continue;
  }
  if ((raw.images?.length ?? 0) < MIN_IMAGES) {
    dropped.images++;
    continue;
  }
  const mapped = mapEntry(raw);
  if (notLifting.has(raw.name)) {
    excluded.push({ how: 'not lifting', name: raw.name, other: '' });
    continue;
  }
  if (reviewed.has(raw.name)) {
    excluded.push({ how: 'reviewed', name: raw.name, other: reviewed.get(raw.name) });
    continue;
  }
  const hit = entryKeys(raw.name, mapped.equipment).map((k) => appKeys.get(k)).find(Boolean);
  if (hit) {
    excluded.push({ how: 'same name', name: raw.name, other: hit });
    continue;
  }
  kept.push({ raw, mapped });
}

console.log(`\nDropped ${dropped.category} entries outside strength / powerlifting / strongman / olympic weightlifting, ${dropped.images} with fewer than ${MIN_IMAGES} photos.`);
console.log(`Excluded ${excluded.length} the app already has:`);
for (const e of excluded.sort((a, b) => byCodepoint(a.how, b.how) || byCodepoint(a.name, b.name))) {
  console.log(`  ${e.how.padEnd(11)} ${e.name}${e.other ? `  <=>  ${e.other}` : ''}`);
}

// The catalogue is also held against itself: the same exercise under two dataset names is one too many.
const repeats = catalogueRepeats(kept.map((k) => ({ name: k.mapped.name, equipment: k.mapped.equipment })));
if (repeats.length > 0) {
  const lines = repeats.map((r) => `  "${r.names[0]}"  and  "${r.names[1]}"  (${r.key})`).join('\n');
  throw new Error(`The catalogue would list the same exercise twice. Add one of each pair to REVIEWED_DUPLICATES in scripts/lib/catalogueRules.mjs:\n${lines}`);
}

kept.sort((a, b) => byCodepoint(a.mapped.slug, b.mapped.slug));
const seen = new Map();
for (const { raw, mapped } of kept) {
  if (seen.has(mapped.slug)) throw new Error(`Slug "${mapped.slug}" is shared by "${seen.get(mapped.slug)}" and "${raw.name}".`);
  seen.set(mapped.slug, raw.name);
}

const entries = kept.map((k) => k.mapped);
const steps = {};
for (const { raw, mapped } of kept) {
  const lines = (raw.instructions ?? []).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 0) steps[mapped.slug] = lines;
}

await writeFile(CATALOGUE_OUT, compactArray(entries));
await writeFile(STEPS_OUT, compactObject(steps));
console.log(`\nKept ${entries.length} entries; ${Object.keys(steps).length} have steps.`);
console.log(`Wrote ${CATALOGUE_OUT}\nWrote ${STEPS_OUT}`);
for (const key of ['muscleGroup', 'equipment', 'kind', 'level']) console.log(`  ${key}: ${JSON.stringify(tally(entries, key))}`);

if (DATA_ONLY) {
  console.log('\n--data-only: photos not touched.');
  process.exit(0);
}

// --- the photos ---------------------------------------------------------------------------------

const jobs = [];
for (const { raw, mapped } of kept) {
  for (let n = 0; n < FRAME_COUNT; n++) {
    jobs.push({ source: raw.images[n], slug: mapped.slug, file: join(FRAMES_DIR, mapped.slug, `${n + 1}.webp`) });
  }
}

let fetched = 0;
const failures = await pool(jobs, CONCURRENCY, async (job) => {
  if (!FORCE && existsSync(job.file) && (await stat(job.file)).size > 0) return;
  const url = PHOTO_BASE + job.source.split('/').map(encodeURIComponent).join('/');
  const photo = await fetchBytes(url);
  const webp = await sharp(photo).resize({ width: FRAME_WIDTH }).webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT }).toBuffer();
  await mkdir(join(FRAMES_DIR, job.slug), { recursive: true });
  // Written beside and renamed, so an interrupted run never leaves a truncated frame that a re-run would skip.
  await writeFile(job.file + '.part', webp);
  await rename(job.file + '.part', job.file);
  if (++fetched % 100 === 0) console.log(`  ${fetched} frames written ...`);
});
console.log(`\nFrames: ${fetched} written, ${jobs.length - fetched - failures.length} already present.`);

if (failures.length > 0) {
  for (const f of failures) console.error(`  FAILED ${f.item.source}: ${f.error.message}`);
  console.error(`${failures.length} frames failed. Run again to pick up where this stopped.`);
  process.exit(1);
}

// A folder for an entry that is no longer kept would ship for nothing (and the test would fail on it).
const wanted = new Set(entries.map((e) => e.slug));
for (const d of await readdir(FRAMES_DIR, { withFileTypes: true })) {
  if (d.isDirectory() && !wanted.has(d.name)) {
    await rm(join(FRAMES_DIR, d.name), { recursive: true, force: true });
    console.log(`  removed stale frames for ${d.name}`);
  }
}

let total = 0;
for (const job of jobs) total += (await stat(job.file)).size;
const mb = (total / 1024 / 1024).toFixed(2);
console.log(`Total ${jobs.length} frames, ${total} bytes (${mb} MiB); budget ${(FRAME_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MiB.`);
if (total > FRAME_BUDGET_BYTES) {
  console.error(`Over budget by ${total - FRAME_BUDGET_BYTES} bytes. Lower the quality or the width, or keep fewer entries.`);
  process.exit(1);
}
