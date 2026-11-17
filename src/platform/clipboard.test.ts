/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { native, read } = vi.hoisted(() => ({ native: { on: false }, read: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }));
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { read } }));

import { canReadClipboard, readClipboard } from './clipboard';

beforeEach(() => {
  native.on = false;
  read.mockReset();
  vi.useRealTimers();
});

describe('readClipboard', () => {
  it('in the APK reads Android\'s clipboard through the plugin, never the WebView\'s', async () => {
    native.on = true;
    const web = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { readText: web }, configurable: true });
    read.mockResolvedValue({ value: 'https://www.sainsburys.co.uk/gol-ui/product/eggs', type: 'text/plain' });
    await expect(readClipboard()).resolves.toBe('https://www.sainsburys.co.uk/gol-ui/product/eggs');
    expect(web).not.toHaveBeenCalled();
    expect(canReadClipboard()).toBe(true);
  });

  it('in a browser reads the web clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve('https://example.com') }, configurable: true });
    await expect(readClipboard()).resolves.toBe('https://example.com');
    expect(read).not.toHaveBeenCalled();
  });

  it('gives up on a read that never answers, so the caller can say how to paste by hand', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { value: { readText: () => new Promise(() => {}) }, configurable: true });
    const pending = expect(readClipboard()).rejects.toThrow('clipboard read timed out');
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
  });
});
