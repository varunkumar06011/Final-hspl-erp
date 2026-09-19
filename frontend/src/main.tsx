import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Unlock screen orientation — allow both portrait and landscape.
// The manifest no longer specifies an orientation, but if the PWA was
// previously installed with "portrait" lock, this explicitly removes
// any active orientation lock so the screen rotates with the device.
if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
  try {
    screen.orientation.unlock();
  } catch {
    // Some browsers throw if not in fullscreen; ignore silently
  }
}

// Register the FCM service worker
// Works in both dev (localhost) and production (HTTPS)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/firebase-messaging-sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] Registered with scope:', reg.scope);
      })
      .catch((error) => {
        console.error('[SW] Registration failed:', error);
      });
  });
}

// If a lazy chunk/preload fails (stale deploy, flaky mobile network), Vite
// fires 'vite:preloadError'. Reload once to pick up the fresh build — the
// sessionStorage flag prevents a reload loop if the failure persists.
window.addEventListener('vite:preloadError', () => {
  try {
    if (!sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1');
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
});

// Listen for notification click messages from the service worker
// When a user taps a notification, the SW posts a message to focus the tab
// and we navigate to the approval URL
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
      window.location.href = event.data.url;
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
