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
 *   - Starts with one or two heavy compound lifts, then secondary lifts, then isolation finishers,
 *     the bigger muscles first in each.
 *   - Covers every part of a muscle (front, side and rear of the shoulder; upper, mid and fly for
 *     the chest) before taking a second exercise for one part, and never takes the same movement
 *     twice while another is on offer.
 *   - Sets and reps by role: heavy and low for the main lifts, lighter and higher for raises. The
 *     owner's own sets and reps win for an exercise they already do.
 *   - Looks at the week it goes into: the sets a muscle already gets from the owner's routines.
 *   - Steers round a niggle logged in the last fortnight, and offers a variation of a lift that has
 *     stopped progressing.
 *   - Says every one of those in a short factual line (`reasonLines`), so the coach can answer "why".
 */
import { roundKg } from './engine';
import { fmtKg } from './format';
import { MUSCLE_REGIONS, NON_ROUTINE_PATTERNS, REGION_LABELS, movementPattern, patternLabel, regionOf } from './movement';
import { MACRO_MUSCLES, type ParsedRequest, type RoutineSplit } from './quickRequest';
import { baseWeight, estimateMinutes, mulberry32, weightOf, type Candidate, type QuickInput } from './quickSession';
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
  /** Minutes asked for ("a 45 minute shoulder routine"): finishers go first, never the main lift. */
  minutes?: number;
}

export type Tier = 'primary' | 'secondary' | 'isolation';

export interface BuiltRow {
  /** The owner's exercise id, or the catalogue key (`cat:slug`) of an exercise they have not got yet. */
  id: string;
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** kg, from the owner's own numbers. Null for one they have not got a working weight for. */
  weightKg: number | null;
  origin: 'own' | 'catalogue';
  catalogueSlug?: string;
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
  /** Whole minutes at the owner's own pace, never clamped. */
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
export const DEFAULT_SPLIT_DAY_COUNT = 5;
const MAX_COUNT = 12;
/** The most exercises from the library a single routine takes. */
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

const TRAINABLE = new Set<MuscleGroup>(MUSCLE_GROUPS.filter((m) => m !== 'full body' && m !== 'other'));

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

const NIGGLE_LINES: Partial<Record<NiggleTag, string>> = {
  shoulder: 'no upright row, no behind-the-neck or barbell overhead press, no dips; neutral grips preferred',
  'lower back': 'no hinges, good mornings, bent-over barbell rows or back squats; chest-supported rows, leg press and hack squat preferred',
  knee: 'no lunges, jumps, deep or sissy squats; leg press, leg curl and hip thrust preferred',
  'hamstring DOMS': 'no hinges or leg curls',
};
const NIGGLE_LABELS: Partial<Record<NiggleTag, string>> = {
  shoulder: 'Shoulder niggle',
  'lower back': 'Lower back niggle',
  knee: 'Knee niggle',
  'hamstring DOMS': 'Hamstring DOMS',
};
const NIGGLE_ORDER: NiggleTag[] = ['shoulder', 'lower back', 'knee', 'hamstring DOMS'];

/** Whether a niggle rules the exercise out of a routine. */
function blockedBy(tag: NiggleTag, info: Info): boolean {
  const name = plainName(info.c.name);
  const eq = info.c.equipment;
  switch (tag) {
    case 'shoulder':
      return (
        info.pattern === 'upright-row' ||
        info.pattern === 'dip' ||
        /behind (the )?neck|neck press/.test(name) ||
        (info.pattern === 'press-vertical' && eq === 'barbell' && !/landmine/.test(name))
      );
    case 'lower back':
      return (
        info.pattern === 'hinge' ||
        info.pattern === 'back-extension' ||
        (info.pattern === 'row' && eq === 'barbell' && !/supported|incline|lying|seal/.test(name)) ||
        (info.pattern === 'squat' && eq === 'barbell' && !/front/.test(name))
      );
    case 'knee':
      return info.pattern === 'lunge' || /\b(deep|sissy|pistol|atg|ass to grass)\b/.test(name);
    case 'hamstring DOMS':
      return info.pattern === 'hinge' || info.pattern === 'leg-curl';
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
  /** The movement was already in the routine: nothing else was left. */
  repeat: boolean;
}

/** Candidates that may be in a routine at all, in one canonical order. */
function eligibleInfos(candidates: readonly Candidate[], request: RoutineRequest): Info[] {
  const equipment = request.equipment?.length ? new Set<Equipment>(request.equipment) : null;
  const exclude = new Set<MuscleGroup>(request.exclude ?? []);
  const seen = new Set<string>();
  const out: Info[] = [];
  for (const c of [...candidates].sort(byId)) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === 'carry' || c.kind === 'timed') continue;
    if (!TRAINABLE.has(c.muscleGroup) || exclude.has(c.muscleGroup)) continue;
    // An exercise with no equipment recorded counts as 'other', so "no barbell" keeps it.
    if (equipment && !equipment.has(c.equipment ?? 'other')) continue;
    if (c.origin === 'catalogue' && c.level === 'expert') continue;
    const pattern = movementPattern(c.name, c.muscleGroup);
    if (NON_ROUTINE_PATTERNS.has(pattern)) continue;
    out.push({ c, pattern, region: regionOf(c.name, c.muscleGroup) });
  }
  return out;
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

function planDays(request: RoutineRequest): DaySpec[] {
  const exclude = new Set(request.exclude ?? []);
  const keep = (muscles: readonly MuscleGroup[]) => muscles.filter((m) => !exclude.has(m));

  if (request.split) {
    const perDay = request.split === 'full-body' ? DEFAULT_ROUTINE_COUNT : DEFAULT_SPLIT_DAY_COUNT;
    return DAYS[request.split]
      .map((d): DaySpec => ({ name: d.name, muscles: keep(d.muscles), kind: request.split === 'full-body' ? 'spread' : 'split', count: clampCount(request.count, perDay) }))
      .filter((d) => d.muscles.length > 0);
  }
  const focus = [...new Set(request.focus ?? [])].filter((m) => TRAINABLE.has(m) && !exclude.has(m));
  if (focus.length > 0) return [{ name: routineName(focus), muscles: focus, kind: 'typed', count: clampCount(request.count, DEFAULT_ROUTINE_COUNT), asked: focus }];
  const spread = keep(FULL_BODY_MUSCLES);
  return spread.length > 0 ? [{ name: 'Full body', muscles: spread, kind: 'spread', count: clampCount(request.count, DEFAULT_ROUTINE_COUNT) }] : [];
}

// ---------------------------------------------------------------------------
// What one build shares between its days

interface Shared {
  input: RoutineInput;
  request: RoutineRequest;
  infos: Info[];
  restDefaults: RestDefaults;
  pace: number;
  niggleTags: Set<NiggleTag>;
  niggleDates: Map<NiggleTag, string>;
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

  const niggleDates = new Map<NiggleTag, string>();
  for (const n of context?.niggles ?? []) {
    const had = niggleDates.get(n.tag);
    if (had === undefined || n.date > had) niggleDates.set(n.tag, n.date);
  }
  const niggleTags = new Set<NiggleTag>(NIGGLE_ORDER.filter((t) => niggleDates.has(t)));

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

  return {
    input,
    request,
    infos: eligibleInfos(input.candidates ?? [], request),
    restDefaults,
    pace: positiveOr(input.pace, 1),
    niggleTags,
    niggleDates,
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

function buildDay(sh: Shared, day: DaySpec, rng: () => number): BuiltRoutine {
  const { input } = sh;
  const excluded = new Set(sh.request.exclude ?? []);
  const dayMuscles = day.muscles.filter((m) => !excluded.has(m));
  const n = day.count;
  const lines: string[] = [];

  // --- The pool for this day, less what a niggle rules out.
  const removedBy = new Map<NiggleTag, number>();
  const pool: Info[] = [];
  for (const info of sh.infos) {
    if (!dayMuscles.includes(info.c.muscleGroup)) continue;
    const tag = NIGGLE_ORDER.find((t) => sh.niggleTags.has(t) && blockedBy(t, info));
    if (tag) {
      removedBy.set(tag, (removedBy.get(tag) ?? 0) + 1);
      continue;
    }
    pool.push(info);
  }
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

  // --- Choosing.
  const used = new Set<string>();
  const usedPatterns = new Set<string>();
  /** Stalled lifts that have given way to a variation: out for the rest of this routine. */
  const displaced = new Set<string>();
  const picks: Chosen[] = [];
  const counts = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0]));
  const pointer = new Map<MuscleGroup, number>(dayMuscles.map((m) => [m, 0]));
  let newCount = 0;
  const stallLines: string[] = [];

  const allowed = (i: Info, repeat: boolean): boolean =>
    !used.has(i.c.id) &&
    !displaced.has(i.c.id) &&
    (repeat || !usedPatterns.has(i.pattern)) &&
    (i.c.origin !== 'catalogue' || newCount < MAX_NEW_EXERCISES);

  const drawWeight = (i: Info): number => {
    let w = weightOf(i.c, false, true) * preference(sh.niggleTags, i);
    // A name no rule can place is the last resort within its muscle.
    if (i.pattern === i.c.muscleGroup) w *= 0.2;
    if (i.c.origin === 'catalogue' && SPECIALTY.test(plainName(i.c.name))) w *= SPECIALTY_FACTOR;
    return w;
  };

  /** One of `list`, seeded; the owner's own exercises first, and the library only where they have none. */
  const choose = (list: Info[]): Info => {
    const own = list.filter((i) => i.c.origin === 'own');
    const from = own.length > 0 ? own : list;
    const weights = from.map(drawWeight);
    let r = rng() * weights.reduce((s, w) => s + w, 0);
    for (let k = 0; k < from.length; k++) {
      if (r < weights[k]!) return from[k]!;
      r -= weights[k]!;
    }
    return from[from.length - 1]!;
  };

  /** Prefers a different kind of equipment from `than`: a variation is another angle on the lift, not the same lift again. */
  const chooseOther = (list: Info[], than: Info): Info => {
    const other = list.filter((i) => i.c.equipment !== than.c.equipment);
    return choose(other.length > 0 ? other : list);
  };

  /**
   * A variation of a stalled lift when nothing else in its part of the muscle will do: the owner's
   * own before the library, the same part of the muscle before another part of the same muscle that
   * is the same kind of lift.
   */
  const variationOf = (stalled: Info): Info | null => {
    const unit = stalled.region ? stalled.region.split(':')[0]! : null;
    const same = (i: Info) => (stalled.region ? i.region === stalled.region : i.pattern === stalled.pattern);
    const sameUnitAndKind = (i: Info) => unit !== null && i.region !== null && i.region.startsWith(`${unit}:`) && i.c.isCompound === stalled.c.isCompound;
    const ok = (i: Info) => i.c.id !== stalled.c.id && !sh.stalled.has(i.c.id) && allowed(i, false);
    for (const origin of ['own', 'catalogue'] as const) {
      for (const near of [same, sameUnitAndKind]) {
        const list = pool.filter((i) => i.c.origin === origin && ok(i) && near(i));
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
    const main = list.filter((i) => i.c.isCompound && PRIMARY_PATTERNS.has(i.pattern));
    return main.length > 0 ? main : list;
  };

  /**
   * One of a part of a muscle's candidates. A stalled lift among them gives way to the rest of the
   * part, or to a variation when it is the only one, and a line says what took its place.
   */
  const pickFor = (candidates: Info[], byPart: boolean): Info => {
    const list = byPart ? mainFirst(candidates) : candidates;
    const stalledIn = list.filter((i) => sh.stalled.has(i.c.id));
    if (stalledIn.length === 0) return choose(list);
    const rest = list.filter((i) => !sh.stalled.has(i.c.id));
    // The one that would most likely have been drawn stands for them all.
    const lead = stalledIn.reduce((a, b) => (drawWeight(b) > drawWeight(a) ? b : a));
    const swap = rest.length > 0 ? chooseOther(rest, lead) : variationOf(lead);
    if (swap === null) {
      stallLines.push(`${lead.c.name} stalled for ${sh.stalled.get(lead.c.id)} sessions: no variation in your exercises or the library, kept`);
      return choose(list);
    }
    for (const s of stalledIn) {
      displaced.add(s.c.id);
      stallLines.push(`${s.c.name} stalled for ${sh.stalled.get(s.c.id)} sessions: ${swap.c.name} in its place`);
    }
    return swap;
  };

  const commit = (info: Info, owner: MuscleGroup): void => {
    picks.push({ info, repeat: usedPatterns.has(info.pattern) });
    used.add(info.c.id);
    usedPatterns.add(info.pattern);
    if (info.c.origin === 'catalogue') newCount++;
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
   * Phase 0: every part of every muscle that has a share, once, before any muscle takes a second
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
        const list = (byRegion.get(region) ?? []).filter((i) => allowed(i, false));
        if (list.length > 0) commit(pickFor(list, true), m);
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
        list = pool.filter((i) => i.c.muscleGroup === m && allowed(i, repeat));
      }
      if (list.length === 0) {
        skip.add(m);
        continue;
      }
      commit(pickFor(list, phase === 1 && regions.length > 0), m);
    }
  };
  cover();
  fill(1);
  fill(2);
  fill(3);

  // --- Roles, in the order a coach would take them.
  type Draft = { pick: Chosen; tier: Tier; order: number };
  const drafts: Draft[] = picks.map((pick, order) => ({
    pick,
    order,
    tier: !pick.info.c.isCompound || ISOLATION_PATTERNS.has(pick.info.pattern) ? 'isolation' : PRIMARY_PATTERNS.has(pick.info.pattern) ? 'primary' : 'secondary',
  }));
  const byBigness = (a: Draft, b: Draft) => bigRank(a.pick.info.c.muscleGroup) - bigRank(b.pick.info.c.muscleGroup) || a.order - b.order;
  // One or two main lifts, a different muscle each where there is one.
  const primaryRoom = n >= 5 ? 2 : 1;
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

  // --- Sets and reps by role; the owner's own win.
  interface Work extends Draft {
    sets: number;
    repMin: number;
    repMax: number;
    own: boolean;
  }
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

  // --- Sets per muscle stay sensible: one or two muscles named give each 9 to 15, a day of a split or a spread 4 to 9.
  const narrow = day.kind === 'typed' && (day.asked?.length ?? 0) <= 2;
  const [lo, hi] = narrow ? NAMED_WINDOW : DAY_WINDOW;
  const scope = narrow ? 'a routine for it' : 'a day';
  const setsLines: string[] = [];
  for (const m of new Set(works.map((w) => w.pick.info.c.muscleGroup))) {
    const mine = works.filter((w) => w.pick.info.c.muscleGroup === m);
    const total = () => mine.reduce((s, w) => s + w.sets, 0);
    const before = total();
    while (total() < lo) {
      const row = mine.find((w) => !w.own && w.sets < MAX_SETS);
      if (!row) break;
      row.sets++;
    }
    while (total() > hi) {
      const row = [...mine].reverse().find((w) => !w.own && w.sets > MIN_SETS);
      if (!row) break;
      row.sets--;
    }
    const after = total();
    if (after > before) setsLines.push(`${m}: sets raised from ${before} to ${after} (at least ${lo} sets for a muscle in ${scope})`);
    if (after < before) setsLines.push(`${m}: sets cut from ${before} to ${after} (at most ${hi} sets for a muscle in ${scope})`);
  }

  // --- Time: a duration asked for trims finishers first, and never the main lift.
  const restOf = (c: Candidate): number =>
    Math.max(0, restSecondsFor(null, { defaultRestSec: finite(c.defaultRestSec) ? c.defaultRestSec : 0, kind: c.kind, isCompound: c.isCompound }, sh.restDefaults));
  const minutesOf = (list: readonly Work[]): number =>
    estimateMinutes(list.map((w) => ({ sets: w.sets, restSec: restOf(w.pick.info.c), candidate: w.pick.info.c })), sh.pace);
  const dropped: Work[] = [];
  const asked = sh.request.minutes;
  if (finite(asked) && asked > 0) {
    while (minutesOf(works) > asked && works.length > TRIM_FLOOR) {
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
      dropped.push(...works.splice(victim, 1));
    }
  }

  // --- The rows.
  const rows: BuiltRow[] = works.map((w) => {
    const { info } = w.pick;
    const c = info.c;
    const known = baseWeight(c);
    const weightKg = known === null ? null : roundKg(known);
    const place = info.region ? `${REGION_LABELS[info.region] ?? info.region} (${patternLabel(info.pattern)})` : patternLabel(info.pattern);
    const parts: string[] = [c.muscleGroup, place];
    if (c.origin === 'catalogue') parts.push('new to you, no weight yet');
    else {
      parts.push(fmtRecency(input.recency?.[c.muscleGroup]));
      parts.push(weightKg === null ? 'no weight yet' : `your working weight ${fmtKg(weightKg)}`);
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
    return row;
  });

  // --- The lines that say why.
  const present = [...new Set(rows.map((r) => r.muscleGroup))].sort((a, b) => bigRank(a) - bigRank(b));
  // Nothing at all for a muscle, as opposed to nothing a niggle left.
  const unmet = (day.asked ?? []).filter((m) => !sh.infos.some((i) => i.c.muscleGroup === m));
  if (day.kind === 'typed') lines.push(`Focus: ${joinList(day.asked ?? [])}, as asked`);
  else if (day.kind === 'split') lines.push(`Focus: ${joinList(dayMuscles.filter((m) => present.includes(m)))} (${day.name.toLowerCase()} day)`);
  else lines.push(`Focus: ${joinList(present)}, no muscle asked for`);

  const patternsInRoutine = rows.map((r) => r.pattern);
  const repeats = picks.filter((p) => p.repeat);
  if (rows.length > 0 && repeats.length === 0) {
    lines.push(`One exercise per movement: ${joinList(patternsInRoutine.map(patternLabel))}`);
  }
  for (const p of repeats) {
    lines.push(`A second ${patternLabel(p.info.pattern)}, ${p.info.c.name}: nothing else left for ${p.info.c.muscleGroup} in your exercises or the library`);
  }
  if (rows.length > 1) {
    const tiers = (['primary', 'secondary', 'isolation'] as const).filter((t) => rows.some((r) => r.tier === t)).map((t) => (t === 'primary' ? 'main lifts' : t === 'secondary' ? 'secondary lifts' : 'isolation'));
    lines.push(`Order: ${tiers.join(', then ')}${present.length > 1 ? '; the bigger muscle first in each' : ''}`);
  }

  for (const tag of NIGGLE_ORDER) {
    if (!sh.niggleTags.has(tag) || !removedBy.has(tag)) continue;
    lines.push(`${NIGGLE_LABELS[tag]} on ${fmtDay(sh.niggleDates.get(tag)!)}: ${NIGGLE_LINES[tag]}`);
  }
  lines.push(...stallLines);

  if (sh.week) {
    for (const m of present) {
      const have = sh.week[m] ?? 0;
      const adds = rows.filter((r) => r.muscleGroup === m).reduce((s, r) => s + r.sets, 0);
      lines.push(`${m} ${PLURAL_MUSCLES.has(m) ? 'get' : 'gets'} ${setsPhrase(have)} a week in your routines; this routine adds ${adds}`);
    }
  }

  for (const m of unmet) lines.push(`No exercise for ${m} in your exercises or the library`);
  // A part of a muscle that nothing in the owner's exercises or the library reaches.
  const missing = new Set<string>();
  for (const regions of claims.values()) {
    for (const r of regions) if (!sh.infos.some((i) => i.region === r) && !unmet.some((m) => (MUSCLE_REGIONS[m] ?? []).includes(r))) missing.add(r);
  }
  for (const r of missing) lines.push(`No exercise for ${REGION_LABELS[r] ?? r} in your exercises or the library`);
  if (rows.length + dropped.length < n && unmet.length < (day.asked ?? dayMuscles).length) {
    const capped = newCount >= MAX_NEW_EXERCISES && pool.some((i) => i.c.origin === 'catalogue' && !used.has(i.c.id));
    lines.push(
      capped
        ? `${rows.length + dropped.length} of ${n} exercises: ${MAX_NEW_EXERCISES} from the library is the most for one routine, and your own have nothing more for ${joinList(dayMuscles)}`
        : `${rows.length + dropped.length} of ${n} exercises: nothing more for ${joinList(dayMuscles)} in your exercises or the library`,
    );
  }

  const kept = works.filter((w) => w.own).map((w) => w.pick.info.c.name);
  if (kept.length > 0) lines.push(`Sets and reps as in your routines: ${joinList(kept)}`);
  lines.push(...setsLines);

  if (dropped.length > 0) lines.push(`Dropped ${joinList(dropped.map((w) => w.pick.info.c.name))} to come nearer the ${asked} min asked`);

  const fromLibrary = rows.filter((r) => r.origin === 'catalogue').map((r) => r.name);
  if (fromLibrary.length > 0) lines.push(`From the library, where your own exercises had nothing for the part: ${joinList(fromLibrary)}`);

  if (rows.some((r) => r.origin === 'catalogue')) lines.push('Weights are your own working weights; new exercises have none yet');
  else if (rows.some((r) => r.weightKg === null)) lines.push('Weights are your own working weights; exercises with none logged have none yet');
  else if (rows.length > 0) lines.push('Weights are your own working weights');

  const estimate = minutesOf(works);
  lines.push(`About ${estimate} min at your pace`);

  return { name: day.name, rows, reasonLines: lines, estimateMinutes: estimate, focus: day.kind === 'typed' ? [...(day.asked ?? [])] : present, unmet };
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
  return days.map((d) => buildDay(sh, d, rng));
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

/** "about 52 min". */
export function aboutMinutes(r: Pick<BuiltRoutine, 'estimateMinutes'>): string {
  return `about ${r.estimateMinutes} min`;
}
