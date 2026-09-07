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
  Grid,
} from '@mui/material';
import {
  VerifiedUser as WarrantyIcon,
  Build as BuildIcon,
  Savings as SavingsIcon,
  Warning as WarningIcon,
  HourglassEmpty as PendingIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';

// ── Types matching the backend GET /assets/warranty-tracker response ──
type RepairType = 'WARRANTY_CLAIM' | 'PAID_REPAIR' | 'WARRANTY_EXPIRED' | 'PENDING';

interface WarrantyRecord {
  id: string;
  assetId: string;
  assetName: string;
  category: string | null;
  serialNumber: string | null;
  location: string;
  reason: string;
  maintenanceVendor: string | null;
  technician: string | null;
  sentAt: string;
  completedAt: string | null;
  warrantyExpiry: string | null;
  wasUnderWarranty: boolean;
  estimatedCost: number | null;
  finalCost: number | null;
  repairType: RepairType;
  savings: number;
  sentBy: string;
  completedBy: string | null;
  completionNotes: string | null;
}

interface WarrantyTrackerResponse {
  summary: {
    totalMaintenances: number;
    warrantyClaimsCount: number;
    paidRepairsCount: number;
    pendingCount: number;
    expiredWarrantyRepairCount: number;
    totalSavings: number;
    totalPaidRepairCost: number;
    assetsUnderWarranty: number;
    assetsWarrantyExpired: number;
    assetsNoWarranty: number;
  };
  records: WarrantyRecord[];
}

const REPAIR_TYPE_CONFIG: Record<
  RepairType,
  { label: string; color: 'success' | 'error' | 'warning' | 'default'; icon: typeof WarrantyIcon }
> = {
  WARRANTY_CLAIM: { label: 'Warranty Claim (Free)', color: 'success', icon: WarrantyIcon },
  PAID_REPAIR: { label: 'Paid Repair', color: 'error', icon: BuildIcon },
  WARRANTY_EXPIRED: { label: 'Warranty Expired — Paid', color: 'warning', icon: WarningIcon },
  PENDING: { label: 'Pending', color: 'default', icon: PendingIcon },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * Warranty Savings Tracker widget — shows warranty claims vs paid repairs
 * and how much money was saved by claiming warranty instead of paying.
 *
 * Read-only add-on for the Assets page. Does not modify any data.
 */
export default function WarrantySavingsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['/assets/warranty-tracker'],
    queryFn: async () => {
      const response = await api.get<WarrantyTrackerResponse>('/assets/warranty-tracker', {
        params: { limit: 50 },
      });
      return response.data;
    },
  });

  const records = data?.records ?? [];
  const summary = data?.summary;

  return (
    <Card sx={{ borderLeft: { xs: 'none', sm: '4px solid' }, borderLeftColor: 'success.main' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <SavingsIcon color="success" />
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Warranty Claims vs Paid Repairs
            </Typography>
            <Typography variant="body2" color="text.secondary">
              How much you saved by claiming warranty instead of paying out of pocket
            </Typography>
          </Box>
        </Stack>

        {/* Summary cards */}
        {!isLoading && summary && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined" sx={{ borderColor: 'success.main', bgcolor: 'success.main', color: 'common.white', opacity: 0.95 }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h5" fontWeight={700}>
                    {formatCurrency(summary.totalSavings)}
                  </Typography>
                  <Typography variant="caption">Total Saved via Warranty</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h5" fontWeight={700} color="success.main">
                    {summary.warrantyClaimsCount}
                  </Typography>
                  <Typography variant="caption">Warranty Claims (Free)</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h5" fontWeight={700} color="error.main">
                    {summary.paidRepairsCount}
                  </Typography>
                  <Typography variant="caption">Paid Repairs</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h5" fontWeight={700} color="warning.main">
                    {summary.expiredWarrantyRepairCount}
                  </Typography>
                  <Typography variant="caption">Warranty Expired (Paid)</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3} md={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="h6" fontWeight={700} color="error.main">
                    {formatCurrency(summary.totalPaidRepairCost)}
                  </Typography>
                  <Typography variant="caption">Total Paid for Repairs</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Warranty status chips */}
        {!isLoading && summary && (
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2, gap: 1 }}>
            <Chip size="small" color="success" icon={<WarrantyIcon />} label={`Under Warranty: ${summary.assetsUnderWarranty}`} />
            <Chip size="small" color="warning" icon={<WarningIcon />} label={`Warranty Expired: ${summary.assetsWarrantyExpired}`} />
            <Chip size="small" color="default" label={`No Warranty Set: ${summary.assetsNoWarranty}`} />
            <Chip size="small" color="info" icon={<PendingIcon />} label={`Pending Repairs: ${summary.pendingCount}`} />
          </Stack>
        )}

        {isError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load warranty tracker data. Make sure the backend is running.
          </Alert>
        )}

        {isLoading ? (
          <Box>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : records.length === 0 ? (
          <Alert severity="info">
            No maintenance records yet. When an asset is sent for repair, it will appear here —
            showing whether it was a free warranty claim or a paid repair, and how much you saved.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 500, overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Asset</TableCell>
                  <TableCell>Repair Type</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell align="right">Est. Cost</TableCell>
                  <TableCell align="right">Final Cost</TableCell>
                  <TableCell align="right">Saved</TableCell>
                  <TableCell>Warranty Expiry</TableCell>
                  <TableCell>Sent Date</TableCell>
                  <TableCell>Vendor / Tech</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((r) => {
                  const config = REPAIR_TYPE_CONFIG[r.repairType];
                  const Icon = config.icon;
                  return (
                    <TableRow key={r.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{r.assetName}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {r.assetId}{r.serialNumber ? ` · S/N: ${r.serialNumber}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={config.color}
                          icon={<Icon />}
                          label={config.label}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 180 }} title={r.reason}>
                          {r.reason}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {r.estimatedCost !== null ? formatCurrency(r.estimatedCost) : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ color: r.finalCost && r.finalCost > 0 ? 'error.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {r.finalCost !== null ? formatCurrency(r.finalCost) : '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: r.savings > 0 ? 'success.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {r.savings > 0 ? formatCurrency(r.savings) : '—'}
                      </TableCell>
                      <TableCell>
                        {r.warrantyExpiry ? (
                          <Typography
                            variant="caption"
                            color={r.wasUnderWarranty ? 'success.main' : 'warning.main'}
                          >
                            {formatDate(r.warrantyExpiry)}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">No warranty</Typography>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(r.sentAt)}</TableCell>
                      <TableCell>
                        <Typography variant="caption" component="div">
                          {r.maintenanceVendor ?? '—'}
                        </Typography>
                        {r.technician && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            Tech: {r.technician}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!isLoading && records.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Showing {records.length} most recent maintenance records. "Saved" = estimated repair cost
            avoided by claiming warranty (free repair while still under warranty).
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
