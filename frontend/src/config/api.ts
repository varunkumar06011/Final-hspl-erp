import axios from 'axios';
import { useNetworkStore } from '../stores/networkStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('firebaseToken');
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
    // Auto-logout is completely disabled per user request.
    // The user stays logged in until they manually click Logout.
    // 401 errors are surfaced to the calling component for handling.

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
    return err.response?.data?.error ?? err.message ?? 'Request failed';
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

export default api;
