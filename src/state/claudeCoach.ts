/**
 * The Claude coach's state for the screens: sending a message, whether one is in flight, the last
 * error as one plain line, the routine the coach last drafted, and live readers for the thread and
 * the month's spend.
 *
 * The conversation itself is not held here. `sendCoachMessage` (src/ai/chat.ts) writes both sides
 * to the `coachMessages` table, and `useCoachMessages` reads that table live, so the thread
 * survives a restart and every screen that shows it agrees.
 *
 * Wiring: today's sets, reps and weight are written through `repo.setPlanOverride`, which this file
 * does not import (it is added to repo.ts by the training-engine work). The app's start-up code
 * passes it in once with `configureClaudeCoach({ setPlanOverride })`; until then the coach answers
 * that it cannot change those for today, and everything else works.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createCoachActions, type CoachActions } from '../ai/actions';
import { sendCoachMessage, type ChatReply } from '../ai/chat';
import { spendSnapshot, subscribeSpend, type SpendSummary } from '../ai/spend';
import type { SetPlanOverride, TurnRecord } from '../ai/types';
import { db } from '../db/db';
import type { CoachMessage } from '../domain/types';

export interface ClaudeCoachConfig {
  setPlanOverride?: SetPlanOverride;
}

let config: ClaudeCoachConfig = {};
let actions: CoachActions | null = null;

/** Supply the app-side functions the coach's tools need. Call once at start-up. */
export function configureClaudeCoach(next: ClaudeCoachConfig): void {
  config = { ...config, ...next };
  actions = null;
}

/** The coach's actions as configured: what `useClaudeCoach` sends its tools to. Exported for tests. */
export function getClaudeCoachActions(): CoachActions {
  actions ??= createCoachActions({ setPlanOverride: config.setPlanOverride });
  return actions;
}

export interface ClaudeCoachState {
  /** A message is with Claude. */
  busy: boolean;
  /** The last problem, as the one plain line to show, or null. Cleared by the next send. */
  lastError: string | null;
  /** The routine the coach most recently drafted, until it is saved or dismissed. */
  draft: TurnRecord['draft'];
  /** The targets or supplements the coach most recently offered, until taken or dismissed. */
  offer: TurnRecord['offer'];
  /** Send a message. Resolves with the reply, or null when it was ignored (empty, or one already in flight). */
  send: (text: string) => Promise<ChatReply | null>;
  clearError: () => void;
  dismissDraft: () => void;
  dismissOffer: () => void;
  /** Drop one part of the offer once it has been used: a target, or a supplement by name. */
  takeFromOffer: (what: 'calories' | 'protein' | { supplement: string }) => void;
}

export interface ClaudeCoachDeps {
  /** Sends one message to the coach. Replaceable so tests need no network. */
  send: (text: string) => Promise<ChatReply>;
}

export function createClaudeCoachStore(deps: ClaudeCoachDeps) {
  return create<ClaudeCoachState>((set, get) => ({
    busy: false,
    lastError: null,
    draft: null,
    offer: null,

    send: async (text) => {
      const message = text.trim();
      if (!message || get().busy) return null;
      set({ busy: true, lastError: null });
      try {
        const reply = await deps.send(message);
        set((s) => ({ busy: false, lastError: reply.ok ? null : reply.text, draft: reply.draft ?? s.draft, offer: reply.offer ?? s.offer }));
        return reply;
      } catch {
        // sendCoachMessage reports every expected failure as a reply; this is a bug or a broken database.
        set({ busy: false, lastError: 'Something went wrong talking to Claude. Try again.' });
        return null;
      }
    },

    clearError: () => set({ lastError: null }),
    dismissDraft: () => set({ draft: null }),
    dismissOffer: () => set({ offer: null }),
    takeFromOffer: (what) =>
      set((s) => {
        if (!s.offer) return {};
        const next = { ...s.offer };
        if (what === 'calories' || what === 'protein') {
          const targets = { ...next.targets };
          delete targets[what];
          next.targets = targets.calories === undefined && targets.protein === undefined ? undefined : targets;
        } else next.supplements = next.supplements?.filter((x) => x.name !== what.supplement);
        return { offer: next.targets || next.supplements?.length ? next : null };
      }),
  }));
}

/** The app's coach store. */
export const useClaudeCoach = createClaudeCoachStore({ send: (text) => sendCoachMessage(text, { actions: getClaudeCoachActions() }) });

/** The thread, oldest first, live from the database (undefined while the first read is under way). */
export function useCoachMessages(limit = 80): CoachMessage[] | undefined {
  return useLiveQuery(async () => {
    const newest = await db.coachMessages.orderBy('at').reverse().limit(limit).toArray();
    return newest.reverse();
  }, [limit]);
}

/** This month's Claude spend against the cap, current as responses are counted. */
export function useClaudeSpend(): SpendSummary {
  return useSyncExternalStore(subscribeSpend, spendSnapshot, spendSnapshot);
}
