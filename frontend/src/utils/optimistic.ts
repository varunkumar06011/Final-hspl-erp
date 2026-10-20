import { useCallback } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../config/api';
import { useToast } from '../components/ToastProvider';

/**
 * Optimistic updates for list caches: the screen changes the moment the user
 * clicks, the request runs behind it, and a refused request puts the cache back.
 *
 *   onMutate: (vars) => optimistic(queryClient, ['/issues'], patchRow(vars.id, { status: 'CLOSED' })),
 *   onError: (err, _vars, snapshot) => { rollback(queryClient, snapshot); setError(...) },
 *   onSettled: () => queryClient.invalidateQueries({ queryKey: ['/issues'] }),
 *
 * List caches are either a plain array or `{ data: Row[], pagination }`; any other
 * cache under the same key (a detail record, a summary) is left untouched.
 */

/** Set on a row the server has not confirmed yet: dimmed and not clickable (index.css). */
export const PENDING = '__pending';

type Row = Record<string, unknown>;
/** `activeOnly`: touch only lists on screen now (the rest refetch when next shown). */
type RowsFn = ((rows: Row[]) => Row[]) & { activeOnly?: boolean };
export type Snapshot = [QueryKey, unknown][];

function mapRows(data: unknown, fn: RowsFn): unknown {
  if (Array.isArray(data)) return fn(data as Row[]);
  const list = (data as { data?: unknown } | null | undefined)?.data;
  if (Array.isArray(list)) return { ...(data as object), data: fn(list as Row[]) };
  return data;
}

/** Apply `fn` to every list cached under `keys` (prefix match); returns what to roll back to. */
export async function optimistic(qc: QueryClient, keys: QueryKey | QueryKey[], fn: RowsFn): Promise<Snapshot> {
  const list = (Array.isArray(keys[0]) ? keys : [keys]) as QueryKey[];
  await Promise.all(list.map((queryKey) => qc.cancelQueries({ queryKey })));
  const filters = (queryKey: QueryKey) => ({ queryKey, ...(fn.activeOnly && { type: 'active' as const }) });
  const snapshot = list.flatMap((queryKey) => qc.getQueriesData(filters(queryKey)));
  list.forEach((queryKey) => qc.setQueriesData(filters(queryKey), (old: unknown) => mapRows(old, fn)));
  return snapshot;
}

/** Put the caches back as they were before `optimistic` (pass the onError context). */
export function rollback(qc: QueryClient, snapshot: Snapshot | undefined): void {
  snapshot?.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
}

/** Change one row in place (marked pending until the refetch replaces it). */
export const patchRow =
  (id: unknown, patch: Row): RowsFn =>
  (rows) =>
    rows.map((r) => (r.id === id ? { ...r, ...patch, [PENDING]: true } : r));

/** Take one row out of the list. */
export const removeRow =
  (id: unknown): RowsFn =>
  (rows) =>
    rows.filter((r) => r.id !== id);

/**
 * Show a new row until the server's copy arrives: at the top (newest-first lists) or at
 * the end (oldest-first, e.g. comments). Only lists on screen get it, so a picker's
 * cached list elsewhere never offers a record that does not exist yet.
 */
export const insertRow = (row: Row, at: 'start' | 'end' = 'start'): RowsFn =>
  Object.assign(
    (rows: Row[]) => {
      const added = { createdAt: new Date().toISOString(), ...row, id: `pending-${Date.now()}`, [PENDING]: true };
      return at === 'end' ? [...rows, added] : [added, ...rows];
    },
    { activeOnly: true },
  );

/** Spread on a row element so a pending row is dimmed and inert. */
export const pendingProps = (row: unknown) =>
  (row as Row | null)?.[PENDING] ? { 'data-pending': 'true' } : {};

/**
 * The same, bound to this screen: `apply` in onMutate, `undo` in onError (puts the
 * caches back and tells the user the save failed, with the server's reason), or
 * `restore` when a reopened dialog shows the error instead.
 */
export function useOptimistic() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const apply = useCallback((keys: QueryKey | QueryKey[], fn: RowsFn) => optimistic(qc, keys, fn), [qc]);
  const undo = useCallback(
    (snapshot: Snapshot | undefined, err: unknown) => {
      rollback(qc, snapshot);
      toast.error(t('optimistic.notSaved', { error: extractErrorMessage(err) }));
    },
    [qc, toast, t],
  );
  /** Roll back without the toast, for a dialog that reopens and shows the error itself. */
  const restore = useCallback((snapshot: Snapshot | undefined) => rollback(qc, snapshot), [qc]);
  return { apply, undo, restore };
}
