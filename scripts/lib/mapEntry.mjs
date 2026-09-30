/**
 * Turns one free-exercise-db record into a catalogue entry (see src/domain/catalogue.ts).
 * Shared by scripts/build-exercise-catalogue.mjs and src/data/catalogueMapping.test.ts.
 *
 * The mapping reads the dataset's own structure (primary muscle, equipment, mechanic, category)
 * and only falls back to the name where the dataset has no field for it.
 */

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

const CARRY_NAME = /carry|\bwalk\b|yoke/i;
/** Strongman events that cover ground; the rest of the category (stones, logs, tyres, car and axle lifts) are lifts for reps. */
const STRONGMAN_MOVES = /drag|push|wheel/i;
const TIMED_NAME = /plank|hold|isometric|wall sit|dead hang|hollow/i;
/** "Hang" alone would catch Hang Clean; a push-up into a side plank is reps. */
const NOT_TIMED_NAME = /clean|snatch|jerk|push.?up/i;
const BODYWEIGHT_PLUS_NAME = /pull.?up|chin.?up|\bdips?\b|muscle.?up|push.?up|hyperextension|back extension/i;
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
  if (group === 'shoulders' && REAR_DELT_NAME.test(raw.name)) return 'rear delts';
  return group;
}

export function equipmentOf(raw) {
  return EQUIPMENT[raw.equipment] ?? 'other';
}

export function kindOf(raw) {
  const bodyOnly = raw.equipment === 'body only';
  if (CARRY_NAME.test(raw.name) || (raw.category === 'strongman' && STRONGMAN_MOVES.test(raw.name))) return 'carry';
  if (bodyOnly && TIMED_NAME.test(raw.name) && !NOT_TIMED_NAME.test(raw.name)) return 'timed';
  if (bodyOnly && BODYWEIGHT_PLUS_NAME.test(raw.name)) return 'bodyweight_plus';
  return 'reps';
}

export function isCompoundOf(raw) {
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
    equipment: equipmentOf(raw),
    kind: kindOf({ ...raw, name }),
    isCompound: isCompoundOf(raw),
    unilateral: UNILATERAL_NAME.test(name),
    level: raw.level,
  };
}
