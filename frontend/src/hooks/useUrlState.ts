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
          const params = new URLSearchParams(prev);
          if (next === defaultValue || next === '' || next === 0) {
            params.delete(key);
          } else {
            params.set(key, String(next));
          }
          return params;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
