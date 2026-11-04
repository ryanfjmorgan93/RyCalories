/**
 * The coach's tools: `CoachActions` (actions.ts) dressed as strict, Zod-checked Claude tools.
 *
 * Each tool's `run` calls one action and hands the model back that action's one-line result. A
 * request that cannot be done is thrown, so the SDK reports it to the model as a tool error and the
 * model can say so or try again; a request that was done adds its short human description to the
 * turn's `actions` list (the lines shown under the coach's reply). `build_routine` also leaves its
 * draft on the turn for the UI to offer "Save".
 *
 * The list is fixed and in a fixed order: tools are the first thing in the cached prompt prefix, so
 * a tool set that varied between requests would miss the cache every time. `tool_choice` is left
 * automatic everywhere: Sonnet 5.5 rejects a forced one.
 */
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import * as z from 'zod/v4';
import { FOCUSABLE_MUSCLES } from '@/domain/quickRequest';
import { SUPPLEMENT_TIMES } from '@/domain/supplements';
import { MEAL_SLOTS, type MuscleGroup, type SupplementTime } from '@/domain/types';
import type { ActionResult, CoachActions } from './actions';
import { COACH_SETTINGS } from './recordActions';
import { strictTool } from './schema';
import type { TurnRecord } from './types';

/** The custom-tool fields every tool here has, which the SDK's own union type does not promise. */
export interface CoachToolFields {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict: boolean;
}

export type CoachTool = BetaRunnableTool<any> & CoachToolFields;

/** Hand an action's outcome to the model, noting what changed on the turn. */
function finish(outcome: ActionResult, turn: TurnRecord): string {
  if (!outcome.ok) throw new Error(outcome.result);
  if (outcome.description) turn.actions.push(outcome.description);
  if (outcome.open) turn.open = outcome.open;
  return outcome.result;
}

const MUSCLES = FOCUSABLE_MUSCLES as [MuscleGroup, ...MuscleGroup[]];

const LogFoodInput = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe('The food, plainly: "Wholemeal toast", "Chicken breast, grilled"'),
        amount: z.number().describe('How many of the unit: 2 for two slices, 0.5 for half a bowl'),
        unit: z.string().describe('What the amount is counted in: "slices", "eggs", "bowl", "tbsp", or "g" when weighed'),
        grams: z.number().optional().describe('Weight of the whole amount in grams, if you can estimate it'),
        kcal: z.number().describe('Energy of the WHOLE amount eaten, not per 100 g'),
        protein: z.number().describe('Protein in grams for the whole amount'),
        carbs: z.number().describe('Carbohydrate in grams for the whole amount'),
        fat: z.number().describe('Fat in grams for the whole amount'),
      }),
    )
    .describe('Everything eaten in this sitting'),
  slot: z.enum(MEAL_SLOTS).optional().describe('breakfast, lunch, dinner or snack; leave out to use the time of day (required with a date)'),
  date: z.string().optional().describe('YYYY-MM-DD, for a meal on an earlier day (up to 7 days back, never the future); leave out for today'),
});

const LogWeightInput = z.object({
  kg: z.number().describe('Body weight in kilograms'),
  date: z.string().optional().describe('YYYY-MM-DD; leave out for today'),
});

const RememberInput = z.object({
  text: z.string().describe('One short sentence about the owner worth keeping: a niggle, an injury, a preference, a goal'),
});

const ForgetInput = z.object({
  id: z.string().describe('The id in square brackets from the coach notes list'),
});

const EditRoutineInput = z.object({
  routine: z.string().describe('The routine, as the owner calls it: "Upper (Push)", "push day"'),
  exercise: z.string().describe('The exercise in that routine (for add: the exercise to add)'),
  change: z.enum(['sets', 'reps', 'weight', 'add', 'remove']).describe('What to change. Permanent: it changes the routine itself, not just today'),
  sets: z.number().optional().describe('New number of sets (sets, or with add)'),
  rep_min: z.number().optional().describe('Bottom of the rep range (reps, or with add)'),
  rep_max: z.number().optional().describe('Top of the rep range (reps, or with add)'),
  weight_kg: z.number().optional().describe('New working weight in kg (weight, or with add)'),
});

const EditSessionInput = z.object({
  exercise: z.string().describe('The exercise in today\'s session (for add: the exercise to add)'),
  change: z.enum(['sets', 'reps', 'weight', 'swap', 'skip', 'unskip', 'add']).describe('What to change for TODAY only; the routine is not touched'),
  sets: z.number().optional().describe('Sets for today (change = sets)'),
  rep_min: z.number().optional().describe('Bottom of the rep range for today (change = reps)'),
  rep_max: z.number().optional().describe('Top of the rep range for today (change = reps)'),
  weight_kg: z.number().optional().describe('Working weight in kg for today (change = weight)'),
  swap_to: z.string().optional().describe('The exercise to do instead (change = swap)'),
});

const ProposeTargetsInput = z.object({
  calories: z.number().optional().describe('New daily calorie target in kcal, if proposing one'),
  protein: z.number().optional().describe('New daily protein target in grams, if proposing one'),
});

const SuggestSupplementInput = z.object({
  name: z.string().describe('The supplement, plainly: "Creatine monohydrate", "Vitamin D3"'),
  dose: z.string().optional().describe('The usual dose as it reads on a tub: "5 g", "10 µg", "1 capsule"'),
  time: z.enum(SUPPLEMENT_TIMES as unknown as [SupplementTime, ...SupplementTime[]]).optional().describe('When in the day it is usually taken: morning, midday, evening or any'),
  why: z.string().describe('One short reason it suits the owner, in a sentence'),
});

const TickSupplementsInput = z.object({
  names: z.array(z.string()).optional().describe('The supplements taken, as the owner named them'),
  all: z.boolean().optional().describe('True when they say they took all of them'),
  date: z.string().optional().describe('YYYY-MM-DD for an earlier day; leave out for today'),
});

// Both required: strict mode caps the optional parameters across all the tools.
const ReportProblemInput = z.object({
  summary: z.string().describe('One plain line: what in the app went wrong'),
  detail: z.string().describe('What was asked, what the app did instead, any tool result or figure that was wrong. Empty when there is nothing more.'),
});

// Every field required: strict mode allows only so many optional parameters across all the tools.
const LogPastSessionInput = z.object({
  date: z.string().describe('The day they trained, YYYY-MM-DD: today or within the last 7 days'),
  routine: z.string().describe('The routine they did, by name, or "" if it was not one of their routines'),
  as_planned: z.boolean().describe('true only when they say they did the routine as planned and gave no sets: their own plan is copied at the bottom of each rep range'),
  exercises: z
    .array(
      z.object({
        name: z.string().describe('The exercise, by its usual name'),
        sets: z.array(z.object({ weight_kg: z.number().describe('kg as they said it; 0 for bodyweight'), reps: z.number().describe('Whole reps') })),
      }),
    )
    .describe('The sets they told you, in their numbers. Empty when as_planned. Never fill in a weight or rep count they did not give.'),
});

// The tools below are not strict (see log_past_session in createCoachTools), so optional fields cost nothing.
const FindEntriesInput = z.object({
  date: z.string().describe('The day, YYYY-MM-DD'),
  kind: z.enum(['food', 'weight', 'sessions']).describe('What to look up'),
});

const EditFoodInput = z.object({
  id: z.string().describe('The food\'s id from find_entries'),
  delete: z.boolean().describe('true to delete it'),
  name: z.string().optional().describe('A new name'),
  scale: z.number().optional().describe('Multiply the amount eaten: 0.5 for half, 2 for two'),
  kcal: z.number().optional().describe('New kcal for the whole amount (only your own estimates can be replaced)'),
  protein: z.number().optional().describe('New protein in g'),
  carbs: z.number().optional().describe('New carbs in g'),
  fat: z.number().optional().describe('New fat in g'),
});

const EditTrainingInput = z.object({
  id: z.string().describe('A set\'s id, or a session\'s id, from find_entries'),
  delete: z.boolean().describe('true to delete the set, or the whole session'),
  weight_kg: z.number().optional().describe('The set\'s new weight in kg'),
  reps: z.number().optional().describe('The set\'s new rep count'),
});

const DeleteWeightInput = z.object({ date: z.string().describe('The day of the weigh-in to delete, YYYY-MM-DD') });

const ChangeSettingInput = z.object({
  setting: z.enum([...(Object.keys(COACH_SETTINGS) as (keyof typeof COACH_SETTINGS)[]), 'sex', 'calorie_target', 'protein_target', 'goal']).describe('Which setting'),
  value: z.union([z.number(), z.string()]).describe('The new value: a number; male / female for sex; lean_gain, faster_gain, recomp or fat_loss for goal'),
});

const EditSupplementInput = z.object({
  action: z.enum(['add', 'remove', 'change']).describe('Add to the checklist, remove from it, or change its dose or time'),
  name: z.string().describe('The supplement, as the owner names it'),
  dose: z.string().optional().describe('The dose as on the tub: "5 g", "1 capsule"'),
  time: z.enum(SUPPLEMENT_TIMES as unknown as [SupplementTime, ...SupplementTime[]]).optional().describe('morning, midday, evening or any'),
});

const ManageRoutineInput = z.object({
  routine: z.string().describe('The routine, by name'),
  action: z.enum(['rename', 'delete', 'restore', 'copy']).describe('Rename it, delete it, bring a deleted one back, or copy it'),
  new_name: z.string().optional().describe('The new name, for rename'),
});

const RecipeInput = z.object({
  action: z.enum(['log', 'delete']).describe('Log a share of the recipe as eaten, or delete the recipe'),
  recipe: z.string().describe('The recipe, by name'),
  portions: z.number().optional().describe('Portions eaten, of the portions the recipe makes; 1 if not said'),
  slot: z.enum(MEAL_SLOTS).optional().describe('breakfast, lunch, dinner or snack; leave out for the time of day (needed with a date)'),
  date: z.string().optional().describe('YYYY-MM-DD for an earlier day; leave out for today'),
});

const SetReminderInput = z.object({
  reminder: z.enum(['food', 'training', 'weigh_in', 'supplements']).describe('Which phone reminder'),
  on: z.boolean().describe('On or off'),
  time: z.string().optional().describe('HH:MM, 24-hour'),
  weekday: z.number().optional().describe('Weigh-in only: 0 Sunday to 6 Saturday'),
  after_days: z.number().optional().describe('Training only: days without a session before it fires'),
});

const SessionInput = z.object({
  action: z.enum(['start', 'finish', 'discard']).describe('Start a routine, open the finish screen for the session going, or discard the session going'),
  routine: z.string().optional().describe('The routine to start, by name'),
});

const BuildRoutineInput = z.object({
  request: z.string().describe('What the owner asked for, in their words: "a 45 minute shoulder routine", "push pull legs"'),
  focus: z.array(z.enum(MUSCLES)).optional().describe('Muscles to train, if you can read them from the request'),
  count: z.number().optional().describe('How many exercises, if asked'),
  minutes: z.number().optional().describe('How long the routine should take, if asked'),
  split: z.enum(['ppl', 'upper-lower', 'full-body']).optional().describe('A named split, if asked'),
  // Required, not optional: strict mode allows only so many optional parameters across all the tools.
  effort: z
    .enum(['easy', 'normal', 'hard'])
    .describe('"normal" unless they asked otherwise. "easy" for a low-effort day (tired, can\'t be bothered, light): no heavy barbell lifts or hinges, 2 light sets each. "hard" for more sets.'),
});

/**
 * The coach's tools for one turn. The order is part of the cache key: do not reorder or vary it.
 */
export function createCoachTools(actions: CoachActions, turn: TurnRecord): CoachTool[] {
  const tools = [
    strictTool({
      name: 'log_food',
      description:
        'Log what the owner ate. The items join that day\'s meal for the slot (made if there is none). Use when they say what they had, or send a description. Estimate honestly: kcal and macros are for the whole amount eaten. Foods the app already knows keep their own figures; yours are marked as estimates.',
      inputSchema: LogFoodInput,
      run: async (input) => finish(await actions.logFood({ items: input.items, slot: input.slot, date: input.date }), turn),
    }),
    strictTool({
      name: 'log_weight',
      description: 'Record a body weight in kg for a day (today unless a date is given).',
      inputSchema: LogWeightInput,
      run: async (input) => finish(await actions.logWeight({ kg: input.kg, date: input.date }), turn),
    }),
    strictTool({
      name: 'remember',
      description: 'Keep a short note about the owner for later conversations, e.g. "Left knee twinges on deep squats". The owner can see and delete notes.',
      inputSchema: RememberInput,
      run: async (input) => finish(await actions.remember(input.text), turn),
    }),
    strictTool({
      name: 'forget',
      description: 'Delete a coach note by its id, when it is out of date or the owner asks.',
      inputSchema: ForgetInput,
      run: async (input) => finish(await actions.forget(input.id), turn),
    }),
    strictTool({
      name: 'edit_routine',
      description:
        "Change a saved routine permanently: sets, rep range or weight of one exercise, or add or remove an exercise. An exercise to add can be one of the owner's or any in the app's built-in library of about 800 (use its usual name, e.g. 'Chest Supported Row'); a library one becomes theirs. Use for 'in my push day make bench 4 sets' or 'put it in the routine'. To change only today, use edit_session instead.",
      inputSchema: EditRoutineInput,
      run: async (input) =>
        finish(await actions.editRoutine({ routine: input.routine, exercise: input.exercise, change: input.change, sets: input.sets, repMin: input.rep_min, repMax: input.rep_max, weightKg: input.weight_kg }), turn),
    }),
    strictTool({
      name: 'edit_session',
      description:
        "Change today's live session only (the routine stays as it is): sets, reps or weight of an exercise, swap it for another, skip it or put it back, or add an exercise. An exercise to add or swap in can be the owner's or any in the app's built-in library. Only works while a session is live.",
      inputSchema: EditSessionInput,
      run: async (input) =>
        finish(await actions.editSession({ exercise: input.exercise, change: input.change, sets: input.sets, repMin: input.rep_min, repMax: input.rep_max, weightKg: input.weight_kg, swapTo: input.swap_to }), turn),
    }),
    strictTool({
      name: 'build_routine',
      description:
        "Draft a routine or a split from the owner's own exercises and real working weights. Nothing is saved: tell them the draft is ready and they can save it. Use for 'build me a push day' or 'a 40 minute leg routine'.",
      inputSchema: BuildRoutineInput,
      run: async (input) => {
        const outcome = await actions.buildRoutine({ request: input.request, focus: input.focus, count: input.count, minutes: input.minutes, split: input.split, effort: input.effort });
        if (outcome.ok && outcome.draft) turn.draft = outcome.draft;
        return finish(outcome, turn);
      },
    }),
    strictTool({
      name: 'propose_targets',
      description:
        "Offer the owner a new daily calorie and/or protein target. Nothing changes: the offer appears as buttons under your reply, and the owner taps to use it. Use when they ask to change their targets, or when their numbers clearly call for it. Say what you offered and why.",
      inputSchema: ProposeTargetsInput,
      run: async (input) => {
        const outcome = await actions.proposeTargets({ calories: input.calories, protein: input.protein });
        if (outcome.ok && outcome.targets) turn.offer = { ...turn.offer, targets: { ...turn.offer?.targets, ...outcome.targets } };
        return finish(outcome, turn);
      },
    }),
    strictTool({
      name: 'suggest_supplement',
      description:
        "Offer to add a supplement to the owner's daily checklist. Nothing is added: it appears as a button under your reply. Only well-evidenced basics, one at a time, and only when asked or clearly useful.",
      inputSchema: SuggestSupplementInput,
      run: async (input) => {
        const outcome = await actions.suggestSupplement({ name: input.name, dose: input.dose, time: input.time, why: input.why });
        if (outcome.ok && outcome.suggestion) {
          const held = turn.offer?.supplements ?? [];
          turn.offer = { ...turn.offer, supplements: [...held.filter((s) => s.name.toLowerCase() !== outcome.suggestion!.name.toLowerCase()), outcome.suggestion].slice(-3) };
        }
        return finish(outcome, turn);
      },
    }),
    strictTool({
      name: 'tick_supplements',
      description: "Tick supplements on the owner's checklist as taken, when they say they took them ('had my creatine', 'took all my supps').",
      inputSchema: TickSupplementsInput,
      run: async (input) => finish(await actions.tickSupplements({ names: input.names, all: input.all, date: input.date }), turn),
    }),
    strictTool({
      name: 'report_problem',
      description:
        "Write down something in the app that is not working: the owner says something is broken, a tool fails when it should not, a draft ignores what was asked, or a figure looks wrong. It is kept on the phone for the owner to share from Settings → Problem reports.",
      inputSchema: ReportProblemInput,
      run: async (input) => finish(await actions.reportProblem({ summary: input.summary, detail: input.detail }), turn),
    }),
    // Not strict: the API compiles every strict schema into one grammar with a size limit it does not
    // publish ("Schema is too complex for compilation", a 400). Build 127, the first with this one
    // strict (lists in lists), failed on chat; the eleven above are build 126's set, which worked.
    // Zod still checks the input before `run`; a bad one goes back to the model as a tool error.
    { ...strictTool({
      name: 'log_past_session',
      description:
        "Fill in a workout the owner did but did not log (today or the last 7 days). Use the sets they tell you; if they say they did a routine as planned, pass as_planned and no exercises. Ask for what you do not know (which day, which routine, the sets) rather than guess. It counts for History, the calendar, the streak and records, and changes no routine weight.",
      inputSchema: LogPastSessionInput,
      run: async (input) =>
        finish(
          await actions.logPastSession({
            date: input.date,
            routine: input.routine,
            asPlanned: input.as_planned,
            exercises: input.exercises.map((e) => ({ name: e.name, sets: e.sets.map((x) => ({ weightKg: x.weight_kg, reps: x.reps })) })),
          }),
          turn,
        ),
    }), strict: false },
    // Not strict either, for the same reason: the coach's hands on what is already logged (recordActions.ts).
    { ...strictTool({
      name: 'find_entries',
      description: "Look up what is logged on a day: its food, its weigh-in, or its sessions with every set. Each entry comes with a short id in square brackets, which edit_food and edit_training take. Use it before changing or deleting anything already logged.",
      inputSchema: FindEntriesInput,
      run: async (input) => finish(await actions.findEntries(input), turn),
    }), strict: false },
    { ...strictTool({
      name: 'edit_food',
      description: "Change or delete a logged food, by its id from find_entries: delete it, rename it, scale the amount eaten, or give new figures. Only your own estimates (marked ≈) take new figures; a label's, the UK table's or the owner's own can be scaled, not replaced. To correct a food, edit it; never delete it and log it again.",
      inputSchema: EditFoodInput,
      run: async (input) => finish(await actions.editFood(input), turn),
    }), strict: false },
    { ...strictTool({
      name: 'edit_training',
      description: "Change or delete a logged set (its weight or reps), or delete a whole session, by its id from find_entries. Not for the session still going. Delete a whole session only when the owner clearly asked for that session to go.",
      inputSchema: EditTrainingInput,
      run: async (input) => finish(await actions.editTraining({ id: input.id, delete: input.delete, weightKg: input.weight_kg, reps: input.reps }), turn),
    }), strict: false },
    { ...strictTool({
      name: 'delete_weight',
      description: 'Delete the weigh-in on a day. To correct one, use log_weight with the right figure instead: it replaces the day\'s reading.',
      inputSchema: DeleteWeightInput,
      run: async (input) => finish(await actions.deleteWeight(input.date), turn),
    }), strict: false },
    { ...strictTool({
      name: 'change_setting',
      description: "Change a setting when the owner asks for it: their goal (lean_gain, faster_gain, recomp, fat_loss), from which calories and macros are worked out and kept up to date; a daily calorie or protein figure of their own (this ends the goal's working-out); the step goal, sessions per week, the bodyweight goal range, rest times, or their year of birth or sex. To suggest a target they have not asked for, use propose_targets instead.",
      inputSchema: ChangeSettingInput,
      run: async (input) => finish(await actions.changeSetting(input), turn),
    }), strict: false },
    { ...strictTool({
      name: 'edit_supplement',
      description: 'Add a supplement to the daily checklist, remove one, or change its dose or time, when the owner asks. To suggest one they have not asked for, use suggest_supplement.',
      inputSchema: EditSupplementInput,
      run: async (input) => finish(await actions.editSupplement(input), turn),
    }), strict: false },
    { ...strictTool({
      name: 'manage_routine',
      description: "Rename, delete, restore (a deleted one) or copy a whole routine. To change the exercises in it, use edit_routine.",
      inputSchema: ManageRoutineInput,
      run: async (input) => finish(await actions.manageRoutine({ routine: input.routine, action: input.action, newName: input.new_name }), turn),
    }), strict: false },
    { ...strictTool({
      name: 'recipe',
      description: "Log a share of one of the owner's saved recipes as eaten (its own figures), or delete a recipe. The recipes are listed in the context.",
      inputSchema: RecipeInput,
      run: async (input) => finish(await actions.recipe(input), turn),
    }), strict: false },
    { ...strictTool({
      name: 'set_reminder',
      description: "Turn a phone reminder on or off, or change when it fires: the evening food reminder, the training nudge after days without a session, the weekly weigh-in, the morning supplements.",
      inputSchema: SetReminderInput,
      run: async (input) => finish(await actions.setReminder({ reminder: input.reminder, on: input.on, time: input.time, weekday: input.weekday, afterDays: input.after_days }), turn),
    }), strict: false },
    { ...strictTool({
      name: 'session',
      description: "Start a routine's session (the app opens it), open the finish screen for the session going (the owner checks next time's weights and saves there), or discard the session going and everything logged in it. Discard only when the owner clearly asked for it.",
      inputSchema: SessionInput,
      run: async (input) => finish(await actions.session(input), turn),
    }), strict: false },
  ];
  // The SDK runs every tool call of one reply at once, and each action reads then writes: two
  // skips in one reply kept one. So they queue, in the order the model asked.
  let queue: Promise<unknown> = Promise.resolve();
  for (const t of tools as unknown as { run: (...args: unknown[]) => Promise<unknown> }[]) {
    const run = t.run;
    t.run = (...args) => {
      const next = queue.then(() => run(...args));
      queue = next.catch(() => undefined);
      return next;
    };
  }
  return tools as unknown as CoachTool[];
}
