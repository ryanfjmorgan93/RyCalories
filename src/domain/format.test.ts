import { describe, expect, it } from 'vitest';
import { fmtWeekOf, labelLine, muscleLabel } from './format';

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

describe('labels', () => {
  it('capitalises every word of a descriptor and leaves units alone', () => {
    expect(muscleLabel('rear delts')).toBe('Rear Delts');
    expect(muscleLabel('lower back')).toBe('Lower Back');
    expect(labelLine(['lower back', 'isolation', 'bodyweight +kg', 'per side'])).toBe('Lower Back · Isolation · Bodyweight +kg · Per Side');
    expect(labelLine(['quads', 'compound', 'rest 150 s', '+5 kg steps'])).toBe('Quads · Compound · Rest 150 s · +5 kg Steps');
    expect(labelLine(['chest', '', null, false, 'cable'])).toBe('Chest · Cable');
  });
});
