import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addProblemReport, clearProblemReports, listProblemReports } from './problemRepo';
import { PROBLEM_REPORTS_MAX } from '@/domain/problemReports';

beforeEach(async () => {
  await db.problemReports.clear();
});

describe('problem reports on the phone', () => {
  it('keeps reports newest first, with their time, and clears them', async () => {
    await addProblemReport({ source: 'coach', summary: 'first' }, new Date('2026-10-14T10:00:00Z'));
    await addProblemReport({ source: 'coach', summary: 'second', detail: 'more' }, new Date('2026-10-14T11:00:00Z'));
    const list = await listProblemReports();
    expect(list.map((r) => [r.summary, r.at])).toEqual([
      ['second', '2026-10-14T11:00:00.000Z'],
      ['first', '2026-10-14T10:00:00.000Z'],
    ]);
    await clearProblemReports();
    expect(await db.problemReports.count()).toBe(0);
  });

  it('keeps the same error once a day, and nothing that says nothing', async () => {
    const at = new Date('2026-10-14T10:00:00Z');
    expect(await addProblemReport({ source: 'error', summary: 'TypeError: boom' }, at)).not.toBeNull();
    expect(await addProblemReport({ source: 'error', summary: 'TypeError: boom' }, new Date('2026-10-14T12:00:00Z'))).toBeNull();
    expect(await addProblemReport({ source: 'coach', summary: '' }, at)).toBeNull();
    expect(await db.problemReports.count()).toBe(1);
  });

  it('drops the oldest past the cap', async () => {
    for (let i = 0; i < PROBLEM_REPORTS_MAX + 3; i++) await addProblemReport({ source: 'coach', summary: `r${i}` }, new Date(Date.UTC(2026, 9, 14, 0, i)));
    const list = await listProblemReports();
    expect(list).toHaveLength(PROBLEM_REPORTS_MAX);
    expect(list.at(-1)!.summary).toBe('r3');
    expect(list[0]!.summary).toBe(`r${PROBLEM_REPORTS_MAX + 2}`);
  });
});
