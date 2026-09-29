import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Alert,
  Stack,
  IconButton,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  AccountBalanceWallet as BudgetIcon,
  AccountBalance as BankIcon,
  Payments as CashIcon,
  Savings as AllocatedIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';
import { AnimatedNumber } from './AnimatedNumber';
import ResponsiveDialog from './ResponsiveDialog';
import { useTranslation } from 'react-i18next';

// ── Types matching the existing /finance-reports/dashboard response ──
// Reused exactly — no new API, no duplicated calculation.
interface FinanceDashboardData {
  budget: {
    totalAllocated: number;
    totalCommitted: number;
    totalActual: number;
    totalPaid: number;
    totalAvailable: number;
    totalUncommittedAvailable: number;
    totalUnpaid: number;
    utilizationPct: number;
  };
  liquidity: {
    bankBalance: number;
    cashBalance: number;
    totalLiquidity: number;
  };
  ownerEquity: number;
  budgetHeadCount: number;
}

/**
 * Finance Summary Card — shows the total budget (allocated) on the main
 * Dashboard. Clicking the card opens a modal with the full financial
 * breakdown: Bank Balance, Cash Balance, Total Liquidity, and an
 * Allocation Breakdown table.
 *
 * Read-only add-on. Reuses the existing /finance-reports/dashboard
 * endpoint — no new API, no duplicated calculation logic, no changes to
 * any existing finance logic.
 */
export default function FinanceSummaryCard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('cards');
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/finance-reports/dashboard'],
    queryFn: async () => {
      const response = await api.get<FinanceDashboardData>('/finance-reports/dashboard');
      return response.data;
    },
  });

  const totalAllocated = data?.budget.totalAllocated ?? 0;
  const utilizationPct = data?.budget.utilizationPct ?? 0;

  return (
    <>
      {compact ? (
        // Mobile / minimal card — same style as pending PO card
        <Card
          onClick={() => setOpen(true)}
          sx={{ cursor: 'pointer', transition: 'box-shadow 0.2s, border-color 0.2s', '&:hover': { boxShadow: 3, borderColor: 'primary.main' } }}
        >
          <CardContent>
            <Typography color="text.secondary" variant="body2" gutterBottom>{t('finance.title')}</Typography>
            {isLoading ? (
              <Skeleton variant="text" width={120} height={30} />
            ) : (
              <Typography variant="h6" color="primary.main">
                <AnimatedNumber value={totalAllocated} format={(n) => formatCurrency(n)} />
              </Typography>
            )}
          </CardContent>
        </Card>
      ) : (
        // Desktop / full card — gradient with stats
        <Card
          onClick={() => setOpen(true)}
          sx={{
            cursor: 'pointer',
            transition: 'box-shadow 0.2s, border-color 0.2s',
            '&:hover': { boxShadow: 3, borderColor: 'primary.main' },
            height: '100%',
            background: 'linear-gradient(135deg, #1565C0 0%, #0D47A1 100%)',
            color: 'common.white',
          }}
        >
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <BudgetIcon fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('finance.title')}
              </Typography>
            </Stack>

            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {t('finance.totalBudgetAllocated')}
            </Typography>

            {isLoading ? (
              <Skeleton variant="text" width={180} height={48} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
            ) : (
              <Typography variant="h4" fontWeight={700} sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }}>
                <AnimatedNumber value={totalAllocated} format={(n) => formatCurrency(n)} />
              </Typography>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>{t('finance.utilization')}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {isLoading ? '—' : `${utilizationPct}%`}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>{t('finance.budgetHeads')}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {isLoading ? '—' : data?.budgetHeadCount ?? 0}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>{t('finance.liquidity')}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {isLoading ? '—' : formatCurrency(data?.liquidity.totalLiquidity ?? 0)}
                </Typography>
              </Box>
            </Stack>

            <Box sx={{ mt: 1.5, textAlign: 'right' }}>
              <Link component="button" variant="body2" onClick={(e) => { e.stopPropagation(); setOpen(true); }} sx={{ color: 'common.white' }}>
                {t('finance.viewDetails')}
              </Link>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal — no page navigation */}
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AllocatedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={600}>{t('finance.title')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('finance.financialDetails')}</Typography>
            </Box>
          </Stack>
          <IconButton onClick={() => setOpen(false)} size="small" aria-label={t('finance.close')}>
            <CloseIcon />
          </IconButton>
        </Box>

        {isError && (
          <Alert severity="warning" sx={{ m: 2 }}>
            {t('finance.loadError')}
          </Alert>
        )}

        <Box sx={{ p: 3 }}>
          {/* Headline: Total Allocated */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" color="text.secondary">{t('finance.totalAllocatedBudget')}</Typography>
            {isLoading ? (
              <Skeleton variant="text" width={200} height={48} />
            ) : (
              <Typography variant="h4" fontWeight={700} color="primary.main">
                {formatCurrency(data?.budget.totalAllocated ?? 0)}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('finance.headsLine', { n: data?.budgetHeadCount ?? 0, p: data?.budget.utilizationPct ?? 0 })}
            </Typography>
          </Box>

          {/* Liquidity section */}
          <Box sx={{ mb: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <BankIcon color="info" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>{t('finance.bankBalance')}</Typography>
            </Stack>
            <Typography variant="h6" color="info.main">
              {isLoading ? <Skeleton variant="text" width={150} /> : formatCurrency(data?.liquidity.bankBalance ?? 0)}
            </Typography>
          </Box>

          <Box sx={{ mb: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <CashIcon color="success" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>{t('finance.cashBalance')}</Typography>
            </Stack>
            <Typography variant="h6" color="success.main">
              {isLoading ? <Skeleton variant="text" width={150} /> : formatCurrency(data?.liquidity.cashBalance ?? 0)}
            </Typography>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <BudgetIcon color="secondary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={600}>{t('finance.totalLiquidity')}</Typography>
            </Stack>
            <Typography variant="h6" color="secondary.main">
              {isLoading ? <Skeleton variant="text" width={150} /> : formatCurrency(data?.liquidity.totalLiquidity ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">{t('finance.bankPlusCash')}</Typography>
          </Box>

          {/* Allocation breakdown table */}
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            {t('finance.allocationBreakdown')}
          </Typography>
          <TableContainer component={Card} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>{t('finance.allocation')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('finance.amount')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>{t('finance.allocated')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: 'primary.main' }}>
                    {isLoading ? <Skeleton variant="text" width={100} /> : formatCurrency(data?.budget.totalAllocated ?? 0)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t('finance.bank')}</TableCell>
                  <TableCell align="right" sx={{ color: 'info.main' }}>
                    {isLoading ? <Skeleton variant="text" width={100} /> : formatCurrency(data?.liquidity.bankBalance ?? 0)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t('finance.cash')}</TableCell>
                  <TableCell align="right" sx={{ color: 'success.main' }}>
                    {isLoading ? <Skeleton variant="text" width={100} /> : formatCurrency(data?.liquidity.cashBalance ?? 0)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t('finance.actualSpent')}</TableCell>
                  <TableCell align="right" sx={{ color: 'warning.main' }}>
                    {isLoading ? <Skeleton variant="text" width={100} /> : formatCurrency(data?.budget.totalActual ?? 0)}
                  </TableCell>
                </TableRow>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 700 }}>{t('finance.availableRemaining')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: (data?.budget.totalAvailable ?? 0) < 0 ? 'error.main' : 'success.main' }}>
                    {isLoading ? <Skeleton variant="text" width={100} /> : formatCurrency(data?.budget.totalAvailable ?? 0)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('finance.formula')}
          </Typography>
        </Box>
      </ResponsiveDialog>
    </>
  );
}
