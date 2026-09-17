import { useNavigate } from 'react-router-dom';
import type { CalendarDay } from '@/domain/calendar';

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * 12-week training calendar: one row per week (oldest at the top), Monday first. Each day is a
 * square — dim for none, accent for one session, brighter for two or more. Today is outlined,
 * days after today are blank. Tapping a trained day opens its first session.
 */
export function CalendarHeatmap({ grid, today }: { grid: CalendarDay[][]; today: string }) {
  const nav = useNavigate();

  return (
    <div data-testid="calendar-heatmap">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_INITIALS.map((label, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-dim">
            {label}
          </div>
        ))}
      </div>
      <div className="mt-1 grid gap-1.5">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1.5">
            {week.map((day) => {
              const isFuture = day.date > today;
              const isToday = day.date === today;
              const count = day.sessions.length;
              const fill = isFuture ? 'bg-transparent' : count === 0 ? 'bg-surface-2' : count === 1 ? 'bg-accent/55' : 'bg-accent';
              const label = isFuture ? `${day.date}, not yet` : count > 0 ? `${day.date}, trained, ${count} session${count === 1 ? '' : 's'}` : `${day.date}, none`;
              return (
                <button
                  key={day.date}
                  type="button"
                  data-testid={`cal-day-${day.date}`}
                  aria-label={label}
                  disabled={isFuture || count === 0}
                  onClick={() => count > 0 && nav(`/history/${day.sessions[0].id}`)}
                  className={`aspect-square rounded-md ${fill} ${isToday ? 'ring-2 ring-fg' : ''} disabled:pointer-events-none`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
