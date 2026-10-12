/**
 * The Claude API key. It lives ONLY in `localStorage['iron.claudeKey']`.
 *
 * Never Dexie, never the Settings row, never a backup, a CSV, a log line or an error message: the
 * backup and auto-backup code reads Dexie tables and nothing else, so a key kept out of Dexie
 * cannot leak through them (src/ai/key.test.ts proves it by exporting with a key set). Nothing in
 * this module returns the key to any caller except `getApiKey`, which only client.ts uses.
 */
import { lsGet, lsRemove, lsSet } from './store';

export const KEY_STORAGE = 'iron.claudeKey';

/** The stored key, or null when there is none. */
export function getApiKey(): string | null {
  const raw = lsGet(KEY_STORAGE, { memory: false });
  const key = raw?.trim();
  return key ? key : null;
}

/** Store a key (whitespace and line breaks from a paste are dropped). False when it was empty or storage refused it. */
export function setApiKey(key: string): boolean {
  const clean = key.replace(/\s+/g, '');
  if (!clean) return false;
  return lsSet(KEY_STORAGE, clean, { memory: false });
}

export function clearApiKey(): void {
  lsRemove(KEY_STORAGE);
}

export function hasKey(): boolean {
  return getApiKey() !== null;
}

/**
 * The key for display: "sk-ant-…abcd". The prefix says which kind of key it is without showing any
 * of it. A key too short to mask safely shows dots only.
 */
export function maskKey(key: string | null = getApiKey()): string | null {
  if (!key) return null;
  if (key.length < 12) return '••••';
  const prefix = key.startsWith('sk-ant-') ? 'sk-ant-' : key.slice(0, 3);
  return `${prefix}…${key.slice(-4)}`;
}

/** Strip anything that looks like an Anthropic key from text bound for a log or a message. */
export function redactKeys(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-…');
}
