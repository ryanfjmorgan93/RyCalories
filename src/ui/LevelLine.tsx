import { useLiveQuery } from 'dexie-react-hooks';
import { levelChange } from '@/db/recordsQueries';
import { levelSetText, levelText, levelUp, type Level } from '@/domain/level';
import type { Exercise } from '@/domain/types';
import { Hex, Segments } from './GameMarks';

/** The bar from a level's line to the next one's. Never full: the next level is a new bar. */
export function LevelBar({ level, className = '' }: { level: Level; className?: string }) {
  // The hair is for 0.2 × 100 coming out as 19.999…; a level's line is still never reached early (fill is under 1).
  const percent = Math.min(99, Math.floor(level.fill * 100 + 1e-6));
  return <Segments percent={percent} label={`To level ${level.level + 1}`} className={`h-2 ${className}`} testId="level-bar" />;
}

/** The moment a lift goes up a level: its new level in a solid hexagon, and what did it. */
export function LevelUpPanel({ level, detail, className = '', testId }: { level: number; detail: string; className?: string; testId?: string }) {
  return (
    <div className={`flex items-center gap-3.5 level-up border border-accent px-3.5 py-3 ${className}`} data-testid={testId}>
      <Hex size="md" solid>
        <span className="text-[9px] font-semibold tracking-[0.1em]">LV</span>
        <span className="num text-2xl font-medium leading-none">{level}</span>
      </Hex>
      <div className="min-w-0">
        <div className="text-2xl font-light leading-tight text-accent">Level up</div>
        <div className="num mt-0.5 break-words text-sm text-fg/85">{detail}</div>
      </div>
    </div>
  );
}

/**
 * The exercise's Level (domain/level.ts) under its name in the session, with the blocks to the next
 * one and the set that reaches it at today's weight. It reads the session's own sets too, so it
 * moves as a set that beats the best is logged, and the Level up panel stands for the rest of the
 * session that earned it. Nothing for a carry, a hold or a lift with no counted set yet.
 */
export function LevelLine({ exercise, sessionId, workingWeight }: { exercise: Exercise; sessionId: string; workingWeight: number | null }) {
  const change = useLiveQuery(() => levelChange(exercise.id, sessionId, undefined, workingWeight ?? undefined), [exercise.id, sessionId, workingWeight]);
  const level = change?.to;
  if (!level) return null;
  const t = levelText(level, exercise.kind);
  const up = levelUp(change.from, level);
  return (
    <>
      {up && <LevelUpPanel level={up.to} detail={`Level ${up.from} → ${up.to} · ${levelSetText(level.best, exercise.kind)}`} className="mt-2" testId="level-up-panel" />}
      <div className="num mt-1.5 text-sm text-fg/85" data-testid="level-line">
        <div>
          <span className="font-bold text-fg">{t.head}</span> · {t.detail}
        </div>
        {t.next && (
          <>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
              <span>LV {level.level}</span>
              <LevelBar level={level} className="flex-1" />
              <span className="text-muted">LV {level.level + 1}</span>
            </div>
            <div className="mt-1 font-medium text-accent">{t.next}</div>
          </>
        )}
      </div>
    </>
  );
}
