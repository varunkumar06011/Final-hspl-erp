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
  Button,
  Snackbar,
} from '@mui/material';
import {
  Warning as WarningIcon,
  NotificationsActive as NotifyIcon,
  VerifiedUser as WarrantyIcon,
} from '@mui/icons-material';
import { useQuery, useMutation } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { dateLocale } from '../i18n';

import { useTranslation } from 'react-i18next';
// ── Types matching the backend GET /assets/warranty-expiring response ──
interface WarrantyExpiringAsset {
  id: string;
  assetId: string;
  assetName: string;
  category: string | null;
  serialNumber: string | null;
  status: string;
  location: string;
  warrantyExpiry: string;
  daysLeft: number;
  vendorName: string | null;
  unitPrice: number | null;
}

interface WarrantyExpiringResponse {
  days: number;
  count: number;
  autoPushSent: boolean;
  autoPushResult: { notifiedCount: number; deviceCount: number } | null;
  alreadyNotifiedToday: boolean;
  assets: WarrantyExpiringAsset[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: '2-digit' });
}

function daysLeftColor(days: number): 'error' | 'warning' | 'success' {
  if (days <= 7) return 'error';
  if (days <= 15) return 'warning';
  return 'success';
}

/**
 * Warranty Expiring Soon widget — proactively alerts admins about assets
 * whose warranty is about to expire, so they can claim free repairs before
 * coverage ends.
 *
 * The backend auto-sends push notifications to admins when this data is
 * fetched (once per day per project). This widget also has a t('wexNotify')
 * button for manual reminders.
 *
 * Read-only add-on. Does not modify any data.
 */
export default function WarrantyExpiringWidget() {
  const { t } = useTranslation('widgets');
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
    open: false,
    msg: '',
    severity: 'success',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/assets/warranty-expiring'],
    queryFn: async () => {
      const response = await api.get<WarrantyExpiringResponse>('/assets/warranty-expiring', {
        params: { days: 30 },
      });
      return response.data;
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/assets/warranty-expiring/notify', { days: 30 });
      return response.data;
    },
    onSuccess: (result) => {
      setSnack({
        open: true,
        severity: 'success',
        msg: result.message || t('wexPushSent', { n: result.notifiedCount }),
      });
      refetch();
    },
    onError: (err) => {
      setSnack({ open: true, severity: 'error', msg: extractErrorMessage(err) });
    },
  });

  const assets = data?.assets ?? [];
  const count = data?.count ?? 0;
  const hasExpiring = count > 0;

  return (
    <>
      <Card sx={{
        borderLeft: { xs: 'none', sm: '4px solid' },
        borderLeftColor: hasExpiring ? 'warning.main' : 'success.main',
      }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <WarningIcon color={hasExpiring ? 'warning' : 'action'} />
              <Box>
                <Typography variant="h6" fontWeight={600}>
                  {t('wexTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('wexSubtitle')}
                </Typography>
              </Box>
            </Stack>
            {hasExpiring && (
              <Button
                variant="contained"
                color="warning"
                size="small"
                startIcon={<NotifyIcon />}
                onClick={() => notifyMutation.mutate()}
                disabled={notifyMutation.isPending}
              >
                {notifyMutation.isPending ? t('wexSending') : t('wexNotify')}
              </Button>
            )}
          </Stack>

          {/* Auto-push status indicator */}
          {!isLoading && data && (
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2, gap: 1 }}>
              {data.autoPushSent && (
                <Chip
                  size="small"
                  color="success"
                  icon={<NotifyIcon />}
                  label={t('wexAutoPush', { n: data.autoPushResult?.notifiedCount ?? 0 })}
                />
              )}
              {data.alreadyNotifiedToday && !data.autoPushSent && (
                <Chip
                  size="small"
                  color="default"
                  icon={<NotifyIcon />}
                  label={t('wexNotified')}
                />
              )}
              <Chip
                size="small"
                color={hasExpiring ? 'warning' : 'success'}
                icon={<WarrantyIcon />}
                label={hasExpiring ? t('wexCount', { count }) : t('wexAllValid')}
              />
            </Stack>
          )}

          {isError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('wexError')}
            </Alert>
          )}

          {isLoading ? (
            <Box>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1 }} />
              ))}
            </Box>
          ) : !hasExpiring ? (
            <Alert severity="success" icon={<WarrantyIcon />}>
              {t('wexEmpty')}
            </Alert>
          ) : (
            <TableContainer sx={{ maxHeight: 400, overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('colAsset')}</TableCell>
                    <TableCell>{t('colCategory')}</TableCell>
                    <TableCell>{t('colLocation')}</TableCell>
                    <TableCell align="right">{t('colDaysLeft')}</TableCell>
                    <TableCell>{t('colWarrantyExpiry')}</TableCell>
                    <TableCell>{t('colVendor')}</TableCell>
                    <TableCell align="right">{t('colPurchaseCost')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {assets.map((a) => {
                    const chipColor = daysLeftColor(a.daysLeft);
                    return (
                      <TableRow key={a.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{a.assetName}</Typography>
                          <Typography variant="caption" color="text.secondary" component="div">
                            {a.assetId}{a.serialNumber ? ` · S/N: ${a.serialNumber}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>{a.category ?? '—'}</TableCell>
                        <TableCell>{a.location}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            color={chipColor}
                            label={t('wexDays', { count: a.daysLeft })}
                          />
                        </TableCell>
                        <TableCell>{formatDate(a.warrantyExpiry)}</TableCell>
                        <TableCell>{a.vendorName ?? '—'}</TableCell>
                        <TableCell align="right">
                          {a.unitPrice !== null ? formatCurrency(a.unitPrice) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {!isLoading && hasExpiring && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Red = expiring within 7 days · Yellow = within 15 days · Green = within 30 days.
              Push notifications are auto-sent to admins once per day when this page is loaded.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack({ ...snack, open: false })}
          sx={{ width: '100%' }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
