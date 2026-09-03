import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads URL search params on mount and applies them to the page's
 * filter state via the provided setters. This enables deep-linking
 * from the Natural Language Query Bar.
 *
 * Only reads params that are present in the URL — won't overwrite
 * existing state if the param is absent.
 *
 * @param mapping Object mapping URL param names to setter functions.
 */
export function useUrlFilters(mapping: Record<string, (value: string) => void>) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let applied = false;
    for (const [param, setter] of Object.entries(mapping)) {
      const value = searchParams.get(param);
      if (value !== null && value !== '') {
        setter(value);
        applied = true;
      }
    }
    // Clean up the URL after applying so it doesn't re-trigger on navigation
    if (applied) {
      const newParams = new URLSearchParams(searchParams);
      // Keep `id` (used by useDeepLinkRow) but remove filter params
      Object.keys(mapping).forEach((p) => newParams.delete(p));
      setSearchParams(newParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
