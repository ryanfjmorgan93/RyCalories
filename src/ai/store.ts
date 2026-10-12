/**
 * The only door to localStorage for everything in `src/ai/`. Every access is wrapped: the accessor
 * itself can throw (private windows, blocked site data, a WebView without storage), and a Claude
 * feature failing to read its own settings must never take a screen down with it.
 *
 * Non-secret values (the spend ledger, the cap, the debounce marks) keep an in-memory copy so that
 * if storage is unavailable they still hold for the life of the page. The API key never does: it
 * lives in localStorage and nowhere else (see key.ts), so with storage blocked there is no key and
 * Claude is simply off.
 */

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function lsGet(key: string, opts: { memory?: boolean } = {}): string | null {
  const useMemory = opts.memory ?? true;
  try {
    const s = storage();
    if (s) return s.getItem(key);
  } catch {
    // fall through to the in-memory copy
  }
  return useMemory ? (memory.get(key) ?? null) : null;
}

export function lsSet(key: string, value: string, opts: { memory?: boolean } = {}): boolean {
  const useMemory = opts.memory ?? true;
  if (useMemory) memory.set(key, value);
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function lsRemove(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing to do
  }
}

/** Read a JSON value, or `null` for anything missing, malformed or of the wrong shape. */
export function lsGetJson<T>(key: string, check: (v: unknown) => v is T): T | null {
  const raw = lsGet(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return check(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Forget the in-memory copies. For tests. */
export function resetMemory(): void {
  memory.clear();
}
