import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { gatherContext } from '@/db/assistantQueries';
import { routineUsageForExercise, type RoutineUsage } from '@/db/exerciseDetailQueries';
import { bestsForExercise } from '@/db/recordsQueries';
import { lockInRoutineExercise, unlockRoutineExercise, type HistoryEntry } from '@/db/repo';
import { fmtDate, fmtDateLong, fmtKg, fmtNum, fmtSetsLine, fmtWeight, targetLine } from '@/domain/format';
import type { Bests } from '@/domain/records';
import { strengthLevel, type StrengthStandard } from '@/domain/standards';
import { countsForProgression, countsForRecords } from '@/domain/sets';
import type { Exercise, ExerciseKind, ProgressionDecision, ProgressionRule, RoutineExercise, SetLog } from '@/domain/types';
import { useAssistant } from '@/state/assistant';
import { AssistantBox } from '@/ui/AssistantBox';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Chip, Segmented } from '@/ui/components/Chip';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { NumberField } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { ExerciseDemo } from '@/ui/ExerciseDemo';
import { useExerciseSeries, useSettings, useToday } from '@/ui/hooks';

const DECISIONS_CAP = 12;
const HISTORY_CAP = 30;

type ChartMode = 'top' | 'e1rm' | 'volume';

const CHART_MODES: { value: ChartMode; label: string }[] = [
  { value: 'top', label: 'Top set' },
  { value: 'e1rm', label: 'e1RM' },
  { value: 'volume', label: 'Volume' },
];

export function ExerciseDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const today = useToday();
  const settings = useSettings();
  // null = not found, undefined = loading.
  const exercise = useLiveQuery(async () => (id ? ((await db.exercises.get(id)) ?? null) : null), [id]);
  const usage = useLiveQuery(() => (id ? routineUsageForExercise(id) : []), [id]);
  const series = useExerciseSeries(id);
  const history = series?.history;
  const bests = useLiveQuery(() => (id ? bestsForExercise(id) : undefined), [id]);
  const bodyweightKg = useLiveQuery(async () => {
    const rows = await db.bodyweight.toArray();
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.date.localeCompare(a.date))[0].kg;
  }, []);
  const assistantContext = useLiveQuery(
    async () => (settings && id ? gatherContext({ today, settings, exerciseId: id }) : undefined),
    [today, settings, id],
  );

  const [lockRx, setLockRx] = useState<RoutineExercise | null>(null);
  const [unlockRx, setUnlockRx] = useState<RoutineExercise | null>(null);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_CAP);
  const [chartMode, setChartMode] = useState<ChartMode>('top');
  const [askOpen, setAskOpen] = useState(false);

  const assistantStatus = useAssistant((s) => s.status);
  const refreshAssistantStatus = useAssistant((s) => s.refreshStatus);
  useEffect(() => {
    void refreshAssistantStatus();
  }, [refreshAssistantStatus]);

  if (exercise === undefined || usage === undefined || history === undefined) {
    return (
      <div>
        <TopBar title="Exercise" back="/exercises" />
        <div className="px-4 py-8 text-muted">Loading…</div>
      </div>
    );
  }

  if (exercise === null) {
    return (
      <div>
        <TopBar title="Exercise" back="/exercises" />
        <div className="px-4 py-8">
          <EmptyState>Exercise not found</EmptyState>
        </div>
      </div>
    );
  }

  const kind = exercise.kind;
  const chartPoints =
    chartMode === 'e1rm' ? (series?.e1rm ?? []) : chartMode === 'volume' ? (series?.volume ?? []) : chartPointsFor(history, kind);
  const chartUnit = chartMode === 'e1rm' ? ' kg' : chartMode === 'volume' ? '' : kind === 'timed' ? ' s' : ' kg';
  const shownHistory = history.slice(0, historyLimit);

  return (
    <div>
      <TopBar
        title={exercise.name}
        back="/exercises"
        right={
          <div className="flex items-center">
            <IconButton
              label="Ask"
              onClick={() => setAskOpen(true)}
              disabled={assistantStatus?.state !== 'ready'}
              data-testid="ask-assistant"
            >
              <AskIcon />
            </IconButton>
            <Button size="md" variant="ghost" className="mr-1" onClick={() => nav(`/exercises/${exercise.id}/edit`)}>
              Edit
            </Button>
          </div>
        }
      />
      <div className="px-4">
        <div className="px-1 text-sm text-muted">{metaLine(exercise)}</div>

        {exercise.demo && (
          <div className="mt-3 flex justify-center">
            <ExerciseDemo slug={exercise.demo} name={exercise.name} videoUrl={exercise.videoUrl} size="sm" />
          </div>
        )}

        <SectionTitle>In routines</SectionTitle>
        {usage.length === 0 && <EmptyState>Not in any routine</EmptyState>}
        {usage.map((u) => (
          <RoutineCard key={u.rx.id} usage={u} kind={kind} onLockIn={() => setLockRx(u.rx)} onUnlock={() => setUnlockRx(u.rx)} />
        ))}

        <SectionTitle>Chart</SectionTitle>
        <div data-testid="chart-mode">
          <Segmented value={chartMode} onChange={setChartMode} options={CHART_MODES} />
        </div>
        <div className="h-3" />
        <Card className="p-3">
          <LineChart points={chartPoints} unit={chartUnit} height={180} emptyText="No sessions yet" />
        </Card>

        {bests && (bests.weight !== null || bests.e1rm !== null || bests.setVolume !== null) && (
          <>
            <SectionTitle>Records</SectionTitle>
            <RecordsCard bests={bests} kind={kind} standard={exercise.standard} bodyweightKg={bodyweightKg ?? null} />
          </>
        )}

        <SectionTitle>History</SectionTitle>
        <Card>
          {shownHistory.map((h, i) => (
            <div key={h.session.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/history/${h.session.id}`)}
                title={
                  <span className="flex min-w-0 max-w-full items-center gap-2">
                    <span className="min-w-0 truncate">
                      {fmtDateLong(h.session.startedAt)} · {h.session.title}
                    </span>
                    {h.session.source === 'hevy' && (
                      <Chip size="sm" tone="info">
                        Hevy
                      </Chip>
                    )}
                  </span>
                }
                subtitle={<SetsLine sets={h.sets} kind={kind} />}
                right={<ChevronIcon />}
              />
            </div>
          ))}
          {history.length === 0 && (
            <div className="p-4">
              <EmptyState>No sessions yet</EmptyState>
            </div>
          )}
          {history.length > shownHistory.length && (
            <>
              <Divider />
              <Button full variant="ghost" size="lg" onClick={() => setHistoryLimit((n) => n + HISTORY_CAP)}>
                Show more
              </Button>
            </>
          )}
        </Card>
        <div className="h-6" />
      </div>

      {lockRx && (
        <LockInSheet
          rx={lockRx}
          kind={kind}
          suggested={history[0]?.topWeight ?? 0}
          hasHistory={history.length > 0}
          onClose={() => setLockRx(null)}
          onSave={async (w) => {
            await lockInRoutineExercise(lockRx.id, w);
            setLockRx(null);
            toast(`Locked in at ${fmtWeight(kind, w)}`, 'ok');
          }}
        />
      )}

      <Confirm
        open={unlockRx !== null}
        title="Set calibrating?"
        body="No weight will be prescribed until you lock in again. Progression history is kept."
        confirmLabel="Set calibrating"
        onCancel={() => setUnlockRx(null)}
        onConfirm={async () => {
          if (unlockRx) await unlockRoutineExercise(unlockRx.id);
          setUnlockRx(null);
          toast('Calibrating');
        }}
      />

      {assistantContext && <AssistantBox open={askOpen} onClose={() => setAskOpen(false)} context={assistantContext} title={exercise.name} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta

function metaLine(e: Exercise): string {
  const parts: string[] = [e.muscleGroup, e.isCompound ? 'compound' : 'isolation'];
  if (e.kind === 'bodyweight_plus') parts.push('bodyweight +kg');
  else if (e.kind === 'carry') parts.push('carry');
  else if (e.kind === 'timed') parts.push('timed');
  else parts.push('reps');
  if (e.unilateral) parts.push('per side');
  parts.push(`rest ${Math.round(e.defaultRestSec)} s`);
  parts.push(`+${fmtNum(e.defaultIncrement)} kg steps`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Records

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="num font-bold">{value}</span>
    </div>
  );
}

function RecordsCard({
  bests,
  kind,
  standard,
  bodyweightKg,
}: {
  bests: Bests;
  kind: ExerciseKind;
  standard?: StrengthStandard;
  bodyweightKg: number | null;
}) {
  const topWeights = [...bests.repsAtWeight.entries()].sort((a, b) => b[0] - a[0]).slice(0, 3);
  return (
    <Card className="p-4" data-testid="exercise-records">
      {bests.weight !== null && <RecordRow label="Best weight" value={fmtWeight(kind, bests.weight)} />}
      {bests.e1rm !== null && <RecordRow label="Best e1RM" value={fmtKg(bests.e1rm)} />}
      {bests.setVolume !== null && <RecordRow label="Best set volume" value={`${fmtNum(bests.setVolume)} kg`} />}
      {topWeights.map(([w, reps]) => (
        <RecordRow key={w} label={`At ${fmtWeight(kind, w)}`} value={`${reps} reps`} />
      ))}
      {standard && bodyweightKg !== null && bests.e1rm !== null && (
        <div className="mt-1 border-t border-line pt-2 text-sm text-muted">
          {(() => {
            const s = strengthLevel(standard, bests.e1rm as number, bodyweightKg);
            return `${fmtNum(s.ratio)} × bodyweight · ${s.level}`;
          })()}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Routine card

function RoutineCard({ usage, kind, onLockIn, onUnlock }: { usage: RoutineUsage; kind: ExerciseKind; onLockIn: () => void; onUnlock: () => void }) {
  const nav = useNavigate();
  const { routine, rx, stall, decisions } = usage;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? decisions : decisions.slice(0, DECISIONS_CAP);
  const calibrating = rx.mode === 'calibrating';

  return (
    <Card className="mb-3 overflow-hidden">
      <div className="px-4 pt-4">
        <div className="text-lg font-extrabold leading-tight">{routine.name}</div>
        <div className="mt-0.5 text-sm text-muted">{targetLine(rx, kind)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {calibrating && (
            <Chip size="sm" tone="info">
              calibrating
            </Chip>
          )}
          {rx.optional && <Chip size="sm">optional</Chip>}
          {stall && (
            <Chip size="sm" tone="warn">
              Stalled · {stall.sessions} sessions at {fmtWeight(kind, stall.weight)}
            </Chip>
          )}
          <span className="text-xs text-muted">increment +{fmtNum(rx.increment)} kg</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {calibrating ? (
            <Button variant="primary" onClick={onLockIn} data-testid={`lock-in-${routine.name}`}>
              Lock in
            </Button>
          ) : (
            <Button variant="ghost" onClick={onUnlock}>
              Set calibrating
            </Button>
          )}
          <Button variant="outline" onClick={() => nav(`/routines/${routine.id}`)}>
            Edit in routine
          </Button>
        </div>
      </div>

      {decisions.length > 0 && (
        <div className="mt-3 border-t border-line">
          {shown.map((d) => (
            <DecisionRow key={d.id} d={d} kind={kind} />
          ))}
          {decisions.length > DECISIONS_CAP && (
            <Button full variant="ghost" className="my-1" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${decisions.length}`}
            </Button>
          )}
        </div>
      )}
      {decisions.length === 0 && <div className="border-t border-line px-4 py-3 text-xs text-muted">No decisions yet</div>}
    </Card>
  );
}

const RULE_LABEL: Record<ProgressionRule, string> = {
  increase: 'up',
  hold: 'hold',
  hold_missing_sets: 'hold (missed sets)',
  calibrating: 'calibrating',
  not_applicable: 'no decision',
  lock_in: 'locked in',
  deload: 'deload',
};

function DecisionRow({ d, kind }: { d: ProgressionDecision; kind: ExerciseKind }) {
  const up = d.rule === 'increase';
  const w = (n: number) => fmtWeight(kind, n);
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-sm last:border-b-0">
      <span className="num w-14 shrink-0 text-muted">{fmtDate(d.decidedAt)}</span>
      <span className={`shrink-0 font-bold ${up ? 'text-ok' : 'text-fg'}`}>{RULE_LABEL[d.rule]}</span>
      <span className={`num min-w-0 flex-1 truncate ${up ? 'text-ok' : 'text-muted'}`}>
        {d.rule === 'calibrating' || d.rule === 'not_applicable' ? '' : `${w(d.fromWeight)} → ${w(d.toWeight)}`}
        {d.overrideTo !== undefined && <span className="text-accent"> · override to {w(d.overrideTo)}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lock-in sheet

function LockInSheet({
  rx,
  kind,
  suggested,
  hasHistory,
  onClose,
  onSave,
}: {
  rx: RoutineExercise;
  kind: ExerciseKind;
  suggested: number;
  hasHistory: boolean;
  onClose: () => void;
  onSave: (weight: number) => void;
}) {
  const [weight, setWeight] = useState<number | null>(suggested);
  // 0 kg with no history at all would silently set this lift's working weight to nothing — block
  // that specific combination rather than a bare `weight === null` check.
  const blocked = weight === null || (weight === 0 && !hasHistory);
  return (
    <Sheet open onClose={onClose} title="Lock in">
      <div className="text-sm text-muted">Double progression starts next session from this weight.</div>
      <div className="mt-4">
        <NumberField label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'} value={weight} onChange={setWeight} step={rx.increment} testId="lock-in-weight" />
      </div>
      <div className="mt-2 text-xs text-muted">
        {rx.repMin}–{rx.repMax} reps · +{fmtNum(rx.increment)} kg per step
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" variant="primary" disabled={blocked} onClick={() => weight !== null && onSave(weight)} data-testid="lock-in-save">
          Save
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Chart + history formatting

function chartPointsFor(history: HistoryEntry[], kind: ExerciseKind): ChartPoint[] {
  const pts: ChartPoint[] = [];
  for (const h of history) {
    const t = Date.parse(h.session.startedAt);
    if (Number.isNaN(t)) continue;
    let y = h.topWeight;
    if (kind === 'timed') {
      const secs = h.sets.filter((s) => countsForProgression(s.type)).map((s) => s.seconds ?? 0);
      if (secs.length === 0) continue;
      y = Math.max(...secs);
    }
    pts.push({ t, y });
  }
  return pts.sort((a, b) => a.t - b.t);
}

/** "110 × 8, 8, 8, 8" — sets that count for records grouped by weight; warm-ups and drop sets appended dimmed. */
function SetsLine({ sets, kind }: { sets: SetLog[]; kind: ExerciseKind }) {
  const counted = useMemo(() => sets.filter((s) => countsForRecords(s.type)), [sets]);
  const warmups = useMemo(() => sets.filter((s) => s.type === 'warmup'), [sets]);
  const drops = useMemo(() => sets.filter((s) => s.type === 'drop'), [sets]);
  const main = counted.length ? fmtSetsLine(counted, kind) : 'no working sets';
  return (
    <span>
      <span className="num">{main}</span>
      {warmups.length > 0 && <span className="text-dim"> · W: {warmups.map((s) => dimSetLabel(s, kind)).join(', ')}</span>}
      {drops.length > 0 && <span className="text-dim"> · D: {drops.map((s) => dimSetLabel(s, kind)).join(', ')}</span>}
    </span>
  );
}

function weightLabel(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'bodyweight_plus') return s.weight === 0 ? 'BW' : `+${fmtNum(s.weight)}`;
  return fmtNum(s.weight);
}

function dimSetLabel(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'carry') return `${fmtNum(s.weight)}×${s.distanceM !== undefined ? `${fmtNum(s.distanceM)}m` : `${fmtNum(s.seconds ?? 0)}s`}`;
  if (kind === 'timed') return `${fmtNum(s.seconds ?? 0)}s`;
  return `${weightLabel(s, kind)}×${s.reps ?? 0}`;
}

function AskIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 8v3M12 14h.01" />
    </svg>
  );
}
