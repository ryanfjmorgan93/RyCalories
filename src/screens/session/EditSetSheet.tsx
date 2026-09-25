import { useState } from 'react';
import { fmtWeight } from '@/domain/format';
import type { Exercise, SetLog, SetType } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Chip } from '@/ui/components/Chip';
import { NumberField } from '@/ui/components/NumberField';
import { Sheet } from '@/ui/components/Sheet';

/**
 * Edit a logged set: its type, values, or delete it. No RIR/RPE here — effort is answered once,
 * for the whole slot, by the "How did that feel?" chips on the done card (`setSlotFeel`).
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
  onSave: (patch: Partial<Pick<SetLog, 'weight' | 'reps' | 'type' | 'distanceM' | 'seconds' | 'rir'>>) => void;
}) {
  const [weight, setWeight] = useState<number | null>(set.weight);
  const [reps, setReps] = useState<number | null>(set.reps ?? null);
  const [distanceM, setDistance] = useState<number | null>(set.distanceM ?? null);
  const [seconds, setSeconds] = useState<number | null>(set.seconds ?? null);
  const [type, setType] = useState<SetType>(set.type);
  return (
    <Sheet open onClose={onClose} title="Edit set">
      <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Set type" data-sheet-nodrag>
        <Chip size="lg" tone="warn" active={type === 'warmup'} onClick={() => setType('warmup')}>
          Warm-up
        </Chip>
        <Chip size="lg" active={type === 'working'} onClick={() => setType('working')}>
          Working
        </Chip>
        <Chip size="lg" tone="danger" active={type === 'failure'} onClick={() => setType('failure')}>
          Failure
        </Chip>
        <Chip size="lg" tone="info" active={type === 'drop'} onClick={() => setType('drop')}>
          Drop
        </Chip>
      </div>
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
              type,
              // A set that isn't `working` never has an effort answer of its own — a warm-up and a
              // drop are never counted, and a failure always reads as RIR 0 regardless (`effortRir`).
              // Without this, retyping a working set that inherited a feel-chip RIR leaves that RIR
              // sitting on the row after the type change, and `effortRir` honours a logged RIR over
              // the type's own implicit one — so a set just retyped to Failure could still read as
              // RIR 3 and feed a double-increment suggestion it never earned (§3).
              ...(type !== 'working' ? { rir: undefined } : {}),
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
