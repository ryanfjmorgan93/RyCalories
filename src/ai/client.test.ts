/**
 * @vitest-environment jsdom
 */
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClaude, offlineFetch, text } from '@/test/fakeClaude';
import {
  abortableFetch,
  assertCanCall,
  blockedReason,
  CLAUDE_ERROR_MESSAGES,
  ClaudeError,
  createMessage,
  getClient,
  HAIKU,
  SONNET,
  testConnection,
  toClaudeError,
} from './client';
import { clearApiKey, setApiKey } from './key';
import { setCap, spendThisMonth } from './spend';
import { resetMemory } from './store';

const KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEYabcd';

beforeEach(() => {
  localStorage.clear();
  resetMemory();
  setApiKey(KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the guard', () => {
  it('names the first thing missing, in the order key, connection, cap', () => {
    clearApiKey();
    expect(blockedReason()).toBe('no_key');

    setApiKey(KEY);
    expect(blockedReason()).toBeNull();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(blockedReason()).toBe('offline');

    // No key beats offline: the more fixable problem is the one reported.
    clearApiKey();
    expect(blockedReason()).toBe('no_key');
  });

  it('reports the cap once the month is spent', () => {
    setCap(0);
    expect(blockedReason()).toBe('over_cap');
    expect(() => assertCanCall()).toThrowError(ClaudeError);
  });

  it('sends nothing at all when blocked', async () => {
    const fake = fakeClaude({ content: [text('hi')] });
    clearApiKey();
    await expect(createMessage({ model: HAIKU, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'no_key' });

    setApiKey(KEY);
    setCap(0);
    await expect(createMessage({ model: HAIKU, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'over_cap' });

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setCap(15);
    await expect(createMessage({ model: HAIKU, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'offline' });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('createMessage', () => {
  it('sends the key as the API key header and records the spend from usage', async () => {
    const fake = fakeClaude({ content: [text('Nice.')], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000 } });
    const message = await createMessage({ model: SONNET, max_tokens: 50, messages: [{ role: 'user', content: 'hello' }] }, { fetch: fake.fetch });
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'Nice.' });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.headers['x-api-key']).toBe(KEY);
    expect(fake.requests[0]!.url).toContain('/v1/messages');
    // 1000 in at $2, 2000 cached at $0.20, 100 out at $10, per million.
    expect(spendThisMonth()).toBeCloseTo(0.002 + 0.0004 + 0.001, 6);
  });

  it('turns a refusal into a refused error, after counting what it cost', async () => {
    const fake = fakeClaude({ stop_reason: 'refusal', content: [], usage: { input_tokens: 500, output_tokens: 0 } });
    await expect(createMessage({ model: SONNET, max_tokens: 50, messages: [{ role: 'user', content: 'x' }] }, { fetch: fake.fetch })).rejects.toMatchObject({ kind: 'refused' });
    expect(spendThisMonth()).toBeGreaterThan(0);
  });
});

describe('error mapping', () => {
  it.each([
    [401, 'authentication_error', 'bad_key'],
    [403, 'permission_error', 'bad_key'],
    [429, 'rate_limit_error', 'busy'],
    [500, 'api_error', 'busy'],
    [529, 'overloaded_error', 'busy'],
    [400, 'invalid_request_error', 'other'],
    [402, 'billing_error', 'other'],
    [404, 'not_found_error', 'other'],
  ] as const)('maps HTTP %i to %s', async (status, type, kind) => {
    const fake = fakeClaude({ status, error: { type, message: `secret detail with ${KEY}` } });
    // maxRetries 2 is the app's setting; the fake marks the reply as not retryable so each status is asked once.
    const error = await createMessage({ model: HAIKU, max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, { fetch: fake.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeError);
    expect((error as ClaudeError).kind).toBe(kind);
    // The message is the app's own line, never the API's text, and so never anything that could hold a key.
    expect((error as ClaudeError).message).not.toContain(KEY);
    expect((error as ClaudeError).message).not.toContain('secret');
  });

  it('reads a dropped connection as offline', async () => {
    const fake = offlineFetch();
    const error = await createMessage({ model: HAIKU, max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, { fetch: fake.fetch }).catch((e: unknown) => e);
    expect((error as ClaudeError).kind).toBe('offline');
    // The SDK retried twice before giving up: the app's maxRetries is 2.
    expect(fake.requests).toHaveLength(3);
  });

  it('classifies the SDK error classes directly', () => {
    const headers = new Headers();
    expect(toClaudeError(new Anthropic.AuthenticationError(401, undefined, 'x', headers)).kind).toBe('bad_key');
    expect(toClaudeError(new Anthropic.APIConnectionTimeoutError()).kind).toBe('busy');
    expect(toClaudeError(new Anthropic.APIConnectionError({ message: 'x' })).kind).toBe('offline');
    expect(toClaudeError(new Error('anything else')).kind).toBe('other');
    const own = new ClaudeError('over_cap');
    expect(toClaudeError(own)).toBe(own);
  });

  it('has a short, plain line for every kind', () => {
    for (const message of Object.values(CLAUDE_ERROR_MESSAGES)) {
      expect(message.length).toBeLessThan(80);
      expect(message).not.toMatch(/[!]|sk-ant/);
    }
  });
});

describe('testConnection', () => {
  it('makes one tiny Haiku request and returns what Claude said', async () => {
    const fake = fakeClaude({ content: [text('ready')], usage: { input_tokens: 15, output_tokens: 4 } });
    expect(await testConnection({ fetch: fake.fetch })).toBe('ready');
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 20, thinking: { type: 'disabled' }, output_config: { effort: 'low' } });
    expect(spendThisMonth()).toBeLessThan(0.0001);
  });

  it('says why when it cannot', async () => {
    const bad = fakeClaude({ status: 401, error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    await expect(testConnection({ fetch: bad.fetch })).rejects.toMatchObject({ kind: 'bad_key' });
    clearApiKey();
    await expect(testConnection({ fetch: bad.fetch })).rejects.toMatchObject({ kind: 'no_key' });
  });
});

describe('abortableFetch', () => {
  it('passes a response straight through', async () => {
    const real = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', real);
    const controller = new AbortController();
    const response = await abortableFetch()('https://example.test/x', { signal: controller.signal });
    expect(await response.text()).toBe('ok');
    expect(real).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('gives up when the signal aborts, even if the underlying fetch never answers (the phone\'s native HTTP ignores the signal)', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = abortableFetch()('https://example.test/x', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // And one that was already aborted never starts.
    await expect(abortableFetch()('https://example.test/x', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });

  it('is what the client uses when none is injected, reading the global fetch at call time', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: HAIKU, content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const message = await createMessage({ model: HAIKU, max_tokens: 5, messages: [{ role: 'user', content: 'x' }] });
    expect(message.content[0]).toMatchObject({ text: 'hi' });
    expect(calls[0]).toContain('/v1/messages');
    vi.unstubAllGlobals();
  });
});

describe('getClient', () => {
  it('needs a key', () => {
    clearApiKey();
    expect(() => getClient()).toThrowError(ClaudeError);
  });
});
