import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { restDone } from '@/state/notify';
import { remainingSec, useTimer } from '@/state/timer';
import { fmtDuration } from '@/domain/format';
import { useNow, useSessionDock, useSettings } from './hooks';

// The draining ring: same geometry as the approved mockup (r=20 on a 48×48 viewBox), so the
// circumference below is that circle's, not a made-up number.
const RING_R = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

/**
 * Rest timer pinned to the bottom of every screen while a rest is running: a floating glass pill
 * with a draining ring, ±15 s and Skip, per the approved mockup. Remaining time is derived from
 * the stored deadline, so it survives reloads and backgrounding.
 *
 * Colours, blur and radii come from the token layer (`src/index.css`) via `var(--token, fallback)`
 * — the fallback is what renders until that layer's tokens land from the other Phase 3 slice, at
 * which point this file needs no change to pick them up.
 */
export function RestTimerBar() {
  const { endsAt, totalSec, label, firedFor, add, skip, markFired } = useTimer();
  const settings = useSettings();
  const { pathname } = useLocation();
  const inSession = pathname.startsWith('/session/');
  // Where the session dock shows, the timer stacks above it rather than covering it.
  const dockShowing = useSessionDock() !== null;
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
  const frac = totalSec > 0 ? Math.max(0, Math.min(1, remaining / totalSec)) : 0;
  const ringOffset = RING_CIRCUMFERENCE * (1 - frac);
  const tint = done ? 'var(--c-ok)' : 'var(--c-rest, var(--c-info))';

  return (
    <div
      className={`fixed inset-x-0 z-40 mx-auto px-3 ${inSession ? 'bottom-0 pb-safe' : dockShowing ? 'bottom-above-dock' : 'bottom-nav'}`}
      style={{ maxWidth: 'var(--content-max, 36rem)' }}
      data-testid="rest-timer"
    >
      <div
        role="timer"
        aria-label={done ? 'Rest over' : `Rest, ${fmtDuration(remaining)} left`}
        className="mb-3 flex items-center gap-2 p-2 shadow-2xl"
        style={{
          borderRadius: 'var(--r-card, 26px)',
          backdropFilter: 'blur(var(--blur-glass, 16px)) saturate(160%)',
          WebkitBackdropFilter: 'blur(var(--blur-glass, 16px)) saturate(160%)',
          background: 'color-mix(in srgb, var(--c-surface) 62%, transparent)',
          border: `1px solid color-mix(in srgb, ${tint} 30%, var(--c-line))`,
        }}
      >
        {!done && (
          <>
            <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0" aria-hidden="true">
              <circle cx="24" cy="24" r={RING_R} fill="none" stroke="var(--c-line)" strokeWidth="4" opacity="0.4" />
              <circle
                cx="24"
                cy="24"
                r={RING_R}
                fill="none"
                stroke={tint}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
                transform="rotate(-90 24 24)"
                style={{ transition: 'stroke-dashoffset 250ms linear' }}
              />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label || 'Rest'}</div>
              <div className="num text-3xl font-extrabold leading-none">{fmtDuration(remaining)}</div>
            </div>
            <button
              type="button"
              aria-label="15 seconds less"
              onClick={() => add(-15)}
              className="h-11 min-w-11 rounded-xl px-3 text-base font-bold active:brightness-90"
              style={{ background: 'color-mix(in srgb, var(--c-fg) 7%, transparent)' }}
            >
              −15
            </button>
            <button
              type="button"
              aria-label="15 seconds more"
              onClick={() => add(15)}
              className="h-11 min-w-11 rounded-xl px-3 text-base font-bold active:brightness-90"
              style={{ background: 'color-mix(in srgb, var(--c-fg) 7%, transparent)' }}
            >
              +15
            </button>
            <button type="button" onClick={skip} className="h-11 rounded-xl bg-fg px-4 text-base font-bold text-bg active:brightness-90">
              Skip
            </button>
          </>
        )}
        {done && (
          <>
            <div className="min-w-0 flex-1 px-2 py-1 text-lg font-extrabold text-ok">Rest over</div>
            <button type="button" onClick={skip} className="h-11 rounded-xl bg-ok px-4 text-base font-bold text-ok-fg active:brightness-90">
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
