import type { BossView } from '@/db/bossQueries';
import { fmtDateKey } from '@/domain/dates';
import { fmtKg, fmtNum } from '@/domain/format';
import type { Routine } from '@/domain/types';
import { Button } from './components/Button';
import { Card, SectionTitle } from './components/Card';
import { robotSrc } from './demoPicture';
import { ExerciseHero } from './ExerciseHero';
import { Hex, Medallion, Segments } from './GameMarks';

const setLine = (s: { weight: number; reps: number }) => `${fmtKg(s.weight)} × ${s.reps}`;

/**
 * Home's weekly boss (docs/superpowers/specs/2026-11-12-boss-fight-design.md), under the routine that
 * leads: the lift's robot render with nothing over it (a hexagon with the boss weight when the lift
 * has none), the best set it is, its health, the planned set that beats it and Fight, which starts
 * that routine. Then the bosses beaten, newest first.
 */
export function BossCard({
  view,
  beaten,
  active,
  onFight,
}: {
  view: BossView | null;
  beaten: { id: string; name: string; weight: number; reps: number }[];
  active: boolean;
  onFight: (r: Routine) => void;
}) {
  const fight = view && !view.beatenBy ? view : null;
  return (
    <>
      {view && (
        <section data-testid="boss">
          <SectionTitle>This week's boss</SectionTitle>
          <Card framed className="overflow-hidden">
            {robotSrc(view.exercise.demo) ? (
              <ExerciseHero demo={view.exercise.demo} className="h-44" />
            ) : (
              <div className="flex justify-center pt-5">
                <Hex size="lg">
                  <span className="num text-3xl font-light">{fmtNum(view.boss.weight)}</span>
                  <span className="label">kg × {view.boss.reps}</span>
                </Hex>
              </div>
            )}
            <div className="px-4 pb-4 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="disp break-words text-[1.75rem]" data-testid="boss-name">
                    {view.exercise.name}
                  </div>
                  <div className="num mt-0.5 text-sm text-muted" data-testid="boss-best">
                    Best {setLine(view.boss)} · {fmtDateKey(view.bestDate)}
                  </div>
                </div>
                {view.beatenBy && (
                  <span className="label shrink-0 pt-2 !text-accent" data-testid="boss-beaten">
                    Beaten
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="label">Health</span>
                <span className="num text-xs text-muted">{view.health}%</span>
              </div>
              <Segments percent={view.health} up fill="bg-danger/70" label="Boss health" className="mt-2 h-2.5" testId="boss-health" />
              {fight?.attack && fight.routine && (
                <div className="mt-4 border-t border-line pt-3" data-testid="boss-attack">
                  <div className="label">Your attack</div>
                  <div className="num mt-1 text-2xl font-light">{setLine(fight.attack)}</div>
                  <div className="text-sm text-muted">{fight.routine.name}</div>
                </div>
              )}
              {fight?.short && (
                <div className="num mt-4 border-t border-line pt-3 text-sm text-muted" data-testid="boss-short">
                  Your plan {setLine(fight.short)} falls short
                </div>
              )}
              {fight?.routine && !active && (
                <Button variant="primary" size="lg" full className="mt-4" data-testid="boss-fight" onClick={() => onFight(fight.routine!)}>
                  Fight
                </Button>
              )}
            </div>
          </Card>
        </section>
      )}
      {beaten.length > 0 && (
        <section>
          <SectionTitle>Bosses beaten</SectionTitle>
          <div className="flex gap-4 overflow-x-auto pb-1" data-testid="bosses-beaten">
            {beaten.map((b) => (
              <div key={b.id} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 text-center">
                <Medallion className="h-14 w-14 text-xs">
                  {fmtNum(b.weight)} × {b.reps}
                </Medallion>
                <span className="text-xs leading-tight text-muted">{b.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
