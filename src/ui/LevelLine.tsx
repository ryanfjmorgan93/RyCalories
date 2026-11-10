import { useLiveQuery } from 'dexie-react-hooks';
import { levelChange } from '@/db/recordsQueries';
import { levelText } from '@/domain/level';
import type { Exercise } from '@/domain/types';

/**
 * The exercise's Level (domain/level.ts) under its name in the session, with a bar to the next
 * one. It reads the session's own sets too, so it moves as a set that beats the best is logged.
 * Nothing for a carry, a hold or a lift with no counted set yet.
 */
export function LevelLine({ exercise, sessionId }: { exercise: Exercise; sessionId: string }) {
  const level = useLiveQuery(() => levelChange(exercise.id, sessionId).then((c) => c.to), [exercise.id, sessionId]);
  if (!level) return null;
  const t = levelText(level, exercise.kind);
  // The hair is for 0.2 × 100 coming out as 19.999…; a level's line is still never reached early (fill is under 1).
  const percent = Math.min(99, Math.floor(level.fill * 100 + 1e-6));
  return (
    <div className="num mt-1 text-sm text-fg/85" data-testid="level-line">
      <div>
        <span className="font-bold text-fg">{t.head}</span> · {t.detail}
      </div>
      {t.next && (
        <>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg/20"
            role="progressbar"
            aria-label={`To level ${level.level + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            data-testid="level-bar"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-0.5">{t.next}</div>
        </>
      )}
    </div>
  );
}
