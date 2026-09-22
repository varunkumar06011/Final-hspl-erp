import axios from 'axios';
import { useNetworkStore } from '../stores/networkStore';
import { API_BASE_URL } from './appConfig';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    // localStorage can throw on iOS standalone WebKit (blocked storage) —
    // proceed without a token rather than crashing the request.
    let token: string | null = null;
    try {
      token = localStorage.getItem('firebaseToken');
    } catch { /* storage unavailable */ }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 with a stored token means the token is expired/invalid — every
    // request will keep failing, so staying "logged in" just hangs the app on
    // dead data. Clear it and send the user to login once.
    if (error.response?.status === 401) {
      try {
        if (localStorage.getItem('firebaseToken')) {
          localStorage.removeItem('firebaseToken');
          localStorage.removeItem('user');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      } catch { /* storage unavailable — ProtectedRoute handles it */ }
    }

    if (error.code === 'ECONNABORTED') {
      error.message = 'Request timed out. Please try again.';
    } else if (!error.response) {
      error.message = 'Network error. Please check your connection.';
      useNetworkStore.getState().setApiNetworkError(true);
    }

    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data?.details && Array.isArray(data.details) && data.details.length > 0) {
      const detail = data.details[0];
      const field = detail.path ? `[${detail.path}] ` : '';
      return `${data.error}: ${field}${detail.message}`;
    }
    return data?.error ?? err.message ?? 'Request failed';
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

export default api;
