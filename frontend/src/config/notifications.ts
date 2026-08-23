import { getMessaging, getToken, onMessage, deleteToken, isSupported } from 'firebase/messaging';
import { app, isConfigured } from './firebase';
import api from './api';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string;

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

// ─── Check if push is supported in this browser ───────────

export async function isPushSupported(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    if (!isConfigured || !VAPID_KEY) {
      return false;
    }
    return await isSupported();
  } catch {
    return false;
  }
}

// ─── Get current permission state ─────────────────────────

export function getPermissionState(): NotificationPermissionState {
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
    if (!app) {
      return { success: false, error: 'Firebase is not configured' };
    }
    const messaging = getMessaging(app);
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

// ─── Disable notifications (unsubscribe) ──────────────────

export async function disableNotifications(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!app) {
      return { success: false, error: 'Firebase is not configured' };
    }
    const messaging = getMessaging(app);
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
// When the app is open and a push arrives, FCM calls this callback.
// We can show an in-app toast/snackbar here if desired.

export function onForegroundMessage(callback: (payload: { notification?: { title?: string; body?: string }; data?: Record<string, string> }) => void): () => void {
  if (!isConfigured || !app) return () => {};
  try {
    const messaging = getMessaging(app);
    return onMessage(messaging, callback);
  } catch {
    return () => {};
  }
}
