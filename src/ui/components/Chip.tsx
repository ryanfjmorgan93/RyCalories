import type { ReactNode } from 'react';

export function Chip({
  active,
  onClick,
  children,
  tone = 'neutral',
  size = 'md',
  className = '',
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: active ? 'bg-fg text-bg border-fg' : 'bg-surface-2 text-muted border-line',
    accent: active ? 'bg-accent text-accent-fg border-accent' : 'bg-accent/10 text-accent border-accent/30',
    ok: active ? 'bg-ok text-ok-fg border-ok' : 'bg-ok/10 text-ok border-ok/30',
    warn: active ? 'bg-warn text-bg border-warn' : 'bg-warn/10 text-warn border-warn/30',
    danger: active ? 'bg-danger text-bg border-danger' : 'bg-danger/10 text-danger border-danger/30',
    info: active ? 'bg-info text-bg border-info' : 'bg-info/10 text-info border-info/30',
  };
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-10 px-4 text-sm';
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-bold ${s} ${tones[tone]} ${className}`}
    >
      {children}
    </Comp>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={`grid h-12 w-full rounded-xl border border-line bg-surface-2 p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg text-sm font-bold transition-colors ${o.value === value ? 'bg-fg text-bg' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 py-3 text-left min-h-14">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        {sub && <div className="text-sm text-muted">{sub}</div>}
      </div>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-transform ${checked ? 'translate-x-7' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}
