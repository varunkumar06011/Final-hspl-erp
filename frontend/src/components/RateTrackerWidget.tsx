import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Skeleton,
  Alert,
  Stack,
  Link,
} from '@mui/material';
import { TrendingUp, TrendingDown, TrendingFlat } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';

// ── Types matching the backend GET /dashboard/rate-tracker response ──
interface RateTrackerMaterial {
  materialName: string;
  unit: string | null;
  previousRate: number;
  latestRate: number;
  difference: number;
  percentChange: number;
  previousDate: string;
  latestDate: string;
  previousVendor: string;
  latestVendor: string;
  previousDocType: string;
  latestDocType: string;
  previousDocNumber: string;
  latestDocNumber: string;
  entryCount: number;
}

interface RateTrackerResponse {
  summary: {
    totalMaterialsTracked: number;
    totalWithChange: number;
    increased: number;
    decreased: number;
  };
  materials: RateTrackerMaterial[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function docRoute(docType: string): string | null {
  if (docType === 'PO') return '/pos';
  if (docType === 'QUOTATION') return '/quotations';
  return null;
}

// Dark palette — this widget renders only inside the dark dashboard theme.
const D = {
  card: '#141f31',
  border: 'rgba(148, 163, 184, 0.12)',
  text: '#e8edf7',
  dim: '#8b98ad',
  teal: '#2fd9a4',
  red: '#ff5c7a',
};
// SF Pro on Apple devices for numeric cells.
const NUM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Material Rate Tracker widget — compact version.
 * Shows the previous cost vs the latest cost for every material that has
 * appeared on more than one Quotation or PO. Read-only dashboard add-on.
 */
export default function RateTrackerWidget() {
  // Always sort by % increase (default) — toggle removed per request
  const sort = 'inc';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/dashboard', 'rate-tracker', sort],
    queryFn: async () => {
      const response = await api.get<RateTrackerResponse>('/dashboard/rate-tracker', {
        params: { limit: 50, sort },
      });
      return response.data;
    },
  });

  const materials = data?.materials ?? [];
  const summary = data?.summary;

  return (
    <Card sx={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: D.card, border: `1px solid ${D.border}`, borderRadius: 2.5, boxShadow: 'none' }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Compact header — icon square + title + summary chips inline */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: '#f7b955', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TrendingUp sx={{ fontSize: 18, color: '#fff' }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: D.text, lineHeight: 1.15 }}>
                Material Rate Tracker
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: D.dim }}>Track material price changes</Typography>
            </Box>
          </Stack>
          {!isLoading && summary && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
              <Chip size="small" variant="outlined" icon={<TrendingUp sx={{ fontSize: 14, color: D.red }} />} label={`${summary.increased} up`} sx={{ height: 20, fontSize: '0.65rem', color: D.red, borderColor: 'rgba(255,92,122,.4)' }} />
              <Chip size="small" variant="outlined" icon={<TrendingDown sx={{ fontSize: 14, color: D.teal }} />} label={`${summary.decreased} down`} sx={{ height: 20, fontSize: '0.65rem', color: D.teal, borderColor: 'rgba(47,217,164,.4)' }} />
              <Chip size="small" variant="outlined" label={`${summary.totalWithChange} tracked`} sx={{ height: 20, fontSize: '0.65rem', color: D.dim, borderColor: D.border }} />
            </Stack>
          )}
        </Stack>

        {isError && (
          <Alert severity="warning" sx={{ mb: 1, py: 0.5 }}>
            Could not load rate tracker data.
          </Alert>
        )}

        {isLoading ? (
          <Box>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rectangular" height={28} sx={{ mb: 0.5, bgcolor: 'rgba(148,163,184,.12)' }} />
            ))}
          </Box>
        ) : materials.length === 0 ? (
          <Typography variant="caption" sx={{ color: D.dim }}>
            No rate changes yet. Materials appear here once they show up on more than one Quotation or PO.
          </Typography>
        ) : (
          // Stacked material rows — the whole record fits the card width; the
          // list scrolls vertically instead of sliding the table sideways.
          <Box sx={{ flex: 1, maxHeight: 200, overflowY: 'auto', pr: 0.3, '&::-webkit-scrollbar': { width: 5 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(148,163,184,.3)', borderRadius: 3 } }}>
            <Stack spacing={0.7}>
              {materials.map((m, idx) => {
                const increased = m.difference > 0;
                const decreased = m.difference < 0;
                const pctColor = increased ? D.red : decreased ? D.teal : D.dim;
                const TrendIcon = increased ? TrendingUp : decreased ? TrendingDown : TrendingFlat;
                const latestDocRoute = docRoute(m.latestDocType);
                return (
                  <Box key={`${m.materialName}-${idx}`} sx={{ px: 1, py: 0.8, borderRadius: 1.6, bgcolor: 'rgba(148,163,184,.05)', border: `1px solid ${D.border}` }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: D.text }} noWrap title={m.materialName}>
                          {m.materialName}
                        </Typography>
                        {m.unit && <Typography sx={{ fontSize: '0.58rem', color: D.dim }}>per {m.unit}</Typography>}
                      </Box>
                      <Chip
                        size="small"
                        icon={<TrendIcon sx={{ fontSize: 12, color: pctColor }} />}
                        label={`${m.percentChange > 0 ? '+' : ''}${m.percentChange.toFixed(1)}%`}
                        sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, color: pctColor, fontFamily: NUM_FONT, bgcolor: increased ? 'rgba(255,92,122,.12)' : decreased ? 'rgba(47,217,164,.12)' : 'rgba(148,163,184,.12)', flexShrink: 0 }}
                      />
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.7} sx={{ mt: 0.5, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: D.dim, fontFamily: NUM_FONT }} noWrap>{formatCurrency(m.previousRate)}</Typography>
                      <Typography sx={{ fontSize: '0.7rem', color: pctColor, fontWeight: 800 }}>→</Typography>
                      <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: pctColor, fontFamily: NUM_FONT }} noWrap>{formatCurrency(m.latestRate)}</Typography>
                      <Typography sx={{ fontSize: '0.62rem', color: pctColor, fontFamily: NUM_FONT, ml: 'auto' }} noWrap>
                        {m.difference > 0 ? '+' : ''}{formatCurrency(m.difference)}
                      </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: '0.6rem', color: D.dim, mt: 0.4 }} noWrap title={`${m.latestVendor} · ${m.latestDocType} ${m.latestDocNumber} · ${formatDate(m.latestDate)}`}>
                      {m.latestVendor} · {latestDocRoute ? (
                        <Link href={latestDocRoute} underline="hover" sx={{ color: '#4f9cf9', fontSize: '0.6rem' }}>{m.latestDocType} {m.latestDocNumber}</Link>
                      ) : `${m.latestDocType} ${m.latestDocNumber}`} · {formatDate(m.latestDate)}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
