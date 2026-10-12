import { useState } from 'react';
import { fmtWeight } from '@/domain/format';
import type { Exercise, SetLog } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { NumberField } from '@/ui/components/NumberField';
import { Sheet } from '@/ui/components/Sheet';

/**
 * Edit a logged set: its values, or delete it. Used by the live session and by a finished
 * session's detail page. No set type and no RIR/RPE here — a set is just weight and reps, and
 * effort is answered once, for the whole slot, by the "How did that feel?" chips on the done card
 * (`setSlotFeel`). A set stored as a warm-up, failure or drop keeps its type when it is edited.
 */
export function EditSetSheet({
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
  onSave: (patch: Partial<Pick<SetLog, 'weight' | 'reps' | 'distanceM' | 'seconds'>>) => void;
}) {
  const [weight, setWeight] = useState<number | null>(set.weight);
  const [reps, setReps] = useState<number | null>(set.reps ?? null);
  const [distanceM, setDistance] = useState<number | null>(set.distanceM ?? null);
  const [seconds, setSeconds] = useState<number | null>(set.seconds ?? null);
  return (
    <Sheet open onClose={onClose} title="Edit set">
      <div className="grid grid-cols-2 gap-2">
        {kind !== 'timed' && (
          <NumberField label={kind === 'bodyweight_plus' ? 'Added kg' : 'kg'} value={weight} onChange={setWeight} step={increment} />
        )}
        {(kind === 'reps' || kind === 'bodyweight_plus') && <NumberField label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />}
        {kind === 'carry' && <NumberField label="Metres" value={distanceM} onChange={setDistance} step={5} mode="numeric" />}
        {(kind === 'carry' || kind === 'timed') && <NumberField label="Seconds" value={seconds} onChange={setSeconds} step={5} mode="numeric" />}
      </div>
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
