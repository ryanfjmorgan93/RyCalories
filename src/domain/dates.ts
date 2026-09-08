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
