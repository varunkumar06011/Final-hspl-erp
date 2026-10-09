import { useQuery } from '@tanstack/react-query';
import api from '../config/api';

export type StalledType = 'MPR' | 'QUOTATION' | 'PO' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT_REQUEST';

export interface StalledItem {
  type: StalledType;
  id: string;
  number: string;
  party: string | null;
  since: string;
  waitingFor: string;
}

interface StalledResponse {
  thresholdMinutes: number;
  total: number;
  counts: Record<string, number>;
  items: StalledItem[];
}

/** Approved records still waiting for their next step (procurement chain). */
export function useStalled() {
  const query = useQuery({
    queryKey: ['stalled'],
    queryFn: async () => (await api.get<StalledResponse>('/stalled')).data,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return query;
}

/** Lookup of the stalled mark for one record; `undefined` when it is not stalled. */
export function useStalledItem(type: StalledType, id: string | undefined): StalledItem | undefined {
  const { data } = useStalled();
  if (!id || !data) return undefined;
  return data.items.find((i) => i.type === type && i.id === id);
}
