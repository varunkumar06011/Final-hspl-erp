import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  Grid,
  LinearProgress,
  IconButton,
  Alert,
  CircularProgress,
  Stack,
  Chip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  AccountBalance as BankIcon,
  Payments as CashIcon,
  AccountBalanceWallet as BudgetIcon,
  Person as OwnerIcon,
  TrendingUp as UtilizationIcon,
  TrendingDown as UnpaidIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatCurrency } from '../utils/enumOptions';

interface DashboardData {
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

interface BudgetReport {
  data: Array<{
    id: string;
    slNo: number;
    particulars: string;
    allocatedAmount: number;
    committedAmount: number;
    actualAmount: number;
    paidAmount: number;
    available: number;
    uncommittedAvailable: number;
    utilizationPct: number;
    paidPct: number;
    status: string;
  }>;
  totals: {
    allocated: number;
    committed: number;
    actual: number;
    paid: number;
    available: number;
    uncommittedAvailable: number;
  };
}

export default function FinanceDashboardPage() {
  const [error, setError] = useState('');

  const { data: dashboard, isLoading } = useQuery<DashboardData>({
    queryKey: ['/finance-reports/dashboard'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/dashboard');
      return response.data;
    },
  });

  const { data: budgetReport } = useQuery<BudgetReport>({
    queryKey: ['/finance-reports/budget-vs-actual'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/budget-vs-actual');
      return response.data;
    },
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  const d = dashboard;
  const budgetHeads = budgetReport?.data ?? [];

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Finance Dashboard</Typography>
        <IconButton onClick={() => window.location.reload()} size="small"><RefreshIcon /></IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            icon={<BudgetIcon />}
            label="Total Allocated"
            value={formatCurrency(d?.budget.totalAllocated ?? 0)}
            sublabel={`${d?.budgetHeadCount ?? 0} budget heads`}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            icon={<UtilizationIcon />}
            label="Utilization"
            value={`${d?.budget.utilizationPct ?? 0}%`}
            sublabel={`Actual: ${formatCurrency(d?.budget.totalActual ?? 0)}`}
            color="warning.main"
            progress={d?.budget.utilizationPct ?? 0}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            icon={<UnpaidIcon />}
            label="Unpaid Liabilities"
            value={formatCurrency(d?.budget.totalUnpaid ?? 0)}
            sublabel={`Paid: ${formatCurrency(d?.budget.totalPaid ?? 0)}`}
            color="error.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            icon={<OwnerIcon />}
            label="Owner Equity"
            value={formatCurrency(d?.ownerEquity ?? 0)}
            sublabel={Number(d?.ownerEquity ?? 0) > 0 ? 'Company owes owner' : 'Owner owes company'}
            color={Number(d?.ownerEquity ?? 0) > 0 ? 'error.main' : 'success.main'}
          />
        </Grid>
      </Grid>

      {/* Liquidity Section */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <KpiCard
            icon={<BankIcon />}
            label="Bank Balance"
            value={formatCurrency(d?.liquidity.bankBalance ?? 0)}
            color="info.main"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <KpiCard
            icon={<CashIcon />}
            label="Cash Balance"
            value={formatCurrency(d?.liquidity.cashBalance ?? 0)}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <KpiCard
            icon={<BudgetIcon />}
            label="Total Liquidity"
            value={formatCurrency(d?.liquidity.totalLiquidity ?? 0)}
            sublabel="Bank + Cash"
            color="secondary.main"
          />
        </Grid>
      </Grid>

      {/* Budget Breakdown */}
      <Card sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Budget Head Breakdown</Typography>
        {budgetHeads.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            No budget heads found. Import budget data to see the breakdown.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {budgetHeads.map((head) => {
              const allocated = head.allocatedAmount;
              const actual = head.actualAmount;
              const available = head.uncommittedAvailable ?? head.available;
              const pct = head.utilizationPct;
              const barColor = pct > 90 ? 'error' : pct > 70 ? 'warning' : 'success';
              return (
                <Box key={head.id}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={500}>
                      {head.slNo}. {head.particulars}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {formatCurrency(actual)} / {formatCurrency(allocated)}
                      </Typography>
                      <Chip
                        label={`${pct}%`}
                        size="small"
                        color={pct > 90 ? 'error' : pct > 70 ? 'warning' : 'success'}
                      />
                    </Stack>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(pct, 100)}
                    color={barColor}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary">
                      Committed: {formatCurrency(head.committedAmount)} | Paid: {formatCurrency(head.paidAmount)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: available < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                      Available: {formatCurrency(available)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Card>

      {/* Budget Summary Bar (visual) */}
      {budgetReport && (
        <Card sx={{ p: 2 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Budget Summary</Typography>
          <Grid container spacing={2}>
            {[
              { label: 'Allocated', value: budgetReport.totals.allocated, color: '#1976d2' },
              { label: 'Committed', value: budgetReport.totals.committed, color: '#0288d1' },
              { label: 'Actual', value: budgetReport.totals.actual, color: '#ed6c02' },
              { label: 'Paid', value: budgetReport.totals.paid, color: '#2e7d32' },
              { label: 'Available', value: budgetReport.totals.uncommittedAvailable ?? budgetReport.totals.available, color: '#9c27b0' },
            ].map((item) => {
              const maxVal = budgetReport.totals.allocated || 1;
              const widthPct = Math.max(2, (item.value / maxVal) * 100);
              return (
                <Grid item xs={12} key={item.label}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="body2" sx={{ width: 100, flexShrink: 0 }}>{item.label}</Typography>
                    <Box sx={{ flex: 1, height: 24, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
                      <Box sx={{ width: `${widthPct}%`, height: '100%', bgcolor: item.color, borderRadius: 1, transition: 'width 0.5s' }} />
                    </Box>
                    <Typography variant="body2" sx={{ width: 140, textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(item.value)}
                    </Typography>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Card>
      )}
    </Box>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sublabel,
  color,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  color: string;
  progress?: number;
}) {
  return (
    <Card sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ color, mt: 0.5 }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="h6" sx={{ color, fontSize: { xs: '1rem', sm: '1.25rem' }, fontWeight: 600, wordBreak: 'break-all' }}>
            {value}
          </Typography>
          {sublabel && <Typography variant="caption" color="text.secondary">{sublabel}</Typography>}
          {progress !== undefined && (
            <LinearProgress
              variant="determinate"
              value={Math.min(progress, 100)}
              color={progress > 90 ? 'error' : progress > 70 ? 'warning' : 'success'}
              sx={{ mt: 1, height: 6, borderRadius: 3 }}
            />
          )}
        </Box>
      </Stack>
    </Card>
  );
}
