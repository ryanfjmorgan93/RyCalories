import { create } from 'zustand';
import type { ParsedInbody } from '@/domain/inbody';

/**
 * A file another app shared to Iron (the Android share sheet), parsed and waiting for the owner to
 * look at it. src/platform/shareTarget.ts puts it here and navigates to Progress; the Body card
 * there opens the import sheet on it and clears it. Held in memory only, so a half-seen import
 * does not come back after the app is killed.
 */
interface InbodyShareState {
  pending: ParsedInbody | null;
  /** The shared file's name, when it had one. */
  fileName: string | null;
  offer: (parsed: ParsedInbody, fileName?: string) => void;
  clear: () => void;
}

export const useInbodyShare = create<InbodyShareState>((set) => ({
  pending: null,
  fileName: null,
  offer: (parsed, fileName) => set({ pending: parsed, fileName: fileName ?? null }),
  clear: () => set({ pending: null, fileName: null }),
}));
