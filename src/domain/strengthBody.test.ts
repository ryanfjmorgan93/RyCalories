import { describe, expect, it } from 'vitest';
import { bodyShades, ownOpacity } from './strengthBody';
import type { StrengthStanding } from './standards';

const standing = (level: StrengthStanding['level']): StrengthStanding => ({ level, head: 'e1RM 100 kg, 1.2 × bodyweight', next: null });

describe('the strength figure', () => {
  it('lights legs, chest and back by rank against other lifters, brighter for a stronger band', () => {
    const shades = bodyShades({ squat: standing('Intermediate'), bench: standing('Advanced'), deadlift: standing('Highly advanced') }, []);
    expect(shades.get('quads')).toMatchObject({ kind: 'ranked', lift: 'squat', opacity: 0.55 });
    expect(shades.get('glutes')).toMatchObject({ kind: 'ranked', lift: 'squat' });
    expect(shades.get('chest')).toMatchObject({ kind: 'ranked', lift: 'bench', opacity: 0.8 });
    expect(shades.get('hamstrings')).toMatchObject({ kind: 'ranked', lift: 'deadlift', opacity: 1 });
    expect(shades.get('lower back')).toMatchObject({ kind: 'ranked', lift: 'deadlift' });
    expect(shades.has('shoulders')).toBe(false);
  });

  it("lights every other muscle by the owner's best level on it, and a rank wins where both exist", () => {
    const shades = bodyShades({ bench: standing('Beginner') }, [
      { group: 'shoulders', level: 3, exercise: 'Lateral Raise' },
      { group: 'shoulders', level: 6, exercise: 'DB Shoulder Press' },
      { group: 'chest', level: 9, exercise: 'Cable Fly' },
      { group: 'full body', level: 4, exercise: 'Burpee' },
    ]);
    expect(shades.get('shoulders')).toEqual({ kind: 'own', level: 6, exercise: 'DB Shoulder Press', opacity: ownOpacity(6) });
    expect(shades.get('chest')).toMatchObject({ kind: 'ranked', lift: 'bench', opacity: 0.3 });
    expect(shades.has('full body')).toBe(false);
  });

  it('with no rank, a ranked muscle falls back to the own level', () => {
    expect(bodyShades({}, [{ group: 'quads', level: 2, exercise: 'Leg Extension' }]).get('quads')).toMatchObject({ kind: 'own', level: 2 });
  });

  it('grows with the level and stays under the brightest rank', () => {
    expect(ownOpacity(1)).toBeCloseTo(0.3);
    expect(ownOpacity(5)).toBeCloseTo(0.54);
    expect(ownOpacity(40)).toBe(0.8);
    expect(ownOpacity(0)).toBeCloseTo(0.3);
  });
});
