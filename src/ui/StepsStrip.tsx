import { useEffect, useRef, useState } from 'react';
import { saveSettings } from '@/db/repo';
import { dateKeyToDate } from '@/domain/dates';
import { fmtNum } from '@/domain/format';
import { cleanStepGoal, STEP_GOAL_MAX, STEP_GOAL_MIN, stepWeek, type StepWeek } from '@/domain/steps';
import type { Settings } from '@/domain/types';
import { isNative } from '@/state/native';
import { askForSteps, refreshSteps, useStepsStore } from '@/state/steps';
import { Button } from './components/Button';
import { NumberField } from './components/NumberField';
import { Sheet } from './components/Sheet';

/** Reads the steps when Home opens and again whenever the app comes back to the front. */
function useStepsRefresh(): void {
  useEffect(() => {
    void refreshSteps();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSteps();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}

/**
 * Today's steps as a frosted strip under the Calories and Protein tiles: the count against the
 * goal, with a bar. The count is the count; the bar stops at full but the number does not. Tapped,
 * it opens the week.
 */
export function StepsStrip({ settings }: { settings: Settings }) {
  useStepsRefresh();
  const { access, days } = useStepsStore();
  const [open, setOpen] = useState(false);
  const goal = cleanStepGoal(settings.stepGoal);
  const week = days ? stepWeek(days, goal) : null;

  let value: string;
  if (access === 'loading') value = '…';
  else if (access === 'unavailable') value = 'Not available here';
  else if (access === 'needs-permission') value = 'Connect Health Connect';
  else if (!week || week.today === null) value = 'None recorded today';
  else value = `${fmtNum(week.today)} / ${fmtNum(goal)}`;
  const counting = access === 'granted' && week?.today != null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass-over glass-card block w-full rounded-[1rem] border border-glass-border px-3 py-2.5 text-left"
        data-testid="steps-strip"
        data-access={access}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="label">Steps</span>
          <span className={`num truncate ${counting ? 'text-lg font-semibold' : `text-sm ${access === 'needs-permission' ? 'text-accent' : 'text-muted'}`}`} data-testid="steps-today">
            {value}
          </span>
        </span>
        {counting && (
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (week!.today! / goal) * 100)}%` }} />
          </span>
        )}
      </button>
      <StepsSheet open={open} onClose={() => setOpen(false)} settings={settings} week={week} />
    </>
  );
}

/** The week: a bar a day against the goal line, the figures under it, and the goal to change. */
export function StepsSheet({ open, onClose, settings, week }: { open: boolean; onClose: () => void; settings: Settings; week: StepWeek | null }) {
  const access = useStepsStore((s) => s.access);
  const goal = cleanStepGoal(settings.stepGoal);
  const [draft, setDraft] = useState<number | null>(goal);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(goal), [goal]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const changeGoal = (v: number | null) => {
    setDraft(v);
    clearTimeout(saveTimer.current);
    if (v === null) return;
    // Saved once typing stops, so a half-typed number is never the goal.
    saveTimer.current = setTimeout(() => void saveSettings({ stepGoal: cleanStepGoal(v) }), 600);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Steps">
      <div className="space-y-4 px-4 pb-4" data-testid="steps-sheet">
        {access === 'granted' && week ? (
          <WeekBars week={week} />
        ) : access === 'needs-permission' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Iron reads steps from Health Connect, where Samsung Health puts them. It reads steps only, writes nothing, and nothing leaves the phone.</p>
            <Button full variant="primary" onClick={() => void askForSteps()} data-testid="steps-allow">
              Allow in Health Connect
            </Button>
          </div>
        ) : access === 'unavailable' ? (
          <p className="text-sm text-muted" data-testid="steps-unavailable">
            {isNative() ? 'Health Connect is not available on this phone.' : 'Steps come from Health Connect, on the phone.'}
          </p>
        ) : null}
        <NumberField
          label="Daily goal"
          unit="steps"
          mode="numeric"
          step={500}
          min={STEP_GOAL_MIN}
          max={STEP_GOAL_MAX}
          value={draft}
          onChange={changeGoal}
          testId="step-goal"
        />
      </div>
    </Sheet>
  );
}

function WeekBars({ week }: { week: StepWeek }) {
  const top = Math.max(week.goal, ...week.days.map((d) => d.steps ?? 0));
  const goalAt = (week.goal / top) * 100;
  return (
    <div>
      <div className="relative flex h-40 items-end gap-2" data-testid="steps-week">
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${goalAt}%` }} aria-hidden="true" />
        {week.days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col justify-end" data-testid={`steps-day-${d.date}`}>
            {d.steps === null ? (
              <div className="h-1 rounded-full bg-white/10" />
            ) : (
              <div className={`min-h-1 rounded-t-md ${d.steps >= week.goal ? 'bg-accent' : 'bg-white/25'}`} style={{ height: `${(d.steps / top) * 100}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {week.days.map((d) => (
          <div key={d.date} className="flex-1 text-center text-[11px] font-semibold text-dim">
            {new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' }).format(dateKeyToDate(d.date))}
          </div>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="label">Average</dt>
          <dd className="num mt-1 text-lg font-semibold" data-testid="steps-average">
            {week.average === null ? '–' : fmtNum(week.average)}
          </dd>
          <dd className="text-xs text-dim">over {week.recordedDays} {week.recordedDays === 1 ? 'day' : 'days'}</dd>
        </div>
        <div>
          <dt className="label">Total</dt>
          <dd className="num mt-1 text-lg font-semibold">{fmtNum(week.total)}</dd>
          <dd className="text-xs text-dim">last {week.days.length} days</dd>
        </div>
        <div>
          <dt className="label">Goal hit</dt>
          <dd className="num mt-1 text-lg font-semibold">
            {week.goalHit} of {week.recordedDays}
          </dd>
          <dd className="text-xs text-dim">days</dd>
        </div>
      </dl>
    </div>
  );
}
