import { useState } from 'react';
import { fmtNum } from '@/domain/format';
import { openCoach } from '@/state/coachSheet';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import type { WeeklyReviewView } from '@/ui/useWeeklyReview';

/** A review longer than this is shown cut off, with a way to read the rest. */
const LONG_REVIEW_CHARS = 360;

/**
 * The coach's weekly review on Home: what the past week held, in the coach's words. If it proposes a
 * target the card offers it as a button ("Use 2,400 kcal"), accepting saves it and the card says
 * what changed. "Not now" puts the card away for the week; "Reply" opens the conversation, since
 * the review usually ends with a question.
 */
export function WeeklyReviewCard({ review }: { review: WeeklyReviewView }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { message, offers, applied } = review;
  const long = message.text.length > LONG_REVIEW_CHARS;
  const hasOffers = offers.calories !== undefined || offers.protein !== undefined;

  const use = async (what: 'calories' | 'protein') => {
    if (busy) return;
    setBusy(true);
    try {
      await review.use(what);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3 p-4" data-testid="weekly-review">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Your week</h2>
      </div>
      <p className={`mt-2 whitespace-pre-line text-[15px] leading-snug ${long && !expanded ? 'line-clamp-6' : ''}`} data-testid="weekly-review-text">
        {message.text}
      </p>
      {long && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 min-h-11 text-sm font-semibold text-accent" data-testid="weekly-review-more">
          {expanded ? 'Show less' : 'Read it all'}
        </button>
      )}

      {applied.map((line) => (
        <div key={line} className="mt-3 rounded-control border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok" data-testid="weekly-review-applied">
          {line}
        </div>
      ))}

      {hasOffers && (
        <div className="mt-3 flex flex-wrap gap-2">
          {offers.calories !== undefined && (
            <Button variant="primary" disabled={busy} onClick={() => void use('calories')} data-testid="review-use-calories">
              Use {fmtNum(offers.calories)} kcal
            </Button>
          )}
          {offers.protein !== undefined && (
            <Button variant="primary" disabled={busy} onClick={() => void use('protein')} data-testid="review-use-protein">
              Use {fmtNum(offers.protein)} g protein
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-1">
        <Button size="sm" variant="ghost" className="text-accent" onClick={() => openCoach()} data-testid="review-reply">
          Reply
        </Button>
        <Button size="sm" variant="ghost" onClick={review.dismiss} data-testid="review-dismiss">
          {hasOffers ? 'Not now' : 'Done'}
        </Button>
      </div>
    </Card>
  );
}
