import { create } from 'zustand';
import type { UserResponse } from '@hospital-erp/shared';

interface AuthState {
  user: UserResponse | null;
  token: string | null;
  setUser: (user: UserResponse | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: (() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) as UserResponse : null;
    } catch {
      return null;
    }
  })(),
  token: localStorage.getItem('firebaseToken'),
  setUser: (user) => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
    set({ user });
  },
  setToken: (token) => {
    if (token) {
      localStorage.setItem('firebaseToken', token);
    } else {
      localStorage.removeItem('firebaseToken');
    }
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('user');
    set({ user: null, token: null });
  },
  isAuthenticated: () => {
    const state = get();
    return !!state.token && !!state.user;
  },
}));

// ─── Cross-tab sync: when another tab changes auth state in localStorage,
// update the Zustand store so this tab reflects the change immediately.
// Without this, a tab can have stale auth state until a page refresh.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'firebaseToken') {
      useAuthStore.setState({ token: e.newValue });
    }
    if (e.key === 'user') {
      try {
        useAuthStore.setState({ user: e.newValue ? JSON.parse(e.newValue) as UserResponse : null });
      } catch {
        useAuthStore.setState({ user: null });
      }
    }
  });
}
