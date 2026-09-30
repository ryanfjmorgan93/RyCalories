/**
 * Name matching shared by scripts/build-exercise-catalogue.mjs and src/data/catalogue.test.ts.
 * The script uses it to keep the catalogue to exercises the app does not already have; the test
 * uses the very same functions to prove none slipped through.
 *
 * Plain JavaScript on purpose: the script runs under bare node, the test imports it under Vitest.
 */

/** Words that may close a name in brackets, "Romanian Deadlift (Barbell)". */
const SUFFIX_WORDS = new Set([
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'smith',
  'kettlebell',
  'bodyweight',
  'body',
  'weight',
  'band',
  'bands',
  'resistance',
  'ez',
  'bar',
  'plate',
  'ball',
  'bench',
  'other',
]);

/** Equipment words that a source may put anywhere in a name; each maps to one class. */
const EQUIPMENT_CLASS = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  cable: 'cable',
  machine: 'machine',
  kettlebell: 'kettlebell',
  band: 'band',
  resistance: 'band',
};

const ABBREVIATIONS = { db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', kb: 'kettlebell' };

/** Two-word forms that the sources spell both ways ("Push-up", "Pushup"). */
const JOINS = [
  ['push up', 'pushup'],
  ['pull up', 'pullup'],
  ['chin up', 'chinup'],
  ['sit up', 'situp'],
  ['step up', 'stepup'],
  ['pull down', 'pulldown'],
  ['push down', 'pushdown'],
  ['dead lift', 'deadlift'],
  ['cross over', 'crossover'],
  ['kick back', 'kickback'],
  ['pull over', 'pullover'],
  ['muscle up', 'muscleup'],
  ['good morning', 'goodmorning'],
  ['flye', 'fly'],
];

const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

function singular(w) {
  if (w === 'ups') return 'up';
  if (w.length <= 3 || !w.endsWith('s') || w.endsWith('ss')) return w;
  if (/(ch|sh|x|ss)es$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  return w.slice(0, -1);
}

/**
 * Lowercase, drop punctuation and apostrophes, expand the app's own abbreviations, singularise
 * simple plurals ("Hammer Curls" -> "hammer curl"), and join the spellings that differ only by a
 * space. Two names that mean the same exercise for our purposes come out identical.
 */
export function normaliseName(s) {
  let out = s
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[-/_]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => singular(own(ABBREVIATIONS, w) ?? w))
    .join(' ');
  for (const [from, to] of JOINS) out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  return out;
}

/** "Romanian Deadlift (Barbell)" -> { base: "Romanian Deadlift", equipment: "Barbell" }; no suffix -> equipment ''. */
export function splitEquipmentSuffix(name) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  if (!m) return { base: name.trim(), equipment: '' };
  const words = normaliseName(m[2]).split(' ').filter(Boolean);
  if (words.length === 0 || !words.every((w) => SUFFIX_WORDS.has(w))) return { base: name.trim(), equipment: '' };
  return { base: m[1].trim(), equipment: m[2].trim() };
}

/**
 * Every comparison key one name stands for. `equipment` is the exercise's own equipment when the
 * source keeps it apart from the name (the demo manifest and the seed do; the dataset folds it into
 * the name), so "Bench Press" + "Barbell" also answers to "Barbell Bench Press".
 *
 * Three families of key:
 *  - the whole name, and the name without a bracketed equipment suffix (equipment ignored);
 *  - the name with its equipment prefixed, for a source that keeps equipment apart;
 *  - the name with every equipment word taken out, its words sorted, tagged with the equipment class, so "Decline Barbell Bench Press" meets "Decline Bench Press (Barbell)"
 *    and "Push-Up Wide" meets "Wide Push-up" while "Cable Bench Press" stays apart from
 *    "Bench Press (Barbell)".
 */
export function nameKeys(name, equipment = '') {
  const { base, equipment: suffix } = splitEquipmentSuffix(name);
  const keys = new Set([normaliseName(name), normaliseName(base)]);
  for (const eq of [suffix, equipment]) {
    const e = normaliseName(eq);
    if (e) keys.add(normaliseName(`${e} ${base}`));
  }
  const words = normaliseName(base).split(' ').filter(Boolean);
  const classOf = (list) => list.map((w) => own(EQUIPMENT_CLASS, w)).find(Boolean);
  const core = words.filter((w) => !own(EQUIPMENT_CLASS, w));
  const named = classOf(words);
  const declared = [suffix, equipment].map((e) => classOf(normaliseName(e).split(' '))).find(Boolean);
  const cls = named ?? declared ?? '';
  if (core.length > 0) keys.add(`${[...core].sort().join(' ')}|${cls}`);
  keys.delete('');
  return [...keys];
}

const KEYED_EQUIPMENT = new Set(['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell']);

/**
 * `nameKeys` for a catalogue entry: its own equipment (the app's `Equipment` value) counts as
 * declared only when it names a piece of kit; 'bodyweight' and 'other' say nothing about the name.
 * The script and the test both go through here so they cannot disagree.
 */
export function entryKeys(name, equipment) {
  return nameKeys(name, KEYED_EQUIPMENT.has(equipment) ? equipment : '');
}

/**
 * Every key the app's own exercises answer to, each pointing at a readable "Name (Equipment)".
 * `demos` is the workout-guide manifest plus the bespoke demos (name, equipment); `seeds` is
 * `seedNamesFromSource`.
 * @returns {Map<string, string>}
 */
export function appNameKeys({ demos, seeds }) {
  const map = new Map();
  const add = (key, from) => {
    if (!map.has(key)) map.set(key, from);
  };
  for (const d of demos) for (const k of nameKeys(d.name, d.equipment ?? '')) add(k, `${d.name} (${d.equipment}) [demo]`);
  for (const s of seeds) for (const n of [s.name, ...s.aliases]) for (const k of nameKeys(n, s.equipment)) add(k, `${n} [seed]`);
  return map;
}

/**
 * Exercise names and aliases from src/db/seed.ts, read from the source text so a plain node script
 * needs no TypeScript. Only the SEED_EXERCISES lines are looked at.
 * @returns {{ name: string, aliases: string[], equipment: string }[]}
 */
export function seedNamesFromSource(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('{ id:') || !line.includes('muscleGroup:')) continue;
    const name = /\bname: ("(?:[^"\\]|\\.)*")/.exec(line);
    if (!name) continue;
    const aliases = /\baliases: (\[[^\]]*\])/.exec(line);
    const equipment = /\bequipment: "([a-z]+)"/.exec(line);
    out.push({
      name: JSON.parse(name[1]),
      aliases: aliases ? JSON.parse(aliases[1]) : [],
      equipment: equipment ? equipment[1] : '',
    });
  }
  return out;
}
