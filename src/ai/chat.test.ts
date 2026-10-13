/**
 * @vitest-environment jsdom
 *
 * A whole chat turn through the real SDK (request building, the tool runner, retries) on a fake
 * `fetch`, against the real data code on fake-indexeddb. Nothing reaches the network.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { mealsOnDay } from '@/db/foodRepo';
import { listRoutines, resetToSeed, routineItems } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import type { CoachMessage } from '@/domain/types';
import { fakeClaude, lastUserText, systemText, text, toolUse, type FakeRequest } from '@/test/fakeClaude';
import { createCoachActions } from './actions';
import { CHAT_MAX_TOKENS, historyTurns, sendCoachMessage } from './chat';
import { CLAUDE_ERROR_MESSAGES, MAX_TOOL_ITERATIONS } from './client';
import { clearApiKey, setApiKey } from './key';
import { setCap, spendThisMonth } from './spend';
import { resetMemory } from './store';

const KEY = 'sk-ant-api03-CHATTESTKEYCHATTESTKEYCHATTESTKEYwxyz';
const NOW = new Date(2026, 9, 12, 14, 35, 0);

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  setApiKey(KEY);
  await resetToSeed();
  await db.coachNotes.clear();
  await db.coachMessages.clear();
  await db.bodyweight.clear();
});

const ctx = { context: { now: NOW } };

async function thread(): Promise<CoachMessage[]> {
  return (await db.coachMessages.toArray()).sort((a, b) => a.at.localeCompare(b.at));
}

describe('a turn where the coach uses a tool and then answers', () => {
  const script = [
    { content: [text('Noting that.'), toolUse('toolu_1', 'remember', { text: 'Left knee twinges on deep squats' })], stop_reason: 'tool_use' as const, usage: { input_tokens: 3000, output_tokens: 80, cache_creation_input_tokens: 4000 } },
    { content: [text('Noted. Keep the squats shallow for now and tell me how it feels.')], usage: { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 4000 } },
  ];

  it('writes the note, stores both turns with the action line, and returns the reply', async () => {
    const fake = fakeClaude(...script);
    const reply = await sendCoachMessage('My left knee twinges on deep squats, remember that', { fetch: fake.fetch, ...ctx });

    expect(reply).toMatchObject({
      ok: true,
      text: 'Noted. Keep the squats shallow for now and tell me how it feels.',
      actions: ['Noted: Left knee twinges on deep squats'],
    });
    expect((await db.coachNotes.toArray()).map((n) => n.text)).toEqual(['Left knee twinges on deep squats']);

    const rows = await thread();
    expect(rows.map((r) => r.role)).toEqual(['user', 'coach']);
    expect(rows[0]!.text).toBe('My left knee twinges on deep squats, remember that');
    expect(rows[1]).toMatchObject({ text: reply.text, actions: ['Noted: Left knee twinges on deep squats'] });
    expect(rows[1]!.at > rows[0]!.at).toBe(true);
    expect(rows[0]!.actions).toBeUndefined();
  });

  it('sends the request the API requires of Sonnet 5.5, laid out for the cache', async () => {
    const fake = fakeClaude(...script);
    await sendCoachMessage('My left knee twinges on deep squats, remember that', { fetch: fake.fetch, ...ctx });
    expect(fake.requests).toHaveLength(2);

    for (const req of fake.requests) {
      expect(req.url).toContain('/v1/messages');
      expect(req.headers['x-api-key']).toBe(KEY);
      expect(req.body.model).toBe('claude-sonnet-5-5');
      expect(req.body.max_tokens).toBe(CHAT_MAX_TOKENS);
      expect(req.body.output_config).toEqual({ effort: 'low' });
      // Sonnet 5.5 rejects both of these with a 400.
      expect(req.body.thinking).toBeUndefined();
      expect(req.body.tool_choice).toBeUndefined();
      expect(req.body.stream).not.toBe(true);
      expect(req.body.tools.map((t: { name: string }) => t.name)).toEqual(['log_food', 'log_weight', 'remember', 'forget', 'edit_routine', 'edit_session', 'build_routine', 'propose_targets', 'suggest_supplement', 'tick_supplements']);
      expect(req.body.tools.every((t: { strict: boolean }) => t.strict === true)).toBe(true);
    }

    // The tools and the persona and stable context are one cached prefix; the volatile part follows it, uncached.
    const system = fake.requests[0]!.body.system as { type: string; text: string; cache_control?: { type: string } }[];
    expect(system).toHaveLength(2);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]!.text).toContain('You are the coach inside Iron');
    expect(system[0]!.text).toContain('COACH NOTES');
    expect(system[0]!.text).toContain('ROUTINES');
    expect(system[0]!.text).not.toContain('NOW:');
    expect(system[1]!.cache_control).toBeUndefined();
    expect(system[1]!.text).toContain('NOW: Monday, 12 October 2026 at 14:35');
    // Both requests of the turn share their prefix byte for byte, so the second reads the first's cache.
    expect(fake.requests[1]!.body.system).toEqual(fake.requests[0]!.body.system);
    expect(fake.requests[1]!.body.tools).toEqual(fake.requests[0]!.body.tools);
    expect(JSON.stringify(fake.requests).match(/"cache_control"/g)?.length).toBeLessThanOrEqual(8);
  });

  it('hands the tool result back to the model, then records the spend of both requests', async () => {
    const fake = fakeClaude(...script);
    await sendCoachMessage('My left knee twinges on deep squats, remember that', { fetch: fake.fetch, ...ctx });

    const second = fake.requests[1]!.body.messages as { role: string; content: any }[];
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[0]!.content).toBe('My left knee twinges on deep squats, remember that');
    expect(second[1]!.content.some((b: { type: string }) => b.type === 'tool_use')).toBe(true);
    expect(second[2]!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(second[2]!.content[0].content).toMatch(/^Noted as \[[0-9a-f]{8}\]\.$/);
    expect(second[2]!.content[0].is_error).toBeFalsy();

    // $2/M in + $2.50/M cache write + $10/M out, then the cheap cache read.
    const first = 3000 * 2e-6 + 80 * 10e-6 + 4000 * 2.5e-6;
    const next = 200 * 2e-6 + 60 * 10e-6 + 4000 * 0.2e-6;
    expect(spendThisMonth()).toBeCloseTo(first + next, 6);
  });
});

describe('history', () => {
  it('sends the last 20 turns as plain text, starting with the owner, joining neighbours and naming what the coach changed', async () => {
    const rows: CoachMessage[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push({ id: `m${String(i).padStart(2, '0')}`, at: new Date(2026, 9, 11, 8, i).toISOString(), role: i % 2 === 0 ? 'user' : 'coach', text: `turn ${i}`, ...(i === 21 ? { actions: ['Bench Press (Barbell): 3 sets today'] } : {}) });
    }
    // A line the coach volunteered sits beside its neighbour.
    rows.push({ id: 'mx', at: new Date(2026, 9, 11, 9, 0).toISOString(), role: 'coach', text: 'Unprompted line', moment: 'open' });
    await db.coachMessages.bulkPut(rows);

    const fake = fakeClaude({ content: [text('Fine.')] });
    await sendCoachMessage('and now?', { fetch: fake.fetch, ...ctx });

    const messages = fake.requests[0]!.body.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe('user');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'and now?' });
    // Roles alternate (neighbours joined), the oldest sent is turn 11 (31 rows, the last 20, then the first coach one dropped).
    for (let i = 1; i < messages.length; i++) expect(messages[i]!.role).not.toBe(messages[i - 1]!.role);
    const flat = messages.map((m) => m.content).join('\n');
    expect(flat).not.toContain('turn 10');
    expect(flat).toContain('turn 12');
    expect(flat).toContain('turn 21 [Changes made: Bench Press (Barbell): 3 sets today]');
    expect(flat).toContain('turn 29\nUnprompted line');
  });

  it('builds history turns that start with the owner and drop empty rows', () => {
    const turns = historyTurns(
      [
        { id: '1', at: '2026-10-11T08:00:00.000Z', role: 'coach', text: 'Morning.', moment: 'open' },
        { id: '2', at: '2026-10-11T08:01:00.000Z', role: 'user', text: 'Hello' },
        { id: '3', at: '2026-10-11T08:02:00.000Z', role: 'coach', text: '   ' },
        { id: '4', at: '2026-10-11T08:03:00.000Z', role: 'user', text: 'Anyone there?' },
      ],
      20,
    );
    expect(turns).toEqual([{ role: 'user', content: 'Hello\nAnyone there?' }]);
  });
});

describe('when the model\'s tool call cannot be done', () => {
  it('hands the reason back as a tool error, and records no action', async () => {
    const fake = fakeClaude(
      { content: [toolUse('toolu_9', 'edit_routine', { routine: 'Leg day of doom', exercise: 'Squat', change: 'sets', sets: 3 })], stop_reason: 'tool_use' },
      { content: [text("I couldn't find that routine. Which one did you mean?")] },
    );
    const reply = await sendCoachMessage('make squats 3 sets in my leg day of doom', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: true, actions: [] });
    const result = (fake.requests[1]!.body.messages as any[]).at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true });
    expect(result.content).toContain('No routine called "Leg day of doom"');
    expect((await thread()).at(-1)!.actions).toBeUndefined();
  });

  it('validates the model\'s input against the schema before running anything', async () => {
    const fake = fakeClaude(
      { content: [toolUse('toolu_9', 'log_weight', { kg: 'about eighty' })], stop_reason: 'tool_use' },
      { content: [text('What was the number?')] },
    );
    const reply = await sendCoachMessage('log my weight', { fetch: fake.fetch, ...ctx });
    expect(reply.ok).toBe(true);
    expect(await db.bodyweight.where('date').equals(toDateKey(NOW)).count()).toBe(0);
    expect((fake.requests[1]!.body.messages as any[]).at(-1).content[0]).toMatchObject({ is_error: true });
  });
});

describe('the tools do the work', () => {
  it('logs food from a described meal and reports it', async () => {
    const fake = fakeClaude(
      {
        content: [toolUse('t1', 'log_food', { items: [{ name: 'Scrambled eggs', amount: 3, unit: 'eggs', kcal: 240, protein: 19, carbs: 2, fat: 17 }, { name: 'Wholemeal toast', amount: 2, unit: 'slices', grams: 72, kcal: 170, protein: 7, carbs: 30, fat: 2 }], slot: 'breakfast' })],
        stop_reason: 'tool_use',
      },
      { content: [text('Good protein start. The toast keeps you going; add some fruit later.')] },
    );
    const reply = await sendCoachMessage('3 scrambled eggs and 2 slices of toast', { fetch: fake.fetch, ...ctx, actions: createCoachActions({ now: () => NOW }) });
    expect(reply.actions).toEqual(['Logged Scrambled eggs, Wholemeal toast for breakfast (≈410 kcal)']);
    const meals = await mealsOnDay(toDateKey(NOW));
    expect(meals).toHaveLength(1);
    expect(meals[0]!.items.map((i) => i.source)).toEqual(['model', 'model']);
  });

  it('edits a routine on request', async () => {
    const fake = fakeClaude(
      { content: [toolUse('t1', 'edit_routine', { routine: 'push day', exercise: 'bench', change: 'sets', sets: 5 })], stop_reason: 'tool_use' },
      { content: [text('Bench is 5 sets in your push day.')] },
    );
    const reply = await sendCoachMessage('push day bench to 5 sets', { fetch: fake.fetch, ...ctx });
    expect(reply.actions).toEqual(['Bench Press (Barbell): 5 sets in Upper (Push)']);
    const routine = (await listRoutines()).find((r) => r.name === 'Upper (Push)')!;
    expect((await routineItems(routine.id)).find((i) => i.exercise.name === 'Bench Press (Barbell)')!.rx.targetSets).toBe(5);
  });

  it('keeps a drafted routine on the reply and saves nothing', async () => {
    const before = await db.routines.count();
    const fake = fakeClaude(
      { content: [toolUse('t1', 'build_routine', { request: 'a 40 minute shoulder routine' })], stop_reason: 'tool_use' },
      { content: [text('Draft is ready. Save it if you like it.')] },
    );
    const reply = await sendCoachMessage('build me a shoulder routine', { fetch: fake.fetch, ...ctx, actions: createCoachActions({ seed: () => 3 }) });
    expect(reply.draft?.routines.length).toBeGreaterThan(0);
    expect(reply.draft?.text).toContain('Lateral Raise');
    expect(await db.routines.count()).toBe(before);
  });

  it('stops after the most requests a turn may make, and says what was done instead of the model\'s preamble', async () => {
    const fake = fakeClaude(
      (_req, i) => ({ content: [text('Let me sort that out for you.'), toolUse(`t${i}`, 'remember', { text: `note ${i}` })], stop_reason: 'tool_use' }),
    );
    const reply = await sendCoachMessage('keep going', { fetch: fake.fetch, ...ctx });
    expect(fake.requests).toHaveLength(MAX_TOOL_ITERATIONS);
    expect(reply.ok).toBe(true);
    // The model's last words introduce tools whose results it never saw; they are not an answer.
    expect(reply.text).not.toContain('Let me sort that out');
    expect(reply.text).toBe(`Done: ${reply.actions.join('; ')}.`);
    expect(reply.actions).toHaveLength(MAX_TOOL_ITERATIONS);
    expect((await thread()).at(-1)).toMatchObject({ role: 'coach', text: reply.text, actions: reply.actions });
  });

  it('says plainly that nothing changed when it stopped at the limit with nothing done', async () => {
    const fake = fakeClaude(
      (_req, i) => ({ content: [text('Checking.'), toolUse(`t${i}`, 'edit_routine', { routine: 'Leg day of doom', exercise: 'Squat', change: 'sets', sets: 3 })], stop_reason: 'tool_use' }),
    );
    const reply = await sendCoachMessage('squats to 3 sets', { fetch: fake.fetch, ...ctx });
    expect(reply.ok).toBe(true);
    expect(reply.actions).toEqual([]);
    expect(reply.text).not.toContain('Checking');
    expect(reply.text).toContain('Nothing was changed');
  });
});

describe('when Claude cannot be reached or answers with an error', () => {
  it('writes nothing at all when there is no key, so the sheet can keep the typed text', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [text('x')] });
    const reply = await sendCoachMessage('hello', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, error: 'no_key', text: CLAUDE_ERROR_MESSAGES.no_key });
    expect(fake.requests).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('writes nothing when over the cap', async () => {
    setCap(0);
    const fake = fakeClaude({ content: [text('x')] });
    const reply = await sendCoachMessage('hello', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, error: 'over_cap' });
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('takes the owner\'s turn back out when the call fails before anything changed, so the sheet keeps the text and a retry is not a double', async () => {
    const fake = fakeClaude({ status: 401, error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } });
    const reply = await sendCoachMessage('how was my week?', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, error: 'bad_key', text: CLAUDE_ERROR_MESSAGES.bad_key, actions: [], stored: false });
    expect(await thread()).toEqual([]);
    expect(JSON.stringify(reply)).not.toContain(KEY);

    // Sending the same words again leaves one copy in the thread, not two.
    const retry = fakeClaude({ content: [text('A good one.')] });
    expect((await sendCoachMessage('how was my week?', { fetch: retry.fetch, ...ctx })).stored).toBe(true);
    expect((await thread()).map((r) => `${r.role}: ${r.text}`)).toEqual(['user: how was my week?', 'coach: A good one.']);
  });

  it('takes the owner\'s turn back out when a tool call it asked for hit the spend cap unrun', async () => {
    setCap(0.01);
    const fake = fakeClaude({ content: [toolUse('t1', 'remember', { text: 'Never written' })], stop_reason: 'tool_use', usage: { input_tokens: 100_000, output_tokens: 500 } });
    const reply = await sendCoachMessage('remember something', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, error: 'over_cap', stored: false });
    expect(await thread()).toEqual([]);
  });

  it('a failure that is not the owner\'s mistake still counts as stored when the turn is half done', async () => {
    const fake = fakeClaude(
      { content: [toolUse('t1', 'remember', { text: 'Prefers cables' })], stop_reason: 'tool_use' },
      { status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } },
    );
    const reply = await sendCoachMessage('I prefer cables, remember that', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, stored: true });
  });

  it('says what was already changed if the connection fails after a tool ran', async () => {
    const fake = fakeClaude(
      { content: [toolUse('t1', 'remember', { text: 'Prefers cables' })], stop_reason: 'tool_use' },
      { status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } },
    );
    const reply = await sendCoachMessage('I prefer cables, remember that', { fetch: fake.fetch, ...ctx });
    expect(reply).toMatchObject({ ok: false, error: 'busy', actions: ['Noted: Prefers cables'] });
    const rows = await thread();
    expect(rows.map((r) => r.role)).toEqual(['user', 'coach']);
    expect(rows[1]).toMatchObject({ actions: ['Noted: Prefers cables'] });
    expect(rows[1]!.text).toContain(CLAUDE_ERROR_MESSAGES.busy);
    expect(await db.coachNotes.count()).toBe(1);
  });

  it('stops, without running the tools, when a request takes the month past the cap', async () => {
    setCap(0.01);
    const fake = fakeClaude({ content: [toolUse('t1', 'remember', { text: 'Never written' })], stop_reason: 'tool_use', usage: { input_tokens: 100_000, output_tokens: 500 } });
    const reply = await sendCoachMessage('remember something', { fetch: fake.fetch, ...ctx });
    expect(fake.requests).toHaveLength(1);
    expect(reply).toMatchObject({ ok: false, error: 'over_cap' });
    expect(await db.coachNotes.count()).toBe(0);
    expect(spendThisMonth()).toBeGreaterThan(0.01);
  });

  it('ignores an empty message', async () => {
    const fake = fakeClaude({ content: [text('x')] });
    expect((await sendCoachMessage('   ', { fetch: fake.fetch, ...ctx })).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('puts a plain line in place of a reply the model left empty', async () => {
    const fake = fakeClaude({ content: [text('')] });
    const reply = await sendCoachMessage('hm', { fetch: fake.fetch, ...ctx });
    expect(reply.ok).toBe(true);
    expect(reply.text).toMatch(/another way/);
  });
});

describe('a Claude key pasted into the box by mistake', () => {
  const PASTED = 'sk-ant-api03-PASTEDBYMISTAKEPASTEDBYMISTAKEPASTED0123';

  it('is neither stored nor sent, in the message or in the reply', async () => {
    const fake = fakeClaude({ content: [text(`Do not share ${PASTED} with anyone.`)] });
    const reply = await sendCoachMessage(`my key is ${PASTED} can you check it`, { fetch: fake.fetch, ...ctx });

    expect(JSON.stringify(fake.requests)).not.toContain(PASTED);
    expect(lastUserText(fake.requests[0]!.body)).toBe('my key is sk-ant-… can you check it');

    const rows = await thread();
    expect(JSON.stringify(rows)).not.toContain(PASTED);
    expect(rows[0]!.text).toBe('my key is sk-ant-… can you check it');
    expect(reply.text).not.toContain(PASTED);
    expect(rows[1]!.text).not.toContain(PASTED);
  });

  it('is not sent from an older turn that already holds one', async () => {
    await db.coachMessages.bulkPut([
      { id: 'old1', at: new Date(2026, 9, 11, 8, 0).toISOString(), role: 'user', text: `here ${PASTED}` },
      { id: 'old2', at: new Date(2026, 9, 11, 8, 1).toISOString(), role: 'coach', text: 'That looks like a key.' },
    ]);
    const fake = fakeClaude({ content: [text('Ok.')] });
    await sendCoachMessage('hello', { fetch: fake.fetch, ...ctx });
    expect(JSON.stringify(fake.requests)).not.toContain(PASTED);
    expect(JSON.stringify(fake.requests)).toContain('here sk-ant-…');
  });
});

describe('what the model is told', () => {
  it('says nothing the owner has not got: no key in the prompt, and the persona\'s rules are there', async () => {
    const fake = fakeClaude({ content: [text('Ok.')] });
    await sendCoachMessage('hello', { fetch: fake.fetch, ...ctx });
    const body = JSON.stringify(fake.requests[0]!.body);
    expect(body).not.toContain(KEY);
    const sys = systemText(fake.requests[0]!.body);
    expect(sys).toContain('British English');
    expect(sys).toContain('Samaritans');
    expect(sys).toContain('116 123');
    expect(lastUserText(fake.requests[0]!.body)).toBe('hello');
  });

  it('is deterministic: the same data and clock make the same prefix', async () => {
    const a = fakeClaude({ content: [text('Ok.')] });
    const b = fakeClaude({ content: [text('Ok.')] });
    await sendCoachMessage('hello', { fetch: a.fetch, ...ctx });
    await sendCoachMessage('hello', { fetch: b.fetch, ...ctx });
    const prefix = (r: FakeRequest) => JSON.stringify({ tools: r.body.tools, first: (r.body.system as { text: string }[])[0]!.text });
    expect(prefix(b.requests[0]!)).toBe(prefix(a.requests[0]!));
  });
});
