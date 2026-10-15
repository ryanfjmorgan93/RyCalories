import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { wipeAll } from './repo';
import { addSupplement, markSupplementsTaken, removeSupplement, toggleSupplementTaken } from './supplementRepo';
import { supplementDay } from '@/domain/supplements';

beforeEach(async () => {
  await wipeAll();
});

const day = async (date: string) => supplementDay(await db.supplements.toArray(), await db.supplementLogs.toArray(), date);

describe('addSupplement', () => {
  it('adds to the end of its time of day, tidied', async () => {
    await addSupplement({ name: '  Creatine ', dose: ' 5 g ', time: 'morning' });
    const r = await addSupplement({ name: 'Vitamin D', dose: '25 µg', time: 'morning' });
    expect(r).toMatchObject({ ok: true, existed: false });
    const rows = await db.supplements.orderBy('order').toArray();
    expect(rows.map((s) => [s.name, s.dose, s.order, s.source])).toEqual([
      ['Creatine', '5 g', 0, 'owner'],
      ['Vitamin D', '25 µg', 1, 'owner'],
    ]);
  });

  it('does not add the same name twice', async () => {
    const a = await addSupplement({ name: 'Creatine', time: 'any' });
    const b = await addSupplement({ name: 'creatine', time: 'evening', source: 'coach' });
    expect(b).toMatchObject({ ok: true, existed: true });
    expect(b.ok && a.ok && b.supplement.id).toBe(a.ok && a.supplement.id);
    expect(await db.supplements.count()).toBe(1);
  });

  it('refuses an empty name', async () => {
    expect(await addSupplement({ name: '   ', time: 'any' })).toEqual({ ok: false, reason: 'empty' });
    expect(await db.supplements.count()).toBe(0);
  });
});

describe('ticks', () => {
  it('toggles a tick for the day, and only that day', async () => {
    const r = await addSupplement({ name: 'Creatine', time: 'any' });
    if (!r.ok) throw new Error('not added');
    expect(await toggleSupplementTaken(r.supplement.id, '2026-10-13')).toBe(true);
    expect((await day('2026-10-13')).taken).toBe(1);
    expect((await day('2026-10-14')).taken).toBe(0);
    expect(await toggleSupplementTaken(r.supplement.id, '2026-10-13')).toBe(false);
    expect((await day('2026-10-13')).taken).toBe(0);
    expect(await db.supplementLogs.count()).toBe(0);
  });

  it('marks several taken without unticking any already ticked', async () => {
    const a = await addSupplement({ name: 'Creatine', time: 'any' });
    const b = await addSupplement({ name: 'Fish oil', time: 'any' });
    if (!a.ok || !b.ok) throw new Error('not added');
    await toggleSupplementTaken(a.supplement.id, '2026-10-13');
    expect(await markSupplementsTaken([a.supplement.id, b.supplement.id, b.supplement.id], '2026-10-13')).toBe(1);
    expect((await day('2026-10-13')).taken).toBe(2);
    expect(await db.supplementLogs.count()).toBe(2);
  });
});

describe('editing the list', () => {
  it('takes one off the list without losing its ticks', async () => {
    const r = await addSupplement({ name: 'Zinc', dose: '15 mg', time: 'evening' });
    if (!r.ok) throw new Error('not added');
    let row = await db.supplements.get(r.supplement.id);
    await toggleSupplementTaken(r.supplement.id, '2026-10-12');
    await removeSupplement(r.supplement.id);
    row = await db.supplements.get(r.supplement.id);
    expect(row?.archived).toBe(true);
    expect((await day('2026-10-13')).total).toBe(0);
    expect(await db.supplementLogs.count()).toBe(1);
  });
});
