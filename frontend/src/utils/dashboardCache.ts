/**
 * Dashboard query-cache persistence (stale-while-revalidate).
 *
 * The dashboard's data waits on the backend, which on mobile/PWA cold starts
 * can take seconds — the screen sits on skeletons every relaunch because the
 * in-memory query cache dies with the app.
 *
 * hydrateDashboardCache() restores the last successful dashboard responses
 * into the query cache BEFORE the dashboard mounts, so the page renders
 * instantly with the previous data. Entries are seeded with their original
 * savedAt timestamp, so they're immediately "stale" and React Query refetches
 * in the background — fresh data swaps in when it arrives.
 *
 * watchDashboardCache() writes successful /dashboard results back to
 * localStorage (debounced) so the next launch has a snapshot to hydrate from.
 *
 * Scoped to '/dashboard' query keys only — statements/exports are too large
 * for localStorage and are rarely viewed repeatedly.
 */

import type { QueryClient } from '@tanstack/react-query';

const STORAGE_KEY = 'dashboard-cache-v1';
const KEY_PREFIX = '/dashboard';
// Snapshots older than this are dropped — very stale numbers are worse than
// a loading state.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  savedAt: number;
  entries: Array<[readonly unknown[], unknown]>;
}

export function hydrateDashboardCache(queryClient: QueryClient): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return; // storage blocked (iOS standalone) — skip silently
  }
  if (!raw) return;
  try {
    const { savedAt, entries } = JSON.parse(raw) as Snapshot;
    if (!savedAt || Date.now() - savedAt > MAX_AGE_MS || !Array.isArray(entries)) return;
    for (const [queryKey, data] of entries) {
      if (!Array.isArray(queryKey) || queryKey[0] !== KEY_PREFIX) continue;
      // updatedAt = savedAt → data is stale → mounts refetch in background.
      queryClient.setQueryData(queryKey, data, { updatedAt: savedAt });
    }
  } catch { /* corrupt snapshot — ignore */ }
}

export function watchDashboardCache(queryClient: QueryClient): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  queryClient.getQueryCache().subscribe((event) => {
    const query = event?.query;
    if (!query || event.type !== 'updated') return;
    if (query.queryKey[0] !== KEY_PREFIX || query.state.status !== 'success') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const entries = queryClient
          .getQueryCache()
          .getAll()
          .filter((q) => q.queryKey[0] === KEY_PREFIX && q.state.status === 'success')
          .map((q): [readonly unknown[], unknown] => [q.queryKey, q.state.data]);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
      } catch { /* quota/storage blocked — skip */ }
    }, 500);
  });
}
