import { FEEL_OPTIONS } from '@/domain/sets';
import { fmtWeight } from '@/domain/format';
import type { Exercise } from '@/domain/types';
import { Button, IconButton } from '@/ui/components/Button';
import { MoreIcon } from '@/ui/components/TopBar';
import { ChevronIcon } from './icons';

/**
 * A finished slot's collapsed row: a check badge, the done line, and — underneath, only while the
 * card itself stays collapsed — the facts the completion moment already showed once: the verdict,
 * the calibrating lock-in (pending or not), and the feel chips. Tapping the header reopens the
 * card into its editable set table (§ ExerciseCard), which is where an extra set gets logged.
 */
export function DoneCard({
  exerciseName,
  doneLine,
  verdictLine,
  verdictTone,
  kind,
  showFeel,
  selectedFeel,
  onPickFeel,
  showLockIn,
  lockInWeight,
  lockInPending,
  onLockIn,
  onUndoLockIn,
  lockingBusy,
  reopened,
  onToggle,
  onMenu,
  isCurrent,
  dimmed,
  testId,
}: {
  exerciseName: string;
  doneLine: string;
  verdictLine: string | null;
  verdictTone: 'ok' | 'accent' | 'muted' | null;
  kind: Exercise['kind'];
  showFeel: boolean;
  selectedFeel: number | null;
  onPickFeel: (rir: number) => void;
  showLockIn: boolean;
  lockInWeight: number | null;
  lockInPending: number | undefined;
  onLockIn: () => void;
  onUndoLockIn: () => void;
  lockingBusy: boolean;
  reopened: boolean;
  onToggle: () => void;
  onMenu: () => void;
  isCurrent: boolean;
  dimmed: boolean;
  testId: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-card border ${isCurrent ? 'border-accent' : 'border-glass-border'} ${dimmed ? 'opacity-60' : ''} glass-card bg-glass-2`}
      data-testid={testId}
      data-current={isCurrent ? 'true' : undefined}
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={reopened}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ok bg-ok/15 text-ok">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold leading-tight">{exerciseName}</h2>
            <div className="num mt-0.5 truncate text-sm text-muted">{doneLine}</div>
          </div>
          <span className="shrink-0 text-dim">
            <ChevronIcon expanded={reopened} />
          </span>
        </button>
        <IconButton label="More" onClick={onMenu}>
          <MoreIcon />
        </IconButton>
      </div>

      {!reopened && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {verdictLine && (
            <div
              data-testid="verdict-line"
              className={`text-sm font-bold ${verdictTone === 'ok' ? 'text-ok' : verdictTone === 'accent' ? 'text-accent' : 'text-muted'}`}
            >
              {verdictLine}
            </div>
          )}

          {showLockIn &&
            (lockInPending !== undefined ? (
              <div className="flex items-center gap-3">
                <span data-testid="session-lock-in-pending" className="text-sm font-bold text-ok">
                  {fmtWeight(kind, lockInPending)} locked in
                </span>
                <Button size="sm" variant="ghost" onClick={onUndoLockIn}>
                  Undo
                </Button>
              </div>
            ) : (
              lockInWeight !== null && (
                <Button size="md" variant="primary" disabled={lockingBusy} onClick={onLockIn} data-testid="session-lock-in" className="self-start">
                  Lock in {fmtWeight(kind, lockInWeight)}
                </Button>
              )
            ))}

          {showFeel && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">How did that feel?</span>
              <div className="grid grid-cols-4 gap-1.5">
                {FEEL_OPTIONS.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    data-testid={`feel-${f.label}`}
                    aria-pressed={selectedFeel === f.rir}
                    onClick={() => onPickFeel(f.rir)}
                    className={`h-11 rounded-control border text-sm font-bold ${
                      selectedFeel === f.rir ? 'border-fg bg-fg text-bg' : 'border-line bg-surface-2 text-muted'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
