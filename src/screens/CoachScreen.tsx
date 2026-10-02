import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtKg, fmtRange } from '@/domain/format';
import { aboutMinutes, builtRowKeys, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { routeOf, useCoach, type AskEntry, type BuildEntry } from '@/state/coach';
import { PasteRoutineSheet } from '@/ui/PasteRoutineSheet';
import { Button } from '@/ui/components/Button';
import { Chip } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { TopBar } from '@/ui/components/TopBar';
import { useNanoDownloadPercent } from '@/ui/useNanoDownload';

/**
 * The coach: one box. Asking for a routine builds one, at once, from the owner's own exercises and
 * the library, with no model involved; anything else is a question for the phone's own Gemini Nano
 * (the fuller variant), which reads the conversation, the routine just built and why, and the
 * owner's data. Answers only what is asked; no greeting, no suggested questions. A built routine goes
 * through the same review and save as Paste a routine.
 */
export function CoachScreen() {
  const [params] = useSearchParams();
  const { status, entries, pending, working, error, refreshStatus, send, shuffle, readWithAssistant, download, reset } = useCoach();
  const [text, setText] = useState('');
  // The routine under review: its text, and which exercise each of its rows is (the builder's own, not a guess from the name).
  const [review, setReview] = useState<{ text: string; known: Map<string, string[]> } | null>(null);
  // Routines > New routine > Draft with coach opens here to build: its first message is a build whatever it says.
  const [openingBuild, setOpeningBuild] = useState(params.get('mode') === 'routine');
  const newest = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  const downloadPercent = useNanoDownloadPercent('full', refreshStatus);

  // A new message or reply is brought into view, below the bar: what it adds sits above the box.
  useEffect(() => {
    newest.current?.scrollIntoView({ block: 'start' });
  }, [entries.length, pending?.question]);

  const busy = pending !== null || working !== null;
  const ready = status?.state === 'ready';
  const message = text.trim();
  // A build needs no model; a question does.
  const route = message ? routeOf(message, entries, openingBuild) : null;
  const canSend = message !== '' && !busy && (route === 'build' || ready);

  const submit = () => {
    if (!canSend) return;
    setText('');
    const build = openingBuild;
    setOpeningBuild(false);
    void send(message, { build });
  };

  const last = entries.length - 1;

  return (
    <div className="pb-6">
      <TopBar
        title="Coach"
        back="/progress"
        right={
          entries.length > 0 && !busy ? (
            <Button size="md" variant="ghost" className="mr-1" onClick={reset} data-testid="coach-clear">
              Clear
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 px-4">
        {status && !ready && (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-3" data-testid="coach-status">
            <div className="text-sm text-muted">
              {status.state === 'unavailable' ? 'On-device model unavailable.' : downloadPercent !== null ? `Downloading ${downloadPercent} %` : 'Model not downloaded.'}
            </div>
            <div className="num mt-1 text-xs text-dim">{status.detail}</div>
            {status.state !== 'unavailable' && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={status.state === 'downloading' || downloadPercent !== null}
                onClick={() => void download()}
                data-testid="coach-download"
              >
                {status.state === 'downloading' || downloadPercent !== null ? 'Downloading…' : 'Download'}
              </Button>
            )}
          </div>
        )}

        {entries.map((e, i) => (
          <div key={e.id} ref={i === last && !pending ? newest : undefined} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-entry">
            <UserBubble>{e.question}</UserBubble>
            {e.mode === 'ask' ? (
              <AskView entry={e} />
            ) : (
              <BuildView
                entry={e}
                working={working}
                onShuffle={() => void shuffle(e.id)}
                onReview={() => setReview({ text: routineToText(e.routines), known: builtRowKeys(e.routines) })}
                onAssist={() => void readWithAssistant(e.id)}
              />
            )}
          </div>
        ))}

        {pending && (
          <div ref={newest} className="flex scroll-mt-20 flex-col gap-1.5" data-testid="coach-pending">
            <UserBubble>{pending.question}</UserBubble>
            {pending.mode === 'ask' && (
              <>
                <Bubble testId="coach-partial">{pending.partial || '…'}</Bubble>
                {pending.label && <div className="px-1 text-xs text-muted">Reading: {pending.label}</div>}
              </>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm text-danger" data-testid="coach-error">
            {error}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <TextInput multiline value={text} onChange={setText} placeholder="Message" testId="coach-input" />
          </label>
          <Button variant="primary" size="lg" onClick={submit} disabled={!canSend} data-testid="coach-send">
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

/** A question's answer, and what the model was given to read. */
function AskView({ entry }: { entry: AskEntry }) {
  return (
    <>
      <Bubble testId="coach-answer">{entry.answer}</Bubble>
      <div className="px-1 text-xs text-muted" data-testid="coach-read">
        Read: {entry.label}
      </div>
    </>
  );
}

/** A built routine or routines, what the rules read, and the three things to do with it. */
function BuildView({
  entry,
  working,
  onShuffle,
  onReview,
  onAssist,
}: {
  entry: BuildEntry;
  working: number | null;
  onShuffle: () => void;
  onReview: () => void;
  onAssist: () => void;
}) {
  const built = entry.routines.some((r) => r.rows.length > 0);
  return (
    <>
      {entry.routines.map((r, i) => (
        <RoutineBubble key={i} routine={r} />
      ))}
      <div className="px-1 text-xs text-muted" data-testid="coach-read">
        {entry.by === 'assistant' ? 'Read with assistant' : 'Read'}: {entry.read}
      </div>
      {entry.unread.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className={`text-sm ${entry.assist?.kind === 'error' ? 'font-semibold text-warn' : 'text-muted'}`} data-testid="coach-not-read">
            {entry.assist?.kind === 'error' ? entry.assist.message : entry.assist?.kind === 'nothing' ? 'Nothing more read' : `Not read: ${entry.unread.join(', ')}`}
          </div>
          {entry.assist?.kind !== 'nothing' && (
            <Button size="sm" variant="ghost" disabled={working !== null} onClick={onAssist} data-testid="coach-read-assistant">
              {working === entry.id ? 'Reading…' : 'Read with assistant'}
            </Button>
          )}
        </div>
      )}
      {built && (
        <div className="flex flex-wrap gap-2">
          <Button size="md" variant="outline" disabled={working !== null} onClick={onShuffle} data-testid="coach-shuffle">
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

/** One routine: its rows as they would be saved, how long it takes, and why behind a tap. */
function RoutineBubble({ routine }: { routine: BuiltRoutine }) {
  const empty = routine.rows.length === 0;
  const [why, setWhy] = useState(false);
  // A routine with nothing in it has only its reasons to say why: they are not behind a tap.
  const showWhy = empty || why;
  return (
    <div className="max-w-[92%] self-start rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid="coach-routine">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold" data-testid="coach-routine-name">
          {routine.name}
        </span>
        {!empty && (
          <span className="num shrink-0 text-xs text-muted" data-testid="coach-minutes">
            {aboutMinutes(routine)}
          </span>
        )}
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
      {!empty && (
        <Button size="sm" variant="ghost" className="-ml-3 mt-1" aria-expanded={why} onClick={() => setWhy(!why)} data-testid="coach-why">
          Why
        </Button>
      )}
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
