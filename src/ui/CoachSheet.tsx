import { useEffect, useMemo, useRef, useState } from 'react';
import { toDateKey, addDays, isoToDateKey } from '@/domain/dates';
import { fmtDayKey } from '@/domain/format';
import type { BuiltRoutine } from '@/domain/routineBuilder';
import type { CoachMessage, CoachMoment } from '@/domain/types';
import { useClaudeCoach, useCoachMessages } from '@/state/claudeCoach';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { Sheet } from './components/Sheet';
import { CheckIcon } from './components/TopBar';
import { TextInput } from './components/NumberField';
import { useSpeech } from './useSpeech';

const MOMENT_LABEL: Record<CoachMoment, string> = {
  open: 'On opening',
  set: 'After a set',
  exercise: 'After an exercise',
  session: 'After your session',
  meal: 'After a meal',
  day: 'End of day',
  week: 'Weekly review',
};

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function Bubble({ message }: { message: CoachMessage }) {
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

/**
 * The coach, as a bottom sheet: the thread, a text box with Send, and a microphone where the phone
 * has one. The coach's replies carry a line for each thing it changed. A routine it drafted is
 * offered with Save when the caller passes `onSaveDraft`; saving is the caller's, because turning a
 * draft into routines is the same review the rest of the app uses, and nothing is saved here.
 */
export function CoachSheet({ open, onClose, onSaveDraft }: { open: boolean; onClose: () => void; onSaveDraft?: (routines: BuiltRoutine[]) => void }) {
  const messages = useCoachMessages();
  const busy = useClaudeCoach((s) => s.busy);
  const lastError = useClaudeCoach((s) => s.lastError);
  const draft = useClaudeCoach((s) => s.draft);
  const send = useClaudeCoach((s) => s.send);
  const clearError = useClaudeCoach((s) => s.clearError);
  const dismissDraft = useClaudeCoach((s) => s.dismissDraft);
  const { available: micAvailable, listening, error: micError, start: startMic, stop: stopMic } = useSpeech();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const spokenFrom = useRef('');

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [open, messages?.length, busy, draft]);

  useEffect(() => {
    if (!open && listening) void stopMic();
  }, [open, listening, stopMic]);

  const today = toDateKey();
  const yesterday = addDays(today, -1);
  const rows = useMemo(() => {
    const out: { key: string; day?: string; message?: CoachMessage }[] = [];
    let lastDay = '';
    for (const m of messages ?? []) {
      const day = isoToDateKey(m.at);
      if (day !== lastDay) {
        out.push({ key: `day-${day}`, day: fmtDayKey(day, today, yesterday) });
        lastDay = day;
      }
      out.push({ key: m.id, message: m });
    }
    return out;
  }, [messages, today, yesterday]);

  const submit = async () => {
    const message = text.trim();
    if (!message || busy) return;
    if (listening) await stopMic();
    setText('');
    const reply = await send(message);
    // Nothing was sent (no key, over the limit, offline before the call): keep what was typed.
    if (reply && !reply.stored) setText(message);
  };

  const toggleMic = async () => {
    if (listening) {
      await stopMic();
      return;
    }
    spokenFrom.current = text.trim();
    await startMic((heard) => setText(spokenFrom.current ? `${spokenFrom.current} ${heard}` : heard));
  };

  const problem = lastError ?? micError;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Coach"
      footer={
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="min-w-0 flex-1">
            <TextInput value={text} onChange={setText} placeholder={listening ? 'Listening…' : 'Ask or tell the coach'} testId="coach-input" />
          </div>
          {micAvailable && (
            <button
              type="button"
              aria-label={listening ? 'Stop listening' : 'Speak'}
              aria-pressed={listening}
              onClick={() => void toggleMic()}
              data-testid="coach-mic"
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${listening ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-2 text-fg'}`}
            >
              <MicIcon active={listening} />
            </button>
          )}
          <Button type="submit" variant="primary" size="md" disabled={busy || !text.trim()} data-testid="coach-send">
            Send
          </Button>
        </form>
      }
    >
      <div className="flex min-h-[40dvh] flex-col gap-3 pb-2" data-testid="coach-thread">
        {messages !== undefined && rows.length === 0 && !busy && <div className="py-10 text-center text-sm text-muted">Ask about training or food, or tell the coach what you ate.</div>}
        {rows.map((row) =>
          row.message ? (
            <Bubble key={row.key} message={row.message} />
          ) : (
            <div key={row.key} className="py-1 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-dim">
              {row.day}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-start" data-testid="coach-busy">
            <div className="animate-pulse rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-muted">Thinking…</div>
          </div>
        )}
        {draft && (
          <Card className="p-4" data-testid="coach-draft">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">Draft routine · not saved</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{draft.text}</pre>
            <div className="mt-3 flex gap-2">
              {onSaveDraft && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onSaveDraft(draft.routines);
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
        {problem && (
          <button type="button" onClick={clearError} className="text-left text-sm text-danger" role="alert" data-testid="coach-error">
            {problem}
          </button>
        )}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
}
