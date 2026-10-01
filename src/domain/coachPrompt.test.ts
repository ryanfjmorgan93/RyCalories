import { describe, expect, it } from 'vitest';
import { cand, miniInput } from '../test/routineFixtures';
import {
  THREAD_TURNS,
  buildCoachPrompt,
  buildCoachSystemPrompt,
  buildRoutineBlock,
  fitCoachPrompt,
  fitsLimit,
  promptShapes,
  shapedPrompt,
  type CoachRung,
  type CoachTurn,
  type PromptShape,
} from './coach';
import { buildRoutines, routineToText, type BuiltRoutine } from './routineBuilder';

const turn = (i: number): CoachTurn => ({ role: i % 2 === 0 ? 'user' : 'coach', text: `turn ${i}` });
const thread = (n: number): CoachTurn[] => Array.from({ length: n }, (_, i) => turn(i));

const ROUTINE: BuiltRoutine = {
  name: 'Shoulders',
  rows: [
    {
      id: 'a',
      name: 'DB Shoulder Press',
      sets: 4,
      repMin: 6,
      repMax: 10,
      weightKg: 22,
      origin: 'own',
      muscleGroup: 'shoulders',
      pattern: 'press-vertical',
      region: 'shoulders:front',
      tier: 'primary',
      reason: 'shoulders · front delts (vertical press) · last trained 6 days ago · your working weight 22 kg',
    },
    {
      id: 'cat:front-raise',
      name: 'Front Raise',
      sets: 3,
      repMin: 10,
      repMax: 15,
      weightKg: null,
      origin: 'catalogue',
      catalogueSlug: 'front-raise',
      muscleGroup: 'shoulders',
      pattern: 'front-raise',
      region: 'shoulders:front',
      tier: 'isolation',
      reason: 'shoulders · front delts (front raise) · new to you, no weight yet',
    },
  ],
  reasonLines: ['Focus: shoulders, as asked', 'One exercise per movement: vertical press and front raise', 'About 20 min at your pace'],
  estimateMinutes: 20,
  focus: ['shoulders'],
  unmet: [],
};

const RUNGS: CoachRung[] = [
  { text: 'DATA FULL', label: 'training 8 weeks · food 4 weeks' },
  { text: 'DATA SMALLER', label: 'training 4 weeks' },
  { text: 'DATA SMALLEST', label: 'training 1 week' },
  { text: '', label: 'none of your data' },
];

describe('the ask prompt', () => {
  const system = buildCoachSystemPrompt('ask');

  it('answers what was asked, briefly, in British English and kilograms', () => {
    expect(system).toContain('Answer what was asked, briefly.');
    expect(system).toContain('British English');
    expect(system).toContain('kilograms');
  });

  it('uses the owner\'s data for their own training, food and bodyweight, quoting dates and sets', () => {
    expect(system).toMatch(/questions about the user's own training, food or bodyweight, use their data below/);
    expect(system).toContain('quote the dates and sets');
  });

  it('uses general training knowledge for what works a muscle, why a rep range suits a goal and what an exercise is', () => {
    expect(system).toContain('answer from general training knowledge');
    expect(system).toContain('what works a muscle');
    expect(system).toContain('rep range suits a goal');
    expect(system).toContain('what an exercise is');
  });

  it('explains a routine the app built from its reasons, and nothing the reasons do not support', () => {
    expect(system).toContain('If a routine the app built is below');
    expect(system).toContain('Explain the routine from those reasons');
    expect(system).toContain('say nothing about it that they do not support');
  });

  it('never invents the owner\'s numbers, and says "Not in your data." only for a number of theirs that is not logged', () => {
    expect(system).toContain('Never make up a number of theirs');
    expect(system.match(/Not in your data\./g)).toHaveLength(1);
    expect(system).toContain('Say "Not in your data." only when asked for a number of theirs that is not logged');
    // The old rule, which turned every question the data did not answer into that sentence.
    expect(system).not.toContain('If the data does not answer the question');
  });

  it('asks the user nothing, and has no encouragement, no motivation and no tips beyond what was asked', () => {
    expect(system).toContain('Ask the user nothing');
    expect(system).toContain('No encouragement, no motivational lines, no tips beyond what was asked');
  });

  it('is short: the model reads about four thousand tokens, and this is a few hundred characters of them', () => {
    expect(system.length).toBeLessThan(1200);
    expect(system.split('\n').length).toBeLessThanOrEqual(7);
  });

  it('does not tell the model to write a routine: the app builds them', () => {
    expect(system).not.toMatch(/reply with the routine|exercise name 3x8/i);
  });

  it('the routine prompt is as it was', () => {
    expect(buildCoachSystemPrompt('routine')).toContain('Exercise name 3x8-10 @ 60kg');
  });
});

describe('buildRoutineBlock', () => {
  it('is the routine as the app writes it, then why: each exercise\'s reason, then the lines', () => {
    expect(buildRoutineBlock([ROUTINE])).toBe(
      [
        'Routine the app built:',
        'Shoulders',
        'DB Shoulder Press 4x6-10 @ 22kg',
        'Front Raise 3x10-15',
        '',
        'Why:',
        'DB Shoulder Press: shoulders · front delts (vertical press) · last trained 6 days ago · your working weight 22 kg',
        'Front Raise: shoulders · front delts (front raise) · new to you, no weight yet',
        'Focus: shoulders, as asked',
        'One exercise per movement: vertical press and front raise',
        'About 20 min at your pace',
      ].join('\n'),
    );
  });

  it('carries the routine text exactly as `routineToText` writes it', () => {
    expect(buildRoutineBlock([ROUTINE]).split('\n\nWhy:')[0]).toBe(`Routine the app built:\n${routineToText([ROUTINE])}`);
  });

  it('can leave out the exercises\' own reasons, then all the reasons, and never the routine', () => {
    const lines = buildRoutineBlock([ROUTINE], 'lines');
    expect(lines).toContain('Why:\nFocus: shoulders, as asked');
    expect(lines).not.toContain('front delts (vertical press)');
    const text = buildRoutineBlock([ROUTINE], 'text');
    expect(text).toBe('Routine the app built:\nShoulders\nDB Shoulder Press 4x6-10 @ 22kg\nFront Raise 3x10-15');
    expect(buildRoutineBlock([ROUTINE], 'full').length).toBeGreaterThan(lines.length);
    expect(lines.length).toBeGreaterThan(text.length);
  });

  it('names the routine on each line of the reasons when there are several', () => {
    const other: BuiltRoutine = { ...ROUTINE, name: 'Pull', reasonLines: ['Focus: lats, as asked'], rows: [] };
    const block = buildRoutineBlock([ROUTINE, other]);
    expect(block).toContain('\n\nWhy:\nShoulders: DB Shoulder Press: shoulders · front delts');
    expect(block).toContain('Pull: Focus: lats, as asked');
    expect(block).toContain('Shoulders: About 20 min at your pace');
  });

  it('is nothing for no routine', () => {
    expect(buildRoutineBlock([])).toBe('');
  });

  it('is built from what the builder says, whatever it built', () => {
    const pool = miniInput([cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 22 }), cand('Lateral Raise', 'shoulders', { weight: 8 })]);
    const built = buildRoutines(pool, { focus: ['shoulders'], count: 2 }, 1);
    const block = buildRoutineBlock(built);
    for (const row of built[0]!.rows) expect(block).toContain(`${row.name}: ${row.reason}`);
    for (const line of built[0]!.reasonLines) expect(block).toContain(line);
  });
});

describe('buildCoachPrompt', () => {
  it('puts the routine after the data and before the conversation', () => {
    const block = buildRoutineBlock([ROUTINE], 'text');
    expect(buildCoachPrompt('DATA', thread(2), ' Why? ', block)).toBe(['DATA', block, 'User: turn 0', 'Coach: turn 1', 'User: Why?'].join('\n\n'));
  });

  it('is as it was without a routine', () => {
    expect(buildCoachPrompt('DATA', thread(2), 'q')).toBe('DATA\n\nUser: turn 0\n\nCoach: turn 1\n\nUser: q');
    expect(buildCoachPrompt('', thread(2), 'q', '')).toBe('User: turn 0\n\nCoach: turn 1\n\nUser: q');
  });

  it('carries the last three exchanges: six turns', () => {
    expect(THREAD_TURNS).toBe(6);
    const prompt = buildCoachPrompt('', thread(10), 'now');
    expect(prompt).toBe(['User: turn 4', 'Coach: turn 5', 'User: turn 6', 'Coach: turn 7', 'User: turn 8', 'Coach: turn 9', 'User: now'].join('\n\n'));
    expect(prompt).not.toContain('turn 3');
  });

  it('carries a shorter thread whole', () => {
    expect(buildCoachPrompt('', thread(3), 'now').split('\n\n')).toHaveLength(4);
  });
});

describe('promptShapes: what is dropped, and in what order', () => {
  it('drops the oldest exchange first, then shrinks the data, then the reasons, and the last exchange last', () => {
    expect(promptShapes(6, 4, true)).toEqual([
      { turns: 6, rung: 0, detail: 'full' },
      { turns: 4, rung: 0, detail: 'full' },
      { turns: 2, rung: 0, detail: 'full' },
      { turns: 2, rung: 1, detail: 'full' },
      { turns: 2, rung: 2, detail: 'full' },
      { turns: 2, rung: 3, detail: 'full' },
      { turns: 2, rung: 3, detail: 'lines' },
      { turns: 2, rung: 3, detail: 'text' },
      { turns: 0, rung: 3, detail: 'text' },
    ]);
  });

  it('has no reasons to drop when there is no routine', () => {
    expect(promptShapes(4, 3, false)).toEqual([
      { turns: 4, rung: 0, detail: 'full' },
      { turns: 2, rung: 0, detail: 'full' },
      { turns: 2, rung: 1, detail: 'full' },
      { turns: 2, rung: 2, detail: 'full' },
      { turns: 0, rung: 2, detail: 'full' },
    ]);
  });

  it('is only the data to shrink for a new conversation', () => {
    expect(promptShapes(0, 3, false)).toEqual([
      { turns: 0, rung: 0, detail: 'full' },
      { turns: 0, rung: 1, detail: 'full' },
      { turns: 0, rung: 2, detail: 'full' },
    ]);
    expect(promptShapes(0, 1, true)).toEqual([
      { turns: 0, rung: 0, detail: 'full' },
      { turns: 0, rung: 0, detail: 'lines' },
      { turns: 0, rung: 0, detail: 'text' },
    ]);
  });

  it('reaches the last exchange from a thread cut in the middle of one', () => {
    expect(promptShapes(5, 1, false).map((s) => s.turns)).toEqual([5, 3, 2, 0]);
    expect(promptShapes(1, 1, false).map((s) => s.turns)).toEqual([1, 0]);
  });

  it('never carries more than the thread holds or the cap allows', () => {
    expect(promptShapes(50, 2, false)[0]!.turns).toBe(THREAD_TURNS);
    expect(promptShapes(3, 2, false)[0]!.turns).toBe(3);
  });

  it('only ever gets smaller: turns never rise, the data never grows, the reasons never come back, and none repeats', () => {
    const order = { full: 0, lines: 1, text: 2 } as const;
    for (const [len, rungs, routine] of [[6, 5, true], [4, 3, true], [2, 4, false], [5, 2, true], [0, 5, true]] as const) {
      const shapes = promptShapes(len, rungs, routine);
      for (let i = 1; i < shapes.length; i++) {
        const a = shapes[i - 1]!;
        const b = shapes[i]!;
        expect(b.turns, `${len},${rungs}`).toBeLessThanOrEqual(a.turns);
        expect(b.rung).toBeGreaterThanOrEqual(a.rung);
        expect(order[b.detail]).toBeGreaterThanOrEqual(order[a.detail]);
        expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
      }
      expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(shapes.length);
    }
  });

  it('keeps the last exchange until every rung and every reason has been tried', () => {
    const shapes = promptShapes(6, 4, true);
    const firstWithout = shapes.findIndex((s) => s.turns === 0);
    expect(firstWithout).toBe(shapes.length - 1);
    expect(shapes[firstWithout - 1]).toEqual({ turns: 2, rung: 3, detail: 'text' });
  });

  it('copes with nonsense', () => {
    const cases: [number, number, boolean][] = [[Number.NaN, Number.NaN, true], [-3, 0, false], [Infinity, Infinity, true], [2.7, 1.5, true]];
    for (const [len, rungs, routine] of cases) {
      expect(() => promptShapes(len, rungs, routine)).not.toThrow();
      expect(promptShapes(len, rungs, routine).length).toBeGreaterThan(0);
    }
  });
});

describe('fitsLimit', () => {
  it('fits when the prompt and the room for the reply come to the limit or under it', () => {
    expect(fitsLimit({ tokens: 3400, limit: 4000 }, 600)).toBe(true);
    expect(fitsLimit({ tokens: 3401, limit: 4000 }, 600)).toBe(false);
    expect(fitsLimit({ tokens: 0, limit: 4000 }, 600)).toBe(true);
  });

  it('never fits a count that is no number', () => {
    expect(fitsLimit({ tokens: Number.NaN, limit: 4000 }, 600)).toBe(false);
    expect(fitsLimit({ tokens: 10, limit: Number.NaN }, 600)).toBe(false);
    expect(fitsLimit({ tokens: 10, limit: Infinity }, 600)).toBe(false);
  });
});

describe('fitCoachPrompt', () => {
  const LIMIT = 4000;
  const REPLY = 600;
  /** What counting a shape comes to on a phone: a fixed part, each turn, the rung's data, the routine's reasons. */
  function counter(rungTokens: number[]) {
    const calls: PromptShape[] = [];
    const count = async (s: PromptShape) => {
      calls.push(s);
      return { tokens: 800 + 100 * s.turns + rungTokens[s.rung]! + { full: 300, lines: 120, text: 0 }[s.detail], limit: LIMIT };
    };
    return { count, calls };
  }
  const shapes = promptShapes(6, 4, true);

  it('takes the fullest shape when it fits, and counts once', async () => {
    const { count, calls } = counter([1000, 600, 300, 0]);
    expect(await fitCoachPrompt(shapes, count, REPLY)).toEqual({ shape: shapes[0], tries: 1 });
    expect(calls).toHaveLength(1);
  });

  it('drops the oldest turns before it touches the data', async () => {
    // 800 + 600 + 2000 + 300 = 3700 with six turns; 3500 with four; 3300 with two.
    const { count, calls } = counter([2000, 1200, 700, 0]);
    const fit = await fitCoachPrompt(shapes, count, REPLY);
    expect(fit?.shape).toEqual({ turns: 2, rung: 0, detail: 'full' });
    expect(fit?.tries).toBe(3);
    expect(calls.map((c) => c.turns)).toEqual([6, 4, 2]);
    expect(calls.every((c) => c.rung === 0 && c.detail === 'full')).toBe(true);
  });

  it('shrinks the data once only the last exchange is left to drop, and keeps that exchange', async () => {
    const { count, calls } = counter([3000, 1200, 700, 0]);
    const fit = await fitCoachPrompt(shapes, count, REPLY);
    expect(fit?.shape).toEqual({ turns: 2, rung: 1, detail: 'full' });
    expect(calls.map((c) => [c.turns, c.rung])).toEqual([[6, 0], [4, 0], [2, 0], [2, 1]]);
  });

  it('shrinks the data before it touches the routine\'s reasons', async () => {
    // 800 + 200 turns + the rung + 300 reasons: 3800 at rung 1, 3300 at rung 2.
    const fit = await fitCoachPrompt(shapes, counter([3000, 2500, 2000, 1500]).count, REPLY);
    expect(fit?.shape).toEqual({ turns: 2, rung: 2, detail: 'full' });
  });

  it('drops the routine\'s reasons only after the owner\'s data is down to its smallest', async () => {
    // At the last rung: 3650 with the reasons whole, 3470 with the summary, 3350 with the routine alone.
    const fit = await fitCoachPrompt(shapes, counter([3000, 2800, 2600, 2350]).count, REPLY);
    expect(fit?.shape).toEqual({ turns: 2, rung: 3, detail: 'text' });
    // Over even with the routine alone: the last exchange goes, and only then.
    const last = await fitCoachPrompt(shapes, counter([3000, 2800, 2700, 2500]).count, REPLY);
    expect(last?.shape).toEqual({ turns: 0, rung: 3, detail: 'text' });
  });

  it('is null when even the smallest shape is over, having tried every one once', async () => {
    const { count, calls } = counter([9000, 9000, 9000, 9000]);
    expect(await fitCoachPrompt(shapes, count, REPLY)).toBeNull();
    expect(calls).toHaveLength(shapes.length);
  });

  it('is the first shape that fits, by brute force, for any counter that only goes down', async () => {
    for (const base of [800, 2000, 2900, 3300, 3399, 3400, 3401, 4500]) {
      const count = async (s: PromptShape) => ({
        tokens: base + 90 * s.turns + [400, 250, 100, 0][s.rung]! + { full: 200, lines: 80, text: 0 }[s.detail],
        limit: LIMIT,
      });
      const expected = (() => {
        for (const s of shapes) {
          const t = base + 90 * s.turns + [400, 250, 100, 0][s.rung]! + { full: 200, lines: 80, text: 0 }[s.detail];
          if (t + REPLY <= LIMIT) return s;
        }
        return null;
      })();
      const fit = await fitCoachPrompt(shapes, count, REPLY);
      expect(fit?.shape ?? null, `base ${base}`).toEqual(expected);
    }
  });

  it('reads the limit the phone reports each time, not a fixed one', async () => {
    const count = async () => ({ tokens: 3000, limit: 3500 });
    expect(await fitCoachPrompt(shapes, count, REPLY)).toBeNull();
    expect(await fitCoachPrompt(shapes, async () => ({ tokens: 3000, limit: 3600 }), REPLY)).toEqual({ shape: shapes[0], tries: 1 });
  });

  it('lets a failure of the counter through, rather than guess at a fit', async () => {
    await expect(fitCoachPrompt(shapes, async () => Promise.reject(new Error('The model did not answer.')), REPLY)).rejects.toThrow('The model did not answer.');
  });

  it('is nothing to try for no shapes', async () => {
    expect(await fitCoachPrompt([], async () => ({ tokens: 0, limit: 4000 }), REPLY)).toBeNull();
  });
});

describe('shapedPrompt', () => {
  const built = [ROUTINE];

  it('is the prompt for the shape, and says in words what it holds', () => {
    const shaped = shapedPrompt({ turns: 6, rung: 0, detail: 'full' }, RUNGS, thread(8), 'Why?', built);
    expect(shaped.label).toBe('training 8 weeks · food 4 weeks · routine and reasons · last 3 exchanges');
    expect(shaped.prompt).toBe(buildCoachPrompt('DATA FULL', thread(8).slice(-6), 'Why?', buildRoutineBlock(built, 'full')));
  });

  it('says it when the conversation, the data or the reasons were cut', () => {
    expect(shapedPrompt({ turns: 2, rung: 1, detail: 'lines' }, RUNGS, thread(8), 'q', built).label).toBe('training 4 weeks · routine and summary · last exchange');
    expect(shapedPrompt({ turns: 0, rung: 3, detail: 'text' }, RUNGS, thread(8), 'q', built).label).toBe('none of your data · routine only');
    expect(shapedPrompt({ turns: 4, rung: 2, detail: 'full' }, RUNGS, thread(8), 'q', []).label).toBe('training 1 week · last 2 exchanges');
  });

  it('carries only the turns the shape keeps, the newest, and only the routine detail it names', () => {
    const shaped = shapedPrompt({ turns: 2, rung: 0, detail: 'text' }, RUNGS, thread(8), 'q', built);
    expect(shaped.prompt).toContain('User: turn 6\n\nCoach: turn 7');
    expect(shaped.prompt).not.toContain('turn 5');
    expect(shaped.prompt).not.toContain('Why:');
    expect(shaped.prompt).toContain('Routine the app built:');
  });

  it('holds no routine block when there was no routine', () => {
    expect(shapedPrompt({ turns: 0, rung: 0, detail: 'full' }, RUNGS, [], 'q', []).prompt).toBe('DATA FULL\n\nUser: q');
  });

  it('clamps a rung that is past the ladder to the last, and survives an empty ladder', () => {
    expect(shapedPrompt({ turns: 0, rung: 99, detail: 'full' }, RUNGS, [], 'q', []).label).toBe('none of your data');
    expect(shapedPrompt({ turns: 0, rung: 0, detail: 'full' }, [], [], 'q', []).label).toBe('none of your data');
  });
});
