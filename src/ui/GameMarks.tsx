import type { ReactNode } from 'react';

/**
 * The marks the game is drawn with (docs/DESIGN.md §6): a hexagon for a level, a row of blocks for
 * the way to the next one, a medallion for a badge or a lift's level. All take the accent, so they
 * follow the colour wheel.
 */

/** A level in its hexagon: an accent rim round the stage colour, or solid accent for a level-up. */
export function Hex({ size, solid, children, className = '' }: { size: 'lg' | 'md'; solid?: boolean; children: ReactNode; className?: string }) {
  const box = size === 'lg' ? 'h-[116px] w-[104px]' : 'h-[60px] w-[54px]';
  return (
    <div className={`hex flex shrink-0 items-center justify-center bg-accent ${box} ${className}`}>
      <div className={`hex flex flex-col items-center justify-center ${solid ? 'h-full w-full text-accent-fg' : 'h-[calc(100%-5px)] w-[calc(100%-5px)] bg-bg text-fg'}`}>{children}</div>
    </div>
  );
}

/**
 * Ten blocks, some lit: how far from one mark to the next. `percent` is what a screen reader hears.
 * `up` lights a block for any part of ten (a boss's health: never shown empty until it is 0).
 */
export function Segments({ percent, label, className = '', testId, up, fill = 'bg-accent' }: { percent: number; label: string; className?: string; testId?: string; up?: boolean; fill?: string }) {
  const lit = (up ? Math.ceil : Math.floor)(percent / 10);
  return (
    <div className={`flex gap-[3px] ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-testid={testId}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`h-full flex-1 ${i < lit ? fill : 'bg-line'}`} />
      ))}
    </div>
  );
}

/** A badge's mark or a lift's level in a ringed disc; `next` is one not yet held. */
export function Medallion({ children, next, className = '' }: { children: ReactNode; next?: boolean; className?: string }) {
  return (
    <span className={`num flex shrink-0 items-center justify-center rounded-full font-medium ${next ? 'border-[1.5px] border-dashed border-dim text-muted' : 'medallion'} ${className}`}>{children}</span>
  );
}

/** A moment the game marks (a level gained, a target hit): a solid hexagon, what happened, and what did it. */
export function HexPanel({ mark, title, detail, children, className = '', testId }: { mark: ReactNode; title: string; detail: string; children?: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`level-up border border-accent px-3.5 py-3 ${className}`} data-testid={testId}>
      <div className="flex items-center gap-3.5">
        <Hex size="md" solid>
          {mark}
        </Hex>
        <div className="min-w-0">
          <div className="text-2xl font-light leading-tight text-accent">{title}</div>
          <div className="num mt-0.5 break-words text-sm text-fg/85">{detail}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
