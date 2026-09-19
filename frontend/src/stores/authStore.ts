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

// localStorage can THROW (iOS standalone WebKit with blocked cookies/storage,
// storage pressure, etc.). A throw during store init kills the whole module
// graph → blank white screen. Every access is wrapped.
const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(key: string) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: (() => {
    try {
      const stored = storage.get('user');
      return stored ? JSON.parse(stored) as UserResponse : null;
    } catch {
      return null;
    }
  })(),
  token: storage.get('firebaseToken'),
  setUser: (user) => {
    if (user) {
      storage.set('user', JSON.stringify(user));
    } else {
      storage.remove('user');
    }
    set({ user });
  },
  setToken: (token) => {
    if (token) {
      storage.set('firebaseToken', token);
    } else {
      storage.remove('firebaseToken');
    }
    set({ token });
  },
  logout: () => {
    storage.remove('firebaseToken');
    storage.remove('user');
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
