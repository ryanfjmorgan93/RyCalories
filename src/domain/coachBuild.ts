/**
 * What the coach says about a routine it built, in facts — pure. No IO, no clock, no model.
 *
 * `describeRead` is the line under a built routine: what the rules took from the typed words, and
 * how many exercises came of it. `readUsable` says whether they took anything a routine can be
 * built from. `builtTurn` is how a built routine stands in the conversation the model is given.
 */
import { plural } from './format';
import { EQUIPMENT_KINDS } from './types';
import type { QuickOptions, RoutineSplit } from './quickRequest';
import { buildRoutines, joinList, routineName, routineToText, type BuiltRoutine, type RoutineInput, type RoutineRequest } from './routineBuilder';

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
export function describeRead(request: RoutineRequest, routines: readonly BuiltRoutine[]): string {
  if (!requestUsable(request)) return 'nothing specific · full body by need';
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
  return parts.join(' · ');
}

/** What the model is told the coach said when it built a routine: the routine itself is in the prompt's own block. */
export function builtTurn(routines: readonly BuiltRoutine[]): string {
  return `Routine built: ${routines.map((r) => r.name).join(', ')}`;
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
  request: RoutineRequest,
  current: readonly BuiltRoutine[],
  nextSeed: () => number,
): { routines: BuiltRoutine[]; seed: number } {
  const before = routineToText(current);
  let seed = nextSeed();
  let routines = buildRoutines(input, request, seed);
  for (let tries = 1; tries < SHUFFLE_TRIES && routineToText(routines) === before; tries++) {
    seed = nextSeed();
    routines = buildRoutines(input, request, seed);
  }
  return { routines, seed };
}
