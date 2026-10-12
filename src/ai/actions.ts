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
 */
import { db } from '@/db/db';
import { addMeal, dayTotals, type NewMealItem } from '@/db/foodRepo';
import {
  addExtraExercise,
  addRoutineExercise,
  getActiveSession,
  getSettings,
  listRoutines,
  lockInRoutineExercise,
  logBodyweight,
  removeRoutineExercise,
  routineItems,
  setSkipped,
  swapExercise,
  updateRoutineExercise,
} from '@/db/repo';
import { loadRoutineInput } from '@/db/routineBuildQueries';
import { buildCoach, describeRead, emptyReasonLines, nothingFact, requestUsable, type CoachRequest } from '@/domain/coachBuild';
import { nowIso, toDateKey } from '@/domain/dates';
import { lockInBlocked, roundKg } from '@/domain/engine';
import { matchExercise, normaliseName, type MatchCandidate } from '@/domain/exerciseMatch';
import { fromPortion, weigh, type Macros } from '@/domain/food';
import { fmtKg, fmtNum, fmtRange, plural } from '@/domain/format';
import { uuid } from '@/domain/ids';
import { parseQuickRequest, type RoutineSplit } from '@/domain/quickRequest';
import { routineRequestFrom, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { MEAL_SLOTS, type Exercise, type MealSlot, type MuscleGroup, type Routine, type RoutineExercise } from '@/domain/types';
import { noteShortId } from './context';
import type { PlanOverridePatch, SetPlanOverride } from './types';

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
  /** Defaults to the slot the time of day suggests. */
  slot?: MealSlot;
}

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

/** The slot the time of day suggests: the same guess the meal screen makes. */
export function slotForHour(hour: number): MealSlot {
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

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
// Implementation

export function createCoachActions(deps: ActionDeps = {}): CoachActions {
  const now = () => (deps.now ? deps.now() : new Date());
  const today = () => toDateKey(now());

  /** The owner's exercise a name means, or null. */
  async function findOwnExercise(name: string): Promise<Exercise | null> {
    const all = await db.exercises.toArray();
    const m = matchExercise(name, candidatesOf(all));
    return m ? (all.find((e) => e.id === m.id) ?? null) : null;
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
    // ---- food
    async logFood({ items, slot }) {
      if (!Array.isArray(items) || items.length === 0) return fail('Nothing to log: no foods were given.');
      const rows: NewMealItem[] = [];
      const total: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      for (const it of items) {
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!name) return fail('A food had no name.');
        const macros: Macros = { kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat };
        if (![it.amount, it.kcal, it.protein, it.carbs, it.fat].every(finite) || Object.values(macros).some((v) => v < 0) || !(it.amount > 0)) {
          return fail(`The numbers for ${name} do not look right.`);
        }
        if (it.kcal > 5000) return fail(`${name} at ${fmtNum(it.kcal)} kcal is too much for one item. Check the amount.`);
        const unit = (it.unit ?? '').trim();
        const isGrams = /^(g|gram|grams)$/i.test(unit);
        const grams = it.grams !== undefined && finite(it.grams) && it.grams > 0 ? it.grams : isGrams ? it.amount : undefined;
        const portion = isGrams ? `${fmtNum(it.amount)} g` : `${fmtNum(it.amount)} ${unit}${grams ? ` (${fmtNum(Math.round(grams))} g)` : ''}`.trim();
        const base = fromPortion(macros);
        rows.push({ name, portion, nutrition: grams ? weigh(base, grams) : base, source: 'model' });
        total.kcal += macros.kcal;
        total.protein += macros.protein;
        total.carbs += macros.carbs;
        total.fat += macros.fat;
      }
      const useSlot = slot && MEAL_SLOTS.includes(slot) ? slot : slotForHour(now().getHours());
      await addMeal({ name: cap(useSlot), slot: useSlot, date: today() }, rows);
      const day = await dayTotals(today());
      const list = names(rows.map((r) => r.name), 6);
      return {
        ok: true,
        result: `Logged ${plural(rows.length, 'item')} for ${useSlot}: ${list}, about ${fmtNum(Math.round(total.kcal))} kcal and ${fmtNum(Math.round(total.protein))} g protein (estimates). Today so far: ${fmtNum(Math.round(day.kcal))} kcal, ${fmtNum(Math.round(day.protein))} g protein.`,
        description: `Logged ${list} for ${useSlot} (≈${fmtNum(Math.round(total.kcal))} kcal)`,
      };
    },

    // ---- weight
    async logWeight({ kg, date }) {
      if (!finite(kg) || kg < 30 || kg > 300) return fail('That does not look like a body weight in kg.');
      const day = date ?? today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail('The date must be YYYY-MM-DD.');
      if (day > today()) return fail('That date is in the future.');
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
        const exercise = await findOwnExercise(input.exercise);
        if (!exercise) return fail(`"${input.exercise}" is not one of the owner's exercises.`);
        if (items.some((it) => it.exercise.id === exercise.id)) return fail(`${exercise.name} is already in ${routine.name}.`);
        const rx = await addRoutineExercise(routine.id, exercise.id);
        const numbers = input.sets !== undefined || input.repMin !== undefined || input.repMax !== undefined || input.weightKg !== undefined ? numbersOf(input, rx, exercise) : null;
        if (numbers && 'error' in numbers) return { ok: true, result: `Added ${exercise.name} to ${routine.name} with the default sets and reps. ${numbers.error}`, description: `Added ${exercise.name} to ${routine.name}` };
        if (numbers) await applyToRoutine(rx, numbers.patch);
        const extra = numbers ? `: ${patchText(numbers.patch, exercise)}` : '';
        return { ok: true, result: `Added ${exercise.name} to ${routine.name}${extra}.`, description: `Added ${exercise.name} to ${routine.name}${extra}` };
      }

      const m = matchExercise(input.exercise, candidatesOf(items.map((it) => ({ id: it.rx.id, name: it.exercise.name, aliases: it.exercise.aliases }))));
      const item = m ? items.find((it) => it.rx.id === m.id) : undefined;
      if (!item) return fail(`No exercise matching "${input.exercise}" in ${routine.name}. It has: ${names(items.map((it) => it.exercise.name))}.`);

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

    // ---- today's session
    async editSession(input) {
      const session = await getActiveSession();
      if (!session) return fail('No session is live, so there is nothing to change for today. Use the routine instead if they want it permanent.');
      const items = await routineItems(session.routineId);

      if (input.change === 'add') {
        const exercise = await findOwnExercise(input.exercise);
        if (!exercise) return fail(`"${input.exercise}" is not one of the owner's exercises.`);
        if (items.some((it) => it.exercise.id === exercise.id && !(session.skippedRoutineExerciseIds ?? []).includes(it.rx.id))) return fail(`${exercise.name} is already in today's session.`);
        await addExtraExercise(session.id, exercise.id);
        return { ok: true, result: `Added ${exercise.name} to today's session.`, description: `${exercise.name} added today` };
      }

      const m = matchExercise(input.exercise, candidatesOf(items.map((it) => ({ id: it.rx.id, name: it.exercise.name, aliases: it.exercise.aliases }))));
      const item = m ? items.find((it) => it.rx.id === m.id) : undefined;
      if (!item) return fail(`No exercise matching "${input.exercise}" in today's session. It has: ${names(items.map((it) => it.exercise.name))}.`);

      switch (input.change) {
        case 'skip':
          await setSkipped(session.id, item.rx.id, true);
          return { ok: true, result: `${item.exercise.name} is skipped for today.`, description: `${item.exercise.name} skipped today` };
        case 'unskip':
          await setSkipped(session.id, item.rx.id, false);
          return { ok: true, result: `${item.exercise.name} is back in today's session.`, description: `${item.exercise.name} back in today` };
        case 'swap': {
          if (!input.swapTo) return fail('Swap for which exercise?');
          const sub = await findOwnExercise(input.swapTo);
          if (!sub) return fail(`"${input.swapTo}" is not one of the owner's exercises.`);
          if (sub.id === item.exercise.id) return fail('That is the same exercise.');
          await swapExercise(session.id, item.rx.id, sub.id);
          return { ok: true, result: `${item.exercise.name} is swapped for ${sub.name} today.`, description: `${item.exercise.name} swapped for ${sub.name} today` };
        }
        default: {
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
          if (!deps.setPlanOverride) return fail("I can't change today's sets, reps or weight yet. Say the change and the owner can make it on the exercise.");
          await deps.setPlanOverride(session.id, item.rx.id, numbers.patch);
          const what = patchText(numbers.patch, item.exercise);
          return { ok: true, result: `${item.exercise.name} is ${what} today only. The routine is unchanged.`, description: `${item.exercise.name}: ${what} today` };
        }
      }
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
