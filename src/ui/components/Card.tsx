import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...rest} className={`rounded-2xl bg-surface border border-line ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-between px-1 pb-2 pt-5 ${className}`}>
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

/** Tappable list row with big target. */
export function Row({
  onClick,
  left,
  title,
  subtitle,
  right,
  className = '',
  dim,
}: {
  onClick?: () => void;
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
  dim?: boolean;
}) {
  const body = (
    <>
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold leading-tight">{title}</div>
        {subtitle !== undefined && subtitle !== null && subtitle !== '' && (
          <div className="mt-0.5 truncate text-sm text-muted">{subtitle}</div>
        )}
      </div>
    </>
  );
  // The main area is its own <button> so `right` can hold another button without nesting.
  return (
    <div className={`flex w-full items-center gap-3 pr-4 min-h-14 ${dim ? 'opacity-60' : ''} ${className}`}>
      {onClick ? (
        <button type="button" onClick={onClick} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:bg-surface-2">
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4">{body}</div>
      )}
      {right}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-line" />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'accent' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-fg';
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`num text-2xl font-extrabold leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
