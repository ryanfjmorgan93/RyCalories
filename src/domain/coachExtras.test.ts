import { describe, expect, it, vi } from 'vitest';
import { seededInput } from '../test/routineFixtures';

/**
 * A contract test, and it says plainly what it is: the request parser is being given fields this
 * module does not know (`excludePatterns` and `typedNiggles` on its way into the request), by
 * another change. Here a stand-in for that parser adds one to what `parseQuickRequest` returns and
 * `routineRequestFrom` copies it, and the test is of what THIS module does with a field it has never
 * named: it is read into the edit, joins what the routine's request already holds, and is carried
 * through every later edit. The parser itself is not under test and is not the real one.
 */
vi.mock('./quickRequest', async (importOriginal) => {
  const real = await importOriginal<typeof import('./quickRequest')>();
  return {
    ...real,
    parseQuickRequest: (text: string) => {
      const read = real.parseQuickRequest(text.replace(/\boverhead press\b/g, ' '));
      return /\boverhead press\b/.test(text) ? { ...read, excludePatterns: ['press-vertical'] } : read;
    },
  };
});
vi.mock('./routineBuilder', async (importOriginal) => {
  const real = await importOriginal<typeof import('./routineBuilder')>();
  return {
    ...real,
    routineRequestFrom: (parsed: Parameters<typeof real.routineRequestFrom>[0]) => {
      const request = real.routineRequestFrom(parsed);
      const patterns = (parsed as { excludePatterns?: string[] }).excludePatterns;
      return patterns ? { ...request, excludePatterns: patterns } : request;
    },
  };
});

const { applyEdit, buildCoach, buildEdit } = await import('./coachBuild');
const { readEdit, routeCoachMessage } = await import('./coachIntent');
type Request = import('./coachBuild').CoachRequest;

const INPUT = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });

describe('a field the request parser reads that this module does not name', () => {
  it('is read into the edit, and "no overhead press" is that, not a row to drop', () => {
    expect(readEdit('no overhead press')).toMatchObject({ extras: { excludePatterns: ['press-vertical'] } });
    expect(readEdit('no overhead press')?.remove).toBeUndefined();
    // And without the field, the same shape of words is a row to drop.
    expect(readEdit('no front raises')).toMatchObject({ remove: { target: ['front', 'raises'] } });
  });

  it('makes a message an edit after a routine, and a question before one', () => {
    expect(routeCoachMessage('no overhead press', { lastWasRoutine: true })).toBe('edit');
    expect(routeCoachMessage('no overhead press', { lastWasRoutine: false })).toBe('ask');
  });

  it('joins what the routine\'s request already held, without repeating, beside what else the message said', () => {
    const request = { focus: ['shoulders', 'rear delts'], count: 6, excludePatterns: ['hinge'] } as Request;
    const before = buildCoach(INPUT, request, 7);
    const plan = applyEdit(request, before, 'add biceps, no overhead press', 7);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect((plan.request as unknown as Record<string, unknown>).excludePatterns).toEqual(['hinge', 'press-vertical']);
    expect(plan.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
    const again = applyEdit(plan.request, before, 'no overhead press', 7);
    expect(again.ok && (again.request as unknown as Record<string, unknown>).excludePatterns).toEqual(['hinge', 'press-vertical']);
  });

  it('is carried through an edit that does not mention it', () => {
    const request = { focus: ['shoulders', 'rear delts'], count: 6, excludePatterns: ['press-vertical'] } as Request;
    const before = buildCoach(INPUT, request, 7);
    const plan = applyEdit(request, before, 'make it 5 exercises', 7);
    expect(plan.ok && (plan.request as unknown as Record<string, unknown>).excludePatterns).toEqual(['press-vertical']);
    if (!plan.ok) return;
    const built = buildEdit(INPUT, plan, before, () => 1);
    expect((built.request as unknown as Record<string, unknown>).excludePatterns).toEqual(['press-vertical']);
  });
});
