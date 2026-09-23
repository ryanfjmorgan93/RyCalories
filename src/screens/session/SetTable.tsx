import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNum, fmtSetsLine } from '@/domain/format';
import type { Exercise, SetLog } from '@/domain/types';
import type { LoggedRow, PendingRow, PlanRow, WarmupGhostRow } from '@/domain/setTable';
import { CheckIcon } from '@/ui/components/TopBar';
import type { Draft } from './types';

/** Grid columns shared by the header and every row, so values line up regardless of row kind. */
function columns(kind: Exercise['kind']): string {
  return kind === 'timed' ? '28px minmax(0,1fr) 5.25rem 2.875rem' : '28px minmax(0,1fr) 5.25rem 4.25rem 2.875rem';
}
const VALUE_SPAN = { gridColumn: '3 / -2' } as const;

/** "100 × 8" / "56 kg · 40 m" / "45 s" for a not-yet-logged ghost, from its raw fields. */
function ghostLabel(kind: Exercise['kind'], weight: number | null, reps: number | null, distanceM: number | null, seconds: number | null): string {
  if (kind === 'timed') return seconds !== null ? `${fmtNum(seconds)} s` : '—';
  if (kind === 'carry') {
    const parts: string[] = [];
    if (weight !== null) parts.push(`${fmtNum(weight)} kg`);
    if (distanceM !== null) parts.push(`${fmtNum(distanceM)} m`);
    return parts.length ? parts.join(' · ') : '—';
  }
  if (weight === null && reps === null) return '—';
  const w = kind === 'bodyweight_plus' ? (weight === null ? 'BW' : weight === 0 ? 'BW' : `+${fmtNum(weight)}`) : weight === null ? '—' : fmtNum(weight);
  return `${w} × ${reps ?? '—'}`;
}

export interface SetTableProps {
  rows: PlanRow[];
  kind: Exercise['kind'];
  exerciseName: string;
  draft: Draft;
  onDraftChange: (patch: Partial<Draft>) => void;
  onLogLive: () => void;
  blockedShake: number;
  busy: boolean;
  onLogWarmup: (row: WarmupGhostRow, index: number) => void;
  onCopyPrevious: (row: PendingRow) => void;
  onEditSet: (set: SetLog) => void;
  /** Positions (within `rows`'s logged order) that are a real personal record. */
  prIndices: Set<number>;
  plateLine?: { label: string; onOpen: () => void } | null;
}

export function SetTable({
  rows,
  kind,
  exerciseName,
  draft,
  onDraftChange,
  onLogLive,
  blockedShake,
  busy,
  onLogWarmup,
  onCopyPrevious,
  onEditSet,
  prIndices,
  plateLine,
}: SetTableProps) {
  const cols = columns(kind);
  let loggedI = 0;
  let warmupI = 0;

  return (
    <div className="flex flex-col gap-1" role="group" aria-label={`${exerciseName} sets`}>
      <div aria-hidden="true" className="grid items-center gap-1.5 px-1 pb-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-dim" style={{ gridTemplateColumns: cols }}>
        <span className="text-center">Set</span>
        <span>Previous</span>
        {kind === 'timed' ? (
          <span className="text-center">Seconds</span>
        ) : (
          <>
            <span className="text-center">kg</span>
            <span className="text-center">{kind === 'carry' ? 'm' : 'Reps'}</span>
          </>
        )}
        <span />
      </div>

      {rows.map((row) => {
        if (row.kind === 'logged') {
          const i = loggedI++;
          return <LoggedRowView key={row.set.id} row={row} isRecord={prIndices.has(i)} kind={kind} cols={cols} onClick={() => onEditSet(row.set)} />;
        }
        if (row.kind === 'warmup-ghost') {
          const i = warmupI++;
          return <WarmupRowView key={`wg-${i}`} row={row} index={i} cols={cols} onLog={() => onLogWarmup(row, i)} />;
        }
        if (row.status === 'next') {
          return (
            <LiveRowView
              key="live"
              row={row}
              kind={kind}
              cols={cols}
              draft={draft}
              onDraftChange={onDraftChange}
              onLog={onLogLive}
              onCopyPrevious={() => onCopyPrevious(row)}
              busy={busy}
              shake={blockedShake}
              plateLine={plateLine}
            />
          );
        }
        return <LaterRowView key={`later-${row.kind}-${row.position}`} row={row} kind={kind} cols={cols} />;
      })}
    </div>
  );
}

function RowBadge({ children, tone }: { children: ReactNode; tone: 'done' | 'record' | 'next' | 'dim' }) {
  const color = tone === 'record' ? 'text-record' : tone === 'done' ? 'text-ok' : tone === 'next' ? 'text-accent' : 'text-dim';
  return <span className={`num w-7 text-center text-base font-extrabold ${color}`}>{children}</span>;
}

function LoggedRowView({
  row,
  isRecord,
  kind,
  cols,
  onClick,
}: {
  row: LoggedRow;
  isRecord: boolean;
  kind: Exercise['kind'];
  cols: string;
  onClick: () => void;
}) {
  const tone = isRecord ? 'record' : 'done';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid min-h-[46px] items-center gap-1.5 rounded-xl px-1 text-left active:bg-surface-2 ${
        isRecord ? 'bg-record/10' : 'bg-ok/10'
      }`}
      style={{ gridTemplateColumns: cols }}
    >
      <RowBadge tone={tone}>{row.badge}</RowBadge>
      <span className="num truncate text-lg font-bold" style={VALUE_SPAN}>
        {fmtSetsLine([row.set], kind)}
      </span>
      <span className="flex items-center justify-end gap-1.5 pr-1">
        {isRecord && (
          <span data-testid="pr-chip" aria-label="Record" className="text-record">
            <RecordMedal />
          </span>
        )}
        <span className="text-ok">
          <CheckIcon size={20} />
        </span>
      </span>
    </button>
  );
}

function WarmupRowView({ row, index, cols, onLog }: { row: WarmupGhostRow; index: number; cols: string; onLog: () => void }) {
  return (
    <div className="grid min-h-[46px] items-center gap-1.5 px-1" style={{ gridTemplateColumns: cols }} data-testid={`warmup-row-${index}`}>
      <RowBadge tone="dim">W</RowBadge>
      <span className="num truncate text-base font-semibold text-muted" style={VALUE_SPAN}>
        {fmtNum(row.weight)} × {row.reps}
      </span>
      <button
        type="button"
        data-testid={`warmup-done-${index}`}
        aria-label={`Log warm-up ${index + 1}`}
        onClick={onLog}
        className="h-11 w-11 shrink-0 justify-self-end rounded-xl border border-line bg-surface-2 text-muted active:bg-line"
      >
        <CheckIcon size={20} />
      </button>
    </div>
  );
}

function LaterRowView({ row, kind, cols }: { row: PendingRow; kind: Exercise['kind']; cols: string }) {
  return (
    <div className="grid min-h-[46px] items-center gap-1.5 px-1 opacity-45" style={{ gridTemplateColumns: cols }}>
      <RowBadge tone="dim">{row.position + 1}</RowBadge>
      <span className="truncate px-1 text-base text-dim">{row.previousText || '—'}</span>
      <span className="num truncate text-center text-lg font-semibold text-dim" style={VALUE_SPAN}>
        {ghostLabel(kind, row.ghostWeight, row.ghostReps, row.ghostDistanceM, row.ghostSeconds)}
      </span>
      <span className="h-11 w-11 justify-self-end" />
    </div>
  );
}

function LiveRowView({
  row,
  kind,
  cols,
  draft,
  onDraftChange,
  onLog,
  onCopyPrevious,
  busy,
  shake,
  plateLine,
}: {
  row: PendingRow;
  kind: Exercise['kind'];
  cols: string;
  draft: Draft;
  onDraftChange: (patch: Partial<Draft>) => void;
  onLog: () => void;
  onCopyPrevious: () => void;
  busy: boolean;
  shake: number;
  plateLine?: { label: string; onOpen: () => void } | null;
}) {
  const n = row.position + 1;
  return (
    <div className="flex flex-col gap-1">
      <div
        key={shake}
        className={`grid items-center gap-1.5 rounded-xl px-1 py-0.5 ${shake > 0 ? 'row-shake' : ''}`}
        style={{ gridTemplateColumns: cols }}
        data-testid={`set-row-${n}`}
      >
        <span className="num flex h-11 w-7 items-center justify-center text-base font-extrabold text-accent">{n}</span>
        <button
          type="button"
          onClick={onCopyPrevious}
          disabled={!row.previous}
          className="num h-11 min-w-0 truncate rounded-lg px-1 text-left text-base text-muted disabled:opacity-40 active:bg-surface-2"
        >
          {row.previousText || '—'}
        </button>

        {kind !== 'timed' && (
          <LiveInput
            value={draft.weight}
            onChange={(v) => onDraftChange({ weight: v })}
            mode="decimal"
            placeholder={row.ghostWeight !== null ? fmtNum(row.ghostWeight) : kind === 'bodyweight_plus' ? '0' : 'kg'}
            testId="weight-input"
            ariaLabel={`Set ${n} weight, kilograms`}
          />
        )}

        {(kind === 'reps' || kind === 'bodyweight_plus') && (
          <LiveInput
            value={draft.reps}
            onChange={(v) => onDraftChange({ reps: v })}
            mode="numeric"
            placeholder={row.ghostReps !== null ? String(row.ghostReps) : 'reps'}
            testId="reps-input"
            ariaLabel={`Set ${n} reps`}
          />
        )}
        {kind === 'carry' && (
          <LiveInput
            value={draft.distanceM}
            onChange={(v) => onDraftChange({ distanceM: v })}
            mode="numeric"
            placeholder={row.ghostDistanceM !== null ? String(row.ghostDistanceM) : 'm'}
            testId="distance-input"
            ariaLabel={`Set ${n} distance, metres`}
          />
        )}
        {kind === 'timed' && (
          <LiveInput
            value={draft.seconds}
            onChange={(v) => onDraftChange({ seconds: v })}
            mode="numeric"
            placeholder={row.ghostSeconds !== null ? String(row.ghostSeconds) : 's'}
            testId="seconds-input"
            ariaLabel={`Set ${n} seconds`}
          />
        )}

        <button
          type="button"
          onClick={onLog}
          disabled={busy}
          data-testid="set-done"
          aria-label={`Log set ${n}`}
          className="h-11 w-11 shrink-0 justify-self-end rounded-xl bg-ok text-ok-fg active:brightness-90 disabled:opacity-40"
        >
          <CheckIcon size={22} />
        </button>
      </div>
      {plateLine && (
        <button
          type="button"
          data-testid="plate-line"
          onClick={plateLine.onOpen}
          className="ml-9 self-start truncate px-1 text-left text-xs font-semibold text-muted underline decoration-dotted"
        >
          {plateLine.label}
        </button>
      )}
    </div>
  );
}

/**
 * The live row's own weight/reps/distance/seconds field: a bare, big, centred `<input>` — no
 * +/- steppers. The set table's columns are too narrow for `NumberField`'s stepper buttons (a
 * plain 46px-tall field is the whole point at this density, per the mockup); steppers stay on
 * every OTHER numeric field in the app (routine editor, EditSetSheet, Settings), where a column
 * this tight never applies.
 */
function LiveInput({
  value,
  onChange,
  mode,
  placeholder,
  testId,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  mode: 'decimal' | 'numeric';
  placeholder: string;
  testId: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value === null ? '' : String(value));
  }, [value]);

  return (
    <input
      data-testid={testId}
      type="text"
      inputMode={mode}
      pattern={mode === 'numeric' ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'}
      enterKeyHint="done"
      aria-label={ariaLabel}
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
        onChange(mode === 'numeric' ? Math.round(n) : Math.round(n * 100) / 100);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="num h-[46px] w-full min-w-0 rounded-control border border-line bg-surface-2 px-1 text-center text-lg font-extrabold text-fg outline-none focus:border-accent placeholder:text-dim"
    />
  );
}

function RecordMedal() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="14.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8.6 9.6 6 3.5h4l2 4 2-4h4l-2.6 6.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
