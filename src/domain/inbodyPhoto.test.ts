import { describe, expect, it } from 'vitest';
import { parsedFromReading } from './inbodyPhoto';

const TODAY = '2026-10-12';

describe('an InBody sheet read from a photo', () => {
  it('is one scan on the date the sheet shows, with every measure read', () => {
    const parsed = parsedFromReading(
      { date: '2026-09-30', weightKg: 81.5, skeletalMuscleKg: 36.4, bodyFatKg: 14.1, bodyFatPct: 17.3, bmrKcal: 1850, inbodyScore: 82 },
      TODAY,
    );
    expect(parsed).toEqual({
      scans: [{ date: '2026-09-30', source: 'photo', weightKg: 81.5, skeletalMuscleKg: 36.4, bodyFatKg: 14.1, bodyFatPct: 17.3, bmrKcal: 1850, inbodyScore: 82 }],
      skipped: [],
    });
  });

  it('uses today, and says so, when the sheet shows no date', () => {
    const parsed = parsedFromReading({ weightKg: 80, skeletalMuscleKg: 36 }, TODAY)!;
    expect(parsed.scans[0]!.date).toBe(TODAY);
    expect(parsed.dateNote).toBe("The sheet shows no date, so today's date is used.");
  });

  it('does not trust a date that cannot be right', () => {
    for (const date of ['2027-01-05', '2026-02-30', '1999-12-31', '12/10/2026']) {
      const parsed = parsedFromReading({ date, weightKg: 80 }, TODAY)!;
      expect(parsed.scans[0]!.date).toBe(TODAY);
      expect(parsed.dateNote).toContain("didn't look right");
    }
  });

  it('accepts today itself', () => {
    const parsed = parsedFromReading({ date: TODAY, weightKg: 80 }, TODAY)!;
    expect(parsed.scans[0]!.date).toBe(TODAY);
    expect(parsed.dateNote).toBeUndefined();
  });

  it('is nothing when no measure was read', () => {
    expect(parsedFromReading({}, TODAY)).toBeNull();
    expect(parsedFromReading({ date: '2026-09-30' }, TODAY)).toBeNull();
  });
});
