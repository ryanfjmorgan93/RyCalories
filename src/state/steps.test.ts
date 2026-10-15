import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Health, type QueryOptions } from '@capgo/capacitor-health';
import { setHealthPluginForTest } from '@/platform/health';
import { askForSteps, refreshSteps, stepsSnapshot, useStepsStore } from './steps';

/**
 * The store between the plugin and Home. The plugin is faked (a browser has no Health Connect);
 * Capacitor is told it is on the phone so the real wrapper, mapping and store all run.
 */
const now = () => new Date(2026, 9, 13, 15, 0);
let authorized = false;
const plugin = {
  isAvailable: vi.fn(async () => ({ available: true })),
  checkAuthorization: vi.fn(async () => ({ readAuthorized: authorized ? ['steps'] : [], readDenied: [], writeAuthorized: [], writeDenied: [] }) as never),
  requestAuthorization: vi.fn(async () => {
    authorized = true;
    return { readAuthorized: ['steps'], readDenied: [], writeAuthorized: [], writeDenied: [] } as never;
  }),
  readSamples: vi.fn(async (_q: QueryOptions) => ({
    samples: [{ dataType: 'steps' as const, unit: 'count' as const, value: 4321, startDate: new Date(2026, 9, 13, 9).toISOString(), endDate: new Date(2026, 9, 13, 10).toISOString(), sourceId: 'shealth' }],
  })),
};

beforeEach(() => {
  authorized = false;
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  setHealthPluginForTest(plugin);
  useStepsStore.setState({ access: 'loading', days: null });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  setHealthPluginForTest(Health);
});

describe('steps store', () => {
  it('asks nothing of the owner on a refresh, and reads no steps without permission', async () => {
    await refreshSteps(now);
    expect(useStepsStore.getState()).toEqual({ access: 'needs-permission', days: null });
    expect(plugin.requestAuthorization).not.toHaveBeenCalled();
    expect(plugin.readSamples).not.toHaveBeenCalled();
    expect(stepsSnapshot()).toBeNull();
  });

  it('reads the week once allowed, and the coach sees the same week', async () => {
    expect(await askForSteps(now)).toBe('granted');
    const { access, days } = useStepsStore.getState();
    expect(access).toBe('granted');
    expect(days).toHaveLength(7);
    expect(days!.at(-1)).toEqual({ date: '2026-10-13', steps: 4321 });
    expect(stepsSnapshot('2026-10-13')).toBe(days);
    // Read yesterday and left open: not today's steps.
    expect(stepsSnapshot('2026-10-14')).toBeNull();
  });

  it('runs one read at a time when Home and a resume both ask', async () => {
    authorized = true;
    await Promise.all([refreshSteps(now), refreshSteps(now)]);
    expect(plugin.readSamples).toHaveBeenCalledTimes(1);
    await refreshSteps(now);
    expect(plugin.readSamples).toHaveBeenCalledTimes(2);
  });

  it('is unavailable in a browser', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    await refreshSteps(now);
    expect(useStepsStore.getState().access).toBe('unavailable');
  });
});
