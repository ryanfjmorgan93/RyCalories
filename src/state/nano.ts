/**
 * Capacitor bridge to the on-device Gemini Nano plugin (android/.../NanoPlugin.java).
 * On the plain web PWA there is no native AICore, so the web implementation below reports
 * 'unavailable' and refuses to generate — unless a test hook has been set (see NanoWeb).
 */
import { registerPlugin, WebPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export type NanoState = 'ready' | 'downloadable' | 'downloading' | 'unavailable';

export interface NanoStatus {
  state: NanoState;
  detail: string;
}

export interface NanoDownloadEvent {
  phase: 'started' | 'progress' | 'completed' | 'failed';
  downloaded: number;
  total: number;
  error?: string;
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
  status(): Promise<NanoStatus>;
  download(): Promise<{ started: boolean }>;
  generate(opts: NanoGenerateOptions): Promise<{ text: string }>;
  analyzeMeal(opts: NanoAnalyzeOptions): Promise<{ text: string }>;
  addListener(eventName: 'nanoDownload', fn: (e: NanoDownloadEvent) => void): Promise<PluginListenerHandle>;
}

/**
 * Test-only escape hatch: when an end-to-end test sets `window.__ironNanoFake` before the app
 * loads, the web implementation delegates to it instead of reporting 'unavailable'. This is never
 * set outside Playwright — production and dev builds never touch `window.__ironNanoFake`.
 */
interface IronNanoFake {
  status: NanoStatus;
  generate(opts: NanoGenerateOptions): Promise<{ text: string }>;
  analyzeMeal?(opts: NanoAnalyzeOptions): Promise<{ text: string }>;
}

function getFake(): IronNanoFake | undefined {
  return (window as unknown as { __ironNanoFake?: IronNanoFake }).__ironNanoFake;
}

class NanoWeb extends WebPlugin implements NanoPlugin {
  async status(): Promise<NanoStatus> {
    const fake = getFake();
    if (fake) return fake.status;
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
