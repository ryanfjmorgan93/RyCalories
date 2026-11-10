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

/**
 * What a read meal put on the day, food by food, and the three things the owner can do about it:
 * keep it, take it back, or open the meal and correct the amounts. It stays until one is tapped
 * (it used to go after eight seconds, before the list could be read: the owner asked for a check
 * on what Claude read, November 2026). The food is already on the day, so closing the app keeps it.
 * Like the toasts it sits above the bottom bar. The Food screen mounts it, so leaving the screen
 * dismisses it (the meal stays, and each of its foods is one tap from being changed on the day).
 */
export function LoggedBar({ log, onUndo, onAdjust, onDone }: { log: ReadLogged; onUndo: () => void; onAdjust: () => void; onDone: () => void }) {
  const action = 'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-pill px-3 text-accent active:bg-surface-2';
  return (
    <div className="toast-in bottom-toast pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" data-testid="logged-bar">
      <div className="glass-fixed pointer-events-auto w-full max-w-md rounded-control border px-4 pb-1 pt-3 text-sm text-fg">
        <div className="font-bold" data-testid="logged-bar-text">
          {loggedLine(log.count, log.slot, log.kcal)}
        </div>
        <ul className="mt-1.5 max-h-32 overflow-y-auto text-muted">
          {log.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 py-0.5" data-testid="logged-item">
              <span className="min-w-0 truncate text-fg/85">{item.name}</span>
              <span className="num shrink-0">{item.portion}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-end gap-1 font-bold">
          <button type="button" data-testid="logged-undo" onClick={onUndo} className={action}>
            Undo
          </button>
          <button type="button" data-testid="logged-adjust" onClick={onAdjust} className={action}>
            Adjust
          </button>
          <button type="button" data-testid="logged-keep" onClick={onDone} className="ml-1 inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-fg px-5 text-bg active:brightness-90">
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}
