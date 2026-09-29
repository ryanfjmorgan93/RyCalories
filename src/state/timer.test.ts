/**
 * @vitest-environment jsdom
 *
 * jsdom because the timer store persists to localStorage.
 *
 * What this proves, and what it cannot. The Capacitor LocalNotifications plugin has no native side
 * in Vitest, so it is replaced by recording fakes (`schedule`, `cancel`, ...) and
 * `Capacitor.isNativePlatform` is spied to say "native". Everything between the timer store and
 * that plugin boundary is real: the real Zustand timer, the real `scheduleRestNotification`, the
 * real Dexie settings row (fake-indexeddb) and the real `shouldNotifyRestEnd` gate. So these tests
 * prove the toggle reaches the scheduling call. They do not prove Android actually shows or
 * suppresses a notification — that is checked on the phone.
 *
 * `start()` fires `scheduleRestNotification` without awaiting it, so each test takes the promise
 * that call returned (via a call-through spy) and awaits it: "nothing was scheduled" is only
 * asserted once the function has run to its end, never merely because nothing has happened yet.
 */
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const schedule = vi.fn(async (_opts?: unknown) => {});
const cancel = vi.fn(async (_opts?: unknown) => {});
const checkPermissions = vi.fn(async () => ({ display: 'granted' }));
const requestPermissions = vi.fn(async () => ({ display: 'granted' }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: (o: unknown) => schedule(o),
    cancel: (o: unknown) => cancel(o),
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
  },
}));

import { db } from '@/db/db';
import { resetToSeed, saveSettings } from '@/db/repo';
import * as native from './native';
import { useTimer } from './timer';

let scheduleCall: MockInstance<typeof native.scheduleRestNotification>;

/** The promise the most recent `scheduleRestNotification` call returned, awaited to its end. */
async function settled(): Promise<void> {
  const last = scheduleCall.mock.results[scheduleCall.mock.results.length - 1];
  expect(last, 'scheduleRestNotification was never called').toBeDefined();
  await last.value;
}

beforeEach(async () => {
  await resetToSeed();
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  scheduleCall = vi.spyOn(native, 'scheduleRestNotification');
  schedule.mockClear();
  cancel.mockClear();
  checkPermissions.mockClear();
  useTimer.setState({ endsAt: null, startedAt: null, totalSec: 0, label: '', firedFor: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rest timer -> native notification', () => {
  it('schedules the notification when Settings → Rest → notification is on', async () => {
    await saveSettings({ restNotify: true });

    useTimer.getState().start(60, 'Squat');
    await settled();

    expect(schedule).toHaveBeenCalledTimes(1);
    const arg = schedule.mock.calls[0][0] as { notifications: { body: string; schedule: { at: Date } }[] };
    expect(arg.notifications[0].body).toBe('Squat');
    expect(arg.notifications[0].schedule.at.getTime()).toBe(useTimer.getState().endsAt);
  });

  it('schedules nothing when the notification toggle is off, but still cancels any pending one', async () => {
    await saveSettings({ restNotify: false });

    useTimer.getState().start(60, 'Squat');
    await settled();

    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    // The timer itself still runs — only the system notification is gated.
    expect(useTimer.getState().endsAt).not.toBeNull();
  });

  it('adding time while the toggle is off schedules nothing either', async () => {
    await saveSettings({ restNotify: false });
    useTimer.getState().start(60, 'Squat');
    await settled();

    useTimer.getState().add(30);
    await settled();

    expect(scheduleCall).toHaveBeenCalledTimes(2);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a toggle switched off mid-rest stops the next add() rescheduling, and cancels the pending one', async () => {
    await saveSettings({ restNotify: true });
    useTimer.getState().start(60, 'Squat');
    await settled();
    expect(schedule).toHaveBeenCalledTimes(1);
    cancel.mockClear();

    await saveSettings({ restNotify: false });
    useTimer.getState().add(30);
    await settled();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('with no settings row it notifies (the in-app default) and does not seed one as a side effect', async () => {
    await db.settings.clear();

    useTimer.getState().start(60, 'Squat');
    await settled();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(await db.settings.count()).toBe(0);
  });

  it('on the web shell it never touches the plugin', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    await saveSettings({ restNotify: true });

    useTimer.getState().start(60, 'Squat');
    await settled();

    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(checkPermissions).not.toHaveBeenCalled();
  });
});

describe('native notification permission', () => {
  it('reads the plugin state and maps it to granted / denied / prompt without asking', async () => {
    checkPermissions.mockResolvedValueOnce({ display: 'granted' });
    expect(await native.nativeNotificationPermission()).toBe('granted');
    checkPermissions.mockResolvedValueOnce({ display: 'denied' });
    expect(await native.nativeNotificationPermission()).toBe('denied');
    checkPermissions.mockResolvedValueOnce({ display: 'prompt-with-rationale' });
    expect(await native.nativeNotificationPermission()).toBe('prompt');
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('requestNativeNotifications asks the system and returns the outcome', async () => {
    requestPermissions.mockResolvedValueOnce({ display: 'denied' });
    expect(await native.requestNativeNotifications()).toBe('denied');
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('is unsupported on the web shell and when the plugin throws', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    expect(await native.nativeNotificationPermission()).toBe('unsupported');
    expect(await native.requestNativeNotifications()).toBe('unsupported');
    expect(checkPermissions).not.toHaveBeenCalled();

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    checkPermissions.mockRejectedValueOnce(new Error('no plugin'));
    expect(await native.nativeNotificationPermission()).toBe('unsupported');
  });
});
