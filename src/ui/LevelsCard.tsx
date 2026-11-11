import { useState } from 'react';
import type { Game } from '@/db/gameQueries';
import { badgeCount, nearestBadge } from '@/domain/badges';
import { fmtNum } from '@/domain/format';
import { SectionTitle } from './components/Card';
import { Sheet } from './components/Sheet';
import { Hex, Medallion, Segments } from './GameMarks';

/**
 * Home's game, read off what was trained (db/gameQueries.ts): the total level in its hexagon with
 * the way to the next total-level badge, and the cabinet of badges, whose ladders open in a sheet.
 * (The strength figure between them is ui/StrengthBody.tsx.) Each shows nothing until there is
 * something true to show.
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
