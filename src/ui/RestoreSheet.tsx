import { useState } from 'react';
import { importBackup, type Backup } from '@/db/backup';
import { fmtDateTime } from '@/domain/format';
import { Button } from '@/ui/components/Button';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';

const TABLE_LABELS: { key: keyof Backup['tables']; label: string }[] = [
  { key: 'exercises', label: 'Exercises' },
  { key: 'routines', label: 'Routines' },
  { key: 'routineExercises', label: 'Routine exercises' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'setLogs', label: 'Sets' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'bodyweight', label: 'Bodyweight readings' },
  { key: 'settings', label: 'Settings' },
];

/**
 * Restore a parsed JSON backup. Merge upserts by id; Replace wipes first (confirmed) and
 * reloads the page so every live query starts from the fresh database.
 */
export function RestoreSheet({ backup, open, onClose }: { backup: Backup | null; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);

  const run = async (mode: 'merge' | 'replace') => {
    if (!backup || busy) return;
    setBusy(true);
    try {
      const counts = await importBackup(backup, mode);
      toast(`Restored ${counts.sessions} sessions, ${counts.setLogs} sets, ${counts.exercises} exercises`, 'ok');
      onClose();
      if (mode === 'replace') window.location.reload();
    } catch {
      toast('Restore failed', 'danger');
    } finally {
      setBusy(false);
      setReplaceOpen(false);
    }
  };

  return (
    <>
      <Sheet
        open={open && backup !== null}
        onClose={onClose}
        title="Restore backup"
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="danger" disabled={busy} onClick={() => setReplaceOpen(true)}>
              Replace everything
            </Button>
            <Button size="lg" variant="primary" disabled={busy} onClick={() => void run('merge')}>
              Merge
            </Button>
          </div>
        }
      >
        {backup && (
          <>
            <div className="text-sm text-muted">Exported {fmtDateTime(backup.exportedAt)}</div>
            <div className="mt-3 overflow-hidden rounded-xl border border-line">
              {TABLE_LABELS.map(({ key, label }, i) => (
                <div key={key} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="num text-base font-extrabold">{(backup.tables[key] ?? []).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-sm text-muted">Merge keeps what is here and adds or updates rows by id. Replace wipes everything first.</div>
          </>
        )}
      </Sheet>

      <Confirm
        open={replaceOpen}
        title="Replace everything?"
        body="Every table is wiped and replaced with the backup. The app reloads afterwards."
        confirmLabel="Replace"
        danger
        onCancel={() => setReplaceOpen(false)}
        onConfirm={() => void run('replace')}
      />
    </>
  );
}
