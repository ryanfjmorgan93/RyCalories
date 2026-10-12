import { create } from 'zustand';

/**
 * Whether the coach sheet is open. One sheet for the whole app, mounted once in App.tsx, so any
 * screen (Home, the session, Food, a coach line) can open the same conversation without each
 * mounting its own copy.
 */
interface CoachSheetState {
  open: boolean;
  /** Text to put in the box when the sheet opens, e.g. a coach line's follow-up. */
  prefill: string;
  openCoach: (prefill?: string) => void;
  closeCoach: () => void;
}

export const useCoachSheet = create<CoachSheetState>((set) => ({
  open: false,
  prefill: '',
  openCoach: (prefill = '') => set({ open: true, prefill }),
  closeCoach: () => set({ open: false, prefill: '' }),
}));

export function openCoach(prefill?: string): void {
  useCoachSheet.getState().openCoach(prefill);
}
