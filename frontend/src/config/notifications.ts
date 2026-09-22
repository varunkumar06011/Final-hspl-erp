import { isConfigured, getFirebase } from './firebase';
import api from './api';
import { isNative } from './appConfig';

// firebase/messaging is lazy-imported inside each function — it adds ~150KB
// to the bundle and is only needed when notifications are actually used, not
// on every app boot (important for slow iOS Home Screen cold starts).
const loadMessaging = () => import('firebase/messaging');

// Native push goes through @capacitor-firebase/messaging (the real Firebase
// iOS SDK → real FCM token). The backend sends via FCM multicast, so the same
// /notifications/subscribe endpoint and payloads work unchanged.
const loadNativeMessaging = () => import('@capacitor-firebase/messaging');

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string;

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

// ─── Check if push is supported on this platform ──────────

export async function isPushSupported(): Promise<boolean> {
  try {
    if (isNative) {
      return isConfigured;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    if (!isConfigured || !VAPID_KEY) {
      return false;
    }
    const { isSupported } = await loadMessaging();
    return await isSupported();
  } catch {
    return false;
  }
}

// ─── Get current permission state ─────────────────────────

export function getPermissionState(): NotificationPermissionState {
  if (isNative) {
    // The plugin check is async; treat unknown as "not yet asked" so the UI
    // proceeds to requestPermissions(), which is the source of truth.
    return 'default';
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

// ─── Register service worker ──────────────────────────────

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/',
  });
  return registration;
}

// ─── Request permission and subscribe ─────────────────────

export async function enableNotifications(): Promise<{ success: boolean; error?: string }> {
  if (isNative) return enableNotificationsNative();

  try {
    const supported = await isPushSupported();
    if (!supported) {
      return { success: false, error: 'Push notifications are not supported in this browser' };
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Notification permission was not granted' };
    }

    // Register service worker
    const registration = await registerServiceWorker();

    // Get FCM token
    const fb = await getFirebase();
    if (!fb) {
      return { success: false, error: 'Firebase is not configured' };
    }
    const { getMessaging, getToken } = await loadMessaging();
    const messaging = getMessaging(fb.app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return { success: false, error: 'Failed to get push token' };
    }

    // Send token to backend
    await api.post('/notifications/subscribe', { token });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable notifications';
    return { success: false, error: message };
  }
}

async function enableNotificationsNative(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isConfigured) {
      return { success: false, error: 'Firebase is not configured' };
    }
    const { FirebaseMessaging } = await loadNativeMessaging();

    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') {
      return { success: false, error: 'Notification permission was not granted' };
    }

    const { token } = await FirebaseMessaging.getToken();
    if (!token) {
      return { success: false, error: 'Failed to get push token' };
    }

    await api.post('/notifications/subscribe', { token });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable notifications';
    return { success: false, error: message };
  }
}

// ─── Disable notifications (unsubscribe) ──────────────────

export async function disableNotifications(): Promise<{ success: boolean; error?: string }> {
  if (isNative) {
    try {
      const { FirebaseMessaging } = await loadNativeMessaging();
      const { token } = await FirebaseMessaging.getToken().catch(() => ({ token: '' }));
      if (token) {
        await api.delete('/notifications/subscribe', { data: { token } }).catch(() => {});
      }
      await FirebaseMessaging.deleteToken().catch(() => {});
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable notifications';
      return { success: false, error: message };
    }
  }

  try {
    const fb = await getFirebase();
    if (!fb) {
      return { success: false, error: 'Firebase is not configured' };
    }
    const { getMessaging, getToken, deleteToken } = await loadMessaging();
    const messaging = getMessaging(fb.app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY }).catch(() => null);

    if (token) {
      await api.delete('/notifications/subscribe', { data: { token } });
      await deleteToken(messaging).catch(() => {});
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to disable notifications';
    return { success: false, error: message };
  }
}

// ─── Check subscription status from backend ───────────────

export async function getSubscriptionStatus(): Promise<{
  enabled: boolean;
  subscriptionCount: number;
}> {
  try {
    const { data } = await api.get('/notifications/status');
    return data;
  } catch {
    return { enabled: false, subscriptionCount: 0 };
  }
}

// ─── Listen for foreground messages ───────────────────────
// When the app is open and a push arrives, this fires the callback so the UI
// can show an in-app toast/snackbar.

export function onForegroundMessage(callback: (payload: { notification?: { title?: string; body?: string }; data?: Record<string, string> }) => void): () => void {
  if (isNative) {
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    loadNativeMessaging().then(({ FirebaseMessaging }) => {
      if (cancelled) return;
      FirebaseMessaging.addListener('notificationReceived', (event) => {
        callback({ notification: event.notification, data: event.notification.data as Record<string, string> });
      }).then((h) => { handle = h; }).catch(() => {});
    }).catch(() => {});
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }

  if (!isConfigured) return () => {};
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;
  Promise.all([getFirebase(), loadMessaging()]).then(([fb, { getMessaging, onMessage }]) => {
    if (cancelled || !fb) return;
    try {
      unsubscribe = onMessage(getMessaging(fb.app), callback);
    } catch { /* messaging unavailable */ }
  }).catch(() => {});
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

// ─── Route notification taps to deep links ────────────────
// Backend payloads carry data.url (e.g. '/pos/123'). On the native shell the
// HashRouter owns navigation, so the listener writes the hash directly and
// also stashes the target for AppShell to consume after login on cold starts.

export const PUSH_DEEP_LINK_KEY = 'pushDeepLink';

export function initNativePushRouting(): void {
  if (!isNative) return;
  loadNativeMessaging()
    .then(({ FirebaseMessaging }) =>
      FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
        const url = (event.notification.data as Record<string, string> | undefined)?.url;
        if (!url || !url.startsWith('/')) return;
        try {
          sessionStorage.setItem(PUSH_DEEP_LINK_KEY, url);
        } catch { /* storage unavailable */ }
        window.location.hash = `#${url}`;
      })
    )
    .catch(() => {});
}
