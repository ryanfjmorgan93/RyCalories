import { useEffect, useMemo, useState } from 'react';
import { loadClaudeSummaryInput } from '@/db/claudeSummaryQueries';
import { buildClaudeSummary, type ClaudeSummaryInclude, type ClaudeSummaryInput } from '@/domain/claudeSummary';
import { fmtNum } from '@/domain/format';
import { canShareText, copyText, shareText } from './clipboard';
import { Button } from './components/Button';
import { Toggle } from './components/Chip';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';
import { useSettings, useToday } from './hooks';

const EVERYTHING: ClaudeSummaryInclude = { training: true, food: true, bodyweight: true, routines: true };

function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

/**
 * Copy for Claude: a plain-text summary of the owner's own data for the Claude app they already
 * use. Built on the phone; it goes nowhere until the owner copies or shares it themselves.
 */
export function ClaudeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const today = useToday();
  const [include, setInclude] = useState<ClaudeSummaryInclude>({ training: true, food: true, bodyweight: true, routines: false });
  const [input, setInput] = useState<ClaudeSummaryInput | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;
    let alive = true;
    setInput(null);
    void loadClaudeSummaryInput(today, EVERYTHING, settings).then((loaded) => {
      if (alive) setInput(loaded);
    });
    return () => {
      alive = false;
    };
  }, [open, settings, today]);

  const summary = useMemo(() => (input ? buildClaudeSummary({ ...input, include }) : null), [input, include]);
  const nothingChosen = !include.training && !include.food && !include.bodyweight && !include.routines;
  const shareable = canShareText();

  const copy = async () => {
    if (!summary) return;
    const ok = await copyText(summary.text);
    toast(ok ? 'Copied' : 'Could not copy.', ok ? 'ok' : 'danger');
  };
  const share = async () => {
    if (!summary) return;
    await shareText(summary.text, 'Iron summary');
  };

  const set = (key: keyof ClaudeSummaryInclude) => (v: boolean) => setInclude((prev) => ({ ...prev, [key]: v }));
  const c = summary?.counts;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Copy for Claude"
      footer={
        <div className={`grid gap-3 ${shareable ? 'grid-cols-2' : ''}`}>
          {shareable && (
            <Button size="lg" variant="secondary" disabled={!summary || nothingChosen} onClick={() => void share()} data-testid="claude-share">
              Share
            </Button>
          )}
          <Button size="lg" variant="primary" disabled={!summary || nothingChosen} onClick={() => void copy()} data-testid="claude-copy">
            Copy
          </Button>
        </div>
      }
    >
      {!summary && <div className="py-6 text-center text-sm text-muted">Loading…</div>}
      {summary && c && (
        <>
          <div data-testid="claude-include-training">
            <Toggle checked={include.training} onChange={set('training')} label="Training" sub={`Last 8 weeks · ${plural(c.sessions, 'session', 'sessions')}`} />
          </div>
          <div data-testid="claude-include-food">
            <Toggle
              checked={include.food}
              onChange={set('food')}
              label="Food"
              sub={`Last 4 weeks · ${fmtNum(c.foodDaysLogged)} of ${fmtNum(c.foodDays)} days logged`}
            />
          </div>
          <div data-testid="claude-include-bodyweight">
            <Toggle checked={include.bodyweight} onChange={set('bodyweight')} label="Bodyweight" sub={`Last 8 weeks · ${plural(c.weighIns, 'weigh-in', 'weigh-ins')}`} />
          </div>
          <div data-testid="claude-include-routines">
            <Toggle checked={include.routines} onChange={set('routines')} label="Routines" sub={plural(c.routines, 'routine', 'routines')} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-muted" data-testid="claude-words">
              {nothingChosen ? 'Nothing chosen' : `About ${plural(summary.words, 'word', 'words')}`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setShowText((v) => !v)} data-testid="claude-show-text">
              {showText ? 'Hide text' : 'Show text'}
            </Button>
          </div>
          {showText && !nothingChosen && (
            <pre className="mt-2 max-h-[40dvh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 font-sans text-[13px] leading-relaxed text-muted" data-testid="claude-text">
              {summary.text}
            </pre>
          )}
        </>
      )}
    </Sheet>
  );
}
