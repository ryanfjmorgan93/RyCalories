import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { trendWindow } from '@/db/trendQueries';
import { dateKeyToDate } from '@/domain/dates';
import { bandStatus, movingAverage, weeklyDelta } from '@/domain/bodyweight';
import { fmtGrams, fmtKcal, fmtNum } from '@/domain/format';
import { averagesAreMeaningful, type Average, type Trend } from '@/domain/trends';
import { Card, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Segmented } from '@/ui/components/Chip';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { useSettings, useToday } from '@/ui/hooks';

type Window = '14' | '28' | '56';

const WINDOWS: { value: Window; label: string }[] = [
  { value: '14', label: '2 weeks' },
  { value: '28', label: '4 weeks' },
  { value: '56', label: '8 weeks' },
];

/**
 * Training and eating in one place, over a window.
 *
 * Every average here is drawn only from the days that were actually logged, and says how many
 * that was. A month with four logged days has an average, but it is an average of four days, and
 * the screen says so rather than presenting it as the month.
 */
export function ProgressScreen() {
  const nav = useNavigate();
  const today = useToday();
  const settings = useSettings();
  const [window, setWindow] = useState<Window>('28');

  const data = useLiveQuery(
    async () => (settings ? trendWindow(today, Number(window), settings) : undefined),
    [today, window, settings],
  );

  return (
    <div>
      <TopBar title="Progress" />
      <div className="px-4">
        <Segmented value={window} onChange={setWindow} options={WINDOWS} />
        <div className="h-4" />

        {data === undefined && <div className="py-8 text-center text-sm text-muted">Loading…</div>}

        {data && (
          <>
            <SectionTitle>Bodyweight</SectionTitle>
            <BodyweightCard data={data} settings={settings!} today={today} />

            <SectionTitle>Eating</SectionTitle>
            <EatingCard trend={data.trend} />

            <SectionTitle>Training</SectionTitle>
            <TrainingCard trend={data.trend} />

            <div className="h-4" />
            <Card>
              <Row onClick={() => nav('/body')} title="Bodyweight log" subtitle="Add a reading, see every week" right={<ChevronIcon />} />
              <Row onClick={() => nav('/history')} title="Session history" right={<ChevronIcon />} />
            </Card>
          </>
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}

function BodyweightCard({
  data,
  settings,
  today,
}: {
  data: NonNullable<Awaited<ReturnType<typeof trendWindow>>>;
  settings: NonNullable<ReturnType<typeof useSettings>>;
  today: string;
}) {
  const { bodyweight } = data;
  if (bodyweight.length === 0) {
    return <EmptyState>No readings in this window.</EmptyState>;
  }

  const smoothed = movingAverage(bodyweight, 5);
  const points: ChartPoint[] = bodyweight.map((b) => ({ t: dateKeyToDate(b.date).getTime(), y: b.kg }));
  const line: ChartPoint[] = smoothed.map((s) => ({ t: dateKeyToDate(s.date).getTime(), y: s.kg }));
  const delta = weeklyDelta(bodyweight, today);
  const status = delta ? bandStatus(delta.deltaKg, settings.weeklyGainTargetMin, settings.weeklyGainTargetMax) : null;

  return (
    <Card className="p-4">
      <LineChart
        points={line}
        secondary={points}
        band={{ min: settings.bodyweightTargetMin, max: settings.bodyweightTargetMax }}
        unit="kg"
      />
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Per week</span>
        {delta ? (
          <span
            className={`num font-extrabold tabular-nums ${status === 'in' ? 'text-ok' : 'text-warn'}`}
            data-testid="weekly-delta"
          >
            {delta.deltaKg > 0 ? '+' : ''}
            {fmtNum(delta.deltaKg)} kg
          </span>
        ) : (
          // Two readings a few days apart is not a rate. Saying so beats printing one.
          <span className="text-sm text-muted">Not enough readings yet</span>
        )}
      </div>
    </Card>
  );
}

function EatingCard({ trend }: { trend: Trend }) {
  if (trend.loggedDays === 0) {
    return <EmptyState>No food logged in this window.</EmptyState>;
  }

  const meaningful = averagesAreMeaningful(trend);
  return (
    <Card className="p-4">
      <AverageRow label="Calories" avg={trend.kcal} format={fmtKcal} testId="avg-kcal" />
      {trend.kcalTarget.value !== null && (
        <div className="mt-1 text-xs text-muted">
          <span className="num tabular-nums">Target {fmtKcal(trend.kcalTarget.value)}</span> over the same days
        </div>
      )}
      <div className="h-4" />
      <AverageRow label="Protein" avg={trend.protein} format={fmtGrams} testId="avg-protein" />
      {trend.proteinHit.outOf > 0 && (
        <div className="mt-1 text-xs text-muted num tabular-nums" data-testid="protein-hit">
          Target met on {trend.proteinHit.days} of {trend.proteinHit.outOf} days
        </div>
      )}
      <div className="h-4" />
      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Days logged</span>
        <span className={`num font-extrabold tabular-nums ${meaningful ? '' : 'text-warn'}`} data-testid="days-logged">
          {trend.loggedDays} of {trend.days.length}
        </span>
      </div>
      {!meaningful && (
        // An average of four days out of twenty-eight describes those four days. Say which it is.
        <div className="mt-1 text-xs text-warn" data-testid="thin-coverage">
          These averages cover {trend.loggedDays} {trend.loggedDays === 1 ? 'day' : 'days'}, not the window.
        </div>
      )}
    </Card>
  );
}

function TrainingCard({ trend }: { trend: Trend }) {
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Sessions</span>
        <span className="num text-2xl font-extrabold tabular-nums" data-testid="sessions">
          {trend.sessions}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-xs text-muted">
        <span>Per week</span>
        <span className="num tabular-nums" data-testid="sessions-per-week">
          {fmtNum(Math.round(trend.sessionsPerWeek * 10) / 10)}
        </span>
      </div>
    </Card>
  );
}

/** An average with the number of days it is built from, never one without the other. */
function AverageRow({
  label,
  avg,
  format,
  testId,
}: {
  label: string;
  avg: Average;
  format: (n: number) => string;
  testId: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="num text-2xl font-extrabold tabular-nums" data-testid={testId}>
        {avg.value === null ? '—' : format(Math.round(avg.value))}
      </span>
    </div>
  );
}
