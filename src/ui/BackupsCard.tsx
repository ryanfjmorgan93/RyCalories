import { useEffect, useState } from 'react';
import { backupNow, getBackupStatus, isStoragePersisted, listBackups, type BackupStatus } from '@/db/autoBackup';
import { restoreHistoryNotice } from '@/db/historySafety';
import { KEEP_AUTO, KEEP_SPECIAL, type BackupFileInfo } from '@/domain/backupPolicy';
import { fmtDateTime } from '@/domain/format';
import { isNative } from '@/state/native';
import { Button } from '@/ui/components/Button';
import { Card, Divider, Row } from '@/ui/components/Card';
import { toast } from '@/ui/components/Toast';

const KIND_LABEL: Record<BackupFileInfo['kind'], string> = {
  auto: 'Automatic',
  premig: 'Before update',
  predestr: 'Before reset/restore',
};

export function BackupsCard() {
  const [files, setFiles] = useState<BackupFileInfo[] | null>(null);
  const [status, setStatus] = useState<BackupStatus>(() => getBackupStatus());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const [list, persist] = await Promise.all([listBackups(), isStoragePersisted()]);
    list.sort((a, b) => b.at.localeCompare(a.at));
    setFiles(list);
    setPersisted(persist);
    setStatus(getBackupStatus());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const newest = files?.[0];

  const backUpNow = async () => {
    if (busy) return;
    setBusy('now');
    try {
      const res = await backupNow('auto');
      toast(res.ok ? 'Backed up' : (res.error ?? 'Backup failed'), res.ok ? 'ok' : 'danger');
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const restore = async (filename: string) => {
    if (busy) return;
    setBusy(filename);
    try {
      const res = await restoreHistoryNotice(filename);
      toast(res.ok ? 'Restored' : (res.error ?? 'Restore failed'), res.ok ? 'ok' : 'danger');
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="text-sm text-muted">
        {isNative() ? 'Kept in Documents/Iron on this phone.' : "Kept in this browser's storage."}
      </div>
      <div className="mt-2 text-sm">
        {newest ? (
          <>
            Newest {fmtDateTime(newest.at)} · {newest.counts.sessions} sessions · {newest.counts.sets} sets
          </>
        ) : files === null ? (
          'Loading…'
        ) : (
          'No backups yet.'
        )}
      </div>
      <div className="mt-1 text-xs text-dim">
        Keeps the newest {KEEP_AUTO} automatic, {KEEP_SPECIAL} before an update or reset.
      </div>
      {status.lastFailure && (
        <div className="mt-1 text-xs text-danger" data-testid="backup-last-failure">
          Last backup failed: {status.lastFailure.reason}
        </div>
      )}
      <div className="mt-1 text-xs text-dim">
        {persisted === null ? 'Storage persistence: not supported here.' : persisted ? 'Storage persistence: granted.' : 'Storage persistence: not granted.'}
      </div>

      <Button full variant="primary" className="mt-3" disabled={busy !== null} onClick={() => void backUpNow()} data-testid="backup-now">
        Back up now
      </Button>

      {files && files.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {files.map((f, i) => (
            <div key={f.filename}>
              {i > 0 && <Divider />}
              <Row
                title={fmtDateTime(f.at)}
                subtitle={`${KIND_LABEL[f.kind]} · ${f.counts.sessions} sessions · ${f.counts.sets} sets`}
                right={
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void restore(f.filename)} data-testid="backup-restore">
                    Restore
                  </Button>
                }
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
