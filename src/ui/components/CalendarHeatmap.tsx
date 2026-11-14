import { useNavigate } from 'react-router-dom';
import type { CalendarDay } from '@/domain/calendar';
import { dateKeyToDate } from '@/domain/dates';

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The training calendar: one row per week (oldest at the top), Monday first, each day a small tile
 * with its date (and the month on the 1st). Dim for none, accent for one session, brighter for two
 * or more. Today is outlined, days after today are blank. Tapping a trained day opens its first session.
 */
export function CalendarHeatmap({ grid, today }: { grid: CalendarDay[][]; today: string }) {
  const nav = useNavigate();

  return (
    <div data-testid="calendar-heatmap">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_INITIALS.map((label, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-dim">
            {label}
          </div>
        ))}
      </div>
      <div className="mt-1 grid gap-1">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day) => {
              const isFuture = day.date > today;
              const isToday = day.date === today;
              const count = day.sessions.length;
              // A trained day is ringed like a badge, two sessions fill it; today is the cream disc.
              const fill = isFuture ? 'text-dim' : count === 0 ? 'text-muted' : count === 1 ? 'border-[1.5px] border-accent text-fg' : 'bg-accent text-accent-fg';
              const label = isFuture ? `${day.date}, not yet` : count > 0 ? `${day.date}, trained, ${count} session${count === 1 ? '' : 's'}` : `${day.date}, none`;
              const d = dateKeyToDate(day.date);
              return (
                <button
                  key={day.date}
                  type="button"
                  data-testid={`cal-day-${day.date}`}
                  aria-label={label}
                  disabled={isFuture || count === 0}
                  onClick={() => count > 0 && nav(`/history/${day.sessions[0].id}`)}
                  className={`num h-9 w-9 justify-self-center rounded-full text-xs ${isToday && count < 2 ? 'bg-fg font-medium text-bg' : ''} ${fill} disabled:pointer-events-none`}
                >
                  {d.getDate() === 1 ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d) : d.getDate()}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** This week's sessions against the weekly target as dots, and the streak of weeks that met it. */
export function StreakDots({ thisWeek, target, streak, className = '' }: { thisWeek: number; target: number; streak: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-semibold text-muted ${className}`} data-testid="streak-line">
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: Math.max(target, thisWeek) }, (_, i) => (
          <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < thisWeek ? 'bg-accent' : 'bg-white/15'}`} />
        ))}
      </span>
      <span>
        This week {thisWeek} of {target}
        {streak > 0 && ` · ${streak}-week streak`}
      </span>
    </div>
  );
}

/**
 * This week on Home (v5, after the owner's Third Space reference): the count and any streak as
 * StreakDots says them, over Monday to Sunday, each day a ring filled in brass when a session was
 * finished on it, today's ring in cream, the days still to come dimmer.
 */
export function WeekStrip({ week, today, thisWeek, target, streak }: { week: CalendarDay[]; today: string; thisWeek: number; target: number; streak: number }) {
  return (
    <div className="rounded-card bg-surface px-5 pb-5 pt-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" data-testid="week-strip">
      <div className="label" data-testid="streak-line">
        This week {thisWeek} of {target}
        {streak > 0 && ` · ${streak}-week streak`}
      </div>
      <div className="mt-5 grid grid-cols-7">
        {week.map((d, i) => (
          <div key={d.date} className="flex flex-col items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-3.5 w-3.5 rounded-full border ${d.sessions.length > 0 ? 'border-accent bg-accent' : d.date === today ? 'border-fg' : 'border-fg/25'}`}
            />
            <span className={`text-[11px] ${d.date > today ? 'text-dim' : 'text-muted'}`}>{WEEKDAY_INITIALS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
