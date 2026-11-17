import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';

/** Longer than this and the read has hung: some WebViews never settle `navigator.clipboard.readText`. */
const READ_TIMEOUT_MS = 3000;

/**
 * What is on the clipboard, as text. In the APK it is Android's own clipboard, through the
 * @capacitor/clipboard plugin: the WebView's `navigator.clipboard.readText` is refused there, or never
 * answers, so a Paste button built on it did nothing (the owner's report, November 2026). In a
 * browser it is the web clipboard. Throws when there is nothing to read or it cannot be read; the
 * caller says how to paste by hand instead.
 */
export async function readClipboard(): Promise<string> {
  const read = Capacitor.isNativePlatform() ? Clipboard.read().then((r) => r.value ?? '') : navigator.clipboard.readText();
  return Promise.race([read, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clipboard read timed out')), READ_TIMEOUT_MS))]);
}

/** Whether a Paste button can work here at all. */
export function canReadClipboard(): boolean {
  return Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');
}
