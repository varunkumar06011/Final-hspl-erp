// ═══════════════════════════════════════════════════════════
// Firebase Cloud Messaging Service Worker
// Handles push events, notification display, and click actions
// Must be at root scope (public/) so it controls the entire origin
// ═══════════════════════════════════════════════════════════
//
// NOTE: This service worker intentionally does NOT use importScripts() to load
// the Firebase compat SDK from www.gstatic.com. On iOS Safari, when a PWA is
// added to the home screen and launched in standalone mode, cross-origin
// importScripts() fails to install, leaving the SW in a broken state and
// causing iOS Safari to render a blank white screen.
//
// FCM delivers push payloads via the standard Web Push API 'push' event, which
// fires regardless of whether the Firebase SDK is present in the SW. The
// backend (push.service.ts) sends messages with both `notification` and
// `data` fields, both of which the raw push handler below processes correctly.
// No Firebase SDK is needed in the SW.

// ─── Push event handler ───────────────────────────────────
// FCM calls this when a push arrives and the page is not focused (or closed).
// The payload is sent from the backend via firebase-admin messaging.send()
// with the notification + data fields.
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
        renotify: true,
        data: { url, approvalId },
        requireInteraction: false,
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
