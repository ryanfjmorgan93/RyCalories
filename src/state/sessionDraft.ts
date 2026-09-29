import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/**
 * What the live row of one exercise card holds that is typed but not yet logged, plus how many
 * "Add a set" rows it has open. Logged sets are already in IndexedDB; this is the part that used to
 * vanish on a reload or when the phone killed the app mid-set.
 *
 * A field that is absent was never typed (the card shows its ghost value); `null` is a field the
 * user cleared on purpose.
 */
export interface SlotDraft {
  weight?: number | null;
  reps?: number | null;
  distanceM?: number | null;
  seconds?: number | null;
  extraRows?: number;
}

export interface SessionDraftState {
  /** sessionId → slotKey → draft. */
  sessions: Record<string, Record<string, SlotDraft>>;
  /** Merge `patch` into one slot's draft. A key set to `undefined` is removed, and a slot left
   * with nothing in it is dropped, so a card with nothing to remember leaves no trace. */
  setDraft: (sessionId: string, slotKey: string, patch: SlotDraft) => void;
  /** Forget every draft of a session — when it is saved or discarded. */
  clearSession: (sessionId: string) => void;
  /** Forget one slot's draft: an extra removed or a swap undone takes its typed values with it. */
  clearSlot: (sessionId: string, slotKey: string) => void;
}

export const SESSION_DRAFT_KEY = 'iron-session-draft';

/** The key a card's draft is stored under: its routine-exercise, or the exercise for a session-only extra. */
export function draftSlotKey(rxId: string | null | undefined, exerciseId: string): string {
  return rxId ?? `extra:${exerciseId}`;
}

const FIELDS = ['weight', 'reps', 'distanceM', 'seconds'] as const;

/** A finite number or an explicit null; anything else in storage is treated as never typed. */
function cleanField(v: unknown): number | null | undefined {
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * One slot's stored draft, read defensively — localStorage is outside the app's control, and a
 * malformed entry must not take the session screen down. Undefined when there is nothing usable.
 */
export function readSlotDraft(
  sessions: SessionDraftState['sessions'] | undefined,
  sessionId: string,
  slotKey: string,
): SlotDraft | undefined {
  const raw: unknown = sessions?.[sessionId]?.[slotKey];
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: SlotDraft = {};
  for (const f of FIELDS) {
    const v = cleanField(r[f]);
    if (v !== undefined) out[f] = v;
  }
  if (typeof r.extraRows === 'number' && Number.isInteger(r.extraRows) && r.extraRows > 0) out.extraRows = r.extraRows;
  return Object.keys(out).length ? out : undefined;
}

/** True when the draft holds a typed value (not merely open "Add a set" rows). */
export function hasTypedValue(d: SlotDraft | undefined): boolean {
  return !!d && FIELDS.some((f) => d[f] !== undefined);
}

function without<T>(o: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...o };
  delete rest[key];
  return rest;
}

/**
 * The store, built over any Storage-shaped backend so a test can hand it a fake and a second
 * instance can read back what the first wrote — the same round trip a reload makes.
 */
export function createSessionDraftStore(getStorage: () => StateStorage) {
  return create<SessionDraftState>()(
    persist(
      (set) => ({
        sessions: {},
        setDraft: (sessionId, slotKey, patch) =>
          set((s) => {
            const before = s.sessions[sessionId]?.[slotKey] ?? {};
            const next: SlotDraft = { ...before };
            for (const [k, v] of Object.entries(patch) as [keyof SlotDraft, number | null | undefined][]) {
              if (v === undefined) delete next[k];
              else (next as Record<string, number | null>)[k] = v;
            }
            const nextKeys = Object.keys(next) as (keyof SlotDraft)[];
            const same = nextKeys.length === Object.keys(before).length && nextKeys.every((k) => next[k] === before[k]);
            if (same) return s;
            const slots = nextKeys.length
              ? { ...(s.sessions[sessionId] ?? {}), [slotKey]: next }
              : without(s.sessions[sessionId] ?? {}, slotKey);
            return {
              sessions: Object.keys(slots).length ? { ...s.sessions, [sessionId]: slots } : without(s.sessions, sessionId),
            };
          }),
        clearSession: (sessionId) =>
          set((s) => (sessionId in s.sessions ? { sessions: without(s.sessions, sessionId) } : s)),
        clearSlot: (sessionId, slotKey) =>
          set((s) => {
            const slots = s.sessions[sessionId];
            if (!slots || !(slotKey in slots)) return s;
            const rest = without(slots, slotKey);
            return { sessions: Object.keys(rest).length ? { ...s.sessions, [sessionId]: rest } : without(s.sessions, sessionId) };
          }),
      }),
      {
        name: SESSION_DRAFT_KEY,
        storage: createJSONStorage(getStorage),
        partialize: (s) => ({ sessions: s.sessions }),
      },
    ),
  );
}

export const useSessionDraft = createSessionDraftStore(() => localStorage);
