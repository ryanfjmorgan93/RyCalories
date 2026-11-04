import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { bestsForExercise } from '@/db/recordsQueries';
import { liftStanding, type LiftTable, type MeetLift } from '@/domain/liftStandards';
import { e1rmShown, strengthStanding } from '@/domain/standards';
import type { Exercise, Settings } from '@/domain/types';

let tablePromise: Promise<LiftTable> | null = null;

/**
 * The lift's level (domain/standards.ts) under its name in the session: the best finished e1RM
 * against the latest weigh-in, for the sex in Settings → About you. Nothing without a standard, a
 * sex, a weigh-in or an e1RM. The meet table (100 KB) loads only for a lift that has a standard.
 */
export function StrengthLine({ exercise, settings }: { exercise: Exercise; settings: Settings }) {
  const standard = exercise.standard;
  const [table, setTable] = useState<LiftTable | null>(null);
  useEffect(() => {
    if (!standard) return;
    tablePromise ??= import('@/data/liftStandards.json').then((m) => m.default as LiftTable);
    void tablePromise.then(setTable);
  }, [standard]);
  const data = useLiveQuery(async () => {
    if (!standard || !settings.sex) return null;
    const [bests, weighIn] = await Promise.all([bestsForExercise(exercise.id), db.bodyweight.orderBy('date').last()]);
    return bests.e1rm !== null && weighIn ? { e1rmKg: bests.e1rm, bodyweightKg: weighIn.kg } : null;
  }, [exercise.id, standard, settings.sex]);
  if (!standard || !settings.sex || !data) return null;

  const age = settings.birthYear ? new Date().getFullYear() - settings.birthYear : null;
  const meet =
    table && age !== null && standard !== 'press' && standard !== 'row'
      ? liftStanding(table, { sex: settings.sex, age, bodyweightKg: data.bodyweightKg, lift: standard as MeetLift, e1rmKg: e1rmShown(data.e1rmKg) })
      : null;
  const s = strengthStanding({ standard, sex: settings.sex, ...data, meet });
  if (!s) return null;
  return (
    <div className="num mt-1 text-sm text-fg/85" data-testid="strength-line">
      <div>
        <span className="font-bold text-fg">{s.level}</span> · {s.head}
      </div>
      {s.next && <div>{s.next}</div>}
    </div>
  );
}
