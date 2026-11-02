/**
 * The rest of the app the coach can run when the owner asks: the supplement list, routines (rename,
 * delete, restore, copy), recipes (log a share, delete), reminders, and the session itself (start
 * one, open the finish screen, discard the one going). Every write goes through the data code the
 * screens use. Starting or finishing a session hands back a screen to open (`open`), which the
 * chat goes to once the reply is in: the weights for next time are still chosen on the summary,
 * by the owner.
 */
import { db } from '@/db/db';
import { logItemsToSlot } from '@/db/foodRepo';
import { deleteRecipe, listRecipes, shareItem } from '@/db/recipeRepo';
import { deleteRoutine, deleteSession, duplicateRoutine, getActiveSession, getSettings, listArchivedRoutines, listRoutines, restoreRoutine, saveSettings, startSession, updateRoutine } from '@/db/repo';
import { addSupplement, removeSupplement } from '@/db/supplementRepo';
import { fmtDayHeading } from '@/domain/claudeSummary';
import { dateKeyToDate, toDateKey } from '@/domain/dates';
import { normaliseName } from '@/domain/exerciseMatch';
import { displayMacros } from '@/domain/food';
import { fmtNum } from '@/domain/format';
import { slotForHour } from '@/domain/mealSlot';
import { isValidTime, resolveReminders, type ReminderPrefs } from '@/domain/reminders';
import { cleanSupplementDose, findSupplement, SUPPLEMENT_TIMES, supplementLabel } from '@/domain/supplements';
import { MEAL_SLOTS, type MealSlot, type SupplementTime } from '@/domain/types';
import { rescheduleReminders } from '@/platform/reminders';
import type { ActionResult } from './actions';

export interface EditSupplementInput {
  action: 'add' | 'remove' | 'change';
  name: string;
  dose?: string;
  time?: SupplementTime;
}

export interface ManageRoutineInput {
  routine: string;
  action: 'rename' | 'delete' | 'restore' | 'copy';
  newName?: string;
}

export interface RecipeInput {
  action: 'log' | 'delete';
  recipe: string;
  /** Portions eaten, of the recipe's own portions. */
  portions?: number;
  slot?: MealSlot;
  date?: string;
}

export type ReminderName = 'food' | 'training' | 'weigh_in' | 'supplements';

export interface SetReminderInput {
  reminder: ReminderName;
  on: boolean;
  time?: string;
  /** Weigh-in only: 0 Sunday to 6 Saturday. */
  weekday?: number;
  /** Training only: days without a session before the nudge. */
  afterDays?: number;
}

export interface ControlActions {
  editSupplement(input: EditSupplementInput): Promise<ActionResult>;
  manageRoutine(input: ManageRoutineInput): Promise<ActionResult>;
  recipe(input: RecipeInput): Promise<ActionResult>;
  setReminder(input: SetReminderInput): Promise<ActionResult>;
  session(input: { action: 'start' | 'finish' | 'discard'; routine?: string }): Promise<ActionResult>;
}

const fail = (result: string): ActionResult => ({ ok: false, result });
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REMINDER_KEY: Record<ReminderName, keyof ReminderPrefs> = { food: 'food', training: 'training', weigh_in: 'weighIn', supplements: 'supplements' };

/**
 * A name among some named things: the exact one, else (unless `exact`) the only one containing it.
 * Deleting takes the exact name only: "arms" must not delete "Arms (Day 5)" on a guess.
 */
function byName<T extends { name: string }>(items: readonly T[], name: string, exact = false): T | null {
  const key = normaliseName(name);
  if (!key) return null;
  const same = items.find((i) => normaliseName(i.name) === key);
  if (same || exact) return same ?? null;
  const near = items.filter((i) => normaliseName(i.name).includes(key));
  return near.length === 1 ? near[0]! : null;
}

const list = (items: readonly { name: string }[]) => (items.length > 0 ? items.map((i) => i.name).join(', ') : 'none');

export function createControlActions(now: () => Date): ControlActions {
  const today = () => toDateKey(now());

  return {
    async editSupplement({ action, name, dose, time }) {
      if (time !== undefined && !SUPPLEMENT_TIMES.includes(time)) return fail('The time is morning, midday, evening or any.');
      if (action === 'add') {
        const added = await addSupplement({ name, dose, time: time ?? 'any', source: 'coach' });
        if (!added.ok) return fail('Add which supplement?');
        if (added.existed) return { ok: true, result: `${supplementLabel(added.supplement)} is already on the checklist.` };
        return { ok: true, result: `Added ${supplementLabel(added.supplement)} to the checklist (${added.supplement.time}).`, description: `Added ${supplementLabel(added.supplement)} to supplements` };
      }
      const all = await db.supplements.toArray();
      // Removing takes the exact name, as deleting does; a change may go by the closest.
      const held = action === 'remove' ? byName(all.filter((x) => !x.archived), name, true) : findSupplement(all, name);
      if (!held) return fail(`No supplement called "${name}" on the checklist. It has: ${list(all.filter((s) => !s.archived))}.`);
      if (action === 'remove') {
        await removeSupplement(held.id);
        return { ok: true, result: `Removed ${supplementLabel(held)} from the checklist.`, description: `Removed ${supplementLabel(held)} from supplements` };
      }
      const patch: { dose?: string; time?: SupplementTime } = {};
      if (dose !== undefined) patch.dose = cleanSupplementDose(dose);
      if (time !== undefined) patch.time = time;
      if (Object.keys(patch).length === 0) return fail('Change what: the dose or the time?');
      await db.supplements.update(held.id, patch);
      const after = { ...held, ...patch };
      return { ok: true, result: `${supplementLabel(after)} is now taken ${after.time === 'any' ? 'at any time' : `in the ${after.time}`}.`, description: `${supplementLabel(after)}: ${after.time}` };
    },

    async manageRoutine({ routine: name, action, newName }) {
      const active = await listRoutines();
      if (action === 'restore') {
        const archived = await listArchivedRoutines();
        const found = byName(archived, name);
        if (!found) return fail(`No deleted routine called "${name}". Deleted routines: ${list(archived)}.`);
        await restoreRoutine(found.id);
        return { ok: true, result: `${found.name} is back among the routines.`, description: `Restored routine ${found.name}` };
      }
      const found = byName(active, name, action === 'delete');
      if (!found) return fail(`No routine called "${name}". The routines are: ${list(active)}. Use its exact name.`);
      if (action === 'rename') {
        const clean = (newName ?? '').trim().replace(/\s+/g, ' ');
        if (!clean) return fail('Rename it to what?');
        if (active.some((r) => r.id !== found.id && normaliseName(r.name) === normaliseName(clean))) return fail(`There is already a routine called ${clean}.`);
        await updateRoutine(found.id, { name: clean });
        return { ok: true, result: `${found.name} is now called ${clean}.`, description: `Renamed ${found.name} to ${clean}` };
      }
      if (action === 'copy') {
        const copy = await duplicateRoutine(found.id);
        return { ok: true, result: `Copied ${found.name} as ${copy.name}.`, description: `Copied routine ${found.name}` };
      }
      if ((await getActiveSession())?.routineId === found.id) return fail(`${found.name} has a session going: finish or discard it first.`);
      const how = await deleteRoutine(found.id);
      return {
        ok: true,
        result: how === 'archived' ? `${found.name} is deleted from the list; its history stays and it can be restored.` : `${found.name} is deleted for good: it had no sessions to keep.`,
        description: `Deleted routine ${found.name}`,
      };
    },

    async recipe({ action, recipe: name, portions, slot, date }) {
      const recipes = await listRecipes();
      const found = byName(recipes, name, action === 'delete');
      if (!found) return fail(`No recipe called "${name}". The recipes are: ${list(recipes)}. Use its exact name.`);
      if (action === 'delete') {
        await deleteRecipe(found.id);
        return { ok: true, result: `Deleted the recipe ${found.name}. Meals already logged from it stay.`, description: `Deleted recipe ${found.name}` };
      }
      const eaten = portions ?? 1;
      if (!(eaten > 0 && eaten <= 20)) return fail('How many portions, from 0 to 20?');
      const day = date ?? today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || toDateKey(dateKeyToDate(day)) !== day || day > today()) return fail('Give a real day, today or before, as YYYY-MM-DD.');
      if (slot !== undefined && !MEAL_SLOTS.includes(slot)) return fail('The meal is breakfast, lunch, dinner or snack.');
      if (day !== today() && !slot) return fail('Which meal was that: breakfast, lunch, dinner or snack?');
      const useSlot = slot ?? slotForHour(now().getHours());
      const item = shareItem(found, { mode: 'portions', made: found.portionsMade, eaten });
      await logItemsToSlot(day, useSlot, [item]);
      const m = displayMacros(item.nutrition);
      const on = day === today() ? '' : ` on ${fmtDayHeading(day)}`;
      return {
        ok: true,
        result: `Logged ${item.portion} of ${found.name} for ${useSlot}${on}: ${fmtNum(m.kcal)} kcal, ${fmtNum(m.protein)} g protein (the recipe's own figures).`,
        description: `Logged ${found.name} (${item.portion}) for ${useSlot}${on}`,
      };
    },

    async setReminder({ reminder, on, time, weekday, afterDays }) {
      const key = REMINDER_KEY[reminder];
      if (!key) return fail('The reminders are food, training, weigh_in and supplements.');
      if (time !== undefined && !isValidTime(time)) return fail('Give the time as HH:MM, 24-hour.');
      if (weekday !== undefined && (key !== 'weighIn' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return fail('A weekday is for the weigh-in only, 0 Sunday to 6 Saturday.');
      if (afterDays !== undefined && (key !== 'training' || !Number.isInteger(afterDays) || afterDays < 1 || afterDays > 14)) return fail('Days without a session is for the training reminder only, 1 to 14.');
      const prefs = resolveReminders((await getSettings()).reminders);
      const next: ReminderPrefs = { ...prefs, [key]: { ...prefs[key], on, ...(time ? { time } : {}), ...(weekday !== undefined ? { weekday } : {}), ...(afterDays !== undefined ? { afterDays } : {}) } };
      await saveSettings({ reminders: next });
      void rescheduleReminders();
      const r = next[key] as { on: boolean; time: string; weekday?: number; afterDays?: number };
      const when = `${r.weekday !== undefined ? `${WEEKDAYS[r.weekday]} ` : ''}${r.time}${r.afterDays !== undefined ? ` after ${r.afterDays} days without a session` : ''}`;
      const label = reminder.replace('_', '-');
      return { ok: true, result: on ? `The ${label} reminder is on, ${when}.` : `The ${label} reminder is off.`, description: on ? `${label} reminder: ${when}` : `${label} reminder off` };
    },

    async session({ action, routine: name }) {
      const live = await getActiveSession();
      if (action === 'start') {
        if (live) return fail(`${live.title} is already going. Finish or discard it first.`);
        const routines = await listRoutines();
        const found = byName(routines, name ?? '');
        if (!found) return fail(`Start which routine? The routines are: ${list(routines)}.`);
        const started = await startSession(found.id);
        return { ok: true, result: `Started ${found.name}. The app is opening it now.`, description: `Started ${found.name}`, open: `/session/${started.id}` };
      }
      if (!live) return fail('No session is going.');
      if (action === 'finish') {
        const sets = await db.setLogs.where('sessionId').equals(live.id).count();
        if (sets === 0) return fail(`${live.title} has no sets logged yet: there is nothing to finish. Discard it instead if it should go.`);
        return { ok: true, result: `Opening the finish screen for ${live.title}: the owner checks the weights for next time and saves it there.`, open: `/session/${live.id}/summary` };
      }
      await deleteSession(live.id);
      return { ok: true, result: `Discarded ${live.title} and anything logged in it.`, description: `Discarded ${live.title}` };
    },
  };
}
