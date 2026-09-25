/**
 * Capacitor bridge to the on-device Gemini Nano plugin (android/.../NanoPlugin.java).
 * On the plain web PWA there is no native AICore, so the web implementation below reports
 * 'unavailable' and refuses to generate — unless a test hook has been set (see NanoWeb).
 */
import { registerPlugin, WebPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export type NanoState = 'ready' | 'downloadable' | 'downloading' | 'unavailable';

/**
 * Which of AICore's model variants a call uses. 'default' is what ML Kit picks with no preference
 * — the Ask box, meal naming and meal estimates, unchanged. 'full' asks for the fuller variant
 * (`ModelPreference.FULL`), slower and more capable: the coach.
 */
export type NanoModel = 'default' | 'full';

export interface NanoStatus {
  state: NanoState;
  detail: string;
}

export interface NanoDownloadEvent {
  phase: 'started' | 'progress' | 'completed' | 'failed';
  downloaded: number;
  total: number;
  error?: string;
  /** Which variant is downloading; absent from a plugin older than the coach means 'default'. */
  model?: NanoModel;
}

/** One piece of a streamed answer, for the `generateStream` call with the same `requestId`. */
export interface NanoStreamEvent {
  requestId: string;
  text: string;
}

export interface NanoStreamOptions {
  model?: NanoModel;
  system: string;
  prompt: string;
  requestId: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface NanoGenerateOptions {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface NanoAnalyzeOptions {
  path: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface NanoPlugin {
  status(opts?: { model?: NanoModel }): Promise<NanoStatus>;
  download(opts?: { model?: NanoModel }): Promise<{ started: boolean }>;
  generate(opts: NanoGenerateOptions): Promise<{ text: string }>;
  analyzeMeal(opts: NanoAnalyzeOptions): Promise<{ text: string }>;
  /** Tokens the prompt takes, and the most the model accepts. */
  countTokens(opts: { model?: NanoModel; system: string; prompt: string }): Promise<{ tokens: number; limit: number }>;
  /** The answer arrives piece by piece as `nanoStream` events; resolves with the whole of it. */
  generateStream(opts: NanoStreamOptions): Promise<{ text: string }>;
  addListener(eventName: 'nanoDownload', fn: (e: NanoDownloadEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'nanoStream', fn: (e: NanoStreamEvent) => void): Promise<PluginListenerHandle>;
}

/**
 * Test-only escape hatch: when an end-to-end test sets `window.__ironNanoFake` before the app
 * loads, the web implementation delegates to it instead of reporting 'unavailable'. This is never
 * set outside Playwright — production and dev builds never touch `window.__ironNanoFake`.
 */
interface IronNanoFake {
  status: NanoStatus;
  /** The 'full' variant's status; the default one's when absent. */
  statusFull?: NanoStatus;
  generate(opts: NanoGenerateOptions): Promise<{ text: string }>;
  analyzeMeal?(opts: NanoAnalyzeOptions): Promise<{ text: string }>;
  countTokens?(opts: { model?: NanoModel; system: string; prompt: string }): Promise<{ tokens: number; limit: number }>;
  /** Calls `emit` for each piece, which the web plugin turns into a `nanoStream` event. */
  generateStream?(opts: NanoStreamOptions, emit: (text: string) => void): Promise<{ text: string }>;
}

function getFake(): IronNanoFake | undefined {
  return (window as unknown as { __ironNanoFake?: IronNanoFake }).__ironNanoFake;
}

class NanoWeb extends WebPlugin implements NanoPlugin {
  async status(opts?: { model?: NanoModel }): Promise<NanoStatus> {
    const fake = getFake();
    if (fake) return opts?.model === 'full' ? (fake.statusFull ?? fake.status) : fake.status;
    return { state: 'unavailable', detail: 'Only on the Android app.' };
  }

  async download(): Promise<{ started: boolean }> {
    return { started: false };
  }

  async generate(opts: NanoGenerateOptions): Promise<{ text: string }> {
    const fake = getFake();
    if (fake) return fake.generate(opts);
    throw new Error('Only on the Android app.');
  }

  async analyzeMeal(opts: NanoAnalyzeOptions): Promise<{ text: string }> {
    const fake = getFake();
    if (fake?.analyzeMeal) return fake.analyzeMeal(opts);
    throw new Error('Only on the Android app.');
  }

  async countTokens(opts: { model?: NanoModel; system: string; prompt: string }): Promise<{ tokens: number; limit: number }> {
    const fake = getFake();
    if (fake?.countTokens) return fake.countTokens(opts);
    throw new Error('Only on the Android app.');
  }

  async generateStream(opts: NanoStreamOptions): Promise<{ text: string }> {
    const fake = getFake();
    // Pieces go out through the same event, and the same listeners, as the Android plugin's.
    if (fake?.generateStream) return fake.generateStream(opts, (text) => this.notifyListeners('nanoStream', { requestId: opts.requestId, text }));
    throw new Error('Only on the Android app.');
  }
}

export const Nano = registerPlugin<NanoPlugin>('Nano', {
  web: () => new NanoWeb(),
});

/**
 * Turns a rejected `Nano.analyzeMeal()` call into one factual line for the UI. On the Android app
 * a rejection carrying `data.genAiError` (see `NanoPlugin.rejectWith`) is a named ML Kit failure —
 * e.g. "INVALID_INPUT_IMAGE" — and that name is returned verbatim so the screen can show it as-is,
 * per CLAUDE.md's "no explanatory hand-holding" rule. Anything else (a plain `bad_request:` /
 * `decode_failed:` reject, a thrown Error, or a non-Error value) falls back to its own message,
 * never a canned string.
 */
export function describeAnalyzeMealError(e: unknown): string {
  if (e && typeof e === 'object') {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const genAiError = (data as { genAiError?: unknown }).genAiError;
      if (typeof genAiError === 'string' && genAiError) return genAiError;
    }
  }
  if (e instanceof Error) return e.message;
  if (typeof e === 'string' && e) return e;
  return String(e);
}
