import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { recordsForNewSets } from '@/db/recordsQueries';
import {
  deleteSet,
  logSet,
  previousSets,
  removeExtraExercise,
  setSessionLockIn,
  clearSessionLockIn,
  setSkipped,
  setSlotFeel,
  swapExercise,
  toEngine,
  undoSwap,
  updateSet,
  type PreviousSets,
} from '@/db/repo';
import { fmtSetsLine, targetLine } from '@/domain/format';
import { lockInBlocked, suggestedLockInWeight } from '@/domain/engine';
import { DEFAULT_PLATES, plateLabel, platesPerSide } from '@/domain/plates';
import { prescribe } from '@/domain/prescription';
import type { PersonalRecord } from '@/domain/records';
import type { RestGroupMember } from '@/domain/rest';
import { shouldStartRest } from '@/domain/rest';
import { completionOf, justCompleted, planRows, type PendingRow, type SetTableRx, type WarmupGhostRow } from '@/domain/setTable';
import { countsForProgression, feelOf } from '@/domain/sets';
import type { Exercise, RoutineExercise, Session, SetLog, Settings } from '@/domain/types';
import { liveVerdict } from '@/domain/verdict';
import { flashAmbient } from '@/state/ambient';
import { success, tap, warning } from '@/state/haptics';
import { primeAudio, requestNotificationsOnce } from '@/state/notify';
import { useTimer } from '@/state/timer';
import { Button, IconButton } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon } from '@/ui/components/TopBar';
import { ExerciseDemo } from '@/ui/ExerciseDemo';
import { PlateSheet } from '@/ui/PlateSheet';
import { SwapExerciseSheet } from '@/ui/SwapExerciseSheet';
import { CompletionMoment } from './CompletionMoment';
import { DoneCard } from './DoneCard';
import { EditSetSheet } from './EditSetSheet';
import { ChevronIcon, PencilIcon } from './icons';
import { SetTable } from './SetTable';
import type { Draft, Slot } from './types';

function restSecondsFor(rx: RoutineExercise | null, exercise: Exercise, settings: Settings): number {
  if (rx?.restSecOverride) return rx.restSecOverride;
  if (exercise.defaultRestSec) return exercise.defaultRestSec;
  if (exercise.kind === 'carry') return settings.restCarrySec;
  return exercise.isCompound ? settings.restCompoundSec : settings.restIsolationSec;
}

/** "4 × 6–8 @ 110 kg" → "4 sets of 6–8 · 110 kg" — the card's own phrasing (§5), built from the
 * already-tested `targetLine`, never a second copy of its rules. */
function cardMeta(line: string): string {
  return line.replace(' × ', ' sets of ').replace(' @ ', ' · ');
}

export function ExerciseCard({
  session,
  slot,
  groupSlots,
  setsBySlot,
  skipped,
  sessionExerciseIds,
  sets,
  settings,
  isCurrent,
  isSkipped,
  isGroupExpanded,
  onToggleGroupExpand,
}: {
  session: Session;
  slot: Slot;
  /** Every member of this slot's group (a lone slot is a group of one) — the rest-timer rule
   * needs every member's own counted-set total, not just this one. */
  groupSlots: Slot[];
  setsBySlot: Map<string, SetLog[]>;
  skipped: Set<string>;
  sessionExerciseIds: string[];
  sets: SetLog[];
  settings: Settings;
  isCurrent: boolean;
  isSkipped: boolean;
  isGroupExpanded: boolean;
  onToggleGroupExpand: () => void;
}) {
  const nav = useNavigate();
  const { rx, exercise } = slot;
  const kind = exercise.kind;
  const ref = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [editing, setEditing] = useState<SetLog | null>(null);
  const [plateSheetOpen, setPlateSheetOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [extraRows, setExtraRows] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);
  const [lockingIn, setLockingIn] = useState(false);
  const timer = useTimer();

  const prev = useLiveQuery<PreviousSets | null>(() => previousSets(rx?.id ?? null, exercise.id, session.id), [rx?.id, exercise.id, session.id]);

  const barKg = settings.barKg ?? DEFAULT_PLATES.barKg;
  const plateSizes = settings.plates ?? DEFAULT_PLATES.plates;

  const prescription = useMemo(
    () => (rx ? prescribe({ rx, kind, equipment: exercise.equipment, deload: !!session.deload, settings }) : null),
    [rx, kind, exercise.equipment, session.deload, settings],
  );

  // The weight this slot is actually working at right now: deload-adjusted when the session is a
  // deload, otherwise the plain prescription. Null for calibrating/carry/timed/extras.
  const workingWeight = useMemo(() => {
    if (!rx || rx.mode !== 'normal' || kind === 'carry' || kind === 'timed') return null;
    return session.deload ? (prescription?.weight ?? null) : rx.currentWeight;
  }, [rx, kind, session.deload, prescription]);

  const target = rx?.targetSets ?? 3;
  const { countedDone, complete } = completionOf(sets, target);

  const setTableRx: SetTableRx = useMemo(
    () =>
      rx
        ? { targetSets: rx.targetSets, repMin: rx.repMin, repMax: rx.repMax, mode: rx.mode, increment: rx.increment, distanceMinM: rx.distanceMinM, distanceMaxM: rx.distanceMaxM }
        : { targetSets: 3, repMin: 8, repMax: 12, mode: 'normal', increment: exercise.defaultIncrement },
    [rx, exercise.defaultIncrement],
  );

  const rows = useMemo(
    () =>
      planRows({
        kind,
        equipment: exercise.equipment,
        rx: setTableRx,
        loggedSets: sets,
        previousSets: prev?.sets ?? [],
        prescribedWeight: rx ? workingWeight : null,
        warmup: { barKg, plates: plateSizes },
        extraRows,
      }),
    [kind, exercise.equipment, setTableRx, sets, prev, rx, workingWeight, barKg, plateSizes, extraRows],
  );

  const nextRow = useMemo(() => rows.find((r): r is PendingRow => (r.kind === 'target' || r.kind === 'extra') && r.status === 'next'), [rows]);

  const defaultDraft = useCallback(
    (): Draft => ({
      weight: nextRow?.ghostWeight ?? null,
      reps: nextRow?.ghostReps ?? null,
      distanceM: nextRow?.ghostDistanceM ?? null,
      seconds: nextRow?.ghostSeconds ?? null,
    }),
    [nextRow],
  );

  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const touched = useRef(false);

  // Refresh the (untouched) draft whenever the live row's own ghost values move on: after a log,
  // when history finally loads, or when a deload toggle changes the prescription.
  useEffect(() => {
    if (!touched.current) setDraft(defaultDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRow]);

  useEffect(() => {
    if (isCurrent && ref.current) {
      const top = ref.current.getBoundingClientRect().top + window.scrollY - 64;
      if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [isCurrent]);

  // The completion moment holds for ~1.8s so it can actually be seen, and settles instantly under
  // reduced motion rather than being skipped outright — the end state (the done card) is the same
  // either way, just reached without the pause. LiveSessionScreen holds this slot as `currentKey`
  // for the same window (see its own comment), so `isCurrent` — and the scroll effect above —
  // don't move on to the next card while this one is still playing.
  useEffect(() => {
    if (!celebrating) return;
    let reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* matchMedia unavailable — treat as full motion */
    }
    const t = window.setTimeout(() => setCelebrating(false), reduced ? 0 : 1800);
    return () => window.clearTimeout(t);
  }, [celebrating]);

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

  const prRecords = useLiveQuery<PersonalRecord[]>(
    () => recordsForNewSets(exercise.id, session.id, sets, { calibrating: rx?.mode === 'calibrating' }),
    [exercise.id, session.id, sets, rx?.mode],
  );
  const prIndices = useMemo(() => new Set((prRecords ?? []).map((r) => r.setIndex)), [prRecords]);

  const swappedToId = rx ? session.swaps?.[rx.id] : undefined;
  const swappedExercise = useLiveQuery(() => (swappedToId ? db.exercises.get(swappedToId) : undefined), [swappedToId]);

  const engineRx = useMemo(() => (rx ? toEngine(rx, exercise) : null), [rx, exercise]);
  const verdict = useMemo(() => (engineRx ? liveVerdict(engineRx, sets, { deload: !!session.deload }) : null), [engineRx, sets, session.deload]);
  const doneLine = sets.length ? fmtSetsLine(sets, kind) : '';

  const selectedFeel = kind === 'reps' || kind === 'bodyweight_plus' ? feelOf(sets) : null;
  const handlePickFeel = async (rir: number) => {
    await setSlotFeel(session.id, rx?.id ?? null, exercise.id, selectedFeel === rir ? null : rir);
  };

  const pendingLockIn = rx ? session.lockIns?.[rx.id] : undefined;
  const lockInSuggested = rx?.mode === 'calibrating' ? suggestedLockInWeight(sets) : null;
  const showLockIn = !!rx && rx.mode === 'calibrating' && !lockInBlocked(lockInSuggested, kind);
  const handleLockIn = async () => {
    if (!rx || lockInSuggested === null || lockingIn) return;
    setLockingIn(true);
    try {
      await setSessionLockIn(session.id, rx.id, lockInSuggested);
    } finally {
      setLockingIn(false);
    }
  };
  const handleUndoLockIn = async () => {
    if (!rx) return;
    await clearSessionLockIn(session.id, rx.id);
  };

  const copyPrevious = (row: PendingRow) => {
    const p = row.previous;
    if (!p) return;
    touched.current = true;
    setDraft((d) => ({
      weight: p.weight,
      reps: p.reps ?? d.reps,
      distanceM: p.distanceM ?? d.distanceM,
      seconds: p.seconds ?? d.seconds,
    }));
  };

  const busy = useRef(false);
  const [busyUi, setBusyUi] = useState(false);

  /** Everything that follows a log, whichever row logged it: haptics, the rest timer (via the
   * shared superset rule), a record toast, feel inheritance, and the completion moment. */
  const afterLog = async (newSet: SetLog, countedBefore: number) => {
    void tap();

    const members: RestGroupMember[] = groupSlots.map((s) => {
      const memberSkipped = s.rx ? skipped.has(s.rx.id) : false;
      const base = (setsBySlot.get(s.key) ?? []).filter((x) => countsForProgression(x.type)).length;
      const counted = s.key === slot.key ? base + (countsForProgression(newSet.type) ? 1 : 0) : base;
      return { key: s.key, targetSets: s.rx?.targetSets ?? 3, skipped: memberSkipped, counted };
    });
    if (shouldStartRest(members, slot.key, { type: newSet.type })) {
      timer.start(restSecondsFor(rx, exercise, settings), exercise.name);
    }

    const newRecords = await recordsForNewSets(exercise.id, session.id, [newSet], { calibrating: rx?.mode === 'calibrating' });
    if (newRecords.length > 0) {
      toast(`Record · ${fmtSetsLine([newSet], kind)}`, 'ok');
      flashAmbient('record');
    }

    // A set logged into a slot that already has a feel answer inherits it — otherwise one late
    // extra set would silently look unanswered next to the rest.
    if (newSet.type === 'working') {
      const existingFeel = feelOf(sets);
      if (existingFeel !== null) await updateSet(newSet.id, { rir: existingFeel });
    }

    // One fewer pending "Add a set" slot once a post-target set actually lands.
    if (countedBefore >= target && extraRows > 0) setExtraRows((n) => Math.max(0, n - 1));

    const countedAfter = countedBefore + (countsForProgression(newSet.type) ? 1 : 0);
    if (justCompleted(countedBefore, countedAfter, target)) {
      setCelebrating(true);
      setReopened(false);
      void success();
      flashAmbient('done');
    }
  };

  const logLive = async () => {
    if (!nextRow || busy.current) return;
    if (!canLog) {
      setShakeKey((k) => k + 1);
      void warning();
      return;
    }
    busy.current = true;
    setBusyUi(true);
    primeAudio();
    void requestNotificationsOnce();
    try {
      const newSet = await logSet({
        sessionId: session.id,
        routineExerciseId: rx?.id ?? null,
        exerciseId: exercise.id,
        type: 'working',
        weight: draft.weight ?? 0,
        reps: kind === 'reps' || kind === 'bodyweight_plus' ? (draft.reps ?? undefined) : undefined,
        distanceM: kind === 'carry' ? (draft.distanceM ?? undefined) : undefined,
        seconds: kind === 'carry' || kind === 'timed' ? (draft.seconds ?? undefined) : undefined,
      });
      touched.current = false;
      await afterLog(newSet, countedDone);
    } finally {
      busy.current = false;
      setBusyUi(false);
    }
  };

  const logWarmup = async (row: WarmupGhostRow) => {
    if (busy.current) return;
    busy.current = true;
    primeAudio();
    void requestNotificationsOnce();
    try {
      const newSet = await logSet({
        sessionId: session.id,
        routineExerciseId: rx?.id ?? null,
        exerciseId: exercise.id,
        type: 'warmup',
        weight: row.weight,
        reps: kind === 'reps' || kind === 'bodyweight_plus' ? row.reps : undefined,
      });
      await afterLog(newSet, countedDone);
    } finally {
      busy.current = false;
    }
  };

  const inc = rx?.increment ?? exercise.defaultIncrement;
  const rawTLine = rx ? (session.deload && prescription ? prescription.line : targetLine(rx, kind)) : 'this session only';
  const tLine = cardMeta(rawTLine);
  const perSide = exercise.unilateral ? ' · per side' : '';
  const dimmed = isSkipped || (slot.optional && !isCurrent && sets.length === 0);
  const subtitle = `${tLine}${perSide} · ${countedDone} of ${target}`;
  const testId = `exercise-card-${exercise.name}`;
  const chipCalibrating = rx?.mode === 'calibrating' && kind !== 'carry' && pendingLockIn === undefined;

  const plateLoad =
    exercise.equipment === 'barbell' && draft.weight !== null && Number.isFinite(draft.weight) && draft.weight >= barKg
      ? platesPerSide(draft.weight, { barKg, plates: plateSizes })
      : null;
  const plateLineInfo = plateLoad ? { label: plateLabel(plateLoad), onOpen: () => setPlateSheetOpen(true) } : null;

  const chips = (
    <>
      {chipCalibrating && <Chip size="sm" tone="info">calibrating</Chip>}
      {slot.optional && <Chip size="sm">optional</Chip>}
      {!rx && <Chip size="sm">extra</Chip>}
      {isSkipped && <Chip size="sm" tone="warn">skipped</Chip>}
      {session.deload && rx && <Chip size="sm" tone="info">deload</Chip>}
    </>
  );

  const openMenu = () => setMenuOpen(true);

  // Skipped exercises never celebrate and never show the entry table — just what was logged
  // before the skip (if anything) and the way back (Undo a swap, or Unskip).
  if (isSkipped) {
    return (
      <div ref={ref} className="pt-3" data-current={isCurrent ? 'true' : undefined}>
        <Card className={`overflow-hidden ${isCurrent ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : ''} opacity-60`} data-testid={testId} data-current={isCurrent ? 'true' : undefined}>
          <div className="flex items-center gap-1 pr-1">
            <button type="button" onClick={onToggleGroupExpand} aria-expanded={isGroupExpanded} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="truncate text-base font-bold leading-tight">{exercise.name}</h2>
                  {chips}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted">{doneLine || subtitle}</div>
              </div>
              <span className="shrink-0 text-dim">
                <ChevronIcon expanded={isGroupExpanded} />
              </span>
            </button>
          </div>
          {isGroupExpanded && rx && (
            <div className="px-4 pb-4 pt-1">
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
      </div>
    );
  }

  if (celebrating) {
    return (
      <div ref={ref} className="pt-3" data-current={isCurrent ? 'true' : undefined}>
        <Card className="overflow-hidden border-ok/40" data-testid={testId} data-current={isCurrent ? 'true' : undefined}>
          <CompletionMoment doneLine={doneLine} verdictLine={verdict?.line ?? null} verdictTone={verdict?.tone ?? null} />
        </Card>
      </div>
    );
  }

  if (complete && !reopened) {
    return (
      <div ref={ref} className="pt-3" data-current={isCurrent ? 'true' : undefined}>
        <DoneCard
          exerciseName={exercise.name}
          doneLine={doneLine}
          verdictLine={verdict?.line ?? null}
          verdictTone={verdict?.tone ?? null}
          kind={kind}
          showFeel={kind === 'reps' || kind === 'bodyweight_plus'}
          selectedFeel={selectedFeel}
          onPickFeel={(rir) => void handlePickFeel(rir)}
          showLockIn={showLockIn}
          lockInWeight={lockInSuggested}
          lockInPending={pendingLockIn}
          onLockIn={() => void handleLockIn()}
          onUndoLockIn={() => void handleUndoLockIn()}
          lockingBusy={lockingIn}
          reopened={reopened}
          onToggle={() => setReopened(true)}
          onMenu={openMenu}
          isCurrent={isCurrent}
          dimmed={dimmed}
          testId={testId}
        />
        <CardMenuAndSheets
          session={session}
          slot={slot}
          exercise={exercise}
          sessionExerciseIds={sessionExerciseIds}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          skipConfirm={skipConfirm}
          setSkipConfirm={setSkipConfirm}
          removeConfirm={removeConfirm}
          setRemoveConfirm={setRemoveConfirm}
          swapOpen={swapOpen}
          setSwapOpen={setSwapOpen}
          howToOpen={howToOpen}
          setHowToOpen={setHowToOpen}
          setsCount={sets.length}
          onAddSet={() => {
            setExtraRows((n) => n + 1);
            setReopened(true);
          }}
        />
      </div>
    );
  }

  if (!isGroupExpanded && !reopened) {
    return (
      <div ref={ref} className="pt-3" data-current={isCurrent ? 'true' : undefined}>
        <Card className={`overflow-hidden ${isCurrent ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : ''} ${dimmed ? 'opacity-60' : ''}`} data-testid={testId} data-current={isCurrent ? 'true' : undefined}>
          <button type="button" onClick={onToggleGroupExpand} aria-expanded={false} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="truncate text-base font-bold leading-tight">{exercise.name}</h2>
                {chips}
              </div>
              <div className="mt-0.5 truncate text-sm text-muted">{subtitle}</div>
            </div>
            <span className="shrink-0 text-dim">
              <ChevronIcon />
            </span>
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div ref={ref} className="pt-3" data-current={isCurrent ? 'true' : undefined}>
      <Card className={`overflow-hidden ${isCurrent ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : ''}`} data-testid={testId} data-current={isCurrent ? 'true' : undefined}>
        <div className="flex items-start gap-2 px-4 pt-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav(`/exercises/${exercise.id}`)}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-lg font-extrabold leading-tight">{exercise.name}</h2>
              {chips}
            </div>
            <div className="mt-0.5 text-sm text-muted">{subtitle}</div>
          </button>
          <IconButton label="Collapse" aria-expanded="true" onClick={() => (reopened ? setReopened(false) : onToggleGroupExpand())}>
            <ChevronIcon expanded />
          </IconButton>
          <IconButton label="More" onClick={openMenu}>
            <MoreIcon />
          </IconButton>
        </div>

        {rx?.cue && (
          <div className="mx-4 mt-2 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[15px] leading-snug text-fg">
            <span className="mt-0.5 shrink-0 text-dim">
              <PencilIcon />
            </span>
            <span>{rx.cue}</span>
          </div>
        )}

        <div className="px-3 pb-3 pt-2">
          <SetTable
            rows={rows}
            kind={kind}
            exerciseName={exercise.name}
            draft={draft}
            onDraftChange={update}
            onLogLive={() => void logLive()}
            blockedShake={shakeKey}
            busy={busyUi}
            onLogWarmup={(row) => void logWarmup(row)}
            onCopyPrevious={copyPrevious}
            onEditSet={setEditing}
            prIndices={prIndices}
            plateLine={plateLineInfo}
          />
        </div>

        {slot.optional && sets.length === 0 && (
          <div className="px-4 pb-4">
            <Button full variant="ghost" onClick={() => rx && void setSkipped(session.id, rx.id, true)}>
              Skip
            </Button>
          </div>
        )}
        {sets.length === 0 && !slot.optional && <div className="h-3" />}
      </Card>

      <CardMenuAndSheets
        session={session}
        slot={slot}
        exercise={exercise}
        sessionExerciseIds={sessionExerciseIds}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        skipConfirm={skipConfirm}
        setSkipConfirm={setSkipConfirm}
        removeConfirm={removeConfirm}
        setRemoveConfirm={setRemoveConfirm}
        swapOpen={swapOpen}
        setSwapOpen={setSwapOpen}
        howToOpen={howToOpen}
        setHowToOpen={setHowToOpen}
        setsCount={sets.length}
        onAddSet={() => setExtraRows((n) => n + 1)}
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

      {plateLoad && draft.weight !== null && (
        <PlateSheet open={plateSheetOpen} onClose={() => setPlateSheetOpen(false)} weight={draft.weight} plates={{ barKg, plates: plateSizes }} />
      )}
    </div>
  );
}

/**
 * The ⋯ menu and its confirms/sheets — shared by the open card and the done card, since "Add a
 * set" must be reachable from a finished exercise too. `editing`/plates/how-to stay with the open
 * card (they need `draft`/`rows` state that the done card doesn't carry).
 */
function CardMenuAndSheets({
  session,
  slot,
  exercise,
  sessionExerciseIds,
  menuOpen,
  setMenuOpen,
  skipConfirm,
  setSkipConfirm,
  removeConfirm,
  setRemoveConfirm,
  swapOpen,
  setSwapOpen,
  howToOpen,
  setHowToOpen,
  setsCount,
  onAddSet,
}: {
  session: Session;
  slot: Slot;
  exercise: Exercise;
  sessionExerciseIds: string[];
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  skipConfirm: boolean;
  setSkipConfirm: (v: boolean) => void;
  removeConfirm: boolean;
  setRemoveConfirm: (v: boolean) => void;
  swapOpen: boolean;
  setSwapOpen: (v: boolean) => void;
  howToOpen: boolean;
  setHowToOpen: (v: boolean) => void;
  setsCount: number;
  onAddSet: () => void;
}) {
  const nav = useNavigate();
  const { rx } = slot;
  const swappedToId = rx ? session.swaps?.[rx.id] : undefined;
  return (
    <>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={exercise.name}>
        <div className="grid gap-2">
          <Button
            full
            size="lg"
            data-testid="add-set"
            onClick={() => {
              setMenuOpen(false);
              onAddSet();
            }}
          >
            Add a set
          </Button>
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
          {rx && (
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
        body={setsCount > 0 ? 'Logged sets stay, but the exercise is marked skipped.' : 'It will be marked skipped for this session.'}
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
        body={setsCount > 0 ? `${setsCount} logged ${setsCount === 1 ? 'set is' : 'sets are'} deleted.` : 'It was added for this session only.'}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoveConfirm(false)}
        onConfirm={async () => {
          setRemoveConfirm(false);
          await removeExtraExercise(session.id, exercise.id);
        }}
      />

      {rx && (
        <SwapExerciseSheet
          open={swapOpen}
          onClose={() => setSwapOpen(false)}
          muscleGroup={exercise.muscleGroup}
          exclude={sessionExerciseIds}
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
    </>
  );
}
