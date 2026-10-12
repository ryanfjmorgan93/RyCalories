export function nowIso(): string {
  return new Date().toISOString();
}

/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoToDateKey(iso: string): string {
  return toDateKey(new Date(iso));
}

/** Parse a YYYY-MM-DD key as local midnight. */
export function dateKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, days: number): string {
  const d = dateKeyToDate(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ms = dateKeyToDate(b).getTime() - dateKeyToDate(a).getTime();
  return Math.round(ms / 86400000);
}

export function isSameLocalDay(isoA: string, isoB: string): boolean {
  return isoToDateKey(isoA) === isoToDateKey(isoB);
}

/** Monday (YYYY-MM-DD) of the local week containing `key`. Weeks run Monday to Sunday everywhere in the app. */
export function mondayOf(key: string): string {
  const dow = dateKeyToDate(key).getDay(); // 0 = Sunday .. 6 = Saturday
  return addDays(key, -(dow === 0 ? 6 : dow - 1));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep" or "8 Sep 2026" from a YYYY-MM-DD key. Deterministic (no locale/timezone). */
export function fmtDateKey(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? '';
  return withYear ? `${d} ${month} ${y}` : `${d} ${month}`;
}

/** Inclusive window start for `days` days ending on `asOf`. */
export function windowStart(asOf: string, days: number): string {
  return addDays(asOf, -(Math.max(1, days) - 1));
}

/** Whether a date (or an ISO timestamp) falls in the `days`-day window ending on `asOf`, inclusive. */
export function inWindow(date: string, asOf: string, days: number): boolean {
  const key = date.slice(0, 10);
  return key >= windowStart(asOf, days) && key <= asOf;
}
