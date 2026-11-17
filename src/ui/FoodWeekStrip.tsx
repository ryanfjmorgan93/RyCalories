import { useLiveQuery } from 'dexie-react-hooks';
import { trendWindow } from '@/db/trendQueries';
import { fmtDayKey, fmtKcal, fmtNum } from '@/domain/format';
import { addDays } from '@/domain/dates';
import { weekStrip, type StripDay } from '@/domain/foodWeek';
import { Card } from './components/Card';
import { useSettings } from './hooks';

/** The bar area's height. Fixed, so the strip does not jump while it loads. */
const BAR_PX = 56;

/**
 * Seven days of calories against each day's own target, ending today. Tapping a day shows it.
 * It never flatters (see `domain/foodWeek.ts`): a day with nothing logged is a faint stub on the floor
 * and a dash, not a short bar and a zero, and a day over its target is drawn to its real height
 * in the warning colour with the real figure under it.
 */
export function FoodWeekStrip({ date, today, onPick }: { date: string; today: string; onPick: (date: string) => void }) {
  const settings = useSettings();
  // The week ends today for as long as the day being viewed is in it, so tapping a day highlights
  // it without the strip sliding out from under the finger. Browsing further back than a week
  // moves the window to end on that day instead.
  const end = date >= addDays(today, -6) ? today : date;
  const week = useLiveQuery(
    async () => (settings ? weekStrip((await trendWindow(end, 7, settings)).trend.days) : undefined),
    [end, settings],
  );
  const yesterday = addDays(today, -1);
  const anyTarget = week?.some((d) => d.target !== undefined) ?? false;
  const anyUnlogged = week?.some((d) => d.state === 'unlogged') ?? false;

  return (
    <Card framed className="px-3 pb-3 pt-4" data-testid="week-strip">
      <div className="flex items-baseline justify-between px-2 pb-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Last 7 days</span>
        <span className="text-[11px] text-dim">
          {anyTarget && <span className="mr-2">┄ target</span>}
          {anyUnlogged && <span>— not logged</span>}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {(week ?? placeholder(end)).map((d) => (
          <Cell key={d.date} day={d} selected={d.date === date} today={d.date === today} label={fmtDayKey(d.date, today, yesterday)} onPick={onPick} />
        ))}
      </div>
    </Card>
  );
}

/** Seven empty columns for the first paint, so the card is the same height before and after. */
function placeholder(date: string): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => ({ date: addDays(date, i - 6), weekday: '', state: 'unlogged' as const, heightPct: 0 }));
}

function Cell({
  day,
  selected,
  today,
  label,
  onPick,
}: {
  day: StripDay;
  selected: boolean;
  today: boolean;
  label: string;
  onPick: (date: string) => void;
}) {
  const over = day.state === 'over';
  const aria =
    day.state === 'unlogged'
      ? `${label}: not logged`
      : `${label}: ${fmtKcal(day.kcal ?? 0)}${over ? `, ${fmtKcal(day.overBy ?? 0)} over target` : ''}`;
  return (
    <button
      type="button"
      onClick={() => onPick(day.date)}
      aria-label={aria}
      aria-pressed={selected}
      data-testid={`week-day-${day.date}`}
      data-state={day.state}
      className={`flex min-h-[7rem] min-w-0 flex-col items-center justify-end gap-1.5 rounded-control px-0.5 pb-1.5 pt-1 active:bg-fg/[0.06] ${selected ? 'bg-fg/[0.06]' : ''}`}
    >
      <div className="relative w-full" style={{ height: BAR_PX }}>
        {day.state === 'unlogged' ? (
          <div className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-fg/[0.08]" />
        ) : (
          <div
            className={`absolute inset-x-3 bottom-0 rounded-[4px] ${over ? 'bg-warn' : 'bg-accent'}`}
            style={{ height: `${Math.max(day.heightPct, day.kcal ? 4 : 0)}%`, minHeight: day.kcal ? 3 : 0 }}
          />
        )}
        {day.targetPct !== undefined && (
          <div className="absolute inset-x-1 border-t border-dashed border-fg/35" style={{ bottom: `${day.targetPct}%` }} />
        )}
      </div>
      <span className={`text-xs ${today || selected ? 'font-medium text-fg' : 'text-muted'}`}>{day.weekday}</span>
      <span className={`num text-[11px] leading-none tabular-nums ${over ? 'font-medium text-warn' : day.state === 'unlogged' ? 'text-dim' : 'text-muted'}`}>
        {day.state === 'unlogged' ? '—' : fmtNum(day.kcal ?? 0)}
      </span>
    </button>
  );
}
