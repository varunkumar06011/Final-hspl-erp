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

// ─── Web Share Target (Android: Share → Hospital ERP) ─────
// manifest.webmanifest declares a share_target that POSTs multipart/form-data to
// /share-target. The files are parked in Cache Storage and the user is redirected
// to the Document Library, which picks them up and opens its upload dialog.
const SHARE_CACHE = 'shared-files-v1';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('file').filter((f) => f instanceof File);
        const cache = await caches.open(SHARE_CACHE);
        for (const key of await cache.keys()) await cache.delete(key);
        for (let i = 0; i < files.length; i += 1) {
          const f = files[i];
          await cache.put(
            `/__shared/${i}`,
            new Response(f, {
              headers: {
                'Content-Type': f.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(f.name || `shared-${i}`),
                'X-Shared-At': String(Date.now()),
              },
            })
          );
        }
        const note = [form.get('title'), form.get('text')].filter(Boolean).join(' ').slice(0, 300);
        return Response.redirect(`/documents?share=${files.length}${note ? `&note=${encodeURIComponent(note)}` : ''}`, 303);
      } catch {
        return Response.redirect('/documents', 303);
      }
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
