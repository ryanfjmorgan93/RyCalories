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
  compact,
  testId,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: 'kcal' | 'g';
  tone?: 'accent' | 'ok';
  /** Under a figure that already names it: the label is kept for a screen reader only. */
  compact?: boolean;
  testId?: string;
}) {
  const pct = target && target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target !== null && value > target;
  const fmt = unit === 'kcal' ? fmtKcal : fmtGrams;
  const bar = tone === 'ok' ? 'bg-ok' : 'bg-accent';
  return (
    <div data-testid={testId}>
      <div className="h-0.5 bg-line">
        <div className={`h-full ${over ? 'bg-warn' : bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className={compact ? 'sr-only' : 'label'}>{label}</span>
        <span className="num text-xs tabular-nums">
          {fmt(value)}
          {target !== null && <span className="text-muted"> / {fmt(target)}</span>}
        </span>
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

/** Macro split as three proportional segments. Empty renders as a flat track. */
export function MacroSplit({ m }: { m: Macros }) {
  const p = m.protein * 4;
  const c = m.carbs * 4;
  const f = m.fat * 9;
  const total = p + c + f;
  if (total <= 0) return <div className="h-0.5 bg-line" />;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-0.5 gap-0.5">
      <div className="bg-ok" style={{ width: w(p) }} title="Protein" />
      <div className="bg-accent" style={{ width: w(c) }} title="Carbohydrate" />
      <div className="bg-warn" style={{ width: w(f) }} title="Fat" />
    </div>
  );
}
