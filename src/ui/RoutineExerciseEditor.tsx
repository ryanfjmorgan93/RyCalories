import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { flushSync } from 'react-dom';
import { removeRoutineExercise, updateRoutineExercise, type RoutineItem } from '@/db/repo';
import type { Exercise, ProgressionMode, RoutineExercise, Settings } from '@/domain/types';
import { Button } from './components/Button';
import { Segmented, Toggle } from './components/Chip';
import { NumberField, NumberInput, TextInput } from './components/NumberField';
import { Confirm, Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { useSettings } from './hooks';

/** Rest seconds used when a routine-exercise has no override (mirrors the live-session rule). */
export function defaultRestSec(exercise: Exercise, settings: Settings | undefined): number {
  if (exercise.defaultRestSec) return exercise.defaultRestSec;
  if (!settings) return exercise.kind === 'carry' ? 90 : exercise.isCompound ? 150 : 75;
  if (exercise.kind === 'carry') return settings.restCarrySec;
  return exercise.isCompound ? settings.restCompoundSec : settings.restIsolationSec;
}

/**
 * Bottom-sheet editor for one routine-exercise. Mount with `key={rx.id}` so the form
 * state resets when a different item is opened.
 */
export function RoutineExerciseEditor({
  open,
  item,
  onClose,
  onRemoved,
}: {
  open: boolean;
  item: RoutineItem | null;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const settings = useSettings();
  const [removeOpen, setRemoveOpen] = useState(false);
  const rx = item?.rx;
  const exercise = item?.exercise;

  const [sets, setSets] = useState<number | null>(rx?.targetSets ?? 3);
  const [setsMax, setSetsMax] = useState<number | null>(rx?.targetSetsMax ?? null);
  const [repMin, setRepMin] = useState<number | null>(rx?.repMin ?? 1);
  const [repMax, setRepMax] = useState<number | null>(rx?.repMax ?? 1);
  const [distMin, setDistMin] = useState<number | null>(rx?.distanceMinM ?? null);
  const [distMax, setDistMax] = useState<number | null>(rx?.distanceMaxM ?? null);
  const [mode, setMode] = useState<ProgressionMode>(rx?.mode ?? 'calibrating');
  const [weight, setWeight] = useState<number | null>(rx?.currentWeight ?? 0);
  const [increment, setIncrement] = useState<number | null>(rx?.increment ?? 2.5);
  const [rest, setRest] = useState<number | null>(rx?.restSecOverride ?? null);
  const [cue, setCue] = useState(rx?.cue ?? '');
  const [notes, setNotes] = useState(rx?.notes ?? '');
  const [optional, setOptional] = useState(rx?.optional ?? false);
  const [link, setLink] = useState(rx?.linkProgression ?? false);
  // Other routines that also contain this exercise (the §4.8 link only means something then).
  const others = useLiveQuery(
    async () => (rx ? (await db.routineExercises.where('exerciseId').equals(rx.exerciseId).toArray()).filter((r) => r.id !== rx.id) : []),
    [rx?.id, rx?.exerciseId],
  );

  if (!rx || !exercise) return null;

  const kind = exercise.kind;
  const restDefault = defaultRestSec(exercise, settings);
  const step = Math.max(0.25, increment ?? rx.increment ?? 2.5);
  const weightLabel = kind === 'bodyweight_plus' ? 'Added kg' : 'Current weight (kg)';
  const repLabel = kind === 'timed' ? 'Seconds' : 'Reps';

  const save = async () => {
    const notices: string[] = [];
    const patch: Partial<Omit<RoutineExercise, 'id' | 'routineId'>> = {};

    const targetSets = clampInt(sets ?? rx.targetSets, 1, 12);
    patch.targetSets = targetSets;
    if (setsMax === null) {
      patch.targetSetsMax = undefined;
    } else {
      const m = clampInt(setsMax, 1, 12);
      if (m < targetSets) notices.push('Up to raised to match sets');
      patch.targetSetsMax = Math.max(m, targetSets);
    }

    if (kind === 'carry') {
      patch.repMin = 1;
      patch.repMax = 1;
      let dMin = distMin;
      let dMax = distMax;
      if (dMin !== null && dMax !== null && dMin > dMax) {
        [dMin, dMax] = [dMax, dMin];
        notices.push('Distance range swapped');
      }
      patch.distanceMinM = dMin ?? undefined;
      patch.distanceMaxM = dMax ?? undefined;
    } else {
      let lo = Math.max(1, Math.round(repMin ?? rx.repMin));
      let hi = Math.max(1, Math.round(repMax ?? rx.repMax));
      if (lo > hi) {
        [lo, hi] = [hi, lo];
        notices.push(kind === 'timed' ? 'Seconds range swapped' : 'Rep range swapped');
      }
      patch.repMin = lo;
      patch.repMax = hi;
    }

    patch.mode = mode;
    if (mode === 'normal') patch.currentWeight = Math.max(0, weight ?? rx.currentWeight);
    patch.increment = Math.max(0.25, increment ?? rx.increment);
    patch.restSecOverride = rest !== null && rest > 0 ? Math.round(rest) : undefined;
    patch.cue = cue.trim() || undefined;
    patch.notes = notes.trim() || undefined;
    patch.optional = optional;
    patch.linkProgression = link;

    await updateRoutineExercise(rx.id, patch);
    toast(notices.length ? notices.join(' · ') : 'Saved', notices.length ? 'neutral' : 'ok');
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={exercise.name}
        footer={
          <div className="grid gap-3">
            <Button size="lg" variant="primary" full onClick={() => void save()} data-testid="rx-save">
              Save
            </Button>
            <Button size="md" variant="danger" full onClick={() => setRemoveOpen(true)}>
              Remove from routine
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <NumberField label="Sets" value={sets} onChange={setSets} step={1} min={1} max={12} mode="numeric" size="md" testId="rx-sets" />
          <div className="w-24">
            <Label>Up to</Label>
            <NumberInput value={setsMax} onChange={setSetsMax} mode="numeric" min={1} max={12} placeholder="—" />
          </div>
        </div>

        {kind === 'carry' ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <Label>Distance min (m)</Label>
              <NumberInput value={distMin} onChange={setDistMin} mode="numeric" min={0} placeholder="m" />
            </div>
            <div>
              <Label>Distance max (m)</Label>
              <NumberInput value={distMax} onChange={setDistMax} mode="numeric" min={0} placeholder="m" />
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <NumberField label={`${repLabel} min`} value={repMin} onChange={setRepMin} step={1} min={1} mode="numeric" size="md" testId="rx-repmin" />
            <NumberField label={`${repLabel} max`} value={repMax} onChange={setRepMax} step={1} min={1} mode="numeric" size="md" testId="rx-repmax" />
          </div>
        )}

        <div className="mt-4">
          <Label>Mode</Label>
          <Segmented<ProgressionMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'calibrating', label: 'Calibrating' },
            ]}
          />
        </div>

        {mode === 'normal' && (
          <div className="mt-4">
            <NumberField label={weightLabel} value={weight} onChange={setWeight} step={step} min={0} unit="kg" mode="decimal" testId="rx-weight" />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <Label>Increment (kg)</Label>
            <NumberInput value={increment} onChange={setIncrement} mode="decimal" min={0.25} placeholder="2.5" testId="rx-increment" />
          </div>
          <div>
            <Label>Rest (s)</Label>
            <NumberInput value={rest} onChange={setRest} mode="numeric" min={0} placeholder={`default ${restDefault} s`} testId="rx-rest" />
          </div>
        </div>
        <div className="mt-1 px-1 text-xs text-muted">Empty rest uses the exercise default ({restDefault} s).</div>

        <div className="mt-4">
          <Label>Cue</Label>
          <TextInput value={cue} onChange={setCue} placeholder="One line, shown in session" testId="rx-cue" />
        </div>
        <div className="mt-4">
          <Label>Notes</Label>
          <TextInput value={notes} onChange={setNotes} multiline placeholder="Notes" />
        </div>

        <div className="mt-2">
          <Toggle checked={optional} onChange={setOptional} label="Optional (skippable tail)" />
        </div>
        {others && others.length > 0 && (
          <div className="border-t border-line">
            <Toggle
              checked={link}
              onChange={setLink}
              label="Link progression across routines"
              sub={`Shares weight, mode and increment with ${others.filter((o) => o.linkProgression).length} of ${others.length} other ${others.length === 1 ? 'copy' : 'copies'} of this exercise`}
            />
          </div>
        )}
        <div className="h-2" />
      </Sheet>

      <Confirm
        open={removeOpen}
        title={`Remove ${exercise.name}?`}
        body="Its weight and rep range for this routine will be lost. Logged sets are kept."
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoveOpen(false)}
        onConfirm={async () => {
          // Unmount the Confirm sheet before the editor sheet so the stacked body
          // scroll locks unwind in order (otherwise body overflow stays 'hidden').
          flushSync(() => setRemoveOpen(false));
          await removeRoutineExercise(rx.id);
          toast('Removed from routine');
          onRemoved?.();
          onClose();
        }}
      />
    </>
  );
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{children}</div>;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
