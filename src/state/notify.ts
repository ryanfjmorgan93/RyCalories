/**
 * End-of-rest cues: vibration, a short beep, and (when the app is in the background) a
 * system notification via the service worker. Permission is requested once, on the first
 * completed set, and the outcome remembered so we never nag.
 */

const ASKED_KEY = 'iron-notify-asked';

let audioCtx: AudioContext | null = null;

/** Create the AudioContext inside a user gesture so later beeps are allowed. */
export function primeAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    /* no audio */
  }
}

function beep(): void {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.18);
    }
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask once. Returns the resulting permission. */
export async function requestNotificationsOnce(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    if (localStorage.getItem(ASKED_KEY)) return Notification.permission;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* ignore */
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface RestDoneOptions {
  vibrate: boolean;
  notify: boolean;
  label: string;
}

/** Fire the end-of-rest cue. Safe to call from a timer tick. */
export async function restDone(opts: RestDoneOptions): Promise<void> {
  if (opts.vibrate) vibrate([250, 120, 250, 120, 400]);
  beep();
  if (!opts.notify || !notificationsSupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body: opts.label,
      tag: 'iron-rest',
      renotify: true,
      silent: false,
      vibrate: [250, 120, 250],
      icon: '/icons/icon-192.png',
    };
    if (reg) await reg.showNotification('Rest over', options);
    else new Notification('Rest over', options);
  } catch {
    /* ignore */
  }
}
