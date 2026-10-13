import { useState } from 'react';
import { updateSession } from '@/db/repo';
import { fmtDuration } from '@/domain/format';
import { DEFAULT_SETTINGS, type Session, type Settings } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Toggle } from '@/ui/components/Chip';
import { Sheet } from '@/ui/components/Sheet';
import { TopBar } from '@/ui/components/TopBar';
import { useNow } from '@/ui/hooks';

export function SessionHeader({
  session,
  targetMinutes,
  settings,
  onFinish,
}: {
  session: Session;
  targetMinutes?: number;
  settings: Settings;
  onFinish: () => void;
}) {
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const over = targetMinutes !== undefined && elapsed > targetMinutes * 60;
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const deloadPercent = settings.deloadPercent ?? DEFAULT_SETTINGS.deloadPercent!;
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
            <div className="flex items-center gap-0.5">
              {/* The menu holds the deload switch only, and a quick session decides no weight. */}
              {!session.quick && (
                <Button size="sm" variant="ghost" onClick={() => setSessionMenuOpen(true)} data-testid="session-options">
                  More
                </Button>
              )}
            </div>
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
    </>
  );
}
