import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { ensureSeeded, getSettings } from './db/repo';
import { applyTheme } from './ui/theme';
import { isNative } from './state/native';

async function boot() {
  await ensureSeeded();
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
}

void boot();
