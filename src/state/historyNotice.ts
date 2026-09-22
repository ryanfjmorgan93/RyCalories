/**
 * Reactive holder for the current history-safety notice (loss or fresh-install-offer). The
 * authoritative copy lives in localStorage (src/db/historySafety.ts) so it survives reloads; this
 * store just lets Home re-render when the boot check sets or clears it, and is seeded from
 * localStorage synchronously so a notice from a previous boot shows immediately rather than
 * flashing in after the boot check re-runs.
 */
import { create } from 'zustand';
import type { HistoryNotice } from '@/domain/lossDetection';
import { getStoredNotice } from '@/db/historySafety';

interface HistoryNoticeState {
  notice: HistoryNotice | null;
  setNotice: (n: HistoryNotice | null) => void;
}

export const useHistoryNoticeStore = create<HistoryNoticeState>((set) => ({
  notice: getStoredNotice(),
  setNotice: (notice) => set({ notice }),
}));
