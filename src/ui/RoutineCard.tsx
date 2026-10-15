import { useState, type ReactNode } from 'react';
import type { HomeRoutine } from '@/db/homeQueries';
import { planRow } from '@/domain/homeToday';
import { plural } from '@/domain/format';
import type { Settings } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { ChevronIcon } from '@/ui/components/TopBar';
import { heroDemo } from '@/ui/demoPicture';
import { ExerciseHero, RobotThumb } from '@/ui/ExerciseHero';
import { useNextSessionPlan } from '@/ui/hooks';

/**
 * One routine on Home, as a card. The head says what the routine is and how long since what it
 * trains was last trained ("Back last trained 6 days ago"), with the lead lift's top set from last
 * time; the cards are ordered by that, most rested first, and the order is the whole suggestion:
 * sessions are picked by feel. Start is on the card. Tapping the rest of the card opens what the
 * next session would be (weight, sets by reps, how the weight moved) before committing to it.
 *
 * `active` is true while a session is running: Start is then not offered (the session dock is the
 * way back in), but the plan can still be read.
 */
export function RoutineCard({
  item,
  settings,
  active,
  onStart,
  hero = false,
  overlay,
}: {
  item: HomeRoutine;
  settings: Settings | undefined;
  active: boolean;
  onStart: () => void;
  /** The first, most rested routine: drawn as a cover with its lead lift's render. */
  hero?: boolean;
  /** Drawn over the bottom of the cover, as frosted glass (Home's food tiles). Cover only. */
  overlay?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { routine } = item;
  const empty = item.exerciseCount === 0;
  const detail = [empty ? 'No exercises' : plural(item.exerciseCount, 'exercise'), routine.targetMinutes ? `${routine.targetMinutes} min` : null, routine.isLowerBody ? 'lower' : null]
    .filter(Boolean)
    .join(' · ');

  const startButton = (variant: 'primary' | 'outline') =>
    !active && (
      <Button
        size="md"
        variant={variant}
        data-testid={`start-${routine.name}`}
        disabled={empty}
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
      >
        Start
      </Button>
    );
  const demo = heroDemo(item.demos);

  return (
    <Card data-testid={`routine-card-${routine.name}`} className="overflow-hidden">
      {hero ? (
        // The most rested routine leads Home as a cover: its lead lift's robot render (or the glow),
        // the name in condensed capitals over it, and Start as the one accent pill.
        <ExerciseHero demo={demo} className={`flex flex-col ${overlay ? 'min-h-80' : 'min-h-52'}`}>
          <div className="flex flex-1 items-end">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              data-testid={`routine-toggle-${routine.name}`}
              className="min-w-0 flex-1 self-stretch px-4 pb-4 pt-4 text-left"
            >
              <div className="flex h-full flex-col justify-between gap-10">
                {item.label ? (
                  <span className="self-start rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-fg" data-testid={`routine-rest-${routine.name}`}>
                    {item.label}
                  </span>
                ) : (
                  <span />
                )}
                <div className="min-w-0">
                  <div className="disp break-words text-[2.5rem] [text-shadow:0_1px_12px_rgba(0,0,0,0.6)]">{routine.name}</div>
                  {item.lastTop && (
                    <div className="mt-1 break-words text-sm text-fg/85" data-testid={`routine-top-${routine.name}`}>
                      Last: {item.lastTop}
                    </div>
                  )}
                  <div className="mt-0.5 break-words text-xs text-fg/75">{detail}</div>
                </div>
              </div>
            </button>
            {!active && <div className="flex items-end pb-4 pl-1 pr-4">{startButton('primary')}</div>}
          </div>
          {/* Glass over the render: the day's numbers, frosted, with the robot showing through. */}
          {overlay && <div className="px-3 pb-3">{overlay}</div>}
        </ExerciseHero>
      ) : (
        <div className="flex items-stretch">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid={`routine-toggle-${routine.name}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-card py-3 pl-3 pr-2 text-left active:bg-surface-2"
          >
            <RobotThumb demo={demo} />
            <div className="min-w-0 flex-1">
              <div className="break-words text-lg font-semibold leading-tight">{routine.name}</div>
              {item.label && (
                <div className="mt-1 text-sm font-medium text-accent" data-testid={`routine-rest-${routine.name}`}>
                  {item.label}
                </div>
              )}
              {item.lastTop && (
                <div className="mt-0.5 break-words text-sm text-muted" data-testid={`routine-top-${routine.name}`}>
                  Last: {item.lastTop}
                </div>
              )}
              <div className="mt-0.5 break-words text-xs text-muted">{detail}</div>
            </div>
            <ChevronIcon className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
          {!active && <div className="flex items-center pl-1 pr-4">{startButton('outline')}</div>}
        </div>
      )}
      {open && <RoutinePlan routineId={routine.id} name={routine.name} settings={settings} />}
    </Card>
  );
}

/** The next session of a routine, exercise by exercise. Mounted only while its card is open, so a closed card costs no query. */
function RoutinePlan({ routineId, name, settings }: { routineId: string; name: string; settings: Settings | undefined }) {
  const plan = useNextSessionPlan(routineId, settings);
  return (
    <div className="border-t border-line px-4 pb-2 pt-1" data-testid={`routine-plan-${name}`}>
      {plan === undefined && <div className="py-3 text-sm text-muted">Loading the plan…</div>}
      {plan === null && <div className="py-3 text-sm text-muted">This routine is gone.</div>}
      {plan && plan.items.length === 0 && <div className="py-3 text-sm text-muted">No exercises yet.</div>}
      {plan?.items.map(({ rx, exercise, prescription }) => {
        const row = planRow({ kind: exercise.kind, rx, prescription });
        return (
          <div key={rx.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="plan-row">
            <div className="min-w-0">
              <div className="break-words font-semibold" data-testid="plan-row-name">
                {exercise.name}
              </div>
              <div className="num text-sm text-muted" data-testid="plan-row-scheme">
                {row.scheme}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {row.weight && (
                <div className="num font-bold" data-testid="plan-row-weight">
                  {row.weight}
                </div>
              )}
              {(row.change || row.flags.length > 0) && (
                <div className="flex gap-1">
                  {row.change && (
                    <Chip size="sm" tone={row.change.tone} testId="plan-row-change">
                      {row.change.text}
                    </Chip>
                  )}
                  {row.flags.map((f) => (
                    <Chip key={f} size="sm" tone="warn">
                      {f}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
