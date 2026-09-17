import { describe, expect, it } from 'vitest';
import { regionIntensity } from './BodyMap';

describe('regionIntensity', () => {
  it('sets mode: scales with the group\'s own target', () => {
    expect(regionIntensity({ mode: 'sets', sets: 6, target: 10, maxSets: 20, daysAgo: undefined })).toBeCloseTo(0.6);
  });

  it('sets mode: falls back to the busiest group when there is no target', () => {
    expect(regionIntensity({ mode: 'sets', sets: 6, target: null, maxSets: 12, daysAgo: undefined })).toBeCloseTo(0.5);
  });

  it('sets mode: zero sets is zero, regardless of target', () => {
    expect(regionIntensity({ mode: 'sets', sets: 0, target: 10, maxSets: 12, daysAgo: undefined })).toBe(0);
  });

  it('sets mode: clamps at 1 when sets exceed the target', () => {
    expect(regionIntensity({ mode: 'sets', sets: 15, target: 10, maxSets: 20, daysAgo: undefined })).toBe(1);
  });

  it('recency mode: 0-2 days ago is strong', () => {
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 0 })).toBe(1);
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 2 })).toBe(1);
  });

  it('recency mode: 3-6 days ago is medium', () => {
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 3 })).toBeCloseTo(0.55);
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 6 })).toBeCloseTo(0.55);
  });

  it('recency mode: 7+ days ago is dim', () => {
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 7 })).toBeCloseTo(0.25);
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: 40 })).toBeCloseTo(0.25);
  });

  it('recency mode: never trained is zero', () => {
    expect(regionIntensity({ mode: 'recency', sets: 0, target: null, maxSets: 1, daysAgo: undefined })).toBe(0);
  });
});
