/**
 * What the coach can DO, as plain async functions the tools (tools.ts) call.
 *
 * `CoachActions` is the interface; `createCoachActions` is the real implementation over the app's
 * own data code: foodRepo for meals, repo.ts for weigh-ins, routines and the live session, the
 * exercise matcher for names, and the deterministic routine builder. Every action returns an
 * `ActionResult`:
 *   - `result`: one line handed back to the model (what happened, or why it did not);
 *   - `description`: the short human line shown under the coach's reply ("Bench press: 3 sets
 *     today"), present only when something actually changed.
 * An action never throws for a bad request (an unknown exercise, a number out of range): it
 * returns `ok: false` with a reason the model can act on. Only a broken database throws.
 *
 * What is not here, on purpose: writing a per-session plan override. `repo.setPlanOverride` is
 * added by the training-engine work and is taken as a parameter (`deps.setPlanOverride`) so this
 * file has no import of it. Until it is supplied, changing today's sets, reps or weight answers
 * that it cannot.
 *
 * Food goes in by the same road as the Add food screen's Describe: what the model gives is a
 * reading (state/claudeFood.ts `logReadings`), matched against the owner's remembered foods and the
 * UK table before its own figures are used (docs/adr/0004), and appended to that day's meal for the
 * slot (foodRepo `logItemsToSlot`) rather than made a meal of its own.
 */
import { BUILD_LABEL } from '@/buildInfo';
import { findExerciseAnywhere, type ExercisePick } from '@/db/catalogueRepo';
import { db } from '@/db/db';
import { addProblemReport } from '@/db/problemRepo';
import { dayTotals } from '@/db/foodRepo';
import {
  addExtraExercise,
  addRoutineExercise,
  getActiveSession,
  getSettings,
  linkedSiblings,
  listRoutines,
  lockInRoutineExercise,
  logBodyweight,
  removeRoutineExercise,
  routineItems,
  setSkipped,
  setsForSlot,
  swapExercise,
  undoSwap,
  updateRoutineExercise,
} from '@/db/repo';
import { loadRoutineInput } from '@/db/routineBuildQueries';
import { buildCoach, describeRead, emptyReasonLines, nothingFact, requestUsable, type CoachRequest } from '@/domain/coachBuild';
import { nowIso, recentDayProblem, toDateKey } from '@/domain/dates';
import { lockInBlocked, roundKg } from '@/domain/engine';
import { matchExercise, normaliseName, type MatchCandidate } from '@/domain/exerciseMatch';
import { displayMacros, reconcileMacros } from '@/domain/food';
import { slotForHour } from '@/domain/mealSlot';
import { fmtDayHeading } from '@/domain/claudeSummary';
import { fmtKg, fmtNum, fmtRange, plural } from '@/domain/format';
import { uuid } from '@/domain/ids';
import { effectiveRx } from '@/domain/planOverride';
import { parseQuickRequest, type RoutineSplit } from '@/domain/quickRequest';
import { routineRequestFrom, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { MEAL_SLOTS, type Exercise, type MealSlot, type MuscleGroup, type Routine, type RoutineExercise, type Session } from '@/domain/types';
import { logReadings } from '@/state/claudeFood';
import { noteShortId } from './context';
import { createOfferActions, type OfferActions } from './offerActions';
import type { PlanOverridePatch, SetPlanOverride } from './types';
import type { MealReadingItem } from './vision';

// ---------------------------------------------------------------------------
// Interface

export interface ActionResult {
  ok: boolean;
  /** One line for the model: what happened, or why it could not. */
  result: string;
  /** One short line for the owner, when something changed. */
  description?: string;
}

export interface LogFoodItem {
  name: string;
  /** How many of `unit` ("2", "0.5"). */
  amount: number;
  /** What it is counted in ("slices", "eggs", "bowl", "g"). */
  unit: string;
  /** The weight of the whole amount in grams, when known. */
  grams?: number;
  /** Energy and macros for the WHOLE amount eaten, not per 100 g. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface LogFoodInput {
  items: LogFoodItem[];
  /** Defaults to the slot the time of day suggests (today only: an earlier day needs one). */
  slot?: MealSlot;
  /** YYYY-MM-DD, today or up to a week back. Defaults to today. */
  date?: string;
}

/** How far back the coach may log a meal. Older days are the owner's to fill in on the Food screen. */
export const FOOD_DAYS_BACK = 7;

export interface LogWeightInput {
  kg: number;
  /** YYYY-MM-DD. Defaults to today. */
  date?: string;
}

export type RoutineChange = 'sets' | 'reps' | 'weight' | 'add' | 'remove';

export interface EditRoutineInput {
  routine: string;
  exercise: string;
  change: RoutineChange;
  sets?: number;
  repMin?: number;
  repMax?: number;
  weightKg?: number;
}

export interface BuildRoutineInput {
  /** What the owner asked for, in their words. The app's rule reader takes what it can from it. */
  request: string;
  /** What the model read from the request, used only where the rules read nothing. */
  focus?: MuscleGroup[];
  count?: number;
  minutes?: number;
  split?: RoutineSplit;
  /** How hard the model read the request to be; "easy" builds a light routine. */
  effort?: 'easy' | 'normal' | 'hard';
}

export interface BuildRoutineResult extends ActionResult {
  draft?: { routines: BuiltRoutine[]; text: string };
}

export type SessionChange = 'sets' | 'reps' | 'weight' | 'swap' | 'skip' | 'unskip' | 'add';

export interface EditSessionInput {
  /** For sets, reps, weight, swap, skip and unskip: an exercise in today's session. For add: the exercise to add. */
  exercise: string;
  change: SessionChange;
  sets?: number;
  repMin?: number;
  repMax?: number;
  weightKg?: number;
  /** The exercise to do instead, for a swap. */
  swapTo?: string;
}

export interface CoachActions {
  logFood(input: LogFoodInput): Promise<ActionResult>;
  logWeight(input: LogWeightInput): Promise<ActionResult>;
  remember(text: string): Promise<ActionResult>;
  forget(id: string): Promise<ActionResult>;
  editRoutine(input: EditRoutineInput): Promise<ActionResult>;
  buildRoutine(input: BuildRoutineInput): Promise<BuildRoutineResult>;
  editSession(input: EditSessionInput): Promise<ActionResult>;
  proposeTargets: OfferActions['proposeTargets'];
  suggestSupplement: OfferActions['suggestSupplement'];
  tickSupplements: OfferActions['tickSupplements'];
  reportProblem(input: ReportProblemInput): Promise<ActionResult>;
}

export interface ReportProblemInput {
  summary: string;
  detail: string;
}

export interface ActionDeps {
  /** Writes `Session.planOverrides[routineExerciseId]`. Supplied by the app's wiring; see the file note. */
  setPlanOverride?: SetPlanOverride;
  /** The clock, for the slot guess and today's date. */
  now?: () => Date;
  /** A seed for the routine builder, which never reads a random source itself. */
  seed?: () => number;
}

// ---------------------------------------------------------------------------
// Helpers

const fail = (result: string): ActionResult => ({ ok: false, result });

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function candidatesOf(exercises: readonly Pick<Exercise, 'id' | 'name' | 'aliases'>[]): MatchCandidate[] {
  return exercises.map((e) => ({ id: e.id, name: e.name, ...(e.aliases ? { aliases: e.aliases } : {}) }));
}

/** Words people put round a routine's name that are not part of it: "my push day", "the leg workout". */
const ROUTINE_FILLER = new Set(['my', 'the', 'a', 'day', 'days', 'routine', 'workout', 'session', 'training']);

function routineWords(s: string): string[] {
  return normaliseName(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/**
 * A routine by the name the owner used: exact; then the one routine whose name has all the words they
 * said ("push day" is "Upper (Push)"); then one whose name contains theirs or the reverse; then the
 * exercise matcher's fuzzy read. More than one routine that fit equally is no answer (null).
 */
export function findRoutine(name: string, routines: readonly Routine[]): Routine | null {
  const key = normaliseName(name);
  if (!key) return null;
  const exact = routines.find((r) => normaliseName(r.name) === key);
  if (exact) return exact;
  const said = routineWords(name).filter((w) => !ROUTINE_FILLER.has(w));
  if (said.length > 0) {
    const fits = routines.filter((r) => {
      const words = routineWords(r.name);
      return said.every((w) => words.includes(w));
    });
    if (fits.length === 1) return fits[0]!;
    if (fits.length > 1) return null;
  }
  const contains = routines.filter((r) => {
    const n = normaliseName(r.name);
    return n.includes(key) || key.includes(n);
  });
  if (contains.length === 1) return contains[0]!;
  const m = matchExercise(name, routines.map((r) => ({ id: r.id, name: r.name })));
  return m ? (routines.find((r) => r.id === m.id) ?? null) : null;
}

function names(list: readonly string[], max = 12): string {
  return list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', ');
}

function repsText(min: number, max: number): string {
  return `${fmtRange(min, max)} reps`;
}

// ---------------------------------------------------------------------------
// Today's session, as the live screen has it

/**
 * What a place in today's session is:
 *   planned      a routine exercise that is on (it has a plan: sets, reps, weight);
 *   skipped      a routine exercise skipped for today;
 *   swapped-out  a routine exercise swapped for another, so skipped, with `partner` doing its job;
 *   substitute   the exercise swapped in: an extra, with no plan, standing where `rx` was;
 *   extra        an exercise added for today, with no plan.
 */
type SlotKind = 'planned' | 'skipped' | 'swapped-out' | 'substitute' | 'extra';

interface SessionSlot {
  /** What the matcher answers with: `rx:<id>` for a routine exercise, `x:<exercise id>` for an extra. */
  key: string;
  kind: SlotKind;
  exercise: Exercise;
  /** The routine exercise: itself, or the one a substitute stands in for. */
  rx?: RoutineExercise;
  /** The other half of a swap: the substitute for a swapped-out slot, the original for a substitute. */
  partner?: Exercise;
}

/** Every place in the session: the routine's exercises (skipped and swapped ones too) and the extras, in screen order. */
async function sessionSlots(session: Session): Promise<SessionSlot[]> {
  const items = await routineItems(session.routineId);
  const skipped = new Set(session.skippedRoutineExerciseIds ?? []);
  const swaps = session.swaps ?? {};
  const extras = (await db.exercises.bulkGet(session.extraExerciseIds ?? [])).filter((e): e is Exercise => !!e);
  const extraById = new Map(extras.map((e) => [e.id, e]));
  const slots: SessionSlot[] = [];
  for (const { rx, exercise } of items) {
    const swappedFor = swaps[rx.id] ? extraById.get(swaps[rx.id]!) : undefined;
    if (!skipped.has(rx.id)) slots.push({ key: `rx:${rx.id}`, kind: 'planned', exercise, rx });
    else if (swappedFor) slots.push({ key: `rx:${rx.id}`, kind: 'swapped-out', exercise, rx, partner: swappedFor });
    else slots.push({ key: `rx:${rx.id}`, kind: 'skipped', exercise, rx });
  }
  for (const exercise of extras) {
    const rxId = Object.keys(swaps).find((id) => swaps[id] === exercise.id && skipped.has(id));
    const original = rxId ? items.find((i) => i.rx.id === rxId) : undefined;
    if (original) slots.push({ key: `x:${exercise.id}`, kind: 'substitute', exercise, rx: original.rx, partner: original.exercise });
    else slots.push({ key: `x:${exercise.id}`, kind: 'extra', exercise });
  }
  return slots;
}

/** A slot as the model is told of it when listing what the session has. */
function slotLabel(slot: SessionSlot): string {
  switch (slot.kind) {
    case 'planned':
      return slot.exercise.name;
    case 'skipped':
      return `${slot.exercise.name} (skipped)`;
    case 'swapped-out':
      return `${slot.exercise.name} (swapped out for ${slot.partner!.name})`;
    case 'substitute':
      return `${slot.exercise.name} (swapped in for ${slot.partner!.name})`;
    case 'extra':
      return `${slot.exercise.name} (added today)`;
  }
}

/** Why a slot has no sets, reps or weight to change. Only a planned exercise has a plan. */
function noPlanReason(slot: SessionSlot): string {
  const name = slot.exercise.name;
  switch (slot.kind) {
    case 'skipped':
      return `${name} is skipped today, so there is no plan to change. Put it back first.`;
    case 'swapped-out':
      return `${name} is swapped for ${slot.partner!.name} today, so there is no plan to change. ${slot.partner!.name} is an extra in today's session and has no sets, reps or weight to set.`;
    case 'substitute':
      return `${name} is standing in for ${slot.partner!.name} today as an extra, with no sets, reps or weight to set. Only a planned exercise has them.`;
    case 'extra':
      return `${name} was added to today's session as an extra, with no sets, reps or weight to set.`;
    case 'planned':
      return '';
  }
}

/** The id of the session whose Summary screen is open right now, or null. That screen has already judged the session. */
function summaryOpenFor(): string | null {
  try {
    const m = /^\/session\/([^/]+)\/summary\/?$/.exec(window.location.pathname);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

/** The first of `rxs` that already has a set logged in the live session, or null. */
async function loggedInLiveSession(rxs: readonly RoutineExercise[]): Promise<RoutineExercise | null> {
  const live = await getActiveSession();
  if (!live) return null;
  for (const rx of rxs) {
    if (rx.routineId !== live.routineId) continue;
    if ((await db.setLogs.where('[sessionId+routineExerciseId]').equals([live.id, rx.id]).count()) > 0) return rx;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Implementation

export function createCoachActions(deps: ActionDeps = {}): CoachActions {
  const now = () => (deps.now ? deps.now() : new Date());
  const today = () => toDateKey(now());

  /** Why a name found nothing to add: nothing near it, or only a library entry it does not exactly name. */
  function notFound(name: string, pick: Extract<ExercisePick, { kind: 'closest' }> | null) {
    return fail(
      pick
        ? `No exercise called "${name}". The closest in the app's library is "${pick.name}"; to use it, ask for it by that name.`
        : `No exercise called "${name}" among the owner's exercises or in the app's library.`,
    );
  }

  /** The numbers of a sets / reps / weight change, checked, as the patch they make. */
  function numbersOf(input: Pick<EditRoutineInput, 'sets' | 'repMin' | 'repMax' | 'weightKg'>, rx: RoutineExercise, exercise: Exercise): { patch: PlanOverridePatch } | { error: string } {
    const patch: PlanOverridePatch = {};
    if (input.sets !== undefined) {
      if (!finite(input.sets) || input.sets < 1 || input.sets > 10) return { error: 'Sets must be between 1 and 10.' };
      patch.targetSets = Math.round(input.sets);
    }
    if (input.repMin !== undefined || input.repMax !== undefined) {
      const top = exercise.kind === 'timed' ? 600 : 100;
      const lo = input.repMin;
      const hi = input.repMax;
      for (const v of [lo, hi]) if (v !== undefined && (!finite(v) || v < 1 || v > top)) return { error: `Reps must be between 1 and ${top}.` };
      const min = Math.round(lo ?? Math.min(rx.repMin, hi ?? rx.repMin));
      const max = Math.round(hi ?? Math.max(rx.repMax, min));
      if (min > max) return { error: 'The rep range is the wrong way round.' };
      patch.repMin = min;
      patch.repMax = max;
    }
    if (input.weightKg !== undefined) {
      if (!finite(input.weightKg) || lockInBlocked(roundKg(input.weightKg), exercise.kind) || input.weightKg > 1000) return { error: 'That weight does not look right.' };
      patch.weight = roundKg(input.weightKg);
    }
    if (Object.keys(patch).length === 0) return { error: 'Say what to change: sets, reps or weight.' };
    return { patch };
  }

  function patchText(patch: PlanOverridePatch, exercise: Exercise): string {
    const parts: string[] = [];
    if (patch.targetSets !== undefined) parts.push(plural(patch.targetSets, 'set'));
    if (patch.repMin !== undefined && patch.repMax !== undefined) parts.push(repsText(patch.repMin, patch.repMax));
    if (patch.weight !== undefined) parts.push(exercise.kind === 'bodyweight_plus' && patch.weight === 0 ? 'bodyweight' : fmtKg(patch.weight));
    return parts.join(', ');
  }

  return {
    ...createOfferActions(now),
    // ---- food
    async logFood({ items, slot, date }) {
      if (!Array.isArray(items) || items.length === 0) return fail('Nothing to log: no foods were given.');
      const day = date ?? today();
      const wrongDay = recentDayProblem(day, today(), FOOD_DAYS_BACK);
      if (wrongDay) return fail(wrongDay);
      if (day !== today() && !(slot && MEAL_SLOTS.includes(slot))) return fail('Which meal was that: breakfast, lunch, dinner or snack?');

      const readings: MealReadingItem[] = [];
      for (const it of items) {
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!name) return fail('A food had no name.');
        const macros = { kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat };
        if (![it.amount, it.kcal, it.protein, it.carbs, it.fat].every(finite) || Object.values(macros).some((v) => v < 0) || !(it.amount > 0)) {
          return fail(`The numbers for ${name} do not look right.`);
        }
        // The photo reader's rule: raise a calorie figure the macros contradict, never lower one.
        const fixed = reconcileMacros(macros).macros;
        if (fixed.kcal > 5000 || Math.max(fixed.protein, fixed.carbs, fixed.fat) > 1000) return fail(`${name} at ${fmtNum(fixed.kcal)} kcal is too much for one item. Check the amount.`);
        const unit = (it.unit ?? '').trim();
        const isGrams = /^(g|gram|grams)$/i.test(unit);
        const grams = it.grams !== undefined && finite(it.grams) && it.grams > 0 ? it.grams : isGrams ? it.amount : 0;
        readings.push({ name, amount: it.amount, unit: unit || 'portion', grams: Math.round(grams), ...fixed, confidence: 'medium' });
      }

      const useSlot = slot && MEAL_SLOTS.includes(slot) ? slot : slotForHour(now().getHours());
      // The Describe road: known foods keep their own figures, the rest are the model's (estimates),
      // and the items join the day's meal for the slot.
      const logged = await logReadings({ date: day, slot: useSlot }, readings, { enteredText: readings.map((r) => r.name).join(', ').slice(0, 280) });
      const protein = logged.items.reduce((sum, i) => sum + displayMacros(i.nutrition).protein, 0);
      const totals = await dayTotals(day);
      const list = names(logged.items.map((i) => i.name), 6);
      const on = day === today() ? '' : ` on ${fmtDayHeading(day)}`;
      return {
        ok: true,
        result: `Logged ${plural(logged.count, 'item')} for ${useSlot}${on}: ${list}, about ${fmtNum(Math.round(logged.kcal))} kcal and ${fmtNum(Math.round(protein))} g protein (estimates). ${day === today() ? 'Today' : fmtDayHeading(day)} so far: ${fmtNum(Math.round(totals.kcal))} kcal, ${fmtNum(Math.round(totals.protein))} g protein.`,
        description: `Logged ${list} for ${useSlot}${on} (≈${fmtNum(Math.round(logged.kcal))} kcal)`,
      };
    },

    // ---- weight
    async logWeight({ kg, date }) {
      if (!finite(kg) || kg < 30 || kg > 300) return fail('That does not look like a body weight in kg.');
      const day = date ?? today();
      const wrongDay = recentDayProblem(day, today(), FOOD_DAYS_BACK);
      if (wrongDay) return fail(wrongDay);
      const entry = await logBodyweight(day, kg);
      return { ok: true, result: `Logged ${fmtKg(entry.kg)} for ${day}.`, description: `Weigh-in: ${fmtKg(entry.kg)}${day === today() ? '' : ` (${day})`}` };
    },

    // ---- notes
    async remember(text) {
      const clean = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
      if (!clean) return fail('There was nothing to remember.');
      if (clean.length > 300) return fail('Too long. Keep a note to one short sentence.');
      const existing = await db.coachNotes.toArray();
      const dupe = existing.find((n) => n.text.trim().toLowerCase() === clean.toLowerCase());
      if (dupe) return { ok: true, result: `Already noted as [${noteShortId(dupe.id)}].` };
      const id = uuid();
      await db.coachNotes.put({ id, createdAt: nowIso(), text: clean });
      return { ok: true, result: `Noted as [${noteShortId(id)}].`, description: `Noted: ${clean}` };
    },

    async forget(id) {
      const key = typeof id === 'string' ? id.trim().replace(/^\[|\]$/g, '') : '';
      if (!key) return fail('Which note? Give its id from the notes list.');
      const notes = await db.coachNotes.toArray();
      const hits = notes.filter((n) => n.id === key || n.id.startsWith(key));
      if (hits.length !== 1) return fail(hits.length === 0 ? `No note with id ${key}.` : `More than one note starts with ${key}. Give more of the id.`);
      await db.coachNotes.delete(hits[0]!.id);
      return { ok: true, result: `Forgot [${noteShortId(hits[0]!.id)}].`, description: `Forgot: ${hits[0]!.text.trim()}` };
    },

    // ---- routines
    async editRoutine(input) {
      const routines = await listRoutines();
      const routine = findRoutine(input.routine, routines);
      if (!routine) return fail(`No routine called "${input.routine}". The routines are: ${names(routines.map((r) => r.name))}.`);
      const items = await routineItems(routine.id);

      if (input.change === 'add') {
        const pick = await findExerciseAnywhere(input.exercise);
        if (!pick || pick.kind === 'closest') return notFound(input.exercise, pick);
        const fromLibrary = pick.kind === 'library';
        const exercise = pick.kind === 'owned' ? pick.exercise : await pick.add();
        if (items.some((it) => it.exercise.id === exercise.id)) return fail(`${exercise.name} is already in ${routine.name}.`);
        const rx = await addRoutineExercise(routine.id, exercise.id);
        const numbers = input.sets !== undefined || input.repMin !== undefined || input.repMax !== undefined || input.weightKg !== undefined ? numbersOf(input, rx, exercise) : null;
        const added = fromLibrary ? ` ${exercise.name} was not one of their exercises: it came from the library and is theirs now, with no weight history.` : '';
        if (numbers && 'error' in numbers) return { ok: true, result: `Added ${exercise.name} to ${routine.name} with the default sets and reps. ${numbers.error}${added}`, description: `Added ${exercise.name} to ${routine.name}` };
        if (numbers) await applyToRoutine(rx, numbers.patch);
        const extra = numbers ? `: ${patchText(numbers.patch, exercise)}` : '';
        return { ok: true, result: `Added ${exercise.name} to ${routine.name}${extra}.${added}`, description: `Added ${exercise.name} to ${routine.name}${extra}` };
      }

      const m = matchExercise(input.exercise, candidatesOf(items.map((it) => ({ id: it.rx.id, name: it.exercise.name, aliases: it.exercise.aliases }))));
      const item = m ? items.find((it) => it.rx.id === m.id) : undefined;
      if (!item) return fail(`No exercise matching "${input.exercise}" in ${routine.name}. It has: ${names(items.map((it) => it.exercise.name))}.`);
      // A guess is fine for sets and reps; removing or reweighing the wrong exercise is not.
      if (m!.score < 1 && (input.change === 'remove' || input.change === 'weight'))
        return fail(`No exercise called "${input.exercise}" in ${routine.name}. The closest is ${item.exercise.name}: ask for it by that name.`);

      // A session is live on this routine and this exercise already has sets in it: removing it would
      // strand those sets, and a new set count, rep range or weight would move the goalposts the session
      // is judged against at its Summary. A weight is also copied to the linked copies of the exercise
      // in other routines, so one of those being done today counts too.
      const touched = input.change === 'weight' ? [item.rx, ...(await linkedSiblings(item.rx))] : [item.rx];
      if (await loggedInLiveSession(touched)) {
        return fail(`${item.exercise.name} has sets logged in today's session; change it after the owner finishes, or change today only (edit_session).`);
      }

      if (input.change === 'remove') {
        await removeRoutineExercise(item.rx.id);
        return { ok: true, result: `Removed ${item.exercise.name} from ${routine.name}.`, description: `Removed ${item.exercise.name} from ${routine.name}` };
      }

      const numbers = numbersOf(
        {
          sets: input.change === 'sets' ? input.sets : undefined,
          repMin: input.change === 'reps' ? input.repMin : undefined,
          repMax: input.change === 'reps' ? input.repMax : undefined,
          weightKg: input.change === 'weight' ? input.weightKg : undefined,
        },
        item.rx,
        item.exercise,
      );
      if ('error' in numbers) return fail(numbers.error);
      await applyToRoutine(item.rx, numbers.patch);
      const what = patchText(numbers.patch, item.exercise);
      return { ok: true, result: `${item.exercise.name} in ${routine.name} is now ${what}.`, description: `${item.exercise.name}: ${what} in ${routine.name}` };
    },

    async buildRoutine(input) {
      const settings = await getSettings();
      const routineInput = await loadRoutineInput({ today: today(), settings });
      const parsed = parseQuickRequest(typeof input.request === 'string' ? input.request : '');
      const request: CoachRequest = routineRequestFrom(parsed);
      // The rules read the words first; what the model read fills only what they left empty.
      if (request.focus.length === 0 && !request.split && input.focus?.length) request.focus = [...input.focus];
      if (request.count === undefined && finite(input.count)) request.count = Math.max(1, Math.min(12, Math.round(input.count)));
      if (request.minutes === undefined && finite(input.minutes)) request.minutes = Math.max(10, Math.min(90, Math.round(input.minutes)));
      if (!request.split && input.split) request.split = input.split;
      // An easy day the words did not already say: the model read it from the conversation.
      if (input.effort === 'easy') request.light = true;
      if (input.effort === 'hard' && !request.light) request.intensity = Math.max(request.intensity ?? 0, 1);
      if (!requestUsable(request)) return { ok: false, result: 'Nothing to build from. Ask which muscles, a split (push pull legs, upper lower, full body), how many exercises or how long.' };

      const seed = deps.seed ? deps.seed() : Math.floor(Math.random() * 0x100000000);
      const routines = buildCoach(routineInput, request, seed);
      const built = routines.filter((r) => r.rows.length > 0);
      if (built.length === 0) return { ok: false, result: `Built nothing: ${routines.map(nothingFact).join('; ')}. ${routines.flatMap(emptyReasonLines).join('. ')}`.trim() };
      const text = routineToText(built);
      const read = describeRead(request, built);
      return {
        ok: true,
        result: `Draft ready, not saved (${read}):\n${text}`,
        description: `Drafted ${built.map((r) => r.name).join(', ')}: ready to save`,
        draft: { routines: built, text },
      };
    },

    // ---- problems
    async reportProblem({ summary, detail }) {
      const screen = typeof window !== 'undefined' ? window.location.pathname : undefined;
      const report = await addProblemReport({ source: 'coach', summary, detail, screen, build: BUILD_LABEL }, now());
      if (!report) return fail('Nothing to report: give a one-line summary of what went wrong.');
      return { ok: true, result: 'Logged on the phone. The owner can share it from Settings → Problem reports.', description: `Problem logged: ${report.summary}` };
    },

    // ---- today's session
    async editSession(input) {
      const session = await getActiveSession();
      if (!session) return fail('No session is live, so there is nothing to change for today. Use the routine instead if they want it permanent.');
      // The Summary screen has already judged the session; a change now would only make what it shows untrue.
      if (summaryOpenFor() === session.id) {
        return fail("Today's session is finished and waiting on the Summary screen, so it cannot be changed now. Use the routine instead if they want it permanent.");
      }
      const slots = await sessionSlots(session);

      if (input.change === 'add') {
        const pick = await findExerciseAnywhere(input.exercise);
        if (!pick || pick.kind === 'closest') return notFound(input.exercise, pick);
        // The same exclusion as the Add exercise picker: anything already in the session, skipped or swapped out included.
        // A library entry is not one of theirs yet, so it cannot already be there.
        const exercise = pick.kind === 'owned' ? pick.exercise : await pick.add();
        const there = slots.find((s) => s.exercise.id === exercise.id);
        if (there?.kind === 'skipped') return fail(`${exercise.name} is in today's session but skipped. Put it back (unskip) instead of adding it again.`);
        if (there?.kind === 'swapped-out') return fail(`${exercise.name} is in today's session but swapped for ${there.partner!.name}. Undo the swap (unskip) to put it back.`);
        if (there) return fail(`${exercise.name} is already in today's session.`);
        await addExtraExercise(session.id, exercise.id);
        const added = pick.kind === 'library' ? ` ${exercise.name} came from the library and is one of their exercises now, with no weight history.` : '';
        return { ok: true, result: `Added ${exercise.name} to today's session.${added}`, description: `${exercise.name} added today` };
      }

      const m = matchExercise(input.exercise, candidatesOf(slots.map((s) => ({ id: s.key, name: s.exercise.name, aliases: s.exercise.aliases }))));
      const slot = m ? slots.find((s) => s.key === m.id) : undefined;
      if (!slot) return fail(`No exercise matching "${input.exercise}" in today's session. It has: ${names(slots.map(slotLabel))}.`);
      if (m!.score < 1 && input.change === 'weight')
        return fail(`No exercise called "${input.exercise}" in today's session. The closest is ${slot.exercise.name}: ask for it by that name.`);
      const name = slot.exercise.name;

      switch (input.change) {
        case 'skip':
          switch (slot.kind) {
            case 'planned':
              await setSkipped(session.id, slot.rx!.id, true);
              return { ok: true, result: `${name} is skipped for today.`, description: `${name} skipped today` };
            case 'skipped':
              return { ok: true, result: `${name} is already skipped today.` };
            case 'swapped-out':
              return { ok: true, result: `${name} is already swapped for ${slot.partner!.name} today.` };
            case 'substitute':
              return fail(`${name} is standing in for ${slot.partner!.name} today. To drop it, undo the swap by unskipping ${slot.partner!.name}.`);
            case 'extra':
              return fail(`${name} was added to today's session, so there is nothing to skip. It stays until the owner removes it.`);
          }

        case 'unskip':
          switch (slot.kind) {
            case 'planned':
              return { ok: true, result: `${name} is already in today's session.` };
            case 'skipped':
              await setSkipped(session.id, slot.rx!.id, false);
              return { ok: true, result: `${name} is back in today's session.`, description: `${name} back in today` };
            case 'swapped-out': {
              // Undoing a swap deletes the substitute's sets with it, so not once any are logged.
              const done = (await setsForSlot(session.id, null, slot.partner!.id)).length;
              if (done > 0) return fail(`${slot.partner!.name} has ${plural(done, 'set')} logged today, and undoing the swap would delete them. Leave the swap as it is.`);
              await undoSwap(session.id, slot.rx!.id);
              return { ok: true, result: `${name} is back in today's session; the swap for ${slot.partner!.name} is undone.`, description: `${name} back in today` };
            }
            case 'substitute':
              return fail(`${name} is today's swap for ${slot.partner!.name}. Unskip ${slot.partner!.name} to undo the swap.`);
            case 'extra':
              return fail(`${name} is not skipped: it was added to today's session.`);
          }

        case 'swap': {
          if (!input.swapTo) return fail('Swap for which exercise?');
          if (slot.kind === 'extra') return fail(`${name} was added to today's session rather than planned, so there is nothing to swap it for.`);
          const pick = await findExerciseAnywhere(input.swapTo);
          if (!pick || pick.kind === 'closest') return notFound(input.swapTo, pick);
          // A library entry is not one of theirs yet: none of the checks against the session can match it,
          // and it is only added once the swap is going ahead, so a refused swap leaves no new exercise behind.
          const owned = pick.kind === 'owned' ? pick.exercise : null;
          const subName = pick.kind === 'owned' ? pick.exercise.name : pick.name;
          // The slot is the routine exercise; asking about its substitute means the same slot.
          const original = slot.kind === 'substitute' ? slot.partner! : slot.exercise;
          const current = slot.kind === 'swapped-out' ? slot.partner! : slot.exercise;
          if (owned?.id === current.id) return fail('That is the same exercise.');
          if (owned?.id === original.id) return fail(`${original.name} is the exercise being swapped out. Unskip it to put it back.`);
          // The same exclusion as the swap sheet: nothing already in the session, or it would get a second card.
          if (owned && slots.some((s) => s.exercise.id === owned.id)) return fail(`${owned.name} is already in today's session.`);
          const rx = slot.rx!;
          const earlier = slot.kind === 'swapped-out' ? slot.partner : slot.kind === 'substitute' ? slot.exercise : undefined;
          if (earlier) {
            // A second swap on the slot replaces the first: undo it, or its substitute would be left behind as an extra.
            const done = (await setsForSlot(session.id, null, earlier.id)).length;
            if (done > 0) return fail(`${earlier.name} has ${plural(done, 'set')} logged today, so it cannot be swapped out. Leave it, or add ${subName} as an extra.`);
            await undoSwap(session.id, rx.id);
          }
          const sub = pick.kind === 'owned' ? pick.exercise : await pick.add();
          await swapExercise(session.id, rx.id, sub.id);
          const added = owned ? '' : ` ${sub.name} came from the library and is one of their exercises now, with no weight history.`;
          return { ok: true, result: `${original.name} is swapped for ${sub.name} today.${added}`, description: `${original.name} swapped for ${sub.name} today` };
        }

        case 'sets':
        case 'reps':
        case 'weight': {
          // Sets, reps and weight are a routine exercise's plan; a skipped, swapped or added exercise has none today.
          if (slot.kind !== 'planned') return fail(noPlanReason(slot));
          const rx = slot.rx!;
          // A calibrating exercise has no weight to change: the override would be dropped without a word.
          if (input.change === 'weight' && rx.mode === 'calibrating') {
            return fail(`${name} is still calibrating, so it has no working weight to change for today. Setting one in the routine (edit_routine) would lock it in for good.`);
          }
          // A bound left out comes from today's plan, which may already be changed, not from the saved routine.
          const numbers = numbersOf(
            {
              sets: input.change === 'sets' ? input.sets : undefined,
              repMin: input.change === 'reps' ? input.repMin : undefined,
              repMax: input.change === 'reps' ? input.repMax : undefined,
              weightKg: input.change === 'weight' ? input.weightKg : undefined,
            },
            effectiveRx(rx, session),
            slot.exercise,
          );
          if ('error' in numbers) return fail(numbers.error);
          if (!deps.setPlanOverride) return fail("I can't change today's sets, reps or weight yet. Say the change and the owner can make it on the exercise.");
          await deps.setPlanOverride(session.id, rx.id, numbers.patch);
          const what = patchText(numbers.patch, slot.exercise);
          return { ok: true, result: `${name} is ${what} today only. The routine is unchanged.`, description: `${name}: ${what} today` };
        }
      }
      return fail(`"${String(input.change)}" is not something that can be changed in today's session.`);
    },
  };
}

/** Apply a checked sets / reps / weight patch to a routine-exercise, the way the routine editor does. */
async function applyToRoutine(rx: RoutineExercise, patch: PlanOverridePatch): Promise<void> {
  const fields: Partial<Omit<RoutineExercise, 'id' | 'routineId'>> = {};
  if (patch.targetSets !== undefined) {
    fields.targetSets = patch.targetSets;
    // A range upper bound below the new count would contradict it.
    if (rx.targetSetsMax !== undefined && rx.targetSetsMax <= patch.targetSets) fields.targetSetsMax = undefined;
  }
  if (patch.repMin !== undefined) fields.repMin = patch.repMin;
  if (patch.repMax !== undefined) fields.repMax = patch.repMax;
  if (Object.keys(fields).length > 0) await updateRoutineExercise(rx.id, fields);
  if (patch.weight !== undefined) {
    // A calibrating exercise ignores its weight; naming one is a lock-in, the way the app records it.
    if (rx.mode === 'calibrating') await lockInRoutineExercise(rx.id, patch.weight);
    else await updateRoutineExercise(rx.id, { currentWeight: patch.weight });
  }
}
