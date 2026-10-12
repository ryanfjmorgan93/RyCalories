/**
 * What a model costs, so the app can count its own spend from each response's `usage`.
 *
 * Prices are US dollars per million tokens, from the Claude API docs (models and pricing pages):
 *   - Claude Sonnet 5.5: $2 in, $10 out, flat at any prompt length.
 *   - Claude Haiku 5.5:  $0.10 in, $0.50 out while the prompt is 100K tokens or fewer, and $0.50 /
 *     $2.50 above that. A prompt here is a few thousand tokens, so the long rate is never reached in
 *     practice, but it is in the table so a mistake costs what it costs.
 * Cache writes (5-minute, the default) cost 1.25x the input rate; cache reads cost 0.1x.
 *
 * Pure: no IO, no clock.
 */

export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';

export interface ModelPrice {
  /** $ per million input tokens (uncached). */
  input: number;
  /** $ per million output tokens (thinking included). */
  output: number;
}

/** Multiples of the input rate. */
export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;

/** Haiku 5.5's prompt-length threshold between its two rate cards. */
export const HAIKU_LONG_PROMPT_TOKENS = 100_000;

const SONNET_PRICE: ModelPrice = { input: 2, output: 10 };
const HAIKU_SHORT: ModelPrice = { input: 0.1, output: 0.5 };
const HAIKU_LONG: ModelPrice = { input: 0.5, output: 2.5 };

/** The fields of a response's `usage` that cost money. Cache fields are null on a response that used no cache. */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Tokens in the prompt as billed: the uncached part plus what was written to and read from the cache. */
export function promptTokens(usage: UsageLike): number {
  return n(usage.input_tokens) + n(usage.cache_creation_input_tokens) + n(usage.cache_read_input_tokens);
}

/**
 * The rate card for a model at a prompt length. A model the table does not know is priced as Sonnet:
 * the dearer of the two, so an unrecognised id can only make the app more careful, never less.
 */
export function priceFor(model: string, prompt = 0): ModelPrice {
  if (model === HAIKU) return prompt > HAIKU_LONG_PROMPT_TOKENS ? HAIKU_LONG : HAIKU_SHORT;
  return SONNET_PRICE;
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Dollars one response cost. */
export function costUsd(model: string, usage: UsageLike): number {
  const price = priceFor(model, promptTokens(usage));
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    n(usage.input_tokens) * perToken(price.input) +
    n(usage.cache_creation_input_tokens) * perToken(price.input * CACHE_WRITE_MULT) +
    n(usage.cache_read_input_tokens) * perToken(price.input * CACHE_READ_MULT) +
    n(usage.output_tokens) * perToken(price.output)
  );
}
