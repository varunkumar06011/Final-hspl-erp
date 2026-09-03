import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../config/api';

/**
 * Prefetch a single-record detail endpoint on hover/focus so navigation feels instant.
 *
 * Usage (on a list row that links to a detail page):
 *   const prefetchDetail = usePrefetchDetail('/assets');
 *   <Link to={`/assets/${row.id}`} onMouseEnter={() => prefetchDetail(row.id)}>...</Link>
 *
 * The fetched detail is cached under the key [endpoint, id], matching the
 * convention used by detail pages that call `api.get(`${endpoint}/${id}`)`.
 */
export function usePrefetchDetail(endpoint: string) {
  const queryClient = useQueryClient();

  return useCallback(
    (id: string) => {
      queryClient.prefetchQuery({
        queryKey: [endpoint, id],
        queryFn: async () => {
          const response = await api.get(`${endpoint}/${id}`);
          return response.data;
        },
        // Prefetched data is fresh for 1 minute — enough to cover the click.
        staleTime: 60_000,
      });
    },
    [queryClient, endpoint],
  );
}
