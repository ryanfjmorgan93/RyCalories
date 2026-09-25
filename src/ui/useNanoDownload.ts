import { useEffect, useState } from 'react';
import { Nano, type NanoDownloadEvent, type NanoModel } from '../state/nano';

/**
 * Download progress of one Nano variant, from the plugin's `nanoDownload` events: a percentage
 * while it runs (0 when the size is not known yet), null otherwise. `onFinished` runs when it
 * completes or fails, so the caller can re-read the status.
 */
export function useNanoDownloadPercent(model: NanoModel, onFinished: () => void): number | null {
  const [percent, setPercent] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void Nano.addListener('nanoDownload', (e: NanoDownloadEvent) => {
      if ((e.model ?? 'default') !== model) return;
      if (e.phase === 'started' || e.phase === 'progress') {
        setPercent(e.total > 0 ? Math.min(100, Math.max(0, Math.round((e.downloaded / e.total) * 100))) : 0);
      } else {
        setPercent(null);
        onFinished();
      }
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [model, onFinished]);
  return percent;
}
