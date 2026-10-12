/**
 * What Home remembers about this week's review besides the coach message itself: the target change
 * the coach proposed (the message is only its words), the changes the owner has accepted, and
 * whether they dismissed the card. One record, for one week; a new week starts with a clean one.
 *
 * Kept in localStorage (a per-device convenience, like the other small marks in `src/ai/store.ts`):
 * losing it costs the buttons on a review already read, never any data.
 */
import { lsGetJson, lsSet } from '@/ai/store';
import type { TargetProposal } from '@/ai/moments';

export const WEEK_REVIEW_STORAGE = 'iron.weekReview';

export interface WeekReviewMark {
  /** The Monday (YYYY-MM-DD) of the week this is for. */
  week: string;
  proposal?: TargetProposal;
  /** What the owner accepted, one sentence each. */
  applied: string[];
  dismissed: boolean;
}

function isMark(v: unknown): v is WeekReviewMark {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Partial<WeekReviewMark>;
  return typeof m.week === 'string' && Array.isArray(m.applied) && m.applied.every((a) => typeof a === 'string') && typeof m.dismissed === 'boolean';
}

/** The record for the week starting `week`; an empty one when there is none, or it is for another week. */
export function readWeekReview(week: string): WeekReviewMark {
  const stored = lsGetJson(WEEK_REVIEW_STORAGE, isMark);
  return stored && stored.week === week ? stored : { week, applied: [], dismissed: false };
}

/** Change part of the week's record. */
export function patchWeekReview(week: string, patch: Partial<Omit<WeekReviewMark, 'week'>>): WeekReviewMark {
  const next: WeekReviewMark = { ...readWeekReview(week), ...patch, week };
  lsSet(WEEK_REVIEW_STORAGE, JSON.stringify(next));
  return next;
}
