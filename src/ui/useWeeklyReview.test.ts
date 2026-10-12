/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiKey, setApiKey } from '@/ai/key';
import { setCap } from '@/ai/spend';
import { resetMemory } from '@/ai/store';
import { db } from '@/db/db';
import { getSettings, resetToSeed } from '@/db/repo';
import { weekReviewMessage } from '@/db/weekReviewQueries';
import { mondayOf, toDateKey } from '@/domain/dates';
import { readWeekReview, WEEK_REVIEW_STORAGE } from '@/state/weekReview';
import { fakeClaude, lastUserText, offlineFetch, text } from '@/test/fakeClaude';
import { generateReview, resetReviewAttempts, RETRY_AFTER_MS } from './useWeeklyReview';

const KEY = 'sk-ant-api03-REVIEWKEYREVIEWKEYREVIEWKEYREVIEWKEYabcd';
const today = toDateKey();
const week = mondayOf(today);

const reviewJson = (extra: Record<string, unknown> = {}) => JSON.stringify({ review: 'A solid week. How are you feeling?', ...extra });

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  resetReviewAttempts();
  setApiKey(KEY);
  await resetToSeed();
  await db.coachMessages.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateReview', () => {
  it('asks once, stores the review as a week message and remembers the proposal for the card', async () => {
    const fake = fakeClaude({ content: [text(reviewJson({ propose_calories: 2400 }))] });
    const settings = await getSettings();
    expect(await generateReview(week, today, settings, { fetch: fake.fetch })).toBe(true);

    expect(fake.requests).toHaveLength(1);
    // The facts for the past seven days went in.
    const asked = lastUserText(fake.requests[0]!.body);
    expect(asked).toContain('weekly review');
    expect(asked).toContain('- sessions: 0');
    expect(asked).toContain('- daysFoodLogged: 0 of 7');
    expect(asked).toContain(`- currentProteinTargetGrams: ${settings.proteinTarget}`);

    expect(await weekReviewMessage(week)).toMatchObject({ role: 'coach', moment: 'week', text: 'A solid week. How are you feeling?' });
    expect(await db.coachMessages.count()).toBe(1);
    expect(readWeekReview(week)).toMatchObject({ proposal: { calories: 2400 }, applied: [], dismissed: false });
  });

  it('shares one request between two callers', async () => {
    const fake = fakeClaude({ content: [text(reviewJson())] });
    const settings = await getSettings();
    const [a, b] = await Promise.all([generateReview(week, today, settings, { fetch: fake.fetch }), generateReview(week, today, settings, { fetch: fake.fetch })]);
    expect([a, b]).toEqual([true, true]);
    expect(fake.requests).toHaveLength(1);
    expect(await db.coachMessages.count()).toBe(1);
  });

  it('does not ask, and stores nothing, with no key', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [text(reviewJson())] });
    expect(await generateReview(week, today, await getSettings(), { fetch: fake.fetch })).toBe(false);
    expect(fake.requests).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);
    expect(localStorage.getItem(WEEK_REVIEW_STORAGE)).toBeNull();
  });

  it('does not ask over the spend cap', async () => {
    setCap(0.000001);
    const fake = fakeClaude({ content: [text(reviewJson())] });
    // Spend something first so the cap is crossed.
    const settings = await getSettings();
    await generateReview(week, today, settings, { fetch: fake.fetch });
    await db.coachMessages.clear();
    resetReviewAttempts();
    const second = fakeClaude({ content: [text(reviewJson())] });
    expect(await generateReview(week, today, settings, { fetch: second.fetch })).toBe(false);
    expect(second.requests).toHaveLength(0);
  });

  it('leaves no card when the call fails, and does not ask again straight away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0));
    const settings = await getSettings();
    const down = offlineFetch();
    expect(await generateReview(week, today, settings, { fetch: down.fetch })).toBe(false);
    expect(await db.coachMessages.count()).toBe(0);
    const attempts = down.requests.length;
    expect(attempts).toBeGreaterThan(0);

    expect(await generateReview(week, today, settings, { fetch: down.fetch })).toBe(false);
    expect(down.requests).toHaveLength(attempts);

    // Later, it may try again.
    vi.setSystemTime(new Date(Date.now() + RETRY_AFTER_MS + 1000));
    const fake = fakeClaude({ content: [text(reviewJson())] });
    expect(await generateReview(week, today, settings, { fetch: fake.fetch })).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('keeps an existing review for the week and does not replace it', async () => {
    const settings = await getSettings();
    const first = fakeClaude({ content: [text(reviewJson())] });
    await generateReview(week, today, settings, { fetch: first.fetch });
    // A late, second answer for the same week (e.g. another run of the app) loses.
    resetReviewAttempts();
    const second = fakeClaude({ content: [text(JSON.stringify({ review: 'A different review.' }))] });
    expect(await generateReview(week, today, settings, { fetch: second.fetch })).toBe(false);
    expect(await db.coachMessages.count()).toBe(1);
    expect((await weekReviewMessage(week))?.text).toBe('A solid week. How are you feeling?');
  });

  it('does not store an empty review', async () => {
    const fake = fakeClaude({ content: [text(JSON.stringify({ review: '   ' }))] });
    expect(await generateReview(week, today, await getSettings(), { fetch: fake.fetch })).toBe(false);
    expect(await db.coachMessages.count()).toBe(0);
  });
});
