import * as z from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';
import type { CoachActions } from './actions';
import { strictSchemaProblems, toStrictJsonSchema } from './schema';
import { createCoachTools } from './tools';
import { INBODY_SCHEMA, LABEL_SCHEMA, MEAL_SCHEMA } from './vision';
import { REVIEW_SCHEMA } from './moments';
import { newTurnRecord } from './types';

function fakeActions(): { [K in keyof CoachActions]: ReturnType<typeof vi.fn> } & CoachActions {
  const ok = (result: string, description?: string) => vi.fn(async () => ({ ok: true, result, ...(description ? { description } : {}) }));
  return {
    logFood: ok('logged', 'Logged toast'),
    logWeight: ok('weighed', 'Weigh-in: 81 kg'),
    remember: ok('noted', 'Noted: x'),
    forget: ok('forgot', 'Forgot: x'),
    editRoutine: ok('edited', 'Bench: 5 sets'),
    buildRoutine: vi.fn(async () => ({ ok: true, result: 'draft', description: 'Drafted Push', draft: { routines: [], text: 'Push\nBench 3x8' } })),
    editSession: ok('session edited', 'Bench: 3 sets today'),
    proposeTargets: vi.fn(async () => ({ ok: true, result: 'offered', targets: { calories: 2500, protein: 160 } })),
    suggestSupplement: vi.fn(async ({ name }: { name: string }) => ({ ok: true, result: 'offered', suggestion: { name, dose: '5 g', time: 'any', why: 'Strength' } })),
    tickSupplements: ok('ticked', 'Supplements ticked: Creatine'),
  } as never;
}

describe('the tool definitions', () => {
  const tools = createCoachTools(fakeActions(), newTurnRecord());

  it('are the same ten, in the same order, every time (the order is part of the cache key)', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'log_food',
      'log_weight',
      'remember',
      'forget',
      'edit_routine',
      'edit_session',
      'build_routine',
      'propose_targets',
      'suggest_supplement',
      'tick_supplements',
    ]);
    expect(createCoachTools(fakeActions(), newTurnRecord()).map((t) => JSON.stringify([t.name, t.description, t.input_schema]))).toEqual(tools.map((t) => JSON.stringify([t.name, t.description, t.input_schema])));
  });

  it('are all strict, with schemas strict mode accepts', () => {
    let optional = 0;
    let unions = 0;
    for (const tool of tools) {
      expect(tool.strict, tool.name).toBe(true);
      const { problems, stats } = strictSchemaProblems(tool.input_schema);
      expect(problems, tool.name).toEqual([]);
      optional += stats.optional;
      unions += stats.unions;
    }
    // Strict mode documents 24 optional parameters and 16 union-typed parameters per request.
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
    expect(tools.length).toBeLessThanOrEqual(20);
  });

  it('keep their enums in the schema the API sees', () => {
    const edit = tools.find((t) => t.name === 'edit_routine')!;
    const props = (edit.input_schema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.change!.enum).toEqual(['sets', 'reps', 'weight', 'add', 'remove']);
    const food = tools.find((t) => t.name === 'log_food')!;
    expect((food.input_schema as any).properties.slot.enum).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('describe what each is for in plain words', () => {
    for (const tool of tools) {
      expect(tool.description!.length, tool.name).toBeGreaterThan(30);
    }
  });
});

describe('what a tool does with the model\'s input', () => {
  it('calls the action with the input in the app\'s own names, and hands the model its one-line result', async () => {
    const actions = fakeActions();
    const turn = newTurnRecord();
    const tools = createCoachTools(actions, turn);
    const edit = tools.find((t) => t.name === 'edit_session')!;
    const out = await edit.run({ exercise: 'bench', change: 'reps', rep_min: 8, rep_max: 10 });
    expect(out).toBe('session edited');
    expect(actions.editSession).toHaveBeenCalledWith({ exercise: 'bench', change: 'reps', sets: undefined, repMin: 8, repMax: 10, weightKg: undefined, swapTo: undefined });
    expect(turn.actions).toEqual(['Bench: 3 sets today']);
  });

  it('hands log_food its date, which the schema offers as optional', async () => {
    const actions = fakeActions();
    const food = createCoachTools(actions, newTurnRecord()).find((t) => t.name === 'log_food')!;
    const item = { name: 'Toast', amount: 1, unit: 'slice', kcal: 90, protein: 3, carbs: 17, fat: 1 };
    const props = (food.input_schema as { properties: Record<string, unknown>; required: string[] }).properties;
    expect(Object.keys(props)).toEqual(['items', 'slot', 'date']);
    expect((food.input_schema as { required: string[] }).required).toEqual(['items']);

    await food.run(food.parse({ items: [item], slot: 'dinner', date: '2026-10-10' }));
    expect(actions.logFood).toHaveBeenLastCalledWith({ items: [item], slot: 'dinner', date: '2026-10-10' });
    await food.run(food.parse({ items: [item] }));
    expect(actions.logFood).toHaveBeenLastCalledWith({ items: [item], slot: undefined, date: undefined });
  });

  it('keeps a drafted routine on the turn', async () => {
    const turn = newTurnRecord();
    const tools = createCoachTools(fakeActions(), turn);
    await tools.find((t) => t.name === 'build_routine')!.run({ request: 'push day' });
    expect(turn.draft).toEqual({ routines: [], text: 'Push\nBench 3x8' });
    expect(turn.actions).toEqual(['Drafted Push']);
  });

  it('throws when the action could not be done, adding nothing to the turn', async () => {
    const actions = fakeActions();
    (actions.editRoutine as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, result: 'No routine called "x".' });
    const turn = newTurnRecord();
    const tool = createCoachTools(actions, turn).find((t) => t.name === 'edit_routine')!;
    await expect(tool.run({ routine: 'x', exercise: 'y', change: 'sets', sets: 3 })).rejects.toThrow('No routine called "x".');
    expect(turn.actions).toEqual([]);
  });

  it('rejects input that is not in the schema before the action is reached', () => {
    const tool = createCoachTools(fakeActions(), newTurnRecord()).find((t) => t.name === 'edit_routine')!;
    expect(() => tool.parse({ routine: 'a', exercise: 'b', change: 'explode' })).toThrow();
    expect(() => tool.parse({ routine: 'a', exercise: 'b' })).toThrow();
    expect(() => tool.parse({ routine: 'a', exercise: 'b', change: 'sets', sets: '3' })).toThrow();
    expect(tool.parse({ routine: 'a', exercise: 'b', change: 'sets', sets: 3 })).toEqual({ routine: 'a', exercise: 'b', change: 'sets', sets: 3 });
  });
});

describe('toStrictJsonSchema', () => {
  it('keeps enums, consts and unions, closes every object and drops what strict mode refuses', () => {
    const schema = toStrictJsonSchema(
      z.object({
        name: z.string().min(2).max(40).describe('A name'),
        n: z.number().int().min(1).max(5),
        kind: z.enum(['a', 'b']),
        fixed: z.literal('k'),
        maybe: z.string().nullable(),
        inner: z.object({ x: z.number().optional() }),
        list: z.array(z.object({ y: z.number().positive() })).min(2),
      }),
    ) as any;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.kind.enum).toEqual(['a', 'b']);
    expect(schema.properties.fixed.const).toBe('k');
    expect(schema.properties.maybe.type).toEqual(['string', 'null']);
    expect(schema.properties.inner.additionalProperties).toBe(false);
    expect(schema.properties.name.minLength).toBeUndefined();
    expect(schema.properties.name.description).toContain('A name');
    expect(schema.properties.name.description).toContain('minLength 2');
    expect(schema.properties.n.minimum).toBeUndefined();
    expect(schema.properties.n.description).toContain('minimum 1');
    expect(schema.properties.list.minItems).toBeUndefined();
    expect(strictSchemaProblems(schema).problems).toEqual([]);
    expect(strictSchemaProblems(schema).stats).toEqual({ optional: 1, unions: 1 });
  });

  it('is found wanting when a schema breaks the rules', () => {
    const bad = { type: 'object', properties: { n: { type: 'number', minimum: 1 } }, required: ['n'] };
    expect(strictSchemaProblems(bad).problems).toEqual(['$: object without additionalProperties: false', '$.n: minimum is not allowed']);
  });

  it('holds for the structured-output schemas too', () => {
    for (const [name, schema] of Object.entries({ MEAL_SCHEMA, LABEL_SCHEMA, INBODY_SCHEMA, REVIEW_SCHEMA })) {
      const { problems, stats } = strictSchemaProblems(schema);
      expect(problems, name).toEqual([]);
      expect(stats.optional, name).toBeLessThanOrEqual(24);
      expect(stats.unions, name).toBeLessThanOrEqual(16);
    }
  });
});

describe('the offer tools', () => {
  it('leave targets and supplements on the turn as an offer, and change nothing themselves', async () => {
    const actions = fakeActions();
    const turn = newTurnRecord();
    const tools = createCoachTools(actions, turn);
    const run = (name: string, input: unknown) => (tools.find((t) => t.name === name)! as unknown as { run: (i: unknown) => Promise<string> }).run(input);
    await run('propose_targets', { calories: 2500, protein: 160 });
    await run('suggest_supplement', { name: 'Creatine', why: 'Strength' });
    await run('suggest_supplement', { name: 'creatine', why: 'Again' });
    expect(turn.offer).toEqual({ targets: { calories: 2500, protein: 160 }, supplements: [{ name: 'creatine', dose: '5 g', time: 'any', why: 'Strength' }] });
    expect(turn.actions).toEqual([]);
    await run('tick_supplements', { all: true });
    expect(actions.tickSupplements).toHaveBeenCalledWith({ names: undefined, all: true, date: undefined });
    expect(turn.actions).toEqual(['Supplements ticked: Creatine']);
  });
});
