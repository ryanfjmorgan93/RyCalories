/**
 * The one coach conversation, as the sheet and the full-screen coach (/coach) both use it: what is
 * typed, where a message goes, and which problem to show.
 *
 * Where a message goes depends on whether Claude can be called at all (a key, a connection, room
 * under the spend cap):
 *   - It can: everything goes to Claude (src/ai/chat.ts), which builds and changes routines with its
 *     own tools, and whose drafts are saved through the same Review as the rules coach's.
 *   - It cannot: a request for a routine, or a change to the one on screen, still works, built by
 *     the rules coach (src/state/coach.ts, no model); a question gets the plain reason, nothing is
 *     sent or stored, and what was typed stays in the box.
 *
 * The thread is both: Claude's turns are stored (`coachMessages`) and the rules coach's routines
 * are held in memory, and the screen shows them in the order they happened.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { blockedReason, CLAUDE_ERROR_MESSAGES } from '@/ai/client';
import { routeOf, useCoach } from '@/state/coach';
import { useClaudeCoach, useClaudeSpend } from '@/state/claudeCoach';
import { useSpeech } from './useSpeech';

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Whether the phone says it is online, live. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    () => true,
  );
}

export type CoachConversation = ReturnType<typeof useCoachConversation>;

/**
 * `active` is whether the conversation is on screen (the sheet is open, or the screen is showing):
 * the microphone is switched off when it is not.
 */
export function useCoachConversation({ active = true }: { active?: boolean } = {}) {
  const claudeBusy = useClaudeCoach((s) => s.busy);
  const claudeError = useClaudeCoach((s) => s.lastError);
  const claudeDraft = useClaudeCoach((s) => s.draft);
  const claudeSend = useClaudeCoach((s) => s.send);
  const clearClaudeError = useClaudeCoach((s) => s.clearError);
  const dismissClaudeDraft = useClaudeCoach((s) => s.dismissDraft);

  const entries = useCoach((s) => s.entries);
  const pending = useCoach((s) => s.pending);
  const working = useCoach((s) => s.working);
  const rulesError = useCoach((s) => s.error);
  const rulesSend = useCoach((s) => s.send);
  const shuffle = useCoach((s) => s.shuffle);
  const cancel = useCoach((s) => s.cancel);
  const reset = useCoach((s) => s.reset);

  const speech = useSpeech();
  const [text, setText] = useState('');
  // "Draft with coach": the first message is a request for a routine, whatever it says.
  const [openingBuild, setOpeningBuild] = useState(false);
  // Set by Clear, so a message it cut short is not put back in the box as a Stop would put it.
  const cleared = useRef(false);
  const spokenFrom = useRef('');

  // Read again whenever the connection or the month's spend changes; the key is read at each render.
  useClaudeSpend();
  useOnline();
  const reason = blockedReason();
  const unavailable = reason ? CLAUDE_ERROR_MESSAGES[reason] : null;

  const rulesBusy = pending !== null || working !== null;
  const busy = claudeBusy || rulesBusy;
  const canSend = text.trim() !== '' && !busy;

  const { listening, stop: stopMic, start: startMic } = speech;
  useEffect(() => {
    if (!active && listening) void stopMic();
  }, [active, listening, stopMic]);

  /** Something passed in from outside: a line to start the box with, and whether the first message is a build. */
  const receive = useCallback((prefill: string, build: boolean) => {
    if (prefill) setText(prefill);
    setOpeningBuild(build);
  }, []);

  const putBack = (message: string, build: boolean) => {
    // Not lost: what was typed is in the box again, unless the owner has already started something else.
    setText((now) => (now === '' ? message : now));
    if (build) setOpeningBuild(true);
  };

  const submit = async () => {
    const message = text.trim();
    if (!message || busy) return;
    if (listening) await stopMic();
    const build = openingBuild;
    setText('');
    setOpeningBuild(false);
    cleared.current = false;
    clearClaudeError();
    useCoach.setState({ error: null });

    // Claude cannot be called: a routine can still be built or changed by the rules; a question
    // gets the reason (from Claude's own guard, so it is one sentence in one place).
    if (blockedReason() !== null && routeOf(message, entries, build) !== 'ask') {
      const outcome = await rulesSend(message, { build });
      if (outcome === 'error' || (outcome === 'stopped' && !cleared.current)) putBack(message, build);
      return;
    }

    const reply = await claudeSend(message);
    // Nothing was sent (no key, over the limit, offline before the call): keep what was typed.
    if (reply && !reply.stored) putBack(message, build);
  };

  const toggleMic = async () => {
    if (listening) {
      await stopMic();
      return;
    }
    spokenFrom.current = text.trim();
    await startMic((heard) => setText(spokenFrom.current ? `${spokenFrom.current} ${heard}` : heard));
  };

  // One problem at a time. The note on why Claude is unavailable gives way to it when it says the
  // same thing (a question sent while Claude is off), so it is never said twice.
  const problem = claudeError ?? rulesError ?? speech.error;

  const clearProblem = () => {
    clearClaudeError();
    useCoach.setState({ error: null });
  };

  /** Clear: ends what the rules coach is doing, empties its routines, and drops any draft or problem. */
  const clear = () => {
    cleared.current = true;
    reset();
    clearClaudeError();
    dismissClaudeDraft();
  };

  return {
    text,
    setText,
    submit,
    canSend,
    busy,
    rulesBusy,
    sendLabel: pending ? (pending.mode === 'build' ? 'Building…' : 'Answering…') : 'Send',
    openingBuild,
    receive,
    unavailable: unavailable !== problem ? unavailable : null,
    problem,
    clearProblem,
    clear,
    /** There is something for Clear to clear. */
    clearable: entries.length > 0 || rulesBusy || rulesError !== null || claudeDraft !== null || claudeError !== null,
    mic: { available: speech.available, listening, toggle: toggleMic },
    rules: { entries, pending, working, shuffle, cancel },
    claude: { busy: claudeBusy, draft: claudeDraft, dismissDraft: dismissClaudeDraft },
  };
}
