import { describe, expect, it } from 'vitest';
import { weightsToImport } from './healthWeight';

const at = (day: number, h: number, min = 0) => new Date(2026, 9, day, h, min).toISOString();

describe('weightsToImport', () => {
  it('takes each day\'s first reading, to 0.1 kg, oldest day first', () => {
    const out = weightsToImport(
      [
        { kg: 74.86, startDate: at(13, 19) },
        { kg: 74.32, startDate: at(13, 7, 5) },
        { kg: 74.6, startDate: at(12, 8) },
      ],
      new Set(),
      '2026-10-14',
    );
    expect(out).toEqual([
      { date: '2026-10-12', kg: 74.6 },
      { date: '2026-10-13', kg: 74.3 },
    ]);
  });

  it('leaves a day the log already has, or the owner deleted, as it is', () => {
    const out = weightsToImport([{ kg: 75, startDate: at(13, 7) }, { kg: 74, startDate: at(12, 7) }], new Set(['2026-10-13']), '2026-10-14');
    expect(out).toEqual([{ date: '2026-10-12', kg: 74 }]);
  });

  it('ignores readings that are no weight, out of the window, unreadable or in the future', () => {
    const out = weightsToImport(
      [
        { kg: 12, startDate: at(13, 7) },
        { kg: 420, startDate: at(13, 8) },
        { kg: Number.NaN, startDate: at(13, 9) },
        { kg: 74, startDate: 'not a date' },
        { kg: 74, startDate: at(15, 7) },
        { kg: 74, startDate: new Date(2026, 6, 1, 7).toISOString() },
        { kg: 74.4, startDate: at(13, 10) },
      ],
      new Set(),
      '2026-10-14',
      90,
    );
    expect(out).toEqual([{ date: '2026-10-13', kg: 74.4 }]);
  });
});
