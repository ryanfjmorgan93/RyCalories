import { Share } from '@capacitor/share';
import { isNative } from '@/state/native';

/**
 * Copies `text` to the clipboard. Tries the Clipboard API first, then falls back to the legacy
 * selection-and-execCommand method — the Android WebView this app actually ships in can have
 * `navigator.clipboard` missing or rejecting even though a copy is otherwise possible there.
 * Returns whether a copy actually happened; never claims success it didn't get.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy method below.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Whether this shell can hand plain text to another app: always on the APK, sometimes on the web. */
export function canShareText(): boolean {
  if (isNative()) return true;
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Hands `text` to the Android share sheet (or the browser's), for the owner to pick an app — the
 * Claude app, a note, a message. Nothing is sent anywhere by Iron itself.
 */
export async function shareText(text: string, title: string): Promise<'shared' | 'cancelled' | 'unavailable'> {
  try {
    if (isNative()) {
      await Share.share({ title, text, dialogTitle: title });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title, text });
      return 'shared';
    }
    return 'unavailable';
  } catch {
    return 'cancelled';
  }
}
