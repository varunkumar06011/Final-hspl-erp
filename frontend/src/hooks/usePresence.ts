import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { API_BASE_URL } from '../config/appConfig';

export interface PresenceUser {
  userId: string;
  userName: string;
  userRole: string;
  page: string;
  timestamp: number;
}

let socket: Socket | null = null;
let socketPromise: Promise<Socket | null> | null = null;

// socket.io-client is lazy-imported — presence is non-critical and the
// ~60KB module shouldn't block app boot (iOS Home Screen cold starts).
async function getSocket(): Promise<Socket | null> {
  if (socket) return socket;
  if (socketPromise) return socketPromise;
  socketPromise = (async () => {
    if (socket) return socket;
    const { io } = await import('socket.io-client');
    return createSocket(io);
  })();
  return socketPromise;
}

function createSocket(io: typeof import('socket.io-client').io): Socket | null {
  if (socket) return socket;
  const apiUrl = API_BASE_URL;
  // Socket.io connects to the default namespace ("/"), so strip any path
  // (e.g. the "/api" suffix used by the REST client) and keep only the origin.
  let socketUrl = apiUrl;
  try {
    const u = new URL(apiUrl);
    socketUrl = u.origin;
  } catch {
    // apiUrl is not a full URL (e.g. "/api") — fall back to current origin.
    socketUrl = window.location.origin;
  }
  let token: string | null = null;
  try {
    token = localStorage.getItem('firebaseToken');
  } catch {
    return null;
  }
  if (!token) return null;
  socket = io(socketUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
  });
  return socket;
}

/**
 * Tracks which users are currently viewing the same page as the current user.
 * Broadcasts presence via Socket.io and listens for updates.
 */
export function usePresence() {
  const location = useLocation();
  const { user } = useAuthStore();
  const [viewers, setViewers] = useState<PresenceUser[]>([]);
  const currentPageRef = useRef<string>('');

  useEffect(() => {
    let s: Socket | null = null;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const page = location.pathname;
    if (!user) return;

    void getSocket().then((resolved) => {
      if (cancelled || !resolved) return;
      s = resolved;

      const emitJoin = () => {
        // Leave previous page
        if (currentPageRef.current && currentPageRef.current !== page) {
          s!.emit('presence:leave', { page: currentPageRef.current });
        }
        // Join new page
        currentPageRef.current = page;
        s!.emit('presence:join', {
          page,
          userName: user.name,
          userRole: user.role,
        });
      };

      // If socket is already connected, emit immediately.
      // Otherwise wait for the 'connect' event.
      if (s.connected) {
        emitJoin();
      } else {
        s.once('connect', emitJoin);
      }

      // Listen for presence updates
      const handleUpdate = (data: { page: string; viewers: PresenceUser[] }) => {
        if (data.page === page) {
          // Filter out self
          setViewers(data.viewers.filter((v) => v.userId !== user.id));
        }
      };

      s.on('presence:update', handleUpdate);

      cleanup = () => {
        s!.off('presence:update', handleUpdate);
        s!.off('connect', emitJoin);
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [location.pathname, user]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket && currentPageRef.current) {
        socket.emit('presence:leave', { page: currentPageRef.current });
      }
    };
  }, []);

  // Other users viewing the same page (excluding self)
  const otherViewers = viewers.filter((v) => v.page === location.pathname);

  return { viewers: otherViewers };
}
