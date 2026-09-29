import { describe, expect, it } from 'vitest';
import { legDayProteinLabel } from './format';

describe('legDayProteinLabel', () => {
  it('states the owner\'s own leg-day target, not a fixed 200 g', () => {
    expect(legDayProteinLabel(200)).toBe('Protein 200 g');
    expect(legDayProteinLabel(185)).toBe('Protein 185 g');
    expect(legDayProteinLabel(172.5)).toBe('Protein 172.5 g');
  });

  it('leaves the figure out until settings have loaded', () => {
    expect(legDayProteinLabel(undefined)).toBe('Protein');
  });
});
