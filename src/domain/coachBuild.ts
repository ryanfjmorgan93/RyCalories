/**
 * What the coach says about a routine it built, in facts, and how it changes one — pure. No IO, no
 * clock, no model.
 *
 * `describeRead` is the line under a built routine: what the rules took from the typed words, and
 * how many exercises came of it. `readUsable` says whether they took anything a routine can be
 * built from. `builtTurn` is how a built routine stands in the conversation the model is given.
 *
 * `applyEdit` and `buildEdit` are how "add biceps", "swap the front raise", "make it shorter" and
 * "harder" change THE routine on screen instead of building another from the new words alone. The
 * new request is the previous one with what the words changed (every field of the previous request
 * is carried, whatever it is), and the routine is the previous one with the rows that still fit
 * kept and only what is missing drawn afresh, by the same generator, from the owner's exercises and
 * the library. Weights are the owner's own and sets and reps come from the generator, as in any
 * routine it builds: nothing here invents either.
 */
import { expandAbbreviations } from './exerciseMatch';
import { plural } from './format';
import { REGION_LABELS, movementPattern, patternLabel, regionOf } from './movement';
import { readEdit } from './coachIntent';
import { MAX_MINUTES, MIN_MINUTES, parseQuickRequest, type QuickOptions, type RoutineSplit } from './quickRequest';
import { estimateMinutes, type Candidate } from './quickSession';
import { restSecondsFor, type RestDefaults } from './rest';
import {
  MAX_NEW_EXERCISES,
  buildRoutines,
  joinList,
  routineName,
  routineToText,
  type BuiltRoutine,
  type BuiltRow,
  type RoutineInput,
  type RoutineRequest,
} from './routineBuilder';
import { DEFAULT_SETTINGS, EQUIPMENT_KINDS, type Equipment, type MuscleGroup } from './types';

/**
 * A routine request, and how many steps harder (positive) or easier (negative) the owner has asked
 * for it to be. The generator knows nothing of the steps: they are applied to the sets after it has
 * built the routine (`buildCoach`), so Shuffle and every later edit keep them.
 */
export interface CoachRequest extends RoutineRequest {
  intensity?: number;
}

/** The most steps of harder or easier a routine goes to. */
export const MAX_INTENSITY = 3;
/** The most sets a main or secondary lift goes to, and an isolation lift. */
const MAX_SETS_MAIN = 5;
const MAX_SETS_ISOLATION = 4;
const MIN_SETS = 2;
const MAX_COUNT = 12;

/**
 * Whether the options say anything a routine can be built to: a split, muscles, a count, a length,
 * equipment, or a muscle ruled out. Effort alone does not: the builder has no light routine.
 */
export function readUsable(options: Partial<QuickOptions>, split?: RoutineSplit): boolean {
  return (
    split !== undefined ||
    (options.focus?.length ?? 0) > 0 ||
    options.count !== undefined ||
    options.minutes !== undefined ||
    (options.equipment?.length ?? 0) > 0 ||
    (options.exclude?.length ?? 0) > 0
  );
}

/** The request as `readUsable` reads it. */
export function requestUsable(request: RoutineRequest): boolean {
  return readUsable({ focus: request.focus, exclude: request.exclude, count: request.count, equipment: request.equipment, minutes: request.minutes }, request.split);
}

/** The equipment a request allows, in words: the short side of the list, so "no barbell" does not name six kinds. */
function equipmentWords(allowed: readonly string[]): string {
  const left = EQUIPMENT_KINDS.filter((e) => !allowed.includes(e));
  return allowed.length > left.length ? `no ${left.join(', ')}` : allowed.join(', ');
}

/**
 * "shoulders, rear delts · 6 exercises": what was read and what was built. Counts are what the
 * routines hold, not what was asked for. A request with nothing in it says so.
 */
export function describeRead(request: CoachRequest, routines: readonly BuiltRoutine[]): string {
  const steps = request.intensity ?? 0;
  const effort = steps > 0 ? ['harder'] : steps < 0 ? ['easier'] : [];
  if (!requestUsable(request)) return ['nothing specific · full body by need', ...effort].join(' · ');
  const total = routines.reduce((n, r) => n + r.rows.length, 0);
  const parts: string[] = [];
  if (request.split) {
    parts.push(routines.map((r) => r.name.toLowerCase()).join(', '));
    if (routines.length > 1) parts.push(`${routines.length} routines`);
  } else if (request.focus.length > 0) {
    // A named group of muscles ("push", "upper") is read by its name; anything else lists its muscles.
    const name = routineName(request.focus).toLowerCase();
    parts.push(name === joinList(request.focus).toLowerCase() ? request.focus.join(', ') : name);
  } else {
    parts.push('full body by need');
  }
  parts.push(plural(total, 'exercise'));
  if (request.exclude?.length) parts.push(`no ${request.exclude.join(', ')}`);
  if (request.equipment?.length) parts.push(equipmentWords(request.equipment));
  if (request.minutes !== undefined) parts.push(`${request.minutes} min`);
  parts.push(...effort);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// A routine with nothing in it

/** What an empty routine is, as a fact: "Nothing to choose from for neck". */
export function nothingFact(routine: BuiltRoutine): string {
  if (routine.unmet.length > 0) return `Nothing to choose from for ${joinList(routine.unmet)}`;
  const left = routine.reasonLines.find((line) => line.startsWith('Nothing left to train'));
  if (left) return left;
  return routine.focus.length > 0 ? `Nothing to choose from for ${joinList(routine.focus)}` : 'Nothing to choose from';
}

/**
 * The reasons an empty routine shows beside its fact: not the minutes of nothing, and not the line
 * that says again what the fact says.
 */
export function emptyReasonLines(routine: BuiltRoutine): string[] {
  return routine.reasonLines.filter(
    (line) => !/^About 0 min/.test(line) && !(routine.unmet.length > 0 && /^No exercise for .* in your exercises or the library$/.test(line)) && !line.startsWith('Nothing left to train'),
  );
}

/**
 * What the model is told the coach said when it built a routine: the routine itself is in the
 * prompt's own block. A build with nothing in it is told as nothing, never as a routine.
 */
export function builtTurn(routines: readonly BuiltRoutine[], edit?: string | null): string {
  const built = routines.filter((r) => r.rows.length > 0);
  if (built.length === 0) return `Built nothing: ${routines.map(nothingFact).join('; ')}`;
  const names = built.map((r) => r.name).join(', ');
  return edit ? `Routine changed (${names}): ${edit}` : `Routine built: ${names}`;
}

// ---------------------------------------------------------------------------
// Building

/** Minutes a routine takes at the owner's own pace, worked out as the generator works them out, from the rows as they now stand. */
export function routineMinutes(rows: readonly BuiltRow[], input: RoutineInput): number {
  const settings = input.settings;
  const positive = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback);
  const restDefaults: RestDefaults = {
    restCompoundSec: positive(settings?.restCompoundSec, DEFAULT_SETTINGS.restCompoundSec),
    restIsolationSec: positive(settings?.restIsolationSec, DEFAULT_SETTINGS.restIsolationSec),
    restCarrySec: positive(settings?.restCarrySec, DEFAULT_SETTINGS.restCarrySec),
  };
  const known = new Map(input.candidates.map((c) => [c.id, c]));
  const items = rows.map((r) => {
    const c: Candidate | undefined = known.get(r.id);
    const candidate: Candidate = c ?? {
      id: r.id,
      name: r.name,
      muscleGroup: r.muscleGroup,
      kind: 'reps',
      isCompound: r.tier !== 'isolation',
      isLowerBody: false,
      unilateral: false,
      defaultIncrement: 2.5,
      defaultRestSec: 0,
      origin: r.origin,
    };
    const rest = restSecondsFor(null, { defaultRestSec: Number.isFinite(candidate.defaultRestSec) ? candidate.defaultRestSec : 0, kind: candidate.kind, isCompound: candidate.isCompound }, restDefaults);
    return { sets: r.sets, restSec: Math.max(0, rest), candidate };
  });
  return estimateMinutes(items, positive(input.pace, 1));
}

/** The names of rows, for a line: "A, B and C". */
function names(rows: readonly BuiltRow[]): string {
  return joinList(rows.map((r) => r.name));
}

/**
 * One step harder or easier. Harder is a set more on every main and secondary lift (up to five) and,
 * once those are as far as they go, on the isolation lifts (up to four); easier is a set fewer on
 * every lift (down to two). Reps and weights are not touched: the weights are the owner's own.
 */
function stepRows(rows: readonly BuiltRow[], step: 1 | -1): { rows: BuiltRow[]; changed: BuiltRow[] } {
  const next = rows.map((r) => ({ ...r }));
  const changed = new Set<number>();
  if (step > 0) {
    let did = false;
    next.forEach((r, i) => {
      if (r.tier !== 'isolation' && r.sets < MAX_SETS_MAIN) {
        r.sets++;
        changed.add(i);
        did = true;
      }
    });
    if (!did) {
      next.forEach((r, i) => {
        if (r.tier === 'isolation' && r.sets < MAX_SETS_ISOLATION) {
          r.sets++;
          changed.add(i);
        }
      });
    }
  } else {
    next.forEach((r, i) => {
      if (r.sets > MIN_SETS) {
        r.sets--;
        changed.add(i);
      }
    });
  }
  return { rows: next, changed: [...changed].map((i) => next[i]!) };
}

/** A routine made harder or easier by `steps` (negative is easier), and the line that says what changed. Minutes are worked out again. */
export function applyIntensity(routine: BuiltRoutine, steps: number, input: RoutineInput): { routine: BuiltRoutine; fact: string | null } {
  const n = Math.min(MAX_INTENSITY, Math.abs(Math.trunc(Number.isFinite(steps) ? steps : 0)));
  if (n === 0 || routine.rows.length === 0) return { routine, fact: null };
  const step = steps > 0 ? 1 : -1;
  let rows = routine.rows;
  const touched = new Set<string>();
  for (let i = 0; i < n; i++) {
    const done = stepRows(rows, step);
    rows = done.rows;
    for (const r of done.changed) touched.add(r.id);
  }
  const before = routine.rows.reduce((s, r) => s + r.sets, 0);
  const after = rows.reduce((s, r) => s + r.sets, 0);
  const moved = rows.filter((r) => touched.has(r.id));
  const fact =
    after === before
      ? step > 0
        ? `Harder: already at the most sets this goes to (${MAX_SETS_MAIN} on main lifts, ${MAX_SETS_ISOLATION} on the rest)`
        : `Easier: already at ${MIN_SETS} sets on every lift`
      : `${step > 0 ? 'Harder' : 'Easier'}: ${plural(Math.abs(after - before), 'set')} ${step > 0 ? 'more' : 'fewer'}, on ${names(moved)}`;
  const reasonLines = [...routine.reasonLines.filter((l) => !l.startsWith('About ')), fact, `About ${routineMinutes(rows, input)} min at your pace`];
  return { routine: { ...routine, rows, reasonLines, estimateMinutes: routineMinutes(rows, input) }, fact };
}

/** A routine never trims below this many exercises for a length asked for, as the generator's own trim never does. */
const TRIM_FLOOR = 2;

/**
 * A routine trimmed to come nearer `minutes`, for when sets added after the generator's own trim put
 * it back over: a second exercise for a part of a muscle goes first, then the last finisher, and the
 * main lifts are never dropped.
 */
export function fitMinutes(routine: BuiltRoutine, minutes: number, input: RoutineInput): BuiltRoutine {
  let rows = routine.rows;
  const dropped: BuiltRow[] = [];
  while (rows.length > TRIM_FLOOR && routineMinutes(rows, input) > minutes) {
    const [at] = victimsFor(rows, 1);
    if (at === undefined || rows[at]!.tier === 'primary') break;
    dropped.push(rows[at]!);
    rows = rows.filter((_, i) => i !== at);
  }
  if (dropped.length === 0) return routine;
  const estimate = routineMinutes(rows, input);
  const lines = routine.reasonLines.filter((l) => !l.startsWith('About '));
  return { ...routine, rows, estimateMinutes: estimate, reasonLines: [...lines, `Dropped ${names(dropped)} to come nearer the ${minutes} min asked`, `About ${estimate} min at your pace`] };
}

/**
 * The routines for a request, as the owner asked for them: the generator's, then made harder or
 * easier by the request's own steps, and kept to the length asked for where the steps put it over.
 */
export function buildCoach(input: RoutineInput, request: CoachRequest, seed: number): BuiltRoutine[] {
  const routines = buildRoutines(input, request, seed);
  const steps = request.intensity ?? 0;
  if (steps === 0) return routines;
  return routines.map((r) => {
    const stepped = applyIntensity(r, steps, input).routine;
    return request.minutes !== undefined ? fitMinutes(stepped, request.minutes, input) : stepped;
  });
}

/** Seeds tried for a Shuffle before settling for the same routine again. */
export const SHUFFLE_TRIES = 8;

/**
 * The same request built again with a new seed. A seed that gives back what is already on screen is
 * not a shuffle, so another is drawn, up to `SHUFFLE_TRIES` in all; when every one gives the same
 * routine it is because nothing else can be built from what the owner has, and that is what is shown.
 */
export function reshuffle(
  input: RoutineInput,
  request: CoachRequest,
  current: readonly BuiltRoutine[],
  nextSeed: () => number,
): { routines: BuiltRoutine[]; seed: number } {
  const before = routineToText(current);
  let seed = nextSeed();
  let routines = buildCoach(input, request, seed);
  for (let tries = 1; tries < SHUFFLE_TRIES && routineToText(routines) === before; tries++) {
    seed = nextSeed();
    routines = buildCoach(input, request, seed);
  }
  return { routines, seed };
}

// ---------------------------------------------------------------------------
// Editing

/** What an edit comes to before it is built. */
export interface EditPlan {
  ok: true;
  /** The request after the edit: every field of the previous request, with what the words changed. */
  request: CoachRequest;
  /** The seed the routine is built with. A shuffle draws its own. */
  seed: number;
  /**
   * 'shuffle': the same request again with another seed. 'rebuild': the request built afresh.
   * 'compose': the previous rows that still fit, and what is missing drawn afresh.
   */
  kind: 'shuffle' | 'rebuild' | 'compose';
  /** For a swap or a removal: the routine the row is in. Otherwise 0. */
  routine: number;
  /** For a swap: the row to replace, and what it may be replaced by. */
  swap?: { row: number; muscles?: MuscleGroup[]; equipment?: Equipment[] };
  /** For a removal: the row to take out. */
  remove?: { row: number };
  /** Compose: the rows, by place, to start from. */
  keep: number[];
  /** Compose: how many rows the routine is to end with. */
  want: number;
  /** Compose: the muscles any missing rows are for. Absent, the request's own. */
  fillMuscles?: MuscleGroup[];
  /** Compose: the request's minutes trim the result. */
  trim: boolean;
  /** What the words asked, in short, for the line under the routine. */
  asked: string[];
  /** The steps of harder (+1) or easier (-1) this edit asked. */
  effort?: 1 | -1;
  /** Compose, from "more rear delts" or "add biceps": the muscles added, and how many exercises each. */
  added?: MuscleGroup[];
  /** The muscles this edit ruled out, for the line that says there was nothing of them to take out. */
  excluded?: MuscleGroup[];
}

export interface EditRefusal {
  ok: false;
  /** A fact: what could not be found or done. */
  reason: string;
}

export type EditResult = EditPlan | EditRefusal;

const MINOR_MUSCLES: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['forearms', 'adductors', 'neck']);
/** Exercises one added muscle takes: two, or one where the muscle is minor. */
const ADDED_EACH = 2;

function union<T>(a: readonly T[] | undefined, b: readonly T[]): T[] {
  return [...new Set([...(a ?? []), ...b])];
}

/**
 * What the typed words read beyond the fields this module names (the request parser may read more
 * than a muscle, a count and a length) joins what the request already holds: a list is added to
 * without repeating, and anything else is what was just said. Done on every field, by what it holds
 * and not by its name, so a field added to the request later flows through every follow-up.
 */
export function mergeExtras(request: CoachRequest, extras: Readonly<Record<string, unknown>>): void {
  const target = request as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(extras)) {
    const had = target[key];
    target[key] = Array.isArray(value) ? union(Array.isArray(had) ? had : [], value) : value;
  }
}

/** A name or a movement as the words it is made of: lower case, abbreviations spelled out, plurals made singular. */
function wordsOf(s: string): string[] {
  return expandAbbreviations(s.replace(/\([^()]*\)/g, ' '))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

function singular(w: string): string {
  if (w.length > 3 && /(ss|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Other ways the owner says what a movement is, so "the overhead press" finds the vertical press. */
const PATTERN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  'press-vertical': ['overhead', 'military', 'shoulder'],
  'press-horizontal': ['bench', 'flat'],
  'press-incline': ['incline', 'upper'],
  'lateral-raise': ['lateral', 'side'],
  'front-raise': ['front'],
  'rear-fly': ['rear', 'reverse', 'delt', 'raise', 'fly'],
  'rear-row': ['rear', 'delt'],
  pulldown: ['lat', 'pull', 'down'],
  'triceps-extension': ['extension', 'overhead'],
  pushdown: ['push', 'down'],
};

/** Every word that says what a row is: its name, its movement, the part of the muscle it reaches, its equipment. */
function rowBag(row: BuiltRow): Set<string> {
  const bag = new Set(wordsOf(row.name));
  for (const w of wordsOf(patternLabel(row.pattern))) bag.add(w);
  for (const w of PATTERN_SYNONYMS[row.pattern] ?? []) bag.add(singular(w));
  if (row.region) for (const w of wordsOf(REGION_LABELS[row.region] ?? '')) bag.add(w);
  if (row.equipment) bag.add(row.equipment);
  return bag;
}

/** The row the owner's words name, by its name, its movement, the part of the muscle it reaches or its equipment. */
function findRow(target: readonly string[], routines: readonly BuiltRoutine[]): { routine: number; row: number } | null {
  const words = target.flatMap(wordsOf);
  if (words.length === 0) return null;
  // Every word of the owner's must be one of the row's: "the leg press" is not the shoulder press because both are presses.
  // Where several rows have them all, it is the first.
  for (let ri = 0; ri < routines.length; ri++) {
    const rows = routines[ri]!.rows;
    for (let i = 0; i < rows.length; i++) {
      const bag = rowBag(rows[i]!);
      if (words.every((w) => bag.has(w))) return { routine: ri, row: i };
    }
  }
  return null;
}

/** The muscles a routine has rows for, in the order its rows come. */
function presentMuscles(routines: readonly BuiltRoutine[]): MuscleGroup[] {
  return union([], routines.flatMap((r) => r.rows.map((x) => x.muscleGroup)));
}

/** Seconds-free rounding of a time to the nearest five minutes at or below. */
const floor5 = (n: number): number => Math.floor(n / 5) * 5;
const ceil5 = (n: number): number => Math.ceil(n / 5) * 5;

/**
 * The rows to drop first when a routine has to lose `count`: a second exercise for a part of a
 * muscle goes before the only exercise for another part, then the last of the finishers, and the
 * main lifts last of all. The same order the generator drops them in when a length is asked.
 */
function victimsFor(rows: readonly BuiltRow[], count: number): number[] {
  const left = rows.map((_, i) => i);
  const out: number[] = [];
  while (out.length < count && left.length > 1) {
    let victim = -1;
    for (let k = left.length - 1; k >= 0; k--) {
      const r = rows[left[k]!]!;
      if (r.tier === 'primary') continue;
      const doubled = r.region !== null && left.some((j) => j !== left[k] && rows[j]!.region === r.region);
      if (doubled) {
        victim = k;
        break;
      }
      if (victim === -1) victim = k;
    }
    if (victim === -1) victim = left.length - 1;
    out.push(left[victim]!);
    left.splice(victim, 1);
  }
  return out;
}

/**
 * The edit a typed message asks of the routine on screen, as a plan: the new request, and what is to
 * be done to the routine to make it. `previousRequest` is what the routine was built from, whatever
 * fields it carries: all of them are in the new request, and only what the words changed differs.
 * `seed` is the one the routine was built with, so what is kept stays; a shuffle draws its own.
 * A refusal is a fact about what could not be found.
 */
export function applyEdit(previousRequest: CoachRequest, previousRoutines: readonly BuiltRoutine[], editText: string, seed: number): EditResult {
  const intent = readEdit(editText);
  if (!intent) return { ok: false, reason: 'Nothing there to change the routine with' };
  const routines = previousRoutines;
  const single = routines.length === 1;
  const request: CoachRequest = { ...previousRequest };
  const asked: string[] = [];
  const plan: EditPlan = { ok: true, request, seed, kind: 'compose', routine: 0, keep: [], want: 0, trim: false, asked };
  const rowsOf = (r: number) => routines[r]?.rows ?? [];
  const count0 = rowsOf(0).length;
  const everyRow = (r: number) => rowsOf(r).map((_, i) => i);
  plan.keep = everyRow(0);
  plan.want = count0;

  mergeExtras(request, intent.extras);

  // Shuffle: the same request, another seed.
  if (intent.shuffle) {
    plan.kind = 'shuffle';
    asked.push('another routine');
    return plan;
  }

  // A row named: which one it is, in which routine.
  if (intent.swap || intent.remove) {
    const target = (intent.swap ?? intent.remove)!.target;
    const found = findRow(target, routines);
    if (!found) return { ok: false, reason: `No exercise called ${target.join(' ')} in this routine` };
    plan.routine = found.routine;
    plan.keep = everyRow(found.routine).filter((i) => i !== found.row);
    plan.want = rowsOf(found.routine).length;
    if (intent.swap) {
      const named = intent.swap.replacement.length > 0 ? readReplacement(intent.swap.replacement) : { muscles: [], equipment: [] };
      plan.swap = { row: found.row, ...(named.muscles.length > 0 ? { muscles: named.muscles } : {}), ...(named.equipment.length > 0 ? { equipment: named.equipment } : {}) };
      asked.push(`swap ${rowsOf(found.routine)[found.row]!.name}`);
      if (named.muscles.length > 0 && request.focus.length > 0) request.focus = union(request.focus, named.muscles);
    } else {
      plan.remove = { row: found.row };
      plan.want = plan.keep.length;
      request.count = plan.want;
      asked.push(`drop ${rowsOf(found.routine)[found.row]!.name}`);
    }
    return plan;
  }

  const present = presentMuscles(routines);
  let rebuild = !single || count0 === 0;

  // Muscles.
  const m = intent.muscles;
  if (m?.replace && m.replace.length > 0) {
    const out = new Set(union(request.exclude, m.exclude ?? []));
    request.focus = m.replace.filter((x) => !out.has(x));
    delete request.split;
    rebuild = true;
    asked.push(`Now ${muscleWords(request.focus)}`);
  }
  if (intent.split) {
    request.split = intent.split;
    request.focus = [];
    rebuild = true;
    asked.push(`Now ${intent.split === 'ppl' ? 'push, pull, legs' : intent.split === 'upper-lower' ? 'upper, lower' : 'full body'}`);
  }
  if (m?.exclude && m.exclude.length > 0) {
    request.exclude = union(request.exclude, m.exclude);
    request.focus = request.focus.filter((x) => !m.exclude!.includes(x));
    plan.excluded = m.exclude;
    asked.push(`no ${muscleWords(m.exclude)}`);
  }
  if (m?.out && m.out.length > 0) {
    if (request.focus.length === 0) request.exclude = union(request.exclude, m.out);
    else request.focus = request.focus.filter((x) => !m.out!.includes(x));
    asked.push(`no ${joinList(m.out)}`);
  }
  if (m?.add && m.add.length > 0) {
    if (request.split) return { ok: false, reason: 'A split takes its muscles from its days' };
    const have = request.focus.length > 0 ? request.focus : present;
    const more = m.add.every((x) => have.includes(x));
    if (!more) request.focus = union(request.focus.length > 0 ? request.focus : present, m.add);
    // A muscle already in the routine takes one more exercise, one not yet in it takes two.
    const each = more ? 1 : ADDED_EACH;
    const rows = m.add.reduce((n, x) => n + (more ? each : MINOR_MUSCLES.has(x) ? 1 : each), 0);
    plan.fillMuscles = m.add;
    plan.added = m.add;
    plan.want = Math.min(MAX_COUNT, count0 + rows);
    asked.push(`${more ? 'more' : 'add'} ${joinList(m.add)}`);
  }

  // Equipment: what is named narrows what was allowed, or joins it when it was said with "also".
  if (intent.equipment) {
    const had = request.equipment;
    const named = intent.equipment.list;
    if (intent.equipment.add) request.equipment = had && had.length > 0 ? union(had, named) : named;
    else {
      const both = had && had.length > 0 ? named.filter((e) => had.includes(e)) : named;
      request.equipment = both.length > 0 ? both : named;
    }
    asked.push(equipmentWords(request.equipment));
  }

  // How many exercises.
  if (intent.count) {
    const to = intent.count.to ?? Math.max(1, (plan.want || count0) + (intent.count.by ?? 0));
    plan.want = Math.max(1, Math.min(MAX_COUNT, to));
    asked.push(`${plan.want} exercises`);
  }

  // How long.
  const E = Math.max(0, ...routines.map((r) => r.estimateMinutes));
  if (intent.minutes) {
    let M: number;
    if (intent.minutes.to !== undefined) M = intent.minutes.to;
    else if (intent.minutes.by === 'longer') {
      M = Math.min(MAX_MINUTES, ceil5(E * 1.25));
      if (M <= E) M = Math.min(MAX_MINUTES, E + 5);
    } else {
      M = Math.max(MIN_MINUTES, floor5(E * 0.8));
      if (M >= E) M = Math.max(MIN_MINUTES, E - 5);
    }
    M = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, M));
    request.minutes = M;
    plan.trim = true;
    asked.push(`${M} min`);
    // A length longer than the routine takes asks for more exercises: as many as the length is short of.
    if (M > E && count0 > 0 && !intent.count) {
      const each = E / count0;
      plan.want = Math.min(MAX_COUNT, count0 + Math.max(1, Math.ceil((M - E) / Math.max(1, each))));
    }
  }

  // Harder or easier.
  if (intent.effort) {
    request.intensity = Math.max(-MAX_INTENSITY, Math.min(MAX_INTENSITY, (request.intensity ?? 0) + intent.effort));
    plan.effort = intent.effort;
    asked.push(intent.effort > 0 ? 'harder' : 'easier');
  }

  // A routine asked to be longer is no longer the length that was asked for before.
  if (!intent.minutes && single && plan.want > count0) delete request.minutes;

  // A different set of muscles, or a split, means its rows are drawn again.
  if (rebuild) {
    plan.kind = 'rebuild';
    return plan;
  }

  // Compose: the rows that still fit stay, and the routine is as long as it was asked to be.
  if (plan.want < count0) {
    const gone = new Set(victimsFor(rowsOf(0), count0 - plan.want));
    plan.keep = everyRow(0).filter((i) => !gone.has(i));
  }
  // Counts and removals fix the number asked for; a length and an effort leave it where it was.
  if (intent.count || plan.added || m?.exclude || intent.equipment) request.count = plan.want;
  return plan;
}

/** What a swap's replacement words name: muscles and equipment. "Something else" names neither. */
function readReplacement(words: readonly string[]): { muscles: MuscleGroup[]; equipment: Equipment[] } {
  const p = parseQuickRequest(words.join(' '));
  return { muscles: p.options.focus ?? [], equipment: p.options.equipment ?? [] };
}

/** The part of the request an exercise is drawn from, without the pieces that only apply to a whole routine. */
function drawRequest(request: CoachRequest, over: Partial<RoutineRequest>): RoutineRequest {
  const draw: CoachRequest = { ...request, ...over };
  delete draw.split;
  delete draw.intensity;
  delete draw.minutes;
  return draw;
}

/** The routine the generator makes of exactly these exercises, as it would make it: roles, sets, reps and reasons. */
function replay(input: RoutineInput, request: CoachRequest, ids: readonly string[], seed: number, trim: boolean): BuiltRoutine {
  const want = new Set(ids);
  const pool = input.candidates.filter((c) => want.has(c.id));
  const base = drawRequest(request, { count: Math.max(1, ids.length) });
  if (trim && request.minutes !== undefined) base.minutes = request.minutes;
  return buildRoutines({ ...input, candidates: pool }, base, seed)[0]!;
}

/**
 * Up to `need` exercises drawn by the generator for the request, from what is not yet in the routine.
 * The library gives no more than the routine has room for: three in all.
 */
function pickFill(
  input: RoutineInput,
  request: CoachRequest,
  taken: readonly string[],
  need: number,
  seed: number,
  over: { muscles?: readonly MuscleGroup[]; allow?: (c: Candidate) => boolean } = {},
): string[] {
  if (need <= 0) return [];
  const origin = new Map(input.candidates.map((c) => [c.id, c.origin]));
  const had = new Set(taken);
  const libraryHeld = taken.filter((id) => origin.get(id) !== 'own').length;
  const room = MAX_NEW_EXERCISES - libraryHeld;
  const free = input.candidates.filter((c) => !had.has(c.id) && (over.allow ? over.allow(c) : true));
  const draw = (pool: Candidate[], n: number): string[] =>
    buildRoutines({ ...input, candidates: pool }, drawRequest(request, { count: n, ...(over.muscles ? { focus: [...over.muscles] } : {}) }), seed)[0]!.rows.map((r) => r.id);
  if (room <= 0) return draw(free.filter((c) => c.origin === 'own'), need);
  const ids: string[] = [];
  let library = 0;
  for (const id of draw(free, need)) {
    if (origin.get(id) !== 'own') {
      if (library >= room) continue;
      library++;
    }
    ids.push(id);
  }
  if (ids.length < need) {
    const used = new Set(ids);
    ids.push(...draw(free.filter((c) => c.origin === 'own' && !used.has(c.id)), need - ids.length));
  }
  return ids;
}

/** The replacement for a row: another of the same part of the muscle, then the same muscle, never a movement the routine already has while another is on offer. */
function pickReplacement(
  input: RoutineInput,
  request: CoachRequest,
  kept: readonly BuiltRow[],
  row: BuiltRow,
  over: { muscles?: readonly MuscleGroup[]; equipment?: readonly Equipment[] },
  seed: number,
): string | null {
  const keptPatterns = new Set(kept.map((r) => r.pattern));
  const equipmentOk = (c: Candidate) => !over.equipment || over.equipment.length === 0 || over.equipment.includes(c.equipment ?? 'other');
  const muscles = over.muscles && over.muscles.length > 0 ? over.muscles : [row.muscleGroup];
  const ofMuscles = (c: Candidate) => muscles.includes(c.muscleGroup);
  const region = (c: Candidate) => regionOf(c.name, c.muscleGroup);
  const pattern = (c: Candidate) => movementPattern(c.name, c.muscleGroup);
  const sameRegion = (c: Candidate) => (row.region !== null ? region(c) === row.region : pattern(c) === row.pattern);
  const tiers: ((c: Candidate) => boolean)[] = [
    (c) => ofMuscles(c) && sameRegion(c) && !keptPatterns.has(pattern(c)),
    (c) => ofMuscles(c) && sameRegion(c),
    (c) => ofMuscles(c) && !keptPatterns.has(pattern(c)),
  ];
  const keptIds = kept.map((r) => r.id);
  for (const tier of tiers) {
    const [id] = pickFill(input, request, keptIds, 1, seed, { muscles, allow: (c) => c.id !== row.id && equipmentOk(c) && tier(c) });
    if (id !== undefined) return id;
  }
  return null;
}

export interface BuiltEdit {
  routines: BuiltRoutine[];
  request: CoachRequest;
  seed: number;
  /** What the edit came to, as a fact. */
  fact: string;
}

/** The place `row` has among `rows`, by id. */
const placeOf = (rows: readonly BuiltRow[], id: string): number => rows.findIndex((r) => r.id === id);

/** A routine with the line that says what was changed added to its reasons, before the minutes. */
function withFact(routine: BuiltRoutine, fact: string): BuiltRoutine {
  const lines = routine.reasonLines.filter((l) => !l.startsWith('Changed: '));
  const at = lines.findIndex((l) => l.startsWith('About '));
  const next = at === -1 ? [...lines, `Changed: ${fact}`] : [...lines.slice(0, at), `Changed: ${fact}`, ...lines.slice(at)];
  return { ...routine, reasonLines: next };
}

/**
 * The routines an edit plan comes to, and what it came to in a sentence. A plan that cannot be
 * carried out (nothing else for that part of the muscle) leaves the routine as it was and says so.
 */
export function buildEdit(input: RoutineInput, plan: EditPlan, previous: readonly BuiltRoutine[], nextSeed: () => number): BuiltEdit {
  const { request } = plan;
  /** `only` is the one routine of several that was changed: the others are as they were, reasons and all. */
  const finish = (routines: BuiltRoutine[], fact: string, seed = plan.seed, req: CoachRequest = request, only?: number): BuiltEdit => ({
    routines: routines.map((r, i) => (r.rows.length > 0 && (only === undefined || only === i) ? withFact(r, fact) : r)),
    request: req,
    seed,
    fact,
  });
  const before = previous.flatMap((r) => r.rows.map((x) => x.name));

  if (plan.kind === 'shuffle') {
    const { routines, seed } = reshuffle(input, request, previous, nextSeed);
    return finish(routines, 'Same request, another routine', seed);
  }

  if (plan.kind === 'rebuild') {
    const routines = buildCoach(input, request, plan.seed);
    const parts = [rebuiltFact(plan, before, routines)];
    if (plan.effort) parts.push(effortFact(previous.flatMap((r) => r.rows), routines.flatMap((r) => r.rows), plan.effort));
    return finish(routines, parts.join('; '));
  }

  // Compose: one routine, or one routine of several.
  const old = previous[plan.routine]!;
  const keptRows = plan.keep.map((i) => old.rows[i]!);
  // A split day is drawn as a routine of its own: the muscles it has, never the split.
  const day: CoachRequest = { ...request, focus: previous.length > 1 && old.focus.length > 0 ? old.focus : request.focus };
  delete day.split;
  const survivors = replay(input, day, keptRows.map((r) => r.id), plan.seed, false);
  const have = survivors.rows.map((r) => r.id);
  let ids = have;
  let swapped: { from: BuiltRow; to: string } | null = null;
  let stuck: string | null = null;

  if (plan.swap) {
    const row = old.rows[plan.swap.row]!;
    const to = pickReplacement(input, day, survivors.rows, row, { muscles: plan.swap.muscles, equipment: plan.swap.equipment }, plan.seed);
    if (to === null) {
      stuck = row.region ? REGION_LABELS[row.region] ?? patternLabel(row.pattern) : patternLabel(row.pattern);
      ids = old.rows.map((r) => r.id);
    } else {
      ids = [...have, to];
      swapped = { from: row, to };
    }
  } else if (plan.want > have.length) {
    ids = [...have, ...pickFill(input, day, have, plan.want - have.length, plan.seed, { muscles: plan.fillMuscles })];
  }

  let routine = replay(input, day, ids, plan.seed, plan.trim);
  if (swapped) {
    // The replacement takes the place of the row it replaces, where it is the same kind of lift; the rest keep theirs.
    const to = routine.rows.find((r) => r.id === swapped!.to);
    if (to && to.tier === swapped.from.tier) {
      const order = old.rows.map((r) => (r.id === swapped!.from.id ? to : routine.rows.find((x) => x.id === r.id))).filter((r): r is BuiltRow => r !== undefined);
      if (order.length === routine.rows.length) routine = { ...routine, rows: order };
    }
  }
  const steps = request.intensity ?? 0;
  if (steps !== 0) {
    routine = applyIntensity(routine, steps, input).routine;
    // Sets added after the generator's trim can put it back over the length that was asked for.
    if (plan.trim && request.minutes !== undefined) routine = fitMinutes(routine, request.minutes, input);
  }
  if (previous.length > 1) routine = { ...routine, name: old.name };

  const next = previous.map((r, i) => (i === plan.routine ? routine : r));
  const after = routine.rows;
  const added = after.filter((r) => placeOf(old.rows, r.id) === -1);
  const dropped = old.rows.filter((r) => placeOf(after, r.id) === -1);
  const out: CoachRequest = { ...request };
  // What was asked for was a number of exercises: what the routine came to is the number it keeps.
  if (previous.length === 1 && out.count !== undefined && plan.want !== old.rows.length) out.count = after.length;
  // Harder is asked for after a length: the length is no longer what the routine is held to.
  if (plan.effort && !plan.trim && out.minutes !== undefined && routine.estimateMinutes > out.minutes) delete out.minutes;

  let fact: string;
  if (stuck !== null) fact = `Kept ${old.rows[plan.swap!.row]!.name}: nothing else for ${stuck} in your exercises or the library`;
  else if (swapped) fact = `Swapped ${swapped.from.name} for ${after.find((r) => r.id === swapped!.to)!.name}`;
  else fact = composedFact(plan, old, routine, added, dropped);
  return finish(next, fact, plan.seed, out, plan.routine);
}

/** What a harder or easier step did to the sets, from the rows before to the rows after: the sets moved, and where, or that they could not. */
function effortFact(before: readonly BuiltRow[], after: readonly BuiltRow[], step: 1 | -1): string {
  const was = new Map(before.map((r) => [r.id, r.sets]));
  const moved = after.filter((r) => was.has(r.id) && was.get(r.id) !== r.sets);
  if (moved.length === 0) {
    return step > 0 ? `Harder: already at the most sets this goes to (${MAX_SETS_MAIN} on main lifts, ${MAX_SETS_ISOLATION} on the rest)` : `Easier: already at ${MIN_SETS} sets on every lift`;
  }
  const change = moved.reduce((n, r) => n + r.sets - was.get(r.id)!, 0);
  return `${step > 0 ? 'Harder' : 'Easier'}: ${plural(Math.abs(change), 'set')} ${change > 0 ? 'more' : 'fewer'}, on ${names(moved)}`;
}

/** What a routine built afresh from an edited request is, in a sentence. */
function rebuiltFact(plan: EditPlan, before: readonly string[], routines: readonly BuiltRoutine[]): string {
  const after = routines.flatMap((r) => r.rows.map((x) => x.name));
  const kept = after.filter((n) => before.includes(n)).length;
  const asked = plan.asked.length > 0 ? plan.asked.join(', ') : 'edited';
  return kept > 0 ? `${asked}: built again, ${plural(kept, 'exercise')} kept` : `${asked}: built again`;
}

/** What a composed routine came to against the one it was made from. */
function composedFact(plan: EditPlan, old: BuiltRoutine, routine: BuiltRoutine, added: readonly BuiltRow[], dropped: readonly BuiltRow[]): string {
  const parts: string[] = [];
  if (plan.remove) parts.push(`Dropped ${old.rows[plan.remove.row]!.name}`);
  else {
    if (added.length > 0) parts.push(`Added ${names(added)}`);
    if (dropped.length > 0) parts.push(`Dropped ${names(dropped)}`);
  }
  if (plan.added && added.length === 0) parts.push(`Nothing more for ${joinList(plan.added)} in your exercises or the library`);
  // A length asked for takes rows off on purpose: only a count that could not be met is a shortfall.
  else if (!plan.trim && plan.want > routine.rows.length) parts.push(`${routine.rows.length} of ${plan.want}: nothing more in your exercises or the library`);
  if (plan.trim) {
    const m = routine.estimateMinutes;
    parts.push(m === old.estimateMinutes ? `already about ${m} min` : `about ${m} min, was ${old.estimateMinutes}`);
  }
  if (plan.effort) parts.push(effortFact(old.rows, routine.rows, plan.effort));
  if (parts.length === 0) parts.push(plan.excluded ? `No ${muscleWords(plan.excluded)} in this routine` : plan.asked.length > 0 ? `Nothing to change for ${plan.asked.join(', ')}` : 'Nothing to change');
  return parts.join('; ');
}

/** Muscles in words: a named group ("legs", "push") by its name, anything else as a list. */
function muscleWords(muscles: readonly MuscleGroup[]): string {
  const name = routineName(muscles).toLowerCase();
  return name === joinList(muscles).toLowerCase() ? joinList(muscles) : name;
}
