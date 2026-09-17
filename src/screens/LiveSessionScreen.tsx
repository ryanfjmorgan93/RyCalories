import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { gatherContext } from '@/db/assistantQueries';
import { recordsForNewSets } from '@/db/recordsQueries';
import {
  addExtraExercise,
  deleteSet,
  discardSession,
  logSet,
  previousSets,
  removeExtraExercise,
  setSkipped,
  swapExercise,
  undoSwap,
  updateSession,
  updateSet,
  type PreviousSets,
} from '@/db/repo';
import type { AssistantContext } from '@/domain/assistant';
import { toDateKey } from '@/domain/dates';
import { fmtDate, fmtDuration, fmtKg, fmtNum, fmtWeight, targetLine } from '@/domain/format';
import { DEFAULT_PLATES, plateLabel, platesPerSide } from '@/domain/plates';
import { prescribe } from '@/domain/prescription';
import type { PersonalRecord } from '@/domain/records';
import { countsForProgression, effortOptions, type EffortScale, formatEffort, setBadges } from '@/domain/sets';
import { DEFAULT_SETTINGS, type Exercise, type RoutineExercise, type Session, type SetLog, type SetType, type Settings } from '@/domain/types';
import { warmupRamp } from '@/domain/warmup';
import { primeAudio, requestNotificationsOnce, vibrate } from '@/state/notify';
import { useTimer } from '@/state/timer';
import { AssistantBox } from '@/ui/AssistantBox';
import { Button, IconButton } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Chip, Toggle } from '@/ui/components/Chip';
import { NumberField } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { CheckIcon, MoreIcon, TopBar } from '@/ui/components/TopBar';
import { ExerciseDemo } from '@/ui/ExerciseDemo';
import { ExercisePicker } from '@/ui/ExercisePicker';
import { PlateSheet } from '@/ui/PlateSheet';
import { SwapExerciseSheet } from '@/ui/SwapExerciseSheet';
import { useNow, useRoutine, useRoutineItems, useSettings } from '@/ui/hooks';

interface Draft {
  weight: number | null;
  reps: number | null;
  rir: number | null;
  distanceM: number | null;
  seconds: number | null;
  type: SetType;
}

interface Slot {
  key: string;
  rx: RoutineExercise | null;
  exercise: Exercise;
  optional: boolean;
}

/** A lone slot, or adjacent required slots sharing an `rx.supersetId` (a superset). */
interface SlotGroup {
  key: string;
  slots: Slot[];
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

  // Group adjacent required slots that share a supersetId into one bracket; everything else
  // (lone slots, extras, optional) stays a group of one.
  const groups: SlotGroup[] = useMemo(() => {
    const out: SlotGroup[] = [];
    let i = 0;
    while (i < slots.length) {
      const slot = slots[i];
      if (!slot.optional && slot.rx?.supersetId !== undefined) {
        const supersetId = slot.rx.supersetId;
        const group: Slot[] = [slot];
        let j = i + 1;
        while (j < slots.length && !slots[j].optional && slots[j].rx?.supersetId === supersetId) {
          group.push(slots[j]);
          j++;
        }
        if (group.length > 1) {
          out.push({ key: `g:${supersetId}`, slots: group });
          i = j;
          continue;
        }
      }
      out.push({ key: slot.key, slots: [slot] });
      i++;
    }
    return out;
  }, [slots]);

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

  // The first group (or lone slot) still short of its target; within a group, whichever member
  // has fewest counted sets, ties by order — this alternates A/B/A/B in a superset with no extra state.
  const currentKey = useMemo(() => {
    for (const g of groups) {
      let best: Slot | null = null;
      let bestDone = Infinity;
      let anyUndone = false;
      for (const s of g.slots) {
        if (s.rx && skipped.has(s.rx.id)) continue;
        const done = (setsBySlot.get(s.key) ?? []).filter((x) => countsForProgression(x.type)).length;
        const target = s.rx?.targetSets ?? 3;
        if (done < target) {
          anyUndone = true;
          if (done < bestDone) {
            bestDone = done;
            best = s;
          }
        }
      }
      if (anyUndone && best) return best.key;
    }
    return null;
  }, [groups, setsBySlot, skipped]);

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
  const currentExerciseId = slots.find((s) => s.key === currentKey)?.exercise.id;

  const finish = () => {
    if (requiredUndone.length > 0 || totalSets === 0) setFinishOpen(true);
    else nav(`/session/${session.id}/summary`);
  };

  return (
    <div className="pb-safe-timer">
      <SessionHeader
        session={session}
        targetMinutes={routine?.targetMinutes}
        settings={settings}
        currentExerciseId={currentExerciseId}
        onFinish={finish}
      />
      <div className="px-3">
        {groups.map((group, gi) => {
          const firstSlot = group.slots[0];
          const prevGroup = gi > 0 ? groups[gi - 1] : null;
          const prevSlot = prevGroup ? prevGroup.slots[prevGroup.slots.length - 1] : null;
          const showOptionalDivider = firstSlot.optional && (!prevSlot || !prevSlot.optional);
          const isSuperset = group.slots.length > 1;
          return (
            <div key={group.key}>
              {showOptionalDivider && (
                <div className="flex items-center gap-3 px-1 pt-5 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-dim">
                  <span className="h-px flex-1 bg-line" />
                  Optional
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {isSuperset ? (
                <div className="mt-3 border-l-2 border-accent pl-2" data-testid="superset-group">
                  <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Superset</div>
                  {group.slots.map((slot, si) => (
                    <ExerciseCard
                      key={slot.key}
                      session={session}
                      slot={slot}
                      sets={setsBySlot.get(slot.key) ?? []}
                      settings={settings}
                      isCurrent={slot.key === currentKey}
                      isSkipped={slot.rx ? skipped.has(slot.rx.id) : false}
                      startsRestTimer={si === group.slots.length - 1}
                    />
                  ))}
                </div>
              ) : (
                <ExerciseCard
                  session={session}
                  slot={firstSlot}
                  sets={setsBySlot.get(firstSlot.key) ?? []}
                  settings={settings}
                  isCurrent={firstSlot.key === currentKey}
                  isSkipped={firstSlot.rx ? skipped.has(firstSlot.rx.id) : false}
                  startsRestTimer
                />
              )}
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

function SessionHeader({
  session,
  targetMinutes,
  settings,
  currentExerciseId,
  onFinish,
}: {
  session: Session;
  targetMinutes?: number;
  settings: Settings;
  currentExerciseId?: string;
  onFinish: () => void;
}) {
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const over = targetMinutes !== undefined && elapsed > targetMinutes * 60;
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssistantContext>({ today: toDateKey() });
  const deloadPercent = settings.deloadPercent ?? DEFAULT_SETTINGS.deloadPercent!;

  useEffect(() => {
    if (!assistantOpen) return;
    let alive = true;
    void gatherContext({
      today: toDateKey(),
      settings,
      sessionId: session.id,
      routineId: session.routineId || undefined,
      exerciseId: currentExerciseId,
    }).then((ctx) => {
      if (alive) setAssistantContext(ctx);
    });
    return () => {
      alive = false;
    };
  }, [assistantOpen, settings, session.id, session.routineId, currentExerciseId]);

  return (
    <>
      <TopBar
        title={session.title}
        back="/"
        subtitle={
          <span className={`num text-base font-extrabold ${over ? 'text-danger' : 'text-muted'}`} data-testid="session-clock">
            {fmtDuration(elapsed)}
            {targetMinutes ? <span className="text-xs font-semibold text-dim"> / {targetMinutes} min</span> : null}
            {session.deload ? <span className="text-info"> · deload</span> : null}
          </span>
        }
        right={
          <>
            <IconButton label="Ask" onClick={() => setAssistantOpen(true)} data-testid="ask-assistant">
              <AskIcon />
            </IconButton>
            <IconButton label="Session options" onClick={() => setSessionMenuOpen(true)} data-testid="session-options">
              <MoreIcon />
            </IconButton>
            <Button variant="primary" size="md" onClick={onFinish} data-testid="finish-session" className="mr-2">
              Finish
            </Button>
          </>
        }
      />

      <Sheet open={sessionMenuOpen} onClose={() => setSessionMenuOpen(false)} title={session.title}>
        <Toggle
          checked={!!session.deload}
          onChange={(v) => void updateSession(session.id, { deload: v })}
          label="Deload session"
          sub={`Loads reduced to ${Math.round(deloadPercent * 100)}%; weights do not change after this session.`}
        />
      </Sheet>

      <AssistantBox open={assistantOpen} onClose={() => setAssistantOpen(false)} context={assistantContext} />
    </>
  );
}

function AskIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5A8.38 8.38 0 0 1 3 11.5 8.5 8.5 0 0 1 11.5 3a8.5 8.5 0 0 1 9.5 8.5Z" />
    </svg>
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
  startsRestTimer,
}: {
  session: Session;
  slot: Slot;
  sets: SetLog[];
  settings: Settings;
  isCurrent: boolean;
  isSkipped: boolean;
  /** False for a superset member that isn't the last one logged — its partner still owes a set. */
  startsRestTimer: boolean;
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
  const [plateSheetOpen, setPlateSheetOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const timer = useTimer();

  const prev = useLiveQuery<PreviousSets | null>(() => previousSets(rx?.id ?? null, exercise.id, session.id), [rx?.id, exercise.id, session.id]);
  const prevWorking = useMemo(() => (prev?.sets ?? []).filter((s) => countsForProgression(s.type)), [prev]);

  const workingDone = sets.filter((s) => countsForProgression(s.type)).length;
  const nextIndex = workingDone; // index among sets that count for progression
  const target = rx?.targetSets ?? 3;
  const complete = workingDone >= target;
  const effortScale: EffortScale = settings.effortScale ?? 'rir';
  const badges = setBadges(sets);

  const barKg = settings.barKg ?? DEFAULT_PLATES.barKg;
  const plateSizes = settings.plates ?? DEFAULT_PLATES.plates;

  const prescription = useMemo(() => {
    if (!rx) return null;
    return prescribe({ rx, kind, equipment: exercise.equipment, deload: !!session.deload, settings });
  }, [rx, kind, exercise.equipment, session.deload, settings]);

  // The weight this slot is actually working at right now: deload-adjusted when the session is a
  // deload, otherwise the plain prescription. Null for calibrating/carry/timed.
  const workingWeight = useMemo(() => {
    if (!rx || rx.mode !== 'normal' || kind === 'carry' || kind === 'timed') return null;
    return session.deload ? (prescription?.weight ?? null) : rx.currentWeight;
  }, [rx, kind, session.deload, prescription]);

  const swappedToId = rx ? session.swaps?.[rx.id] : undefined;
  const swappedExercise = useLiveQuery(() => (swappedToId ? db.exercises.get(swappedToId) : undefined), [swappedToId]);

  const prRecords = useLiveQuery<PersonalRecord[]>(() => recordsForNewSets(exercise.id, session.id, sets), [exercise.id, session.id, sets]);
  const prIndices = useMemo(() => new Set((prRecords ?? []).map((r) => r.setIndex)), [prRecords]);

  const defaultDraft = useCallback((): Draft => {
    const lastLogged = sets.length ? sets[sets.length - 1] : null;
    const lastWorking = [...sets].reverse().find((s) => countsForProgression(s.type)) ?? null;
    const prevSame = prevWorking[nextIndex] ?? prevWorking[prevWorking.length - 1] ?? null;
    let weight: number | null;
    // Keep whatever was actually on the bar this session; otherwise the prescription (deload-
    // adjusted when this is a deload session); otherwise last time.
    if (lastWorking) weight = lastWorking.weight;
    else if (rx && rx.mode === 'normal' && kind !== 'carry' && kind !== 'timed') weight = workingWeight ?? rx.currentWeight;
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
      type: 'working',
    };
  }, [sets, prevWorking, nextIndex, rx, kind, workingWeight]);

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

  // Deload toggled on (or off) mid-session, before this slot's draft was touched: refresh it so
  // an as-yet-unlogged set picks up the changed prescription straight away.
  useEffect(() => {
    if (!touched.current) setDraft(defaultDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingWeight]);

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
      const newSet = await logSet({
        sessionId: session.id,
        routineExerciseId: rx?.id ?? null,
        exerciseId: exercise.id,
        type: draft.type,
        weight: draft.weight ?? 0,
        reps: kind === 'reps' || kind === 'bodyweight_plus' ? (draft.reps ?? undefined) : undefined,
        distanceM: kind === 'carry' ? (draft.distanceM ?? undefined) : undefined,
        seconds: kind === 'carry' || kind === 'timed' ? (draft.seconds ?? undefined) : undefined,
        rir: draft.rir ?? undefined,
      });
      // A drop set follows a working set the timer is already running for; a superset member
      // that isn't last in its group leaves the timer to whoever logs last.
      if (draft.type !== 'drop' && startsRestTimer) timer.start(restSecondsFor(rx, exercise, settings), exercise.name);
      const newRecords = await recordsForNewSets(exercise.id, session.id, [newSet]);
      if (newRecords.length > 0) toast(`PR · ${setLabel(newSet, kind)}`, 'ok');
    } finally {
      busy.current = false;
      setBusyUi(false);
    }
  };

  const fill = (s: SetLog) => {
    update({ weight: s.weight, reps: s.reps ?? draft.reps, distanceM: s.distanceM ?? draft.distanceM, seconds: s.seconds ?? draft.seconds });
  };

  const inc = rx?.increment ?? exercise.defaultIncrement ?? 2.5;
  const tLine = rx ? (session.deload && prescription ? prescription.line : targetLine(rx, kind)) : 'this session only';
  const perSide = exercise.unilateral ? ' · per side' : '';
  const dimmed = isSkipped || (slot.optional && !isCurrent && sets.length === 0);

  const showWarmup = exercise.isCompound && exercise.equipment === 'barbell' && workingDone === 0 && workingWeight !== null && workingWeight > 0;
  const warmupPills = showWarmup ? warmupRamp(workingWeight as number, { barKg, plates: plateSizes }) : [];

  const plateLoad =
    exercise.equipment === 'barbell' && draft.weight !== null && Number.isFinite(draft.weight) && draft.weight >= barKg
      ? platesPerSide(draft.weight, { barKg, plates: plateSizes })
      : null;

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
              {session.deload && rx && <Chip size="sm" tone="info">deload</Chip>}
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

        {warmupPills.length > 0 && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto px-4 no-scrollbar">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">Warm-up</span>
            {warmupPills.map((w, i) => (
              <button
                key={i}
                type="button"
                data-testid={`warmup-pill-${i}`}
                onClick={() => update({ type: 'warmup', weight: w.weight, reps: w.reps })}
                className="num min-h-11 shrink-0 rounded-lg border border-line bg-surface-2 px-3 text-base font-semibold text-muted active:bg-line"
              >
                {fmtNum(w.weight)} × {w.reps}
              </button>
            ))}
          </div>
        )}

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
            {sets.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setEditing(s)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left active:bg-surface-2"
              >
                <span className={`num w-7 text-center text-sm font-bold ${badges[i] === 'W' ? 'text-warn' : badges[i] === 'D' ? 'text-info' : 'text-muted'}`}>
                  {badges[i]}
                </span>
                <span className="num flex-1 text-lg font-bold">{setLabel(s, kind)}</span>
                {prIndices.has(i) && (
                  <span data-testid="pr-chip">
                    <Chip size="sm" tone="ok">PR</Chip>
                  </span>
                )}
                {s.rir !== undefined && <span className="text-xs font-bold text-muted">{formatEffort(s.rir, effortScale)}</span>}
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
                {draft.type === 'warmup' ? 'Warm-up' : complete ? `Set ${nextIndex + 1} (target ${target})` : `Set ${nextIndex + 1} of ${target}`}
              </div>
              {(kind === 'reps' || kind === 'bodyweight_plus') && (
                <Chip size="lg" active={showRir} onClick={() => setShowRir((v) => !v)}>
                  {effortScale === 'rpe' ? 'RPE' : 'RIR'}
                </Chip>
              )}
            </div>
            <div className="mb-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <Chip size="lg" tone="warn" active={draft.type === 'warmup'} onClick={() => update({ type: 'warmup' })}>
                Warm-up
              </Chip>
              <Chip size="lg" active={draft.type === 'working'} onClick={() => update({ type: 'working' })}>
                Working
              </Chip>
              <Chip size="lg" tone="danger" active={draft.type === 'failure'} onClick={() => update({ type: 'failure' })}>
                Failure
              </Chip>
              <Chip size="lg" tone="info" active={draft.type === 'drop'} onClick={() => update({ type: 'drop' })}>
                Drop
              </Chip>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {kind !== 'timed' && (
                <div className="min-w-0">
                  <NumberField
                    label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'}
                    value={draft.weight}
                    onChange={(v) => update({ weight: v })}
                    step={inc}
                    fallback={rx?.mode === 'normal' ? (workingWeight ?? rx.currentWeight) : 0}
                    placeholder={kind === 'bodyweight_plus' ? '0' : 'kg'}
                    testId="weight-input"
                  />
                  {plateLoad && (
                    <button
                      type="button"
                      data-testid="plate-line"
                      onClick={() => setPlateSheetOpen(true)}
                      className="mt-1 px-1 text-left text-xs font-semibold text-muted underline decoration-dotted"
                    >
                      {plateLabel(plateLoad)}
                    </button>
                  )}
                </div>
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
              <div className="mt-2 flex items-center gap-2 overflow-x-auto no-scrollbar" data-testid="effort-options">
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{effortScale === 'rpe' ? 'RPE' : 'RIR'}</span>
                {effortOptions(effortScale).map((o) => (
                  <Chip key={o.label} size="lg" className="min-w-11 shrink-0 justify-center px-0" active={draft.rir === o.rir} onClick={() => update({ rir: draft.rir === o.rir ? null : o.rir })}>
                    {o.label}
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
                complete && draft.type !== 'warmup' ? 'bg-surface-2 text-fg border border-line' : 'bg-ok text-ok-fg'
              }`}
            >
              <CheckIcon />
              {draft.type === 'warmup' ? 'Warm-up done' : draft.type === 'drop' ? 'Drop set done' : 'Set done'}
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
            {swappedToId ? (
              <>
                <div className="mb-2 text-sm text-muted">Swapped for {swappedExercise?.name ?? '…'}</div>
                <Button full variant="ghost" onClick={() => void undoSwap(session.id, rx.id)}>
                  Undo
                </Button>
              </>
            ) : (
              <Button full variant="ghost" onClick={() => void setSkipped(session.id, rx.id, false)}>
                Unskip
              </Button>
            )}
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
          {exercise.demo && (
            <Button
              full
              size="lg"
              onClick={() => {
                setMenuOpen(false);
                setHowToOpen(true);
              }}
            >
              How to
            </Button>
          )}
          {rx && !swappedToId && (
            <Button
              full
              size="lg"
              onClick={() => {
                setMenuOpen(false);
                setSwapOpen(true);
              }}
            >
              Swap exercise
            </Button>
          )}
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
          {rx && isSkipped && !swappedToId && (
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
          effortScale={effortScale}
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

      {plateLoad && draft.weight !== null && (
        <PlateSheet open={plateSheetOpen} onClose={() => setPlateSheetOpen(false)} weight={draft.weight} plates={{ barKg, plates: plateSizes }} />
      )}

      {rx && (
        <SwapExerciseSheet
          open={swapOpen}
          onClose={() => setSwapOpen(false)}
          muscleGroup={exercise.muscleGroup}
          excludeExerciseId={exercise.id}
          onPick={(picked) => {
            setSwapOpen(false);
            void swapExercise(session.id, rx.id, picked.id);
          }}
        />
      )}

      {exercise.demo && (
        <Sheet open={howToOpen} onClose={() => setHowToOpen(false)} title={exercise.name}>
          <ExerciseDemo slug={exercise.demo} name={exercise.name} videoUrl={exercise.videoUrl} />
        </Sheet>
      )}
    </div>
  );
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
  effortScale,
  onClose,
  onDelete,
  onSave,
}: {
  set: SetLog;
  kind: Exercise['kind'];
  increment: number;
  effortScale: EffortScale;
  onClose: () => void;
  onDelete: () => void;
  onSave: (patch: Partial<Pick<SetLog, 'weight' | 'reps' | 'rir' | 'type' | 'distanceM' | 'seconds'>>) => void;
}) {
  const [weight, setWeight] = useState<number | null>(set.weight);
  const [reps, setReps] = useState<number | null>(set.reps ?? null);
  const [distanceM, setDistance] = useState<number | null>(set.distanceM ?? null);
  const [seconds, setSeconds] = useState<number | null>(set.seconds ?? null);
  const [rir, setRir] = useState<number | null>(set.rir ?? null);
  const [type, setType] = useState<SetType>(set.type);
  return (
    <Sheet open onClose={onClose} title={`Edit set`}>
      <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <Chip tone="warn" active={type === 'warmup'} onClick={() => setType('warmup')}>
          Warm-up
        </Chip>
        <Chip active={type === 'working'} onClick={() => setType('working')}>
          Working
        </Chip>
        <Chip tone="danger" active={type === 'failure'} onClick={() => setType('failure')}>
          Failure
        </Chip>
        <Chip tone="info" active={type === 'drop'} onClick={() => setType('drop')}>
          Drop
        </Chip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {kind !== 'timed' && <NumberField label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'} value={weight} onChange={setWeight} step={increment} />}
        {(kind === 'reps' || kind === 'bodyweight_plus') && <NumberField label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />}
        {kind === 'carry' && <NumberField label="Metres" value={distanceM} onChange={setDistance} step={5} mode="numeric" />}
        {(kind === 'carry' || kind === 'timed') && <NumberField label="Seconds" value={seconds} onChange={setSeconds} step={5} mode="numeric" />}
      </div>
      {(kind === 'reps' || kind === 'bodyweight_plus') && (
        <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{effortScale === 'rpe' ? 'RPE' : 'RIR'}</span>
          {effortOptions(effortScale).map((o) => (
            <Chip key={o.label} size="sm" className="shrink-0" active={rir === o.rir} onClick={() => setRir(rir === o.rir ? null : o.rir)}>
              {o.label}
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
