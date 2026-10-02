/**
 * Builds routines from what the owner already does, the way a coach would — pure. No IO, no clock,
 * no model, and no `Math.random`: the caller passes a seed, and the same input with the same seed
 * always gives the same routines, whatever order the database handed the candidates back in.
 *
 * It answers "give me a routine for 3D shoulders" without asking a small language model to know a
 * lateral raise from a press. A routine is made of exercises the owner has done (they have working
 * weights) with a few they have not, taken from the library only where their own cannot cover a part
 * of the muscle. Every weight is the owner's own number or none; nothing is invented.
 *
 * What it does, in the order a coach would:
 *   - Writes the days a coach writes: 3D shoulders is one heavy press, then the side delts (two
 *     lateral raises), the rear delts (a fly and a face pull) and a front raise only if there is room;
 *     a push day always has triceps and a lateral raise, a pull day biceps, a leg day quads,
 *     hamstrings and calves. `PLANS` says what each is, in the order its parts are taken.
 *   - Starts with one or two heavy compound lifts, then secondary lifts, then isolation finishers,
 *     the bigger muscles first in each.
 *   - Covers every part of a muscle (front, side and rear of the shoulder; upper, mid and fly for
 *     the chest) before taking a second exercise for one part, and never takes the same movement
 *     twice while another is on offer, but where a plan asks for two.
 *   - Sets and reps by role: heavy and low for the main lifts, lighter and higher for raises. The
 *     owner's own sets and reps win for an exercise they already do.
 *   - Looks at the week it goes into: the sets a muscle already gets from the owner's routines.
 *   - Steers round a niggle (logged in the last fortnight, or typed in the request) by how bad it is,
 *     leaves out the movements the request names, and offers a variation of a lift that has stopped
 *     progressing.
 *   - Fits a length asked for by dropping finishers or adding one, whichever lands nearer.
 *   - Says every one of those in a short factual line (`reasonLines`), so the coach can answer "why".
 *     A line says only what is true of the routine as built: a rule that changed no choice is not
 *     mentioned.
 */
import { catalogueDemoKey } from './catalogue';
import { roundKg } from './engine';
import { normaliseName } from './exerciseMatch';
import { fmtKg } from './format';
import { MUSCLE_REGIONS, NON_ROUTINE_PATTERNS, REGION_LABELS, movementPattern, patternLabel, regionOf } from './movement';
import { MACRO_MUSCLES, type ParsedRequest, type RoutineSplit } from './quickRequest';
import { baseWeight, estimateMinutes, mulberry32, weightOf, type Candidate, type PaceBasis, type QuickInput } from './quickSession';
import { restSecondsFor, type RestDefaults } from './rest';
import { weeklySetsFromRoutines, type RoutineContext } from './routineContext';
import { DEFAULT_SETTINGS, MUSCLE_GROUPS, type Equipment, type MuscleGroup, type NiggleTag } from './types';

// ---------------------------------------------------------------------------
// Types

export interface RoutineRequest {
  /** Muscles to build the routine for. Empty = a spread, chosen by what the week leaves short. Ignored when `split` is set. */
  focus: MuscleGroup[];
  /** Muscles ruled out. */
  exclude?: MuscleGroup[];
  /** Exercises asked for. A split reads it per day. */
  count?: number;
  /** Equipment allowed. Absent = any. */
  equipment?: Equipment[];
  /** One routine per day of a named split. */
  split?: RoutineSplit;
  /**
   * Minutes asked for ("a 45 minute shoulder routine"): a target, not a ceiling. Finishers go when
   * that lands nearer, never the main lift, and one is added when the routine is short of it and no
   * count was asked for.
   */
  minutes?: number;
  /** Movements left out by name ("no squats"): `movementPattern` keys. */
  excludePatterns?: string[];
  /** Pain typed in the request ("my lower back is sore"): steers like a niggle of that body part, at its full list. */
  typedNiggles?: NiggleTag[];
  /** A part of a muscle asked for ("upper chest"): `unit:region`. It takes two exercises. */
  preferRegions?: string[];
}

export type Tier = 'primary' | 'secondary' | 'isolation';

export interface BuiltRow {
  /**
   * The owner's exercise id, or, for an exercise they have not got yet, the key of the library entry:
   * `cat:slug` for a catalogue entry, `demo:slug` for a bundled diagram (see `builtRowKey`).
   */
  id: string;
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** kg, from the owner's own numbers. Null for one they have not got a working weight for. */
  weightKg: number | null;
  /** 'catalogue' and 'diagram' rows are library exercises the owner has not got yet: new, with no weight. */
  origin: 'own' | 'catalogue' | 'diagram';
  catalogueSlug?: string;
  /** The diagram's slug, for a 'diagram' row: the picture key the exercise made from it carries. */
  demoSlug?: string;
  muscleGroup: MuscleGroup;
  equipment?: Equipment;
  /** `movementPattern`: a key such as 'press-vertical', or the muscle group when the name says nothing. */
  pattern: string;
  /** The part of the muscle it reaches, as `unit:region` ('shoulders:side'), when known. */
  region: string | null;
  tier: Tier;
  /** A fact line for this row: the muscle, the part of it, when it was last trained, the weight. */
  reason: string;
}

export interface BuiltRoutine {
  name: string;
  rows: BuiltRow[];
  /** Facts about the whole routine, one per line. Every rule that changed a choice has one. */
  reasonLines: string[];
  /** Whole minutes by the short-session model at the pace the input carries, never clamped to a length asked for. */
  estimateMinutes: number;
  /** The muscles the routine is for. */
  focus: MuscleGroup[];
  /** Muscles asked for that nothing in the owner's exercises or the library could serve. */
  unmet: MuscleGroup[];
}

/** The generator's input with the owner's routines, niggles and stalls beside it. All of it optional. */
export interface RoutineInput extends QuickInput {
  context?: RoutineContext;
}

// ---------------------------------------------------------------------------
// Constants

export const DEFAULT_ROUTINE_COUNT = 6;
export const DEFAULT_SPLIT_DAY_COUNT = 6;
const MAX_COUNT = 12;
/** A length asked for adds exercises up to this many, and no more. */
const MAX_FILL = 10;
/** The most exercises from the library (catalogue entries and diagrams together) a single routine takes. */
export const MAX_NEW_EXERCISES = 3;
const MAX_SETS = 4;
const MIN_SETS = 2;
/** Weekly sets a muscle is held up against when the owner has set no target for it. */
const DEFAULT_WEEKLY_REFERENCE = 10;
/** Working sets one muscle gets in a routine: a muscle named on its own, or two together, take the first window; a day of a split or a spread, or three or more named, the second. */
const NAMED_WINDOW: [number, number] = [9, 15];
const DAY_WINDOW: [number, number] = [4, 9];
/** A duration asked for never trims a routine below this many exercises. */
const TRIM_FLOOR = 2;

/** Bigger first: the order muscles are listed in when nothing else decides. */
const BIG_FIRST: MuscleGroup[] = [
  'quads', 'hamstrings', 'glutes', 'chest', 'lats', 'upper back', 'shoulders', 'traps', 'triceps', 'biceps', 'rear delts', 'calves', 'abs',
  'lower back', 'forearms', 'adductors', 'neck',
];

/** Relative size, for sharing a day's exercises between its muscles. */
const SIZE: Partial<Record<MuscleGroup, number>> = {
  quads: 3, chest: 3, lats: 3, hamstrings: 2, shoulders: 2, 'upper back': 2, glutes: 2, biceps: 1, triceps: 1, calves: 1, 'rear delts': 1,
  traps: 1, abs: 1, 'lower back': 0.5, forearms: 0.25, adductors: 0.25, neck: 0.25,
};
/** Muscles that, named together with bigger ones, get a quarter of a share: the arms are biceps and triceps before they are forearms. */
const MINOR: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['forearms', 'adductors', 'neck']);

/** What a full-body day is a spread across. */
const FULL_BODY_MUSCLES: MuscleGroup[] = ['quads', 'hamstrings', 'glutes', 'chest', 'lats', 'upper back', 'shoulders', 'biceps', 'triceps', 'calves', 'abs'];

const DAYS: Record<RoutineSplit, { name: string; muscles: MuscleGroup[] }[]> = {
  ppl: [
    { name: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
    { name: 'Pull', muscles: ['lats', 'upper back', 'rear delts', 'biceps'] },
    { name: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
  ],
  'upper-lower': [
    { name: 'Upper', muscles: MACRO_MUSCLES.upper },
    { name: 'Lower', muscles: MACRO_MUSCLES.lower },
  ],
  'full-body': [{ name: 'Full body', muscles: FULL_BODY_MUSCLES }],
};

/** The heavy lifts a routine opens with: movements that load several joints and take a low rep range. */
const PRIMARY_PATTERNS: ReadonlySet<string> = new Set([
  'press-vertical', 'press-horizontal', 'press-incline', 'squat', 'hinge', 'row', 'pulldown', 'pull-up', 'leg-press', 'hip-thrust',
]);
/** Raises and pulls to the face are done for many reps. */
const RAISE_PATTERNS: ReadonlySet<string> = new Set(['lateral-raise', 'rear-fly', 'face-pull', 'rear-row']);

/** Movements that are isolation work whatever a dataset flags: a rear delt row is no compound lift. */
const ISOLATION_PATTERNS: ReadonlySet<string> = new Set([
  'lateral-raise', 'front-raise', 'rear-fly', 'face-pull', 'rear-row', 'fly', 'curl', 'incline-curl', 'preacher-curl', 'hammer-curl', 'reverse-curl',
  'wrist-curl', 'triceps-extension', 'pushdown', 'triceps-kickback', 'leg-extension', 'leg-curl', 'calf-raise', 'crunch', 'leg-raise', 'twist',
  'pullover', 'abduction', 'adduction', 'glute-kickback', 'back-extension',
]);

/**
 * Who has a part of a muscle when two muscles in one day reach it. A part with no entry belongs to
 * the first muscle in the day that lists it. The rear delt is the rear delt's before it is the
 * shoulders' or the upper back's; rows are the upper back's before the lats'.
 */
const CLAIM_PRIORITY: Readonly<Record<string, readonly MuscleGroup[]>> = {
  'shoulders:rear': ['rear delts', 'shoulders', 'upper back'],
  'back:horizontal': ['upper back', 'lats'],
  'back:vertical': ['lats', 'upper back'],
  'back:traps': ['traps', 'upper back'],
};

/**
 * Library exercises a routine for someone training for size would not start with: equipment-specific
 * powerlifting variations, risky ones, gimmicks. Drawn a seventh as often as a plain one, never ruled out.
 */
const SPECIALTY = /chains?\b|\bbands?\b|\bboard press|pin press|guillotine|neck press|\bspeed\b|reverse band|powerlifting|zercher|jefferson|frankenstein|plate movers|bradford|rocky|anti gravity|cuban|power partials|crucifix|iron cross|car drivers|suspended|olympic squat|mixed grip|one arm chin|kipping|muscle up|gironda|london bridges|around the worlds|isometric|clock|typewriter|plyo|wipers|svend|forward drag|backward drag|conan|donkey kick|tate press|jm press|behind the back|behind neck|behind the neck|extended range|leg over|ball\b|cable iron/;
const SPECIALTY_FACTOR = 1 / 7;
const UNLOADED_FACTOR = 1 / 4;
/** Lifts behind the neck: never a variation offered for a stalled lift, and never with a sore shoulder. */
const BEHIND_NECK = /behind (the )?neck|neck press/;
/** A push-up with a plank or a row built in: two exercises in one name, and not a lift to put a bar on. */
const HYBRID = /\b(to|into)\b.*\b(plank|row|twist|rotation|jump|crunch|knee|front raise)\b|\bplank\b/;

const TRAINABLE = new Set<MuscleGroup>(MUSCLE_GROUPS.filter((m) => m !== 'full body' && m !== 'other'));

// ---------------------------------------------------------------------------
// Plans: what a day is for

/**
 * One exercise a day is written to take. `where` is the part of a muscle, as `unit:region`, or
 * `unit:*` for any part of it; parts joined by `|` are tried in turn ("the long head, else any").
 * `patterns` are the movements wanted there, tried first. `again` lets the movement repeat (a
 * second lateral raise), in other equipment where there is some. `main` takes the part's heavy
 * compound lift first.
 */
interface Slot {
  where: string;
  patterns?: readonly string[];
  again?: boolean;
  main?: boolean;
}

interface Plan {
  /** How many exercises the day is written for. */
  count: number;
  /** In the order they are taken: a smaller routine keeps the first of them. */
  slots: readonly Slot[];
  /** Working sets for the day's muscles together, in place of the window each muscle would get. */
  window?: [number, number];
  /** Sets are shared between the three heads of the shoulder: side at least as many as rear, rear at least as many as a front raise. */
  heads?: boolean;
}

const SHOULDER_COMPLEX: readonly MuscleGroup[] = ['shoulders', 'rear delts'];

const PLANS: Readonly<Record<string, Plan>> = {
  // 3D shoulders: one heavy vertical press (it covers the front delts), then the side delts, which
  // make them look wide and get the most, then the rear delts, and a front raise only when there is room.
  Shoulders: {
    count: 6,
    window: [9, 18],
    heads: true,
    slots: [
      { where: 'shoulders:front', patterns: ['press-vertical'], main: true },
      { where: 'shoulders:side', patterns: ['lateral-raise'] },
      { where: 'shoulders:rear', patterns: ['rear-fly'] },
      { where: 'shoulders:side', patterns: ['lateral-raise'], again: true },
      { where: 'shoulders:rear', patterns: ['face-pull'] },
      { where: 'shoulders:*', patterns: ['front-raise', 'upright-row'] },
    ],
  },
  Push: {
    count: 6,
    slots: [
      { where: 'chest:mid', main: true },
      { where: 'shoulders:front', patterns: ['press-vertical'], main: true },
      { where: 'shoulders:side', patterns: ['lateral-raise'] },
      { where: 'triceps:long|triceps:*' },
      { where: 'chest:upper', main: true },
      { where: 'triceps:lateral|triceps:compound|triceps:*' },
    ],
  },
  Pull: {
    count: 6,
    slots: [
      { where: 'back:vertical', main: true },
      { where: 'back:horizontal', main: true },
      { where: 'biceps:long|biceps:*' },
      { where: 'shoulders:rear' },
      { where: 'biceps:short|biceps:brachialis|biceps:*' },
      { where: 'back:traps' },
    ],
  },
  Legs: {
    count: 6,
    slots: [
      { where: 'quads:bilateral', main: true },
      { where: 'hamstrings:hinge', main: true },
      { where: 'calves:*' },
      { where: 'quads:*', patterns: ['lunge', 'leg-extension'] },
      { where: 'hamstrings:flexion' },
      { where: 'glutes:*' },
    ],
  },
  Lower: {
    count: 6,
    slots: [
      { where: 'quads:bilateral', main: true },
      { where: 'hamstrings:hinge', main: true },
      { where: 'glutes:*' },
      { where: 'calves:*' },
      { where: 'quads:*', patterns: ['lunge', 'leg-extension'] },
      { where: 'hamstrings:flexion' },
    ],
  },
  Upper: {
    count: 7,
    slots: [
      { where: 'chest:mid', main: true },
      { where: 'back:vertical', main: true },
      { where: 'back:horizontal', main: true },
      { where: 'shoulders:front', patterns: ['press-vertical'], main: true },
      { where: 'shoulders:side', patterns: ['lateral-raise'] },
      { where: 'biceps:*' },
      { where: 'triceps:*' },
    ],
  },
  'Full body': {
    count: 6,
    slots: [
      { where: 'quads:bilateral', main: true },
      { where: 'hamstrings:hinge', main: true },
      { where: 'chest:mid', main: true },
      { where: 'back:vertical', main: true },
      { where: 'back:horizontal', main: true },
      { where: 'shoulders:front', patterns: ['press-vertical'], main: true },
    ],
  },
};
/** The plans a typed request for the muscles of a named group takes: "push" is the push day. */
const TYPED_PLANS: ReadonlySet<string> = new Set(['Push', 'Pull', 'Legs', 'Upper', 'Lower']);

/** A 32-bit hash of a string (FNV-1a). */
function idHash(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Two 32-bit numbers mixed to one, well spread. */
function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x7f4a7c15, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A heavy compound lift: a movement that loads several joints and takes a low rep range. A library
 * exercise carries no flag worth trusting (a diagram's dumbbell bench press is not marked compound),
 * so for one the movement decides, as long as there is a weight to put on it.
 */
function isHeavy(i: Info): boolean {
  return PRIMARY_PATTERNS.has(i.pattern) && !ISOLATION_PATTERNS.has(i.pattern) && (i.c.isCompound || (i.c.origin !== 'own' && i.c.equipment !== 'bodyweight'));
}

function inPart(info: Info, where: string): boolean {
  const r = info.region;
  if (r === null) return false;
  return where.endsWith(':*') ? r.startsWith(where.slice(0, -1)) : r === where;
}

// ---------------------------------------------------------------------------
// Small helpers

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function positiveOr(n: unknown, fallback: number): number {
  return finite(n) && n > 0 ? n : fallback;
}

function byId(a: Candidate, b: Candidate): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "a", "a or b", "a, b or c". */
function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-28" as "28 Sep". Read from the key itself, so no timezone can move it. */
function fmtDay(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

function plainName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function setsPhrase(n: number): string {
  return `${n} ${n === 1 ? 'set' : 'sets'}`;
}

/** Muscle groups that take a plural verb: "rear delts get", "chest gets". */
const PLURAL_MUSCLES: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['shoulders', 'rear delts', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'biceps', 'triceps', 'forearms', 'lats', 'traps', 'abs']);

// ---------------------------------------------------------------------------
// Niggles

/**
 * How much of a niggle's list applies. A severity of 1 refuses the worst movements only; 2 and 3,
 * and any pain typed in the request, the full list.
 */
type Level = 'worst' | 'full';

const NIGGLE_LINES: Partial<Record<NiggleTag, Record<Level, string>>> = {
  shoulder: {
    worst: 'no upright row, no behind-the-neck lifts, no dips; neutral grips preferred',
    full: 'no upright row, no behind-the-neck or barbell overhead press, no dips; neutral grips preferred',
  },
  'lower back': {
    worst: 'no hinges, good mornings, back extensions or bent-over barbell rows; chest-supported rows and leg press preferred',
    full: 'no hinges, good mornings, bent-over barbell rows or back squats; chest-supported rows, leg press and hack squat preferred',
  },
  knee: {
    worst: 'no jumps, deep, sissy or kneeling squats; leg press, leg curl and hip thrust preferred',
    full: 'no lunges, jumps, deep or sissy squats; leg press, leg curl and hip thrust preferred',
  },
  'hamstring DOMS': { worst: 'no hinges', full: 'no hinges or leg curls' },
};
const NIGGLE_LABELS: Partial<Record<NiggleTag, string>> = {
  shoulder: 'Shoulder niggle',
  'lower back': 'Lower back niggle',
  knee: 'Knee niggle',
  'hamstring DOMS': 'Hamstring DOMS',
};
/** The body part as a typed "my knee is sore" says it. */
const SORE_LABELS: Partial<Record<NiggleTag, string>> = {
  shoulder: 'Sore shoulder',
  'lower back': 'Sore lower back',
  knee: 'Sore knee',
  'hamstring DOMS': 'Sore hamstring',
};
const NIGGLE_ORDER: NiggleTag[] = ['shoulder', 'lower back', 'knee', 'hamstring DOMS'];

/** Whether a niggle, at this level, rules the exercise out of a routine. */
function blockedBy(tag: NiggleTag, level: Level, info: Info): boolean {
  const name = plainName(info.c.name);
  const eq = info.c.equipment;
  const full = level === 'full';
  switch (tag) {
    case 'shoulder':
      return (
        info.pattern === 'upright-row' ||
        info.pattern === 'dip' ||
        BEHIND_NECK.test(name) ||
        (full && info.pattern === 'press-vertical' && eq === 'barbell' && !/landmine|jammer/.test(name))
      );
    case 'lower back':
      return (
        info.pattern === 'hinge' ||
        info.pattern === 'back-extension' ||
        (info.pattern === 'row' && (eq === 'barbell' || /bent over/.test(name)) && !/supported|incline|lying|seal/.test(name)) ||
        // A bar held behind the legs: a deadlift in all but name.
        (info.pattern === 'leg-press' && eq === 'barbell') ||
        (full && info.pattern === 'squat' && eq === 'barbell' && !/front/.test(name))
      );
    case 'knee':
      return (
        /\b(deep|sissy|pistol|atg|ass to grass)\b/.test(name) ||
        (info.pattern === 'squat' && /\bkneeling\b/.test(name)) ||
        (full && info.pattern === 'lunge')
      );
    case 'hamstring DOMS':
      return info.pattern === 'hinge' || (full && info.pattern === 'leg-curl');
    default:
      return false;
  }
}

/** A niggle's preferences, as a factor on how likely an exercise is to be drawn. */
const PREFERRED = 3;
function preference(tags: ReadonlySet<NiggleTag>, info: Info): number {
  const name = plainName(info.c.name);
  let f = 1;
  if (tags.has('shoulder') && info.pattern === 'press-vertical' && /neutral|palms in|palm in|hammer grip|landmine/.test(name)) f *= PREFERRED;
  if (tags.has('lower back') && ((info.pattern === 'row' && /supported|incline|machine|iso lateral|seal|lying/.test(name)) || info.pattern === 'leg-press')) f *= PREFERRED;
  if (tags.has('knee') && (info.pattern === 'leg-press' || info.pattern === 'leg-curl' || info.pattern === 'hip-thrust')) f *= PREFERRED;
  return f;
}

// ---------------------------------------------------------------------------
// The pool

interface Info {
  c: Candidate;
  pattern: string;
  region: string | null;
}

interface Chosen {
  info: Info;
  /** The movement was already in the routine. */
  repeat: boolean;
  /** A plan asked for it: the second lateral raise, the second exercise for a part asked for. */
  planned: boolean;
  /** The library's cap kept a movement out that was still on the shelf, when this repeat was taken. */
  capped: boolean;
  /** Lines about a stalled lift this pick stands in for. */
  notes: string[];
}

/** Candidates that may be in a routine at all, in one canonical order, and those a movement named in the request took out. */
function eligibleInfos(candidates: readonly Candidate[], request: RoutineRequest): { all: Info[]; kept: Info[]; leftOut: Info[] } {
  const equipment = request.equipment?.length ? new Set<Equipment>(request.equipment) : null;
  const exclude = new Set<MuscleGroup>(request.exclude ?? []);
  const patterns = new Set<string>(request.excludePatterns ?? []);
  const seen = new Set<string>();
  const all: Info[] = [];
  const kept: Info[] = [];
  const leftOut: Info[] = [];
  for (const c of [...candidates].sort(byId)) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === 'carry' || c.kind === 'timed') continue;
    if (!TRAINABLE.has(c.muscleGroup) || exclude.has(c.muscleGroup)) continue;
    // An exercise with no equipment recorded counts as 'other', so "no barbell" keeps it.
    if (equipment && !equipment.has(c.equipment ?? 'other')) continue;
    if (c.origin !== 'own' && c.level === 'expert') continue;
    const pattern = movementPattern(c.name, c.muscleGroup);
    if (NON_ROUTINE_PATTERNS.has(pattern)) continue;
    const info: Info = { c, pattern, region: regionOf(c.name, c.muscleGroup) };
    all.push(info);
    if (patterns.has(pattern)) leftOut.push(info);
    else kept.push(info);
  }
  return { all, kept, leftOut };
}

// ---------------------------------------------------------------------------
// Days

interface DaySpec {
  name: string;
  /** The muscles, before the exclusions are taken out. */
  muscles: MuscleGroup[];
  kind: 'typed' | 'split' | 'spread';
  count: number;
  /** The muscles the owner named, for a typed request. */
  asked?: MuscleGroup[];
  /** What the day is written to hold, when it is a day with a name. */
  plan?: Plan;
}

const sameSet = (a: readonly MuscleGroup[], b: readonly MuscleGroup[]): boolean => a.length === b.length && a.every((m) => b.includes(m));

/** A routine's name for the muscles it is for: 'Push', 'Shoulders and rear delts'. */
export function routineName(muscles: readonly MuscleGroup[]): string {
  const macros: [string, readonly MuscleGroup[]][] = [
    ['Push', MACRO_MUSCLES.push],
    ['Pull', MACRO_MUSCLES.pull],
    ['Legs', MACRO_MUSCLES.legs],
    ['Upper', MACRO_MUSCLES.upper],
    ['Lower', MACRO_MUSCLES.lower],
    ['Arms', MACRO_MUSCLES.arms],
    ['Core', MACRO_MUSCLES.core],
  ];
  for (const [name, set] of macros) if (sameSet(muscles, set)) return name;
  return capitalise(joinList(muscles));
}

function clampCount(n: number | undefined, fallback: number): number {
  return finite(n) && Math.floor(n) >= 1 ? Math.min(MAX_COUNT, Math.floor(n)) : fallback;
}

/** Whether a request names the shoulders and nothing outside their three heads. */
function isShoulderRequest(focus: readonly MuscleGroup[]): boolean {
  return focus.includes('shoulders') && focus.every((m) => SHOULDER_COMPLEX.includes(m));
}

function planDays(request: RoutineRequest): DaySpec[] {
  const exclude = new Set(request.exclude ?? []);
  const keep = (muscles: readonly MuscleGroup[]) => muscles.filter((m) => !exclude.has(m));

  if (request.split) {
    return DAYS[request.split]
      .map((d): DaySpec => {
        const plan = PLANS[d.name];
        return {
          name: d.name,
          muscles: keep(d.muscles),
          kind: request.split === 'full-body' ? 'spread' : 'split',
          count: clampCount(request.count, plan?.count ?? DEFAULT_SPLIT_DAY_COUNT),
          ...(plan ? { plan } : {}),
        };
      })
      .filter((d) => d.muscles.length > 0);
  }
  const focus = [...new Set(request.focus ?? [])].filter((m) => TRAINABLE.has(m) && !exclude.has(m));
  if (focus.length > 0) {
    const name = routineName(focus);
    const plan = isShoulderRequest(focus) ? PLANS.Shoulders : TYPED_PLANS.has(name) ? PLANS[name] : undefined;
    return [{ name, muscles: focus, kind: 'typed', count: clampCount(request.count, plan?.count ?? DEFAULT_ROUTINE_COUNT), asked: focus, ...(plan ? { plan } : {}) }];
  }
  const spread = keep(FULL_BODY_MUSCLES);
  return spread.length > 0 ? [{ name: 'Full body', muscles: spread, kind: 'spread', count: clampCount(request.count, DEFAULT_ROUTINE_COUNT) }] : [];
}

// ---------------------------------------------------------------------------
// What one build shares between its days

interface ActiveNiggle {
  level: Level;
  /** The day the latest session that logged it was started; null when it was only typed. */
  date: string | null;
  /** Typed in the request: said in the owner's words, and always the full list. */
  typed: boolean;
}

interface Shared {
  input: RoutineInput;
  request: RoutineRequest;
  /** Every exercise that may be in a routine, less what the request left out by movement. */
  infos: Info[];
  /** What the request left out by movement, which `infos` does not hold. */
  leftOut: Info[];
  /** `infos` and `leftOut` together, in the one canonical order. */
  infosAll: Info[];
  restDefaults: RestDefaults;
  pace: number;
  paceBasis: PaceBasis | undefined;
  niggles: Map<NiggleTag, ActiveNiggle>;
  stalled: Map<string, number>;
  ownRx: Map<string, { sets: number; repMin: number; repMax: number }>;
  /** Weekly sets from the owner's routines; null when they have none to read. */
  week: Partial<Record<MuscleGroup, number>> | null;
}

function positiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

function shared(input: RoutineInput, request: RoutineRequest): Shared {
  const settings = input.settings;
  const restDefaults: RestDefaults = {
    restCompoundSec: positiveOr(settings?.restCompoundSec, DEFAULT_SETTINGS.restCompoundSec),
    restIsolationSec: positiveOr(settings?.restIsolationSec, DEFAULT_SETTINGS.restIsolationSec),
    restCarrySec: positiveOr(settings?.restCarrySec, DEFAULT_SETTINGS.restCarrySec),
  };
  const context = input.context;

  // The worst severity and the latest day a body part was logged on.
  const logged = new Map<NiggleTag, { severity: number; date: string }>();
  for (const n of context?.niggles ?? []) {
    const had = logged.get(n.tag);
    logged.set(n.tag, { severity: Math.max(had?.severity ?? 0, n.severity), date: had !== undefined && had.date > n.date ? had.date : n.date });
  }
  const typedTags = new Set<NiggleTag>(request.typedNiggles ?? []);
  const niggles = new Map<NiggleTag, ActiveNiggle>();
  for (const tag of NIGGLE_ORDER) {
    const was = logged.get(tag);
    const typed = typedTags.has(tag);
    if (was === undefined && !typed) continue;
    niggles.set(tag, { level: typed || (was !== undefined && was.severity >= 2) ? 'full' : 'worst', date: was?.date ?? null, typed });
  }

  const stalled = new Map<string, number>();
  for (const s of context?.stalled ?? []) stalled.set(s.exerciseId, Math.max(stalled.get(s.exerciseId) ?? 0, s.sessions));

  // The first routine in the owner's week that has an exercise says what they do it for.
  const ownRx = new Map<string, { sets: number; repMin: number; repMax: number }>();
  for (const r of context?.routines ?? []) {
    for (const e of r.exercises) {
      if (ownRx.has(e.exerciseId)) continue;
      if (positiveInt(e.targetSets) && positiveInt(e.repMin) && positiveInt(e.repMax) && e.repMax >= e.repMin) {
        ownRx.set(e.exerciseId, { sets: e.targetSets, repMin: e.repMin, repMax: e.repMax });
      }
    }
  }

  const eligible = eligibleInfos(input.candidates ?? [], request);
  return {
    input,
    request,
    infos: eligible.kept,
    leftOut: eligible.leftOut,
    infosAll: eligible.all,
    restDefaults,
    pace: positiveOr(input.pace, 1),
    paceBasis: input.paceBasis,
    niggles,
    stalled,
    ownRx,
    week: context && context.routines.length > 0 ? weeklySetsFromRoutines(context.routines) : null,
  };
}

// ---------------------------------------------------------------------------
// One day

function tierOrder(t: Tier): number {
  return t === 'primary' ? 0 : t === 'secondary' ? 1 : 2;
}

function bigRank(m: MuscleGroup): number {
  const i = BIG_FIRST.indexOf(m);
  return i === -1 ? BIG_FIRST.length : i;
}

function fmtRecency(days: number | undefined): string {
  if (!finite(days)) return 'not trained yet';
  if (days <= 0) return 'trained today';
  if (days === 1) return 'last trained yesterday';
  return `last trained ${days} days ago`;
}

/** The shoulder's three heads, in the order a routine for them lists the finishers. */
function headRank(region: string | null): number {
  return region === 'shoulders:side' ? 0 : region === 'shoulders:rear' ? 1 : 2;
}

/** "About 47 min", and where the pace behind it came from. */
function aboutLine(estimate: number, basis: PaceBasis | undefined, asked: number | undefined): string {
  let line = `About ${estimate} min`;
  if (basis === 'measured') line += ' at your pace';
  else if (basis === 'held-slow') line += ' (the model at 1.6 times, the most it allows; your sessions run slower)';
  else if (basis === 'held-fast') line += ' (the model at 0.6 times, the least it allows; your sessions run faster)';
  if (asked !== undefined && estimate !== asked) line += `${basis === 'measured' ? ',' : ''} for the ${asked} min asked`;
  return line;
}

function buildDay(sh: Shared, day: DaySpec, daySeed: number, probe = false): BuiltRoutine {
  const { input, request } = sh;
  const rng = mulberry32(daySeed);
  const excluded = new Set(request.exclude ?? []);
  const dayMuscles = day.muscles.filter((m) => !excluded.has(m));
  const plan = day.plan;
  /** What the day is asked to hold: the part of a muscle the request prefers first, then the plan's own. */
  const slots: Slot[] = [];
  if (day.kind === 'typed') {
    for (const region of request.preferRegions ?? []) {
      if (dayMuscles.some((m) => (MUSCLE_REGIONS[m] ?? []).includes(region))) slots.push({ where: region, main: true }, { where: region, again: true });
    }
  }
  slots.push(...(plan?.slots ?? []));
  let n = day.count;
  const lines: string[] = [];

  // --- The pool for this day: the exercises that reach its muscles, less what a niggle rules out.
  // The rear delt belongs to the shoulders too: a request for shoulders alone takes the owner's own
  // rear-delt exercises for the rear of the shoulder.
  const admitted = (info: Info): boolean =>
    dayMuscles.includes(info.c.muscleGroup) || (info.c.muscleGroup === 'rear delts' && info.region === 'shoulders:rear' && dayMuscles.includes('shoulders'));
  const dayInfos = sh.infos.filter(admitted);
  const leftOutInfos = sh.leftOut.filter(admitted);
  const removedBy = new Map<NiggleTag, number>();
  const pool: Info[] = [];
  for (const info of dayInfos) {
    const tag = NIGGLE_ORDER.find((t) => {
      const g = sh.niggles.get(t);
      return g !== undefined && blockedBy(t, g.level, info);
    });
    if (tag) {
      removedBy.set(tag, (removedBy.get(tag) ?? 0) + 1);
      continue;
    }
    pool.push(info);
  }
  const niggleTags = new Set<NiggleTag>(sh.niggles.keys());
  const byRegion = new Map<string, Info[]>();
  for (const info of pool) {
    if (!info.region) continue;
    const list = byRegion.get(info.region);
    if (list) list.push(info);
    else byRegion.set(info.region, [info]);
  }

  // --- What each muscle is worth in a share of the day's exercises.
  const jitter = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0.9 + 0.2 * rng()]));
  const reference = (m: MuscleGroup): number => {
    const t = input.weeklyTargets?.[m];
    return finite(t) && t > 0 ? t : DEFAULT_WEEKLY_REFERENCE;
  };
  /** A muscle the owner's routines leave short is worth more, up to double. */
  const need = (m: MuscleGroup): number => {
    if (!sh.week) return 1;
    const ref = reference(m);
    return 1 + Math.max(0, ref - (sh.week[m] ?? 0)) / ref;
  };
  const share = (m: MuscleGroup): number => {
    const base = day.kind === 'typed' ? (MINOR.has(m) ? 0.25 : 1) : Math.sqrt(SIZE[m] ?? 1) * need(m);
    return base * jitter.get(m)!;
  };
  const ranked = [...dayMuscles].sort((a, b) => share(b) - share(a) || bigRank(a) - bigRank(b));

  // --- The parts of each muscle it takes. Where two muscles reach one part, one of them has it.
  const regionOwner = (region: string): MuscleGroup | undefined =>
    (CLAIM_PRIORITY[region] ?? dayMuscles).find((m) => dayMuscles.includes(m) && (MUSCLE_REGIONS[m] ?? []).includes(region));
  const claims = new Map<MuscleGroup, string[]>(dayMuscles.map((m) => [m, (MUSCLE_REGIONS[m] ?? []).filter((r) => regionOwner(r) === m)]));
  /** The day's muscle an exercise counts towards: its own, or for a rear-delt exercise taken for the shoulders, the one that has the rear. */
  const ownerOf = (i: Info): MuscleGroup => (dayMuscles.includes(i.c.muscleGroup) ? i.c.muscleGroup : ((i.region ? regionOwner(i.region) : undefined) ?? dayMuscles[0] ?? i.c.muscleGroup));

  // --- Choosing.
  const used = new Set<string>();
  const usedPatterns = new Set<string>();
  /** Stalled lifts that have given way to a variation: out for the rest of this routine. */
  const displaced = new Set<string>();
  const picks: Chosen[] = [];
  const counts = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0]));
  const pointer = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0]));
  let newCount = 0;

  const allowed = (i: Info, repeat: boolean): boolean =>
    !used.has(i.c.id) &&
    !displaced.has(i.c.id) &&
    (repeat || !usedPatterns.has(i.pattern)) &&
    (i.c.origin === 'own' || newCount < MAX_NEW_EXERCISES);

  const drawWeight = (i: Info): number => {
    let w = weightOf(i.c, false, true) * preference(niggleTags, i);
    // A name no rule can place is the last resort within its muscle.
    if (i.pattern === i.c.muscleGroup) w *= 0.2;
    if (i.c.origin !== 'own' && SPECIALTY.test(plainName(i.c.name))) w *= SPECIALTY_FACTOR;
    // A push-up is a press with nothing on the bar: drawn for a part of the chest or shoulder only when there is little else.
    if (i.c.origin !== 'own' && i.c.equipment === 'bodyweight' && i.pattern.startsWith('press-')) w *= UNLOADED_FACTOR;
    return w;
  };

  /**
   * One of `list`, seeded; the owner's own exercises first, and the library only where they have none.
   * Each exercise races with a time drawn from its own seeded number (the day's seed, the draw it is
   * and the exercise's id), shorter for a heavier weight, and the quickest wins: the odds are the
   * weights' share, and taking an exercise out of the list changes the result only when it was the
   * winner. That is what lets a rule that rules something out say it changed a choice only if it did.
   */
  let draws = 0;
  const choose = (list: Info[]): Info => {
    const own = list.filter((i) => i.c.origin === 'own');
    const from = own.length > 0 ? own : list;
    const draw = draws++;
    let best = from[0]!;
    let bestTime = Infinity;
    for (const i of from) {
      const u = (mix(mix(daySeed, draw), idHash(i.c.id)) + 0.5) / 4294967296;
      const time = -Math.log(u) / drawWeight(i);
      if (time < bestTime) {
        best = i;
        bestTime = time;
      }
    }
    return best;
  };

  /** Prefers a different kind of equipment from `than`: a variation is another angle on the lift, not the same lift again. */
  const chooseOther = (list: Info[], than: Info): Info => {
    const other = list.filter((i) => i.c.equipment !== than.c.equipment);
    return choose(other.length > 0 ? other : list);
  };

  /** A lift a bar or a stack can be put on, which is what a stalled lift's replacement has to be; a bodyweight lift may give way to another. */
  const loadable = (i: Info, than: Info): boolean => {
    const name = plainName(i.c.name);
    if (BEHIND_NECK.test(name)) return false;
    if (i.c.origin !== 'own' && (SPECIALTY.test(name) || HYBRID.test(name))) return false;
    return than.c.equipment === 'bodyweight' || i.c.equipment !== 'bodyweight';
  };

  /**
   * A variation of a stalled lift: another lift of the same movement for the same part of the
   * muscle, the owner's own before the library, that can be loaded. Failing that, another part of
   * the same muscle that is the same kind of lift (a heavy press for a heavy press).
   */
  const variationOf = (stalled: Info): Info | null => {
    const unit = stalled.region ? stalled.region.split(':')[0]! : null;
    const samePart = (i: Info) => i.pattern === stalled.pattern && i.c.muscleGroup === stalled.c.muscleGroup && (stalled.region ? i.region === stalled.region : true);
    const otherPart = (i: Info) =>
      unit !== null &&
      i.region !== null &&
      i.region.startsWith(`${unit}:`) &&
      i.c.isCompound === stalled.c.isCompound &&
      PRIMARY_PATTERNS.has(i.pattern) === PRIMARY_PATTERNS.has(stalled.pattern);
    const ok = (i: Info) => i.c.id !== stalled.c.id && !sh.stalled.has(i.c.id) && allowed(i, false) && loadable(i, stalled);
    for (const near of [samePart, otherPart]) {
      for (const fromLibrary of [false, true]) {
        const list = pool.filter((i) => (i.c.origin !== 'own') === fromLibrary && ok(i) && near(i));
        if (list.length > 0) return chooseOther(list, stalled);
      }
    }
    return null;
  };

  /**
   * A part of a muscle opens with its main lift where it has one: the front of the shoulder with a
   * press before a front raise, the vertical pull with a pulldown before a pullover.
   */
  const mainFirst = (list: Info[]): Info[] => {
    const main = list.filter(isHeavy);
    return main.length > 0 ? main : list;
  };

  /**
   * One of a part of a muscle's candidates. A stalled lift among them gives way to a variation of
   * it, and a line says what took its place; with no variation the lift is kept and a line says so.
   */
  const pickFor = (candidates: Info[], byPart: boolean): { info: Info; notes: string[] } => {
    const list = byPart ? mainFirst(candidates) : candidates;
    const stalledIn = list.filter((i) => sh.stalled.has(i.c.id));
    if (stalledIn.length === 0) return { info: choose(list), notes: [] };
    // The one that would most likely have been drawn stands for them all.
    const lead = stalledIn.reduce((a, b) => (drawWeight(b) > drawWeight(a) ? b : a));
    const swap = variationOf(lead);
    if (swap === null) {
      const info = choose(list);
      const kept = stalledIn.find((s) => s.c.id === info.c.id);
      return { info, notes: kept ? [`${kept.c.name} stalled for ${sh.stalled.get(kept.c.id)} sessions: no variation in your exercises or the library, kept`] : [] };
    }
    for (const s of stalledIn) displaced.add(s.c.id);
    return { info: swap, notes: stalledIn.map((s) => `${s.c.name} stalled for ${sh.stalled.get(s.c.id)} sessions: ${swap.c.name} in its place`) };
  };

  const commit = (info: Info, owner: MuscleGroup, how: { notes?: string[]; planned?: boolean } = {}): void => {
    const repeat = usedPatterns.has(info.pattern);
    // Whether a movement the cap on library exercises kept out was still on the shelf.
    const capped =
      repeat && newCount >= MAX_NEW_EXERCISES && pool.some((i) => ownerOf(i) === owner && i.c.origin !== 'own' && !used.has(i.c.id) && !displaced.has(i.c.id) && !usedPatterns.has(i.pattern));
    picks.push({ info, repeat, planned: how.planned === true, capped, notes: how.notes ?? [] });
    used.add(info.c.id);
    usedPatterns.add(info.pattern);
    if (info.c.origin !== 'own') newCount++;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  };

  /** The muscle with the biggest share left: each exercise a muscle has taken divides what it is still owed. */
  const nextMuscle = (skip: ReadonlySet<MuscleGroup>): MuscleGroup | null => {
    let best: MuscleGroup | null = null;
    let bestValue = -1;
    for (const m of ranked) {
      if (skip.has(m)) continue;
      const value = share(m) / ((counts.get(m) ?? 0) + 1);
      if (value > bestValue + 1e-12) {
        best = m;
        bestValue = value;
      }
    }
    return best;
  };

  /** The muscles that would take at least one of the day's exercises, were they shared out by weight alone. */
  const sharers = ((): Set<MuscleGroup> => {
    const taken = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0]));
    for (let k = 0; k < n; k++) {
      let best: MuscleGroup | null = null;
      let bestValue = -1;
      for (const m of ranked) {
        const value = share(m) / ((taken.get(m) ?? 0) + 1);
        if (value > bestValue + 1e-12) {
          best = m;
          bestValue = value;
        }
      }
      if (best !== null) taken.set(best, (taken.get(best) ?? 0) + 1);
    }
    return new Set(dayMuscles.filter((m) => (taken.get(m) ?? 0) > 0));
  })();

  /**
   * First, what the day is written to hold, in order. A slot takes the movement it asks for, or
   * any new movement for its part when there is none; a slot nothing can fill is left to the
   * phases after it.
   */
  const fillSlots = (): void => {
    for (const slot of slots) {
      if (picks.length >= n) return;
      const again = slot.again === true;
      let list: Info[] = [];
      let where = '';
      for (where of slot.where.split('|')) {
        const part = pool.filter((i) => inPart(i, where));
        if (slot.patterns) list = part.filter((i) => slot.patterns!.includes(i.pattern) && allowed(i, again));
        if (list.length === 0) list = part.filter((i) => allowed(i, again));
        if (list.length > 0) break;
      }
      if (list.length === 0) continue;
      if (again) {
        // A second exercise for a part is another kind of equipment where there is one.
        const before = picks.map((p) => p.info).filter((i) => inPart(i, where));
        const fresh = list.filter((i) => !before.some((b) => b.c.equipment === i.c.equipment));
        if (fresh.length > 0) list = fresh;
      }
      const { info, notes } = pickFor(list, slot.main === true);
      commit(info, ownerOf(info), { notes, planned: again });
    }
  };

  /**
   * Then every part of every muscle that has a share, once, before any muscle takes a second
   * exercise for a part it has. A muscle whose share is too small for one exercise (the forearms in
   * a request for arms) waits for the phases that follow.
   */
  const cover = (): void => {
    const rounds = Math.max(0, ...[...claims.values()].map((r) => r.length));
    for (let k = 0; k < rounds; k++) {
      for (const m of ranked) {
        if (picks.length >= n) return;
        if (!sharers.has(m)) continue;
        const region = claims.get(m)?.[k];
        if (region === undefined) continue;
        // A part a slot has already taken is covered.
        if (picks.some((p) => p.info.region === region)) continue;
        const list = (byRegion.get(region) ?? []).filter((i) => allowed(i, false));
        if (list.length > 0) {
          const { info, notes } = pickFor(list, true);
          commit(info, m, { notes });
        }
      }
    }
  };

  /**
   * Phase 1 shares what is left between the muscles by their weight, one new movement at a time, the
   * parts of a muscle in turn. Phase 2 takes any movement not yet in the routine from a muscle that
   * has run out of parts. Phase 3 repeats a movement, and only when nothing else is left for the muscle.
   */
  const fill = (phase: 1 | 2 | 3): void => {
    const skip = new Set<MuscleGroup>();
    while (picks.length < n) {
      const m = nextMuscle(skip);
      if (m === null) return;
      const repeat = phase === 3;
      let list: Info[] = [];
      const regions = claims.get(m) ?? [];
      if (phase === 1 && regions.length > 0) {
        const start = pointer.get(m) ?? 0;
        for (let a = 0; a < regions.length && list.length === 0; a++) {
          list = (byRegion.get(regions[(start + a) % regions.length]!) ?? []).filter((i) => allowed(i, false));
          if (list.length > 0) pointer.set(m, (start + a + 1) % regions.length);
        }
      } else {
        list = pool.filter((i) => ownerOf(i) === m && allowed(i, repeat));
      }
      if (list.length === 0) {
        skip.add(m);
        continue;
      }
      const { info, notes } = pickFor(list, phase === 1 && regions.length > 0);
      commit(info, m, { notes });
    }
  };
  fillSlots();
  cover();
  fill(1);
  fill(2);
  fill(3);

  // --- Time, the rest of the arithmetic: minutes of rows.
  const restOf = (c: Candidate): number =>
    Math.max(0, restSecondsFor(null, { defaultRestSec: finite(c.defaultRestSec) ? c.defaultRestSec : 0, kind: c.kind, isCompound: c.isCompound }, sh.restDefaults));

  // --- Roles, sets and reps, in the order a coach would take them.
  interface Work {
    pick: Chosen;
    tier: Tier;
    order: number;
    sets: number;
    repMin: number;
    repMax: number;
    own: boolean;
  }
  interface Assembled {
    works: Work[];
    setsLines: string[];
    /** The sets each head of the shoulder has, for a day written by heads. */
    heads: { side: number; rear: number; front: number; press: number } | null;
  }
  /** The muscle a row's sets are held to a window as: a rear-delt exercise taken for the shoulders is the shoulders'. */
  const windowKey = (m: MuscleGroup): MuscleGroup => (plan?.heads === true && SHOULDER_COMPLEX.includes(m)) || (m === 'rear delts' && !dayMuscles.includes('rear delts') && dayMuscles.includes('shoulders')) ? 'shoulders' : m;

  const assemble = (list: readonly Chosen[]): Assembled => {
    type Draft = { pick: Chosen; tier: Tier; order: number };
    const drafts: Draft[] = list.map((pick, order) => ({
      pick,
      order,
      tier: ISOLATION_PATTERNS.has(pick.info.pattern) ? 'isolation' : isHeavy(pick.info) ? 'primary' : pick.info.c.isCompound ? 'secondary' : 'isolation',
    }));
    // The parts of a muscle in the order a routine takes them (long head before lateral head), where the day does not say.
    const partRank = (d: Draft): number => {
      const region = d.pick.info.region;
      if (region !== null && day.kind === 'typed' && (request.preferRegions ?? []).includes(region)) return -1;
      const parts = MUSCLE_REGIONS[d.pick.info.c.muscleGroup] ?? [];
      const at = region === null ? -1 : parts.indexOf(region);
      return at === -1 ? parts.length : at;
    };
    const byBigness = (a: Draft, b: Draft) =>
      bigRank(windowKey(a.pick.info.c.muscleGroup)) - bigRank(windowKey(b.pick.info.c.muscleGroup)) ||
      (plan?.heads ? headRank(a.pick.info.region) - headRank(b.pick.info.region) : 0) ||
      (a.pick.info.c.muscleGroup === b.pick.info.c.muscleGroup ? partRank(a) - partRank(b) : 0) ||
      a.order - b.order;
    // One or two main lifts, a different muscle each where there is one.
    const primaryRoom = day.count >= 5 ? 2 : 1;
    const candidatesForPrimary = drafts.filter((d) => d.tier === 'primary').sort(byBigness);
    const takenFor = new Set<MuscleGroup>();
    const primaries: Draft[] = [];
    for (const d of candidatesForPrimary) {
      if (primaries.length < primaryRoom && !takenFor.has(d.pick.info.c.muscleGroup)) {
        primaries.push(d);
        takenFor.add(d.pick.info.c.muscleGroup);
      }
    }
    for (const d of candidatesForPrimary) if (primaries.length < primaryRoom && !primaries.includes(d)) primaries.push(d);
    for (const d of drafts) if (d.tier === 'primary' && !primaries.includes(d)) d.tier = 'secondary';
    const ordered = [...drafts].sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || byBigness(a, b));

    // Sets and reps by role; the owner's own win.
    const works: Work[] = ordered.map((d) => {
      const { info } = d.pick;
      const mine = sh.ownRx.get(info.c.id);
      if (mine && info.c.origin === 'own') return { ...d, ...mine, own: true };
      let rx: { sets: number; repMin: number; repMax: number };
      if (info.c.muscleGroup === 'calves' || info.pattern === 'calf-raise') rx = { sets: 4, repMin: 10, repMax: 15 };
      else if (info.c.muscleGroup === 'abs') rx = { sets: 3, repMin: 10, repMax: 20 };
      else if (d.tier === 'primary') rx = { sets: primaries[0] === d ? 4 : 3, repMin: 6, repMax: 10 };
      else if (RAISE_PATTERNS.has(info.pattern)) rx = { sets: 3, repMin: 12, repMax: 20 };
      else if (d.tier === 'secondary') rx = { sets: 3, repMin: 8, repMax: 12 };
      else rx = { sets: 3, repMin: 10, repMax: 15 };
      return { ...d, ...rx, own: false };
    });

    // Sets per muscle stay sensible: one or two muscles named give each 9 to 15, a day of a split or a spread 4 to 9.
    const narrow = day.kind === 'typed' && (day.asked?.length ?? 0) <= 2;
    const [lo, hi] = plan?.window ?? (narrow ? NAMED_WINDOW : DAY_WINDOW);
    const scope = narrow ? 'a routine for it' : 'a day';
    const keys = [...new Set(works.map((w) => windowKey(w.pick.info.c.muscleGroup)))];
    const rowsOf = (key: MuscleGroup) => works.filter((w) => windowKey(w.pick.info.c.muscleGroup) === key);
    const totalOf = (list: readonly Work[]) => list.reduce((s, w) => s + w.sets, 0);
    const before = new Map<MuscleGroup, number>(keys.map((k) => [k, totalOf(rowsOf(k))]));

    const headSets = (f: (w: Work) => boolean) => totalOf(works.filter(f));
    const isSide = (w: Work) => w.pick.info.region === 'shoulders:side';
    const isRear = (w: Work) => w.pick.info.region === 'shoulders:rear';
    const isFrontRaise = (w: Work) => w.pick.info.region === 'shoulders:front' && w.tier === 'isolation';
    for (const key of keys) {
      const mineRows = rowsOf(key);
      while (totalOf(mineRows) < lo) {
        const row = mineRows.find((w) => !w.own && w.sets < MAX_SETS);
        if (!row) break;
        row.sets++;
      }
      while (totalOf(mineRows) > hi) {
        const row = [...mineRows].reverse().find((w) => !w.own && w.sets > MIN_SETS);
        if (!row) break;
        row.sets--;
      }
    }
    /** What the window did to each muscle, before the heads are shaped. */
    const windowed = new Map<MuscleGroup, number>(keys.map((k) => [k, totalOf(rowsOf(k))]));
    if (plan?.heads) {
      // The side delts are what make the shoulders look wide, and get the most: more sets than the rear
      // delts where the rows can bear it and at least as many where they cannot, and the rear at least
      // as many as a front raise. Take from the lesser before giving to the greater, and never from the owner's own sets.
      const hasSide = works.some(isSide);
      const hasRear = works.some(isRear);
      const hasFront = works.some(isFrontRaise);
      const lowerLast = (f: (w: Work) => boolean) => [...works].reverse().find((w) => f(w) && !w.own && w.sets > MIN_SETS);
      const raiseFirst = (f: (w: Work) => boolean) => works.find((w) => f(w) && !w.own && w.sets < MAX_SETS);
      for (let guard = 0; guard < 30; guard++) {
        const side = headSets(isSide);
        const rear = headSets(isRear);
        const front = headSets(isFrontRaise);
        const room = totalOf(works) < hi;
        let row: Work | undefined;
        let delta = 0;
        if (hasSide && hasRear && side < rear) {
          row = lowerLast(isRear);
          delta = -1;
          if (!row && room) {
            row = raiseFirst(isSide);
            delta = 1;
          }
        } else if (hasRear && hasFront && rear < front) {
          row = lowerLast(isFrontRaise);
          delta = -1;
          if (!row && room) {
            row = raiseFirst(isRear);
            delta = 1;
          }
        } else if (hasSide && hasRear && side === rear) {
          if (rear - 1 >= front) {
            row = lowerLast(isRear);
            delta = -1;
          }
          if (!row && room) {
            row = raiseFirst(isSide);
            delta = 1;
          }
        }
        if (!row) break;
        row.sets += delta;
      }
    }

    const setsLines: string[] = [];
    for (const key of keys) {
      const mineRows = rowsOf(key);
      const was = before.get(key)!;
      // Said only where the window moved the sets; the heads of the shoulder are said in a line of their own.
      if (windowed.get(key) === was) continue;
      const now = totalOf(mineRows);
      if (now === was) continue;
      const kept = mineRows.some((w) => w.own);
      const verb = now > was ? 'raised' : 'cut';
      const move = `${key}: sets ${verb} from ${was} to ${now}`;
      if (now < lo) setsLines.push(`${move}, short of the ${lo} for a muscle in ${scope}${kept ? ' (your own sets kept)' : ` (${MAX_SETS} sets is the most one exercise takes)`}`);
      else if (now > hi) setsLines.push(`${move}, over the ${hi} for a muscle in ${scope}${kept ? ' (your own sets kept)' : ` (${MIN_SETS} sets is the least one exercise takes)`}`);
      else setsLines.push(now > was ? `${move} (at least ${lo} sets for a muscle in ${scope})` : `${move} (at most ${hi} sets for a muscle in ${scope})`);
    }
    const heads = plan?.heads
      ? { side: headSets(isSide), rear: headSets(isRear), front: headSets((w) => w.pick.info.region === 'shoulders:front'), press: headSets((w) => w.pick.info.region === 'shoulders:front' && !isFrontRaise(w)) }
      : null;
    return { works, setsLines, heads };
  };

  const minutesOf = (list: readonly Work[]): number =>
    estimateMinutes(list.map((w) => ({ sets: w.sets, restSec: restOf(w.pick.info.c), candidate: w.pick.info.c })), sh.pace);

  let assembled = assemble(picks);
  let works = assembled.works;

  // --- Time: a length asked for is a target. Finishers go while that lands nearer; a finisher is added when it is short and no count was asked for.
  const dropped: Work[] = [];
  const added: Chosen[] = [];
  const asked = finite(request.minutes) && request.minutes > 0 ? request.minutes : undefined;
  if (asked !== undefined) {
    let current = minutesOf(works);
    if (current > asked) {
      while (works.length > TRIM_FLOOR) {
        // A second exercise for a part of a muscle goes before the only exercise for another part; then the last finisher.
        let victim = -1;
        for (let k = works.length - 1; k >= 0; k--) {
          const w = works[k]!;
          if (w.tier === 'primary') continue;
          const region = w.pick.info.region;
          const double = region !== null && works.some((o) => o !== w && o.pick.info.region === region);
          if (double) {
            victim = k;
            break;
          }
          if (victim === -1) victim = k;
        }
        if (victim === -1) break;
        const after = minutesOf(works.filter((_, k) => k !== victim));
        // Dropping it would land no nearer the ask: the routine stays as it is.
        if (Math.abs(after - asked) >= Math.abs(current - asked)) break;
        dropped.push(...works.splice(victim, 1));
        current = after;
      }
    } else if (current < asked && request.count === undefined) {
      while (picks.length < Math.min(MAX_FILL, MAX_COUNT) && current < asked) {
        const had = picks.length;
        n = had + 1;
        fill(1);
        fill(2);
        fill(3);
        if (picks.length === had) break;
        const next = assemble(picks);
        const m = minutesOf(next.works);
        if (Math.abs(m - asked) >= Math.abs(current - asked)) {
          picks.pop();
          break;
        }
        added.push(picks[picks.length - 1]!);
        assembled = next;
        works = next.works;
        current = m;
      }
    }
  }

  // --- The rows.
  const rows: BuiltRow[] = works.map((w) => {
    const { info } = w.pick;
    const c = info.c;
    const known = baseWeight(c);
    const weightKg = known === null ? null : roundKg(known);
    const regionLabel = info.region ? (REGION_LABELS[info.region] ?? info.region) : null;
    const label = patternLabel(info.pattern);
    // What nothing could place is its muscle and no more; a part's label that already says the movement is not said twice.
    const place = info.pattern === c.muscleGroup ? null : regionLabel ? (regionLabel.includes(label) ? regionLabel : `${regionLabel} (${label})`) : label;
    const parts: string[] = [c.muscleGroup];
    if (place) parts.push(place);
    if (c.origin !== 'own') parts.push('new to you, no weight yet');
    else {
      parts.push(fmtRecency(input.recency?.[c.muscleGroup]));
      parts.push(weightKg === null ? 'no weight yet' : weightKg === 0 ? 'bodyweight, nothing added' : `your working weight ${fmtKg(weightKg)}`);
    }
    const row: BuiltRow = {
      id: c.id,
      name: c.name,
      sets: w.sets,
      repMin: w.repMin,
      repMax: w.repMax,
      weightKg,
      origin: c.origin,
      muscleGroup: c.muscleGroup,
      pattern: info.pattern,
      region: info.region,
      tier: w.tier,
      reason: parts.join(' · '),
    };
    if (c.equipment) row.equipment = c.equipment;
    if (c.catalogueSlug) row.catalogueSlug = c.catalogueSlug;
    if (c.demoSlug) row.demoSlug = c.demoSlug;
    return row;
  });

  // --- Which niggles and which movements left out changed what was built: the same day built again without each.
  const rowKey = (list: readonly { id: string }[]) => list.map((x) => x.id).join('|');
  const built = rowKey(rows);
  const changedBy = new Set<NiggleTag>();
  let leftOutChanged = false;
  if (!probe) {
    for (const tag of NIGGLE_ORDER) {
      const g = sh.niggles.get(tag);
      if (!g) continue;
      // Nothing it rules out or prefers is in this day's exercises: it cannot have changed a choice.
      if (!dayInfos.some((i) => blockedBy(tag, g.level, i) || preference(new Set<NiggleTag>([tag]), i) !== 1)) continue;
      const rest = new Map(sh.niggles);
      rest.delete(tag);
      if (rowKey(buildDay({ ...sh, niggles: rest }, day, daySeed, true).rows) !== built) changedBy.add(tag);
    }
    if (leftOutInfos.length > 0) {
      const again = buildDay({ ...sh, infos: sh.infosAll, leftOut: [] }, day, daySeed, true);
      leftOutChanged = rowKey(again.rows) !== built;
    }
  }

  // --- The lines that say why.
  const present = [...new Set(rows.map((r) => r.muscleGroup))].sort((a, b) => bigRank(a) - bigRank(b));
  const asks = day.asked ?? [];
  // Nothing at all for a muscle, as opposed to nothing a niggle left.
  const unmet = asks.filter((m) => !sh.infos.some((i) => i.c.muscleGroup === m));
  const missingAsked = asks.filter((m) => !present.includes(m) && !unmet.includes(m));
  // What the request narrowed the pool by, in words, for a line that says nothing was found.
  const lack = (): string => {
    const equipment = request.equipment?.length ? 'with the equipment asked for' : '';
    const moves = leftOutInfos.length > 0 ? 'without the movements you left out' : '';
    return [equipment, moves].filter(Boolean).join(' and ') || 'in your exercises or the library';
  };
  if (day.kind === 'typed') {
    const there = asks.filter((m) => present.includes(m));
    lines.push(there.length > 0 ? `Focus: ${joinList(there)}, as asked` : `Asked for ${joinList(asks)}`);
    const byNiggle = missingAsked.filter((m) => dayInfos.some((i) => ownerOf(i) === m) && !pool.some((i) => ownerOf(i) === m));
    const byShare = missingAsked.filter((m) => !byNiggle.includes(m));
    if (byNiggle.length > 0) lines.push(`Nothing for ${joinList(byNiggle)} left after what the niggle rules out`);
    if (byShare.length > 0) lines.push(`Nothing for ${joinList(byShare)} in ${rows.length === 1 ? 'this 1 exercise' : `these ${rows.length} exercises`}`);
  } else if (day.kind === 'split') lines.push(`Focus: ${joinList(dayMuscles.filter((m) => present.includes(m)))} (${day.name.toLowerCase()} day)`);
  else lines.push(`Focus: ${joinList(present)}, no muscle asked for`);

  const inRoutine = new Set(rows.map((r) => r.id));
  const repeats = picks.filter((p) => p.repeat && inRoutine.has(p.info.c.id));
  if (rows.length > 0 && repeats.length === 0) {
    lines.push(`One exercise per movement: ${joinList(rows.map((r) => r.pattern).map(patternLabel))}`);
  }
  for (const p of repeats) {
    const head = `A second ${patternLabel(p.info.pattern)}, ${p.info.c.name}: `;
    if (p.planned) lines.push(`${head}${REGION_LABELS[p.info.region ?? ''] ? `two exercises for the ${REGION_LABELS[p.info.region ?? '']}` : 'asked for twice'}`);
    else if (p.capped) lines.push(`${head}${MAX_NEW_EXERCISES} from the library is the most for one routine`);
    else lines.push(`${head}nothing else left for ${p.info.c.muscleGroup} ${lack()}`);
  }
  if (rows.length > 1) {
    const tiers = (['primary', 'secondary', 'isolation'] as const).filter((t) => rows.some((r) => r.tier === t)).map((t) => (t === 'primary' ? 'main lifts' : t === 'secondary' ? 'secondary lifts' : 'isolation'));
    lines.push(`Order: ${tiers.join(', then ')}${present.length > 1 ? '; the bigger muscle first in each' : ''}`);
  }

  for (const tag of NIGGLE_ORDER) {
    const g = sh.niggles.get(tag);
    if (!g || !changedBy.has(tag)) continue;
    const rules = NIGGLE_LINES[tag]![g.level];
    lines.push(g.typed ? `${SORE_LABELS[tag]}, as you said: ${rules}` : `${NIGGLE_LABELS[tag]} on ${fmtDay(g.date!)}: ${rules}`);
  }
  if (leftOutChanged) {
    const said = [...new Set(leftOutInfos.map((i) => i.pattern))].filter((p) => (request.excludePatterns ?? []).includes(p)).map((p) => patternLabel(p));
    lines.push(`No ${joinOr(said)}, as you asked`);
  }
  for (const p of picks) if (inRoutine.has(p.info.c.id)) lines.push(...p.notes);

  if (sh.week) {
    for (const m of present) {
      const have = sh.week[m] ?? 0;
      const adds = rows.filter((r) => r.muscleGroup === m).reduce((s, r) => s + r.sets, 0);
      lines.push(`${m} ${PLURAL_MUSCLES.has(m) ? 'get' : 'gets'} ${setsPhrase(have)} a week in your routines; this routine adds ${adds}`);
    }
  }

  for (const m of unmet) lines.push(`No exercise for ${m} ${lack()}`);
  // A part of a muscle that nothing in the owner's exercises or the library reaches.
  const missing = new Set<string>();
  for (const regions of claims.values()) {
    for (const r of regions) if (!dayInfos.some((i) => i.region === r) && !unmet.some((m) => (MUSCLE_REGIONS[m] ?? []).includes(r))) missing.add(r);
  }
  for (const r of missing) lines.push(`No exercise for ${REGION_LABELS[r] ?? r} ${lack()}`);

  // Fewer exercises than the day is for. Said of what is in the routine, and why there are not more.
  const pickedCount = rows.length + dropped.length;
  const wanted = day.count;
  if (rows.length > 0 && pickedCount < wanted && unmet.length < (day.asked ?? dayMuscles).length) {
    const libraryUsed = picks.filter((p) => p.info.c.origin !== 'own').length;
    const capped = libraryUsed >= MAX_NEW_EXERCISES && pool.some((i) => i.c.origin !== 'own' && !picks.some((p) => p.info.c.id === i.c.id));
    const muscles = joinList(dayMuscles);
    const afterWhat = removedBy.size > 0 ? 'after what the niggle rules out' : leftOutInfos.length > 0 ? 'without the movements you left out' : lack();
    const why = capped ? `${MAX_NEW_EXERCISES} from the library is the most for one routine, and your own have nothing more for ${muscles}` : `nothing more for ${muscles} ${afterWhat}`;
    lines.push(`${rows.length} of ${wanted} exercises: ${why}${dropped.length > 0 ? `; ${pickedCount} to start with, ${dropped.length} dropped for the ${asked} min asked` : ''}`);
  }

  const kept = works.filter((w) => w.own).map((w) => w.pick.info.c.name);
  if (kept.length > 0) lines.push(`Sets and reps as in your routines: ${joinList(kept)}`);
  if (assembled.heads) {
    const h = assembled.heads;
    if (rows.length > 0) lines.push(`Sets by part: side delts ${h.side}, rear delts ${h.rear}, front delts ${h.front}${h.press > 0 ? ` (${h.press} the press)` : ''}`);
  }
  lines.push(...assembled.setsLines);

  // A part of a muscle the request asked for, and how much of the routine is it.
  if (day.kind === 'typed') {
    for (const region of request.preferRegions ?? []) {
      const unit = region.split(':')[0]!;
      const there = rows.filter((r) => r.region === region).length;
      const all = rows.filter((r) => r.region !== null && r.region.startsWith(`${unit}:`)).length;
      if (there > 0) lines.push(`${REGION_LABELS[region] ?? region} asked for: ${there} of ${all} ${rows.find((r) => r.region === region)!.muscleGroup} exercises`);
    }
  }

  if (dropped.length > 0) lines.push(`Dropped ${joinList(dropped.map((w) => w.pick.info.c.name))} for the ${asked} min asked`);
  if (added.length > 0) lines.push(`Added ${joinList(added.map((p) => p.info.c.name))} for the ${asked} min asked`);

  const fromLibrary = rows.filter((r) => r.origin !== 'own').map((r) => r.name);
  if (fromLibrary.length > 0) lines.push(`From the library, where your own exercises had nothing for the part: ${joinList(fromLibrary)}`);

  if (rows.some((r) => r.origin !== 'own')) lines.push('Weights are your own working weights; new exercises have none yet');
  else if (rows.some((r) => r.weightKg === null)) lines.push('Weights are your own working weights; exercises with none logged have none yet');
  else if (rows.length > 0) lines.push('Weights are your own working weights');

  const estimate = minutesOf(works);
  if (rows.length > 0) lines.push(aboutLine(estimate, sh.paceBasis, asked));

  return { name: day.name, rows, reasonLines: lines, estimateMinutes: estimate, focus: day.kind === 'typed' ? [...asks] : present, unmet };
}

// ---------------------------------------------------------------------------
// Public

/**
 * Routines for a request: one, or one a day for a named split. `input.context` is the owner's
 * routines, niggles and stalls; without it the routine is built from the exercises alone.
 */
export function buildRoutines(input: RoutineInput, request: RoutineRequest, seed: number): BuiltRoutine[] {
  const rng = mulberry32(finite(seed) ? seed >>> 0 : 0);
  const sh = shared(input, request);
  const days = planDays(request);
  if (days.length === 0) return [{ name: 'Routine', rows: [], reasonLines: ['Nothing left to train after the exclusions'], estimateMinutes: 0, focus: [], unmet: [] }];
  // Each day draws from a seed of its own, so a day can be built again with a rule left out and be compared with itself.
  return days.map((d) => buildDay(sh, d, Math.floor(rng() * 4294967296) >>> 0));
}

/** The request a typed line reads as. A split names its days, so a muscle typed beside it is not read. */
export function routineRequestFrom(parsed: ParsedRequest): RoutineRequest {
  const o = parsed.options;
  const request: RoutineRequest = { focus: [...(o.focus ?? [])] };
  if (o.exclude?.length) request.exclude = [...o.exclude];
  if (o.count !== undefined) request.count = o.count;
  if (o.equipment?.length) request.equipment = [...o.equipment];
  if (o.minutes !== undefined) request.minutes = o.minutes;
  if (parsed.split) request.split = parsed.split;
  if (parsed.excludePatterns?.length) request.excludePatterns = [...parsed.excludePatterns];
  if (parsed.typedNiggles?.length) request.typedNiggles = [...parsed.typedNiggles];
  if (parsed.preferRegions?.length) request.preferRegions = [...parsed.preferRegions];
  return request;
}

/** "3x8-10 @ 22kg": the line `parseRoutineText` reads, without the name. */
function rowLine(r: BuiltRow): string {
  const reps = r.repMin === r.repMax ? `${r.repMin}` : `${r.repMin}-${r.repMax}`;
  const weight = r.weightKg === null ? '' : ` @ ${Math.round(r.weightKg * 100) / 100}kg`;
  return `${r.name} ${r.sets}x${reps}${weight}`;
}

/**
 * Routines as text in the format `parseRoutineText` reads: the name, then one exercise a line as
 * "Exercise 3x8-10 @ 22kg", with no weight when there is none, and a blank line between routines.
 */
export function routineToText(routines: readonly BuiltRoutine[]): string {
  return routines.map((r) => [r.name, ...r.rows.map(rowLine)].join('\n')).join('\n\n');
}

/**
 * What a built row is in the exercise list (`ExerciseListRow.key`): the owner's exercise id, a
 * diagram's slug, or `cat:slug` for a catalogue entry. The key an exercise made from it carries as
 * its picture key is the same for the last two, and an owned row is found by id.
 */
export function builtRowKey(row: Pick<BuiltRow, 'id' | 'origin' | 'demoSlug' | 'catalogueSlug'>): string {
  if (row.origin === 'diagram' && row.demoSlug) return row.demoSlug;
  if (row.origin === 'catalogue' && row.catalogueSlug) return catalogueDemoKey(row.catalogueSlug);
  return row.id;
}

/**
 * Which exercise each row of built routines is, for the review that follows: the list key of every
 * row (`builtRowKey`) under its name as `routineToText` writes it (case, apostrophes and spacing
 * ignored), in the order the rows are written. Two rows of one name (two exercises of the owner's
 * that share one) are two keys, so the first line of that name in the text is the first of them. A
 * review reads these in place of matching the names, so a routine the app built is never read back
 * as a different exercise.
 */
export function builtRowKeys(routines: readonly BuiltRoutine[]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const routine of routines) {
    for (const row of routine.rows) {
      const name = normaliseName(row.name);
      const list = keys.get(name);
      if (list) list.push(builtRowKey(row));
      else keys.set(name, [builtRowKey(row)]);
    }
  }
  return keys;
}

/** "about 52 min". */
export function aboutMinutes(r: Pick<BuiltRoutine, 'estimateMinutes'>): string {
  return `about ${r.estimateMinutes} min`;
}
