import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Register the FCM service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('/firebase-messaging-sw.js', { scope: '/' })
    .catch((error) => {
      console.error('[SW] Registration failed:', error);
    });
}

// Listen for notification click messages from the service worker
// When a user taps a notification, the SW posts a message to focus the tab
// and we navigate to the approval URL
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
    window.location.href = event.data.url;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
