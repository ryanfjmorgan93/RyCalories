/**
 * The one place the app talks to Claude.
 *
 * Everything in `src/ai/` goes through `createMessage` (a single request) or `runToolLoop` (the
 * SDK's tool runner), and both do the same three things around the call, in this order:
 *   1. Guard, BEFORE any request: there is a key, the phone is online, and this month's spend is
 *      under the cap. Failing any of them is a `ClaudeError`, with nothing sent.
 *   2. Call. `CapacitorHttp` is on in capacitor.config.ts, so on the phone `fetch` runs natively and
 *      CORS is not in play; `dangerouslyAllowBrowser` is what the SDK needs to run in a WebView.
 *   3. Record the response's `usage` into the monthly ledger (spend.ts) — after EVERY request,
 *      including each iteration of a tool run — and turn anything that went wrong into a
 *      `ClaudeError` with a short plain message. Nothing else leaves this file: not the raw SDK
 *      error, and never the key.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaToolRunnerParams } from '@anthropic-ai/sdk/lib/tools/BetaToolRunner';
import { getApiKey, hasKey } from './key';
import { HAIKU, SONNET } from './prices';
import { canSpend, recordUsage } from './spend';

export { HAIKU, SONNET };

// ---------------------------------------------------------------------------
// Errors

export type ClaudeErrorKind = 'no_key' | 'offline' | 'bad_key' | 'over_cap' | 'busy' | 'refused' | 'other';

/** What each kind says to the owner: one plain line, British English, no detail that could include a secret. */
export const CLAUDE_ERROR_MESSAGES: Record<ClaudeErrorKind, string> = {
  no_key: 'Add your Claude key in Settings to use the coach.',
  offline: 'No connection. The coach needs the internet.',
  bad_key: "Claude didn't accept the key. Check it in Settings.",
  over_cap: "Claude is paused until the 1st: this month's limit is reached.",
  busy: 'Claude is busy at the moment. Try again in a minute.',
  refused: "Claude couldn't help with that one.",
  other: 'Something went wrong talking to Claude. Try again.',
};

export class ClaudeError extends Error {
  readonly kind: ClaudeErrorKind;
  constructor(kind: ClaudeErrorKind, message?: string) {
    super(message ?? CLAUDE_ERROR_MESSAGES[kind]);
    this.name = 'ClaudeError';
    this.kind = kind;
  }
}

/**
 * Any thrown value as a `ClaudeError`, by the SDK's typed classes and never by matching message
 * text. Connection failures are "offline" (the SDK has already retried them twice); a timeout is
 * "busy" because the network is there and Claude is slow.
 */
export function toClaudeError(e: unknown): ClaudeError {
  if (e instanceof ClaudeError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new ClaudeError('other', 'Stopped.');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ClaudeError('busy', 'Claude took too long to answer. Try again.');
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError('offline');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ClaudeError('bad_key');
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return new ClaudeError('busy');
  if (e instanceof Anthropic.APIError) {
    switch (e.status) {
      case 402:
        return new ClaudeError('other', 'Your Anthropic account needs attention (billing). Check the Console.');
      case 404:
        return new ClaudeError('other', "Claude's model isn't available on this key. Check the Console.");
      case 413:
        return new ClaudeError('other', 'That was too big to send.');
      case 529:
        return new ClaudeError('busy');
      default:
        return new ClaudeError('other');
    }
  }
  return new ClaudeError('other');
}

// ---------------------------------------------------------------------------
// Guard

/** Why a call cannot be made right now, or null when it can. Checked in this order: key, connection, cap. */
export function blockedReason(now: Date = new Date()): ClaudeErrorKind | null {
  if (!hasKey()) return 'no_key';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (!canSpend(now)) return 'over_cap';
  return null;
}

/** Whether Claude can be called right now. Never throws; for callers that stay silent when it cannot. */
export function claudeReady(): boolean {
  return blockedReason() === null;
}

/** Throws the `ClaudeError` for `blockedReason`, before anything is sent. */
export function assertCanCall(): void {
  const reason = blockedReason();
  if (reason) throw new ClaudeError(reason);
}

// ---------------------------------------------------------------------------
// Client

/** Seams a test (or a caller with a client of its own) can supply. */
export interface CallDeps {
  /** Replaces the global `fetch` the SDK would use: tests pass one that returns canned Messages API JSON. */
  fetch?: typeof fetch;
  client?: Anthropic;
}

/**
 * The page's `fetch`, made to give up when its signal aborts. On the phone `fetch` is Capacitor's
 * native HTTP, which does not look at the signal: the SDK's own timeout would abort the controller
 * and the call would carry on regardless, leaving "Thinking…" up until the network gave in. The
 * global is read at call time, not captured, so whatever `fetch` is at that moment is the one used.
 */
export function abortableFetch(): typeof fetch {
  return (input, init) => {
    const signal = init?.signal;
    if (!signal) return globalThis.fetch(input, init);
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      globalThis.fetch(input, init).then(
        (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  };
}

/** A client for the stored key. Throws `ClaudeError('no_key')` when there is none. */
export function getClient(deps: Pick<CallDeps, 'fetch'> = {}): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new ClaudeError('no_key');
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 60_000,
    fetch: deps.fetch ?? abortableFetch(),
  });
}

// ---------------------------------------------------------------------------
// Calls

export type MessageParams = Anthropic.MessageCreateParamsNonStreaming;
export type ToolRunnerParams = Omit<BetaToolRunnerParams, 'stream'>;
export type ToolRunnerMessage = Anthropic.Beta.Messages.BetaMessage;

/** One request: guard, call, record. A refusal is an error here, not a reply. */
export async function createMessage(params: MessageParams, deps: CallDeps = {}): Promise<Anthropic.Message> {
  assertCanCall();
  try {
    const client = deps.client ?? getClient(deps);
    const message = await client.messages.create(params);
    recordUsage(params.model, message.usage);
    if (message.stop_reason === 'refusal') throw new ClaudeError('refused');
    return message;
  } catch (e) {
    throw toClaudeError(e);
  }
}

export interface ToolLoopResult {
  /** The last message the model produced. */
  message: ToolRunnerMessage;
  /** How many requests were made. */
  iterations: number;
  /** The loop stopped because the cap was reached part-way, with a tool call left unrun. */
  stoppedForCap: boolean;
}

/** Most requests one turn may make: a tool call, its result, and a few more steps. A runaway loop costs money. */
export const MAX_TOOL_ITERATIONS = 6;

/**
 * Run the SDK's tool runner: guard, then each request in turn, recording the spend of every one as
 * it arrives. If the cap is crossed while the model is still calling tools, the loop stops there
 * (the message that crossed it keeps its tool calls unrun) rather than spend past the limit.
 */
export async function runToolLoop(params: ToolRunnerParams, deps: CallDeps = {}): Promise<ToolLoopResult> {
  assertCanCall();
  try {
    const client = deps.client ?? getClient(deps);
    const runner = client.beta.messages.toolRunner({ ...params, stream: false, max_iterations: params.max_iterations ?? MAX_TOOL_ITERATIONS });
    let last: ToolRunnerMessage | undefined;
    let iterations = 0;
    let stoppedForCap = false;
    for await (const message of runner) {
      last = message;
      iterations++;
      recordUsage(params.model, message.usage);
      if (message.stop_reason === 'refusal') throw new ClaudeError('refused');
      if (message.stop_reason === 'tool_use' && !canSpend()) {
        stoppedForCap = true;
        break;
      }
    }
    if (!last) throw new ClaudeError('other');
    return { message: last, iterations, stoppedForCap };
  } catch (e) {
    throw toClaudeError(e);
  }
}

/**
 * Settings' Test button: one tiny Haiku request (about thirty tokens, a fraction of a cent) to see
 * that the key works and the phone can reach Claude. Resolves with what Claude said; throws a
 * `ClaudeError` with the plain reason otherwise.
 */
export async function testConnection(deps: CallDeps = {}): Promise<string> {
  const message = await createMessage(
    {
      model: HAIKU,
      max_tokens: 20,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with the one word: ready' }],
    },
    deps,
  );
  return textOf(message.content) || 'ready';
}

/** The text of a message's text blocks, joined and trimmed. Thinking and tool blocks are skipped. */
export function textOf(content: ReadonlyArray<{ type: string }>): string {
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { text?: unknown }).text;
    if (block.type === 'text' && typeof text === 'string') parts.push(text);
  }
  return parts.join('\n').trim();
}
