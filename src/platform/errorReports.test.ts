/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { describeError, installErrorCapture, recordUncaughtError } from './errorReports';

beforeEach(async () => {
  await db.problemReports.clear();
});

describe('uncaught errors', () => {
  it('reads an error, a string and anything else into a summary', () => {
    const e = new TypeError('x is undefined');
    expect(describeError(e)).toMatchObject({ summary: 'TypeError: x is undefined' });
    expect(describeError(e).detail).toContain('x is undefined');
    expect(describeError('plain')).toEqual({ summary: 'plain' });
    expect(describeError({ code: 3 })).toEqual({ summary: 'Unexpected error: {"code":3}' });
  });

  it('keeps an uncaught error as an app-error report with its screen, once a day', async () => {
    await recordUncaughtError(new RangeError('bad'), '/session/1', new Date('2026-10-14T10:00:00Z'));
    await recordUncaughtError(new RangeError('bad'), '/session/1', new Date('2026-10-14T11:00:00Z'));
    const all = await db.problemReports.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ source: 'error', summary: 'RangeError: bad', screen: '/session/1' });
    expect(all[0]!.build).toBeTruthy();
  });

  it('does not listen in a browser, and listens once on the phone', () => {
    const add = vi.spyOn(window, 'addEventListener');
    installErrorCapture(false);
    expect(add).not.toHaveBeenCalled();
    installErrorCapture(true);
    installErrorCapture(true);
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'unhandledrejection']);
    add.mockRestore();
  });
});
