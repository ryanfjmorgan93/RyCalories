import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import {
  addExtraExercise,
  deleteSet,
  discardSession,
  logSet,
  previousSets,
  removeExtraExercise,
  setSkipped,
  updateSet,
  type PreviousSets,
} from '@/db/repo';
import { fmtDate, fmtDuration, fmtKg, fmtNum, fmtWeight, targetLine } from '@/domain/format';
import type { Exercise, RoutineExercise, Session, SetLog, Settings } from '@/domain/types';
import { primeAudio, requestNotificationsOnce, vibrate } from '@/state/notify';
import { useTimer } from '@/state/timer';
import { Button, IconButton } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { NumberField } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { CheckIcon, MoreIcon, TopBar } from '@/ui/components/TopBar';
import { ExercisePicker } from '@/ui/ExercisePicker';
import { useNow, useRoutine, useRoutineItems, useSettings } from '@/ui/hooks';

interface Draft {
  weight: number | null;
  reps: number | null;
  rir: number | null;
  distanceM: number | null;
  seconds: number | null;
  warmup: boolean;
}

interface Slot {
  key: string;
  rx: RoutineExercise | null;
  exercise: Exercise;
  optional: boolean;
}

export function LiveSessionScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const session = useLiveQuery(async () => (id ? ((await db.sessions.get(id)) ?? null) : null), [id]);
  const routine = useRoutine(session?.routineId || undefined);
  const items = useRoutineItems(session?.routineId || undefined);
  const settings = useSettings();
  const sets = useLiveQuery(() => (id ? db.setLogs.where('sessionId').equals(id).toArray() : []), [id]);
  const extras = useLiveQuery(async () => {
    const ids = session?.extraExerciseIds ?? [];
    if (ids.length === 0) return [] as Exercise[];
    return (await db.exercises.bulkGet(ids)).filter((e): e is Exercise => !!e);
  }, [session?.extraExerciseIds?.join(',')]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (session === null) nav('/', { replace: true });
    else if (session && session.endedAt) nav(`/history/${session.id}`, { replace: true });
  }, [session, nav]);

  const slots: Slot[] = useMemo(() => {
    const base = (items ?? []).map<Slot>((i) => ({ key: i.rx.id, rx: i.rx, exercise: i.exercise, optional: i.rx.optional }));
    const required = base.filter((s) => !s.optional);
    const optional = base.filter((s) => s.optional);
    const extra = (extras ?? []).map<Slot>((e) => ({ key: `x:${e.id}`, rx: null, exercise: e, optional: false }));
    return [...required, ...extra, ...optional];
  }, [items, extras]);

  const setsBySlot = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const s of sets ?? []) {
      const key = s.routineExerciseId ?? `x:${s.exerciseId}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.index - b.index || a.completedAt.localeCompare(b.completedAt));
    return m;
  }, [sets]);

  const skipped = useMemo(() => new Set(session?.skippedRoutineExerciseIds ?? []), [session?.skippedRoutineExerciseIds]);

  const currentKey = useMemo(() => {
    for (const s of slots) {
      if (s.rx && skipped.has(s.rx.id)) continue;
      const done = (setsBySlot.get(s.key) ?? []).filter((x) => x.type === 'working').length;
      const target = s.rx?.targetSets ?? 3;
      if (done < target) return s.key;
    }
    return null;
  }, [slots, setsBySlot, skipped]);

  if (!session || !settings || (session.routineId && (!routine || !items))) {
    return (
      <div>
        <TopBar title="Session" back="/" />
        <div className="px-4 py-8 text-muted">Loading…</div>
      </div>
    );
  }

  const requiredUndone = slots.filter((s) => !s.optional && s.rx && !skipped.has(s.rx.id) && (setsBySlot.get(s.key) ?? []).length === 0);
  const totalSets = (sets ?? []).length;

  const finish = () => {
    if (requiredUndone.length > 0 || totalSets === 0) setFinishOpen(true);
    else nav(`/session/${session.id}/summary`);
  };

  return (
    <div className="pb-safe-timer">
      <SessionHeader session={session} targetMinutes={routine?.targetMinutes} onFinish={finish} />
      <div className="px-3">
        {slots.map((slot, i) => {
          const prevSlot = i > 0 ? slots[i - 1] : null;
          const showOptionalDivider = slot.optional && (!prevSlot || !prevSlot.optional);
          return (
            <div key={slot.key}>
              {showOptionalDivider && (
                <div className="flex items-center gap-3 px-1 pt-5 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-dim">
                  <span className="h-px flex-1 bg-line" />
                  Optional
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <ExerciseCard
                session={session}
                slot={slot}
                sets={setsBySlot.get(slot.key) ?? []}
                settings={settings}
                isCurrent={slot.key === currentKey}
                isSkipped={slot.rx ? skipped.has(slot.rx.id) : false}
              />
            </div>
          );
        })}

        <div className="mt-4 grid gap-3">
          <Button size="lg" variant="outline" full onClick={() => setPickerOpen(true)}>
            Add exercise (this session only)
          </Button>
          <Button size="lg" variant="ghost" full onClick={() => setDiscardOpen(true)}>
            Discard session
          </Button>
        </div>
        <div className="h-6" />
      </div>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exclude={slots.map((s) => s.exercise.id)}
        onPick={async (e) => {
          await addExtraExercise(session.id, e.id);
          setPickerOpen(false);
        }}
      />

      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Finish session?">
        {totalSets === 0 ? (
          <div className="text-muted">Nothing logged yet.</div>
        ) : (
          <div className="text-muted">
            Not done:{' '}
            <span className="text-fg">{requiredUndone.map((s) => s.exercise.name).join(', ')}</span>
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setFinishOpen(false)}>
            Keep going
          </Button>
          <Button size="lg" variant="primary" disabled={totalSets === 0} onClick={() => nav(`/session/${session.id}/summary`)}>
            Finish
          </Button>
        </div>
        {totalSets === 0 && (
          <Button
            className="mt-3"
            full
            variant="danger"
            onClick={async () => {
              await discardSession(session.id);
              useTimer.getState().skip();
              nav('/', { replace: true });
            }}
          >
            Discard session
          </Button>
        )}
      </Sheet>

      <Confirm
        open={discardOpen}
        title="Discard this session?"
        body="Its sets will be deleted. Weights stay as they are."
        confirmLabel="Discard"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={async () => {
          await discardSession(session.id);
          useTimer.getState().skip();
          nav('/', { replace: true });
          toast('Session discarded');
        }}
      />
    </div>
  );
}

function SessionHeader({ session, targetMinutes, onFinish }: { session: Session; targetMinutes?: number; onFinish: () => void }) {
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const over = targetMinutes !== undefined && elapsed > targetMinutes * 60;
  return (
    <TopBar
      title={session.title}
      back="/"
      subtitle={
        <span className={`num text-base font-extrabold ${over ? 'text-danger' : 'text-muted'}`} data-testid="session-clock">
          {fmtDuration(elapsed)}
          {targetMinutes ? <span className="text-xs font-semibold text-dim"> / {targetMinutes} min</span> : null}
        </span>
      }
      right={
        <Button variant="primary" size="md" onClick={onFinish} data-testid="finish-session" className="mr-2">
          Finish
        </Button>
      }
    />
  );
}

function restSecondsFor(rx: RoutineExercise | null, exercise: Exercise, settings: Settings): number {
  if (rx?.restSecOverride) return rx.restSecOverride;
  if (exercise.defaultRestSec) return exercise.defaultRestSec;
  if (exercise.kind === 'carry') return settings.restCarrySec;
  return exercise.isCompound ? settings.restCompoundSec : settings.restIsolationSec;
}

function ExerciseCard({
  session,
  slot,
  sets,
  settings,
  isCurrent,
  isSkipped,
}: {
  session: Session;
  slot: Slot;
  sets: SetLog[];
  settings: Settings;
  isCurrent: boolean;
  isSkipped: boolean;
}) {
  const nav = useNavigate();
  const { rx, exercise } = slot;
  const kind = exercise.kind;
  const ref = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [editing, setEditing] = useState<SetLog | null>(null);
  const [showRir, setShowRir] = useState(false);
  const timer = useTimer();

  const prev = useLiveQuery<PreviousSets | null>(() => previousSets(rx?.id ?? null, exercise.id, session.id), [rx?.id, exercise.id, session.id]);
  const prevWorking = useMemo(() => (prev?.sets ?? []).filter((s) => s.type === 'working'), [prev]);

  const workingDone = sets.filter((s) => s.type === 'working').length;
  const nextIndex = workingDone; // index among working sets
  const target = rx?.targetSets ?? 3;
  const complete = workingDone >= target;

  const defaultDraft = useCallback((): Draft => {
    const lastLogged = sets.length ? sets[sets.length - 1] : null;
    const lastWorking = [...sets].reverse().find((s) => s.type === 'working') ?? null;
    const prevSame = prevWorking[nextIndex] ?? prevWorking[prevWorking.length - 1] ?? null;
    let weight: number | null;
    // Keep whatever was actually on the bar this session; otherwise the prescription; otherwise last time.
    if (lastWorking) weight = lastWorking.weight;
    else if (rx && rx.mode === 'normal' && kind !== 'carry' && kind !== 'timed') weight = rx.currentWeight;
    else weight = prevSame?.weight ?? null;
    let reps: number | null = null;
    if (kind === 'reps' || kind === 'bodyweight_plus') {
      reps = prevSame?.reps ?? lastLogged?.reps ?? rx?.repMin ?? null;
    }
    return {
      weight,
      reps,
      rir: null,
      distanceM: kind === 'carry' ? prevSame?.distanceM ?? lastLogged?.distanceM ?? rx?.distanceMinM ?? null : null,
      seconds: kind === 'timed' ? prevSame?.seconds ?? lastLogged?.seconds ?? rx?.repMin ?? null : null,
      warmup: false,
    };
  }, [sets, prevWorking, nextIndex, rx, kind]);

  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const touched = useRef(false);
  const lastSetCount = useRef(sets.length);
  const prevLoaded = useRef(prev !== undefined);

  // Reset the draft when a set is logged (or removed), or when previous-session data arrives.
  useEffect(() => {
    if (sets.length !== lastSetCount.current || (!prevLoaded.current && prev !== undefined && !touched.current)) {
      lastSetCount.current = sets.length;
      prevLoaded.current = prev !== undefined;
      touched.current = false;
      setDraft(defaultDraft());
    }
  }, [sets.length, prev, defaultDraft]);

  useEffect(() => {
    if (isCurrent && ref.current) {
      const top = ref.current.getBoundingClientRect().top + window.scrollY - 64;
      if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [isCurrent]);

  const update = (patch: Partial<Draft>) => {
    touched.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  const canLog =
    kind === 'carry'
      ? draft.weight !== null && (draft.distanceM !== null || draft.seconds !== null)
      : kind === 'timed'
        ? draft.seconds !== null
        : draft.reps !== null && (draft.weight !== null || kind === 'bodyweight_plus');

  const busy = useRef(false);
  const [busyUi, setBusyUi] = useState(false);
  const logDone = async () => {
    if (!canLog || busy.current) return;
    busy.current = true;
    setBusyUi(true);
    primeAudio();
    vibrate(25);
    void requestNotificationsOnce();
    try {
    await logSet({
      sessionId: session.id,
      routineExerciseId: rx?.id ?? null,
      exerciseId: exercise.id,
      type: draft.warmup ? 'warmup' : 'working',
      weight: draft.weight ?? 0,
      reps: kind === 'reps' || kind === 'bodyweight_plus' ? (draft.reps ?? undefined) : undefined,
      distanceM: kind === 'carry' ? (draft.distanceM ?? undefined) : undefined,
      seconds: kind === 'carry' || kind === 'timed' ? (draft.seconds ?? undefined) : undefined,
      rir: draft.rir ?? undefined,
    });
    timer.start(restSecondsFor(rx, exercise, settings), exercise.name);
    } finally {
      busy.current = false;
      setBusyUi(false);
    }
  };

  const fill = (s: SetLog) => {
    update({ weight: s.weight, reps: s.reps ?? draft.reps, distanceM: s.distanceM ?? draft.distanceM, seconds: s.seconds ?? draft.seconds });
  };

  const inc = rx?.increment ?? exercise.defaultIncrement ?? 2.5;
  const tLine = rx ? targetLine(rx, kind) : 'this session only';
  const perSide = exercise.unilateral ? ' · per side' : '';
  const dimmed = isSkipped || (slot.optional && !isCurrent && sets.length === 0);

  return (
    <div ref={ref} className="pt-3">
      <Card className={`overflow-hidden ${isCurrent ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : ''} ${dimmed ? 'opacity-60' : ''}`} data-testid={`exercise-card-${exercise.name}`}>
        <div className="flex items-start gap-2 px-4 pt-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav(`/exercises/${exercise.id}`)}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-lg font-extrabold leading-tight">{exercise.name}</span>
              {rx?.mode === 'calibrating' && kind !== 'carry' && <Chip size="sm" tone="info">calibrating</Chip>}
              {slot.optional && <Chip size="sm">optional</Chip>}
              {!rx && <Chip size="sm">extra</Chip>}
              {isSkipped && <Chip size="sm" tone="warn">skipped</Chip>}
            </div>
            <div className="mt-0.5 text-sm text-muted">
              {tLine}
              {perSide} · rest {Math.round(restSecondsFor(rx, exercise, settings))} s
            </div>
          </button>
          <IconButton label="More" onClick={() => setMenuOpen(true)}>
            <MoreIcon />
          </IconButton>
        </div>

        {rx?.cue && <div className="px-4 pt-2 text-[15px] font-semibold leading-snug text-accent">{rx.cue}</div>}

        {prev && prevWorking.length > 0 && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto px-4 no-scrollbar">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">{fmtDate(prev.startedAt)}</span>
            {prevWorking.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => fill(s)}
                className="num min-h-11 shrink-0 rounded-lg border border-line bg-surface-2 px-3 text-base font-semibold text-muted active:bg-line"
              >
                {setLabel(s, kind)}
              </button>
            ))}
          </div>
        )}

        {sets.length > 0 && (
          <div className="mt-3 border-t border-line">
            {sets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setEditing(s)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left active:bg-surface-2"
              >
                <span className={`num w-7 text-center text-sm font-bold ${s.type === 'warmup' ? 'text-warn' : 'text-muted'}`}>
                  {s.type === 'warmup' ? 'W' : workingNumber(sets, s)}
                </span>
                <span className="num flex-1 text-lg font-bold">{setLabel(s, kind)}</span>
                {s.rir !== undefined && <span className="text-xs font-bold text-muted">RIR {s.rir}</span>}
                <span className="text-ok">
                  <CheckIcon size={20} />
                </span>
              </button>
            ))}
          </div>
        )}

        {!isSkipped && (
          <div className="px-4 pb-4 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                {draft.warmup ? 'Warm-up' : complete ? `Set ${nextIndex + 1} (target ${target})` : `Set ${nextIndex + 1} of ${target}`}
              </div>
              <div className="flex gap-2">
                <Chip size="lg" tone="warn" active={draft.warmup} onClick={() => update({ warmup: !draft.warmup })}>
                  Warm-up
                </Chip>
                {(kind === 'reps' || kind === 'bodyweight_plus') && (
                  <Chip size="lg" active={showRir} onClick={() => setShowRir((v) => !v)}>
                    RIR
                  </Chip>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {kind !== 'timed' && (
                <NumberField
                  label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'}
                  value={draft.weight}
                  onChange={(v) => update({ weight: v })}
                  step={inc}
                  fallback={rx?.mode === 'normal' ? rx.currentWeight : 0}
                  placeholder={kind === 'bodyweight_plus' ? '0' : 'kg'}
                  testId="weight-input"
                />
              )}
              {(kind === 'reps' || kind === 'bodyweight_plus') && (
                <NumberField label="Reps" value={draft.reps} onChange={(v) => update({ reps: v })} step={1} mode="numeric" fallback={rx?.repMin ?? 1} min={0} placeholder={rx ? `${rx.repMin}–${rx.repMax}` : 'reps'} testId="reps-input" />
              )}
              {kind === 'carry' && (
                <NumberField label="Metres" value={draft.distanceM} onChange={(v) => update({ distanceM: v })} step={5} mode="numeric" placeholder="m" testId="distance-input" />
              )}
              {kind === 'timed' && <NumberField label="Seconds" value={draft.seconds} onChange={(v) => update({ seconds: v })} step={5} mode="numeric" placeholder="s" testId="seconds-input" />}
            </div>
            {showRir && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">RIR</span>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <Chip key={n} size="lg" className="min-w-11 justify-center px-0" active={draft.rir === n} onClick={() => update({ rir: draft.rir === n ? null : n })}>
                    {n}
                  </Chip>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void logDone()}
              disabled={!canLog || busyUi}
              data-testid="set-done"
              className={`mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-2xl text-xl font-extrabold transition-[filter] active:brightness-90 disabled:opacity-40 ${
                complete && !draft.warmup ? 'bg-surface-2 text-fg border border-line' : 'bg-ok text-ok-fg'
              }`}
            >
              <CheckIcon />
              {draft.warmup ? 'Warm-up done' : 'Set done'}
            </button>
            {slot.optional && sets.length === 0 && (
              <Button className="mt-2" full variant="ghost" onClick={() => rx && void setSkipped(session.id, rx.id, true)}>
                Skip
              </Button>
            )}
          </div>
        )}
        {isSkipped && rx && (
          <div className="px-4 pb-4 pt-2">
            <Button full variant="ghost" onClick={() => void setSkipped(session.id, rx.id, false)}>
              Unskip
            </Button>
          </div>
        )}
      </Card>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={exercise.name}>
        <div className="grid gap-2">
          <Button
            full
            size="lg"
            onClick={() => {
              setMenuOpen(false);
              nav(`/exercises/${exercise.id}`);
            }}
          >
            History and details
          </Button>
          {rx && !isSkipped && (
            <Button
              full
              size="lg"
              onClick={() => {
                setMenuOpen(false);
                setSkipConfirm(true);
              }}
            >
              Skip this exercise
            </Button>
          )}
          {rx && isSkipped && (
            <Button
              full
              size="lg"
              onClick={() => {
                setMenuOpen(false);
                void setSkipped(session.id, rx.id, false);
              }}
            >
              Unskip
            </Button>
          )}
          {!rx && (
            <Button
              full
              size="lg"
              variant="danger"
              onClick={() => {
                setMenuOpen(false);
                setRemoveConfirm(true);
              }}
            >
              Remove from session
            </Button>
          )}
        </div>
      </Sheet>

      <Confirm
        open={skipConfirm}
        title={`Skip ${exercise.name}?`}
        body={sets.length > 0 ? 'Logged sets stay, but the exercise is marked skipped.' : 'It will be marked skipped for this session.'}
        confirmLabel="Skip"
        onCancel={() => setSkipConfirm(false)}
        onConfirm={() => {
          setSkipConfirm(false);
          if (rx) void setSkipped(session.id, rx.id, true);
        }}
      />

      <Confirm
        open={removeConfirm}
        title={`Remove ${exercise.name}?`}
        body={sets.length > 0 ? `${sets.length} logged ${sets.length === 1 ? 'set is' : 'sets are'} deleted.` : 'It was added for this session only.'}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoveConfirm(false)}
        onConfirm={async () => {
          setRemoveConfirm(false);
          await removeExtraExercise(session.id, exercise.id);
        }}
      />

      {editing && (
        <EditSetSheet
          set={editing}
          kind={kind}
          increment={inc}
          onClose={() => setEditing(null)}
          onDelete={async () => {
            await deleteSet(editing.id);
            setEditing(null);
          }}
          onSave={async (patch) => {
            await updateSet(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function workingNumber(sets: SetLog[], s: SetLog): number {
  let n = 0;
  for (const x of sets) {
    if (x.type === 'working') n++;
    if (x.id === s.id) break;
  }
  return n;
}

function setLabel(s: SetLog, kind: Exercise['kind']): string {
  if (kind === 'carry') {
    const parts = [fmtKg(s.weight)];
    if (s.distanceM !== undefined) parts.push(`${fmtNum(s.distanceM)} m`);
    if (s.seconds !== undefined) parts.push(`${fmtNum(s.seconds)} s`);
    return parts.join(' · ');
  }
  if (kind === 'timed') return `${fmtNum(s.seconds ?? 0)} s`;
  const w = kind === 'bodyweight_plus' ? (s.weight === 0 ? 'BW' : `+${fmtNum(s.weight)}`) : fmtNum(s.weight);
  return `${w} × ${s.reps ?? 0}`;
}

function EditSetSheet({
  set,
  kind,
  increment,
  onClose,
  onDelete,
  onSave,
}: {
  set: SetLog;
  kind: Exercise['kind'];
  increment: number;
  onClose: () => void;
  onDelete: () => void;
  onSave: (patch: Partial<Pick<SetLog, 'weight' | 'reps' | 'rir' | 'type' | 'distanceM' | 'seconds'>>) => void;
}) {
  const [weight, setWeight] = useState<number | null>(set.weight);
  const [reps, setReps] = useState<number | null>(set.reps ?? null);
  const [distanceM, setDistance] = useState<number | null>(set.distanceM ?? null);
  const [seconds, setSeconds] = useState<number | null>(set.seconds ?? null);
  const [rir, setRir] = useState<number | null>(set.rir ?? null);
  const [type, setType] = useState(set.type);
  return (
    <Sheet open onClose={onClose} title={`Edit set`}>
      <div className="mb-3 flex gap-2">
        <Chip active={type === 'working'} onClick={() => setType('working')}>
          Working
        </Chip>
        <Chip tone="warn" active={type === 'warmup'} onClick={() => setType('warmup')}>
          Warm-up
        </Chip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {kind !== 'timed' && <NumberField label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'} value={weight} onChange={setWeight} step={increment} />}
        {(kind === 'reps' || kind === 'bodyweight_plus') && <NumberField label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />}
        {kind === 'carry' && <NumberField label="Metres" value={distanceM} onChange={setDistance} step={5} mode="numeric" />}
        {(kind === 'carry' || kind === 'timed') && <NumberField label="Seconds" value={seconds} onChange={setSeconds} step={5} mode="numeric" />}
      </div>
      {(kind === 'reps' || kind === 'bodyweight_plus') && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">RIR</span>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} size="sm" active={rir === n} onClick={() => setRir(rir === n ? null : n)}>
              {n}
            </Chip>
          ))}
        </div>
      )}
      <div className="mt-5 grid grid-cols-[auto_1fr] gap-3">
        <Button size="lg" variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button
          size="lg"
          variant="primary"
          onClick={() =>
            onSave({
              weight: weight ?? 0,
              reps: reps ?? undefined,
              distanceM: distanceM ?? undefined,
              seconds: seconds ?? undefined,
              rir: rir ?? undefined,
              type,
            })
          }
        >
          Save
        </Button>
      </div>
      <div className="mt-2 text-xs text-muted">{fmtWeight(kind, set.weight)}</div>
    </Sheet>
  );
}
