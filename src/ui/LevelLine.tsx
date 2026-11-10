import { useLiveQuery } from 'dexie-react-hooks';
import { levelChange } from '@/db/recordsQueries';
import { levelText, type Level } from '@/domain/level';
import type { Exercise } from '@/domain/types';

/** The bar from a level's line to the next one's. Never full: the next level is a new bar. */
export function LevelBar({ level, className = '' }: { level: Level; className?: string }) {
  // The hair is for 0.2 × 100 coming out as 19.999…; a level's line is still never reached early (fill is under 1).
  const percent = Math.min(99, Math.floor(level.fill * 100 + 1e-6));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-fg/20 ${className}`}
      role="progressbar"
      aria-label={`To level ${level.level + 1}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-testid="level-bar"
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * The exercise's Level (domain/level.ts) under its name in the session, with a bar to the next
 * one and the set that reaches it at today's weight. It reads the session's own sets too, so it
 * moves as a set that beats the best is logged. Nothing for a carry, a hold or a lift with no
 * counted set yet.
 */
export function LevelLine({ exercise, sessionId, workingWeight }: { exercise: Exercise; sessionId: string; workingWeight: number | null }) {
  const level = useLiveQuery(
    () => levelChange(exercise.id, sessionId, undefined, workingWeight ?? undefined).then((c) => c.to),
    [exercise.id, sessionId, workingWeight],
  );
  if (!level) return null;
  const t = levelText(level, exercise.kind);
  return (
    <div className="num mt-1 text-sm text-fg/85" data-testid="level-line">
      <div>
        <span className="font-bold text-fg">{t.head}</span> · {t.detail}
      </div>
      {t.next && (
        <>
          <LevelBar level={level} className="mt-1" />
          <div className="mt-0.5">{t.next}</div>
        </>
      )}
    </div>
  );
}
