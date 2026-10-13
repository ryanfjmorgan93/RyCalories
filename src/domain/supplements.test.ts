import { describe, expect, it } from 'vitest';
import { cleanSupplementDose, cleanSupplementName, findSupplement, supplementDay, supplementKey, supplementLabel } from './supplements';
import type { Supplement, SupplementLog } from './types';

const sup = (id: string, name: string, time: Supplement['time'], order = 0, extra: Partial<Supplement> = {}): Supplement => ({
  id,
  name,
  time,
  order,
  createdAt: '2026-10-01T08:00:00.000Z',
  source: 'owner',
  ...extra,
});
const log = (supplementId: string, date: string): SupplementLog => ({ id: `${supplementId}-${date}`, date, supplementId, takenAt: `${date}T08:00:00.000Z` });

describe('supplementDay', () => {
  const list = [sup('d', 'Vitamin D', 'morning', 1), sup('m', 'Magnesium', 'evening'), sup('c', 'Creatine', 'morning', 0), sup('o', 'Old', 'any', 0, { archived: true })];

  it('orders by time of day then position, and leaves archived ones off', () => {
    expect(supplementDay(list, [], '2026-10-13').items.map((i) => i.supplement.name)).toEqual(['Creatine', 'Vitamin D', 'Magnesium']);
  });

  it('ticks only that day', () => {
    const day = supplementDay(list, [log('c', '2026-10-13'), log('m', '2026-10-12')], '2026-10-13');
    expect(day.items.map((i) => i.taken)).toEqual([true, false, false]);
    expect(day.taken).toBe(1);
    expect(day.total).toBe(3);
  });

  it('does not count a tick for a supplement taken off the list', () => {
    const day = supplementDay(list, [log('o', '2026-10-13')], '2026-10-13');
    expect(day.taken).toBe(0);
  });

  it('is empty with no supplements', () => {
    expect(supplementDay([], [], '2026-10-13')).toEqual({ items: [], taken: 0, total: 0 });
  });
});

describe('names and doses', () => {
  it('tidies names and doses', () => {
    expect(cleanSupplementName('  Vitamin   D3 ')).toBe('Vitamin D3');
    expect(cleanSupplementName('x'.repeat(80))).toHaveLength(40);
    expect(cleanSupplementDose('  ')).toBeUndefined();
    expect(cleanSupplementDose(' 5  g ')).toBe('5 g');
  });

  it('matches a name however it is written', () => {
    expect(supplementKey('Vitamin-D3')).toBe(supplementKey('vitamin d3'));
    const list = [sup('d', 'Vitamin D3', 'morning'), sup('c', 'Creatine monohydrate', 'any'), sup('x', 'Zinc', 'any', 0, { archived: true })];
    expect(findSupplement(list, 'vitamin d3')?.id).toBe('d');
    expect(findSupplement(list, 'creatine')?.id).toBe('c');
    expect(findSupplement(list, 'zinc')).toBeUndefined();
    expect(findSupplement(list, '  ')).toBeUndefined();
  });

  it('labels with the dose when there is one', () => {
    expect(supplementLabel({ name: 'Creatine', dose: '5 g' })).toBe('Creatine 5 g');
    expect(supplementLabel({ name: 'Fish oil' })).toBe('Fish oil');
  });
});
