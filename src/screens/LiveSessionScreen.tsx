import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '@/db/db';
import { addExtraExercise, discardSession } from '@/db/repo';
import { mergeStableSlots } from '@/domain/mergeStableSlots';
import { countsForProgression } from '@/domain/sets';
import type { Exercise, SetLog } from '@/domain/types';
import { useTimer } from '@/state/timer';
import { Button } from '@/ui/components/Button';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { TopBar } from '@/ui/components/TopBar';
import { ExercisePicker } from '@/ui/ExercisePicker';
import { useRoutine, useRoutineItems, useSettings } from '@/ui/hooks';
import { AllDoneCard } from './session/AllDoneCard';
import { ExerciseCard } from './session/ExerciseCard';
import { FoldList } from './session/FoldList';
import { SessionHeader } from './session/SessionHeader';
import type { Slot, SlotGroup } from './session/types';
import { useCompletionHold } from './session/useCompletionHold';

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
  // Explicit expand/collapse choices, keyed by group key (a superset's members share one key, so
  // the bracket collapses as a unit). `currentGroupKey` below only *seeds* the default for a group
  // that has no entry here — once the user taps a card, that choice sticks even as `currentGroupKey`
  // moves on, so a finished exercise can still be reopened and a not-yet-current one logged into early.
  const [expandOverride, setExpandOverride] = useState<Record<string, boolean>>({});
  // The Fold's right-hand pane (≥840px only — see src/index.css `.fold-shell`): which group's full
  // card shows there. Unset defaults to the current group; tapping a row in `.fold-list` pins it.
  const [focusOverride, setFocusOverride] = useState<string | null>(null);

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

  // Every exercise id already occupying a slot in this session — extras included — exactly what
  // the "Add exercise" picker excludes, and what a swap must exclude too so it can't create a
  // second card for an exercise that's already here.
  const sessionExerciseIds = useMemo(() => slots.map((s) => s.exercise.id), [slots]);

  // Every ExerciseCard reads its own slot's sets off this map for its records live query — a
  // fresh-but-identical array for an unaffected slot would re-run that query on every OTHER
  // slot's write (`sets` fires the whole session's live query on any set, to any slot), so
  // `mergeStableSlots` keeps the previous render's array reference wherever a slot's own sets are
  // actually unchanged (§8).
  const prevSetsBySlotRef = useRef<Map<string, SetLog[]>>(new Map());
  const setsBySlot = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const s of sets ?? []) {
      const key = s.routineExerciseId ?? `x:${s.exerciseId}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.index - b.index || a.completedAt.localeCompare(b.completedAt));
    const stable = mergeStableSlots(prevSetsBySlotRef.current, m);
    prevSetsBySlotRef.current = stable;
    return stable;
  }, [sets]);

  const skipped = useMemo(() => new Set(session?.skippedRoutineExerciseIds ?? []), [session?.skippedRoutineExerciseIds]);

  // The first group (or lone slot) still short of its target; within a group, whichever member
  // has fewest counted sets, ties by order — this alternates A/B/A/B in a superset with no extra state.
  const rawCurrentKey = useMemo(() => {
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

  // `rawCurrentKey` is a pure, immediate function of logged sets vs targets — the instant a slot's
  // last set lands, it moves straight to the next undone slot. But that slot's card holds its own
  // completion celebration for ~1.8s so it can actually be seen (ExerciseCard), and `isCurrent`
  // driving a scroll to the *next* card that fast would yank the viewport away from it mid-
  // celebration. So a slot that just finished (its count reached target) is held as `currentKey`
  // for that same window; a slot that stops being current for any other reason (a skip, a delete,
  // the normal A/B rotation inside a still-incomplete superset) advances immediately, and clears
  // any in-flight hold rather than stranding it (`useCompletionHold` / `domain/completionHold.ts`).
  const isSlotComplete = useCallback(
    (key: string) => {
      const slot = slots.find((s) => s.key === key);
      if (!slot) return false;
      const done = (setsBySlot.get(key) ?? []).filter((x) => countsForProgression(x.type)).length;
      const target = slot.rx?.targetSets ?? 3;
      return done >= target;
    },
    [slots, setsBySlot],
  );
  const heldKey = useCompletionHold(rawCurrentKey, isSlotComplete);
  const currentKey = heldKey ?? rawCurrentKey;

  // The group (lone slot or superset bracket) that owns `currentKey`, if any — the default seed
  // for every group's expand state, and for the Fold's focused pane.
  const currentGroupKey = useMemo(() => groups.find((g) => g.slots.some((s) => s.key === currentKey))?.key ?? null, [groups, currentKey]);
  // `focusOverride` can outlive its group (the pinned extra got removed) — never trust it without
  // checking it still names a group that exists (§7a).
  const validFocusOverride = useMemo(
    () => (focusOverride !== null && groups.some((g) => g.key === focusOverride) ? focusOverride : null),
    [focusOverride, groups],
  );
  const focusedGroupKey = validFocusOverride ?? currentGroupKey;
  // Every non-skipped slot has reached its target and nothing is mid-celebration — nothing left to
  // log (§7b).
  const allDone = currentGroupKey === null;
  const { doneSets, skippedCount } = useMemo(() => {
    let done = 0;
    let skipCount = 0;
    for (const s of slots) {
      const isSkipped = s.rx ? skipped.has(s.rx.id) : false;
      if (isSkipped) skipCount++;
      else done += s.rx?.targetSets ?? 3;
    }
    return { doneSets: done, skippedCount: skipCount };
  }, [slots, skipped]);

  // Keyboard/screen-reader focus handoff across a card's own completion (§2): a card reports (via
  // `onCompletionFocusHandoff`) that focus was inside it at the moment it just finished; once
  // `currentKey` actually moves on to a new slot (the hold above has cleared), that NEW slot's
  // card claims focus onto its own first live input — but only when a handoff is actually pending,
  // so an ordinary re-render, or the session simply loading in, never steals focus unprompted.
  const pendingFocusHandoffRef = useRef(false);
  const [focusClaimKey, setFocusClaimKey] = useState<string | null>(null);
  const prevCurrentKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevCurrentKeyRef.current;
    prevCurrentKeyRef.current = currentKey;
    if (prev === currentKey) return;
    if (pendingFocusHandoffRef.current && currentKey !== null) setFocusClaimKey(currentKey);
    pendingFocusHandoffRef.current = false;
  }, [currentKey]);
  const handleCompletionFocusHandoff = useCallback(() => {
    pendingFocusHandoffRef.current = true;
  }, []);
  const handleFocusClaimed = useCallback(() => setFocusClaimKey(null), []);

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
      <div className="fold-shell px-3">
        <FoldList
          groups={groups}
          setsBySlot={setsBySlot}
          skipped={skipped}
          currentKey={currentKey}
          focusedGroupKey={focusedGroupKey}
          onFocus={(key) => setFocusOverride(key)}
        />

        <div className="fold-focus">
          {groups.map((group, gi) => {
            const firstSlot = group.slots[0];
            const prevGroup = gi > 0 ? groups[gi - 1] : null;
            const prevSlot = prevGroup ? prevGroup.slots[prevGroup.slots.length - 1] : null;
            const showOptionalDivider = firstSlot.optional && (!prevSlot || !prevSlot.optional);
            const isSuperset = group.slots.length > 1;
            const isPinnedFocus = validFocusOverride !== null && validFocusOverride === group.key;
            const isExpanded = isPinnedFocus ? true : (expandOverride[group.key] ?? group.key === currentGroupKey);
            const onToggleExpand = () => setExpandOverride((prev) => ({ ...prev, [group.key]: !isExpanded }));
            return (
              <div key={group.key} data-fold-entry data-focused={group.key === focusedGroupKey}>
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
                    {group.slots.map((slot) => (
                      <ExerciseCard
                        key={slot.key}
                        session={session}
                        slot={slot}
                        groupSlots={group.slots}
                        setsBySlot={setsBySlot}
                        skipped={skipped}
                        sessionExerciseIds={sessionExerciseIds}
                        sets={setsBySlot.get(slot.key) ?? []}
                        settings={settings}
                        isCurrent={slot.key === currentKey}
                        isSkipped={slot.rx ? skipped.has(slot.rx.id) : false}
                        isGroupExpanded={isExpanded}
                        onToggleGroupExpand={onToggleExpand}
                        claimFocus={slot.key === focusClaimKey}
                        onFocusClaimed={handleFocusClaimed}
                        onCompletionFocusHandoff={handleCompletionFocusHandoff}
                      />
                    ))}
                  </div>
                ) : (
                  <ExerciseCard
                    session={session}
                    slot={firstSlot}
                    groupSlots={group.slots}
                    setsBySlot={setsBySlot}
                    skipped={skipped}
                    sessionExerciseIds={sessionExerciseIds}
                    sets={setsBySlot.get(firstSlot.key) ?? []}
                    settings={settings}
                    isCurrent={firstSlot.key === currentKey}
                    isSkipped={firstSlot.rx ? skipped.has(firstSlot.rx.id) : false}
                    isGroupExpanded={isExpanded}
                    onToggleGroupExpand={onToggleExpand}
                    claimFocus={firstSlot.key === focusClaimKey}
                    onFocusClaimed={handleFocusClaimed}
                    onCompletionFocusHandoff={handleCompletionFocusHandoff}
                  />
                )}
              </div>
            );
          })}

          {allDone && (
            <div data-fold-entry data-focused={focusedGroupKey === null} className="pt-3">
              <AllDoneCard doneSets={doneSets} skippedCount={skippedCount} onFinish={finish} />
            </div>
          )}

          <div className="mt-4 grid gap-3">
            <Button size="lg" variant="outline" full onClick={() => setPickerOpen(true)}>
              Add exercise
            </Button>
            <Button size="lg" variant="ghost" full onClick={() => setDiscardOpen(true)}>
              Discard session
            </Button>
          </div>
          <div className="h-6" />
        </div>
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
