import { useState } from 'react';
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
  ToggleButtonGroup,
  ToggleButton,
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
  // Link POs and quotations to their existing list pages. We intentionally
  // don't pass the doc id (kept out of the response to stay small), so we
  // link to the list page where the user can find the doc by its number.
  if (docType === 'PO') return '/pos';
  if (docType === 'QUOTATION') return '/quotations';
  return null;
}

/**
 * Material Rate Tracker widget — shows the previous cost vs the latest cost
 * for every material that has appeared on more than one Quotation or PO.
 *
 * This is a read-only dashboard add-on. It does not modify any data and only
 * renders for admin roles (the parent page gates visibility).
 */
export default function RateTrackerWidget() {
  const [sort, setSort] = useState<'inc' | 'name'>('inc');

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
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Material Rate Tracker
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Previous cost vs latest cost — from Quotations &amp; Purchase Orders
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            value={sort}
            exclusive
            onChange={(_e, v) => v && setSort(v)}
            aria-label="sort mode"
          >
            <ToggleButton value="inc">By % increase</ToggleButton>
            <ToggleButton value="name">By name</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {/* Summary chips */}
        {!isLoading && summary && (
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2, gap: 1 }}>
            <Chip size="small" color="default" label={`Materials tracked: ${summary.totalMaterialsTracked}`} />
            <Chip size="small" color="info" label={`With rate history: ${summary.totalWithChange}`} />
            <Chip size="small" color="error" icon={<TrendingUp />} label={`Increased: ${summary.increased}`} />
            <Chip size="small" color="success" icon={<TrendingDown />} label={`Decreased: ${summary.decreased}`} />
          </Stack>
        )}

        {isError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load rate tracker data. Make sure the backend is running.
          </Alert>
        )}

        {isLoading ? (
          <Box>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : materials.length === 0 ? (
          <Alert severity="info">
            No rate changes to show yet. Once the same material appears on more than one Quotation or
            Purchase Order, its previous and latest cost will appear here.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 480, overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Material</TableCell>
                  <TableCell align="right">Previous Rate</TableCell>
                  <TableCell align="right">Latest Rate</TableCell>
                  <TableCell align="right">Difference</TableCell>
                  <TableCell align="right">% Change</TableCell>
                  <TableCell>Latest Vendor</TableCell>
                  <TableCell>Latest Doc</TableCell>
                  <TableCell>Latest Date</TableCell>
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
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {m.materialName}
                        </Typography>
                        {m.unit && (
                          <Typography variant="caption" color="text.secondary">
                            per {m.unit}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(m.previousRate)}</TableCell>
                      <TableCell align="right">{formatCurrency(m.latestRate)}</TableCell>
                      <TableCell align="right" sx={{ color: increased ? 'error.main' : decreased ? 'success.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {m.difference > 0 ? '+' : ''}{formatCurrency(m.difference)}
                      </TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          color={pctColor as 'error' | 'success' | 'default'}
                          icon={<TrendIcon />}
                          label={`${m.percentChange > 0 ? '+' : ''}${m.percentChange.toFixed(1)}%`}
                        />
                      </TableCell>
                      <TableCell>{m.latestVendor}</TableCell>
                      <TableCell>
                        {latestDocRoute ? (
                          <Link href={`${latestDocRoute}`} underline="hover">
                            {m.latestDocType} {m.latestDocNumber}
                          </Link>
                        ) : (
                          `${m.latestDocType} ${m.latestDocNumber}`
                        )}
                      </TableCell>
                      <TableCell>{formatDate(m.latestDate)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!isLoading && materials.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Showing top {materials.length} materials by rate change. Previous rate = the rate on the
            Quotation/PO immediately before the latest one for the same material.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
