import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { deleteBodyweight, logBodyweight } from '@/db/repo';
import { bandStatus, movingAverage, round2, weeklyDelta } from '@/domain/bodyweight';
import { addDays, dateKeyToDate, daysBetween, toDateKey } from '@/domain/dates';
import { fmtDate, fmtDateLong, fmtKg, fmtNum } from '@/domain/format';
import type { Bodyweight, Settings } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { NumberField, NumberInput, TextInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { useSettings } from '@/ui/hooks';

const PAGE = 60;
const CHART_DAYS = 28;

// ---------------------------------------------------------------------------
// Pure helpers

/** Long date label from a YYYY-MM-DD key, parsed as local midnight so it never shifts a day. */
function dateLabel(key: string): string {
  return fmtDateLong(dateKeyToDate(key).toISOString());
}

function shortDateLabel(key: string): string {
  return fmtDate(dateKeyToDate(key).toISOString());
}

function signed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

/** Monday of the ISO week containing `key`. */
function weekStart(key: string): string {
  const dow = (dateKeyToDate(key).getDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

export interface WeekSummary {
  /** Monday date key. */
  start: string;
  label: string;
  avg: number;
  count: number;
  /** Average minus the previous listed week's average; null for the earliest week. */
  delta: number | null;
}

/** Group readings by ISO week (Monday start); most recent `weeks` weeks, newest first. */
function weeklySummaries(entries: Bodyweight[], weeks = 8): WeekSummary[] {
  const groups = new Map<string, number[]>();
  for (const e of entries) {
    const s = weekStart(e.date);
    const arr = groups.get(s) ?? [];
    arr.push(e.kg);
    groups.set(s, arr);
  }
  const starts = [...groups.keys()].sort();
  let prev: number | null = null;
  const out: WeekSummary[] = [];
  for (const start of starts) {
    const kgs = groups.get(start) ?? [];
    const avg = round2(kgs.reduce((a, b) => a + b, 0) / kgs.length);
    out.push({ start, label: `w/c ${shortDateLabel(start)}`, avg, count: kgs.length, delta: prev === null ? null : round2(avg - prev) });
    prev = avg;
  }
  return out.slice(-weeks).reverse();
}

// ---------------------------------------------------------------------------
// Screen

export function BodyweightScreen() {
  const settings = useSettings();
  const entries = useLiveQuery(() => db.bodyweight.orderBy('date').toArray(), []);
  const [editing, setEditing] = useState<Bodyweight | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const today = toDateKey();
  const latest = entries && entries.length ? entries[entries.length - 1] : undefined;
  const newestFirst = useMemo(() => (entries ? [...entries].reverse() : []), [entries]);
  const weeks = useMemo(() => (entries ? weeklySummaries(entries, 8) : []), [entries]);

  if (!entries || !settings) {
    return (
      <div>
        <TopBar title="Bodyweight" />
        <div className="px-4 py-8 text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div>
      <TopBar title="Bodyweight" />
      <div className="px-4">
        <LogCard latest={latest} today={today} />

        <SectionTitle>Trend</SectionTitle>
        <StatsCard entries={entries} latest={latest} settings={settings} today={today} />

        <SectionTitle>4 weeks</SectionTitle>
        <TrendCard entries={entries} today={today} />

        <SectionTitle>Weekly</SectionTitle>
        <Card>
          {weeks.map((w, i) => (
            <div key={w.start}>
              {i > 0 && <Divider />}
              <Row
                title={w.label}
                subtitle={`${w.count} ${w.count === 1 ? 'reading' : 'readings'}`}
                right={
                  <div className="text-right">
                    <div className="num text-xl font-extrabold leading-tight">{fmtNum(w.avg)} kg</div>
                    <div className={`num text-xs font-semibold ${w.delta === null ? 'text-dim' : w.delta > 0 ? 'text-ok' : w.delta < 0 ? 'text-accent' : 'text-muted'}`}>
                      {w.delta === null ? '—' : signed(w.delta, 1)}
                    </div>
                  </div>
                }
              />
            </div>
          ))}
          {weeks.length === 0 && (
            <div className="p-4">
              <EmptyState>No readings yet.</EmptyState>
            </div>
          )}
        </Card>

        <SectionTitle>Readings</SectionTitle>
        <Card>
          {newestFirst.slice(0, limit).map((e, i) => (
            <div key={e.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => setEditing(e)}
                left={
                  <div className="num w-20 shrink-0 text-xl font-extrabold leading-tight">
                    {fmtNum(e.kg)}
                    <span className="text-xs font-bold text-muted"> kg</span>
                  </div>
                }
                title={dateLabel(e.date)}
                subtitle={e.note}
                right={<ChevronIcon />}
              />
            </div>
          ))}
          {newestFirst.length === 0 && (
            <div className="p-4">
              <EmptyState>No readings yet.</EmptyState>
            </div>
          )}
          {newestFirst.length > limit && (
            <>
              <Divider />
              <div className="p-2">
                <Button variant="ghost" full onClick={() => setLimit((n) => n + PAGE)}>
                  Show more
                </Button>
              </div>
            </>
          )}
        </Card>
        <div className="h-6" />
      </div>

      <EditSheet entry={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log card

function LogCard({ latest, today }: { latest: Bodyweight | undefined; today: string }) {
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const save = async () => {
    if (kg === null || kg <= 0 || !date) return;
    await logBodyweight(date, kg, note);
    setKg(null);
    setNote('');
    toast(`Logged ${fmtKg(kg)} for ${shortDateLabel(date)}`, 'ok');
  };

  return (
    <Card className="mt-2 p-4">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          data-testid="bw-date"
          className="num h-12 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3 text-base font-semibold outline-none focus:border-accent"
        />
        <NumberInput value={kg} onChange={setKg} placeholder={latest ? fmtNum(latest.kg) : 'kg'} testId="bw-kg"  min={1}/>
      </div>
      <TextInput value={note} onChange={setNote} placeholder="Note (optional)" className="mt-2" testId="bw-note" />
      <Button variant="primary" size="lg" full className="mt-3" disabled={kg === null || kg <= 0 || !date} onClick={() => void save()} data-testid="bw-save">
        Save
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stats card

function StatsCard({ entries, latest, settings, today }: { entries: Bodyweight[]; latest: Bodyweight | undefined; settings: Settings; today: string }) {
  const delta = weeklyDelta(entries, today);
  const status = delta ? bandStatus(delta.deltaKg, settings.weeklyGainTargetMin, settings.weeklyGainTargetMax) : null;
  const band = `${fmtNum(settings.bodyweightTargetMin)}–${fmtNum(settings.bodyweightTargetMax)}`;

  let toTarget: { value: string; sub: string; tone?: 'ok' | 'warn' | 'accent' } = { value: '—', sub: `target ${band}` };
  if (latest) {
    if (latest.kg < settings.bodyweightTargetMin) toTarget = { value: fmtKg(round2(settings.bodyweightTargetMin - latest.kg)), sub: `to ${band}` };
    else if (latest.kg > settings.bodyweightTargetMax) toTarget = { value: fmtKg(round2(latest.kg - settings.bodyweightTargetMax)), sub: `above ${band}`, tone: 'warn' };
    else toTarget = { value: 'in band', sub: band, tone: 'ok' };
  }

  return (
    <Card className="flex flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3">
      <Stat label="Latest" value={latest ? fmtKg(latest.kg) : '—'} sub={latest ? shortDateLabel(latest.date) : 'no readings'} />
      <Stat
        label="7-day"
        value={delta ? `${signed(delta.deltaKg)} kg/wk` : '—'}
        tone={status === 'in' ? 'ok' : status === 'above' ? 'warn' : status === 'below' ? 'accent' : undefined}
        sub={`target +${fmtNum(settings.weeklyGainTargetMin)}–${fmtNum(settings.weeklyGainTargetMax)}`}
      />
      <Stat label="To target" value={toTarget.value} sub={toTarget.sub} tone={toTarget.tone} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart card

function TrendCard({ entries, today }: { entries: Bodyweight[]; today: string }) {
  const { points, secondary } = useMemo(() => {
    const inWindow = (date: string) => {
      const d = daysBetween(date, today);
      return d >= 0 && d < CHART_DAYS;
    };
    const t = (date: string) => dateKeyToDate(date).getTime();
    const points: ChartPoint[] = entries.filter((e) => inWindow(e.date)).map((e) => ({ t: t(e.date), y: e.kg }));
    const secondary: ChartPoint[] = movingAverage(entries, 5)
      .filter((m) => inWindow(m.date))
      .map((m) => ({ t: t(m.date), y: m.kg }));
    return { points, secondary };
  }, [entries, today]);

  if (points.length < 2) return <EmptyState>Fewer than two readings in the last four weeks.</EmptyState>;
  return (
    <Card className="p-3">
      <LineChart points={points} secondary={secondary} unit="kg" height={180} />
      <div className="mt-1 flex items-center gap-4 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-accent" /> readings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-muted" /> 5-reading average
        </span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Edit sheet

function EditSheet({ entry, onClose }: { entry: Bodyweight | null; onClose: () => void }) {
  return entry ? <EditSheetBody key={entry.id} entry={entry} onClose={onClose} /> : null;
}

function EditSheetBody({ entry, onClose }: { entry: Bodyweight; onClose: () => void }) {
  const [kg, setKg] = useState<number | null>(entry.kg);
  const [note, setNote] = useState(entry.note ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = async () => {
    if (kg === null || kg <= 0) return;
    await logBodyweight(entry.date, kg, note);
    toast(`Saved ${fmtKg(kg)}`, 'ok');
    onClose();
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={dateLabel(entry.date)}
        footer={
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Button size="lg" variant="danger" onClick={() => setConfirmOpen(true)}>
              Delete
            </Button>
            <Button size="lg" variant="primary" disabled={kg === null || kg <= 0} onClick={() => void save()} data-testid="bw-edit-save">
              Save
            </Button>
          </div>
        }
      >
        <NumberField value={kg} onChange={setKg} step={0.1} min={1} max={500} label="Weight" unit="kg" testId="bw-edit-kg" />
        <div className="mt-3">
          <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Note</div>
          <TextInput value={note} onChange={setNote} placeholder="Optional" />
        </div>
      </Sheet>
      <Confirm
        open={confirmOpen}
        title="Delete this reading?"
        body={`${fmtKg(entry.kg)} on ${dateLabel(entry.date)}.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await deleteBodyweight(entry.id);
          setConfirmOpen(false);
          toast('Reading deleted');
          onClose();
        }}
      />
    </>
  );
}
