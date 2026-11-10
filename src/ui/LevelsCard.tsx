import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadGame } from '@/db/gameQueries';
import { badgeCount, nearestBadge } from '@/domain/badges';
import { levelText } from '@/domain/level';
import { Card, Divider, SectionTitle } from './components/Card';
import { Sheet } from './components/Sheet';
import { LevelBar } from './LevelLine';

/**
 * Home's Levels card: the total level, the lifts of the current routines nearest their next level
 * (with the set that reaches it), and the badges, whose ladders open in a sheet. All of it is read
 * off what was trained (db/gameQueries.ts). Nothing until a lift has its start or a badge is held.
 */
export function LevelsCard() {
  const nav = useNavigate();
  const game = useLiveQuery(() => loadGame(), []);
  const [open, setOpen] = useState(false);
  if (!game) return null;
  const badges = badgeCount(game.ladders);
  if (badges === 0 && !game.levels.some((l) => l.level.startIn === 0)) return null;
  const nearest = nearestBadge(game.ladders);
  return (
    <section data-testid="levels-card">
      <SectionTitle>Levels</SectionTitle>
      <Card className="px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="num text-3xl font-extrabold leading-tight" data-testid="total-level">
            {game.total}
          </span>
          <span className="label">Total level</span>
        </div>
        <div className="text-xs text-muted">Every level above 1, all your lifts added up</div>

        {game.closest.length > 0 && <div className="label mt-4">Closest</div>}
        {game.closest.map(({ exercise, level, routine }) => (
          <button key={exercise.id} type="button" className="block min-h-11 w-full py-2 text-left" onClick={() => nav(`/exercises/${exercise.id}`)} data-testid="closest-level">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-semibold">{exercise.name}</span>
              <span className="num shrink-0 text-sm text-muted">Level {level.level}</span>
            </div>
            <LevelBar level={level} className="mt-1.5" />
            <div className="num mt-1 text-sm text-fg/85">
              {levelText(level, exercise.kind).next} · {routine}
            </div>
          </button>
        ))}

        <Divider />
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 pt-2 text-left" onClick={() => setOpen(true)} data-testid="badges-row">
          <span className="shrink-0">
            <span className="font-semibold">Badges</span> <span className="num text-muted">{badges}</span>
          </span>
          {nearest && (
            <span className="num min-w-0 text-right text-sm text-muted">
              {nearest.name} · {nearest.toGo}
            </span>
          )}
        </button>
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title="Badges">
        <div className="divide-y divide-line" data-testid="badge-ladders">
          {game.ladders.map((ladder) => (
            <div key={ladder.id} className="py-3" data-testid="badge-ladder">
              <div className="font-semibold">{ladder.title}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ladder.chips.map((chip) => (
                  <span key={chip} className="num rounded-full border border-record/40 bg-record/10 px-2.5 py-1 text-sm font-bold text-record">
                    {chip}
                  </span>
                ))}
                {ladder.next && <span className="num rounded-full border border-line px-2.5 py-1 text-sm text-muted">{ladder.next.chip}</span>}
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
