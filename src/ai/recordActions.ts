/**
 * The coach's hands on what is already logged: look a day up (with short ids), then change or
 * delete a food, a set, a session or a weigh-in, or change a setting the owner names. Each goes
 * through the same data code the screens use (foodRepo, repo.ts), so every total, record and
 * backup follows exactly as it does for a tap.
 *
 * Figures stay honest (docs/adr/0004): the coach may rewrite only its own estimates; a figure from
 * the owner, a label, the UK table or memory can be scaled to the amount eaten, never replaced.
 */
import { db } from '@/db/db';
import { deleteItem, mealsOnDay, updateItem } from '@/db/foodRepo';
import { deleteBodyweight, deleteSession, deleteSet, getActiveSession, getSettings, saveSettings, updateSet } from '@/db/repo';
import { GOALS } from '@/domain/goalTargets';
import { calorieChange, proteinChange } from '@/domain/targetChange';
import { refreshGoalTargets } from '@/state/goalTargets';
import { sessionsOn } from '@/db/todayQueries';
import { fmtDayHeading } from '@/domain/claudeSummary';
import { dateKeyToDate, toDateKey } from '@/domain/dates';
import { displayMacros, reconcileMacros, scaleNutrition, type FoodSource, type Macros } from '@/domain/food';
import { fmtKg, fmtNum, fmtTime, fmtWeight, plural } from '@/domain/format';
import type { MealItem, Session, SetLog, Settings } from '@/domain/types';
import type { ActionResult } from './actions';

export interface EditFoodInput {
  id: string;
  delete: boolean;
  name?: string;
  /** Multiply the amount eaten: 0.5 for half, 2 for two. */
  scale?: number;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface EditTrainingInput {
  /** A set's id or a session's id, from find_entries. */
  id: string;
  delete: boolean;
  weightKg?: number;
  reps?: number;
}

/** Settings the coach may change when the owner asks, with the range each takes. */
export const COACH_SETTINGS = {
  leg_day_protein_target: { key: 'proteinTargetLegDay', min: 40, max: 400, unit: 'g' },
  step_goal: { key: 'stepGoal', min: 1000, max: 50_000, unit: 'steps' },
  sessions_per_week: { key: 'weeklySessionTarget', min: 1, max: 14, unit: 'sessions' },
  bodyweight_goal_min: { key: 'bodyweightTargetMin', min: 30, max: 300, unit: 'kg' },
  bodyweight_goal_max: { key: 'bodyweightTargetMax', min: 30, max: 300, unit: 'kg' },
  rest_compound_seconds: { key: 'restCompoundSec', min: 15, max: 900, unit: 's' },
  rest_isolation_seconds: { key: 'restIsolationSec', min: 15, max: 900, unit: 's' },
  birth_year: { key: 'birthYear', min: 1900, max: 2100, unit: '' },
} as const satisfies Record<string, { key: keyof Settings; min: number; max: number; unit: string }>;
export type CoachSetting = keyof typeof COACH_SETTINGS | 'sex' | 'calorie_target' | 'protein_target' | 'goal';

export interface RecordActions {
  findEntries(input: { date: string; kind: 'food' | 'weight' | 'sessions' }): Promise<ActionResult>;
  editFood(input: EditFoodInput): Promise<ActionResult>;
  editTraining(input: EditTrainingInput): Promise<ActionResult>;
  deleteWeight(date: string): Promise<ActionResult>;
  changeSetting(input: { setting: CoachSetting; value: number | string }): Promise<ActionResult>;
}

const fail = (result: string): ActionResult => ({ ok: false, result });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isValidDateKey = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && toDateKey(dateKeyToDate(d)) === d;

/** The id the coach is shown and gives back: the first 8 characters, as for notes. */
export const shortId = (id: string) => id.slice(0, 8);

const SOURCE_WORDS: Record<FoodSource, string> = { model: 'your estimate', label: 'a label', user: "the owner's own", memory: 'remembered', table: 'UK food table' };

/** One row by its short (or full) id; a reason when there is none, or more than one. */
async function byId<T>(table: { where(index: string): { startsWith(key: string): { limit(n: number): { toArray(): Promise<T[]> } } } }, raw: string, what: string): Promise<T | string> {
  const key = String(raw ?? '').trim().replace(/^\[|\]$/g, '');
  if (key.length < 4) return `Which ${what}? Give its id from find_entries.`;
  const hits = await table.where(':id').startsWith(key).limit(2).toArray();
  if (hits.length === 0) return `No ${what} with id ${key}. Look the day up with find_entries.`;
  if (hits.length > 1) return `More than one ${what} starts with ${key}. Give more of the id.`;
  return hits[0]!;
}

function macroText(m: Macros, approx: string): string {
  return `${approx}${fmtNum(m.kcal)} kcal, P ${approx}${fmtNum(m.protein)}, C ${approx}${fmtNum(m.carbs)}, F ${approx}${fmtNum(m.fat)}`;
}

function itemText(i: MealItem): string {
  const portion = i.portion ? ` (${i.portion})` : '';
  return `[${shortId(i.id)}] ${i.name}${portion}: ${macroText(displayMacros(i.nutrition), i.source === 'model' ? '≈' : '')}, from ${SOURCE_WORDS[i.source]}`;
}

export function createRecordActions(now: () => Date = () => new Date()): RecordActions {
  return {
    async findEntries({ date, kind }) {
      if (!isValidDateKey(date)) return fail('Give the day as YYYY-MM-DD.');
      const day = fmtDayHeading(date);
      if (kind === 'food') {
        const meals = await mealsOnDay(date);
        const lines = meals.filter((m) => m.items.length > 0).map(({ meal, items }) => `${meal.slot ?? meal.name}: ${items.map(itemText).join('; ')}`);
        return { ok: true, result: lines.length > 0 ? `Food on ${day}:\n${lines.join('\n')}` : `No food logged on ${day}.` };
      }
      if (kind === 'weight') {
        const entry = await db.bodyweight.where('date').equals(date).first();
        return { ok: true, result: entry ? `Weigh-in on ${day}: ${fmtKg(entry.kg)}${entry.source === 'health-connect' ? ' (read from Health Connect)' : ''}.` : `No weigh-in on ${day}.` };
      }
      const sessions = await sessionsOn(date);
      if (sessions.length === 0) return { ok: true, result: `No sessions on ${day}.` };
      const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
      const blocks: string[] = [];
      for (const s of sessions) {
        const sets = (await db.setLogs.where('sessionId').equals(s.id).toArray()).sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.index - b.index);
        const when = s.source === 'coach' ? 'filled in' : s.endedAt ? `finished ${fmtTime(s.endedAt)}` : 'still going';
        const byExercise = new Map<string, string[]>();
        for (const x of sets) {
          const e = exercises.get(x.exerciseId);
          const what = x.reps !== undefined ? `${fmtWeight(e?.kind ?? 'reps', x.weight)} × ${x.reps}` : x.seconds !== undefined ? `${x.seconds} s` : `${fmtNum(x.distanceM ?? 0)} m`;
          const list = byExercise.get(e?.name ?? 'Unknown exercise') ?? [];
          list.push(`[${shortId(x.id)}] ${what}${x.type === 'working' ? '' : ` (${x.type})`}`);
          byExercise.set(e?.name ?? 'Unknown exercise', list);
        }
        blocks.push([`[${shortId(s.id)}] ${s.title}, ${when}`, ...[...byExercise].map(([name, list]) => `  ${name}: ${list.join('; ')}`)].join('\n'));
      }
      return { ok: true, result: `Sessions on ${day}:\n${blocks.join('\n')}` };
    },

    async editFood(input) {
      const item = await byId<MealItem>(db.mealItems, input.id, 'food');
      if (typeof item === 'string') return fail(item);
      const meal = await db.meals.get(item.mealId);
      const where = meal ? `${meal.slot ?? meal.name}, ${fmtDayHeading(meal.date)}` : 'its meal';
      if (input.delete) {
        await deleteItem(item.id);
        return { ok: true, result: `Deleted ${item.name} from ${where}.`, description: `Deleted ${item.name} (${where})` };
      }

      const patch: Partial<Pick<MealItem, 'name' | 'portion' | 'nutrition'>> = {};
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (name && name !== item.name) patch.name = name;
      let nutrition = item.nutrition;
      if (input.scale !== undefined) {
        if (!finite(input.scale) || input.scale <= 0 || input.scale > 20) return fail('Scale the amount by a number between 0 and 20: 0.5 for half, 2 for two.');
        nutrition = scaleNutrition(nutrition, input.scale);
        patch.portion = `${fmtNum(input.scale)} × ${item.portion || 'portion'}`;
      }
      const given = (['kcal', 'protein', 'carbs', 'fat'] as const).filter((k) => input[k] !== undefined);
      if (given.length > 0) {
        if (item.source !== 'model') return fail(`${item.name}'s figures are ${SOURCE_WORDS[item.source]}, not your estimate, so they are not replaced. Scale the amount instead, or the owner can edit it on the Food screen.`);
        const figures = { ...displayMacros(nutrition) };
        for (const k of given) {
          const v = input[k];
          if (!finite(v) || v < 0) return fail(`The ${k} for ${item.name} does not look right.`);
          figures[k] = v;
        }
        const fixed = reconcileMacros(figures).macros;
        if (fixed.kcal > 5000 || Math.max(fixed.protein, fixed.carbs, fixed.fat) > 1000) return fail(`${fmtNum(fixed.kcal)} kcal is too much for one item. Check the figures.`);
        nutrition = { basis: 'portion', macros: fixed };
      }
      if (nutrition !== item.nutrition) patch.nutrition = nutrition;
      if (Object.keys(patch).length === 0) return fail('Nothing to change: give a new name, figures or amount, or delete it.');
      await updateItem(item.id, patch);
      const now = displayMacros(nutrition);
      const label = patch.name ?? item.name;
      return {
        ok: true,
        result: `Changed ${label} (${where}): now ${macroText(now, item.source === 'model' ? '≈' : '')}.`,
        description: `Changed ${label} (${where}): ${item.source === 'model' ? '≈' : ''}${fmtNum(now.kcal)} kcal`,
      };
    },

    async editTraining(input) {
      const key = String(input.id ?? '').trim().replace(/^\[|\]$/g, '');
      const live = await getActiveSession();
      const set = await byId<SetLog>(db.setLogs, key, 'set');
      if (typeof set !== 'string') {
        if (live?.id === set.sessionId) return fail('That set is in the session still going: change it on the session screen.');
        const exercise = await db.exercises.get(set.exerciseId);
        const name = exercise?.name ?? 'that exercise';
        const was = `${fmtWeight(exercise?.kind ?? 'reps', set.weight)}${set.reps !== undefined ? ` × ${set.reps}` : ''}`;
        if (input.delete) {
          await deleteSet(set.id);
          return { ok: true, result: `Deleted a ${name} set (${was}).`, description: `Deleted ${name} set ${was}` };
        }
        const patch: { weight?: number; reps?: number } = {};
        if (input.weightKg !== undefined) {
          if (!finite(input.weightKg) || input.weightKg < 0 || input.weightKg > 1000) return fail('That weight does not look right.');
          patch.weight = input.weightKg;
        }
        if (input.reps !== undefined) {
          if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > 100) return fail('Reps are a whole number from 1 to 100.');
          if (set.reps === undefined) return fail(`${name} is not counted in reps.`);
          patch.reps = input.reps;
        }
        if (Object.keys(patch).length === 0) return fail('Nothing to change: give the weight or reps, or delete it.');
        await updateSet(set.id, patch);
        const now = `${fmtWeight(exercise?.kind ?? 'reps', patch.weight ?? set.weight)}${set.reps !== undefined ? ` × ${patch.reps ?? set.reps}` : ''}`;
        return { ok: true, result: `${name} set changed from ${was} to ${now}. Weights already decided for next time are not recalculated.`, description: `${name} set: ${was} → ${now}` };
      }
      const session = await byId<Session>(db.sessions, key, 'set or session');
      if (typeof session === 'string') return fail(session);
      if (live?.id === session.id) return fail('That session is still going: finish or discard it on the session screen.');
      if (!input.delete) return fail('A session can only be deleted here; to change one, change its sets.');
      const sets = await db.setLogs.where('sessionId').equals(session.id).count();
      await deleteSession(session.id);
      const day = fmtDayHeading(session.startedAt.slice(0, 10));
      return { ok: true, result: `Deleted ${session.title} (${day}) and its ${plural(sets, 'set')}.`, description: `Deleted session ${session.title} (${day})` };
    },

    async deleteWeight(date) {
      if (!isValidDateKey(date)) return fail('Give the day as YYYY-MM-DD.');
      const entry = await db.bodyweight.where('date').equals(date).first();
      if (!entry) return fail(`No weigh-in on ${fmtDayHeading(date)}.`);
      await deleteBodyweight(entry.id);
      return { ok: true, result: `Deleted the ${fmtKg(entry.kg)} weigh-in on ${fmtDayHeading(date)}.`, description: `Deleted weigh-in ${fmtKg(entry.kg)} (${fmtDayHeading(date)})` };
    },

    async changeSetting({ setting, value }) {
      if (setting === 'sex') {
        const sex = String(value).toLowerCase();
        if (sex !== 'male' && sex !== 'female') return fail('Sex is male or female.');
        await saveSettings({ sex });
        return { ok: true, result: `Lifts are now compared with ${sex === 'male' ? 'men' : 'women'}.`, description: `Compare lifts with: ${sex === 'male' ? 'men' : 'women'}` };
      }
      if (setting === 'goal') {
        const goal = GOALS.find((g) => g.goal === String(value) || g.label.toLowerCase() === String(value).toLowerCase());
        if (!goal) return fail(`The goal is one of: ${GOALS.map((g) => g.goal).join(', ')}.`);
        await saveSettings({ goal: goal.goal });
        const next = await refreshGoalTargets(now());
        const basis = next?.targetsBasis?.join(' ') ?? '';
        return { ok: true, result: `Goal set to ${goal.label}. ${basis}`, description: `Goal: ${goal.label}` };
      }
      if (setting === 'calorie_target' || setting === 'protein_target') {
        // The same change the offer's "Use …" button makes: a calorie figure holds from today (start
        // and ceiling both), and protein keeps the lower-body days' gap.
        const n = typeof value === 'number' ? value : Number(value);
        const calories = setting === 'calorie_target';
        if (!finite(n) || (calories ? n < 1000 || n > 6000 : n < 40 || n > 400)) return fail(calories ? 'A daily calorie target from 1,000 to 6,000 kcal.' : 'A daily protein target from 40 to 400 g.');
        const settings = await getSettings();
        const change = calories ? calorieChange(settings, Math.round(n), toDateKey(now())) : proteinChange(settings, Math.round(n));
        if (!change) return { ok: true, result: `It is already ${fmtNum(Math.round(n))}${calories ? ' kcal' : ' g'}.` };
        await saveSettings(change.patch);
        return { ok: true, result: change.line, description: change.line };
      }
      const spec = COACH_SETTINGS[setting as keyof typeof COACH_SETTINGS];
      if (!spec) return fail(`"${String(setting)}" is not a setting I can change. I can change: ${[...Object.keys(COACH_SETTINGS), 'sex', 'calorie_target', 'protein_target'].join(', ')}.`);
      const n = typeof value === 'number' ? value : Number(value);
      if (!finite(n) || n < spec.min || n > spec.max) return fail(`${setting} takes a number from ${spec.min} to ${spec.max}.`);
      const v = spec.unit === 'kg' ? Math.round(n * 10) / 10 : Math.round(n);
      await saveSettings({ [spec.key]: v } as Partial<Settings>);
      const shown = `${fmtNum(v)}${spec.unit ? ` ${spec.unit}` : ''}`;
      return { ok: true, result: `${setting.replace(/_/g, ' ')} is now ${shown}.`, description: `${setting.replace(/_/g, ' ')}: ${shown}` };
    },
  };
}
