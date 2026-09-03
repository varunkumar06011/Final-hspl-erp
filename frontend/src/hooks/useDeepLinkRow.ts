import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../config/api';

/**
 * Deep-link from global search: when the URL contains ?id=<entityId>,
 * ensure that entity is visible in the list, then scroll to it and
 * highlight it briefly.
 *
 * If the entity is already in the current page's rows, just highlight.
 * If not (e.g. it's on page 5 or filtered out), fetch it by ID, set the
 * search filter to its identifier so the list filters down to show it,
 * then highlight once the filtered list loads.
 *
 * @param endpoint   API list endpoint (e.g. '/purchase-orders')
 * @param rows       Current page's loaded rows
 * @param idField    Field name on the entity to use as the search term
 * @param setSearch  Setter for the page's search filter state
 *
 * Returns: { highlightId, rowRef } — highlightId is the ID to highlight
 * (or null). Pass rowRef to the TableRow's ref for auto-scroll.
 */
export function useDeepLinkRow<T extends { id: string }>(
  endpoint: string,
  rows: T[] | undefined,
  idField: keyof T & string,
  setSearch: (value: string) => void,
): { highlightId: string | null; rowRef: (id: string) => (el: HTMLElement | null) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const rowRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // Scroll to highlighted row
  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightId, rows]);

  useEffect(() => {
    const targetId = searchParams.get('id');
    if (!targetId) return;

    // Already in current rows? Just highlight.
    if (rows && rows.length > 0) {
      const match = rows.find((r) => r.id === targetId);
      if (match) {
        setHighlightId(targetId);
        searchParams.delete('id');
        setSearchParams(searchParams, { replace: true });
        return;
      }
    }

    // Not in current rows — fetch the entity by ID, then set search
    // to its identifier so the list filters to show it.
    if (pendingIdRef.current === targetId) return;
    pendingIdRef.current = targetId;

    api.get(`${endpoint}/${targetId}`)
      .then((res) => {
        const entity = res.data as Record<string, unknown>;
        const identifier = String(entity[idField] ?? '');
        if (identifier) {
          setSearch(identifier);
        }
        // Highlight once the filtered list re-renders with this row
        setHighlightId(targetId);
      })
      .catch(() => {
        // Entity not found — just clear the param
      })
      .finally(() => {
        searchParams.delete('id');
        setSearchParams(searchParams, { replace: true });
        pendingIdRef.current = null;
      });
  }, [searchParams, setSearchParams, rows, endpoint, idField, setSearch]);

  return { highlightId, rowRef };
}
