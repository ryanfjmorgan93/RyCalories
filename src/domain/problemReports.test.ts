import { describe, expect, it } from 'vitest';
import { cleanProblem, isRepeat, PROBLEM_DETAIL_MAX, PROBLEM_SUMMARY_MAX, problemsText } from './problemReports';
import type { ProblemReport } from './types';

describe('cleanProblem', () => {
  it('keeps the first line as the summary, cut to length, and nothing when it says nothing', () => {
    expect(cleanProblem({ source: 'coach', summary: '  Builder ignored easy \nsecond line' })).toEqual({ source: 'coach', summary: 'Builder ignored easy' });
    expect(cleanProblem({ source: 'coach', summary: 'x'.repeat(500) })!.summary).toHaveLength(PROBLEM_SUMMARY_MAX);
    expect(cleanProblem({ source: 'coach', summary: '   ' })).toBeNull();
    expect(cleanProblem({ source: 'error', summary: 'e', detail: 'd'.repeat(9000) })!.detail).toHaveLength(PROBLEM_DETAIL_MAX);
  });

  it('never keeps a Claude key, in the summary or the detail', () => {
    const key = 'sk-ant-api03-ABCDEFabcdef0123456789_-xyz';
    const r = cleanProblem({ source: 'error', summary: `401 for ${key}`, detail: `headers: x-api-key: ${key}\nend` })!;
    expect(JSON.stringify(r)).not.toContain('sk-ant');
    expect(r.summary).toBe('401 for [key removed]');
    expect(r.detail).toContain('[key removed]');
  });
});

describe('isRepeat', () => {
  const now = new Date('2026-10-14T15:00:00Z');
  const kept = [{ at: '2026-10-14T09:00:00Z', source: 'error' as const, summary: 'TypeError: x is undefined' }];

  it('an error already kept today is a repeat; a coach report never is', () => {
    expect(isRepeat(kept, { source: 'error', summary: 'TypeError: x is undefined' }, now)).toBe(true);
    expect(isRepeat(kept, { source: 'error', summary: 'TypeError: y is undefined' }, now)).toBe(false);
    expect(isRepeat(kept, { source: 'coach', summary: 'TypeError: x is undefined' }, now)).toBe(false);
    expect(isRepeat(kept, { source: 'error', summary: 'TypeError: x is undefined' }, new Date('2026-10-15T10:00:00Z'))).toBe(false);
  });
});

describe('problemsText', () => {
  it('lists the reports newest first with what each holds', () => {
    const reports: ProblemReport[] = [
      { id: 'a', at: '2026-10-14T13:41:00Z', source: 'coach', summary: 'Builder gave heavy lifts for an easy day', detail: 'Asked: CBA routine\nGot: Squat 4x6-8', screen: '/coach' },
      { id: 'b', at: '2026-10-14T14:02:00Z', source: 'error', summary: 'TypeError: x is undefined', build: 'Iron 1.0 · build 119' },
    ];
    const text = problemsText(reports, 'Iron 1.0 · build 121', new Date('2026-10-14T15:00:00Z'));
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^Iron problem reports · Iron 1\.0 · build 121 · .* · 2 reports$/);
    expect(text.indexOf('TypeError')).toBeLessThan(text.indexOf('Builder gave'));
    expect(text).toContain('app error · TypeError: x is undefined');
    expect(text).toContain('   Build: Iron 1.0 · build 119');
    expect(text).toContain('coach · Builder gave heavy lifts for an easy day');
    expect(text).toContain('   Screen: /coach');
    expect(text).toContain('   Asked: CBA routine\n   Got: Squat 4x6-8');
  });
});
