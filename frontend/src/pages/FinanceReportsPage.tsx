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
} from '@mui/material';
import {
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency } from '../utils/enumOptions';

type TabValue = 'budget' | 'cashflow' | 'accounts' | 'owner' | 'reconciliation' | 'aging';

export default function FinanceReportsPage() {
  const [tab, setTab] = useState<TabValue>('budget');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cashFlowQuery, setCashFlowQuery] = useState(0);

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
        if (!r.ok) throw new Error('Failed to generate PDF');
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Finance Reports</Typography>
        <RefreshButton onClick={() => queryClient.invalidateQueries()} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v: TabValue) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Budget vs Actual" value="budget" />
        <Tab label="Cash Flow" value="cashflow" />
        <Tab label="Account Summary" value="accounts" />
        <Tab label="Owner Equity" value="owner" />
        <Tab label="Reconciliation" value="reconciliation" />
        <Tab label="Vendor Aging" value="aging" />
      </Tabs>

      {/* ── Budget vs Actual Tab ── */}
      {tab === 'budget' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={600}>Budget vs Actual Report</Typography>
            {budgetReport?.data && (
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => exportCsv(budgetReport.data, 'budget-vs-actual.csv')}
              >
                Export CSV
              </Button>
            )}
            {budgetReport?.data && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('budget-vs-actual')}>PDF</Button>
            )}
          </Box>
          {budgetLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (
            <>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Sl. No.</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Particulars</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Allocated</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Committed</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Actual</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Paid</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Available</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Utilization</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(budgetReport?.data ?? []).map((row: Record<string, unknown>) => {
                      const pct = Number(row.utilizationPct ?? 0);
                      return (
                        <TableRow key={row.id as string} hover>
                          <TableCell>{String(row.slNo)}</TableCell>
                          <TableCell>{String(row.particulars ?? '—')}</TableCell>
                          <TableCell align="right">{formatCurrency(row.allocatedAmount)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.committedAmount)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.actualAmount)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.paidAmount)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: Number(row.uncommittedAvailable ?? row.available) < 0 ? 'error.main' : 'success.main' }}>
                            {formatCurrency(row.uncommittedAvailable ?? row.available)}
                          </TableCell>
                          <TableCell sx={{ minWidth: 100 }}>
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
                          <TableCell><Chip label={String(row.status ?? 'ACTIVE')} size="small" color={row.status === 'CLOSED' ? 'default' : 'success'} /></TableCell>
                        </TableRow>
                      );
                    })}
                    {budgetReport?.totals && (
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell colSpan={2} sx={{ fontWeight: 700 }}>TOTAL</TableCell>
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
            </>
          )}
        </Card>
      )}

      {/* ── Cash Flow Tab ── */}
      {tab === 'cashflow' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="date"
              label="Start Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="End Date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Button variant="contained" size="small" onClick={() => setCashFlowQuery(cashFlowQuery + 1)}>Apply</Button>
            {cashFlow?.data && (
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => exportCsv(cashFlow.data, 'cash-flow.csv')}
                sx={{ ml: 'auto' }}
              >
                Export CSV
              </Button>
            )}
            {cashFlow?.data && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('cash-flow')}>PDF</Button>
            )}
          </Box>

          {cashFlow?.summary && (
            <Box sx={{ px: 2, pb: 1 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">Total Inflow</Typography>
                  <Typography variant="h6" color="success.main" fontWeight={600}>
                    {formatCurrency(cashFlow.summary.totalInflow)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">Total Outflow</Typography>
                  <Typography variant="h6" color="error.main" fontWeight={600}>
                    {formatCurrency(cashFlow.summary.totalOutflow)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary">Net Flow</Typography>
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
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Inflow</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Outflow</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Ref</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(cashFlow?.data ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">No transactions in this period</Typography></TableCell></TableRow>
                  ) : (
                    (cashFlow?.data ?? []).map((entry: Record<string, unknown>, i: number) => (
                      <TableRow key={i} hover>
                        <TableCell>{String(entry.date ?? '—')}</TableCell>
                        <TableCell>{String(entry.account ?? '—')}</TableCell>
                        <TableCell>
                          <Chip
                            label={String(entry.type ?? '').replace(/_/g, ' ')}
                            size="small"
                            color={Number(entry.inflow) > 0 ? 'success' : 'error'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>
                          {Number(entry.inflow) > 0 ? formatCurrency(entry.inflow) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'error.main' }}>
                          {Number(entry.outflow) > 0 ? formatCurrency(entry.outflow) : '—'}
                        </TableCell>
                        <TableCell>{String(entry.description ?? '—')}</TableCell>
                        <TableCell><Chip label={String(entry.referenceType ?? '')} size="small" variant="outlined" /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      {/* ── Account Summary Tab ── */}
      {tab === 'accounts' && (
        <Box>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
          {accountSummary && (
            <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('account-summary')}>Download PDF</Button>
          )}
        </Box>
        <Grid container spacing={2}>
          {/* Bank Accounts */}
          <Grid item xs={12} md={6}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>Bank Accounts</Typography>
              </Box>
              {accountsLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Current</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(accountSummary?.bankAccounts ?? []).map((acc: Record<string, unknown>) => (
                        <TableRow key={acc.id as string} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>{String(acc.accountName)}</Typography>
                            <Typography variant="caption" color="text.secondary">{String(acc.bankName ?? '')} {String(acc.accountNumber ?? '')}</Typography>
                          </TableCell>
                          <TableCell align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(acc.currentBalance)}</TableCell>
                          <TableCell align="right">{String((acc._count as Record<string, number>)?.transactions ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                      {(accountSummary?.bankAccounts ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">No bank accounts</Typography></TableCell></TableRow>
                      )}
                      {accountSummary?.totals && (
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>Total Bank</TableCell>
                          <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                            {formatCurrency(accountSummary.totals.bankTotal)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Card>
          </Grid>

          {/* Cash Accounts */}
          <Grid item xs={12} md={6}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>Cash Accounts</Typography>
              </Box>
              {accountsLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Current</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(accountSummary?.cashAccounts ?? []).map((acc: Record<string, unknown>) => (
                        <TableRow key={acc.id as string} hover>
                          <TableCell><Typography variant="body2" fontWeight={500}>{String(acc.name)}</Typography></TableCell>
                          <TableCell align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'success.main' }}>{formatCurrency(acc.currentBalance)}</TableCell>
                          <TableCell align="right">{String((acc._count as Record<string, number>)?.transactions ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                      {(accountSummary?.cashAccounts ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">No cash accounts</Typography></TableCell></TableRow>
                      )}
                      {accountSummary?.totals && (
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell sx={{ fontWeight: 700 }}>Total Cash</TableCell>
                          <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                            {formatCurrency(accountSummary.totals.cashTotal)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
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
            <Typography variant="subtitle1" fontWeight={600}>Owner Equity Report</Typography>
            {ownerEquity?.accounts && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={() => exportCsv(ownerEquity.accounts, 'owner-equity.csv')}>
                Export CSV
              </Button>
            )}
            {ownerEquity?.accounts && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => downloadPdf('owner-equity')}>PDF</Button>
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
                      <Typography variant="caption" color="text.secondary">Company Owes Owner</Typography>
                      <Typography variant="h6" color="error.main" fontWeight={600}>{formatCurrency(ownerEquity.totals.totalOwedToOwner)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">Owner Owes Company</Typography>
                      <Typography variant="h6" color="info.main" fontWeight={600}>{formatCurrency(ownerEquity.totals.totalOwedByOwner)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="caption" color="text.secondary">Net Owner Equity</Typography>
                      <Typography variant="h6" color={ownerEquity.totals.netOwnerEquity >= 0 ? 'error.main' : 'info.main'} fontWeight={600}>
                        {formatCurrency(ownerEquity.totals.netOwnerEquity)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              )}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Owner Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Current Balance</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Meaning</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(ownerEquity?.accounts ?? []).map((acc: Record<string, unknown>) => {
                      const balance = Number(acc.currentBalance ?? 0);
                      return (
                        <TableRow key={acc.id as string} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{String(acc.ownerName)}</TableCell>
                          <TableCell align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: balance > 0 ? 'error.main' : balance < 0 ? 'info.main' : 'text.primary' }}>
                            {formatCurrency(balance)}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={balance > 0 ? 'Company owes owner' : balance < 0 ? 'Owner owes company' : 'Settled'}
                              size="small"
                              color={balance > 0 ? 'warning' : balance < 0 ? 'info' : 'success'}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(ownerEquity?.accounts ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary">No owner accounts</Typography></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
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
                <Typography variant="subtitle1" fontWeight={600}>Bank Account Reconciliation</Typography>
                {bankReconciliation?.summary && (
                  <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                    <Chip label={`Reconciled: ${bankReconciliation.summary.reconciledCount}/${bankReconciliation.summary.totalAccounts}`} size="small" color="success" />
                    {bankReconciliation.summary.unreconciledCount > 0 && (
                      <Chip label={`Unreconciled: ${bankReconciliation.summary.unreconciledCount}`} size="small" color="error" />
                    )}
                    {bankReconciliation.summary.totalDiscrepancy > 0.01 && (
                      <Chip label={`Total Discrepancy: ${formatCurrency(bankReconciliation.summary.totalDiscrepancy)}`} size="small" color="warning" />
                    )}
                  </Stack>
                )}
              </Box>
              {bankReconLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Expected</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">System</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Discrepancy</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(bankReconciliation?.data ?? []).map((acc: Record<string, unknown>) => {
                        const discrepancy = Number(acc.discrepancy ?? 0);
                        return (
                          <TableRow key={acc.id as string} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>{String(acc.accountName)}</Typography>
                              <Typography variant="caption" color="text.secondary">{String(acc.bankName ?? '')} {String(acc.accountNumber ?? '')}</Typography>
                            </TableCell>
                            <TableCell align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                            <TableCell align="right">{formatCurrency(acc.expectedBalance)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(acc.currentBalance)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, color: Math.abs(discrepancy) > 0.01 ? 'error.main' : 'success.main' }}>
                              {formatCurrency(discrepancy)}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={acc.isReconciled ? 'Reconciled' : 'Discrepancy'}
                                size="small"
                                color={acc.isReconciled ? 'success' : 'error'}
                              />
                            </TableCell>
                            <TableCell align="right">{String(acc.transactionCount ?? 0)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(bankReconciliation?.data ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">No bank accounts</Typography></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Card>
          </Grid>

          {/* Cash Reconciliation */}
          <Grid item xs={12}>
            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>Cash Account Reconciliation</Typography>
                {cashReconciliation?.summary && (
                  <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                    <Chip label={`Reconciled: ${cashReconciliation.summary.reconciledCount}/${cashReconciliation.summary.totalAccounts}`} size="small" color="success" />
                    {cashReconciliation.summary.unreconciledCount > 0 && (
                      <Chip label={`Unreconciled: ${cashReconciliation.summary.unreconciledCount}`} size="small" color="error" />
                    )}
                  </Stack>
                )}
              </Box>
              {cashReconLoading ? (
                <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Opening</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Expected</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">System</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Discrepancy</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Txns</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(cashReconciliation?.data ?? []).map((acc: Record<string, unknown>) => {
                        const discrepancy = Number(acc.discrepancy ?? 0);
                        return (
                          <TableRow key={acc.id as string} hover>
                            <TableCell><Typography variant="body2" fontWeight={500}>{String(acc.name)}</Typography></TableCell>
                            <TableCell align="right">{formatCurrency(acc.openingBalance)}</TableCell>
                            <TableCell align="right">{formatCurrency(acc.expectedBalance)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(acc.currentBalance)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, color: Math.abs(discrepancy) > 0.01 ? 'error.main' : 'success.main' }}>
                              {formatCurrency(discrepancy)}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={acc.isReconciled ? 'Reconciled' : 'Discrepancy'}
                                size="small"
                                color={acc.isReconciled ? 'success' : 'error'}
                              />
                            </TableCell>
                            <TableCell align="right">{String(acc.transactionCount ?? 0)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(cashReconciliation?.data ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary">No cash accounts</Typography></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ── Vendor Aging Tab ── */}
      {tab === 'aging' && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={600}>Vendor Payment Aging Summary</Typography>
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
              }}>Export CSV</Button>
            )}
          </Box>

          {vendorAging?.totals && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">Total Invoiced</Typography><Typography variant="h6" fontWeight={600}>{formatCurrency(vendorAging.totals.totalInvoiced)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">Total Paid</Typography><Typography variant="h6" color="success.main" fontWeight={600}>{formatCurrency(vendorAging.totals.totalPaid)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">Total Outstanding</Typography><Typography variant="h6" color="error.main" fontWeight={600}>{formatCurrency(vendorAging.totals.totalOutstanding)}</Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">Vendors</Typography><Typography variant="h6" fontWeight={600}>{(vendorAging.data as unknown[]).length}</Typography></Grid>
              </Grid>
              <Grid container spacing={1} sx={{ mt: 1 }}>
                <Grid item xs={6} sm={2.4}><Chip label={`0-30 days: ${formatCurrency(vendorAging.totals.current)}`} size="small" color="success" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={`31-60 days: ${formatCurrency(vendorAging.totals.days30)}`} size="small" color="info" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={`61-90 days: ${formatCurrency(vendorAging.totals.days60)}`} size="small" color="warning" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={`91-120 days: ${formatCurrency(vendorAging.totals.days90)}`} size="small" color="error" /></Grid>
                <Grid item xs={6} sm={2.4}><Chip label={`120+ days: ${formatCurrency(vendorAging.totals.days90Plus)}`} size="small" color="error" variant="outlined" /></Grid>
              </Grid>
            </Box>
          )}

          {agingLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : (vendorAging?.data ?? []).length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><Typography color="text.secondary">No vendor invoices found</Typography></Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Vendor</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Invoiced</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Paid</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Outstanding</TableCell>
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
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>{String(vendor.vendorName)}</Typography>
                          <Typography variant="caption" color="text.secondary">{String(vendor.vendorCode)}</Typography>
                        </TableCell>
                        <TableCell align="right">{formatCurrency(vendor.totalInvoiced)}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrency(vendor.totalPaid)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, color: Number(vendor.totalOutstanding) > 0 ? 'error.main' : 'success.main' }}>
                          {formatCurrency(vendor.totalOutstanding)}
                        </TableCell>
                        <TableCell align="right">{formatCurrency(buckets?.current ?? 0)}</TableCell>
                        <TableCell align="right">{formatCurrency(buckets?.days30 ?? 0)}</TableCell>
                        <TableCell align="right">{formatCurrency(buckets?.days60 ?? 0)}</TableCell>
                        <TableCell align="right">{formatCurrency((buckets?.days90 ?? 0) + (buckets?.days90Plus ?? 0))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}
    </Box>
  );
}
