import { create } from 'zustand';

/**
 * Whether the coach sheet is open. One sheet for the whole app, mounted once in App.tsx, so any
 * screen (Home, the session, Food, a coach line) can open the same conversation without each
 * mounting its own copy. On the full-screen coach (/coach) the screen itself takes what is passed
 * here and the sheet stays shut.
 */
interface CoachSheetState {
  open: boolean;
  /** Text to put in the box when the sheet opens, e.g. a coach line's follow-up. */
  prefill: string;
  /** The first message is a request for a routine whatever it says ("Draft with coach"). */
  build: boolean;
  openCoach: (prefill?: string, opts?: { build?: boolean }) => void;
  closeCoach: () => void;
}

export const useCoachSheet = create<CoachSheetState>((set) => ({
  open: false,
  prefill: '',
  build: false,
  openCoach: (prefill = '', opts) => set({ open: true, prefill, build: opts?.build === true }),
  closeCoach: () => set({ open: false, prefill: '', build: false }),
}));

export function openCoach(prefill?: string, opts?: { build?: boolean }): void {
  useCoachSheet.getState().openCoach(prefill, opts);
}
