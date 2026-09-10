import { useState } from 'react';
import { importBackup, tablesInBackup, type Backup } from '@/db/backup';
import type { TableName } from '@/db/db';
import { fmtDateTime } from '@/domain/format';
import { Button } from '@/ui/components/Button';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';

/**
 * A Record, not an array of pairs, and keyed off TABLE_NAMES: adding a table to the schema without
 * naming it here is now a compile error rather than a silent omission from this list.
 *
 * It was silent once. When the nutrition tables were added, this preview went on listing only the
 * eight original ones, so a Replace could clear and overwrite every meal while the sheet that
 * exists to say what Replace will do showed nothing about food at all.
 */
const TABLE_LABELS: Record<TableName, string> = {
  exercises: 'Exercises',
  routines: 'Routines',
  routineExercises: 'Routine exercises',
  sessions: 'Sessions',
  setLogs: 'Sets',
  decisions: 'Decisions',
  bodyweight: 'Bodyweight readings',
  settings: 'Settings',
  meals: 'Meals',
  mealItems: 'Foods in meals',
  foods: 'Remembered foods',
  productCache: 'Cached products',
  phases: 'Phases',
};

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
      const parts = [
        `${counts.sessions ?? 0} sessions`,
        `${counts.setLogs ?? 0} sets`,
        `${counts.exercises ?? 0} exercises`,
        ...(counts.meals !== undefined ? [`${counts.meals} meals`] : []),
      ];
      toast(`Restored ${parts.join(', ')}`, 'ok');
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
              {/* Only the tables this file actually carries. A version 1 backup holds no meals, and
                  listing "Meals 0" for it would read as "this will empty your food log" when in
                  fact restore leaves tables the file cannot repopulate alone. */}
              {tablesInBackup(backup).map((key, i) => (
                <div key={key} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <span className="text-sm font-semibold">{TABLE_LABELS[key]}</span>
                  <span className="num text-base font-extrabold">{(backup.tables[key] ?? []).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-sm text-muted">Merge adds or updates rows by id. Replace wipes the tables listed above first.</div>
          </>
        )}
      </Sheet>

      <Confirm
        open={replaceOpen}
        title="Replace everything?"
        body="The tables listed are wiped and replaced with the backup. The app reloads afterwards."
        confirmLabel="Replace"
        danger
        onCancel={() => setReplaceOpen(false)}
        onConfirm={() => void run('replace')}
      />
    </>
  );
}
