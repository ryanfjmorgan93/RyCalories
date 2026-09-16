#!/usr/bin/env node
/**
 * Downloads free-exercise-db (public domain, Unlicense) and matches its entries to the
 * @bryllim/workout-guide manifest by normalised name, writing src/data/exerciseInstructions.json
 * as `{ [slug]: string[] }`. Run once; the output is committed. Re-run only if the manifest or the
 * upstream free-exercise-db data changes.
 *
 * Usage: node scripts/fetch-instructions.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXERCISES_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

const manifestUrl = new URL('../node_modules/@bryllim/workout-guide/manifest.json', import.meta.url);
const outUrl = new URL('../src/data/exerciseInstructions.json', import.meta.url);

/** @type {{slug: string, name: string, equipment: string}[]} */
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

console.log(`Fetching ${EXERCISES_URL} ...`);
const res = await fetch(EXERCISES_URL);
if (!res.ok) {
  throw new Error(`Failed to fetch free-exercise-db: HTTP ${res.status}`);
}
/** @type {{name: string, instructions: string[]}[]} */
const fedb = await res.json();
console.log(`Downloaded ${fedb.length} free-exercise-db entries.`);

/**
 * Lowercase, strip punctuation, singularise simple plurals. Equipment words like
 * "dumbbell"/"barbell"/"cable"/"machine" are treated as ordinary words in the name — free-exercise-db
 * usually folds equipment into the exercise name (e.g. "Barbell Bench Press"), while the
 * workout-guide manifest keeps it in a separate `equipment` field, so the equipment-prefixed form is
 * tried as a fallback below.
 */
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-/]/g, ' ')
    .replace(/[().,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

const EQUIPMENT_WORDS = new Set(['dumbbell', 'barbell', 'cable', 'machine']);

/**
 * Manual overrides for seed-relevant exercises (see src/db/seed.ts / scripts/seed-demos.json),
 * verified by eye against the free-exercise-db entry. Keyed by workout-guide slug.
 */
const OVERRIDES = {
  'farmer-carry': "Farmer's Walk",
  'lat-pulldown': 'Wide-Grip Lat Pulldown',
  'back-extension': 'Hyperextensions (Back Extensions)',
  'bench-press': 'Barbell Bench Press - Medium Grip',
  'seated-dumbbell-press': 'Dumbbell Shoulder Press',
  'hip-adduction-machine': 'Thigh Adductor',
  'overhead-tricep-extension': 'Cable Rope Overhead Triceps Extension',
  'lateral-raise': 'Side Lateral Raise',
  'rear-delt-fly': 'Bent Over Dumbbell Rear Delt Raise With Head On Bench',
};

const fedbByNorm = new Map();
for (const entry of fedb) {
  const key = normalize(entry.name);
  if (!fedbByNorm.has(key)) fedbByNorm.set(key, []);
  fedbByNorm.get(key).push(entry);
}

function lookup(name) {
  return fedbByNorm.get(normalize(name));
}

/** @type {Record<string, string[]>} */
const instructions = {};
let matched = 0;
const matchedNames = [];
const unmatchedSlugs = [];

for (const ex of manifest) {
  let hits;
  if (OVERRIDES[ex.slug]) {
    hits = lookup(OVERRIDES[ex.slug]);
  } else {
    hits = lookup(ex.name);
    if (!hits) {
      const eq = (ex.equipment || '').toLowerCase();
      if (EQUIPMENT_WORDS.has(eq)) {
        hits = lookup(`${ex.equipment} ${ex.name}`);
      }
    }
  }

  if (hits && hits.length && hits[0].instructions && hits[0].instructions.length) {
    const steps = hits[0].instructions.map((s) => s.trim()).filter(Boolean);
    if (steps.length) {
      instructions[ex.slug] = steps;
      matched++;
      matchedNames.push(`${ex.slug} -> ${hits[0].name}`);
      continue;
    }
  }
  unmatchedSlugs.push(ex.slug);
}

// Deterministic key order.
const sorted = Object.fromEntries(Object.keys(instructions).sort().map((k) => [k, instructions[k]]));

writeFileSync(fileURLToPath(outUrl), JSON.stringify(sorted, null, 2) + '\n');

console.log(`Matched ${matched} / ${manifest.length} manifest exercises to free-exercise-db instructions.`);
console.log(`Wrote ${fileURLToPath(outUrl)}`);
console.log('');
console.log('Matched (slug -> free-exercise-db name):');
for (const line of matchedNames) console.log('  ' + line);
console.log('');
console.log(`Unmatched (${unmatchedSlugs.length}): ${unmatchedSlugs.join(', ')}`);
