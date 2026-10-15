import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { listScans, saveScans, SCAN_WEIGHT_NOTE } from './bodyScanRepo';
import { logBodyweight, wipeAll } from './repo';
import type { ParsedScan } from '@/domain/inbody';

const scan = (date: string, o: Partial<ParsedScan> = {}): ParsedScan => ({ date, source: 'csv', weightKg: 81, skeletalMuscleKg: 36, ...o });

beforeEach(async () => {
  await wipeAll();
});

describe('saveScans', () => {
  it('stores scans with ids and an import time, and reads them back oldest first', async () => {
    const r = await saveScans([scan('2026-08-04'), scan('2026-07-07')]);
    expect(r).toEqual({ saved: 2, replaced: 0, weightsLogged: 2 });
    const rows = await listScans();
    expect(rows.map((s) => s.date)).toEqual(['2026-07-07', '2026-08-04']);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(rows[0].importedAt)).not.toBeNaN();
    expect(rows[0]).toMatchObject({ source: 'csv', weightKg: 81, skeletalMuscleKg: 36 });
  });

  it('replaces the scan for a date instead of adding a second, keeping its id', async () => {
    await saveScans([scan('2026-08-04', { weightKg: 81, bodyFatPct: 17 })]);
    const [first] = await listScans();
    const r = await saveScans([scan('2026-08-04', { weightKg: 82 })]);
    expect(r).toEqual({ saved: 1, replaced: 1, weightsLogged: 0 });
    const rows = await listScans();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].weightKg).toBe(82);
    // Replaced, not merged: the earlier scan's body fat is gone with it.
    expect(rows[0]).not.toHaveProperty('bodyFatPct');
  });

  it('is harmless to import the same file twice', async () => {
    const file = [scan('2026-07-07'), scan('2026-08-04')];
    await saveScans(file);
    await saveScans(file);
    expect(await db.bodyScans.count()).toBe(2);
    expect(await db.bodyweight.where('date').anyOf('2026-07-07', '2026-08-04').count()).toBe(2);
  });

  it('writes the weight to the bodyweight log for a date with no reading, with a note saying where it is from', async () => {
    await saveScans([scan('2026-08-04', { weightKg: 81.5 })]);
    const rows = await db.bodyweight.where('date').equals('2026-08-04').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kg: 81.5, note: SCAN_WEIGHT_NOTE });
  });

  it('leaves a bodyweight reading already on that date alone', async () => {
    await logBodyweight('2026-08-04', 80.2, 'after the gym');
    const r = await saveScans([scan('2026-08-04', { weightKg: 81.5 })]);
    expect(r.weightsLogged).toBe(0);
    const rows = await db.bodyweight.where('date').equals('2026-08-04').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kg: 80.2, note: 'after the gym' });
  });

  it('writes no bodyweight reading for a scan without a weight', async () => {
    const r = await saveScans([scan('2026-08-04', { weightKg: undefined })]);
    expect(r.weightsLogged).toBe(0);
    expect(await db.bodyweight.where('date').equals('2026-08-04').count()).toBe(0);
  });

  it('does not touch the bodyweight log of other dates', async () => {
    const before = await db.bodyweight.count();
    await saveScans([scan('2026-08-04')]);
    expect(await db.bodyweight.count()).toBe(before + 1);
  });

  it('keeps one scan per date when the input holds two for a date, the last winning', async () => {
    await saveScans([scan('2026-08-04', { weightKg: 81 }), scan('2026-08-04', { weightKg: 83 })]);
    const rows = await listScans();
    expect(rows).toHaveLength(1);
    expect(rows[0].weightKg).toBe(83);
  });

  it('saves nothing, and says so, for an empty list', async () => {
    expect(await saveScans([])).toEqual({ saved: 0, replaced: 0, weightsLogged: 0 });
  });

  it('keeps segmental values and time of day', async () => {
    await saveScans([scan('2026-08-04', { takenAt: '2026-08-04T06:20:00.000Z', segmentalLeanKg: { rightArm: 3.6 }, segmentalFatKg: { trunk: 6.2 } })]);
    const [row] = await listScans();
    expect(row).toMatchObject({ takenAt: '2026-08-04T06:20:00.000Z', segmentalLeanKg: { rightArm: 3.6 }, segmentalFatKg: { trunk: 6.2 } });
  });
});

describe('reads', () => {
  it('are empty on a fresh database', async () => {
    expect(await listScans()).toEqual([]);
  });
});
