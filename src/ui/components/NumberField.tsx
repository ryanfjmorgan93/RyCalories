import { useEffect, useRef, useState } from 'react';

export interface NumberFieldProps {
  value: number | null;
  onChange: (v: number | null) => void;
  /** Step for the − / + buttons. */
  step: number;
  min?: number;
  max?: number;
  /** Shown as placeholder when the value is null. */
  placeholder?: string;
  label?: string;
  unit?: string;
  /** Value the − / + buttons step from when the field is empty (defaults to `min`). */
  fallback?: number;
  /** decimal (weights) or numeric (reps). */
  mode?: 'decimal' | 'numeric';
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  /** Extra id for tests. */
  testId?: string;
}

/**
 * Number input flanked by big −/+ buttons. The text field opens the numeric keyboard;
 * the buttons step by `step` and clamp to [min, max]. Empty text → null.
 */
export function NumberField({
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  placeholder,
  label,
  unit,
  fallback,
  mode = 'decimal',
  size = 'lg',
  disabled,
  className = '',
  testId,
}: NumberFieldProps) {
  const [text, setText] = useState(value === null ? '' : fieldText(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value === null ? '' : fieldText(value));
  }, [value]);

  const commit = (raw: string) => {
    const t = raw.replace(',', '.').trim();
    if (t === '' || t === '-' || t === '.') {
      onChange(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) return;
    onChange(clamp(mode === 'numeric' ? Math.round(n) : Math.round(n * 100) / 100, min, max));
  };

  const bump = (dir: 1 | -1) => {
    // Empty field: step from the explicit fallback (e.g. repMin) or the minimum — never from the placeholder text.
    const base = value ?? fallback ?? min;
    const next = clamp(Math.round((value === null ? base : base + dir * step) * 100) / 100, min, max);
    onChange(next);
    setText(fieldText(next));
  };

  const h = size === 'lg' ? 'h-14' : 'h-12';
  const txt = size === 'lg' ? 'text-2xl' : 'text-xl';
  return (
    <div className={`min-w-0 ${className}`}>
      {label && <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>}
      <div className={`flex ${h} items-stretch overflow-hidden rounded-xl border border-line bg-surface-2 ${disabled ? 'opacity-50' : ''}`}>
        <button
          type="button"
          aria-label={`${label ?? 'value'} minus ${step}`}
          disabled={disabled}
          onClick={() => bump(-1)}
          className="w-12 shrink-0 text-2xl font-bold text-muted active:bg-line"
        >
          −
        </button>
        <div className="relative flex min-w-0 flex-1 items-center">
          <input
            data-testid={testId}
            type="text"
            inputMode={mode}
            pattern={mode === 'numeric' ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'}
            enterKeyHint="done"
            disabled={disabled}
            value={text}
            placeholder={placeholder}
            onFocus={(e) => {
              focused.current = true;
              e.currentTarget.select();
            }}
            onBlur={() => {
              focused.current = false;
              commit(text);
              const t = text.replace(',', '.').trim();
              const n = Number(t);
              setText(t === '' || !Number.isFinite(n) ? '' : fieldText(clamp(mode === 'numeric' ? Math.round(n) : Math.round(n * 100) / 100, min, max)));
            }}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className={`num w-full min-w-0 bg-transparent text-center font-extrabold outline-none placeholder:text-dim ${txt} ${unit ? 'pr-7' : ''}`}
          />
          {unit && <span className="pointer-events-none absolute right-2 text-xs font-bold text-muted">{unit}</span>}
        </div>
        <button
          type="button"
          aria-label={`${label ?? 'value'} plus ${step}`}
          disabled={disabled}
          onClick={() => bump(1)}
          className="w-12 shrink-0 text-2xl font-bold text-muted active:bg-line"
        >
          +
        </button>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Plain digits for the input box (no thousands grouping, so re-parsing never breaks). */
function fieldText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Plain numeric text input for forms (no stepper). */
export function NumberInput({
  value,
  onChange,
  mode = 'decimal',
  placeholder,
  className = '',
  min,
  max,
  disabled,
  testId,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  mode?: 'decimal' | 'numeric';
  placeholder?: string;
  className?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === null || value === undefined ? '' : String(value));
  }, [value]);
  return (
    <input
      data-testid={testId}
      type="text"
      inputMode={mode}
      disabled={disabled}
      enterKeyHint="done"
      value={text}
      placeholder={placeholder}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const t = raw.replace(',', '.').trim();
        if (t === '') {
          onChange(null);
          return;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        let v = mode === 'numeric' ? Math.round(n) : Math.round(n * 100) / 100;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={`num h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-lg font-bold outline-none focus:border-accent placeholder:text-dim ${className}`}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
  multiline,
  testId,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  testId?: string;
  autoFocus?: boolean;
}) {
  const cls = `w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent placeholder:text-dim ${className}`;
  if (multiline) {
    return (
      <textarea data-testid={testId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={3} className={`${cls} py-3`} autoFocus={autoFocus} />
    );
  }
  return (
    <input data-testid={testId} type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} h-12`} autoFocus={autoFocus} enterKeyHint="done" />
  );
}
