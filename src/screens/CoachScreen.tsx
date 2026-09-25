import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CoachMode } from '@/domain/coach';
import { useCoach } from '@/state/coach';
import { PasteRoutineSheet } from '@/ui/PasteRoutineSheet';
import { Button } from '@/ui/components/Button';
import { Segmented } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { TopBar } from '@/ui/components/TopBar';
import { useNanoDownloadPercent } from '@/ui/useNanoDownload';

const MODES: { value: CoachMode; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'routine', label: 'Build a routine' },
];

/**
 * The coach: a question about the owner's own data, or a routine to draft, answered by the phone's
 * own Gemini Nano (the fuller variant). Answers only what is asked; no greeting, no suggested
 * questions. A drafted routine goes through the same review and save as Paste a routine.
 */
export function CoachScreen() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<CoachMode>(params.get('mode') === 'routine' ? 'routine' : 'ask');
  const { status, entries, pending, error, refreshStatus, ask, download, reset } = useCoach();
  const [question, setQuestion] = useState('');
  const [review, setReview] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  const downloadPercent = useNanoDownloadPercent('full', refreshStatus);

  const busy = pending !== null;
  const ready = status?.state === 'ready';

  const send = () => {
    const q = question.trim();
    if (!q || busy || !ready) return;
    setQuestion('');
    void ask(q, mode);
  };

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
        <Segmented value={mode} onChange={setMode} options={MODES} />

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
          <div key={i} className="flex flex-col gap-1.5" data-testid="coach-entry">
            <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg">{e.question}</div>
            <div className="max-w-[92%] self-start whitespace-pre-wrap rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid="coach-answer">
              {e.answer}
            </div>
            <div className="px-1 text-xs text-muted" data-testid="coach-read">
              Read: {e.label}
            </div>
            {e.mode === 'routine' &&
              (e.hasRoutine ? (
                <Button size="md" variant="outline" className="self-start" onClick={() => setReview(e.answer)} data-testid="coach-review">
                  Review routine
                </Button>
              ) : (
                <div className="px-1 text-sm text-muted">No routine in the answer.</div>
              ))}
          </div>
        ))}

        {pending && (
          <div className="flex flex-col gap-1.5" data-testid="coach-pending">
            <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg">{pending.question}</div>
            <div className="max-w-[92%] self-start whitespace-pre-wrap rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg" data-testid="coach-partial">
              {pending.partial || '…'}
            </div>
            {pending.label && <div className="px-1 text-xs text-muted">Reading: {pending.label}</div>}
          </div>
        )}

        {error && (
          <div className="text-sm text-danger" data-testid="coach-error">
            {error}
          </div>
        )}

        <div className="flex items-end gap-2">
          <TextInput
            multiline
            value={question}
            onChange={setQuestion}
            placeholder={mode === 'routine' ? 'What to build' : 'Question'}
            testId="coach-input"
            className="flex-1"
          />
          <Button variant="primary" size="lg" onClick={send} disabled={busy || !ready || !question.trim()} data-testid="coach-send">
            {busy ? 'Answering…' : 'Send'}
          </Button>
        </div>
      </div>

      <PasteRoutineSheet open={review !== null} onClose={() => setReview(null)} initialText={review ?? undefined} title="Review routine" />
    </div>
  );
}
