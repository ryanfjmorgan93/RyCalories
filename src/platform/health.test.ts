import { afterEach, describe, expect, it, vi } from 'vitest';
import { Health, type QueryOptions } from '@capgo/capacitor-health';
import { readStepDays, requestStepsAccess, setHealthPluginForTest, stepsAccess } from './health';

/**
 * The plugin is faked here with the shapes its own type definitions give, so this proves the
 * mapping from what Health Connect returns to daily steps, and the access states. It cannot prove
 * that the phone answers; nothing in a browser can.
 */
function fake(o: { available?: boolean; authorized?: boolean; samples?: { value: number; startDate: string; sourceId?: string }[]; throws?: boolean } = {}) {
  const auth = () => ({ readAuthorized: o.authorized ? ['steps'] : [], readDenied: o.authorized ? [] : ['steps'], writeAuthorized: [], writeDenied: [] });
  return {
    isAvailable: vi.fn(async () => ({ available: o.available ?? true })),
    checkAuthorization: vi.fn(async () => auth() as never),
    requestAuthorization: vi.fn(async () => auth() as never),
    readSamples: vi.fn(async (_query: QueryOptions) => {
      if (o.throws) throw new Error('denied');
      return { samples: (o.samples ?? []).map((s) => ({ dataType: 'steps' as const, unit: 'count' as const, endDate: s.startDate, ...s })) };
    }),
  };
}

afterEach(() => setHealthPluginForTest(Health));

describe('stepsAccess', () => {
  it('is unavailable off the phone, without asking the plugin', async () => {
    const p = fake();
    setHealthPluginForTest(p);
    expect(await stepsAccess(false)).toBe('unavailable');
    expect(p.isAvailable).not.toHaveBeenCalled();
  });

  it('reports a phone without Health Connect, one that needs permission, and one that has it', async () => {
    setHealthPluginForTest(fake({ available: false }));
    expect(await stepsAccess(true)).toBe('unavailable');
    setHealthPluginForTest(fake({ authorized: false }));
    expect(await stepsAccess(true)).toBe('needs-permission');
    setHealthPluginForTest(fake({ authorized: true }));
    expect(await stepsAccess(true)).toBe('granted');
  });

  it('asks for read access to steps only', async () => {
    const p = fake({ authorized: true });
    setHealthPluginForTest(p);
    expect(await requestStepsAccess(true)).toBe('granted');
    expect(p.requestAuthorization).toHaveBeenCalledWith({ read: ['steps'] });
  });
});

describe('readStepDays', () => {
  it('reads the week from local midnight six days back and totals it by day', async () => {
    const now = new Date(2026, 9, 13, 15, 0);
    const p = fake({
      authorized: true,
      samples: [
        { value: 3000, startDate: new Date(2026, 9, 13, 9).toISOString(), sourceId: 'shealth' },
        { value: 2000, startDate: new Date(2026, 9, 13, 12).toISOString(), sourceId: 'shealth' },
        { value: 8000, startDate: new Date(2026, 9, 10, 18).toISOString(), sourceId: 'shealth' },
      ],
    });
    setHealthPluginForTest(p);
    const days = await readStepDays(now);
    expect(days).toHaveLength(7);
    expect(days!.at(-1)).toEqual({ date: '2026-10-13', steps: 5000 });
    expect(days!.find((d) => d.date === '2026-10-10')!.steps).toBe(8000);
    expect(days!.find((d) => d.date === '2026-10-11')!.steps).toBeNull();
    const query = p.readSamples.mock.calls[0]![0];
    expect(new Date(query.startDate!).getTime()).toBe(new Date(2026, 9, 7, 0, 0).getTime());
    expect(query.limit).toBe(0);
  });

  it('is null when the read fails', async () => {
    setHealthPluginForTest(fake({ throws: true }));
    expect(await readStepDays(new Date(2026, 9, 13, 15))).toBeNull();
  });
});
