import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked so `native.ts`'s isNative() and this file's own Haptics.* calls are under test control.
// isNativePlatform's return value is read afresh by isNative() on every call, so one shared mock
// can flip web/native per test without re-importing the module under test.
const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));

const impact = vi.fn(async (_opts?: unknown) => {});
const notification = vi.fn(async (_opts?: unknown) => {});
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (opts: unknown) => impact(opts),
    notification: (opts: unknown) => notification(opts),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

const { tap, success, warning, restOver } = await import('./haptics');

describe('haptics', () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    impact.mockClear();
    notification.mockClear();
    vibrate = vi.fn();
    // navigator is a getter in this environment (Node's global), but the object it returns is a
    // plain mutable object — assigning straight onto it works and needs no defineProperty games.
    (navigator as unknown as { vibrate: typeof vibrate }).vibrate = vibrate;
  });

  it('on the web, falls back to navigator.vibrate with a short pattern per call', async () => {
    await tap();
    expect(vibrate).toHaveBeenCalledWith(15);
    await success();
    expect(vibrate).toHaveBeenCalledWith([20, 60, 30]);
    await warning();
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30, 40, 30]);
    await restOver();
    expect(vibrate).toHaveBeenCalledWith([250, 120, 250, 120, 400]);

    expect(impact).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });

  it('on native, calls the Capacitor Haptics plugin instead of navigator.vibrate', async () => {
    isNativePlatform.mockReturnValue(true);

    await tap();
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    await restOver();
    expect(impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
    await success();
    expect(notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    await warning();
    expect(notification).toHaveBeenCalledWith({ type: 'WARNING' });

    expect(vibrate).not.toHaveBeenCalled();
  });

  it('never throws even when the native plugin rejects', async () => {
    isNativePlatform.mockReturnValue(true);
    impact.mockRejectedValueOnce(new Error('no motor'));
    notification.mockRejectedValueOnce(new Error('no motor'));

    await expect(tap()).resolves.toBeUndefined();
    await expect(warning()).resolves.toBeUndefined();
  });

  it('never throws even when navigator.vibrate itself throws', async () => {
    vibrate.mockImplementation(() => {
      throw new Error('denied');
    });

    await expect(tap()).resolves.toBeUndefined();
    await expect(success()).resolves.toBeUndefined();
  });

  it('is silent (no throw) when the browser has no vibrate API at all', async () => {
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;

    await expect(tap()).resolves.toBeUndefined();
  });
});
