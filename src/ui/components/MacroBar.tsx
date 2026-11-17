import { fmtGrams, fmtKcal, fmtNum } from '@/domain/format';
import type { Macros } from '@/domain/food';

/**
 * Progress against a target. Over the target is shown, not hidden — the bar caps at full
 * width and the number keeps counting, because a wrong number that looks tidy is worse than
 * a right one that looks bad.
 */
export function TargetBar({
  label,
  value,
  target,
  unit,
  tone = 'accent',
  testId,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: 'kcal' | 'g';
  tone?: 'accent' | 'ok';
  testId?: string;
}) {
  const pct = target && target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target !== null && value > target;
  const fmt = unit === 'kcal' ? fmtKcal : fmtGrams;
  const bar = tone === 'ok' ? 'bg-ok' : 'bg-accent';
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted">{label}</span>
        <span className="num text-[13px]">
          {fmt(value)}
          {target !== null && <span className="text-muted"> / {fmt(target)}</span>}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/[0.07]">
        <div className={`h-full rounded-full ${over ? 'bg-warn' : bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The three macros as a single compact line: "P 128 · C 210 · F 62". */
export function MacroLine({ m, className = '' }: { m: Macros; className?: string }) {
  return (
    <span className={`num tabular-nums ${className}`}>
      P {fmtNum(Math.round(m.protein))} · C {fmtNum(Math.round(m.carbs))} · F {fmtNum(Math.round(m.fat))}
    </span>
  );
}
