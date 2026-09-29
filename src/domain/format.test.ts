import { describe, expect, it } from 'vitest';
import { fmtWeekOf, legDayProteinLabel } from './format';

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


// en-GB abbreviates September as "Sept" in newer ICU data and "Sep" in older; either is right.
const SEP_14 = /^Week of 14 Sept?$/;

describe('fmtWeekOf', () => {
  it('calls the current week "This week"', () => {
    expect(fmtWeekOf('2026-09-21', '2026-09-21')).toBe('This week');
  });

  it('names any other week by its Monday', () => {
    expect(fmtWeekOf('2026-09-14', '2026-09-21')).toMatch(SEP_14);
    expect(fmtWeekOf('2026-03-02', '2026-09-21')).toBe('Week of 2 Mar');
  });

  it('adds the year when the week is not in this week\'s year', () => {
    expect(fmtWeekOf('2025-12-29', '2026-01-05')).toBe('Week of 29 Dec 2025');
  });

  it('names the same day in a timezone behind UTC, where a bare date string parses to the day before', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // Guard the premise: in this zone `new Date('2026-09-14')` is 13 September locally.
      expect(new Date('2026-09-14').getDate()).toBe(13);
      expect(fmtWeekOf('2026-09-14', '2026-09-21')).toMatch(SEP_14);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
