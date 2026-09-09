/**
 * Domain types. These mirror the Dexie tables 1:1 (see src/db/db.ts).
 * Every record carries a stable UUID `id` so export → import round-trips cleanly
 * and a sync layer can be bolted on later without renumbering anything.
 */

export type ExerciseKind = 'reps' | 'bodyweight_plus' | 'carry' | 'timed';
export type ProgressionMode = 'normal' | 'calibrating';
export type SetType = 'warmup' | 'working';

export type MuscleGroup =
  | 'hamstrings'
  | 'glutes'
  | 'quads'
  | 'adductors'
  | 'calves'
  | 'lower back'
  | 'chest'
  | 'shoulders'
  | 'triceps'
  | 'biceps'
  | 'forearms'
  | 'lats'
  | 'upper back'
  | 'traps'
  | 'rear delts'
  | 'abs'
  | 'neck'
  | 'full body'
  | 'other';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'hamstrings',
  'glutes',
  'quads',
  'adductors',
  'calves',
  'lower back',
  'chest',
  'shoulders',
  'triceps',
  'biceps',
  'forearms',
  'lats',
  'upper back',
  'traps',
  'rear delts',
  'abs',
  'neck',
  'full body',
  'other',
];

export interface Exercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  muscleGroup: MuscleGroup;
  isCompound: boolean;
  isLowerBody: boolean;
  /** Default rest between sets in seconds (compound 150 · isolation 75 · carry 90). */
  defaultRestSec: number;
  /** Default weight increment in kg when this exercise is added to a routine. */
  defaultIncrement: number;
  unilateral: boolean;
  notes?: string;
  /** Alternative names (e.g. the title used in a Hevy export) so imports match. */
  aliases?: string[];
  /** ISO timestamp of creation; used only for ordering custom exercises. */
  createdAt: string;
}

export interface Routine {
  id: string;
  name: string;
  /** Position in the weekly order (0-based). */
  order: number;
  isLowerBody: boolean;
  /** Optional target session length. When exceeded the session clock changes colour. */
  targetMinutes?: number;
  /** Soft-deleted routines stay so that historic sessions keep their name. */
  archived?: boolean;
}

export interface RoutineExercise {
  id: string;
  routineId: string;
  exerciseId: string;
  order: number;
  targetSets: number;
  /** Optional upper bound for display when the plan says e.g. "3–4 sets". Extra sets are always allowed. */
  targetSetsMax?: number;
  repMin: number;
  repMax: number;
  /** Working weight in kg. For `bodyweight_plus` this is the added kg. Ignored when calibrating. */
  currentWeight: number;
  increment: number;
  mode: ProgressionMode;
  /** One-line cue, verbatim, shown above the logging row in a session. */
  cue?: string;
  notes?: string;
  optional: boolean;
  restSecOverride?: number;
  /**
   * §4.8 Phase 2 — share one progression number across routines. When true, this
   * routine-exercise's currentWeight / mode / increment are kept in sync with every other
   * linked routine-exercise of the same exercise.
   */
  linkProgression?: boolean;
  /** Carry exercises: target distance range in metres (display only). */
  distanceMinM?: number;
  distanceMaxM?: number;
}

export type NiggleTag = 'lower back' | 'hamstring DOMS' | 'knee' | 'shoulder' | 'other';
export const NIGGLE_TAGS: NiggleTag[] = ['lower back', 'hamstring DOMS', 'knee', 'shoulder', 'other'];

export interface Niggle {
  tag: NiggleTag;
  severity: 1 | 2 | 3;
  note?: string;
}

export interface Session {
  id: string;
  /** Empty string for imported sessions that don't map to a routine. */
  routineId: string;
  /** Snapshot of the routine name at the time (survives routine renames/deletes; used for imports). */
  title: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  notes?: string;
  niggles?: Niggle[];
  /** Routine-exercise ids the user explicitly skipped in this session. */
  skippedRoutineExerciseIds?: string[];
  /** Exercises added for this session only (no routine-exercise, so no progression). */
  extraExerciseIds?: string[];
  /** Where the record came from. Absent = logged in this app. */
  source?: 'hevy' | 'backup';
  /** Leg-day checklist state (Phase 2). */
  checklist?: { electrolytes?: boolean; protein?: boolean };
}

export interface SetLog {
  id: string;
  sessionId: string;
  /** Null for imported sets that have no routine-exercise. */
  routineExerciseId: string | null;
  exerciseId: string;
  /** 0-based position within the exercise for this session. */
  index: number;
  type: SetType;
  /** kg (added kg for bodyweight_plus). 0 for pure bodyweight. */
  weight: number;
  reps?: number;
  distanceM?: number;
  seconds?: number;
  /** Reps in reserve 0–5, optional. */
  rir?: number;
  completedAt: string;
}

export type ProgressionRule =
  | 'increase'
  | 'hold'
  | 'hold_missing_sets'
  | 'calibrating'
  | 'not_applicable'
  | 'lock_in';

export interface ProgressionDecision {
  id: string;
  sessionId: string;
  routineExerciseId: string;
  fromWeight: number;
  /** What the engine proposed. */
  toWeight: number;
  rule: ProgressionRule;
  /** True when the proposal was accepted as-is. */
  accepted: boolean;
  /** Present when the user typed their own number. */
  overrideTo?: number;
  decidedAt: string;
}

export interface Bodyweight {
  id: string;
  /** ISO date (YYYY-MM-DD). One entry per day; re-logging the same day replaces it. */
  date: string;
  kg: number;
  note?: string;
}

export interface Settings {
  id: 'settings';
  units: 'kg';
  theme: 'dark' | 'light';
  calorieStart: number;
  calorieStep: number;
  calorieStepDays: number;
  calorieCeiling: number;
  /** ISO date the reverse diet started (set the day Settings is first saved). */
  calorieStartDate?: string;
  proteinTarget: number;
  proteinTargetLegDay: number;
  weeklyGainTargetMin: number;
  weeklyGainTargetMax: number;
  bodyweightTargetMin: number;
  bodyweightTargetMax: number;
  /** Default rest seconds by exercise tag. */
  restCompoundSec: number;
  restIsolationSec: number;
  restCarrySec: number;
  restVibrate: boolean;
  restNotify: boolean;
  /** Seed data version, so future seed changes can migrate. */
  seedVersion: number;
  /** ISO timestamp of first run. */
  createdAt: string;
  /** Bumped every save; the reverse-diet start date is stamped on the first save. */
  savedAt?: string;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'id' | 'createdAt'> = {
  units: 'kg',
  theme: 'dark',
  calorieStart: 1900,
  calorieStep: 200,
  calorieStepDays: 14,
  calorieCeiling: 3000,
  proteinTarget: 170,
  proteinTargetLegDay: 200,
  weeklyGainTargetMin: 0.25,
  weeklyGainTargetMax: 0.5,
  bodyweightTargetMin: 80,
  bodyweightTargetMax: 82,
  restCompoundSec: 150,
  restIsolationSec: 75,
  restCarrySec: 90,
  restVibrate: true,
  restNotify: true,
  seedVersion: 1,
};

// ---------------------------------------------------------------------------
// Nutrition (merged from the RyCalories app)

/**
 * One logged meal. `date` is the local day it counts towards and is separate from `loggedAt`,
 * which is when it was actually recorded. Keeping them apart is what makes logging to a past day
 * possible — the old app derived the day from the timestamp and so could only ever log to today.
 */
export interface Meal {
  id: string;
  /** Local day key (YYYY-MM-DD) this meal counts towards. */
  date: string;
  loggedAt: string;
  name: string;
  /** 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined when unlabelled. */
  slot?: MealSlot;
  /** Path relative to the app's data directory, never absolute: an absolute path embeds the
   * package name and breaks on any app-id change or device transfer. */
  photoPath?: string;
  /** What the user typed, when the meal was entered as text rather than photographed. */
  enteredText?: string;
  notes?: string;
  /** How confident the recognising model was, when a model was involved at all. */
  confidence?: 'low' | 'medium' | 'high';
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * One food within a meal. Nutrition is the discriminated union from `@/domain/food`, so a
 * portion's weight and its macros can never disagree. Totals are never stored.
 */
export interface MealItem {
  id: string;
  mealId: string;
  /** Position within the meal. */
  index: number;
  name: string;
  portion: string;
  brand?: string;
  product?: string;
  source: import('./food').FoodSource;
  nutrition: import('./food').Nutrition;
}

/**
 * Remembered nutrition for a food eaten before, stored per 100 g so any portion is derivable.
 * Reserved: declared so a later feature needs no migration, but nothing writes to it in v1.
 */
export interface FoodMemory {
  id: string;
  /** Normalised match key (brand + product, or the normalised name). */
  key: string;
  name: string;
  brand?: string;
  product?: string;
  per100: import('./food').Macros;
  /** Typical portion weight, as a suggestion only — portions genuinely vary. */
  typicalGrams?: number;
  source: import('./food').FoodSource;
  timesUsed: number;
  lastUsedAt: string;
}

/** Cached Open Food Facts result, keyed by barcode or by normalised search query. */
export interface ProductCacheEntry {
  key: string;
  /** Null records a confident miss, so an unrecognised food stops re-hitting the network. */
  per100: import('./food').Macros | null;
  name?: string;
  brand?: string;
  servingGrams?: number;
  packGrams?: number;
  fetchedAt: string;
}

export type PhaseKind = 'cut' | 'maintain' | 'bulk';

/** A training and nutrition phase. What makes the two halves one app rather than two tabs. */
export interface Phase {
  id: string;
  kind: PhaseKind;
  startDate: string;
  endDate?: string;
  /** Target rate of bodyweight change in kg per week. Negative when cutting. */
  targetRateKgPerWeek?: number;
  notes?: string;
}
