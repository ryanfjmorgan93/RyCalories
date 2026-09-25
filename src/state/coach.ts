/**
 * Coach store: one question at a time to the phone's own Gemini Nano (the fuller variant), with the
 * owner's data fitted to what the model accepts and the answer shown as it arrives. In memory only
 * — nothing here persists, and nothing opens by itself.
 */
import { create } from 'zustand';
import { loadClaudeSummaryInput } from '../db/claudeSummaryQueries';
import { getSettings } from '../db/repo';
import { toDateKey } from '../domain/dates';
import type { ClaudeSummaryInput } from '../domain/claudeSummary';
import { buildCoachPrompt, buildCoachSystemPrompt, coachContextLadder, type CoachMode, type CoachTurn } from '../domain/coach';
import { parseRoutineText } from '../domain/routineText';
import { describeAnalyzeMealError, Nano, type NanoStatus } from './nano';

/** Room left in the model's limit for the answer. A drafted routine needs more than a reply. */
export const REPLY_TOKENS: Record<CoachMode, number> = { ask: 600, routine: 800 };

/**
 * How long the model may go quiet before the question is given up. Counting is quick. An answer
 * gets longer: the fuller variant can take many seconds to read a few thousand tokens before its
 * first word, so the clock restarts with every piece that arrives rather than timing the whole.
 * Without these, a model dropped mid-question (AICore evicting it, say) left "Answering…" for ever.
 */
export const COUNT_TIMEOUT_MS = 20_000;
export const QUIET_TIMEOUT_MS = 120_000;

const NO_ANSWER = 'The model did not answer.';

/** `start`'s promise, rejected if `touch` is not called for `ms` — measured from the start and from each touch. */
function untilQuiet<T>(ms: number, start: (touch: () => void) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error(NO_ANSWER)), ms);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error(NO_ANSWER)), ms);
    };
    start(touch).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface CoachBackend {
  status(): Promise<NanoStatus>;
  /** Starts AICore's download of the fuller variant; progress arrives as `nanoDownload` events. */
  download(): Promise<void>;
  countTokens(system: string, prompt: string): Promise<{ tokens: number; limit: number }>;
  /** Streams the answer through `onText`, one piece at a time; resolves with the whole of it. */
  stream(system: string, prompt: string, maxOutputTokens: number, onText: (piece: string) => void): Promise<string>;
}

let nextRequest = 0;

/** The plugin's fuller variant ('full'), streamed through `nanoStream` events. */
export class NanoCoachBackend implements CoachBackend {
  status(): Promise<NanoStatus> {
    return Nano.status({ model: 'full' });
  }

  async download(): Promise<void> {
    await Nano.download({ model: 'full' });
  }

  countTokens(system: string, prompt: string) {
    return Nano.countTokens({ model: 'full', system, prompt });
  }

  async stream(system: string, prompt: string, maxOutputTokens: number, onText: (piece: string) => void): Promise<string> {
    const requestId = `coach-${++nextRequest}`;
    const handle = await Nano.addListener('nanoStream', (e) => {
      if (e.requestId === requestId) onText(e.text);
    });
    try {
      const { text } = await Nano.generateStream({ model: 'full', system, prompt, requestId, maxOutputTokens, temperature: 0.3 });
      return text;
    } finally {
      await handle.remove();
    }
  }
}

export interface CoachEntry {
  mode: CoachMode;
  question: string;
  /** What the answer was given to read, e.g. "training 8 weeks · food 4 weeks". */
  label: string;
  answer: string;
  /** Routine mode: the answer holds a routine Paste a routine can read. */
  hasRoutine?: boolean;
}

export interface CoachState {
  status: NanoStatus | null;
  entries: CoachEntry[];
  /** The question being answered, and the answer so far. */
  pending: { mode: CoachMode; question: string; label: string; partial: string } | null;
  error: string | null;
  refreshStatus: () => Promise<void>;
  download: () => Promise<void>;
  ask: (question: string, mode: CoachMode) => Promise<void>;
  reset: () => void;
}

function threadFor(entries: CoachEntry[], mode: CoachMode): CoachTurn[] {
  return entries
    .filter((e) => e.mode === mode)
    .flatMap((e): CoachTurn[] => [
      { role: 'user', text: e.question },
      { role: 'coach', text: e.answer },
    ]);
}

/**
 * Built around an injected backend and data loader so tests run the real ladder, fitting and
 * streaming against a fake model. `useCoach` below is the app's, on the Nano plugin and the database.
 */
export function createCoachStore(backend: CoachBackend, loadInput: () => Promise<ClaudeSummaryInput>) {
  // Bumped by Clear: a question still being answered from before it is dropped, not saved.
  let generation = 0;
  return create<CoachState>((set, get) => ({
    status: null,
    entries: [],
    pending: null,
    error: null,

    refreshStatus: async () => {
      try {
        set({ status: await backend.status() });
      } catch (e) {
        set({ status: { state: 'unavailable', detail: describeAnalyzeMealError(e) } });
      }
    },

    download: async () => {
      try {
        await backend.download();
      } catch (e) {
        set({ error: describeAnalyzeMealError(e) });
      }
    },

    ask: async (raw, mode) => {
      const question = raw.trim();
      const { pending, status, entries } = get();
      if (pending || !question) return;
      if (!status) {
        set({ error: 'Status not checked yet.' });
        return;
      }
      if (status.state !== 'ready') {
        set({ error: status.state === 'unavailable' ? status.detail : 'Model not downloaded.' });
        return;
      }

      const mine = ++generation;
      const current = () => generation === mine;
      set({ pending: { mode, question, label: '', partial: '' }, error: null });
      try {
        const system = buildCoachSystemPrompt(mode);
        const thread = threadFor(entries, mode);
        const ladder = coachContextLadder(await loadInput(), question, mode);
        let chosen: { prompt: string; label: string } | null = null;
        for (const rung of ladder) {
          const prompt = buildCoachPrompt(rung.text, thread, question);
          const { tokens, limit } = await untilQuiet(COUNT_TIMEOUT_MS, () => backend.countTokens(system, prompt));
          if (!current()) return;
          if (tokens + REPLY_TOKENS[mode] <= limit) {
            chosen = { prompt, label: rung.label };
            break;
          }
        }
        if (!current()) return;
        if (!chosen) {
          set({ pending: null, error: 'Question too long for the model.' });
          return;
        }
        const { label, prompt } = chosen;
        set({ pending: { mode, question, label, partial: '' } });
        const whole = await untilQuiet(QUIET_TIMEOUT_MS, (touch) =>
          backend.stream(system, prompt, REPLY_TOKENS[mode], (piece) => {
            touch();
            const p = get().pending;
            if (p && current()) set({ pending: { ...p, partial: p.partial + piece } });
          }),
        );
        if (!current()) return;
        const answer = whole.trim();
        if (!answer) {
          set({ pending: null, error: 'The model did not answer.' });
          return;
        }
        const entry: CoachEntry = { mode, question, label, answer };
        if (mode === 'routine') entry.hasRoutine = parseRoutineText(answer).routines.length > 0;
        set({ entries: [...get().entries, entry], pending: null });
      } catch (e) {
        if (current()) set({ pending: null, error: describeAnalyzeMealError(e) });
      }
    },

    reset: () => {
      generation++;
      set({ entries: [], error: null, pending: null });
    },
  }));
}

const ALL_SECTIONS = { training: true, food: true, bodyweight: true, routines: true };

/** 26 weeks of training, so a question naming an exercise can read its whole recent history. */
export const COACH_WINDOWS = { trainingDays: 182, foodDays: 28, bodyweightDays: 56 };

export const useCoach = createCoachStore(new NanoCoachBackend(), async () =>
  loadClaudeSummaryInput(toDateKey(), ALL_SECTIONS, await getSettings(), COACH_WINDOWS),
);
