import { queryClient } from '../config/queryClient';

/**
 * Everything the client remembers about a project/user lives here so that logging
 * out or switching project can't leak one project's data into another.
 * (Device preferences — language, colour mode — are deliberately kept.)
 */
const PERSISTED_KEYS = [
  'dashboard-cache-v1',
  'mpr_form_draft',
  'mpr_department_history',
  'hspl-recently-viewed',
  'hspl-rev-seen',
];
const SESSION_KEYS = ['pushDeepLink', 'po-approval-dismissed', 'invoice-approval-dismissed'];

const extraCleanups: Array<() => void> = [];

/** Modules that hold live state (e.g. the presence socket) register a teardown here. */
export function registerSessionCleanup(fn: () => void): void {
  extraCleanups.push(fn);
}

/** Wipe project-scoped data persisted in the browser (safe if storage is blocked). */
export function clearPersistedProjectData(): void {
  for (const key of PERSISTED_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
  for (const key of SESSION_KEYS) {
    try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
}

/** Drop cached server data, persisted snapshots and live connections. */
export function resetClientState(): void {
  queryClient.clear();
  clearPersistedProjectData();
  for (const fn of extraCleanups) {
    try { fn(); } catch { /* best effort */ }
  }
}
