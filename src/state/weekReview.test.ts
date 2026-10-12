import { beforeEach, describe, expect, it } from 'vitest';
import { lsSet, resetMemory } from '@/ai/store';
import { patchWeekReview, readWeekReview, WEEK_REVIEW_STORAGE } from './weekReview';

describe('the week\'s review record', () => {
  beforeEach(() => {
    resetMemory();
    try {
      localStorage.removeItem(WEEK_REVIEW_STORAGE);
    } catch {
      // no localStorage in this environment: the in-memory copy is what is tested
    }
  });

  it('starts empty for a week', () => {
    expect(readWeekReview('2026-10-12')).toEqual({ week: '2026-10-12', applied: [], dismissed: false });
  });

  it('keeps what was patched for that week', () => {
    patchWeekReview('2026-10-12', { proposal: { calories: 2400 } });
    patchWeekReview('2026-10-12', { applied: ['Calorie target changed.'] });
    expect(readWeekReview('2026-10-12')).toEqual({ week: '2026-10-12', proposal: { calories: 2400 }, applied: ['Calorie target changed.'], dismissed: false });
    patchWeekReview('2026-10-12', { dismissed: true });
    expect(readWeekReview('2026-10-12').dismissed).toBe(true);
  });

  it('is clean again in a new week', () => {
    patchWeekReview('2026-10-12', { proposal: { protein: 190 }, dismissed: true });
    expect(readWeekReview('2026-10-19')).toEqual({ week: '2026-10-19', applied: [], dismissed: false });
  });

  it('ignores a stored value of the wrong shape', () => {
    lsSet(WEEK_REVIEW_STORAGE, JSON.stringify({ week: '2026-10-12', applied: 'no', dismissed: 1 }));
    expect(readWeekReview('2026-10-12')).toEqual({ week: '2026-10-12', applied: [], dismissed: false });
    lsSet(WEEK_REVIEW_STORAGE, '{not json');
    expect(readWeekReview('2026-10-12').dismissed).toBe(false);
  });
});
