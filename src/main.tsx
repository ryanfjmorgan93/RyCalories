import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { ensureSeeded, getSettings } from './db/repo';
import { applyTheme } from './ui/theme';

async function boot() {
  await ensureSeeded();
  const settings = await getSettings();
  applyTheme(settings.theme);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (import.meta.env.PROD) {
    registerSW({ immediate: true });
  }
}

void boot();
