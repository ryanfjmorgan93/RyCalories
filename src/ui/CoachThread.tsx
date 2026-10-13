import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyReasonLines, nothingFact } from '@/domain/coachBuild';
import { addDays, isoToDateKey, toDateKey } from '@/domain/dates';
import { fmtDayKey, fmtKg, fmtRange } from '@/domain/format';
import { aboutMinutes, type BuiltRoutine } from '@/domain/routineBuilder';
import type { CoachMessage, CoachMoment } from '@/domain/types';
import { useCoachMessages } from '@/state/claudeCoach';
import type { AskEntry, BuildEntry, CoachEntry } from '@/state/coach';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { Chip } from './components/Chip';
import { CoachOfferCard } from './CoachOfferCard';
import { CheckIcon } from './components/TopBar';
import type { CoachConversation } from './useCoachConversation';

const MOMENT_LABEL: Record<CoachMoment, string> = {
  open: 'On opening',
  set: 'After a set',
  exercise: 'After an exercise',
  session: 'After your session',
  meal: 'After a meal',
  day: 'End of day',
  week: 'Weekly review',
};

type Row =
  | { key: string; kind: 'day'; label: string }
  | { key: string; kind: 'claude'; message: CoachMessage }
  | { key: string; kind: 'rules'; entry: CoachEntry };

/**
 * The conversation, oldest first: what Claude and the owner said (stored, so it is here after a
 * restart), and the routines the rules coach built when Claude could not be asked (held in memory,
 * placed by the time they were made). Day labels sit between days. A routine from Claude is a draft
 * card with Save; one from the rules is a routine with Why, Shuffle and Review. Both end in
 * `onReview`, the same review the rest of the app uses; nothing is saved here.
 */
export function CoachThread({ c, onReview }: { c: CoachConversation; onReview?: (routines: BuiltRoutine[]) => void }) {
  const messages = useCoachMessages();
  const { entries, pending, cancel, shuffle } = c.rules;
  const { draft, dismissDraft, busy: claudeBusy } = c.claude;
  const endRef = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);

  const today = toDateKey();
  const yesterday = addDays(today, -1);
  const rows = useMemo(() => {
    const items: { at: string; row: Row }[] = [
      ...(messages ?? []).map((m): { at: string; row: Row } => ({ at: m.at, row: { key: m.id, kind: 'claude', message: m } })),
      ...entries.map((e): { at: string; row: Row } => ({ at: e.at, row: { key: `rules-${e.id}`, kind: 'rules', entry: e } })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const out: Row[] = [];
    let lastDay = '';
    for (const { at, row } of items) {
      const day = isoToDateKey(at);
      if (day !== lastDay) {
        out.push({ key: `day-${day}`, kind: 'day', label: fmtDayKey(day, today, yesterday) });
        lastDay = day;
      }
      out.push(row);
    }
    return out;
  }, [messages, entries, today, yesterday]);

  // What was added last is brought into view: a routine from its top (it is long, and what matters
  // is the start), anything else from its end.
  const last = rows[rows.length - 1];
  const lastIsRoutine = last?.kind === 'rules' && !pending;
  useEffect(() => {
    if (lastIsRoutine) newest.current?.scrollIntoView?.({ block: 'start' });
    else endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [rows.length, lastIsRoutine, claudeBusy, draft, pending?.question]);

  const empty = messages !== undefined && rows.length === 0 && !claudeBusy && !pending;
  const busy = c.rulesBusy;

  return (
    <div className="flex min-h-[40dvh] flex-col gap-3 pb-2" data-testid="coach-thread">
      {empty && <div className="py-10 text-center text-sm text-muted">Ask about training or food, or tell the coach what you ate.</div>}
      {rows.map((row, i) => {
        if (row.kind === 'day') {
          return (
            <div key={row.key} className="py-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-dim">
              {row.label}
            </div>
          );
        }
        if (row.kind === 'claude') return <ClaudeBubble key={row.key} message={row.message} />;
        const { entry } = row;
        return (
          <div key={row.key} ref={i === rows.length - 1 && !pending ? newest : undefined} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-entry">
            <UserBubble>{entry.question}</UserBubble>
            {entry.mode === 'ask' ? (
              <AskView entry={entry} />
            ) : (
              <BuildView entry={entry} busy={c.busy} onShuffle={() => void shuffle(entry.id)} onReview={onReview ? () => onReview(entry.routines) : undefined} />
            )}
          </div>
        );
      })}

      {pending && (
        <div ref={newest} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-pending">
          <UserBubble>{pending.question}</UserBubble>
          {pending.mode === 'ask' && <Bubble testId="coach-partial">…</Bubble>}
        </div>
      )}

      {claudeBusy && (
        <div className="flex items-start" data-testid="coach-busy">
          <div className="animate-pulse rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-muted">Thinking…</div>
        </div>
      )}

      {busy && (
        <div className="flex justify-end">
          <Button size="md" variant="outline" onClick={cancel} data-testid="coach-stop">
            Stop
          </Button>
        </div>
      )}

      {draft && (
        <Card className="p-4" data-testid="coach-draft">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">Draft routine · not saved</div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{draft.text}</pre>
          <div className="mt-3 flex gap-2">
            {onReview && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onReview(draft.routines);
                  dismissDraft();
                }}
                data-testid="coach-draft-save"
              >
                Save
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismissDraft}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}
      <CoachOfferCard />
      <div ref={endRef} className="scroll-mb-32" />
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg">{children}</div>;
}

function Bubble({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="max-w-[92%] self-start whitespace-pre-wrap rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid={testId}>
      {children}
    </div>
  );
}

/** One stored turn: the owner's, or the coach's with a line for each thing it changed. */
function ClaudeBubble({ message }: { message: CoachMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`} data-testid={mine ? 'coach-user-bubble' : 'coach-bubble'}>
      {!mine && message.moment && <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">{MOMENT_LABEL[message.moment]}</div>}
      <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-base leading-snug ${mine ? 'bg-accent text-accent-fg' : 'border border-line bg-surface-2 text-fg'}`}>{message.text}</div>
      {!mine && message.actions && message.actions.length > 0 && (
        <ul className="mt-1.5 max-w-[88%] space-y-0.5 px-1" data-testid="coach-actions">
          {message.actions.map((line, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm text-ok">
              <span className="mt-0.5 shrink-0">
                <CheckIcon size={14} />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A question put to the rules coach, and its answer (only when a backend is plugged into the store). */
function AskView({ entry }: { entry: AskEntry }) {
  return <Bubble testId="coach-answer">{entry.answer}</Bubble>;
}

/** A built routine or routines, what the rules read, and the two things to do with it. */
function BuildView({
  entry,
  busy,
  onShuffle,
  onReview,
}: {
  entry: BuildEntry;
  /** Something is being answered, built or shuffled: what would start another does nothing, and says so by being off. */
  busy: boolean;
  onShuffle: () => void;
  onReview?: () => void;
}) {
  const built = entry.routines.some((r) => r.rows.length > 0);
  return (
    <>
      {entry.routines.map((r, i) => (
        <RoutineBubble key={i} routine={r} />
      ))}
      {entry.edit && (
        <div className="px-1 text-xs text-muted" data-testid="coach-edit">
          {entry.edit}
        </div>
      )}
      <div className="px-1 text-xs text-muted" data-testid="coach-read">
        Read: {entry.read}
      </div>
      {entry.unread.length > 0 && (
        <div className="text-sm text-muted" data-testid="coach-not-read">
          Not read: {entry.unread.join(', ')}
        </div>
      )}
      {built && (
        <div className="flex flex-wrap gap-2">
          <Button size="md" variant="outline" disabled={busy} onClick={onShuffle} data-testid="coach-shuffle">
            Shuffle
          </Button>
          {onReview && (
            <Button size="md" variant="outline" onClick={onReview} data-testid="coach-review">
              Review routine
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** One routine: its rows as they would be saved, how long it takes, and why behind a tap. One with nothing in it says what there was nothing to choose from. */
function RoutineBubble({ routine }: { routine: BuiltRoutine }) {
  const empty = routine.rows.length === 0;
  const [why, setWhy] = useState(false);
  if (empty) {
    return (
      <div className="max-w-[92%] self-start rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid="coach-routine">
        <span className="font-semibold" data-testid="coach-routine-name">
          {routine.name}
        </span>
        <div className="mt-1" data-testid="coach-nothing">
          {nothingFact(routine)}
        </div>
        <div className="mt-1 grid gap-1 text-xs text-muted" data-testid="coach-why-lines">
          {emptyReasonLines(routine).map((line, i) => (
            <div key={`line-${i}`}>{line}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[92%] self-start rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid="coach-routine">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold" data-testid="coach-routine-name">
          {routine.name}
        </span>
        <span className="num shrink-0 text-xs text-muted" data-testid="coach-minutes">
          {aboutMinutes(routine)}
        </span>
      </div>
      {routine.rows.map((row) => (
        <div key={row.id} className="mt-1.5 flex items-start justify-between gap-3" data-testid="coach-row">
          <span className="min-w-0 flex-1">
            <span data-testid="coach-row-name">{row.name}</span>
            {row.origin !== 'own' && (
              <Chip size="sm" tone="info" className="ml-2 align-middle" testId="coach-new">
                New
              </Chip>
            )}
          </span>
          <span className="shrink-0 text-muted">
            <span className="num">
              {row.sets} × {fmtRange(row.repMin, row.repMax)}
            </span>{' '}
            · {row.weightKg === null ? 'no weight yet' : <span className="num">{fmtKg(row.weightKg)}</span>}
          </span>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="-ml-3 mt-1" aria-expanded={why} onClick={() => setWhy(!why)} data-testid="coach-why">
        Why
      </Button>
      {why && (
        <div className="mt-1 grid gap-1 text-xs text-muted" data-testid="coach-why-lines">
          {routine.reasonLines.map((line, i) => (
            <div key={`line-${i}`}>{line}</div>
          ))}
          {routine.rows.map((row) => (
            <div key={`row-${row.id}`}>
              {row.name}: {row.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
