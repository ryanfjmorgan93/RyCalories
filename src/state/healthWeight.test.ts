import { Capacitor } from '@capacitor/core';
import { Health, type QueryOptions } from '@capgo/capacitor-health';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { deleteBodyweight, getSettings, logBodyweight, resetToSeed, saveSettings } from '@/db/repo';
import { setHealthPluginForTest } from '@/platform/health';
import { setHealthWeight, syncHealthWeight } from './healthWeight';

/**
 * The weight read, from the plugin to the bodyweight log. The plugin is faked (a browser has no
 * Health Connect); Capacitor is told it is on the phone so the real wrapper, rules and writes run.
 */
const now = () => new Date(2026, 9, 14, 9, 0);
let granted = true;
const samples = [
  { value: 74.3, startDate: new Date(2026, 9, 14, 7).toISOString() },
  { value: 74.9, startDate: new Date(2026, 9, 13, 7).toISOString() },
  { value: 75.1, startDate: new Date(2026, 9, 12, 7).toISOString() },
];
const plugin = {
  isAvailable: vi.fn(async () => ({ available: true })),
  checkAuthorization: vi.fn(async () => ({ readAuthorized: granted ? ['weight'] : [], readDenied: [], writeAuthorized: [], writeDenied: [] }) as never),
  requestAuthorization: vi.fn(async () => ({ readAuthorized: granted ? ['weight'] : [], readDenied: [], writeAuthorized: [], writeDenied: [] }) as never),
  readSamples: vi.fn(async (_q: QueryOptions) => ({ samples: samples.map((s) => ({ dataType: 'weight' as const, unit: 'kilogram' as const, endDate: s.startDate, ...s })) })),
};

beforeEach(async () => {
  granted = true;
  await resetToSeed();
  await db.bodyweight.clear();
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  setHealthPluginForTest(plugin);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  setHealthPluginForTest(Health);
});

const log = async () => (await db.bodyweight.orderBy('date').toArray()).map((b) => [b.date, b.kg, b.source ?? 'owner']);

describe('weight from Health Connect', () => {
  it('reads nothing while it is off', async () => {
    expect(await syncHealthWeight(now)).toBe(0);
    expect(plugin.readSamples).not.toHaveBeenCalled();
  });

  it('turned on, asks for weight alone, then reads the days the log has none for and keeps the owner\'s own', async () => {
    await logBodyweight('2026-10-13', 74.5);
    expect(await setHealthWeight(true)).toBe('granted');
    expect(plugin.requestAuthorization).toHaveBeenCalledWith({ read: ['weight'] });
    expect((await getSettings()).healthWeight).toBe(true);
    expect(await log()).toEqual([
      ['2026-10-12', 75.1, 'health-connect'],
      ['2026-10-13', 74.5, 'owner'],
      ['2026-10-14', 74.3, 'health-connect'],
    ]);
    expect((plugin.readSamples.mock.calls[0]![0] as QueryOptions).dataType).toBe('weight');
    // Read again: nothing new, nothing doubled.
    expect(await syncHealthWeight(now)).toBe(0);
    expect(await db.bodyweight.count()).toBe(3);
  });

  it('a reading deleted while Health Connect is still answering is not written back', async () => {
    await saveSettings({ healthWeight: true });
    await syncHealthWeight(now);
    const imported = (await db.bodyweight.toArray()).find((b) => b.date === '2026-10-12')!;
    const read = plugin.readSamples.getMockImplementation()!;
    plugin.readSamples.mockImplementationOnce(async (q: QueryOptions) => {
      await deleteBodyweight(imported.id);
      return read(q);
    });
    await syncHealthWeight(now);
    expect((await log()).map((r) => r[0])).toEqual(['2026-10-13', '2026-10-14']);
  });

  it('a reading the owner deletes is not read in again; one they re-log by hand becomes theirs', async () => {
    await saveSettings({ healthWeight: true });
    await syncHealthWeight(now);
    const imported = (await db.bodyweight.toArray()).find((b) => b.date === '2026-10-12')!;
    await deleteBodyweight(imported.id);
    expect((await getSettings()).healthWeightSkip).toEqual(['2026-10-12']);
    await syncHealthWeight(now);
    expect((await log()).map((r) => r[0])).toEqual(['2026-10-13', '2026-10-14']);
    await logBodyweight('2026-10-14', 74.0);
    expect((await log()).at(-1)).toEqual(['2026-10-14', 74, 'owner']);
  });

  it('turned on without permission, stays off and reads nothing', async () => {
    granted = false;
    expect(await setHealthWeight(true)).toBe('needs-permission');
    expect((await getSettings()).healthWeight).toBeFalsy();
    expect(await db.bodyweight.count()).toBe(0);
  });
});
