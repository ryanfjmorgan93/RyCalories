/**
 * Turns one free-exercise-db record into a catalogue entry (see src/domain/catalogue.ts).
 * Shared by scripts/build-exercise-catalogue.mjs and src/data/catalogueMapping.test.ts.
 *
 * The mapping reads the dataset's own structure (primary muscle, equipment, mechanic, category)
 * and only falls back to the name where the dataset has no field for it. Where the dataset is
 * wrong or files one family of lifts in several places, the reviewed lists in catalogueRules.mjs
 * correct it by name.
 */

import { ISOLATION_OVERRIDES, MUSCLE_OVERRIDES } from './catalogueRules.mjs';

const PRIMARY_MUSCLE = {
  quadriceps: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  adductors: 'adductors',
  abductors: 'glutes',
  abdominals: 'abs',
  chest: 'chest',
  shoulders: 'shoulders',
  triceps: 'triceps',
  biceps: 'biceps',
  forearms: 'forearms',
  lats: 'lats',
  'middle back': 'upper back',
  'lower back': 'lower back',
  traps: 'traps',
  neck: 'neck',
};

/** The dataset files rear-delt work under "shoulders"; these names give it away. */
const REAR_DELT_NAME = /rear|reverse fly|reverse flye|face pull|bent.?over\b.*\blateral|back flye|row to neck/i;

const EQUIPMENT = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  cable: 'cable',
  machine: 'machine',
  'body only': 'bodyweight',
  kettlebells: 'kettlebell',
  // Not 'barbell': a barbell gets a 20 kg warm-up ramp and an EZ bar is lighter than that.
  'e-z curl bar': 'other',
};

/** Two records the dataset files under "barbell" name the EZ bar in the title. */
const EZ_BAR_NAME = /\bE-?Z\b/i;

const CARRY_NAME = /carry|\bwalk\b|yoke/i;
/** Strongman events that cover ground; the rest of the category (stones, logs, tyres, car and axle lifts) are lifts for reps. */
const STRONGMAN_MOVES = /drag|push|wheel/i;
const TIMED_NAME = /plank|hold|isometric|wall sit|dead hang|hollow/i;
/** "Hang" alone would catch Hang Clean; a push-up into a side plank is reps. */
const NOT_TIMED_NAME = /clean|snatch|jerk|push.?up/i;
const BODYWEIGHT_PLUS_NAME = /pull.?up|chin.?up|\bchins\b|\bgrip chin\b|rope climb|\bdips?\b|muscle.?up|push.?up|hyperextension|back extension/i;
/** An assisted pull-up or dip takes weight off; the working weight is what the machine or band gives, not a load added. */
const ASSISTED_NAME = /assist/i;
const UNILATERAL_NAME = /single|one.?arm|one.?leg|alternat|unilateral|bulgarian|split squat|lunge|step.?up|pistol/i;

const LEVELS = new Set(['beginner', 'intermediate', 'expert']);

/** Dataset id lowercased, every run of non-alphanumerics one hyphen, none at the ends. */
export function slugOf(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function muscleGroupOf(raw) {
  const primary = raw.primaryMuscles?.[0];
  const group = PRIMARY_MUSCLE[primary];
  if (!group) throw new Error(`No muscle group for "${primary}" on "${raw.name}"`);
  if (Object.hasOwn(MUSCLE_OVERRIDES, raw.name)) return MUSCLE_OVERRIDES[raw.name];
  if (group === 'shoulders' && REAR_DELT_NAME.test(raw.name)) return 'rear delts';
  return group;
}

export function equipmentOf(raw) {
  const equipment = EQUIPMENT[raw.equipment] ?? 'other';
  // An EZ bar is not a barbell, whichever the dataset says (a barbell gets the 20 kg bar-first warm-up ramp).
  if (equipment === 'barbell' && raw.name && EZ_BAR_NAME.test(raw.name)) return 'other';
  return equipment;
}

export function kindOf(raw) {
  const bodyOnly = raw.equipment === 'body only';
  // The dataset files most hanging and dipping work under "other", or under nothing, rather than "body
  // only". Only kit that carries the load (machine, bar, kettlebell, ball) keeps a lift from being one.
  const unloaded = bodyOnly || raw.equipment === 'other' || raw.equipment == null;
  if (CARRY_NAME.test(raw.name) || (raw.category === 'strongman' && STRONGMAN_MOVES.test(raw.name))) return 'carry';
  if (bodyOnly && TIMED_NAME.test(raw.name) && !NOT_TIMED_NAME.test(raw.name)) return 'timed';
  if (unloaded && BODYWEIGHT_PLUS_NAME.test(raw.name) && !ASSISTED_NAME.test(raw.name)) return 'bodyweight_plus';
  return 'reps';
}

export function isCompoundOf(raw) {
  // The dataset calls most abdominal work compound. A crunch, a sit-up or a leg raise with no kit is
  // one movement at the trunk, and compound would give it a squat's 150 s rest. Loaded ab work
  // (rollouts, windmills, cable chops) keeps the dataset's word.
  if (raw.primaryMuscles?.[0] === 'abdominals' && raw.equipment === 'body only') return false;
  if (raw.name !== undefined && ISOLATION_OVERRIDES.includes(raw.name)) return false;
  if (raw.mechanic === 'compound') return true;
  if (raw.mechanic === 'isolation') return false;
  return (raw.secondaryMuscles?.length ?? 0) >= 2;
}

/** @returns {{ slug: string, name: string, muscleGroup: string, equipment: string, kind: string, isCompound: boolean, unilateral: boolean, level: string }} */
export function mapEntry(raw) {
  if (!LEVELS.has(raw.level)) throw new Error(`Unknown level "${raw.level}" on "${raw.name}"`);
  const name = raw.name.replace(/_/g, ' ').trim();
  return {
    slug: slugOf(raw.id),
    name,
    muscleGroup: muscleGroupOf({ ...raw, name }),
    equipment: equipmentOf({ ...raw, name }),
    kind: kindOf({ ...raw, name }),
    isCompound: isCompoundOf({ ...raw, name }),
    unilateral: UNILATERAL_NAME.test(name),
    level: raw.level,
  };
}
