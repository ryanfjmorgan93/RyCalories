import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { ensureSeeded, getSettings, isSeeded, migrateSeed } from './db/repo';
import { backupBeforeMigrationIfNeeded, checkForHistoryLoss, maybeAutoBackupAtBoot, requestPersistentStorage } from './db/historySafety';
import { useHistoryNoticeStore } from './state/historyNotice';
import { applyTheme } from './ui/theme';
import { isNative } from './state/native';
import { DB_VERSION } from './db/db';
import { renderRecovery } from './boot/recovery';

async function boot() {
  // Must run before Dexie ever opens the database — see historySafety.ts.
  await backupBeforeMigrationIfNeeded();
  const wasFreshInstall = !(await isSeeded());
  await ensureSeeded();
  await migrateSeed();
  const settings = await getSettings();
  applyTheme(settings.theme);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // The service worker is what makes the web install work offline. Inside the Android shell the
  // assets are already on disk, so skip it there.
  if (import.meta.env.PROD && !isNative()) {
    registerSW({ immediate: true });
  }
  // After render, so none of this can slow down or block first paint. Each step guards its own
  // failures — nothing here may throw into the UI.
  void runHistorySafetyBoot(wasFreshInstall);
}

async function runHistorySafetyBoot(wasFreshInstall: boolean): Promise<void> {
  try {
    await requestPersistentStorage();
    void maybeAutoBackupAtBoot();
    const notice = await checkForHistoryLoss(wasFreshInstall);
    if (notice) useHistoryNoticeStore.getState().setNotice(notice);
  } catch (err: unknown) {
    console.error('[iron] history-safety boot check failed', err);
  } finally {
    // Set once per page load, after the check has decided: the one signal a test can wait on that
    // an earlier load cannot already have satisfied (the baseline and notice outlive a reload).
    document.documentElement.dataset.historyCheck = 'done';
  }
}

// A failed database upgrade must never leave a blank screen on the app holding the training
// history. Any boot failure falls through to a recovery screen that can still export the data.
void boot().catch((err: unknown) => {
  console.error('[iron] boot failed', err);
  try {
    renderRecovery(err, DB_VERSION);
  } catch {
    document.body.textContent = 'Iron could not start.';
  }
});
