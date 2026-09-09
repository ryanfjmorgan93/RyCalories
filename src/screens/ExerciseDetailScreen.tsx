import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { routineUsageForExercise, type RoutineUsage } from '@/db/exerciseDetailQueries';
import { exerciseHistory, lockInRoutineExercise, unlockRoutineExercise, type HistoryEntry } from '@/db/repo';
import { fmtDate, fmtDateLong, fmtKg, fmtNum, fmtWeight, targetLine } from '@/domain/format';
import type { Exercise, ExerciseKind, ProgressionDecision, ProgressionRule, RoutineExercise, SetLog } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { NumberField } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';

const DECISIONS_CAP = 12;
const HISTORY_CAP = 30;

export function ExerciseDetailScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  // null = not found, undefined = loading.
  const exercise = useLiveQuery(async () => (id ? ((await db.exercises.get(id)) ?? null) : null), [id]);
  const usage = useLiveQuery(() => (id ? routineUsageForExercise(id) : []), [id]);
  const history = useLiveQuery(() => (id ? exerciseHistory(id) : []), [id]);

  const [lockRx, setLockRx] = useState<RoutineExercise | null>(null);
  const [unlockRx, setUnlockRx] = useState<RoutineExercise | null>(null);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_CAP);

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
  const chartPoints = chartPointsFor(history, kind);
  const shownHistory = history.slice(0, historyLimit);

  return (
    <div>
      <TopBar
        title={exercise.name}
        back="/exercises"
        right={
          <Button size="sm" variant="ghost" className="mr-2" onClick={() => nav(`/exercises/${exercise.id}/edit`)}>
            Edit
          </Button>
        }
      />
      <div className="px-4">
        <div className="px-1 text-sm text-muted">{metaLine(exercise)}</div>

        <SectionTitle>In routines</SectionTitle>
        {usage.length === 0 && <EmptyState>Not in any routine</EmptyState>}
        {usage.map((u) => (
          <RoutineCard key={u.rx.id} usage={u} kind={kind} onLockIn={() => setLockRx(u.rx)} onUnlock={() => setUnlockRx(u.rx)} />
        ))}

        <SectionTitle>Top set</SectionTitle>
        <Card className="p-3">
          <LineChart points={chartPoints} unit={kind === 'timed' ? ' s' : ' kg'} height={180} emptyText="No sessions yet" />
        </Card>

        <SectionTitle>History</SectionTitle>
        <Card>
          {shownHistory.map((h, i) => (
            <div key={h.session.id}>
              {i > 0 && <Divider />}
              <Row
                onClick={() => nav(`/history/${h.session.id}`)}
                title={
                  <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                    <span className="truncate">
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
  onClose,
  onSave,
}: {
  rx: RoutineExercise;
  kind: ExerciseKind;
  suggested: number;
  onClose: () => void;
  onSave: (weight: number) => void;
}) {
  const [weight, setWeight] = useState<number | null>(suggested);
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
        <Button size="lg" variant="primary" disabled={weight === null} onClick={() => weight !== null && onSave(weight)} data-testid="lock-in-save">
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
      const secs = h.sets.filter((s) => s.type === 'working').map((s) => s.seconds ?? 0);
      if (secs.length === 0) continue;
      y = Math.max(...secs);
    }
    pts.push({ t, y });
  }
  return pts.sort((a, b) => a.t - b.t);
}

/** "110 × 8, 8, 8, 8" — consecutive working sets grouped by weight; warm-ups appended dimmed. */
function SetsLine({ sets, kind }: { sets: SetLog[]; kind: ExerciseKind }) {
  const working = useMemo(() => sets.filter((s) => s.type === 'working'), [sets]);
  const warmups = useMemo(() => sets.filter((s) => s.type === 'warmup'), [sets]);
  const main = working.length ? groupedLine(working, kind) : 'no working sets';
  return (
    <span>
      <span className="num">{main}</span>
      {warmups.length > 0 && <span className="text-dim"> · W: {warmups.map((s) => warmupLabel(s, kind)).join(', ')}</span>}
    </span>
  );
}

function weightLabel(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'bodyweight_plus') return s.weight === 0 ? 'BW' : `+${fmtNum(s.weight)}`;
  return fmtNum(s.weight);
}

function groupedLine(sets: SetLog[], kind: ExerciseKind): string {
  if (kind === 'carry') {
    return sets
      .map((s) => {
        const parts = [fmtKg(s.weight)];
        if (s.distanceM !== undefined) parts.push(`${fmtNum(s.distanceM)} m`);
        if (s.seconds !== undefined) parts.push(`${fmtNum(s.seconds)} s`);
        return parts.join(' · ');
      })
      .join(', ');
  }
  if (kind === 'timed') return sets.map((s) => `${fmtNum(s.seconds ?? 0)} s`).join(', ');
  const groups: { w: string; reps: number[] }[] = [];
  for (const s of sets) {
    const w = weightLabel(s, kind);
    const last = groups[groups.length - 1];
    if (last && last.w === w) last.reps.push(s.reps ?? 0);
    else groups.push({ w, reps: [s.reps ?? 0] });
  }
  return groups.map((g) => `${g.w} × ${g.reps.join(', ')}`).join(' · ');
}

function warmupLabel(s: SetLog, kind: ExerciseKind): string {
  if (kind === 'carry') return `${fmtNum(s.weight)}×${s.distanceM !== undefined ? `${fmtNum(s.distanceM)}m` : `${fmtNum(s.seconds ?? 0)}s`}`;
  if (kind === 'timed') return `${fmtNum(s.seconds ?? 0)}s`;
  return `${weightLabel(s, kind)}×${s.reps ?? 0}`;
}
