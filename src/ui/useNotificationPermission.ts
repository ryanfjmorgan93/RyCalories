import { useEffect, useState } from 'react';
import type { NotificationPermissionStatus } from '@/domain/rest';
import { isNative, nativeNotificationPermission, requestNativeNotifications } from '@/state/native';
import { notificationPermission, requestNotifications } from '@/state/notify';

/**
 * What a notification-permission row knows: the phone's answer (asked of the plugin, so `loading`
 * first) or the browser's. The same logic the Rest card in Settings has used since the rest-over
 * notification was added; written out here so the Reminders card can use it without reaching into
 * SettingsScreen. A later change can point the Rest card at this too.
 */
export type PermissionView = NotificationPermissionStatus | 'loading';

function webPermissionView(): PermissionView {
  const p = notificationPermission();
  return p === 'default' ? 'prompt' : p;
}

export function permissionLabel(perm: PermissionView, native: boolean): string {
  switch (perm) {
    case 'loading':
      return 'Checking…';
    case 'granted':
      return 'Allowed';
    case 'denied':
      return native ? 'Blocked in system settings' : 'Blocked in browser settings';
    case 'prompt':
      return 'Not asked yet';
    case 'unsupported':
      return 'Not supported here';
  }
}

/** Whether the "Allow notifications" button belongs: on the phone a refusal can only be undone in system settings. */
export function canAskForPermission(perm: PermissionView, native: boolean): boolean {
  return perm === 'prompt' || (perm === 'denied' && !native);
}

/**
 * The notification permission, re-read when the app comes back to the front (the owner may have
 * changed it in system settings in between), and a function that asks for it now.
 */
export function useNotificationPermission(): { perm: PermissionView; native: boolean; request: () => Promise<PermissionView> } {
  const native = isNative();
  const [perm, setPerm] = useState<PermissionView>(() => (native ? 'loading' : webPermissionView()));
  useEffect(() => {
    if (!native) return;
    let live = true;
    const read = () => void nativeNotificationPermission().then((p) => live && setPerm(p));
    read();
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [native]);
  const request = async (): Promise<PermissionView> => {
    let next: PermissionView;
    if (native) next = await requestNativeNotifications();
    else {
      await requestNotifications();
      next = webPermissionView();
    }
    setPerm(next);
    return next;
  };
  return { perm, native, request };
}
