/**
 * The moment an exercise's target is met: a check ring draws in, "Done", the done line, and (for
 * a normal weight exercise) the verdict — exactly the facts `liveVerdict` already decided, never a
 * fresh computation of its own. `role="status"` so a screen reader announces it once, unprompted.
 *
 * Purely presentational: the parent decides *when* to show this (once, on the log that crosses
 * the target — see `justCompleted` in `src/domain/setTable.ts`) and for how long.
 */
export function CompletionMoment({ doneLine, verdictLine, verdictTone }: { doneLine: string; verdictLine: string | null; verdictTone: 'ok' | 'accent' | 'muted' | null }) {
  return (
    <div role="status" data-testid="exercise-complete" className="flex flex-col items-center gap-2 px-4 pb-6 pt-1 text-center">
      <svg width="76" height="76" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="38" fill="none" stroke="color-mix(in srgb, var(--c-done) 16%, transparent)" strokeWidth="5" />
        <circle
          className="ring-draw"
          cx="44"
          cy="44"
          r="38"
          fill="none"
          stroke="var(--c-done)"
          strokeWidth="5"
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <path className="check-draw" d="M29 45 l10 10 l20 -22" fill="none" stroke="var(--c-done)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="cond text-3xl font-extrabold leading-none">Done</div>
      {doneLine && <div className="num text-base text-muted">{doneLine}</div>}
      {verdictLine && (
        <div
          data-testid="verdict-line"
          className={`rise-late text-base font-bold ${verdictTone === 'ok' ? 'text-ok' : verdictTone === 'accent' ? 'text-accent' : 'text-muted'}`}
        >
          {verdictLine}
        </div>
      )}
    </div>
  );
}
