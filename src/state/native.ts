/**
 * Native (Capacitor / Android APK) integrations. Every function is a no-op on the plain web PWA,
 * so the rest of the app never needs to know which shell it is running in.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { db } from '@/db/db';
import { mapPermissionState, shouldNotifyRestEnd, type NotificationPermissionStatus } from '@/domain/rest';

const REST_NOTIFICATION_ID = 7001;

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

let permissionAsked = false;

/** Ask once for notification permission (Android 13+). */
export async function ensureNativeNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') return true;
    if (permissionAsked) return false;
    permissionAsked = true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch {
    return false;
  }
}

/**
 * The system's notification permission as the app's own three words, for the Settings row. Reads
 * the state without asking. 'unsupported' off the phone, or if the plugin cannot answer.
 */
export async function nativeNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!isNative()) return 'unsupported';
  try {
    return mapPermissionState((await LocalNotifications.checkPermissions()).display);
  } catch {
    return 'unsupported';
  }
}

/** Ask the system for notification permission now (the Settings row's button); returns the outcome. */
export async function requestNativeNotifications(): Promise<NotificationPermissionStatus> {
  if (!isNative()) return 'unsupported';
  try {
    return mapPermissionState((await LocalNotifications.requestPermissions()).display);
  } catch {
    return 'unsupported';
  }
}

/**
 * Schedule the "Rest over" notification for the timer deadline (replaces any earlier one). Honours
 * Settings → Rest → notification: the pending one is always cancelled first, so switching the toggle
 * off mid-rest and then adding time leaves nothing scheduled. Settings are read from the table
 * directly rather than through repo.getSettings, which seeds a missing row — a write this path has
 * no business making.
 */
export async function scheduleRestNotification(endsAt: number, label: string): Promise<void> {
  if (!isNative()) return;
  try {
    await cancelRestNotification();
    if (!shouldNotifyRestEnd(await db.settings.get('settings'))) return;
    if (!(await ensureNativeNotificationPermission())) return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title: 'Rest over',
          body: label,
          schedule: { at: new Date(endsAt), allowWhileIdle: true },
          smallIcon: 'ic_stat_iron',
          sound: undefined,
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

export async function cancelRestNotification(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  } catch {
    /* ignore */
  }
}

/** Write a text file to the app cache and open the Android share sheet for it. */
export async function shareTextFile(filename: string, text: string): Promise<'shared' | 'cancelled'> {
  const written = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: filename, url: written.uri, dialogTitle: filename });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}
