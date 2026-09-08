import { useEffect } from 'react';
import { restDone } from '@/state/notify';
import { remainingSec, useTimer } from '@/state/timer';
import { fmtDuration } from '@/domain/format';
import { useNow, useSettings } from './hooks';

/**
 * Rest timer pinned to the bottom of every screen while a rest is running.
 * Remaining time is derived from the stored deadline, so it survives reloads and backgrounding.
 */
export function RestTimerBar() {
  const { endsAt, totalSec, label, firedFor, add, skip, markFired } = useTimer();
  const settings = useSettings();
  const active = endsAt !== null;
  const now = useNow(250, active);

  const remaining = remainingSec(endsAt, now);
  const overBy = endsAt === null ? 0 : Math.floor((now - endsAt) / 1000);

  useEffect(() => {
    if (endsAt === null || firedFor === endsAt) return;
    if (now < endsAt) return;
    markFired(endsAt);
    // If we're very late (e.g. reopened the app long after), stay quiet.
    if (now - endsAt < 60_000) {
      void restDone({ vibrate: settings?.restVibrate ?? true, notify: settings?.restNotify ?? true, label });
    }
  }, [now, endsAt, firedFor, markFired, label, settings?.restVibrate, settings?.restNotify]);

  useEffect(() => {
    if (endsAt === null) return;
    if (overBy >= 20) skip();
  }, [overBy, endsAt, skip]);

  if (!active) return null;
  const done = remaining <= 0;
  const pct = totalSec > 0 ? Math.max(0, Math.min(1, remaining / totalSec)) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl px-3 pb-safe" data-testid="rest-timer">
      <div className={`mb-3 overflow-hidden rounded-2xl border shadow-2xl ${done ? 'border-ok bg-ok text-ok-fg' : 'border-line bg-surface-2'}`}>
        {!done && (
          <div className="h-1.5 w-full bg-line">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[11px] font-bold uppercase tracking-[0.12em] ${done ? 'text-ok-fg/80' : 'text-muted'}`}>{done ? 'Rest over' : label || 'Rest'}</div>
            <div className="num text-3xl font-extrabold leading-none">{done ? 'Go' : fmtDuration(remaining)}</div>
          </div>
          {!done && (
            <button type="button" onClick={() => add(30)} className="h-12 rounded-xl border border-line px-4 text-base font-bold active:bg-line">
              +30 s
            </button>
          )}
          <button
            type="button"
            onClick={skip}
            className={`h-12 rounded-xl px-4 text-base font-bold ${done ? 'bg-ok-fg/15 text-ok-fg' : 'bg-fg text-bg'}`}
          >
            {done ? 'Dismiss' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
