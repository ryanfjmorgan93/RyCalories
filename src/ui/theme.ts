import type { Settings } from '@/domain/types';

export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f5f7' : '#0b0b0d');
}
