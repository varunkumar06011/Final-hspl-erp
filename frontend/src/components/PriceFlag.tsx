import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Divider, Popover, Stack, Typography } from '@mui/material';
import { TrendingDown, TrendingFlat, TrendingUp } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { comparePrice } from '@hospital-erp/shared';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { dateLocale } from '../i18n';

export interface PriceLine {
  itemId?: string | null;
  materialName?: string | null;
  specification?: string | null;
  unit?: string | null;
}

interface PriceEntry {
  source: 'PO' | 'QUOTATION' | 'REQUEST';
  rate: number;
  unit: string | null;
  date: string;
  vendorName: string | null;
  docNumber: string;
  projectCode: string;
}

interface VendorPrice {
  vendorName: string;
  latestRate: number;
  latestDate: string;
  lowestRate: number;
  count: number;
  projectCodes: string[];
}

export interface PriceCheckResult {
  last: PriceEntry | null;
  vendors: VendorPrice[];
  bestVendor: string | null;
  history: PriceEntry[];
}

export interface PriceExclude {
  poId?: string | null;
  quotationId?: string | null;
  mprId?: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Last price paid (and every vendor's price) for each line, from every project. Rates are
 * compared on screen, so typing a rate never calls the server; only a changed item, spec or
 * unit does (debounced).
 */
export function usePriceCheck(lines: PriceLine[], exclude: PriceExclude = {}, enabled = true): Array<PriceCheckResult | null> {
  // A string key, so a new array with the same lines does not restart the debounce.
  const key = JSON.stringify(
    lines.map((l) => ({ itemId: l.itemId || null, materialName: l.materialName?.trim() || null, specification: l.specification?.trim() || null, unit: l.unit || null })),
  );
  const debouncedKey = useDebounced(key, 500);
  const debounced = useMemo(() => JSON.parse(debouncedKey) as PriceLine[], [debouncedKey]);
  const wanted = debounced.some((l) => l.itemId || l.materialName);
  const { data } = useQuery({
    queryKey: ['/catalog/price-check', debouncedKey, exclude.poId ?? null, exclude.quotationId ?? null, exclude.mprId ?? null],
    queryFn: async () => (await api.post('/catalog/price-check', { lines: debounced, exclude })).data.data as PriceCheckResult[],
    enabled: enabled && wanted,
    staleTime: 60_000,
  });
  return lines.map((_, i) => (data && debounced.length === lines.length ? data[i] ?? null : null));
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: '2-digit' });

/**
 * The price flag on a line: compares the rate with the last price paid for the same item +
 * spec. Red when it went up, green when it came down; a click shows every vendor's price and
 * which one is cheapest. Warns only, never blocks.
 */
export default function PriceFlag({ result, rate, unit }: { result: PriceCheckResult | null; rate?: number | string | null; unit?: string | null }) {
  const { t } = useTranslation('catalog');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!result?.last) return null;
  const last = result.last;
  const value = Number(rate);
  const cmp = value > 0 ? comparePrice(value, last.rate) : null;
  const per = last.unit || unit ? `/${last.unit || unit}` : '';

  const color = cmp?.direction === 'UP' ? 'error' : cmp?.direction === 'DOWN' ? 'success' : 'default';
  const Icon = cmp?.direction === 'UP' ? TrendingUp : cmp?.direction === 'DOWN' ? TrendingDown : TrendingFlat;
  const label = cmp && cmp.direction !== 'SAME'
    ? t(cmp.direction === 'UP' ? 'priceUp' : 'priceDown', {
        diff: formatCurrency(Math.abs(cmp.difference)),
        pct: Math.abs(cmp.percent),
        last: `${formatCurrency(last.rate)}${per}`,
      })
    : t('lastPrice', { last: `${formatCurrency(last.rate)}${per}` });

  return (
    <>
      <Chip
        size="small"
        variant={cmp?.direction === 'UP' ? 'filled' : 'outlined'}
        color={color}
        icon={<Icon fontSize="small" />}
        label={label}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{ mt: 0.5, maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
      />
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 2, maxWidth: 360 }}>
          <Typography variant="subtitle2">{t('lastPaidTitle')}</Typography>
          <Typography variant="body2">
            {formatCurrency(last.rate)}{per} · {last.vendorName ?? t('noVendor')} · {last.docNumber} · {fmtDate(last.date)}
          </Typography>
          <Typography variant="caption" color="text.secondary">{t(`source.${last.source}`)}</Typography>
          {result.vendors.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2">{t('vendorPrices')}</Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {result.vendors.map((v) => (
                  <Box key={v.vendorName} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: v.vendorName === result.bestVendor ? 700 : 400 }}>
                      {v.vendorName}
                      {v.vendorName === result.bestVendor ? ` · ${t('cheapest')}` : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                      {formatCurrency(v.latestRate)}{per}
                      {v.lowestRate < v.latestRate ? ` (${t('lowest', { rate: formatCurrency(v.lowestRate) })})` : ''}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </>
          )}
          {result.history.length > 1 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2">{t('history')}</Typography>
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                {result.history.slice(0, 8).map((h, i) => (
                  <Typography key={`${h.docNumber}-${i}`} variant="caption" color="text.secondary">
                    {fmtDate(h.date)} · {formatCurrency(h.rate)}{h.unit ? `/${h.unit}` : ''} · {h.vendorName ?? t('noVendor')} · {h.docNumber}
                  </Typography>
                ))}
              </Stack>
            </>
          )}
        </Box>
      </Popover>
    </>
  );
}

/** Price flag for one line on a read-only screen (detail / approval views). */
export function LinePriceFlag({ line, rate, exclude }: { line: PriceLine; rate?: number | string | null; exclude?: PriceExclude }) {
  const [result] = usePriceCheck([line], exclude);
  return <PriceFlag result={result} rate={rate} unit={line.unit} />;
}
