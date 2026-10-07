import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Sync a piece of state with a URL search parameter.
 *
 * Reading: the initial value comes from the URL (or `defaultValue`).
 * Writing: updating the value updates the URL search param in place
 *          (other params are preserved).
 *
 * This makes filter/sort/page state survive refresh and be shareable.
 *
 * @param key        URL search-param key
 * @param defaultValue  fallback when the param is absent
 *
 * Usage:
 *   const [search, setSearch] = useUrlState('search', '');
 *   const [page, setPage] = useUrlState('page', 0, Number);
 */
// react-router's functional setSearchParams reads the params of the LAST RENDER, so two
// URL-state writes in the same tick (e.g. setSearch then setPage) make the second one
// silently drop the first. Writes in one tick build on each other through this value.
let pendingParams: URLSearchParams | null = null;

export function useUrlState<T extends string | number>(
  key: string,
  defaultValue: T,
  parse?: (raw: string) => T,
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(key);
  const value: T = raw !== null
    ? (parse ? parse(raw) : (raw as unknown as T))
    : defaultValue;

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(pendingParams ?? prev);
          if (next === defaultValue || next === '' || next === 0) {
            params.delete(key);
          } else {
            params.set(key, String(next));
          }
          pendingParams = params;
          void Promise.resolve().then(() => { pendingParams = null; });
          return params;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
