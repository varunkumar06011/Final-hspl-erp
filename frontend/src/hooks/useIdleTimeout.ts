import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

const IDLE_MS = 15 * 60 * 1000; // 15 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // check every 30s
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

/**
 * Logs the user out after `IDLE_MS` of inactivity. Resets the timer on any
 * user interaction (mouse, keyboard, touch, scroll). Cross-tab: activity in
 * one tab refreshes the shared `lastActivity` timestamp in localStorage so a
 * second open tab does not log out while the user is active in the first.
 *
 * Mounted once inside AppShell so it only runs for authenticated sessions.
 */
export function useIdleTimeout(): void {
  const logout = useAuthStore((s) => s.logout);
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    const recordActivity = () => {
      lastActivity.current = Date.now();
      localStorage.setItem('lastActivity', String(lastActivity.current));
    };

    // Initialise from shared timestamp (in case another tab is already active).
    const shared = localStorage.getItem('lastActivity');
    lastActivity.current = shared ? Number(shared) : Date.now();

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

    const interval = window.setInterval(() => {
      const sharedNow = Number(localStorage.getItem('lastActivity') ?? lastActivity.current);
      const idleFor = Date.now() - sharedNow;
      if (idleFor >= IDLE_MS) {
        window.clearInterval(interval);
        logout();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
    };
  }, [logout]);
}
