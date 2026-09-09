import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyReconciledWeights,
  planHevyImport,
  reconcileWeights,
  runHevyImport,
  type HevyImportPlan,
  type HevyImportResult,
  type HevyParsed,
  type WeightReconcileRow,
} from '@/db/hevy';
import { dateKeyToDate } from '@/domain/dates';
import { fmtDate, fmtWeight } from '@/domain/format';
import { Button } from '@/ui/components/Button';
import { Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { CheckIcon } from '@/ui/components/TopBar';
import { useExercises, useRoutines } from '@/ui/hooks';

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

export function HevyImportSheet({
  parsed,
  open,
  onClose,
  onDone,
}: {
  parsed: HevyParsed;
  open: boolean;
  onClose: () => void;
  onDone: (result: HevyImportResult) => void;
}) {
  const exercises = useExercises();
  const routines = useRoutines();
  const [plan, setPlan] = useState<HevyImportPlan | null>(null);
  // Only dumbbell lifts can have been logged as a pair total; keep the toggle off the rest.
  const dumbbellTitles = new Set(parsed.exercises.filter((e) => e.isDumbbell).map((e) => e.title));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HevyImportResult | null>(null);
  const [rows, setRows] = useState<WeightReconcileRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPlan(null);
    setResult(null);
    setRows(null);
    void planHevyImport(parsed).then((p) => {
      if (alive) setPlan(p);
    });
    return () => {
      alive = false;
    };
  }, [open, parsed]);

  const totalSets = useMemo(() => parsed.sessions.reduce((n, s) => n + s.sets.length, 0), [parsed]);
  const measurementRange = useMemo(() => {
    const dates = parsed.measurements.map((m) => m.date).sort();
    return dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null;
  }, [parsed]);

  const finish = (r: HevyImportResult) => {
    if (parsed.kind === 'measurements') toast(`Imported ${r.bodyweightWritten} bodyweight readings`, 'ok');
    else toast(`Imported ${r.sessionsNew + r.sessionsUpdated} sessions, ${r.setsWritten} sets (${r.sessionsUpdated} updated)`, 'ok');
    onDone(r);
  };

  const runImport = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const r = await runHevyImport(parsed, plan);
      if (parsed.kind === 'measurements') {
        finish(r);
        return;
      }
      const rec = await reconcileWeights();
      if (rec.length === 0) {
        finish(r);
        return;
      }
      setResult(r);
      setRows(rec);
      setSelected(new Set(rec.map((x) => x.rx.id)));
    } catch {
      toast('Import failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const applySelected = async () => {
    if (!rows || !result || busy) return;
    setBusy(true);
    try {
      await applyReconciledWeights(rows.filter((r) => selected.has(r.rx.id)));
      finish(result);
    } finally {
      setBusy(false);
    }
  };

  const setExercise = (title: string, exerciseId: string | null) => {
    const ex = exerciseId ? exercises?.find((e) => e.id === exerciseId) : undefined;
    setPlan((p) =>
      p
        ? {
            ...p,
            exercises: p.exercises.map((e) =>
              e.title === title ? { ...e, exerciseId: ex?.id ?? null, exerciseName: ex?.name ?? null, matched: ex ? 'name' : 'none' } : e,
            ),
          }
        : p,
    );
  };
  const toggleHalve = (title: string) =>
    setPlan((p) => (p ? { ...p, exercises: p.exercises.map((e) => (e.title === title ? { ...e, halve: !e.halve } : e)) } : p));
  const setRoutine = (title: string, routineId: string | null) => {
    const r = routineId ? routines?.find((x) => x.id === routineId) : undefined;
    setPlan((p) =>
      p ? { ...p, routines: p.routines.map((x) => (x.title === title ? { ...x, routineId: r?.id ?? null, routineName: r?.name ?? null } : x)) } : p,
    );
  };

  // Reconcile step (same sheet, after the import has run).
  if (rows && result) {
    return (
      <Sheet
        open={open}
        onClose={() => finish(result)}
        title="Update current weights?"
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" disabled={busy} onClick={() => finish(result)}>
              Keep mine
            </Button>
            <Button size="lg" variant="primary" disabled={busy || selected.size === 0} onClick={() => void applySelected()}>
              Apply selected
            </Button>
          </div>
        }
      >
        <ReconcileList rows={rows} selected={selected} onToggle={(id) => setSelected(toggled(selected, id))} />
      </Sheet>
    );
  }

  const importLabel =
    parsed.kind === 'measurements' ? 'Import' : `Import ${parsed.sessions.length} ${parsed.sessions.length === 1 ? 'session' : 'sessions'}`;

  return (
    <Sheet
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Import Hevy CSV"
      footer={
        <Button size="xl" variant="primary" full disabled={!plan || busy} onClick={() => void runImport()}>
          {busy ? 'Importing…' : importLabel}
        </Button>
      }
    >
      {parsed.kind === 'measurements' && (
        <div className="text-base">
          <span className="num font-extrabold">{parsed.measurements.length}</span> bodyweight readings
          {measurementRange && (
            <span className="text-muted">
              , {fmtDate(dateKeyToDate(measurementRange.first).toISOString(), DATE_OPTS)} → {fmtDate(dateKeyToDate(measurementRange.last).toISOString(), DATE_OPTS)}
            </span>
          )}
        </div>
      )}

      {parsed.kind === 'workouts' && (
        <>
          <div className="flex items-end gap-6">
            <Stat label="Sessions" value={parsed.sessions.length} />
            <Stat label="Sets" value={totalSets} />
            {parsed.sessions.length > 0 && (
              <Stat
                label="Dates"
                value={
                  <span className="text-base">
                    {fmtDate(parsed.sessions[0].start.toISOString())} → {fmtDate(parsed.sessions[parsed.sessions.length - 1].start.toISOString(), DATE_OPTS)}
                  </span>
                }
              />
            )}
          </div>
          {parsed.warnings.length > 0 && (
            <div className="mt-3 grid gap-1 text-sm text-warn">
              {parsed.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
          {parsed.skippedRows > 0 && <div className="mt-1 text-sm text-muted">{parsed.skippedRows} rows skipped</div>}

          <Heading>Exercises</Heading>
          {!plan && <div className="text-sm text-muted">Matching…</div>}
          {plan && (
            <div className="overflow-hidden rounded-xl border border-line">
              {plan.exercises.map((p, i) => (
                <div key={p.title} className={`px-3 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-bold">{p.title}</span>
                    {p.matched === 'none' && (
                      <Chip size="sm" tone="info">
                        New exercise
                      </Chip>
                    )}
                    {dumbbellTitles.has(p.title) && (
                      <Chip size="md" tone="accent" active={p.halve} onClick={() => toggleHalve(p.title)}>
                        ÷2 pair total
                      </Chip>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Select value={p.exerciseId ?? ''} onChange={(v) => setExercise(p.title, v || null)} className="min-w-0 flex-1">
                      <option value="">Create new</option>
                      {(exercises ?? []).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </Select>
                    {p.halve && <span className="shrink-0 text-xs text-muted">logged as both dumbbells</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Heading>Routines</Heading>
          {plan && (
            <div className="overflow-hidden rounded-xl border border-line">
              {plan.routines.map((r, i) => (
                <div key={r.title} className={`px-3 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-bold">{r.title}</span>
                    <span className="num shrink-0 text-sm text-muted">
                      {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}
                    </span>
                  </div>
                  <Select value={r.routineId ?? ''} onChange={(v) => setRoutine(r.title, v || null)} className="mt-1.5 w-full">
                    <option value="">No routine</option>
                    {(routines ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}
          <div className="h-2" />
        </>
      )}
    </Sheet>
  );
}

/** Standalone reconcile sheet for Settings → "Reconcile weights with history". */
export function ReconcileSheet({
  rows,
  open,
  onClose,
}: {
  rows: WeightReconcileRow[];
  open: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((r) => r.rx.id)));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setSelected(new Set(rows.map((r) => r.rx.id)));
  }, [open, rows]);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const chosen = rows.filter((r) => selected.has(r.rx.id));
      await applyReconciledWeights(chosen);
      toast(`Updated ${chosen.length} ${chosen.length === 1 ? 'weight' : 'weights'}`, 'ok');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Update current weights?"
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" disabled={busy} onClick={onClose}>
            Keep mine
          </Button>
          <Button size="lg" variant="primary" disabled={busy || selected.size === 0} onClick={() => void apply()}>
            Apply selected
          </Button>
        </div>
      }
    >
      <ReconcileList rows={rows} selected={selected} onToggle={(id) => setSelected(toggled(selected, id))} />
    </Sheet>
  );
}

function ReconcileList({ rows, selected, onToggle }: { rows: WeightReconcileRow[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {rows.map((r, i) => {
        const on = selected.has(r.rx.id);
        const kind = r.exercise.kind;
        const from = r.rx.mode === 'calibrating' ? 'calibrating' : `current ${fmtWeight(kind, r.current)}`;
        return (
          <button
            key={r.rx.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(r.rx.id)}
            className={`flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2 ${i > 0 ? 'border-t border-line' : ''}`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${on ? 'border-ok bg-ok text-ok-fg' : 'border-line'}`}>
              {on && <CheckIcon size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                <span className="text-muted">{r.routineName} · </span>
                {r.exercise.name}
              </span>
              <span className="num block text-sm text-muted">
                {from} → latest <span className="font-bold text-fg">{fmtWeight(kind, r.latest)}</span> ({fmtDate(r.latestDate)}, reps {r.reps.join('/')})
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-2 pt-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">{children}</div>;
}

/** Native select styled like the form inputs (system picker on Android). */
function Select({ value, onChange, className = '', children }: { value: string; onChange: (v: string) => void; className?: string; children: ReactNode }) {
  return (
    <span className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none truncate rounded-xl border border-line bg-surface-2 pl-3 pr-8 text-sm font-semibold outline-none focus:border-accent"
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}
