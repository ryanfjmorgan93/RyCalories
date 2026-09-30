/**
 * Quick intent store: the Short session sheet's "Read with assistant". One typed line goes to the
 * phone's own default model on the owner's tap, and the options it names come back. In memory and
 * stateless between calls — nothing here persists, nothing calls it by itself, and what it returns
 * is only ever the five option fields `parseIntentReply` validates: never an exercise, never a
 * weight.
 *
 * Whether the model can answer is the assistant store's status (`useAssistant`), not a second
 * source: it is usable only when that says 'ready'.
 */
import { create } from 'zustand';
import { buildIntentPrompt, parseIntentReply, type QuickOptions } from '../domain/quickRequest';
import { useAssistant } from './assistant';
import { NO_ANSWER, untilQuiet } from './coach';
import { describeAnalyzeMealError, Nano, type NanoStatus } from './nano';

/** A reply is one small JSON object; this leaves room for it and no more. */
export const INTENT_MAX_TOKENS = 120;

/**
 * How long the model may take. `Nano.generate` has no limit of its own, so without this a model
 * dropped mid-request (AICore evicting it, say) would leave "Reading…" for ever.
 */
export const INTENT_TIMEOUT_MS = 20_000;

/**
 * The limit in force. An end-to-end test may set `window.__quickIntentTimeoutMs` to something short
 * so a model that never answers can be waited out; production never sets it.
 */
function timeoutMs(): number {
  const override = (globalThis as { __quickIntentTimeoutMs?: unknown }).__quickIntentTimeoutMs;
  return typeof override === 'number' && override > 0 ? override : INTENT_TIMEOUT_MS;
}

/** A source of replies for the typed request. A fake one stands in for the plugin in tests. */
export interface QuickIntentBackend {
  generate(system: string, prompt: string): Promise<string>;
}

/** Talks to the on-device model the plugin picks with no preference (not the coach's fuller one), with no randomness: the same line reads the same way. */
export class NanoIntentBackend implements QuickIntentBackend {
  async generate(system: string, prompt: string): Promise<string> {
    const { text } = await Nano.generate({ system, prompt, maxOutputTokens: INTENT_MAX_TOKENS, temperature: 0 });
    return text;
  }
}

export interface QuickIntentState {
  busy: boolean;
  /** Why the last call gave nothing, as a plain fact; null when it read something or found nothing to read. */
  error: string | null;
  /**
   * The options the model read from `text`: null when it was not asked (busy, an empty line, a model
   * that is not ready), did not answer, or answered with nothing usable. The owner's tap is the only
   * caller, and a call made while one is running is ignored.
   */
  read: (text: string) => Promise<Partial<QuickOptions> | null>;
}

/**
 * Built around an injected backend, so tests run the real prompt, timeout and reply parsing against
 * a fake model. Whether the model may be asked is the assistant store's status, read live at each
 * call; `readStatus` stands in for it only where a test wants a status of its own. `useQuickIntent`
 * below is the app's, on the Nano plugin.
 */
export function createQuickIntentStore(backend: QuickIntentBackend, readStatus: () => NanoStatus | null = () => useAssistant.getState().status) {
  return create<QuickIntentState>((set, get) => ({
    busy: false,
    error: null,

    read: async (text) => {
      if (get().busy) return null;
      if (typeof text !== 'string' || !text.trim()) {
        set({ error: null });
        return null;
      }

      const status = readStatus();
      if (!status) {
        set({ error: 'Status not checked yet.' });
        return null;
      }
      if (status.state !== 'ready') {
        set({ error: status.state === 'unavailable' ? status.detail : 'Model not downloaded.' });
        return null;
      }

      set({ busy: true, error: null });
      try {
        const { system, prompt } = buildIntentPrompt(text);
        const reply = await untilQuiet(timeoutMs(), () => backend.generate(system, prompt));
        const options = parseIntentReply(reply);
        set({ busy: false });
        return options && Object.keys(options).length > 0 ? options : null;
      } catch (e) {
        set({ busy: false, error: describeAnalyzeMealError(e) || NO_ANSWER });
        return null;
      }
    },
  }));
}

export const useQuickIntent = createQuickIntentStore(new NanoIntentBackend());
