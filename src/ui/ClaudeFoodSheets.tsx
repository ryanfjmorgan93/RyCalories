import { useEffect, useRef } from 'react';
import { loggedLine } from '@/domain/claudeFood';
import type { ReadLogged } from '@/state/claudeFood';
import { Button } from './components/Button';
import { Sheet } from './components/Sheet';
import { TextInput } from './components/NumberField';
import { useSpeech } from './useSpeech';

/**
 * Claude is reading: one line of what it is doing, and a way out. Closing the sheet any way at all
 * (the button, a pull down, the back gesture) is Cancel, and nothing is logged after it.
 */
export function ReadingSheet({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <Sheet open onClose={onCancel} title={text}>
      <div className="grid gap-4" data-testid="reading-sheet">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        </div>
        <Button size="lg" variant="secondary" full onClick={onCancel} data-testid="reading-cancel">
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * "Describe it": what was eaten, in the owner's own words, typed or spoken (the microphone shows
 * where the phone has one). One button reads it and logs it.
 */
export function DescribeSheet({
  where,
  text,
  onText,
  onSubmit,
  onClose,
}: {
  /** "Dinner · Today": where the food will go. */
  where: string;
  text: string;
  onText: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { available, listening, error, start, stop } = useSpeech();
  const spokenFrom = useRef('');
  // Leaving with the microphone live would keep the recogniser running behind the next screen.
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  const toggleMic = async () => {
    if (listening) {
      await stop();
      return;
    }
    spokenFrom.current = text.trim();
    await start((heard) => onText(spokenFrom.current ? `${spokenFrom.current} ${heard}` : heard));
  };

  const ready = text.trim().length > 0;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Describe your meal"
      footer={
        <Button
          size="lg"
          variant="primary"
          full
          disabled={!ready}
          onClick={() => {
            if (listening) void stop();
            onSubmit();
          }}
          data-testid="describe-log"
        >
          Log it
        </Button>
      }
    >
      <div className="grid gap-3" data-testid="describe-sheet">
        <div className="px-1 text-xs text-muted" data-testid="describe-where">
          {where}
        </div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <TextInput value={text} onChange={onText} placeholder={listening ? 'Listening…' : 'Two eggs on toast and a coffee'} multiline testId="describe-input" autoFocus />
          </div>
          {available && (
            <button
              type="button"
              aria-label={listening ? 'Stop listening' : 'Speak'}
              aria-pressed={listening}
              onClick={() => void toggleMic()}
              data-testid="describe-mic"
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${listening ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-2 text-fg'}`}
            >
              <MicIcon active={listening} />
            </button>
          )}
        </div>
        {error && (
          <div className="px-1 text-sm text-danger" role="alert" data-testid="describe-mic-error">
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** How long the bar waits for a tap before going: long enough to read and to reach. */
const BAR_MS = 8000;

/**
 * What a read meal did, and the two things the owner can do about it: take it back, or open the
 * meal and correct the amounts. Like the toasts it sits above the bottom bar; unlike them it has two
 * buttons, so it is its own element. The Food screen mounts it, so leaving the screen dismisses it
 * (the meal stays, and the Food screen's meal row is one tap from Adjust).
 */
export function LoggedBar({ log, onUndo, onAdjust, onDone }: { log: ReadLogged; onUndo: () => void; onAdjust: () => void; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), BAR_MS);
    return () => window.clearTimeout(id);
  }, [log]);

  return (
    <div className="toast-in bottom-toast pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" data-testid="logged-bar">
      <div className="glass-fixed pointer-events-auto flex max-w-full items-center gap-1 rounded-control border py-0.5 pl-4 pr-1 text-sm font-bold text-fg">
        <span className="min-w-0 py-2" data-testid="logged-bar-text">
          {loggedLine(log.count, log.slot, log.kcal)}
        </span>
        <button type="button" data-testid="logged-undo" onClick={onUndo} className="ml-1 inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-pill px-3 text-accent active:bg-surface-2">
          Undo
        </button>
        <button type="button" data-testid="logged-adjust" onClick={onAdjust} className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-pill px-3 text-accent active:bg-surface-2">
          Adjust
        </button>
      </div>
    </div>
  );
}
