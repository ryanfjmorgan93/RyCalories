import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { claudeReady } from '@/ai/client';
import { weeklyReview, type ReviewOptions, type TargetProposal } from '@/ai/moments';
import { getSettings, saveSettings } from '@/db/repo';
import { loadWeekReviewInput, storeReviewMessage, weekReviewMessage } from '@/db/weekReviewQueries';
import { mondayOf } from '@/domain/dates';
import { calorieChange, proteinChange } from '@/domain/targetChange';
import type { CoachMessage, Settings } from '@/domain/types';
import { buildReviewFacts, isMonday } from '@/domain/weekReview';
import { patchWeekReview, readWeekReview } from '@/state/weekReview';
import { toast } from '@/ui/components/Toast';

/**
 * After a failed attempt the review is not asked for again for this long. A failure can come after
 * Claude has done the work (a timeout, a dropped answer), which costs money that the spend ledger
 * never sees, and the review is the biggest request there is. Home asks again whenever it opens, so
 * the wait has to be long enough that opening the app a few times cannot add up to a bill.
 */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

const inflight = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();

/** Forget the attempts made so far. For tests. */
export function resetReviewAttempts(): void {
  inflight.clear();
  failedAt.clear();
}

/**
 * Ask the coach for the week's review, once, and store it. Resolves true when a review was stored.
 * False without asking when Claude cannot be called right now (no key, offline, over the cap), and
 * false after a failed call; a second caller while one is running shares it.
 */
export function generateReview(week: string, today: string, settings: Settings, deps: Pick<ReviewOptions, 'fetch' | 'client' | 'now'> = {}): Promise<boolean> {
  const running = inflight.get(week);
  if (running) return running;
  const failed = failedAt.get(week);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false);
  if (!claudeReady()) return Promise.resolve(false);

  const run = (async () => {
    try {
      const facts = buildReviewFacts(await loadWeekReviewInput(today, settings));
      // Not stored by the call itself: the proposal has to be written down first, so the card never
      // appears without its buttons.
      const review = await weeklyReview(facts, { ...deps, persist: false });
      if (!review.text) throw new Error('empty review');
      if (await weekReviewMessage(week)) return false;
      patchWeekReview(week, { proposal: review.proposal, applied: [], dismissed: false });
      await storeReviewMessage(review.text);
      return true;
    } catch {
      failedAt.set(week, Date.now());
      return false;
    } finally {
      inflight.delete(week);
    }
  })();
  inflight.set(week, run);
  return run;
}

export interface WeeklyReviewView {
  message: CoachMessage;
  /** Changes to offer, left out once they are already the owner's targets. */
  offers: { calories?: number; protein?: number };
  /** What the owner has accepted this week, one sentence each. */
  applied: string[];
  dismiss: () => void;
  use: (what: 'calories' | 'protein') => Promise<void>;
}

/**
 * This week's review for the card on Home, or null when there is none to show.
 *
 * The review is written on the first open of a Monday (nothing is asked for on other days, and not
 * when Claude cannot be called, in which case there is simply no card); once written it shows on
 * every day of the week until the owner dismisses it. A target change it proposes is offered as a
 * button, and accepting one saves it to Settings and records what changed.
 */
export function useWeeklyReview(today: string, settings: Settings | undefined): WeeklyReviewView | null {
  const week = mondayOf(today);
  const [, bump] = useState(0);
  const message = useLiveQuery(() => weekReviewMessage(week), [week]);
  const mark = readWeekReview(week);
  const monday = isMonday(today);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ready = settings !== undefined;

  useEffect(() => {
    // `message === null` is "looked, and there is none"; undefined is still loading.
    if (!ready || message !== null || mark.dismissed || !monday) return;
    let live = true;
    void generateReview(week, today, settingsRef.current!).then((stored) => {
      if (live && stored) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // `mark` is read fresh each render; only its dismissed flag decides whether to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, message === null, mark.dismissed, monday, week, today]);

  if (!message || mark.dismissed || !settings) return null;

  const proposal: TargetProposal = mark.proposal ?? {};
  const offers: WeeklyReviewView['offers'] = {};
  if (proposal.calories !== undefined && calorieChange(settings, proposal.calories, today)) offers.calories = proposal.calories;
  if (proposal.protein !== undefined && proteinChange(settings, proposal.protein)) offers.protein = proposal.protein;

  return {
    message,
    offers,
    applied: mark.applied,
    dismiss: () => {
      patchWeekReview(week, { dismissed: true });
      bump((n) => n + 1);
    },
    use: async (what) => {
      // Against the settings as they are now, not as the card was drawn.
      const current = await getSettings();
      const wanted = what === 'calories' ? proposal.calories : proposal.protein;
      if (wanted === undefined) return;
      const change = what === 'calories' ? calorieChange(current, wanted, today) : proteinChange(current, wanted);
      if (!change) return;
      await saveSettings(change.patch);
      patchWeekReview(week, { applied: [...readWeekReview(week).applied, change.line] });
      bump((n) => n + 1);
      toast(what === 'calories' ? 'Calorie target updated' : 'Protein target updated', 'ok');
    },
  };
}
