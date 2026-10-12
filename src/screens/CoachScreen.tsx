import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { emptyReasonLines, nothingFact } from '@/domain/coachBuild';
import { fmtKg, fmtRange } from '@/domain/format';
import { aboutMinutes, builtRowKeys, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { useCoach, type AskEntry, type BuildEntry } from '@/state/coach';
import { PasteRoutineSheet } from '@/ui/PasteRoutineSheet';
import { Button } from '@/ui/components/Button';
import { Chip } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { TopBar } from '@/ui/components/TopBar';

/**
 * The coach: one box. Asking for a routine builds one, at once, from the owner's own exercises and
 * the library, with no model involved; so does a change to the routine on screen ("add biceps",
 * "swap the front raise", "make it shorter"); anything else is a free question, which goes to
 * Claude once it is set up. A built routine goes through Review routine, which matches each row to
 * the owner's exercises and saves it. Stop ends what is going on and keeps what is on screen; Clear
 * ends it and empties the screen.
 */
export function CoachScreen() {
  const [params] = useSearchParams();
  const { entries, pending, working, error, send, shuffle, cancel, reset } = useCoach();
  const [text, setText] = useState('');
  // Set by Clear, so a message it cut short is not put back in the box as a Stop would put it.
  const cleared = useRef(false);
  // The routine under review: its text, and which exercise each of its rows is (the builder's own, not a guess from the name).
  const [review, setReview] = useState<{ text: string; known: Map<string, string[]> } | null>(null);
  // Routines > New routine > Draft with coach opens here to build: its first message is a build whatever it says.
  const [openingBuild, setOpeningBuild] = useState(params.get('mode') === 'routine');
  const newest = useRef<HTMLDivElement>(null);

  // A new message or reply is brought into view, below the bar: what it adds sits above the box.
  useEffect(() => {
    newest.current?.scrollIntoView({ block: 'start' });
  }, [entries.length, pending?.question]);

  const busy = pending !== null || working !== null;
  const canSend = text.trim() !== '' && !busy;

  const submit = async () => {
    if (!canSend) return;
    const sent = text.trim();
    const build = openingBuild;
    setText('');
    setOpeningBuild(false);
    cleared.current = false;
    const outcome = await send(sent, { build });
    // What was typed goes back in the box when it could not be taken, or was stopped: it is not to be typed again.
    if (outcome === 'error' || (outcome === 'stopped' && !cleared.current)) {
      setText((now) => (now === '' ? sent : now));
      if (build) setOpeningBuild(true);
    }
  };

  const clear = () => {
    cleared.current = true;
    reset();
  };

  const last = entries.length - 1;

  return (
    <div className="pb-6">
      <TopBar
        title="Coach"
        back="/progress"
        right={
          // While it is busy, and when it has an error with nothing else on screen, Clear is still there: it is the way out.
          entries.length > 0 || busy || error ? (
            <Button size="md" variant="ghost" className="mr-1" onClick={clear} data-testid="coach-clear">
              Clear
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 px-4">
        {entries.map((e, i) => (
          <div key={e.id} ref={i === last && !pending ? newest : undefined} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-entry">
            <UserBubble>{e.question}</UserBubble>
            {e.mode === 'ask' ? (
              <AskView entry={e} />
            ) : (
              <BuildView
                entry={e}
                busy={busy}
                onShuffle={() => void shuffle(e.id)}
                onReview={() => setReview({ text: routineToText(e.routines), known: builtRowKeys(e.routines) })}
              />
            )}
          </div>
        ))}

        {pending && (
          <div ref={newest} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-pending">
            <UserBubble>{pending.question}</UserBubble>
            {pending.mode === 'ask' && <Bubble testId="coach-partial">…</Bubble>}
          </div>
        )}

        {error && (
          <div className="text-sm text-danger" data-testid="coach-error">
            {error}
          </div>
        )}

        {busy && (
          <div className="flex justify-end">
            <Button size="md" variant="outline" onClick={cancel} data-testid="coach-stop">
              Stop
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <TextInput multiline value={text} onChange={setText} placeholder="Message" testId="coach-input" />
          </label>
          <Button variant="primary" size="lg" onClick={() => void submit()} disabled={!canSend} data-testid="coach-send">
            {pending ? (pending.mode === 'build' ? 'Building…' : 'Answering…') : 'Send'}
          </Button>
        </div>
      </div>

      <PasteRoutineSheet
        open={review !== null}
        onClose={() => setReview(null)}
        initialText={review?.text}
        preMatched={review?.known}
        title="Review routine"
      />
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

/** A question's answer. */
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
  onReview: () => void;
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
          <Button size="md" variant="outline" onClick={onReview} data-testid="coach-review">
            Review routine
          </Button>
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
  const showWhy = why;
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
      {showWhy && (
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
