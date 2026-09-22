import { create } from 'zustand';

export type AmbientFlashKind = 'done' | 'record';

interface AmbientFlashState {
  flash: AmbientFlashKind | null;
}

/**
 * The transient colour bloom `<Ambient/>` shows for a moment — green on finishing an exercise,
 * gold on a record — as opposed to the steady ember/cool fields, which read live state directly
 * (a session running, a rest timer counting down) and need no store of their own.
 */
export const useAmbientFlash = create<AmbientFlashState>(() => ({ flash: null }));

const FLASH_MS = 1400;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Blooms the ambient ground layer for a moment. Exported for Phase 3's session screen to call on
 * completing an exercise (`flashAmbient('done')`) or logging a record (`flashAmbient('record')`).
 *
 * A second flash while one is already showing restarts the clock rather than queuing — the ground
 * layer has one bloom at a time, and the most recent state is the one worth showing.
 */
export function flashAmbient(kind: AmbientFlashKind): void {
  useAmbientFlash.setState({ flash: kind });
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => useAmbientFlash.setState({ flash: null }), FLASH_MS);
}
