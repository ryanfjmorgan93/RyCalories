import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Game, GameLevel } from '@/db/gameQueries';
import { badgeCount, nearestBadge } from '@/domain/badges';
import { fmtNum } from '@/domain/format';
import { levelText } from '@/domain/level';
import { SectionTitle } from './components/Card';
import { Sheet } from './components/Sheet';
import { ExerciseHero } from './ExerciseHero';
import { Hex, Medallion, Segments } from './GameMarks';
import { LevelBar } from './LevelLine';

/**
 * Home's game, in three parts, all read off what was trained (db/gameQueries.ts): the total level
 * in its hexagon with the way to the next total-level badge, today's hand (the lifts of the current
 * routines nearest their next level, as cards), and the cabinet of badges, whose ladders open in a
 * sheet. Each part shows nothing until there is something true to show.
 */

const started = (game: Game) => badgeCount(game.ladders) > 0 || game.levels.some((l) => l.level.startIn === 0);

/** The total level, what has been done to earn it, and the blocks to the next total-level badge. */
export function LevelHeader({ game }: { game: Game }) {
  if (!started(game)) return null;
  const next = game.ladders.find((l) => l.id === 'level')?.next;
  return (
    <section className="mt-4" data-testid="levels-card">
      <div className="flex items-center gap-4">
        <Hex size="lg">
          <span className="text-[9px] font-medium uppercase tracking-[0.13em] text-muted">Total level</span>
          <span className="num text-[44px] font-light leading-none" data-testid="total-level">
            {game.total}
          </span>
        </Hex>
        <div className="num min-w-0 space-y-1 text-sm text-muted">
          <div>
            <span className="text-lg font-medium text-fg">{badgeCount(game.ladders)}</span> badges held
          </div>
          <div>
            <span className="text-lg font-medium text-fg">{game.sessions}</span> sessions
          </div>
          <div>
            <span className="text-lg font-medium text-fg">{fmtNum(Math.round(game.liftedKg / 100) / 10)}</span> tonnes lifted
          </div>
        </div>
      </div>
      {next && (
        <>
          <Segments percent={Math.min(99, Math.floor(next.done * 100 + 1e-6))} label={`To ${next.name}`} className="mt-3 h-2" />
          <div className="num mt-1.5 flex justify-between text-xs text-muted">
            <span>Badge at level {next.chip}</span>
            <span className="text-accent">{next.toGo}</span>
          </div>
        </>
      )}
    </section>
  );
}

function HandCard({ g, place }: { g: GameLevel; place: 'lead' | 'left' | 'right' | 'row' }) {
  const nav = useNavigate();
  const t = levelText(g.level, g.exercise.kind);
  // A side card sits half under the lead one, so its words keep to the half that shows.
  const spot =
    place === 'lead'
      ? 'absolute left-1/2 top-0 z-10 w-[164px] -translate-x-1/2 border-accent shadow-[0_18px_36px_rgba(0,0,0,0.75)]'
      : place === 'left'
        ? 'absolute left-0 top-7 w-[156px] -rotate-[7deg] border-accent/50 pr-14'
        : place === 'right'
          ? 'absolute right-0 top-7 w-[156px] rotate-[7deg] border-accent/50 pl-14 text-right'
          : 'min-w-0 flex-1 border-accent/60';
  return (
    <button
      type="button"
      onClick={() => nav(`/exercises/${g.exercise.id}`)}
      className={`block overflow-hidden rounded-[14px] border-[1.5px] bg-surface pb-3 text-left ${spot}`}
      data-testid="closest-level"
    >
      <ExerciseHero demo={g.exercise.demo} className={`h-28 ${place === 'left' ? '-mr-14' : place === 'right' ? '-ml-14' : ''}`}>
        <Medallion className={`absolute top-2 h-9 w-9 text-base ${place === 'right' ? 'right-2' : 'left-2'}`}>{g.level.level}</Medallion>
      </ExerciseHero>
      <div className="px-3 pt-2">
        <div className={`font-medium leading-tight ${place === 'lead' ? 'truncate text-lg' : 'line-clamp-2 min-h-[2.4em] text-[15px]'}`}>{g.exercise.name}</div>
        <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.1em] text-muted">{g.routine}</div>
        <div className={`num mt-2 font-medium text-accent ${place === 'lead' ? 'text-[15px]' : 'text-[13px]'}`}>{t.next}</div>
        <LevelBar level={g.level} className="mt-2" />
      </div>
    </button>
  );
}

/** Today's hand: up to three lifts nearest their next level, the nearest in front. */
export function TodaysHand({ game }: { game: Game }) {
  const hand = game.closest;
  if (hand.length === 0) return null;
  const count = `${hand.length} closest level-${hand.length === 1 ? 'up' : 'ups'}`;
  return (
    <section>
      <SectionTitle right={<span className="pb-px text-xs text-muted">{count}</span>}>Today&rsquo;s hand</SectionTitle>
      {hand.length === 3 ? (
        <div className="relative mx-auto h-[272px] max-w-[390px]">
          <HandCard g={hand[1]!} place="left" />
          <HandCard g={hand[2]!} place="right" />
          <HandCard g={hand[0]!} place="lead" />
        </div>
      ) : (
        <div className="flex gap-3">
          {hand.map((g) => (
            <HandCard key={g.exercise.id} g={g} place="row" />
          ))}
        </div>
      )}
    </section>
  );
}

/** The cabinet: each ladder's highest badge and the next one nearest to being reached. A tap opens every ladder. */
export function Cabinet({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  const badges = badgeCount(game.ladders);
  const nearest = nearestBadge(game.ladders);
  if (badges === 0 && !nearest) return null;
  if (!started(game)) return null;
  return (
    <section>
      <SectionTitle right={<span className="num pb-px text-xs text-muted">{badges} held</span>}>The cabinet</SectionTitle>
      <button type="button" className="no-scrollbar flex min-h-11 w-full gap-3 overflow-x-auto text-left" onClick={() => setOpen(true)} data-testid="badges-row">
        {game.ladders
          .filter((l) => l.chips.length > 0)
          .map((l) => (
            <span key={l.id} className="w-14 shrink-0 text-center">
              <Medallion className="mx-auto h-12 w-12 text-[13px]">{l.chips[l.chips.length - 1]}</Medallion>
              <span className="mt-1 line-clamp-2 block text-[11px] leading-tight text-muted">{l.title}</span>
            </span>
          ))}
        {nearest && (
          <span className="w-16 shrink-0 text-center">
            <Medallion next className="mx-auto h-12 w-12 text-[13px]">
              {nearest.chip}
            </Medallion>
            <span className="num mt-1 block text-[11px] leading-tight text-accent">{nearest.toGo}</span>
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Badges">
        <div className="divide-y divide-line" data-testid="badge-ladders">
          {game.ladders.map((ladder) => (
            <div key={ladder.id} className="py-3" data-testid="badge-ladder">
              <div className="font-semibold">{ladder.title}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ladder.chips.map((chip) => (
                  <span key={chip} className="num rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 text-sm font-bold text-accent">
                    {chip}
                  </span>
                ))}
                {ladder.next && <span className="num rounded-full border border-dashed border-line px-2.5 py-1 text-sm text-muted">{ladder.next.chip}</span>}
              </div>
              {ladder.next && (
                <div className="num mt-1.5 text-sm text-muted">
                  {ladder.next.name} · {ladder.next.toGo}
                </div>
              )}
            </div>
          ))}
        </div>
      </Sheet>
    </section>
  );
}
