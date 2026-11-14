import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  /** A primary's icon, set in its own dark well flush to the right (v5). */
  icon?: ReactNode;
  children: ReactNode;
}

// Primary is a solid cream pill; the quiet ones are clear with a cream hairline rim, so the accent
// stays for the game and whatever is live (docs/DESIGN.md §4).
const variants: Record<Variant, string> = {
  primary: 'bg-fg text-bg font-semibold border border-fg active:brightness-90',
  ok: 'bg-ok text-ok-fg font-semibold active:brightness-90',
  secondary: 'bg-transparent text-fg font-semibold border border-fg/25 active:bg-fg/10',
  outline: 'bg-transparent text-fg font-semibold border border-fg/25 active:bg-fg/10',
  ghost: 'bg-transparent text-muted font-semibold active:bg-surface-2',
  danger: 'bg-transparent text-danger font-semibold border border-danger/40 active:bg-danger/10',
};

// Every size is at least 44px tall — the tap-target floor this app holds itself to everywhere. Pills (look A).
const sizes: Record<Size, string> = {
  sm: 'h-11 px-4 text-sm rounded-full',
  md: 'h-12 px-5 text-base rounded-full',
  lg: 'h-14 px-6 text-lg rounded-full',
  xl: 'h-16 px-7 text-xl rounded-full',
};

export function Button({ variant = 'secondary', size = 'md', full, icon, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center gap-2 select-none whitespace-nowrap transition-[filter,background-color,transform] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${icon ? 'justify-between !pl-6 !pr-1.5' : 'justify-center'} ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
      {icon && (
        <span aria-hidden="true" className="flex aspect-square h-[calc(100%-0.5rem)] items-center justify-center rounded-full bg-bg text-fg">
          {icon}
        </span>
      )}
    </button>
  );
}

/** Small round icon button (44px min target). */
export function IconButton({ className = '', children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
