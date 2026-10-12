import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { testConnection, toClaudeError } from '@/ai/client';
import { clearApiKey, maskKey, setApiKey } from '@/ai/key';
import { setCap } from '@/ai/spend';
import { db } from '@/db/db';
import { fmtDate } from '@/domain/format';
import type { CoachNote } from '@/domain/types';
import { useClaudeSpend } from '@/state/claudeCoach';
import { Button, IconButton } from './components/Button';
import { Card, Divider, EmptyState, Row } from './components/Card';
import { Chip } from './components/Chip';
import { NumberField } from './components/NumberField';
import { Confirm } from './components/Sheet';
import { toast } from './components/Toast';
import { TrashIcon } from './components/TopBar';

/** "$1.23", and "under 1p" for a fraction of a penny so a real cost never reads as nothing. */
function usd(n: number): string {
  if (n > 0 && n < 0.01) return 'under 1p';
  return `$${n.toFixed(2)}`;
}

/**
 * Settings › Claude: the API key (kept on this phone only, never in a backup), a test, what has
 * been spent this month against the limit, the limit itself, and the notes the coach has kept
 * about the owner, each of which can be deleted.
 */
export function ClaudeSettingsCard() {
  const spend = useClaudeSpend();
  const notes = useLiveQuery(() => db.coachNotes.orderBy('createdAt').reverse().toArray(), []);
  const [masked, setMasked] = useState<string | null>(() => maskKey());
  const [keyText, setKeyText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; line: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [capDraft, setCapDraft] = useState<number | null>(spend.cap);
  const [noteToDelete, setNoteToDelete] = useState<CoachNote | null>(null);

  const saveKey = () => {
    if (!setApiKey(keyText)) {
      toast('Could not save the key.', 'danger');
      return;
    }
    setKeyText('');
    setMasked(maskKey());
    setTestResult(null);
    toast('Key saved', 'ok');
  };

  const removeKey = () => {
    clearApiKey();
    setMasked(null);
    setTestResult(null);
    setConfirmRemove(false);
    toast('Key removed');
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testConnection();
      setTestResult({ ok: true, line: 'Claude answered. The key works.' });
    } catch (e) {
      setTestResult({ ok: false, line: toClaudeError(e).message });
    } finally {
      setTesting(false);
    }
  };

  const percent = Math.min(100, Math.round(spend.fraction * 100));
  const tone = spend.over ? 'bg-danger' : spend.near ? 'bg-warn' : 'bg-accent';
  const status = !masked ? { tone: 'neutral' as const, label: 'OFF' } : spend.over ? { tone: 'danger' as const, label: 'PAUSED' } : { tone: 'ok' as const, label: 'ON' };
  const capChanged = capDraft !== null && capDraft !== spend.cap;

  return (
    <Card data-testid="claude-card">
      <Row title="Claude" subtitle={masked ? `Key ${masked}` : 'No key yet'} right={<Chip tone={status.tone}>{status.label}</Chip>} />

      <div className="space-y-3 px-4 pb-4">
        <input
          type="password"
          value={keyText}
          onChange={(e) => setKeyText(e.target.value)}
          placeholder={masked ? 'Paste a new key to replace it' : 'Paste your Claude API key'}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          name="claude-key"
          aria-label="Claude API key"
          enterKeyHint="done"
          data-testid="claude-key-input"
          className="h-12 w-full rounded-control border border-line bg-surface-2 px-3 text-base outline-none placeholder:text-dim focus:border-accent"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!keyText.trim()} onClick={saveKey} data-testid="claude-key-save">
            Save
          </Button>
          <Button size="sm" variant="outline" disabled={!masked || testing} onClick={() => void runTest()} data-testid="claude-key-test">
            {testing ? 'Testing…' : 'Test'}
          </Button>
          {masked && (
            <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)} data-testid="claude-key-remove">
              Remove
            </Button>
          )}
        </div>
        {testResult && (
          <div className={`text-sm ${testResult.ok ? 'text-ok' : 'text-danger'}`} role="status" data-testid="claude-test-result">
            {testResult.line}
          </div>
        )}
        <div className="text-xs text-muted">The key stays on this phone. It is never in a backup or an export.</div>
      </div>

      <Divider />
      <div className="space-y-3 px-4 py-4" data-testid="claude-spend">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">This month</div>
            <div className="num text-2xl font-extrabold leading-tight" data-testid="claude-spend-amount">
              {usd(spend.usd)}
            </div>
          </div>
          <div className="num pb-0.5 text-sm text-muted">of {usd(spend.cap)}</div>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Spent this month"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          data-testid="claude-spend-bar"
        >
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
        </div>
        {spend.over && <div className="text-sm text-danger">Paused until the 1st. Tracking still works.</div>}
        {!spend.over && spend.near && <div className="text-sm text-warn">{percent} % of the limit used.</div>}

        <NumberField label="Monthly limit" unit="$" value={capDraft} onChange={setCapDraft} step={1} min={0} max={500} size="md" testId="claude-cap" />
        <Button size="sm" variant="secondary" disabled={!capChanged} onClick={() => capDraft !== null && setCap(capDraft)} data-testid="claude-cap-save">
          Set limit
        </Button>
        <div className="text-xs text-muted">Counted in the app from what Claude reports. Set the same limit on the workspace in the Claude Console too.</div>
      </div>

      <Divider />
      <div className="py-1" data-testid="claude-notes">
        <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Coach notes</div>
        {notes !== undefined && notes.length === 0 && (
          <div className="px-4 pb-3">
            <EmptyState>Nothing remembered yet.</EmptyState>
          </div>
        )}
        {(notes ?? []).map((note) => (
          <div key={note.id} className="flex items-start gap-2 pl-4 pr-2" data-testid="claude-note">
            <div className="min-w-0 flex-1 py-3">
              <div className="text-sm">{note.text}</div>
              <div className="text-xs text-dim">{fmtDate(note.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <IconButton label="Delete note" onClick={() => setNoteToDelete(note)} className="mt-1">
              <TrashIcon />
            </IconButton>
          </div>
        ))}
      </div>

      <Confirm
        open={confirmRemove}
        title="Remove the key?"
        body="Claude stops until you paste a key again. Your data is untouched."
        confirmLabel="Remove"
        danger
        onConfirm={removeKey}
        onCancel={() => setConfirmRemove(false)}
      />
      <Confirm
        open={noteToDelete !== null}
        title="Delete this note?"
        body={noteToDelete?.text}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (noteToDelete) void db.coachNotes.delete(noteToDelete.id);
          setNoteToDelete(null);
        }}
        onCancel={() => setNoteToDelete(null)}
      />
    </Card>
  );
}
