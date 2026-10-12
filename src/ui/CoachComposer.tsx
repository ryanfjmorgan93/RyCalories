import { Button } from './components/Button';
import { TextInput } from './components/NumberField';
import type { CoachConversation } from './useCoachConversation';

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/**
 * The coach's box: one line of text, a microphone where the phone has one, and Send. Above it, the
 * one problem there is (tap to dismiss), or a quiet note on why Claude cannot be asked right now.
 * The same box in the sheet's footer and at the foot of the full-screen coach.
 */
export function CoachComposer({ c }: { c: CoachConversation }) {
  return (
    <div data-testid="coach-composer">
      {c.problem ? (
        <button type="button" onClick={c.clearProblem} className="mb-2 flex min-h-11 w-full items-center text-left text-sm text-danger" role="alert" data-testid="coach-error">
          {c.problem}
        </button>
      ) : c.unavailable ? (
        <div className="mb-2 text-sm text-muted" data-testid="coach-unavailable">
          {c.unavailable} A routine can still be built here.
        </div>
      ) : null}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void c.submit();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message</span>
          <TextInput value={c.text} onChange={c.setText} placeholder={c.mic.listening ? 'Listening…' : 'Message'} testId="coach-input" />
        </label>
        {c.mic.available && (
          <button
            type="button"
            aria-label={c.mic.listening ? 'Stop listening' : 'Speak'}
            aria-pressed={c.mic.listening}
            onClick={() => void c.mic.toggle()}
            data-testid="coach-mic"
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${c.mic.listening ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-2 text-fg'}`}
          >
            <MicIcon active={c.mic.listening} />
          </button>
        )}
        <Button type="submit" variant="primary" size="md" disabled={!c.canSend} data-testid="coach-send">
          {c.sendLabel}
        </Button>
      </form>
    </div>
  );
}
