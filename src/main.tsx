import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { ensureSeeded, isSeeded, migrateSeed, setPlanOverride } from './db/repo';
import { configureClaudeCoach } from './state/claudeCoach';
import { backupBeforeMigrationIfNeeded, checkForHistoryLoss, maybeAutoBackupAtBoot, requestPersistentStorage } from './db/historySafety';
import { useHistoryNoticeStore } from './state/historyNotice';
import { isNative } from './state/native';
import { startReminders } from './platform/reminders';
import { DB_VERSION } from './db/db';
import { renderRecovery } from './boot/recovery';
import { applyCachedAccent } from './ui/accentTheme';

// The coach's edit_session tool changes today's plan through the same function the "Change today"
// sheet uses, so a change by voice and a change by hand are one thing.
configureClaudeCoach({ setPlanOverride });
// The accent picked on the colour wheel, from its local copy, before anything paints.
applyCachedAccent();

async function boot() {
  // Must run before Dexie ever opens the database — see historySafety.ts.
  await backupBeforeMigrationIfNeeded();
  const wasFreshInstall = !(await isSeeded());
  await ensureSeeded();
  await migrateSeed();
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
  startReminders(); // plans now and on every background; a no-op off the phone (src/platform/reminders.ts)
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
