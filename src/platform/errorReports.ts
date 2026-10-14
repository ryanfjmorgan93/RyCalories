/**
 * Errors nothing in the app caught, written down as problem reports on the phone (Settings →
 * Problem reports), so a crash the owner only saw as "it stopped working" can be shared with
 * whoever fixes the app. Only in the APK: in a browser (development, the test suites) the console
 * already shows them, and a report written behind a test's back would change what it reads.
 *
 * Nothing is sent anywhere. The same error is kept once a day (`isRepeat`).
 */
import { Capacitor } from '@capacitor/core';
import { BUILD_LABEL } from '@/buildInfo';
import { addProblemReport } from '@/db/problemRepo';

/** An error's one line and its stack. */
export function describeError(reason: unknown): { summary: string; detail?: string } {
  if (reason instanceof Error) return { summary: `${reason.name}: ${reason.message}`, ...(reason.stack ? { detail: reason.stack } : {}) };
  if (typeof reason === 'string') return { summary: reason };
  try {
    return { summary: `Unexpected error: ${JSON.stringify(reason)}` };
  } catch {
    return { summary: 'Unexpected error' };
  }
}

/** Keeps one uncaught error as a report. Never throws: a failure to report must not become another error. */
export async function recordUncaughtError(reason: unknown, screen: string | undefined, now: Date = new Date()): Promise<void> {
  try {
    const { summary, detail } = describeError(reason);
    await addProblemReport({ source: 'error', summary, detail, screen, build: BUILD_LABEL }, now);
  } catch {
    // Nowhere left to report it.
  }
}

let installed = false;

/** Listens for uncaught errors and rejections, in the APK only. Safe to call more than once. */
export function installErrorCapture(native = Capacitor.isNativePlatform()): void {
  if (!native || installed || typeof window === 'undefined') return;
  installed = true;
  const screen = () => window.location.pathname;
  window.addEventListener('error', (e) => void recordUncaughtError(e.error ?? e.message, screen()));
  window.addEventListener('unhandledrejection', (e) => void recordUncaughtError(e.reason, screen()));
}
