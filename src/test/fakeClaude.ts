/**
 * A stand-in for the Messages API for tests: a `fetch` that returns canned JSON, and a record of
 * every request it was sent. The real SDK (request building, retries, the tool runner, error
 * classes) runs unchanged on top of it, so what these tests prove is the app's use of the SDK and
 * of the API's request rules, not a mock of either. Nothing here ever reaches the network.
 */

export interface FakeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'thinking'; thinking: string; signature: string };

export interface FakeReply {
  /** HTTP status; default 200. An error status sends an Anthropic-shaped error body. */
  status?: number;
  content?: FakeBlock[];
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  usage?: FakeUsage;
  /** An error message for a non-200 status. */
  error?: { type: string; message: string };
}

/** The request body the app sent, as the fake saw it. */
export interface FakeRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

export type FakeScript = FakeReply | ((request: FakeRequest, index: number) => FakeReply);

export const text = (t: string): FakeBlock => ({ type: 'text', text: t });
export const toolUse = (id: string, name: string, input: Record<string, unknown>): FakeBlock => ({ type: 'tool_use', id, name, input });

/** The JSON body of a successful Messages API response. */
export function messageBody(reply: FakeReply, model: string): Record<string, unknown> {
  const usage = reply.usage ?? { input_tokens: 100, output_tokens: 20 };
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
    content: reply.content ?? [text('')],
    stop_reason: reply.stop_reason ?? 'end_turn',
    stop_sequence: null,
    usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
  };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

/**
 * A fetch that answers the n-th request with the n-th script (the last one repeats), and the list
 * of requests it has received. A script may be a function of the request, to answer by content.
 */
export function fakeClaude(...scripts: FakeScript[]): { fetch: typeof fetch; requests: FakeRequest[] } {
  const requests: FakeRequest[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, any>) : {};
    const request: FakeRequest = { url, headers: headersOf(init), body };
    const index = requests.length;
    requests.push(request);
    const script = scripts[Math.min(index, scripts.length - 1)];
    if (!script) throw new Error('fakeClaude was given no replies');
    const reply = typeof script === 'function' ? script(request, index) : script;
    const status = reply.status ?? 200;
    if (status !== 200) {
      return new Response(JSON.stringify({ type: 'error', error: reply.error ?? { type: 'api_error', message: 'error' } }), {
        status,
        headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
      });
    }
    return new Response(JSON.stringify(messageBody(reply, String(body.model ?? 'claude-sonnet-5-5'))), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, requests };
}

/** A fetch that fails the way a dropped connection does. */
export function offlineFetch(): { fetch: typeof fetch; requests: FakeRequest[] } {
  const requests: FakeRequest[] = [];
  return {
    requests,
    fetch: (async (input: RequestInfo | URL) => {
      requests.push({ url: String(input), headers: {}, body: {} });
      throw new TypeError('Failed to fetch');
    }) as typeof fetch,
  };
}

/** Every text in a request's system field, joined (system may be a string or blocks). */
export function systemText(body: Record<string, any>): string {
  const s = body.system;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((b: { text?: string }) => b.text ?? '').join('\n');
  return '';
}

/** The text of a request's last user message. */
export function lastUserText(body: Record<string, any>): string {
  const msgs = (body.messages ?? []) as { role: string; content: unknown }[];
  const last = [...msgs].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) return last.content.map((b: { text?: string; type: string }) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n');
  return '';
}
