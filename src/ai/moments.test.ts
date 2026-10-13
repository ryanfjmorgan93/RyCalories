/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { resetToSeed } from '@/db/repo';
import { fakeClaude, lastUserText, offlineFetch, text } from '@/test/fakeClaude';
import { ClaudeError } from './client';
import { clearApiKey, setApiKey } from './key';
import { factsText, hashFacts, momentLine, OPEN_DEBOUNCE_MS, openMayAsk, parseReview, resetMomentCache, tidyLine, weeklyReview } from './moments';
import { setCap, spendThisMonth } from './spend';
import { resetMemory } from './store';

const KEY = 'sk-ant-api03-MOMENTSKEYMOMENTSKEYMOMENTSKEYqrst';
const NOW = new Date(2026, 9, 12, 14, 35, 0);

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  resetMomentCache();
  setApiKey(KEY);
  await resetToSeed();
  await db.coachNotes.clear();
  await db.coachMessages.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const opts = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) => ({ fetch, now: NOW, ...extra });

describe('momentLine', () => {
  it('returns the coach\'s line, stores it with its moment, and asks Haiku the way Haiku 5.5 allows', async () => {
    const fake = fakeClaude({ content: [text('New best on bench: 80 kg for 8. Nice work.')], usage: { input_tokens: 5000, output_tokens: 30, cache_creation_input_tokens: 0 } });
    const line = await momentLine('set', { exercise: 'Bench Press (Barbell)', set: '80 kg × 8', 'previous best': '77.5 kg × 8' }, opts(fake.fetch));
    expect(line).toBe('New best on bench: 80 kg for 8. Nice work.');

    const rows = await db.coachMessages.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'coach', text: line, moment: 'set' });

    const body = fake.requests[0]!.body;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(200);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'low' });
    // Haiku 5.5 rejects non-default sampling parameters, prefill, and a forced tool.
    for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools']) expect(body[banned], banned).toBeUndefined();
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(lastUserText(body)).toContain('The owner has just logged a set.');
    expect(lastUserText(body)).toContain('- exercise: Bench Press (Barbell)');
    expect(lastUserText(body)).toContain('- previous best: 77.5 kg × 8');
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]!.text).toContain('volunteering one short comment');
    expect(system[0]!.text).toContain('ROUTINES');
    expect(system[1]!.text).toContain('NOW:');
  });

  it('counts what it spent at Haiku\'s prices', async () => {
    const fake = fakeClaude({ content: [text('Good.')], usage: { input_tokens: 4000, output_tokens: 20, cache_read_input_tokens: 6000 } });
    await momentLine('meal', {}, opts(fake.fetch));
    expect(spendThisMonth()).toBeCloseTo(4000 * 0.1e-6 + 6000 * 0.01e-6 + 20 * 0.5e-6, 9);
  });

  it('is null, and stores nothing, when the coach has nothing to say', async () => {
    for (const reply of ['', '   ', 'Nothing', 'nothing.', '"nothing"', 'None', 'Quiet']) {
      resetMomentCache();
      const fake = fakeClaude({ content: [text(reply)] });
      expect(await momentLine('exercise', { exercise: 'Curl' }, opts(fake.fetch)), JSON.stringify(reply)).toBeNull();
    }
    const none = fakeClaude({ content: [] });
    expect(await momentLine('exercise', {}, opts(none.fetch))).toBeNull();
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('is silent, and sends nothing, with no key, over the cap, or offline', async () => {
    const fake = fakeClaude({ content: [text('Hello.')] });
    clearApiKey();
    expect(await momentLine('session', {}, opts(fake.fetch))).toBeNull();
    setApiKey(KEY);
    setCap(0);
    expect(await momentLine('session', {}, opts(fake.fetch))).toBeNull();
    setCap(15);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await momentLine('session', {}, opts(fake.fetch))).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('is silent when the call fails, whatever the failure', async () => {
    expect(await momentLine('day', {}, opts(fakeClaude({ status: 500, error: { type: 'api_error', message: 'x' } }).fetch))).toBeNull();
    expect(await momentLine('day', {}, opts(fakeClaude({ status: 401, error: { type: 'authentication_error', message: 'x' } }).fetch))).toBeNull();
    expect(await momentLine('day', {}, opts(offlineFetch().fetch))).toBeNull();
    expect(await momentLine('day', {}, opts(fakeClaude({ stop_reason: 'refusal', content: [] }).fetch))).toBeNull();
  });

  it('can be told not to store the line', async () => {
    const fake = fakeClaude({ content: [text('Well done today.')] });
    expect(await momentLine('day', {}, opts(fake.fetch, { persist: false }))).toBe('Well done today.');
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('shows the model what it has already said today, so it does not repeat itself', async () => {
    await db.coachMessages.put({ id: 'a', at: new Date(2026, 9, 12, 9, 0).toISOString(), role: 'coach', text: 'Remember: the bar does not know how tired you are.', moment: 'open' });
    const fake = fakeClaude({ content: [text('Solid.')] });
    await momentLine('set', {}, opts(fake.fetch));
    const system = fake.requests[0]!.body.system as { text: string }[];
    expect(system[1]!.text).toContain('the bar does not know how tired you are');
  });
});

describe('the app-open moment', () => {
  const facts = { 'days since last session': 2, 'food logged yesterday': true };

  it('speaks once, then not again for three hours with the same facts', async () => {
    const fake = fakeClaude({ content: [text('Welcome back. Legs today?')] });
    expect(await momentLine('open', facts, opts(fake.fetch))).toBe('Welcome back. Legs today?');
    expect(await momentLine('open', facts, opts(fake.fetch, { now: new Date(NOW.getTime() + 2 * 3_600_000) }))).toBeNull();
    expect(fake.requests).toHaveLength(1);
  });

  it('speaks again when the facts have changed', async () => {
    const fake = fakeClaude({ content: [text('Welcome back.')] }, { content: [text('Nice session. Eat something with protein.')] });
    await momentLine('open', facts, opts(fake.fetch));
    const later = await momentLine('open', { ...facts, 'sessions today': 1 }, opts(fake.fetch, { now: new Date(NOW.getTime() + 600_000) }));
    expect(later).toBe('Nice session. Eat something with protein.');
    expect(fake.requests).toHaveLength(2);
  });

  it('speaks again after three hours', async () => {
    const fake = fakeClaude({ content: [text('Morning.')] }, { content: [text('Evening.')] });
    await momentLine('open', facts, opts(fake.fetch));
    expect(await momentLine('open', facts, opts(fake.fetch, { now: new Date(NOW.getTime() + OPEN_DEBOUNCE_MS - 1) }))).toBeNull();
    expect(await momentLine('open', facts, opts(fake.fetch, { now: new Date(NOW.getTime() + OPEN_DEBOUNCE_MS) }))).toBe('Evening.');
  });

  it('does not ask again for the same facts after an empty reply', async () => {
    const fake = fakeClaude({ content: [text('')] });
    expect(await momentLine('open', facts, opts(fake.fetch))).toBeNull();
    expect(await momentLine('open', facts, opts(fake.fetch, { now: new Date(NOW.getTime() + 60_000) }))).toBeNull();
    expect(fake.requests).toHaveLength(1);
  });

  it('does not use up the chance when it could not ask (offline), so the next open can', async () => {
    const fake = fakeClaude({ content: [text('Welcome back.')] });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await momentLine('open', facts, opts(fake.fetch))).toBeNull();
    vi.restoreAllMocks();
    expect(await momentLine('open', facts, opts(fake.fetch))).toBe('Welcome back.');
  });

  it('is only the app-open moment that is debounced', async () => {
    const fake = fakeClaude({ content: [text('One.')] }, { content: [text('Two.')] });
    expect(await momentLine('set', facts, opts(fake.fetch))).toBe('One.');
    expect(await momentLine('set', facts, opts(fake.fetch))).toBe('Two.');
  });

  it('reads the debounce mark defensively', () => {
    localStorage.setItem('iron.claudeOpenMoment', '{broken');
    expect(openMayAsk('abc', NOW)).toBe(true);
    localStorage.setItem('iron.claudeOpenMoment', JSON.stringify({ at: 'soon', hash: 1 }));
    expect(openMayAsk('abc', NOW)).toBe(true);
  });
});

describe('the stable context between moments', () => {
  it('is reused for ten minutes, so a run of moments sends one cached prefix, and rebuilt after', async () => {
    const fake = fakeClaude({ content: [text('Ok.')] });
    await momentLine('set', { n: 1 }, opts(fake.fetch));
    await db.coachNotes.put({ id: 'n1', createdAt: '2026-10-12T08:00:00.000Z', text: 'Shoulder is sore' });
    await momentLine('set', { n: 2 }, opts(fake.fetch, { now: new Date(NOW.getTime() + 5 * 60_000) }));
    await momentLine('set', { n: 3 }, opts(fake.fetch, { now: new Date(NOW.getTime() + 11 * 60_000) }));

    const first = (r: number) => (fake.requests[r]!.body.system as { text: string }[])[0]!.text;
    expect(first(1)).toBe(first(0));
    expect(first(0)).not.toContain('Shoulder is sore');
    expect(first(2)).toContain('Shoulder is sore');
  });
});

describe('helpers', () => {
  it('writes the facts one to a line and leaves out the empty ones', () => {
    expect(factsText({ a: 1, b: 'two', c: ['x', 3], d: null, e: undefined, f: '', g: false })).toBe('- a: 1\n- b: two\n- c: x, 3\n- g: false');
    expect(factsText({})).toBe('- (no further facts)');
  });

  it('hashes the facts the same whatever the order they were written in', () => {
    expect(hashFacts({ a: 1, b: 2 })).toBe(hashFacts({ b: 2, a: 1 }));
    expect(hashFacts({ a: 1 })).not.toBe(hashFacts({ a: 2 }));
    expect(hashFacts({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
  });

  it('tidies a reply into a line: unquoted, trimmed, and cut at a sentence if it runs on', () => {
    expect(tidyLine('  "Nice set."  ')).toBe('Nice set.');
    expect(tidyLine('')).toBeNull();
    const long = `${'You moved well through the whole session and the numbers show it. '.repeat(10)}`;
    const cut = tidyLine(long)!;
    expect(cut.length).toBeLessThanOrEqual(420);
    expect(cut.endsWith('.')).toBe(true);
  });
});

describe('weeklyReview', () => {
  const reviewJson = (extra: Record<string, unknown> = {}) => JSON.stringify({ review: 'A solid week: three sessions and protein near target. Eat a little more.', ...extra });

  it('asks Sonnet 5.5 at medium effort for a structured answer and returns the text and a proposed target', async () => {
    const fake = fakeClaude({ content: [text(reviewJson({ propose_calories: 2700.4, propose_protein: 175 }))], usage: { input_tokens: 6000, output_tokens: 400 } });
    const review = await weeklyReview({ 'sessions this week': 3, 'average kcal': 2410 }, opts(fake.fetch));
    expect(review).toEqual({ text: 'A solid week: three sessions and protein near target. Eat a little more.', proposal: { calories: 2700, protein: 175 } });

    const body = fake.requests[0]!.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['review']);
    expect(body.thinking).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(lastUserText(body)).toContain('- sessions this week: 3');
    expect(spendThisMonth()).toBeCloseTo(6000 * 2e-6 + 400 * 10e-6, 9);
    expect((await db.coachMessages.toArray())[0]).toMatchObject({ role: 'coach', moment: 'week' });
  });

  it('offers no proposal when there is none, or when the numbers are not credible', async () => {
    expect(parseReview(reviewJson())).toEqual({ text: 'A solid week: three sessions and protein near target. Eat a little more.' });
    expect(parseReview(reviewJson({ propose_calories: 90000, propose_protein: 3 })).proposal).toBeUndefined();
    expect(parseReview(reviewJson({ propose_protein: 180 })).proposal).toEqual({ protein: 180 });
  });

  it('falls back to the plain text when the answer was not the JSON asked for', () => {
    expect(parseReview('A good week overall.')).toEqual({ text: 'A good week overall.' });
    expect(parseReview('{"unexpected": true}')).toEqual({ text: '{"unexpected": true}' });
  });

  it('is asked for once: a failed attempt is spend the ledger cannot see, so nothing retries it', async () => {
    const down = offlineFetch();
    await expect(weeklyReview({}, opts(down.fetch))).rejects.toMatchObject({ kind: 'offline' });
    expect(down.requests).toHaveLength(1);
  });

  it('throws the plain error when it cannot be asked', async () => {
    clearApiKey();
    await expect(weeklyReview({}, opts(fakeClaude({ content: [text('x')] }).fetch))).rejects.toBeInstanceOf(ClaudeError);
    setApiKey(KEY);
    await expect(weeklyReview({}, opts(fakeClaude({ status: 401, error: { type: 'authentication_error', message: 'no' } }).fetch))).rejects.toMatchObject({ kind: 'bad_key' });
  });
});
