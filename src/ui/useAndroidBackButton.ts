import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '@/state/native';
import { handleBack } from '@/state/overlays';

/**
 * The Android back gesture, on the APK only. Without a listener the system back left the app
 * outright — past an open sheet, past an unsaved meal. Now one press closes the top sheet, else
 * does what the screen's back arrow does, else (a tab's root, nothing to go back to) minimises
 * the app the way Android does for any root screen. The decision is `handleBack` in
 * src/state/overlays.ts; Escape drives the same stack in the browser and the e2e suite.
 */
export function useAndroidBackButton(): void {
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void CapacitorApp.addListener('backButton', () => {
      if (handleBack() === 'none') void CapacitorApp.minimizeApp();
    }).then((h) => {
      if (cancelled) void h.remove();
      else remove = () => void h.remove();
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
}
