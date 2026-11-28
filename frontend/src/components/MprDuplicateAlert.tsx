import { useEffect, useState } from 'react';
import { Alert, Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../config/api';
import { formatDate } from '../utils/enumOptions';

export interface MprDuplicateMatch {
  level: 'DUPLICATE' | 'POSSIBLE';
  reason: 'SAME_LINES' | 'SAME_TOTAL' | 'SOME_LINES';
  mprId: string;
  mprNumber: string;
  date: string;
  total: number;
  matchedLines: string[];
  purchaseOrders: { id: string; poNumber: string; status: string }[];
  paidAmount: number;
}

export interface MprDuplicateResult {
  level: 'NONE' | 'POSSIBLE' | 'DUPLICATE';
  times: number;
  matches: MprDuplicateMatch[];
  loosePayments: { code: string; amount: number; poNumber: string | null }[];
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "Entered twice" / "Possible duplicate" box: which earlier request it repeats, its PO, and what was paid. */
export function MprDuplicateAlert({ result }: { result?: MprDuplicateResult | null }) {
  const { t } = useTranslation('mpr');
  if (!result || (result.level === 'NONE' && !result.loosePayments.length)) return null;
  const title = result.level === 'DUPLICATE' ? (result.times === 2 ? t('dupTwice') : t('dupTimes', { count: result.times })) : result.level === 'POSSIBLE' ? t('dupPossible') : t('dupPaymentOnly');
  return (
    <Alert severity={result.level === 'DUPLICATE' ? 'error' : 'warning'} sx={{ mb: 2 }} data-testid="mpr-duplicate-alert">
      <Box sx={{ fontWeight: 700 }}>{title}</Box>
      {result.matches.slice(0, 3).map((m) => (
        <Box key={m.mprId} sx={{ mt: 0.5 }}>
          {`${m.mprNumber} · ${formatDate(m.date)} · ${inr(m.total)} — `}
          {m.reason === 'SAME_LINES' ? t('dupSameLines') : m.reason === 'SAME_TOTAL' ? t('dupSameTotal') : t('dupSomeLines', { lines: m.matchedLines.join(', ') })}
          {m.purchaseOrders.length > 0 && `. ${t('dupPo', { pos: m.purchaseOrders.map((p) => p.poNumber).join(', ') })}`}
          {`. ${m.paidAmount > 0 ? t('dupPaid', { amount: inr(m.paidAmount) }) : t('dupNotPaid')}`}
        </Box>
      ))}
      {result.loosePayments.length > 0 && (
        <Box sx={{ mt: 0.5 }}>{t('dupLoose', { codes: result.loosePayments.map((p) => p.code).join(', ') })}</Box>
      )}
    </Alert>
  );
}

/** The duplicate verdict for a saved request (loaded when its details are opened). */
export function useSavedMprDuplicates(id: string | null) {
  return useQuery<MprDuplicateResult>({
    queryKey: ['mpr-duplicates', id],
    queryFn: async () => (await api.get(`/material-purchase-requests/${id}/duplicates`)).data,
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Shown inside an opened request: nothing while loading or when there is no repeat. */
export function SavedMprDuplicate({ id }: { id: string }) {
  const { data } = useSavedMprDuplicates(id);
  return <MprDuplicateAlert result={data} />;
}

interface FormLine { materialName: string; itemId?: string | null; specification?: string; quantity: string | number; unit?: string; estimatedRate?: string | number; gstRate?: string | number | null }

/** The duplicate verdict while a request is being typed: re-asked 0.8 s after the vendor or lines stop changing. */
export function useFormMprDuplicates(args: { enabled: boolean; vendorId: string | null; requestType: string; excludeId?: string | null; items: FormLine[] }) {
  const lines = args.items
    .filter((i) => i.materialName.trim() && Number(i.quantity) > 0)
    .map((i) => ({
      itemId: i.itemId || undefined,
      materialName: i.materialName.trim(),
      specification: i.specification || undefined,
      quantity: Number(i.quantity),
      unit: i.unit || undefined,
      estimatedRate: Number(i.estimatedRate) > 0 ? Number(i.estimatedRate) : 0,
      gstRate: i.gstRate != null && i.gstRate !== '' ? Number(i.gstRate) || 0 : undefined,
    }));
  const key = JSON.stringify({ v: args.vendorId, t: args.requestType, x: args.excludeId, lines });
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), 800);
    return () => clearTimeout(timer);
  }, [key]);
  return useQuery<MprDuplicateResult>({
    queryKey: ['mpr-duplicate-check', settled],
    queryFn: async () => {
      const { v, t, x, lines: l } = JSON.parse(settled);
      return (await api.post('/material-purchase-requests/duplicate-check', { vendorId: v, requestType: t, excludeId: x || undefined, items: l })).data;
    },
    enabled: args.enabled && !!args.vendorId && lines.length > 0,
    staleTime: 15_000,
  });
}
