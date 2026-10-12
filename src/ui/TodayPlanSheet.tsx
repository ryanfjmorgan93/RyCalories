import { useState } from 'react';
import { setPlanOverride } from '@/db/repo';
import { MAX_TARGET_SETS, overrideFor } from '@/domain/planOverride';
import type { Exercise, PlanOverride, RoutineExercise, Session } from '@/domain/types';
import { Button } from './components/Button';
import { NumberField } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';

/**
 * "Change today": sets, rep range and weight for ONE exercise in the live session, without
 * touching the saved routine. Save writes `Session.planOverrides` (`setPlanOverride`); the card
 * then offers "Keep in routine" and "Undo". Works offline, no AI needed.
 *
 * `saved` is the routine-exercise as stored, `today` the plan the session is running now (the
 * saved one with any earlier override on it) — the steppers start from `today`. Fields that end up
 * equal to the routine are dropped by `setPlanOverride`, so changing a number back is the same as
 * not having changed it.
 */
export function TodayPlanSheet({
  open,
  onClose,
  session,
  saved,
  today,
  exercise,
}: {
  open: boolean;
  onClose: () => void;
  session: Session;
  saved: RoutineExercise;
  today: RoutineExercise;
  exercise: Exercise;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Change today">
      <TodayPlanForm onClose={onClose} session={session} saved={saved} today={today} exercise={exercise} />
    </Sheet>
  );
}

function TodayPlanForm({
  onClose,
  session,
  saved,
  today,
  exercise,
}: {
  onClose: () => void;
  session: Session;
  saved: RoutineExercise;
  today: RoutineExercise;
  exercise: Exercise;
}) {
  const kind = exercise.kind;
  const hasReps = kind !== 'carry';
  const hasWeight = (kind === 'reps' || kind === 'bodyweight_plus') && saved.mode === 'normal';
  const repLabel = kind === 'timed' ? 'Seconds' : 'Reps';

  const [sets, setSets] = useState<number | null>(today.targetSets);
  const [repMin, setRepMin] = useState<number | null>(today.repMin);
  const [repMax, setRepMax] = useState<number | null>(today.repMax);
  const [weight, setWeight] = useState<number | null>(today.currentWeight);
  const [saving, setSaving] = useState(false);

  const active = overrideFor(saved.id, session) !== undefined;
  const weightStep = Math.max(0.25, saved.increment || 2.5);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Every field this lift can change is sent: a number sets it (or is dropped as unchanged),
      // an emptied field is sent as undefined, which puts that field back to the routine's.
      const patch: PlanOverride = { targetSets: sets ?? undefined };
      let notice = '';
      if (hasReps) {
        let lo = repMin ?? undefined;
        let hi = repMax ?? undefined;
        if (lo !== undefined && hi !== undefined && lo > hi) {
          [lo, hi] = [hi, lo];
          notice = kind === 'timed' ? 'Seconds range swapped' : 'Rep range swapped';
        }
        patch.repMin = lo;
        patch.repMax = hi;
      }
      if (hasWeight) patch.weight = weight ?? undefined;
      await setPlanOverride(session.id, saved.id, patch);
      if (notice) toast(notice);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setPlanOverride(session.id, saved.id, null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="today-plan-sheet">
      <div className="mb-3 text-sm text-muted">
        {exercise.name}. For today only: your routine stays as it is unless you choose Keep in routine afterwards.
      </div>

      <NumberField label="Sets" value={sets} onChange={setSets} step={1} min={1} max={MAX_TARGET_SETS} mode="numeric" size="md" testId="today-sets" />

      {hasReps && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <NumberField
            label={`${repLabel} min`}
            value={repMin}
            onChange={setRepMin}
            step={kind === 'timed' ? 5 : 1}
            min={1}
            mode="numeric"
            size="md"
            testId="today-repmin"
          />
          <NumberField
            label={`${repLabel} max`}
            value={repMax}
            onChange={setRepMax}
            step={kind === 'timed' ? 5 : 1}
            min={1}
            mode="numeric"
            size="md"
            testId="today-repmax"
          />
        </div>
      )}

      {hasWeight && (
        <div className="mt-4">
          <NumberField
            label={kind === 'bodyweight_plus' ? 'Added kg' : 'Weight (kg)'}
            value={weight}
            onChange={setWeight}
            step={weightStep}
            min={0}
            unit="kg"
            mode="decimal"
            size="md"
            testId="today-weight"
          />
        </div>
      )}

      <div className="mt-5 grid gap-3">
        <Button size="lg" variant="primary" full disabled={saving} onClick={() => void save()} data-testid="today-save">
          Save for today
        </Button>
        {active && (
          <Button size="md" variant="ghost" full disabled={saving} onClick={() => void reset()} data-testid="today-reset">
            Back to the routine plan
          </Button>
        )}
      </div>
    </div>
  );
}
