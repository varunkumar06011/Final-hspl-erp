import {
  Box,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Alert,
  Chip,
  Stack,
  Divider,
  Link,
} from '@mui/material';
import { Paid as PaidIcon, Today as TodayIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { AnimatedNumber } from './AnimatedNumber';

// ── Types matching the backend GET /dashboard/payments-today response ──
interface PaymentToday {
  id: string;
  amount: number;
  date: string;
  mode: string;
  reference: string | null;
  status: string;
  requestNumber: string;
  type: string;
  description: string;
  category: string;
  vendorName: string;
  invoiceCode: string | null;
  createdBy: string;
  bankAccountName: string | null;
  cashAccountName: string | null;
}

interface PaymentsTodayResponse {
  date: string;
  totalAmount: number;
  count: number;
  payments: PaymentToday[];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function prettyMode(mode: string): string {
  if (!mode) return '—';
  return mode.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Amount Used Today widget — shows the total of all PAID payments made
 * today (calendar day, no carry-forward) for the current project, plus
 * a list of those payments.
 *
 * Read-only dashboard add-on. Does not modify any data. Visibility is
 * gated by the parent page (admin + accountant only).
 */
export default function AmountUsedTodayWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['/dashboard', 'payments-today'],
    queryFn: async () => {
      const response = await api.get<PaymentsTodayResponse>('/dashboard/payments-today');
      return response.data;
    },
    // Refresh every 60s so the "today" total stays current without spamming.
    refetchInterval: 60_000,
  });

  const payments = data?.payments ?? [];
  const total = data?.totalAmount ?? 0;
  const count = data?.count ?? 0;
  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Card sx={{ borderLeft: { xs: 'none', sm: '4px solid' }, borderLeftColor: 'primary.main' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <TodayIcon color="primary" fontSize="small" />
              <Typography variant="h6" fontWeight={600}>
                Amount Used Today
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {todayLabel} — no carry-forward, only payments made today
            </Typography>
          </Box>
          {!isLoading && (
            <Chip
              size="small"
              color={count > 0 ? 'primary' : 'default'}
              icon={<PaidIcon />}
              label={`${count} payment${count === 1 ? '' : 's'}`}
            />
          )}
        </Stack>

        {/* Big total */}
        <Box sx={{ mb: 2, mt: 1 }}>
          {isLoading ? (
            <Skeleton variant="text" width={200} height={56} />
          ) : (
            <Typography variant="h4" fontWeight={700} color={total > 0 ? 'error.main' : 'text.secondary'}>
              <AnimatedNumber value={total} format={(n) => formatCurrency(n)} />
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Total paid out today across all payment modes
          </Typography>
        </Box>

        {isError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load today's payments. Make sure the backend is running.
          </Alert>
        )}

        {!isLoading && count === 0 && !isError && (
          <Alert severity="info">
            No payments have been made today yet. Payments marked as PAID today will appear here.
          </Alert>
        )}

        {!isLoading && payments.length > 0 && (
          <Box>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Today's Payments</Typography>
            <Stack spacing={1.5}>
              {payments.map((p) => (
                <Box
                  key={p.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 1,
                    py: 0.5,
                  }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {p.vendorName}
                      </Typography>
                      <Chip size="small" label={prettyMode(p.mode)} />
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(p.date)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {p.requestNumber}
                      {p.description ? ` · ${p.description}` : ''}
                      {p.invoiceCode ? ` · Inv ${p.invoiceCode}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      By {p.createdBy}
                      {p.bankAccountName ? ` · ${p.bankAccountName}` : ''}
                      {p.cashAccountName ? ` · ${p.cashAccountName}` : ''}
                      {p.reference ? ` · Ref ${p.reference}` : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body1" fontWeight={700} color="error.main" sx={{ whiteSpace: 'nowrap' }}>
                    {formatCurrency(p.amount)}
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
              <Link href="/payments" underline="hover">View all payments →</Link>
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
