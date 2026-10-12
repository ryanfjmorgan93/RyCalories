/**
 * The app's own count of what Claude has cost this month, and the cap that pauses it.
 *
 * Counted from each response's `usage` times the price table (prices.ts), kept in localStorage:
 * `iron.claudeSpend` is `{month: 'YYYY-MM', usd}` and `iron.claudeCap` the monthly limit in dollars
 * (default 15). A new calendar month starts the ledger again from nothing, with no job to run: the
 * stored month simply no longer matches. The owner is also told to set the same limit on the
 * workspace in the Claude Console, which is the real backstop; this one stops the app asking.
 */
import { toDateKey } from '@/domain/dates';
import { costUsd, type UsageLike } from './prices';
import { lsGet, lsGetJson, lsSet } from './store';

export const SPEND_STORAGE = 'iron.claudeSpend';
export const CAP_STORAGE = 'iron.claudeCap';
const NOTICE_STORAGE = 'iron.claudeCapNotice';

export const DEFAULT_CAP_USD = 15;
/** The warning shows from this fraction of the cap. */
export const NEAR_CAP_FRACTION = 0.8;

interface Ledger {
  month: string;
  usd: number;
}

function isLedger(v: unknown): v is Ledger {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Ledger).month === 'string' &&
    typeof (v as Ledger).usd === 'number' &&
    Number.isFinite((v as Ledger).usd) &&
    (v as Ledger).usd >= 0
  );
}

/** 'YYYY-MM' of the local calendar month. */
export function monthKey(d: Date = new Date()): string {
  return toDateKey(d).slice(0, 7);
}

function readLedger(now: Date): Ledger {
  const month = monthKey(now);
  const stored = lsGetJson(SPEND_STORAGE, isLedger);
  return stored && stored.month === month ? stored : { month, usd: 0 };
}

/** Dollars spent this calendar month. Zero on the 1st, whatever the ledger last said. */
export function spendThisMonth(now: Date = new Date()): number {
  return readLedger(now).usd;
}

/**
 * Add a response to this month's ledger, and return what it cost. A response with no usable `usage`
 * costs nothing here; one from an unknown model is priced as Sonnet (see prices.ts).
 */
export function recordUsage(model: string, usage: UsageLike | null | undefined, now: Date = new Date()): number {
  if (!usage) return 0;
  const cost = costUsd(model, usage);
  if (!(cost > 0)) return 0;
  const ledger = readLedger(now);
  // Rounded to a millionth of a dollar so that thousands of small additions do not drift.
  const usd = Math.round((ledger.usd + cost) * 1e6) / 1e6;
  lsSet(SPEND_STORAGE, JSON.stringify({ month: ledger.month, usd }));
  changed();
  return cost;
}

// ---------------------------------------------------------------------------
// Change notifications, so a screen showing the spend (Settings) stays current while the coach works.

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Call `listener` after every recorded response and every change of the cap. Returns the unsubscribe. */
export function subscribeSpend(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The monthly cap in dollars. */
export function capUsd(): number {
  const raw = lsGet(CAP_STORAGE);
  if (raw === null) return DEFAULT_CAP_USD;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CAP_USD;
}

/** Set the cap. Negative or non-numeric input is ignored; zero is allowed and pauses Claude. Returns the cap now in force. */
export function setCap(usd: number): number {
  if (Number.isFinite(usd) && usd >= 0) {
    lsSet(CAP_STORAGE, String(Math.round(usd * 100) / 100));
    changed();
  }
  return capUsd();
}

/** Whether another call may be made: this month's spend is still under the cap. */
export function canSpend(now: Date = new Date()): boolean {
  return spendThisMonth(now) < capUsd();
}

/** Whether the owner is at or past 80 % of the cap. A cap of zero is never "near": it is simply over. */
export function nearCap(now: Date = new Date()): boolean {
  const cap = capUsd();
  return cap > 0 && spendThisMonth(now) >= cap * NEAR_CAP_FRACTION;
}

export interface SpendSummary {
  month: string;
  usd: number;
  cap: number;
  /** usd / cap, 0 when the cap is zero. May exceed 1. */
  fraction: number;
  near: boolean;
  over: boolean;
}

export function spendSummary(now: Date = new Date()): SpendSummary {
  const usd = spendThisMonth(now);
  const cap = capUsd();
  return { month: monthKey(now), usd, cap, fraction: cap > 0 ? usd / cap : 0, near: nearCap(now), over: !canSpend(now) };
}

let snapshot: SpendSummary | null = null;

/**
 * `spendSummary`, but the same object for as long as nothing in it has changed: what React's
 * `useSyncExternalStore` needs as a snapshot. Reads the ledger afresh each time, so a new month
 * shows even though nothing was recorded to announce it.
 */
export function spendSnapshot(now: Date = new Date()): SpendSummary {
  const next = spendSummary(now);
  if (snapshot && snapshot.month === next.month && snapshot.usd === next.usd && snapshot.cap === next.cap) return snapshot;
  snapshot = next;
  return next;
}

/**
 * True the first time it is asked after the cap is reached in a given month, and false after: "Claude
 * pauses until the 1st and says so once". The mark is per month, so next month's pause says it again.
 */
export function takeOverCapNotice(now: Date = new Date()): boolean {
  if (canSpend(now)) return false;
  const month = monthKey(now);
  if (lsGet(NOTICE_STORAGE) === month) return false;
  lsSet(NOTICE_STORAGE, month);
  return true;
}
