/**
 * Whether a session that is still open has been open for too long to be a workout in progress.
 * A session someone forgot to finish keeps a running clock on the dock for days; past this age the
 * app says so plainly and offers to finish or discard it. Pure — the caller supplies `now`.
 */

export const STALE_SESSION_HOURS = 8;

const HOUR_MS = 3_600_000;

/**
 * Milliseconds from `startedAt` (an ISO timestamp) to `now`. NaN when `startedAt` is not a date.
 * Not clamped: a start time ahead of the clock reads as a negative age, never as zero.
 */
export function sessionAgeMs(startedAt: string, now: number): number {
  return now - Date.parse(startedAt);
}

/** True once the session has been open for at least `hours`. False for an unreadable start time. */
export function isStaleSession(startedAt: string, now: number, hours = STALE_SESSION_HOURS): boolean {
  return sessionAgeMs(startedAt, now) >= hours * HOUR_MS;
}

/** "Started 9 h ago" — whole hours, rounded down, so it never claims longer than it has been. */
export function startedHoursAgoLabel(startedAt: string, now: number): string {
  return `Started ${Math.floor(sessionAgeMs(startedAt, now) / HOUR_MS)} h ago`;
}
