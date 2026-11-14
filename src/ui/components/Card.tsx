import type { HTMLAttributes, ReactNode } from 'react';

/**
 * A block of content. By default it is open: no box, straight on the stage (`.plate` in
 * src/index.css), headed by a SectionTitle and parted from a neighbour by a hairline.
 * `framed` is for an object you pick up or act on (the lift in play, a notice, something the coach
 * drafted): a soft dark plate with a lit top edge and no outline, as Third Space draws its cards.
 */
export function Card({ className = '', framed = false, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; framed?: boolean }) {
  return (
    <div {...rest} className={`${framed ? 'rounded-card bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'plate'} ${className}`}>
      {children}
    </div>
  );
}

/** A section's head: its name in small open capitals (`.cap`), and what sits at the far end of the line. */
export function SectionTitle({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-6 items-center justify-between gap-3 pb-3 pt-8 ${className}`}>
      <h2 className="cap shrink-0">{children}</h2>
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
  testId,
}: {
  onClick?: () => void;
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
  dim?: boolean;
  /** Put on the row's button (or on the row itself when it has no onClick). */
  testId?: string;
}) {
  const body = (
    <>
      {left}
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold leading-tight">{title}</div>
        {subtitle !== undefined && subtitle !== null && subtitle !== '' && (
          <div className="mt-0.5 break-words text-sm text-muted">{subtitle}</div>
        )}
      </div>
    </>
  );
  // The main area is its own <button> so `right` can hold another button without nesting.
  return (
    <div className={`flex w-full items-center gap-3 pr-4 min-h-14 ${dim ? 'opacity-60' : ''} ${className}`}>
      {onClick ? (
        <button type="button" onClick={onClick} data-testid={testId} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left active:bg-surface-2">
          {body}
        </button>
      ) : (
        <div data-testid={testId} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-4">{body}</div>
      )}
      {right}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-line" />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-5 text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'accent' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-fg';
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`fig mt-1 text-[1.75rem] ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
