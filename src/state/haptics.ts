/**
 * Haptic feedback for the moments the session screen marks: a set ticked, an exercise or workout
 * completed, a blocked action, and the rest timer ending.
 *
 * Native (the Android APK) drives the phone's vibration motor through `@capacitor/haptics`, which
 * asks the OS for a proper impact/notification effect rather than a raw buzz. The plain web PWA
 * has no such API, so it falls back to `navigator.vibrate` with a short pattern that is absent (a
 * no-op) on anything that doesn't support it — desktop Chromium, iOS Safari.
 *
 * Every export is wrapped in its own try/catch so a haptics failure — a missing plugin, a browser
 * that throws on `vibrate()`, a device with the motor disabled — can never surface as an error to
 * the caller. Logging a set successfully must never fail because the buzz that should follow it
 * did not.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './native';

function webVibrate(pattern: number | number[]): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* no vibration API, or it threw */
  }
}

/** A set ticked. */
export async function tap(): Promise<void> {
  try {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Light });
    else webVibrate(15);
  } catch {
    /* never throw */
  }
}

/** An exercise completed, or the workout finished. */
export async function success(): Promise<void> {
  try {
    if (isNative()) await Haptics.notification({ type: NotificationType.Success });
    else webVibrate([20, 60, 30]);
  } catch {
    /* never throw */
  }
}

/** A blocked action. */
export async function warning(): Promise<void> {
  try {
    if (isNative()) await Haptics.notification({ type: NotificationType.Warning });
    else webVibrate([30, 40, 30, 40, 30]);
  } catch {
    /* never throw */
  }
}

/** The rest timer reached zero. Same web pattern `notify.ts` used to fire inline. */
export async function restOver(): Promise<void> {
  try {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Medium });
    else webVibrate([250, 120, 250, 120, 400]);
  } catch {
    /* never throw */
  }
}
