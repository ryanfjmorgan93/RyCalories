import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cancelRestNotification, scheduleRestNotification } from './native';

/**
 * Rest timer. Driven by an absolute deadline (`endsAt`) rather than a counting interval so it
 * stays correct when the tab is backgrounded or the app reloads mid-rest. A 1 s tick only
 * triggers re-renders; components compute remaining time from `endsAt`.
 */
export interface TimerState {
  endsAt: number | null;
  startedAt: number | null;
  totalSec: number;
  label: string;
  /** Set once the "done" cue has fired for the current deadline. */
  firedFor: number | null;
  start: (sec: number, label: string) => void;
  add: (sec: number) => void;
  skip: () => void;
  markFired: (endsAt: number) => void;
}

export const useTimer = create<TimerState>()(
  persist(
    (set, get) => ({
      endsAt: null,
      startedAt: null,
      totalSec: 0,
      label: '',
      firedFor: null,
      start: (sec, label) => {
        const now = Date.now();
        const endsAt = now + Math.max(0, sec) * 1000;
        set({ endsAt, startedAt: now, totalSec: Math.max(0, sec), label, firedFor: null });
        void scheduleRestNotification(endsAt, label);
      },
      add: (sec) => {
        const { endsAt, totalSec, label } = get();
        if (endsAt === null) return;
        const base = Math.max(endsAt, Date.now());
        const next = base + sec * 1000;
        set({ endsAt: next, totalSec: totalSec + sec, firedFor: null });
        void scheduleRestNotification(next, label);
      },
      skip: () => {
        set({ endsAt: null, startedAt: null, totalSec: 0, label: '', firedFor: null });
        void cancelRestNotification();
      },
      markFired: (endsAt) => set({ firedFor: endsAt }),
    }),
    { name: 'iron-rest-timer' },
  ),
);

export function remainingSec(endsAt: number | null, now = Date.now()): number {
  if (endsAt === null) return 0;
  return Math.ceil((endsAt - now) / 1000);
}
