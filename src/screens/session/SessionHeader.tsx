import { useEffect, useState } from 'react';
import { gatherContext } from '@/db/assistantQueries';
import { updateSession } from '@/db/repo';
import type { AssistantContext } from '@/domain/assistant';
import { toDateKey } from '@/domain/dates';
import { fmtDuration } from '@/domain/format';
import { DEFAULT_SETTINGS, type Session, type Settings } from '@/domain/types';
import { useAssistant } from '@/state/assistant';
import { AssistantBox } from '@/ui/AssistantBox';
import { Button, IconButton } from '@/ui/components/Button';
import { Toggle } from '@/ui/components/Chip';
import { Sheet } from '@/ui/components/Sheet';
import { MoreIcon, TopBar } from '@/ui/components/TopBar';
import { useNow } from '@/ui/hooks';
import { AskIcon } from './icons';

export function SessionHeader({
  session,
  targetMinutes,
  settings,
  currentExerciseId,
  onFinish,
}: {
  session: Session;
  targetMinutes?: number;
  settings: Settings;
  currentExerciseId?: string;
  onFinish: () => void;
}) {
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const over = targetMinutes !== undefined && elapsed > targetMinutes * 60;
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssistantContext>({ today: toDateKey() });
  const deloadPercent = settings.deloadPercent ?? DEFAULT_SETTINGS.deloadPercent!;
  // On the PWA build the web backend always reports 'unavailable' (see state/nano.ts), so an
  // ungated Ask button is decorative there. Gate on 'unavailable' only, not on `!== 'ready'`:
  // AssistantBox carries the Download button for the downloadable/downloading states and this
  // screen has no other route to it, so disabling those would be a dead end. Matches
  // ExerciseDetailScreen; AssistantSettingsCard can be stricter because its Download sits beside
  // its Test button.
  const { status: assistantStatus, refreshStatus: refreshAssistantStatus } = useAssistant();

  useEffect(() => {
    void refreshAssistantStatus();
  }, [refreshAssistantStatus]);

  useEffect(() => {
    if (!assistantOpen) return;
    let alive = true;
    void gatherContext({
      today: toDateKey(),
      settings,
      sessionId: session.id,
      routineId: session.routineId || undefined,
      exerciseId: currentExerciseId,
    }).then((ctx) => {
      if (alive) setAssistantContext(ctx);
    });
    return () => {
      alive = false;
    };
  }, [assistantOpen, settings, session.id, session.routineId, currentExerciseId]);

  return (
    <>
      <TopBar
        title={session.title}
        back="/"
        subtitle={
          <span className={`num text-base font-extrabold ${over ? 'text-danger' : 'text-muted'}`} data-testid="session-clock">
            {fmtDuration(elapsed)}
            {targetMinutes ? <span className="text-xs font-semibold text-dim"> / {targetMinutes} min</span> : null}
            {session.deload ? <span className="text-info"> · deload</span> : null}
          </span>
        }
        right={
          <>
            <IconButton
              label="Ask"
              onClick={() => setAssistantOpen(true)}
              disabled={assistantStatus?.state === 'unavailable'}
              data-testid="ask-assistant"
            >
              <AskIcon />
            </IconButton>
            <IconButton label="Session options" onClick={() => setSessionMenuOpen(true)} data-testid="session-options">
              <MoreIcon />
            </IconButton>
            <Button variant="primary" size="md" onClick={onFinish} data-testid="finish-session" className="mr-2">
              Finish
            </Button>
          </>
        }
      />

      <Sheet open={sessionMenuOpen} onClose={() => setSessionMenuOpen(false)} title={session.title}>
        <Toggle
          checked={!!session.deload}
          onChange={(v) => void updateSession(session.id, { deload: v })}
          label="Deload session"
          sub={`Loads reduced to ${Math.round(deloadPercent * 100)}%; weights do not change after this session.`}
        />
      </Sheet>

      <AssistantBox open={assistantOpen} onClose={() => setAssistantOpen(false)} context={assistantContext} />
    </>
  );
}
