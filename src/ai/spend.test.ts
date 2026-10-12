/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { costUsd, HAIKU, priceFor, SONNET } from './prices';
import {
  canSpend,
  capUsd,
  CAP_STORAGE,
  DEFAULT_CAP_USD,
  monthKey,
  nearCap,
  recordUsage,
  setCap,
  spendSnapshot,
  spendSummary,
  SPEND_STORAGE,
  subscribeSpend,
  spendThisMonth,
  takeOverCapNotice,
} from './spend';
import { resetMemory } from './store';

beforeEach(() => {
  localStorage.clear();
  resetMemory();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the price table', () => {
  it('prices Sonnet 5.5 at $2 in, $10 out, 1.25x to write the cache and 0.1x to read it', () => {
    expect(costUsd(SONNET, { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2, 9);
    expect(costUsd(SONNET, { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(10, 9);
    expect(costUsd(SONNET, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2.5, 9);
    expect(costUsd(SONNET, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2, 9);
  });

  it('prices Haiku 5.5 at $0.10 / $0.50 up to 100K prompt tokens and $0.50 / $2.50 above', () => {
    expect(priceFor(HAIKU, 90_000)).toEqual({ input: 0.1, output: 0.5 });
    expect(costUsd(HAIKU, { input_tokens: 90_000, output_tokens: 1_000_000 })).toBeCloseTo(0.009 + 0.5, 9);
    expect(priceFor(HAIKU, 100_001)).toEqual({ input: 0.5, output: 2.5 });
    expect(costUsd(HAIKU, { input_tokens: 150_000, output_tokens: 1_000_000 })).toBeCloseTo(0.075 + 2.5, 9);
    // The prompt length counts cached tokens too.
    expect(priceFor(HAIKU, 1000 + 99_500)).toEqual({ input: 0.5, output: 2.5 });
    expect(costUsd(HAIKU, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200_000 })).toBeCloseTo(0.2 * 0.5 * 0.1, 9);
  });

  it('prices a model it does not know as Sonnet, never as free', () => {
    expect(costUsd('claude-something-new', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2, 9);
  });

  it('adds the four parts of a real response', () => {
    const usage = { input_tokens: 800, output_tokens: 150, cache_creation_input_tokens: 5000, cache_read_input_tokens: 0 };
    expect(costUsd(SONNET, usage)).toBeCloseTo(800 * 2e-6 + 150 * 10e-6 + 5000 * 2.5e-6, 9);
  });

  it('ignores missing, negative and non-numeric fields', () => {
    expect(costUsd(SONNET, { input_tokens: null, output_tokens: undefined, cache_read_input_tokens: -5 })).toBe(0);
    expect(costUsd(SONNET, { input_tokens: Number.NaN, output_tokens: 10 })).toBeCloseTo(10 * 10e-6, 12);
  });
});

describe('the ledger', () => {
  it('starts at nothing and adds each response', () => {
    expect(spendThisMonth()).toBe(0);
    recordUsage(SONNET, { input_tokens: 1000, output_tokens: 100 });
    expect(spendThisMonth()).toBeCloseTo(0.003, 9);
    recordUsage(HAIKU, { input_tokens: 2000, output_tokens: 100 });
    expect(spendThisMonth()).toBeCloseTo(0.003 + 0.0002 + 0.00005, 9);
  });

  it('is stored as {month, usd} under iron.claudeSpend', () => {
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    expect(JSON.parse(localStorage.getItem(SPEND_STORAGE)!)).toEqual({ month: monthKey(), usd: 2 });
  });

  it('rolls over on a new month without anyone resetting it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 22, 0, 0));
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    expect(monthKey()).toBe('2026-10');
    expect(spendThisMonth()).toBeCloseTo(2, 9);

    vi.setSystemTime(new Date(2026, 10, 1, 8, 0, 0));
    expect(monthKey()).toBe('2026-11');
    expect(spendThisMonth()).toBe(0);
    expect(canSpend()).toBe(true);

    recordUsage(SONNET, { input_tokens: 500_000, output_tokens: 0 });
    expect(JSON.parse(localStorage.getItem(SPEND_STORAGE)!)).toEqual({ month: '2026-11', usd: 1 });
  });

  it('treats a damaged ledger as empty rather than failing', () => {
    localStorage.setItem(SPEND_STORAGE, '{not json');
    expect(spendThisMonth()).toBe(0);
    localStorage.setItem(SPEND_STORAGE, JSON.stringify({ month: monthKey(), usd: 'lots' }));
    expect(spendThisMonth()).toBe(0);
    localStorage.setItem(SPEND_STORAGE, JSON.stringify({ month: monthKey(), usd: -4 }));
    expect(spendThisMonth()).toBe(0);
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    expect(spendThisMonth()).toBeCloseTo(2, 9);
  });

  it('keeps counting in memory when storage refuses every write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 })).not.toThrow();
    expect(spendThisMonth()).toBeCloseTo(2, 9);
    expect(capUsd()).toBe(DEFAULT_CAP_USD);
  });
});

describe('watching the spend', () => {
  it('tells a listener after each response and each change of the cap, until it stops listening', () => {
    const seen = vi.fn();
    const stop = subscribeSpend(seen);
    recordUsage(SONNET, { input_tokens: 1000, output_tokens: 10 });
    setCap(20);
    expect(seen).toHaveBeenCalledTimes(2);
    recordUsage(SONNET, null); // nothing to record: nothing to announce
    setCap(-3);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    recordUsage(SONNET, { input_tokens: 1000, output_tokens: 10 });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('gives React the same snapshot object until something in it changes', () => {
    const a = spendSnapshot();
    expect(spendSnapshot()).toBe(a);
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    const b = spendSnapshot();
    expect(b).not.toBe(a);
    expect(b).toMatchObject({ usd: 2, cap: 15 });
    expect(spendSnapshot()).toBe(b);
    setCap(30);
    expect(spendSnapshot()).toMatchObject({ cap: 30 });
  });
});

describe('the cap', () => {
  it('defaults to $15 and can be changed', () => {
    expect(capUsd()).toBe(15);
    expect(setCap(30)).toBe(30);
    expect(capUsd()).toBe(30);
    expect(localStorage.getItem(CAP_STORAGE)).toBe('30');
  });

  it('ignores a cap that is negative or not a number', () => {
    setCap(20);
    expect(setCap(-1)).toBe(20);
    expect(setCap(Number.NaN)).toBe(20);
    localStorage.setItem(CAP_STORAGE, 'plenty');
    expect(capUsd()).toBe(15);
  });

  it('allows spending until the cap is reached, then not', () => {
    setCap(10);
    recordUsage(SONNET, { input_tokens: 4_999_000, output_tokens: 0 }); // $9.998
    expect(canSpend()).toBe(true);
    recordUsage(SONNET, { input_tokens: 1_000, output_tokens: 0 }); // $10.000
    expect(canSpend()).toBe(false);
  });

  it('warns from 80 percent', () => {
    setCap(10);
    recordUsage(SONNET, { input_tokens: 3_999_000, output_tokens: 0 }); // $7.998
    expect(nearCap()).toBe(false);
    recordUsage(SONNET, { input_tokens: 1_000, output_tokens: 0 }); // $8.000
    expect(nearCap()).toBe(true);
    expect(canSpend()).toBe(true);
    expect(spendSummary()).toMatchObject({ usd: 8, cap: 10, fraction: 0.8, near: true, over: false });
  });

  it('a cap of zero is a pause, not a warning', () => {
    setCap(0);
    expect(canSpend()).toBe(false);
    expect(nearCap()).toBe(false);
    expect(spendSummary().fraction).toBe(0);
  });

  it('says the pause once a month', () => {
    setCap(1);
    expect(takeOverCapNotice()).toBe(false); // still under
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    expect(takeOverCapNotice()).toBe(true);
    expect(takeOverCapNotice()).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 1));
    expect(canSpend()).toBe(true); // a new month
    recordUsage(SONNET, { input_tokens: 1_000_000, output_tokens: 0 });
    expect(takeOverCapNotice()).toBe(true);
  });
});
