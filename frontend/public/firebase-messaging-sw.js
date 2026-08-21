// ═══════════════════════════════════════════════════════════
// Firebase Cloud Messaging Service Worker
// Handles push events, notification display, and click actions
// Must be at the root scope (public/) so it controls the entire origin
// ═══════════════════════════════════════════════════════════

// Firebase imports — version must match the firebase package in package.json
importScripts(
  'https://www.gstatic.com/firebasejs/10.12.1/firebase-app-compat.js'
);
importScripts(
  'https://www.gstatic.com/firebasejs/10.12.1/firebase-messaging-compat.js'
);

// Minimal config — only projectId + messagingSenderId needed for background messaging
firebase.initializeApp({
  apiKey: 'AIzaSyDdEO_xFR9HYdw7xM6FeOjk0zi8ck24gtM',
  authDomain: 'meditrust-erp.firebaseapp.com',
  projectId: 'meditrust-erp',
  storageBucket: 'meditrust-erp.firebasestorage.app',
  messagingSenderId: '963993986351',
  appId: '1:963993986351:web:5d303afcee2376a68d2dda',
});

const messaging = firebase.messaging();

// ─── Background message handler ───────────────────────────
// FCM calls this when a push arrives and the page is not focused (or closed).
// The payload is sent from the backend via firebase-admin messaging.send()
// with the notification + data fields.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const notification = payload.notification || {};

  const title = notification.title || data.title || 'Hospital ERP';
  const body = notification.body || data.body || '';
  const approvalId = data.approvalId || '';
  const url = data.url || '/';

  const notificationOptions = {
    body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: approvalId || `approval-${Date.now()}`,
    renotify: true,
    data: { url, approvalId },
    requireInteraction: false,
  };

  return self.registration.showNotification(title, notificationOptions);
});

// ─── Push event fallback ──────────────────────────────────
// If onBackgroundMessage doesn't fire (edge cases), handle raw push event.
self.addEventListener('push', (event) => {
  if (event.data) {
    try {
      const payload = event.data.json();
      const data = payload.data || {};
      const notification = payload.notification || {};

      const title = notification.title || data.title || 'Hospital ERP';
      const body = notification.body || data.body || '';
      const approvalId = data.approvalId || '';
      const url = data.url || '/';

      const options = {
        body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: approvalId || `approval-${Date.now()}`,
        data: { url, approvalId },
      };

      event.waitUntil(self.registration.showNotification(title, options));
    } catch {
      // Non-JSON payload — ignore
    }
  }
});

// ─── Notification click handler ───────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Check if any existing client is already at the target URL or the origin
      for (const client of allClients) {
        const clientUrl = new URL(client.url, self.location.origin);
        const targetUrlObj = new URL(targetUrl, self.location.origin);

        // Focus if same pathname, or if it's the root and we can navigate
        if (clientUrl.pathname === targetUrlObj.pathname) {
          // Already on the right page — focus it
          if ('focus' in client) {
            await client.focus();
            // Post message so the app can open the approval dialog
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: targetUrl,
              approvalId: event.notification.data?.approvalId,
            });
            return;
          }
        }
      }

      // No matching client — try to find any client to focus and navigate
      for (const client of allClients) {
        if ('focus' in client && 'navigate' in client) {
          await client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            approvalId: event.notification.data?.approvalId,
          });
          return;
        }
      }

      // No existing window — open a new one
      await self.clients.openWindow(targetUrl);
    })()
  );
});

// ─── Service worker lifecycle ─────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
