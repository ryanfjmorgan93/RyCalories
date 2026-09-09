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
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
        <span className="num text-sm font-bold tabular-nums">
          {fmt(value)}
          {target !== null && <span className="text-muted"> / {fmt(target)}</span>}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
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

/** Macro split as three proportional segments. Empty renders as a flat track. */
export function MacroSplit({ m }: { m: Macros }) {
  const p = m.protein * 4;
  const c = m.carbs * 4;
  const f = m.fat * 9;
  const total = p + c + f;
  if (total <= 0) return <div className="h-1.5 rounded-full bg-surface-2" />;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className="bg-ok" style={{ width: w(p) }} title="Protein" />
      <div className="bg-accent" style={{ width: w(c) }} title="Carbohydrate" />
      <div className="bg-warn" style={{ width: w(f) }} title="Fat" />
    </div>
  );
}
