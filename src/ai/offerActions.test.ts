import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { getSettings, saveSettings, wipeAll } from '@/db/repo';
import { addSupplement } from '@/db/supplementRepo';
import { createOfferActions } from './offerActions';

const NOW = new Date(2026, 9, 13, 9, 0);
const a = createOfferActions(() => NOW);

beforeEach(async () => {
  await wipeAll();
});

describe('proposeTargets', () => {
  it('offers figures and changes nothing', async () => {
    const before = await getSettings();
    const r = await a.proposeTargets({ calories: 2500.4, protein: 165 });
    expect(r).toMatchObject({ ok: true, targets: { calories: 2500, protein: 165 } });
    expect(r.result).toContain('Nothing has changed');
    const after = await getSettings();
    expect([after.calorieStart, after.calorieCeiling, after.proteinTarget]).toEqual([before.calorieStart, before.calorieCeiling, before.proteinTarget]);
  });

  it('refuses figures out of range, and asks for something', async () => {
    expect((await a.proposeTargets({ calories: 600 })).ok).toBe(false);
    expect((await a.proposeTargets({ protein: 900 })).ok).toBe(false);
    expect((await a.proposeTargets({})).ok).toBe(false);
  });

  it('does not offer a target that is already set', async () => {
    await saveSettings({ proteinTarget: 160, proteinTargetLegDay: 175 });
    const r = await a.proposeTargets({ protein: 160 });
    expect(r.ok).toBe(true);
    expect(r.targets).toBeUndefined();
    expect(r.result).toContain('already 160 g');
  });
});

describe('suggestSupplement', () => {
  it('offers a tidy suggestion, with any time of day', async () => {
    const r = await a.suggestSupplement({ name: ' Creatine  monohydrate ', dose: '5 g', why: 'Well evidenced for strength.' });
    expect(r.suggestion).toEqual({ name: 'Creatine monohydrate', dose: '5 g', time: 'any', why: 'Well evidenced for strength.' });
    expect(await db.supplements.count()).toBe(0);
  });

  it('does not offer what is already on the list, and needs a name and a reason', async () => {
    await addSupplement({ name: 'Vitamin D', time: 'morning' });
    const r = await a.suggestSupplement({ name: 'vitamin d', why: 'Winter.' });
    expect(r.suggestion).toBeUndefined();
    expect(r.result).toContain('already on their list');
    expect((await a.suggestSupplement({ name: '', why: 'x' })).ok).toBe(false);
    expect((await a.suggestSupplement({ name: 'Zinc', why: ' ' })).ok).toBe(false);
  });
});

describe('tickSupplements', () => {
  it('ticks named supplements for today and reports one not on the list', async () => {
    await addSupplement({ name: 'Creatine', dose: '5 g', time: 'any' });
    await addSupplement({ name: 'Vitamin D', time: 'morning' });
    const r = await a.tickSupplements({ names: ['creatine', 'ashwagandha'] });
    expect(r).toMatchObject({ ok: true, description: 'Supplements ticked: Creatine' });
    expect(r.result).toContain('Not on the list: ashwagandha');
    expect((await db.supplementLogs.toArray()).map((l) => l.date)).toEqual(['2026-10-13']);
  });

  it('ticks all, and does not double-tick', async () => {
    await addSupplement({ name: 'Creatine', time: 'any' });
    await addSupplement({ name: 'Fish oil', time: 'evening' });
    // In list order: evening comes before any time.
    expect((await a.tickSupplements({ all: true })).description).toBe('Supplements ticked: Fish oil, Creatine');
    const again = await a.tickSupplements({ all: true });
    expect(again.description).toBeUndefined();
    expect(await db.supplementLogs.count()).toBe(2);
  });

  it('refuses an empty list and a future date', async () => {
    expect((await a.tickSupplements({ all: true })).ok).toBe(false);
    await addSupplement({ name: 'Creatine', time: 'any' });
    expect((await a.tickSupplements({ all: true, date: '2026-10-14' })).ok).toBe(false);
  });
});
