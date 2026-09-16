import { describe, expect, it } from 'vitest';
import { STRENGTH_STANDARDS, strengthLevel } from './standards';

describe('strength standards', () => {
  it('names all five lifts', () => {
    expect(STRENGTH_STANDARDS).toEqual(['squat', 'bench', 'deadlift', 'press', 'row']);
  });

  it('reports the level at exactly a threshold', () => {
    // squat beginner multiple is 0.75
    const r = strengthLevel('squat', 60, 80);
    expect(r.ratio).toBe(0.75);
    expect(r.level).toBe('beginner');
  });

  it('reports untrained below the beginner multiple', () => {
    const r = strengthLevel('bench', 30, 80);
    expect(r.ratio).toBe(0.38);
    expect(r.level).toBe('untrained');
    expect(r.next).toEqual({ level: 'beginner', ratio: 0.5, kg: 40 });
  });

  it('reports the next level and the kg needed at this bodyweight', () => {
    const r = strengthLevel('deadlift', 90, 80);
    // ratio 1.125 -> beginner (>=1), next is novice at 1.5x
    expect(r.level).toBe('beginner');
    expect(r.next).toEqual({ level: 'novice', ratio: 1.5, kg: 120 });
  });

  it('has no next level at elite', () => {
    const r = strengthLevel('press', 112, 80); // 1.4x
    expect(r.level).toBe('elite');
    expect(r.next).toBeNull();
  });

  it('rounds the ratio to 2dp', () => {
    const r = strengthLevel('row', 100, 77);
    expect(r.ratio).toBe(1.3);
  });

  it('throws a plain Error for a non-positive bodyweight', () => {
    expect(() => strengthLevel('squat', 60, 0)).toThrow(Error);
    expect(() => strengthLevel('squat', 60, -5)).toThrow(Error);
  });
});
