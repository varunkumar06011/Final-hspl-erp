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

// Suppress the native browser/PWA pull-to-refresh gesture without breaking
// scrolling: preventDefault() only a downward drag while the document is at
// scroll-top (the pull gesture). Normal scrolls move up or start below the
// top, so they are never cancelled. Touches inside an inner scroller that
// can still scroll up (dialogs, lists) are left alone. CSS
// overscroll-behavior was avoided — it freezes scrolling entirely in iOS
// standalone (WebKit bug) and some Android WebViews.
{
  let pullStartY = 0;
  const ancestorCanScrollUp = (target: EventTarget | null): boolean => {
    let node = target instanceof HTMLElement ? target : null;
    while (node && node !== document.body) {
      if (node.scrollTop > 0) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  document.addEventListener('touchstart', (e) => {
    pullStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const scroller = document.scrollingElement ?? document.documentElement;
    if (
      scroller.scrollTop <= 0
      && e.touches[0].clientY > pullStartY
      && !ancestorCanScrollUp(e.target)
      && e.cancelable
    ) {
      e.preventDefault();
    }
  }, { passive: false });
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
