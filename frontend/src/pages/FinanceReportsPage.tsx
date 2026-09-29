import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Stack,
  Grid,
  LinearProgress,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
} from '@mui/material';
import {
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Permission, UserRole, hasPermission } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import RefreshButton from '../components/RefreshButton';
import ResponsiveTable from '../components/ResponsiveTable';
import ResponsiveDialog from '../components/ResponsiveDialog';
import LedgerAutocomplete, { type LedgerOption } from '../components/LedgerAutocomplete';
import { useAuthStore } from '../stores/authStore';
import { enumLabel, formatCurrency, formatDate, formatIndianNumber } from '../utils/enumOptions';

import { useTranslation } from 'react-i18next';
type TabValue = 'budget' | 'cashflow' | 'accounts' | 'owner' | 'reconciliation' | 'aging';

export default function FinanceReportsPage() {
  const { t: tr } = useTranslation('finreports');
  const [tab, setTab] = useState<TabValue>('budget');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cashFlowQuery, setCashFlowQuery] = useState(0);

  // ── Admin permission check ──
  // Only users with MANAGE_FINANCE permission (ADMIN, ADMIN_2, ACCOUNTANT,
  // PROJECT_HEAD, ACCOUNTS_HEAD) can create new budget heads from the report.
  const user = useAuthStore((s) => s.user);
  const canManageFinance = !!user && hasPermission(user.role as UserRole, Permission.MANAGE_FINANCE);

  // ── Create budget head (new row in Budget vs Actual report) ──
  // Uses the same POST /budget-heads endpoint as the Budget Heads page,
  // so the new row replicates existing rows exactly — same schema, same
  // validation, same backend processing. No hardcoded or fake data.
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ slNo: '', particulars: '', allocatedAmount: '' });
  const [createError, setCreateError] = useState('');

  const createBudgetHeadMutation = useMutation({
    mutationFn: async (payload: { slNo: number; particulars: string; allocatedAmount: number }) => {
      const response = await api.post('/budget-heads', payload);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch all related queries so the new row appears
      // everywhere — Budget vs Actual report, Budget Heads page, and Dashboard.
      // Use refetchQueries for the active report to guarantee an immediate
      // refetch (invalidateQueries only refetches active queries, but
      // refetchQueries forces it regardless of staleTime).
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      queryClient.refetchQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      setCreateDialogOpen(false);
      setCreateForm({ slNo: '', particulars: '', allocatedAmount: '' });
      setCreateError('');
    },
    onError: (err: unknown) => setCreateError(extractErrorMessage(err)),
  });

  const openCreateDialog = () => {
    setCreateForm({ slNo: '', particulars: '', allocatedAmount: '' });
    setCreateError('');
    setCreateDialogOpen(true);
  };

  const handleCreateSubmit = () => {
    if (!createForm.particulars || String(createForm.particulars).trim() === '') {
      setCreateError(tr('errPart'));
      return;
    }
    if (!createForm.allocatedAmount || Number(createForm.allocatedAmount) <= 0) {
      setCreateError('Allocated amount must be greater than 0');
      return;
    }
    if (!createForm.slNo || Number(createForm.slNo) < 1) {
      setCreateError('Sl. No. must be at least 1');
      return;
    }
    setCreateError('');
    createBudgetHeadMutation.mutate({
      slNo: Number(createForm.slNo),
      particulars: String(createForm.particulars).trim(),
      allocatedAmount: Number(createForm.allocatedAmount),
    });
  };

  const { data: budgetReport, isLoading: budgetLoading } = useQuery({
    queryKey: ['/finance-reports/budget-vs-actual'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/budget-vs-actual');
      return response.data;
    },
  });

  const { data: cashFlow, isLoading: cashFlowLoading } = useQuery({
    queryKey: ['/finance-reports/cash-flow', cashFlowQuery],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const response = await api.get('/finance-reports/cash-flow', { params });
      return response.data;
    },
  });

  // ── New Cash Flow Outflow (manual withdrawal with Budget Head attribution) ──
  // Posts to the existing /bank-accounts/:id/withdraw or /cash-accounts/:id/out
  // endpoints. When a Budget Head is selected, the backend deducts the amount
  // from that budget head's available balance (actualAmount + paidAmount).
  // The new transaction appears in the Cash Flow report on reload.
  const [outflowDialogOpen, setOutflowDialogOpen] = useState(false);
  const [outflowForm, setOutflowForm] = useState({
    accountType: 'BANK' as 'BANK' | 'CASH',
    accountId: '',
    contraLedgerId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
    budgetHeadId: '',
  });
  const [outflowError, setOutflowError] = useState('');

  // Fetch bank accounts, cash accounts, ledgers, and budget heads for the dialog
  const { data: bankAccountsData } = useQuery({
    queryKey: ['/bank-accounts', 'all-for-cashflow'],
    queryFn: async () => {
      const response = await api.get('/bank-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
    enabled: outflowDialogOpen,
  });
  const { data: cashAccountsData } = useQuery({
    queryKey: ['/cash-accounts', 'all-for-cashflow'],
    queryFn: async () => {
      const response = await api.get('/cash-accounts', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
    enabled: outflowDialogOpen,
  });
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-for-cashflow'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
    enabled: outflowDialogOpen,
  });
  const { data: budgetHeadsData } = useQuery({
    queryKey: ['/budget-heads', 'all-for-cashflow'],
    queryFn: async () => {
      const response = await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } });
      return response.data;
    },
    enabled: outflowDialogOpen,
  });

  const bankAccounts: { id: string; accountName: string; currentBalance: number }[] = bankAccountsData?.data ?? [];
  const cashAccounts: { id: string; name: string; currentBalance: number }[] = cashAccountsData?.data ?? [];
  const ledgers: LedgerOption[] = (ledgersData?.data ?? []).map((l: Record<string, unknown>) => ({
    id: String(l.id),
    name: String(l.name),
    group: String(l.group ?? ''),
  }));
  const budgetHeads: { id: string; particulars: string; allocatedAmount: number; actualAmount: number }[] = budgetHeadsData?.data ?? [];

  const outflowMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        amount: Number(outflowForm.amount),
        contraLedgerId: outflowForm.contraLedgerId,
        date: outflowForm.date,
        description: outflowForm.description || undefined,
      };
      if (outflowForm.budgetHeadId) payload.budgetHeadId = outflowForm.budgetHeadId;
      if (outflowForm.accountType === 'BANK') {
        const response = await api.post(`/bank-accounts/${outflowForm.accountId}/withdraw`, payload);
        return response.data;
      } else {
        const response = await api.post(`/cash-accounts/${outflowForm.accountId}/out`, payload);
        return response.data;
      }
    },
    onSuccess: () => {
      // Invalidate cash flow report so the new outflow appears
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/cash-flow'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads'] });
      queryClient.invalidateQueries({ queryKey: ['/budget-heads/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/finance-reports/budget-vs-actual'] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard', 'admin-summary'] });
      setOutflowDialogOpen(false);
      setOutflowForm({
        accountType: 'BANK',
        accountId: '',
        contraLedgerId: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        description: '',
        budgetHeadId: '',
      });
      setOutflowError('');
      // Force cash flow refetch
      setCashFlowQuery((q) => q + 1);
    },
    onError: (err: unknown) => setOutflowError(extractErrorMessage(err)),
  });

  const openOutflowDialog = () => {
    setOutflowForm({
      accountType: 'BANK',
      accountId: '',
      contraLedgerId: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      description: '',
      budgetHeadId: '',
    });
    setOutflowError('');
    setOutflowDialogOpen(true);
  };

  const handleOutflowSubmit = () => {
    if (!outflowForm.accountId) {
      setOutflowError(tr('errAcc'));
      return;
    }
    if (!outflowForm.contraLedgerId) {
      setOutflowError(tr('errContra'));
      return;
    }
    if (!outflowForm.amount || Number(outflowForm.amount) <= 0) {
      setOutflowError('Amount must be greater than 0');
      return;
    }
    if (!outflowForm.date) {
      setOutflowError(tr('errDate'));
      return;
    }
    setOutflowError('');
    outflowMutation.mutate();
  };

  const { data: accountSummary, isLoading: accountsLoading } = useQuery({
    queryKey: ['/finance-reports/account-summary'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/account-summary');
      return response.data;
    },
  });

  const { data: ownerEquity, isLoading: ownerLoading } = useQuery({
    queryKey: ['/finance-reports/owner-equity'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/owner-equity');
      return response.data;
    },
  });

  const { data: bankReconciliation, isLoading: bankReconLoading } = useQuery({
    queryKey: ['/finance-reports/bank-reconciliation'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/bank-reconciliation');
      return response.data;
    },
  });

  const { data: cashReconciliation, isLoading: cashReconLoading } = useQuery({
    queryKey: ['/finance-reports/cash-reconciliation'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/cash-reconciliation');
      return response.data;
    },
  });

  const { data: vendorAging, isLoading: agingLoading } = useQuery({
    queryKey: ['/finance-reports/vendor-aging'],
    queryFn: async () => {
      const response = await api.get('/finance-reports/vendor-aging');
      return response.data;
    },
  });

  const exportCsv = (data: Record<string, unknown>[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = (reportType: string) => {
    const token = localStorage.getItem('firebaseToken');
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const url = `${api.defaults.baseURL}/finance-reports/pdf/${reportType}?${params.toString()}`;
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(tr('errPdf'));
        return r.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reportType}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err.message));
  };

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <RefreshButton onClick={() => queryClient.invalidateQueries()} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v: TabValue) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={tr('budgetVsActual')} value="budget" />
        <Tab label={tr('cashFlow')} value="cashflow" />
        <Tab label={tr('accountSummary')} value="accounts" />
        <Tab label={tr('ownerEquity')} value="owner" />
        <Tab label={tr('reconciliation')} value="reconciliation" />
        <Tab label={tr('vendorAging')} value="aging" />
      </Tabs>

      {/* ── Budget vs Actual Tab ── */}
      {tab === 'budget' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{tr('budgetVsActualReport')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {canManageFinance && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={openCreateDialog}
                >
                  {tr('newBudgetHead')}
                </Button>
              )}
              {budgetReport?.data && (
                <Button
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={() => exportCsv(budgetReport.data, 'budget-vs-actual.csv')}
              >
                {tr('exportCsv')}
              </Button>
            )}
            {budgetReport?.data && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('budget-vs-actual')}>{tr('pdf')}</Button>
            )}
            </Box>
          </Box>
          {budgetLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (
            <>
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('slNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('particulars')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('allocated')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('committed')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('actual')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('paid')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('available')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('utilization')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(budgetReport?.data ?? []).map((row: Record<string, unknown>) => {
                      const pct = Number(row.utilizationPct ?? 0);
                      return (
                        <TableRow key={row.id as string} hover>
                          <TableCell data-label={tr('slNo')}>{String(row.slNo)}</TableCell>
                          <TableCell data-label={tr('particulars')}>{String(row.particulars ?? '—')}</TableCell>
                          <TableCell data-label={tr('allocated')} align="right">{formatCurrency(row.allocatedAmount)}</TableCell>
                          <TableCell data-label={tr('committed')} align="right">{formatCurrency(row.committedAmount)}</TableCell>
                          <TableCell data-label={tr('actual')} align="right">{formatCurrency(row.actualAmount)}</TableCell>
                          <TableCell data-label={tr('paid')} align="right">{formatCurrency(row.paidAmount)}</TableCell>
                          <TableCell data-label={tr('available')} align="right" sx={{ fontWeight: 600, color: Number(row.uncommittedAvailable ?? row.available) < 0 ? 'error.main' : 'success.main' }}>
                            {formatCurrency(row.uncommittedAvailable ?? row.available)}
                          </TableCell>
                          <TableCell data-label={tr('utilization')} sx={{ minWidth: 100 }}>
                            <Stack spacing={0.5}>
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(pct, 100)}
                                color={pct > 90 ? 'error' : pct > 70 ? 'warning' : 'success'}
                                sx={{ height: 6, borderRadius: 3 }}
                              />
                              <Typography variant="caption" color="text.secondary">{pct}%</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell data-label={tr('status')}><Chip label={enumLabel(String(row.status ?? 'ACTIVE'))} size="small" color={row.status === 'CLOSED' ? 'default' : 'success'} /></TableCell>
                        </TableRow>
                      );
                    })}
                    {budgetReport?.totals && (
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('total')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(budgetReport.totals.allocated)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(budgetReport.totals.committed)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(budgetReport.totals.actual)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(budgetReport.totals.paid)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: (budgetReport.totals.uncommittedAvailable ?? budgetReport.totals.available) < 0 ? 'error.main' : 'success.main' }}>
                          {formatCurrency(budgetReport.totals.uncommittedAvailable ?? budgetReport.totals.available)}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </>
          )}
        </Card>
      )}

      {/* ── Create Budget Head dialog (admin only) ──
          Creates a new row in the Budget vs Actual report using the same
          POST /budget-heads endpoint as the Budget Heads page, so the new
          row replicates existing rows exactly — same schema, validation,
          and backend processing. No hardcoded or fake data. */}
      <ResponsiveDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('newBudgetHead')}</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label={tr('slNo')}
              type="number"
              value={formatIndianNumber(createForm.slNo)}
              onChange={(e) => setCreateForm({ ...createForm, slNo: e.target.value.replace(/,/g, '') })}
              required
              size="small"
            />
            <TextField
              label={tr('particulars')}
              value={createForm.particulars}
              onChange={(e) => setCreateForm({ ...createForm, particulars: e.target.value })}
              required
              size="small"
            />
            <TextField
              label={tr('allocatedAmount')}
              type="text"
              value={formatIndianNumber(createForm.allocatedAmount)}
              onChange={(e) => setCreateForm({ ...createForm, allocatedAmount: e.target.value.replace(/,/g, '') })}
              required
              size="small"
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreateSubmit}
            disabled={createBudgetHeadMutation.isPending}
          >
            {createBudgetHeadMutation.isPending ? <CircularProgress size={20} /> : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── New Cash Flow Outflow dialog ──
          Posts to /bank-accounts/:id/withdraw or /cash-accounts/:id/out.
          When a Budget Head is selected, the backend deducts the amount from
          that budget head's available balance and updates actualAmount/paidAmount.
          The transaction is persisted in the database and appears in the
          Cash Flow report, Expenditure page, and Budget vs Actual report. */}
      <ResponsiveDialog open={outflowDialogOpen} onClose={() => setOutflowDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('newCashFlowOutflow')}</DialogTitle>
        <DialogContent>
          {outflowError && <Alert severity="error" sx={{ mb: 2 }}>{outflowError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{tr('accountType')}</InputLabel>
              <Select
                value={outflowForm.accountType}
                label={tr('accountType')}
                onChange={(e) => setOutflowForm({ ...outflowForm, accountType: e.target.value as 'BANK' | 'CASH', accountId: '' })}
              >
                <MenuItem value="BANK">{tr('bankAccount')}</MenuItem>
                <MenuItem value="CASH">{tr('cashAccount')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" required>
              <InputLabel>{outflowForm.accountType === 'BANK' ? tr('bankAccount') : tr('cashAccount')}</InputLabel>
              <Select
                value={outflowForm.accountId}
                label={outflowForm.accountType === 'BANK' ? tr('bankAccount') : tr('cashAccount')}
                onChange={(e) => setOutflowForm({ ...outflowForm, accountId: e.target.value })}
              >
                {outflowForm.accountType === 'BANK'
                  ? bankAccounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {tr('balOpt', { a: a.accountName, b: formatCurrency(a.currentBalance) })}
                    </MenuItem>
                  ))
                  : cashAccounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {tr('balOpt', { a: a.name, b: formatCurrency(a.currentBalance) })}
                    </MenuItem>
                  ))
                }
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" required>
              <InputLabel>{tr('budgetHead')}</InputLabel>
              <Select
                value={outflowForm.budgetHeadId}
                label={tr('budgetHead')}
                onChange={(e) => setOutflowForm({ ...outflowForm, budgetHeadId: e.target.value })}
                renderValue={(val) => {
                  if (!val) return <em style={{ color: 'rgba(0,0,0,0.5)' }}>— None —</em>;
                  const head = budgetHeads.find((h) => h.id === val);
                  return head ? head.particulars : val;
                }}
              >
                <MenuItem value="">
                  <em>— None —</em>
                </MenuItem>
                {budgetHeads.map((h) => {
                  const available = Number(h.allocatedAmount) - Number(h.actualAmount);
                  return (
                    <MenuItem key={h.id} value={h.id}>
                      <Box>
                        <Typography variant="body2">{h.particulars}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Allocated: {formatCurrency(h.allocatedAmount)} | Available: {formatCurrency(available)}
                        </Typography>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            <LedgerAutocomplete
              value={outflowForm.contraLedgerId}
              onChange={(id) => setOutflowForm({ ...outflowForm, contraLedgerId: id })}
              ledgers={ledgers}
              placeholder={tr('contraLedgerWhereMoney')}
            />

            <TextField
              size="small"
              label={tr('amount')}
              type="number"
              value={outflowForm.amount}
              onChange={(e) => setOutflowForm({ ...outflowForm, amount: e.target.value })}
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
              required
            />

            <TextField
              size="small"
              type="date"
              label={tr('date')}
              value={outflowForm.date}
              onChange={(e) => setOutflowForm({ ...outflowForm, date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              required
            />

            <TextField
              size="small"
              label={tr('description')}
              value={outflowForm.description}
              onChange={(e) => setOutflowForm({ ...outflowForm, description: e.target.value })}
              multiline
              minRows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOutflowDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleOutflowSubmit}
            disabled={outflowMutation.isPending}
          >
            {outflowMutation.isPending ? <CircularProgress size={20} /> : tr('postOutflow')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* ── Cash Flow Tab ── */}
      {tab === 'cashflow' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="date"
              label={tr('startDate')}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label={tr('endDate')}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" size="small" onClick={() => setCashFlowQuery(cashFlowQuery + 1)}>{tr('apply')}</Button>
            {canManageFinance && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={openOutflowDialog}
                sx={{ ml: 1 }}
              >
                {tr('newOutflow')}
              </Button>
            )}
            {cashFlow?.data && (
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => exportCsv(cashFlow.data, 'cash-flow.csv')}
                sx={{ ml: 'auto' }}
              >
                {tr('exportCsv')}
              </Button>
            )}
            {cashFlow?.data && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('cash-flow')}>{tr('pdf')}</Button>
            )}
          </Box>

          {cashFlow?.summary && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">{tr('totalInflow')}</Typography>
                  <Typography variant="h6" color="success.main" fontWeight={600}>
                    {formatCurrency(cashFlow.summary.totalInflow)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">{tr('totalOutflow')}</Typography>
                  <Typography variant="h6" color="error.main" fontWeight={600}>
                    {formatCurrency(cashFlow.summary.totalOutflow)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">{tr('netFlow')}</Typography>
                  <Typography variant="h6" color={cashFlow.summary.netFlow >= 0 ? 'success.main' : 'error.main'} fontWeight={600}>
                    {formatCurrency(cashFlow.summary.netFlow)}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}

          {cashFlowLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (
            <ResponsiveTable>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('vochType')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{tr('inflow')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{tr('outflow')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('ref')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(cashFlow?.data ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">{tr('noTransactionsInThis')}</Typography></TableCell></TableRow>
                  ) : (
                    (cashFlow?.data ?? []).map((entry: Record<string, unknown>, i: number) => (
                      <TableRow key={i} hover>
                        <TableCell data-label={tr('date')}>{formatDate(entry.date)}</TableCell>
                        <TableCell data-label={tr('account')}>{String(entry.account ?? '—')}</TableCell>
                        <TableCell data-label={tr('description')}>{String(entry.description ?? '—')}</TableCell>
                        <TableCell data-label={tr('vochType')}>
                          <Chip
                            label={enumLabel(String(entry.type ?? ''))}
                            size="small"
                            color={Number(entry.inflow) > 0 ? 'success' : 'error'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell data-label={tr('inflow')} align="right" sx={{ color: 'success.main' }}>
                          {Number(entry.inflow) > 0 ? formatCurrency(entry.inflow) : '—'}
                        </TableCell>
                        <TableCell data-label={tr('outflow')} align="right" sx={{ color: 'error.main' }}>
                          {Number(entry.outflow) > 0 ? formatCurrency(entry.outflow) : '—'}
                        </TableCell>
                        <TableCell data-label={tr('ref')}><Chip label={String(entry.referenceType ?? '')} size="small" variant="outlined" /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </Card>
      )}

      {/* ── Account Summary Tab ── */}
      {tab === 'accounts' && (
        <Box>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
          {accountSummary && (
            <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('account-summary')}>{tr('downloadPdf')}</Button>
          )}
        </Box>
        <Grid container spacing={2}>
          {/* Bank Accounts */}
          <Grid item xs={12} md={6}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>{tr('bankAccounts')}</Typography>
              </Box>
              {accountsLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <ResponsiveTable>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('current')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('txns')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(accountSummary?.bankAccounts ?? []).map((acc: Record<string, unknown>) => (
                        <TableRow key={acc.id as string} hover>
                          <TableCell data-label={tr('account')}>
                            <Typography variant="body2" fontWeight={500}>{String(acc.accountName)}</Typography>
                            <Typography variant="caption" color="text.secondary">{String(acc.bankName ?? '')} {String(acc.accountNumber ?? '')}</Typography>
                          </TableCell>
                          <TableCell data-label={tr('opening')} align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell data-label={tr('current')} align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(acc.currentBalance)}</TableCell>
                          <TableCell data-label={tr('txns')} align="right">{String((acc._count as Record<string, number>)?.transactions ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                      {(accountSummary?.bankAccounts ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">{tr('noBankAccounts')}</Typography></TableCell></TableRow>
                      )}
                      {accountSummary?.totals && (
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>{tr('totalBank')}</TableCell>
                          <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                            {formatCurrency(accountSummary.totals.bankTotal)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              )}
            </Card>
          </Grid>

          {/* Cash Accounts */}
          <Grid item xs={12} md={6}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>{tr('cashAccounts')}</Typography>
              </Box>
              {accountsLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <ResponsiveTable>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('current')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('txns')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(accountSummary?.cashAccounts ?? []).map((acc: Record<string, unknown>) => (
                        <TableRow key={acc.id as string} hover>
                          <TableCell data-label={tr('account')}><Typography variant="body2" fontWeight={500}>{String(acc.name)}</Typography></TableCell>
                          <TableCell data-label={tr('opening')} align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell data-label={tr('current')} align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(acc.currentBalance)}</TableCell>
                          <TableCell data-label={tr('txns')} align="right">{String((acc._count as Record<string, number>)?.transactions ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                      {(accountSummary?.cashAccounts ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">{tr('noCashAccounts')}</Typography></TableCell></TableRow>
                      )}
                      {accountSummary?.totals && (
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>{tr('totalCash')}</TableCell>
                          <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                            {formatCurrency(accountSummary.totals.cashTotal)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              )}
            </Card>
          </Grid>

          {/* Grand Total */}
          {accountSummary?.totals && (
            <Grid item xs={12}>
              <Card sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" fontWeight={600}>Total Liquidity (Bank + Cash)</Typography>
                  <Typography variant="h5" fontWeight={700} color="primary.main">
                    {formatCurrency(accountSummary.totals.grandTotal)}
                  </Typography>
                </Stack>
              </Card>
            </Grid>
          )}
        </Grid>
        </Box>
      )}

      {/* ── Owner Equity Tab ── */}
      {tab === 'owner' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={600}>{tr('ownerEquityReport')}</Typography>
            {ownerEquity?.accounts && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={() => exportCsv(ownerEquity.accounts, 'owner-equity.csv')}>
                {tr('exportCsv')}
              </Button>
            )}
            {ownerEquity?.accounts && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('owner-equity')}>{tr('pdf')}</Button>
            )}
          </Box>
          {ownerLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (
            <>
              {ownerEquity?.totals && (
                <Box sx={{ px: 2, pb: 2 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">{tr('companyOwesOwner')}</Typography>
                      <Typography variant="h6" color="error.main" fontWeight={600}>{formatCurrency(ownerEquity.totals.totalOwedToOwner)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">{tr('ownerOwesCompany')}</Typography>
                      <Typography variant="h6" color="info.main" fontWeight={600}>{formatCurrency(ownerEquity.totals.totalOwedByOwner)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">{tr('netOwnerEquity')}</Typography>
                      <Typography variant="h6" color={ownerEquity.totals.netOwnerEquity >= 0 ? 'error.main' : 'info.main'} fontWeight={600}>
                        {formatCurrency(ownerEquity.totals.netOwnerEquity)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              )}
              <ResponsiveTable>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('ownerName')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{tr('currentBalance')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('meaning')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(ownerEquity?.accounts ?? []).map((acc: Record<string, unknown>) => {
                      const balance = Number(acc.currentBalance ?? 0);
                      return (
                        <TableRow key={acc.id as string} hover>
                          <TableCell data-label={tr('ownerName')} sx={{ fontWeight: 500 }}>{String(acc.ownerName)}</TableCell>
                          <TableCell data-label={tr('opening')} align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell data-label={tr('currentBalance')} align="right" sx={{ fontWeight: 600, color: balance > 0 ? 'error.main' : balance < 0 ? 'info.main' : 'text.primary' }}>
                            {formatCurrency(balance)}
                          </TableCell>
                          <TableCell data-label={tr('meaning')}>
                            <Chip
                              label={balance > 0 ? tr('coOwes') : balance < 0 ? tr('ownerOwes') : tr('settled')}
                              size="small"
                              color={balance > 0 ? 'warning' : balance < 0 ? 'info' : 'success'}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(ownerEquity?.accounts ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">{tr('noOwnerAccounts')}</Typography></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </>
          )}
        </Card>
      )}

      {/* ── Reconciliation Tab ── */}
      {tab === 'reconciliation' && (
        <Grid container spacing={2}>
          {/* Bank Reconciliation */}
          <Grid item xs={12}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>{tr('bankAccountReconciliation')}</Typography>
                {bankReconciliation?.summary && (
                  <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Chip label={tr('reconciledN', { a: bankReconciliation.summary.reconciledCount, b: bankReconciliation.summary.totalAccounts })} size="small" color="success" />
                    {bankReconciliation.summary.unreconciledCount > 0 && (
                      <Chip label={tr('unreconN', { n: bankReconciliation.summary.unreconciledCount })} size="small" color="error" />
                    )}
                    {bankReconciliation.summary.totalDiscrepancy > 0.01 && (
                      <Chip label={tr('totalDisc', { v: formatCurrency(bankReconciliation.summary.totalDiscrepancy) })} size="small" color="warning" />
                    )}
                  </Stack>
                )}
              </Box>
              {bankReconLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <ResponsiveTable>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('expected')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('system')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('discrepancy')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('txns')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(bankReconciliation?.data ?? []).map((acc: Record<string, unknown>) => {
                        const discrepancy = Number(acc.discrepancy ?? 0);
                        return (
                          <TableRow key={acc.id as string} hover>
                            <TableCell data-label={tr('account')}>
                              <Typography variant="body2" fontWeight={500}>{String(acc.accountName)}</Typography>
                              <Typography variant="caption" color="text.secondary">{String(acc.bankName ?? '')} {String(acc.accountNumber ?? '')}</Typography>
                            </TableCell>
                            <TableCell data-label={tr('opening')} align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                            <TableCell data-label={tr('expected')} align="right">{formatCurrency(acc.expectedBalance)}</TableCell>
                            <TableCell data-label={tr('system')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(acc.currentBalance)}</TableCell>
                            <TableCell data-label={tr('discrepancy')} align="right" sx={{ fontWeight: 600, color: Math.abs(discrepancy) > 0.01 ? 'error.main' : 'success.main' }}>
                              {formatCurrency(discrepancy)}
                            </TableCell>
                            <TableCell data-label={tr('status')}>
                              <Chip
                                label={acc.isReconciled ? tr('reconciled') : tr('discrepancy')}
                                size="small"
                                color={acc.isReconciled ? 'success' : 'error'}
                              />
                            </TableCell>
                            <TableCell data-label={tr('txns')} align="right">{String(acc.transactionCount ?? 0)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(bankReconciliation?.data ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">{tr('noBankAccounts')}</Typography></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              )}
            </Card>
          </Grid>

          {/* Cash Reconciliation */}
          <Grid item xs={12}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>{tr('cashAccountReconciliation')}</Typography>
                {cashReconciliation?.summary && (
                  <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Chip label={tr('reconciledN', { a: cashReconciliation.summary.reconciledCount, b: cashReconciliation.summary.totalAccounts })} size="small" color="success" />
                    {cashReconciliation.summary.unreconciledCount > 0 && (
                      <Chip label={tr('unreconN', { n: cashReconciliation.summary.unreconciledCount })} size="small" color="error" />
                    )}
                  </Stack>
                )}
              </Box>
              {cashReconLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <ResponsiveTable>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('account')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('opening')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('expected')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('system')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('discrepancy')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">{tr('txns')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(cashReconciliation?.data ?? []).map((acc: Record<string, unknown>) => {
                        const discrepancy = Number(acc.discrepancy ?? 0);
                        return (
                          <TableRow key={acc.id as string} hover>
                            <TableCell data-label={tr('account')}><Typography variant="body2" fontWeight={500}>{String(acc.name)}</Typography></TableCell>
                            <TableCell data-label={tr('opening')} align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                            <TableCell data-label={tr('expected')} align="right">{formatCurrency(acc.expectedBalance)}</TableCell>
                            <TableCell data-label={tr('system')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(acc.currentBalance)}</TableCell>
                            <TableCell data-label={tr('discrepancy')} align="right" sx={{ fontWeight: 600, color: Math.abs(discrepancy) > 0.01 ? 'error.main' : 'success.main' }}>
                              {formatCurrency(discrepancy)}
                            </TableCell>
                            <TableCell data-label={tr('status')}>
                              <Chip
                                label={acc.isReconciled ? tr('reconciled') : tr('discrepancy')}
                                size="small"
                                color={acc.isReconciled ? 'success' : 'error'}
                              />
                            </TableCell>
                            <TableCell data-label={tr('txns')} align="right">{String(acc.transactionCount ?? 0)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(cashReconciliation?.data ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">{tr('noCashAccounts')}</Typography></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              )}
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ── Vendor Aging Tab ── */}
      {tab === 'aging' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={600}>{tr('vendorPaymentAgingSummary')}</Typography>
            {vendorAging?.data && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={() => {
                const flat = (vendorAging.data as Record<string, unknown>[]).flatMap((v) =>
                  (v.invoicesWithOutstanding as Record<string, unknown>[]).map((inv) => ({
                    vendorName: v.vendorName,
                    vendorCode: v.vendorCode,
                    invoiceNumber: inv.invoiceNumber,
                    invoiceCode: inv.invoiceCode,
                    totalAmount: inv.totalAmount,
                    paidAmount: inv.paidAmount,
                    outstanding: inv.outstanding,
                    ageDays: inv.ageDays,
                    date: inv.date,
                  }))
                );
                exportCsv(flat, 'vendor-aging.csv');
              }}>{tr('exportCsv')}</Button>
            )}
          </Box>

          {vendorAging?.totals && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">{tr('totalInvoiced')}</Typography><Typography variant="h6" fontWeight={600}>{formatCurrency(vendorAging.totals.totalInvoiced)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">{tr('totalPaid')}</Typography><Typography variant="h6" color="success.main" fontWeight={600}>{formatCurrency(vendorAging.totals.totalPaid)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">{tr('totalOutstanding')}</Typography><Typography variant="h6" color="error.main" fontWeight={600}>{formatCurrency(vendorAging.totals.totalOutstanding)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">{tr('vendors')}</Typography><Typography variant="h6" fontWeight={600}>{(vendorAging.data as unknown[]).length}</Typography></Grid>
              </Grid>
              <Grid container spacing={1} sx={{ mt: 1 }}>
                <Grid item xs={6} sm={2.4}><Chip label={tr('d0', { v: formatCurrency(vendorAging.totals.current) })} size="small" color="success" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={tr('d31', { v: formatCurrency(vendorAging.totals.days30) })} size="small" color="info" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={tr('d61', { v: formatCurrency(vendorAging.totals.days60) })} size="small" color="warning" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={tr('d91', { v: formatCurrency(vendorAging.totals.days90) })} size="small" color="error" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={tr('d120', { v: formatCurrency(vendorAging.totals.days90Plus) })} size="small" color="error" variant="outlined" /></Grid>
              </Grid>
            </Box>
          )}

          {agingLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (vendorAging?.data ?? []).length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Typography color="text.secondary">{tr('noVendorInvoicesFound')}</Typography></Box>
          ) : (
            <ResponsiveTable>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('vendor')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{tr('invoiced')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{tr('paid')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{tr('outstanding')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">0-30</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">31-60</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">61-90</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">91+</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(vendorAging?.data ?? []).map((vendor: Record<string, unknown>) => {
                    const buckets = vendor.agingBuckets as Record<string, number>;
                    return (
                      <TableRow key={vendor.vendorId as string} hover>
                        <TableCell data-label={tr('vendor')}>
                          <Typography variant="body2" fontWeight={500}>{String(vendor.vendorName)}</Typography>
                          <Typography variant="caption" color="text.secondary">{String(vendor.vendorCode)}</Typography>
                        </TableCell>
                        <TableCell data-label={tr('invoiced')} align="right">{formatCurrency(vendor.totalInvoiced)}</TableCell>
                        <TableCell data-label={tr('paid')} align="right" sx={{ color: 'success.main' }}>{formatCurrency(vendor.totalPaid)}</TableCell>
                        <TableCell data-label={tr('outstanding')} align="right" sx={{ fontWeight: 600, color: Number(vendor.totalOutstanding) > 0 ? 'error.main' : 'success.main' }}>
                          {formatCurrency(vendor.totalOutstanding)}
                        </TableCell>
                        <TableCell data-label="0-30" align="right">{formatCurrency(buckets?.current ?? 0)}</TableCell>
                        <TableCell data-label="31-60" align="right">{formatCurrency(buckets?.days30 ?? 0)}</TableCell>
                        <TableCell data-label="61-90" align="right">{formatCurrency(buckets?.days60 ?? 0)}</TableCell>
                        <TableCell data-label="91+" align="right">{formatCurrency((buckets?.days90 ?? 0) + (buckets?.days90Plus ?? 0))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </Card>
      )}
    </Box>
  );
}
