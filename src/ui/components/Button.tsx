import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'fill-highlight bg-accent text-accent-fg font-bold active:brightness-90',
  ok: 'fill-highlight bg-ok text-ok-fg font-bold active:brightness-90',
  secondary: 'bg-surface-2 text-fg font-semibold active:brightness-110 border border-line',
  outline: 'bg-transparent text-fg font-semibold border border-line active:bg-surface-2',
  ghost: 'bg-transparent text-muted font-semibold active:bg-surface-2',
  danger: 'bg-transparent text-danger font-semibold border border-danger/40 active:bg-danger/10',
};

// Every size is at least 44px tall — the tap-target floor this app holds itself to everywhere.
const sizes: Record<Size, string> = {
  sm: 'h-11 px-3 text-sm rounded-control',
  md: 'h-12 px-4 text-base rounded-control',
  lg: 'h-14 px-5 text-lg rounded-control',
  xl: 'h-16 px-6 text-xl rounded-control',
};

export function Button({ variant = 'secondary', size = 'md', full, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 select-none whitespace-nowrap transition-[filter] disabled:opacity-40 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
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
