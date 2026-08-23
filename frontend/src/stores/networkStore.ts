import { create } from 'zustand';

interface NetworkState {
  /** Set when an API request fails due to a network error (no response). */
  apiNetworkError: boolean;
  setApiNetworkError: (value: boolean) => void;
  clearApiNetworkError: () => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  apiNetworkError: false,
  setApiNetworkError: (value) => set({ apiNetworkError: value }),
  clearApiNetworkError: () => set({ apiNetworkError: false }),
}));
