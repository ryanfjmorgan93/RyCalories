import { useEffect, useState } from 'react';
import { claudeReady } from '@/ai/client';
import { hashFacts, momentLine, type Moment, type MomentFacts } from '@/ai/moments';
import { openCoach } from '@/state/coachSheet';

/** Answers already received in this run of the app, by moment and facts ('' when the coach chose
 * to say nothing): coming back to a screen shows the same line instead of paying for a new one. */
const asked = new Map<string, string>();
/** Requests in flight, shared so a remount (or StrictMode's double effect) waits on the same call. */
const pending = new Map<string, Promise<string | null>>();

function ask(key: string, moment: Moment, facts: MomentFacts): Promise<string | null> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  // A call that cannot happen (no key, no signal, the cap) also comes back null; only a null from
  // a call that could happen is the coach choosing to say nothing, and only that is remembered.
  const couldAsk = claudeReady();
  const call = momentLine(moment, facts)
    .then((text) => {
      if (text || couldAsk) asked.set(key, text ?? '');
      return text;
    })
    .finally(() => pending.delete(key));
  pending.set(key, call);
  return call;
}

/**
 * What the coach says at one moment, or nothing. The line is asked for once per distinct set of
 * facts (the caller builds them, memoised or not: they are compared by content), and the space it
 * takes appears only when a line arrives, so a quiet coach, no key, no signal or a reached spend
 * cap all look the same: no line. Tapping the line opens the conversation.
 *
 * `ask: false` holds the request (e.g. until a set is logged); `onLine` lets a caller react to the
 * line arriving.
 */
export function CoachLine({
  moment,
  facts,
  ask: shouldAsk = true,
  className = '',
  testId = `coach-line-${moment}`,
  onLine,
}: {
  moment: Moment;
  facts: MomentFacts;
  ask?: boolean;
  className?: string;
  testId?: string;
  onLine?: (line: string) => void;
}) {
  const key = `${moment}:${hashFacts(facts)}`;
  const [line, setLine] = useState<{ key: string; text: string } | null>(() => {
    const text = asked.get(key);
    return text ? { key, text } : null;
  });

  useEffect(() => {
    if (!shouldAsk) return;
    const known = asked.get(key);
    if (known !== undefined) {
      if (known) setLine({ key, text: known });
      return;
    }
    let live = true;
    void ask(key, moment, facts).then((text) => {
      if (!live || !text) return;
      setLine({ key, text });
      onLine?.(text);
    });
    return () => {
      live = false;
    };
    // `facts` is compared by content through `key`; `onLine` is a callback, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, key, shouldAsk]);

  if (!line || line.key !== key) return null;
  return (
    <button type="button" data-testid={testId} onClick={() => openCoach()} className={`flex w-full items-start gap-3 rounded-control border border-line bg-surface-2 px-4 py-3 text-left ${className}`}>
      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 flex-1 text-[15px] leading-snug text-fg">{line.text}</span>
    </button>
  );
}
