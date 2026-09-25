import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { bestsForExercise, e1rmSeries } from '@/db/recordsQueries';
import { trendWindow } from '@/db/trendQueries';
import { dateKeyToDate, mondayOf } from '@/domain/dates';
import { bandStatus, movingAverage, weeklyDelta } from '@/domain/bodyweight';
import { fmtDate, fmtGrams, fmtKcal, fmtKg, fmtNum, fmtSignedKg } from '@/domain/format';
import { strengthLevel, type StrengthLevel } from '@/domain/standards';
import { e1rmChange } from '@/domain/strength';
import { averagesAreMeaningful, type Average, type Trend } from '@/domain/trends';
import type { Exercise, MuscleGroup } from '@/domain/types';
import { ClaudeSheet } from '@/ui/ClaudeSheet';
import { BodyMap } from '@/ui/components/BodyMap';
import { Button } from '@/ui/components/Button';
import { CalendarHeatmap } from '@/ui/components/CalendarHeatmap';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Segmented } from '@/ui/components/Chip';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import type { WeeklySetsRow } from '@/db/volumeQueries';
import { useCalendar, useExercises, useMuscleRecency, useRecentRecords, useSettings, useToday, useWeeklySets } from '@/ui/hooks';

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
  const [claudeOpen, setClaudeOpen] = useState(false);

  const data = useLiveQuery(
    async () => (settings ? trendWindow(today, Number(window), settings) : undefined),
    [today, window, settings],
  );

  const calendar = useCalendar(12, today, settings);
  const weeklyRows = useWeeklySets(mondayOf(today), settings);
  const recency = useMuscleRecency(today);
  const exercises = useExercises();
  const recentRecords = useRecentRecords(10);

  const latestBodyweightKg = useLiveQuery(async () => {
    const rows = await db.bodyweight.toArray();
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.date.localeCompare(a.date))[0].kg;
  }, []);

  const standardsRows = useLiveQuery(async () => {
    if (!exercises || latestBodyweightKg == null) return [] as StandardRow[];
    const out: StandardRow[] = [];
    for (const e of exercises) {
      if (!e.standard) continue;
      const bests = await bestsForExercise(e.id);
      if (bests.e1rm === null) continue;
      const s = strengthLevel(e.standard, bests.e1rm, latestBodyweightKg);
      out.push({ exercise: e, ratio: s.ratio, level: s.level, next: s.next });
    }
    return out;
  }, [exercises, latestBodyweightKg]);

  const changeRows = useLiveQuery(async () => {
    if (!exercises) return [] as ChangeRow[];
    const out: ChangeRow[] = [];
    for (const e of exercises) {
      const series = await e1rmSeries(e.id);
      const change = e1rmChange(series);
      if (change) out.push({ exercise: e, change });
    }
    return out;
  }, [exercises]);

  const setsByGroup: Partial<Record<MuscleGroup, number>> = {};
  const targetByGroup: Partial<Record<MuscleGroup, number>> = {};
  for (const r of weeklyRows ?? []) {
    setsByGroup[r.muscleGroup] = r.sets;
    if (r.target !== null) targetByGroup[r.muscleGroup] = r.target;
  }

  return (
    <div>
      <TopBar
        title="Progress"
        right={
          <Button size="md" variant="ghost" className="mr-1" onClick={() => setClaudeOpen(true)} data-testid="claude-open">
            Claude
          </Button>
        }
      />
      <ClaudeSheet open={claudeOpen} onClose={() => setClaudeOpen(false)} />
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

            <SectionTitle>Calendar</SectionTitle>
            {calendar && <CalendarCard calendar={calendar} today={today} />}

            <SectionTitle>Body map</SectionTitle>
            <Card className="p-4">
              <BodyMap setsByGroup={setsByGroup} targetByGroup={targetByGroup} recency={recency ?? {}} />
            </Card>

            <SectionTitle>Weekly sets</SectionTitle>
            <WeeklySetsCard rows={weeklyRows ?? []} />

            <SectionTitle>Strength</SectionTitle>
            <StrengthCard standards={standardsRows ?? []} changes={changeRows ?? []} />

            <SectionTitle>Recent PRs</SectionTitle>
            <RecentPRsCard records={recentRecords ?? []} />

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

interface StandardRow {
  exercise: Exercise;
  ratio: number;
  level: StrengthLevel | 'untrained';
  next: { level: StrengthLevel; ratio: number; kg: number } | null;
}

interface ChangeRow {
  exercise: Exercise;
  change: NonNullable<ReturnType<typeof e1rmChange>>;
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

function CalendarCard({ calendar, today }: { calendar: NonNullable<ReturnType<typeof useCalendar>>; today: string }) {
  return (
    <Card className="p-4">
      <CalendarHeatmap grid={calendar.grid} today={today} />
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Streak</span>
        <span className="num text-2xl font-extrabold tabular-nums" data-testid="streak-line">
          {calendar.streak > 0 ? `${calendar.streak} ${calendar.streak === 1 ? 'week' : 'weeks'} · ${calendar.line}` : `This week ${calendar.thisWeek} of ${calendar.weeklyTarget}`}
        </span>
      </div>
    </Card>
  );
}

function WeeklySetsCard({ rows }: { rows: WeeklySetsRow[] }) {
  if (rows.length === 0) {
    return <EmptyState>No sets logged this week.</EmptyState>;
  }
  return (
    <Card data-testid="weekly-sets">
      {rows.map((r, i) => (
        <div key={r.muscleGroup}>
          {i > 0 && <Divider />}
          <Row
            title={r.muscleGroup}
            right={
              <span className="num font-extrabold tabular-nums">{r.target !== null ? `${r.sets} of ${r.target}` : `${r.sets}`}</span>
            }
          />
        </div>
      ))}
    </Card>
  );
}

const LEVEL_LABEL: Record<StrengthLevel | 'untrained', string> = {
  untrained: 'untrained',
  beginner: 'beginner',
  novice: 'novice',
  intermediate: 'intermediate',
  advanced: 'advanced',
  elite: 'elite',
};

function StrengthCard({ standards, changes }: { standards: StandardRow[]; changes: ChangeRow[] }) {
  if (standards.length === 0 && changes.length === 0) {
    return <EmptyState>No e1RM history yet.</EmptyState>;
  }
  return (
    <Card className="p-4" data-testid="strength-card">
      {standards.map((r, i) => (
        <div key={r.exercise.id}>
          {i > 0 && <Divider />}
          <div className="py-2">
            <div className="font-semibold">{r.exercise.name}</div>
            <div className="num text-sm text-muted">
              {fmtNum(r.ratio)} × bodyweight · {LEVEL_LABEL[r.level]}
              {r.next ? ` · next ${fmtNum(r.next.ratio)} × = ${fmtKg(r.next.kg)}` : ''}
            </div>
          </div>
        </div>
      ))}
      {standards.length > 0 && changes.length > 0 && <Divider />}
      {changes.map((r, i) => (
        <div key={r.exercise.id}>
          {i > 0 && <Divider />}
          <div className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0 truncate">{r.exercise.name}</span>
            <span className="num shrink-0 text-sm text-muted">
              {fmtSignedKg(r.change.delta)} {r.change.covered ? 'in 4 weeks' : `since ${fmtDate(new Date(r.change.from).toISOString())}`}
            </span>
          </div>
        </div>
      ))}
    </Card>
  );
}

const PR_KIND_LABEL: Record<string, string> = {
  weight: 'weight',
  e1rm: 'e1RM',
  set_volume: 'volume',
  reps_at_weight: 'reps',
};

function RecentPRsCard({ records }: { records: NonNullable<ReturnType<typeof useRecentRecords>> }) {
  if (records.length === 0) {
    return <EmptyState>No personal records yet.</EmptyState>;
  }
  return (
    <Card data-testid="recent-prs">
      {records.map((r, i) => {
        const kindLabel = r.record.kind === 'reps_at_weight' ? `reps at ${fmtKg(r.record.weight)}` : PR_KIND_LABEL[r.record.kind];
        const value = r.record.kind === 'set_volume' ? `${fmtNum(r.record.value)} kg` : r.record.kind === 'reps_at_weight' ? `${r.record.value} reps` : fmtKg(r.record.value);
        // Two lines, never truncated: the record itself, then when and what it beat.
        const title = `${r.exercise.name} · PR ${kindLabel} ${value}`;
        const subtitle = `${fmtDate(r.date)}${r.record.previousSource === 'hevy' ? ' · beats Hevy' : ''}`;
        return (
          <div key={`${r.sessionId}-${r.record.kind}-${r.record.setIndex}`}>
            {i > 0 && <Divider />}
            <Row title={title} subtitle={subtitle} />
          </div>
        );
      })}
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
