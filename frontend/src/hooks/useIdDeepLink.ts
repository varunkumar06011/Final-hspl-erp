import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Deep-link from global search: when the URL contains ?id=<entityId>,
 * find the matching row and call onMatch. Then clear the param so it
 * doesn't re-trigger on refresh.
 *
 * Used by list pages (Ledgers, Vendors, POs, etc.) to open the detail
 * dialog for a specific record when navigated from GlobalSearch.
 */
export function useIdDeepLink<T extends { id: string }>(
  rows: T[] | undefined,
  onMatch: (row: T) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const targetId = searchParams.get('id');
    if (!targetId || !rows || rows.length === 0) return;
    const match = rows.find((row) => row.id === targetId);
    if (match) {
      onMatch(match);
      searchParams.delete('id');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, rows, onMatch]);
}
