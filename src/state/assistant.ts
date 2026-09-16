/**
 * Assistant store: turns a question plus the caller's AssistantContext into a reply from an
 * on-device model. In-memory only — nothing here persists across a reload.
 */
import { create } from 'zustand';
import { buildPrompt, buildSystemPrompt, trimReply, type AssistantContext, type AssistantTurn } from '../domain/assistant';
import { Nano, type NanoStatus } from './nano';

/**
 * A source of answers for the assistant box. `kind` distinguishes providers so a cloud backend
 * (e.g. a Claude API call) can be added later as a second kind without changing the store's shape.
 */
export interface AssistantBackend {
  kind: 'nano';
  status(): Promise<NanoStatus>;
  ask(system: string, prompt: string): Promise<string>;
}

/** Talks to the on-device Gemini Nano plugin. Fixed generation settings: short, focused answers. */
export class NanoBackend implements AssistantBackend {
  readonly kind = 'nano' as const;

  status(): Promise<NanoStatus> {
    return Nano.status();
  }

  async ask(system: string, prompt: string): Promise<string> {
    const { text } = await Nano.generate({ system, prompt, maxOutputTokens: 400, temperature: 0.4 });
    return text;
  }
}

export interface AssistantState {
  status: NanoStatus | null;
  thread: AssistantTurn[];
  busy: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  ask: (question: string, ctx: AssistantContext) => Promise<void>;
  reset: () => void;
  download: () => Promise<void>;
}

/**
 * Builds the store around an injected backend so tests can supply a fake one instead of the real
 * Nano plugin. `useAssistant` below is the production singleton built on `NanoBackend`.
 */
export function createAssistantStore(backend: AssistantBackend) {
  return create<AssistantState>((set, get) => ({
    status: null,
    thread: [],
    busy: false,
    error: null,

    refreshStatus: async () => {
      try {
        const status = await backend.status();
        set({ status });
      } catch {
        set({ status: { state: 'unavailable', detail: 'Status check failed.' } });
      }
    },

    download: async () => {
      try {
        await Nano.download();
      } catch {
        // Progress and failure are reported separately via the nanoDownload event; nothing more to do here.
      }
    },

    ask: async (question, ctx) => {
      const { busy, thread, status } = get();
      if (busy || !question.trim()) return;

      if (!status || status.state === 'unavailable') {
        set({ error: 'On-device model unavailable.' });
        return;
      }
      if (status.state !== 'ready') {
        set({ error: 'Model not downloaded.' });
        return;
      }

      set({ busy: true, error: null });
      const system = buildSystemPrompt();
      const prompt = buildPrompt(ctx, thread, question);
      try {
        const raw = await backend.ask(system, prompt);
        const reply = trimReply(raw);
        if (!reply) {
          set({ busy: false, error: 'The model did not answer.' });
          return;
        }
        set({
          thread: [...get().thread, { role: 'user', text: question }, { role: 'assistant', text: reply }],
          busy: false,
        });
      } catch {
        set({ busy: false, error: 'The model did not answer.' });
      }
    },

    reset: () => set({ thread: [], error: null }),
  }));
}

export const useAssistant = createAssistantStore(new NanoBackend());
