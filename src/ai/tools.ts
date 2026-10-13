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
import { MEAL_SLOTS, type MuscleGroup } from '@/domain/types';
import type { ActionResult, CoachActions } from './actions';
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

const BuildRoutineInput = z.object({
  request: z.string().describe('What the owner asked for, in their words: "a 45 minute shoulder routine", "push pull legs"'),
  focus: z.array(z.enum(MUSCLES)).optional().describe('Muscles to train, if you can read them from the request'),
  count: z.number().optional().describe('How many exercises, if asked'),
  minutes: z.number().optional().describe('How long the routine should take, if asked'),
  split: z.enum(['ppl', 'upper-lower', 'full-body']).optional().describe('A named split, if asked'),
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
        "Change a saved routine permanently: sets, rep range or weight of one exercise, or add or remove an exercise. Use for 'in my push day make bench 4 sets' or 'put it in the routine'. To change only today, use edit_session instead.",
      inputSchema: EditRoutineInput,
      run: async (input) =>
        finish(await actions.editRoutine({ routine: input.routine, exercise: input.exercise, change: input.change, sets: input.sets, repMin: input.rep_min, repMax: input.rep_max, weightKg: input.weight_kg }), turn),
    }),
    strictTool({
      name: 'edit_session',
      description:
        "Change today's live session only (the routine stays as it is): sets, reps or weight of an exercise, swap it for another, skip it or put it back, or add an exercise. Only works while a session is live.",
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
        const outcome = await actions.buildRoutine({ request: input.request, focus: input.focus, count: input.count, minutes: input.minutes, split: input.split });
        if (outcome.ok && outcome.draft) turn.draft = outcome.draft;
        return finish(outcome, turn);
      },
    }),
  ];
  return tools as unknown as CoachTool[];
}
