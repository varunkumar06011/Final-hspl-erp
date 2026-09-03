import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';

export interface PresenceUser {
  userId: string;
  userName: string;
  userRole: string;
  page: string;
  timestamp: number;
}

let socket: Socket | null = null;

function getSocket(): Socket | null {
  if (socket) return socket;
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const token = localStorage.getItem('firebaseToken');
  if (!token) return null;
  socket = io(apiUrl, {
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
    const s = getSocket();
    if (!s || !user) return;

    const page = location.pathname;

    const emitJoin = () => {
      // Leave previous page
      if (currentPageRef.current && currentPageRef.current !== page) {
        s.emit('presence:leave', { page: currentPageRef.current });
      }
      // Join new page
      currentPageRef.current = page;
      s.emit('presence:join', {
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

    return () => {
      s.off('presence:update', handleUpdate);
      s.off('connect', emitJoin);
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
