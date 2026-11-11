import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import type { Game } from '@/db/gameQueries';
import { bestsForExercise } from '@/db/recordsQueries';
import { muscleLabel } from '@/domain/format';
import { liftStanding, type LiftTable } from '@/domain/liftStandards';
import { e1rmShown, strengthStanding, type StrengthStanding } from '@/domain/standards';
import { bodyShades, RANKED_GROUPS, type RankedLift } from '@/domain/strengthBody';
import type { MuscleGroup, Settings } from '@/domain/types';
import { BodyFigure } from './components/BodyMap';
import { Button } from './components/Button';
import { SectionTitle } from './components/Card';
import { liftTable } from './StrengthLine';

const LIFTS: RankedLift[] = ['squat', 'bench', 'deadlift'];
const LIFT_NAME: Record<RankedLift, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };

/**
 * Home's strength figure (asked for in November 2026, in place of Today's hand): the robot with
 * legs, chest and back lit in the accent by how the owner's squat, bench and deadlift rank against
 * lifters of their sex, bodyweight and age, and every other muscle lit in cream by their own best
 * Level on it. The rules are domain/strengthBody.ts; a tap on a muscle says which it is and why.
 * Ranking needs a sex (Settings → About you) and a weigh-in, and says so when either is missing.
 */
export function StrengthBody({ game, settings }: { game: Game; settings: Settings }) {
  const nav = useNavigate();
  const [table, setTable] = useState<LiftTable | null>(null);
  const [picked, setPicked] = useState<MuscleGroup | null>(null);
  useEffect(() => {
    void liftTable().then(setTable);
  }, []);
  // The best e1RM on each ranked lift, across every exercise that stands for it, and the latest weigh-in.
  const data = useLiveQuery(async () => {
    const weighIn = await db.bodyweight.orderBy('date').last();
    const best: Partial<Record<RankedLift, { kg: number; name: string }>> = {};
    for (const g of game.levels) {
      const lift = g.exercise.standard;
      if (lift !== 'squat' && lift !== 'bench' && lift !== 'deadlift') continue;
      const e1rm = (await bestsForExercise(g.exercise.id)).e1rm;
      if (e1rm !== null && e1rm > (best[lift]?.kg ?? 0)) best[lift] = { kg: e1rm, name: g.exercise.name };
    }
    return { bodyweightKg: weighIn?.kg ?? null, best };
  }, [game]);
  if (!data) return null;

  const age = settings.birthYear ? new Date().getFullYear() - settings.birthYear : null;
  const ranked: Partial<Record<RankedLift, StrengthStanding>> = {};
  if (settings.sex && data.bodyweightKg) {
    for (const lift of LIFTS) {
      const b = data.best[lift];
      if (!b) continue;
      const meet = table && age !== null ? liftStanding(table, { sex: settings.sex, age, bodyweightKg: data.bodyweightKg, lift, e1rmKg: e1rmShown(b.kg) }) : null;
      const s = strengthStanding({ standard: lift, sex: settings.sex, e1rmKg: b.kg, bodyweightKg: data.bodyweightKg, meet });
      if (s) ranked[lift] = s;
    }
  }
  const shades = bodyShades(
    ranked,
    game.levels.map((g) => ({ group: g.exercise.muscleGroup, level: g.level.level, exercise: g.exercise.name })),
  );
  if (shades.size === 0) return null;

  const hasRanked = LIFTS.some((l) => ranked[l]);
  const hasOwn = [...shades.values()].some((s) => s.kind === 'own');
  const anyBig = LIFTS.some((l) => data.best[l]);
  // What ranking still needs, as a fact and the way to it.
  const needs = !anyBig ? null : !settings.sex ? 'your sex' : !data.bodyweightKg ? 'a weigh-in' : null;
  const shade = picked ? shades.get(picked) : undefined;
  const readout = !picked
    ? 'Tap a muscle'
    : !shade
      ? `${muscleLabel(picked)} · nothing logged for it yet`
      : shade.kind === 'ranked'
        ? `${muscleLabel(picked)} · ${LIFT_NAME[shade.lift]}: ${shade.standing.level}, against lifters like you`
        : `${muscleLabel(picked)} · Level ${shade.level} on ${shade.exercise}, against your own start`;

  return (
    <section data-testid="strength-body">
      <SectionTitle>Your strength</SectionTitle>
      <BodyFigure
        label="Your strength, front and back"
        onPick={setPicked}
        fillOf={(group) => {
          const s = shades.get(group);
          if (!s) return { colour: 'transparent', opacity: 0 };
          return s.kind === 'ranked' ? { colour: 'var(--c-accent)', opacity: s.opacity } : { colour: 'var(--c-fg)', opacity: s.opacity, blend: 'screen' };
        }}
      />
      <div className="mt-2 text-center text-sm text-muted" data-testid="strength-readout">
        {readout}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {hasRanked && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
            Against lifters your sex, weight and age
          </span>
        )}
        {hasOwn && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-fg/70" />
            Your own level
          </span>
        )}
      </div>

      {hasRanked && (
        <div className="mt-3">
          {LIFTS.map((lift) => {
            const s = ranked[lift];
            if (!s) return null;
            return (
              <div key={lift} className="flex items-start justify-between gap-3 border-t border-line py-3" data-testid={`strength-${lift}`}>
                <div className="min-w-0">
                  <div className="text-lg leading-tight">{RANKED_GROUPS[lift].map(muscleLabel).join(' and ')}</div>
                  <div className="num mt-0.5 text-sm text-muted">
                    {data.best[lift]!.name} · {s.head}
                  </div>
                  {s.next && <div className="num mt-0.5 text-sm text-accent">{s.next}</div>}
                </div>
                <span className="label shrink-0 pt-1 !text-accent">{s.level}</span>
              </div>
            );
          })}
        </div>
      )}

      {needs && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm text-muted" data-testid="strength-needs">
          <span>Ranking legs, chest and back needs {needs}.</span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => nav(needs === 'a weigh-in' ? '/body' : '/settings')}>
            {needs === 'a weigh-in' ? 'Weigh in' : 'Settings'}
          </Button>
        </div>
      )}
    </section>
  );
}
