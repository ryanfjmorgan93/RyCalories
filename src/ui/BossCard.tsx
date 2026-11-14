import type { BossView } from '@/db/bossQueries';
import { addDays, daysBetween, fmtDateKey } from '@/domain/dates';
import { fmtKg, fmtNum, plural } from '@/domain/format';
import type { Routine } from '@/domain/types';
import { Button } from './components/Button';
import { Card, SectionTitle } from './components/Card';
import { SwordsIcon } from './components/TopBar';
import { robotSrc } from './demoPicture';
import { ExerciseHero } from './ExerciseHero';
import { Hex, Medallion, Segments } from './GameMarks';

const setLine = (s: { weight: number; reps: number }) => `${fmtKg(s.weight)} × ${s.reps}`;

/**
 * Home's weekly boss (docs/superpowers/specs/2026-11-12-boss-fight-design.md), under the routine that
 * leads: the lift's robot render in a red-lit arena with nothing over it (a hexagon with the boss
 * weight when the lift has none), its name, its health, the planned set that beats it against the
 * best set it is, and Fight, which starts that routine. Then the bosses beaten, newest first.
 */
export function BossCard({
  view,
  beaten,
  active,
  today,
  onFight,
}: {
  view: BossView | null;
  beaten: { id: string; name: string; weight: number; reps: number }[];
  active: boolean;
  today: string;
  onFight: (r: Routine) => void;
}) {
  const fight = view && !view.beatenBy ? view : null;
  // Today counts: on Sunday the boss has a day left, the last one.
  const daysLeft = view ? daysBetween(today, addDays(view.boss.week, 6)) + 1 : 0;
  return (
    <>
      {view && (
        <section data-testid="boss">
          <SectionTitle right={!view.beatenBy && <span className="num text-[13px] text-muted">{plural(daysLeft, 'day')} left</span>}>This week's boss</SectionTitle>
          <Card framed className="overflow-hidden">
            {robotSrc(view.exercise.demo) ? (
              <ExerciseHero demo={view.exercise.demo} arena className="boss-stage h-72" />
            ) : (
              <div className="flex justify-center pt-6">
                <Hex size="lg">
                  <span className="num text-3xl font-light">{fmtNum(view.boss.weight)}</span>
                  <span className="label">kg × {view.boss.reps}</span>
                </Hex>
              </div>
            )}
            <div className="px-5 pb-5 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="serif min-w-0 break-words text-[2.375rem]" data-testid="boss-name">
                  {view.exercise.name}
                </div>
                {view.beatenBy && (
                  <span className="shrink-0 pt-3 text-[11px] font-medium uppercase tracking-[0.2em] text-accent" data-testid="boss-beaten">
                    Beaten
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-baseline justify-between">
                <span className="label">Health</span>
                <span className="num text-[13px]">{view.health}%</span>
              </div>
              <Segments percent={view.health} up fill="bg-boss" label="Boss health" className="mt-2.5 h-3 [&>span]:rounded-[3px]" testId="boss-health" />
              {/* You against it: the planned set that beats it (or falls short), the swords, its best. */}
              <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-start gap-2 border-t border-line pt-5">
                <div className="min-w-0">
                  {fight?.attack && fight.routine ? (
                    <div data-testid="boss-attack">
                      <div className="label">Your attack</div>
                      <div className="num mt-2 text-[1.75rem] font-light leading-none tracking-[-0.03em]">{setLine(fight.attack)}</div>
                      <div className="mt-1.5 break-words text-xs text-muted">{fight.routine.name}</div>
                    </div>
                  ) : fight?.short ? (
                    <div className="num text-[13px] text-muted" data-testid="boss-short">
                      Your plan {setLine(fight.short)} falls short
                    </div>
                  ) : null}
                </div>
                <span className="pt-6 text-dim">
                  <SwordsIcon />
                </span>
                <div className="min-w-0 text-right" data-testid="boss-best">
                  <div className="label">Boss</div>
                  <div className="num mt-2 text-[1.75rem] font-light leading-none tracking-[-0.03em] text-boss">{setLine(view.boss)}</div>
                  <div className="mt-1.5 text-xs text-muted">Best · {fmtDateKey(view.bestDate)}</div>
                </div>
              </div>
              {fight?.routine && !active && (
                <Button variant="primary" size="lg" full icon={<span className="text-boss"><SwordsIcon /></span>} className="mt-5" data-testid="boss-fight" onClick={() => onFight(fight.routine!)}>
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
