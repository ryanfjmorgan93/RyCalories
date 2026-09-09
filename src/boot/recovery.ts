/**
 * Last-resort recovery screen.
 *
 * If boot() throws — most plausibly a failed Dexie upgrade — the app would otherwise show a
 * permanently blank page, because index.html's #root is empty and there is no error boundary
 * above the root render. On a phone that is unrecoverable without a new APK, on an app holding
 * months of irreplaceable training history.
 *
 * Deliberately written in plain DOM with no imports from the rest of the app: it must not be able
 * to fail for the same reason the app just failed. The export path likewise talks to IndexedDB
 * directly rather than through Dexie, so a broken schema version cannot block the rescue.
 */

const DB_NAME = 'iron';

/** Read every object store at whatever version is actually on disk, bypassing Dexie entirely. */
async function dumpRaw(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    // No version argument: opens at the existing version without triggering an upgrade.
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another tab'));
  });

  const names = Array.from(db.objectStoreNames);
  const tables: Record<string, unknown[]> = {};
  for (const name of names) {
    tables[name] = await new Promise<unknown[]>((resolve, reject) => {
      const r = db.transaction(name, 'readonly').objectStore(name).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  db.close();

  return JSON.stringify(
    { app: 'iron', version: 1, recovered: true, exportedAt: new Date().toISOString(), tables },
    null,
    2,
  );
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Render the recovery screen. `attemptedVersion` is the Dexie version the app tried to open,
 * so a report names the exact upgrade that failed.
 */
export function renderRecovery(error: unknown, attemptedVersion: number): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'min-height:100dvh;background:#0b0b0d;color:#f4f4f5;padding:24px;box-sizing:border-box;' +
    'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5';

  const h = document.createElement('h1');
  h.textContent = 'Iron could not start';
  h.style.cssText = 'font-size:24px;font-weight:800;margin:0 0 12px';

  const p = document.createElement('p');
  p.textContent =
    'Your data has not been changed. Export it now, then send the details below so the problem can be fixed.';
  p.style.cssText = 'color:#9a9aa4;margin:0 0 20px';

  const detail = document.createElement('pre');
  detail.textContent = `Database: ${DB_NAME}\nAttempted version: ${attemptedVersion}\n${message}`;
  detail.style.cssText =
    'background:#151518;border:1px solid #2b2b33;border-radius:12px;padding:12px;' +
    'font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0 0 20px;color:#f4f4f5';

  const status = document.createElement('div');
  status.style.cssText = 'margin-top:14px;font-size:14px;color:#9a9aa4;min-height:20px';

  const btn = document.createElement('button');
  btn.textContent = 'Export raw backup';
  btn.style.cssText =
    'width:100%;height:56px;border:0;border-radius:16px;background:#ff8a2a;color:#140a02;' +
    'font-size:18px;font-weight:800;cursor:pointer';
  btn.onclick = () => {
    btn.disabled = true;
    status.textContent = 'Reading database…';
    void dumpRaw()
      .then((json) => {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        download(`iron-recovery-${stamp}.json`, json);
        const count = Object.keys(JSON.parse(json).tables).length;
        status.textContent = `Exported ${count} tables. Keep this file safe.`;
      })
      .catch((e: unknown) => {
        status.textContent = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
      })
      .finally(() => {
        btn.disabled = false;
      });
  };

  const copy = document.createElement('button');
  copy.textContent = 'Copy error details';
  copy.style.cssText =
    'width:100%;height:48px;margin-top:10px;border:1px solid #2b2b33;border-radius:16px;' +
    'background:transparent;color:#f4f4f5;font-size:16px;font-weight:600;cursor:pointer';
  copy.onclick = () => {
    void navigator.clipboard
      ?.writeText(detail.textContent ?? '')
      .then(() => (status.textContent = 'Details copied.'))
      .catch(() => (status.textContent = 'Could not copy — read the details above.'));
  };

  wrap.append(h, p, detail, btn, copy, status);
  root.appendChild(wrap);
}
