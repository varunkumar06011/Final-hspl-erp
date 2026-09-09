import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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

/**
 * Material Rate Tracker widget — compact version.
 * Shows the previous cost vs the latest cost for every material that has
 * appeared on more than one Quotation or PO. Read-only dashboard add-on.
 */
export default function RateTrackerWidget() {
  // Always sort by % increase (default) — toggle removed per request
  const sort = 'inc';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/dashboard/rate-tracker', sort],
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
    <Card sx={{ overflow: 'hidden' }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        {/* Compact header — title + summary chips inline */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Material Rate Tracker
          </Typography>
          {!isLoading && summary && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
              <Chip size="small" color="error" variant="outlined" icon={<TrendingUp sx={{ fontSize: 14 }} />} label={`${summary.increased} up`} sx={{ height: 20, fontSize: '0.65rem' }} />
              <Chip size="small" color="success" variant="outlined" icon={<TrendingDown sx={{ fontSize: 14 }} />} label={`${summary.decreased} down`} sx={{ height: 20, fontSize: '0.65rem' }} />
              <Chip size="small" color="default" variant="outlined" label={`${summary.totalWithChange} tracked`} sx={{ height: 20, fontSize: '0.65rem' }} />
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
              <Skeleton key={i} variant="rectangular" height={28} sx={{ mb: 0.5 }} />
            ))}
          </Box>
        ) : materials.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No rate changes yet. Materials appear here once they show up on more than one Quotation or PO.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 220, overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Material</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Previous</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Latest</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Change</TableCell>
                  <TableCell align="right" sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>%</TableCell>
                  <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Vendor</TableCell>
                  <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Doc</TableCell>
                  <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.7rem' }}>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {materials.map((m, idx) => {
                  const increased = m.difference > 0;
                  const decreased = m.difference < 0;
                  const pctColor = increased ? 'error' : decreased ? 'success' : 'default';
                  const TrendIcon = increased ? TrendingUp : decreased ? TrendingDown : TrendingFlat;
                  const latestDocRoute = docRoute(m.latestDocType);
                  return (
                    <TableRow key={`${m.materialName}-${idx}`} hover>
                      <TableCell sx={{ py: 0.5, fontSize: '0.75rem' }}>
                        <Typography variant="caption" fontWeight={600} noWrap>
                          {m.materialName}
                        </Typography>
                        {m.unit && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            per {m.unit}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{formatCurrency(m.previousRate)}</TableCell>
                      <TableCell align="right" sx={{ py: 0.5, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{formatCurrency(m.latestRate)}</TableCell>
                      <TableCell align="right" sx={{ py: 0.5, fontSize: '0.7rem', color: increased ? 'error.main' : decreased ? 'success.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {m.difference > 0 ? '+' : ''}{formatCurrency(m.difference)}
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.5 }}>
                        <Chip
                          size="small"
                          color={pctColor as 'error' | 'success' | 'default'}
                          icon={<TrendIcon sx={{ fontSize: 12 }} />}
                          label={`${m.percentChange > 0 ? '+' : ''}${m.percentChange.toFixed(1)}%`}
                          sx={{ height: 18, fontSize: '0.6rem' }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}><Typography variant="caption" noWrap>{m.latestVendor}</Typography></TableCell>
                      <TableCell sx={{ py: 0.5, fontSize: '0.7rem' }}>
                        {latestDocRoute ? (
                          <Link href={`${latestDocRoute}`} underline="hover" sx={{ fontSize: '0.7rem' }}>
                            {m.latestDocType} {m.latestDocNumber}
                          </Link>
                        ) : (
                          <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>{m.latestDocType} {m.latestDocNumber}</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ py: 0.5, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{formatDate(m.latestDate)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
