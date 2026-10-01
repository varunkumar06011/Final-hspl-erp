import { QueryClient } from '@tanstack/react-query';

// Shared singleton so non-React code (logout, project switch) can drop cached
// data. Lives in its own module to avoid import cycles with App.tsx.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Cache data for 30s before considering it stale. Without this every
      // navigation re-fetches even when the data hasn't changed.
      staleTime: 30_000,
      // Keep inactive queries in cache for 5 minutes so back-navigation is instant.
      gcTime: 5 * 60_000,
    },
  },
});
