import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Chip,
  Alert,
  CircularProgress,
  Stack,
  Tabs,
  Tab,
  Grid,
  Autocomplete,
} from '@mui/material';
import {
  AccountBalance as LedgerIcon,
  CalendarMonth as DayBookIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatDate } from '../utils/enumOptions';

type TabValue = 'ledger' | 'daybook' | 'trial' | 'pl' | 'bs' | 'costcenter';

const GROUP_LABELS: Record<string, string> = {
  FIXED_ASSET: 'Fixed Assets',
  CURRENT_ASSET: 'Current Assets',
  BANK: 'Bank Accounts',
  CASH: 'Cash in Hand',
  CURRENT_LIABILITY: 'Current Liabilities',
  LOAN: 'Loans (Liabilities)',
  DUTIES_TAXES: 'Duties & Taxes',
  CAPITAL_ACCOUNT: 'Capital Account',
  SUNDRY_CREDITORS: 'Sundry Creditors',
  SUNDRY_DEBTORS: 'Sundry Debtors',
  DIRECT_EXPENSE: 'Direct Expenses',
  INDIRECT_EXPENSE: 'Indirect Expenses',
  PURCHASE: 'Purchase',
  DIRECT_INCOME: 'Direct Income',
  INDIRECT_INCOME: 'Indirect Income',
  SALES: 'Sales',
};

interface Ledger {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
}

export default function AccountingReportsPage() {
  const [tab, setTab] = useState<TabValue>('ledger');
  const [error, setError] = useState('');

  // Ledger statement state
  const [selectedLedger, setSelectedLedger] = useState<Ledger | null>(null);
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');

  // Day book state
  const [dayBookDate, setDayBookDate] = useState(new Date().toISOString().split('T')[0]);

  // Trial balance / BS state
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);

  // P&L state
  const [plStartDate, setPlStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]);
  const [plEndDate, setPlEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Cost center report state
  const [ccStartDate, setCcStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]);
  const [ccEndDate, setCcEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Fetch all ledgers for autocomplete
  const { data: ledgersData } = useQuery({
    queryKey: ['/ledgers', 'all-for-reports'],
    queryFn: async () => {
      const response = await api.get('/ledgers', { params: { page: 1, pageSize: 100, isActive: true } });
      return response.data;
    },
  });
  const allLedgers: Ledger[] = ledgersData?.data ?? [];

  // Ledger statement query
  const { data: statementData, isLoading: stmtLoading } = useQuery({
    queryKey: ['/accounting-reports/ledger-statement', selectedLedger?.id, stmtStartDate, stmtEndDate],
    queryFn: async () => {
      if (!selectedLedger) return null;
      const params: Record<string, unknown> = { page: 1, pageSize: 100 };
      if (stmtStartDate) params.startDate = stmtStartDate;
      if (stmtEndDate) params.endDate = stmtEndDate;
      const response = await api.get(`/accounting-reports/ledger-statement/${selectedLedger.id}`, { params });
      return response.data;
    },
    enabled: !!selectedLedger && tab === 'ledger',
  });

  // Day book query
  const { data: dayBookData, isLoading: dayBookLoading } = useQuery({
    queryKey: ['/accounting-reports/day-book', dayBookDate],
    queryFn: async () => {
      const response = await api.get('/accounting-reports/day-book', { params: { date: dayBookDate, page: 1, pageSize: 200 } });
      return response.data;
    },
    enabled: tab === 'daybook',
  });

  // Trial balance query
  const { data: trialBalanceData, isLoading: trialLoading } = useQuery({
    queryKey: ['/accounting-reports/trial-balance', asOfDate],
    queryFn: async () => {
      const response = await api.get('/accounting-reports/trial-balance', { params: { asOfDate } });
      return response.data;
    },
    enabled: tab === 'trial',
  });

  // P&L query
  const { data: plData, isLoading: plLoading } = useQuery({
    queryKey: ['/accounting-reports/profit-loss', plStartDate, plEndDate],
    queryFn: async () => {
      const response = await api.get('/accounting-reports/profit-loss', { params: { startDate: plStartDate, endDate: plEndDate } });
      return response.data;
    },
    enabled: tab === 'pl',
  });

  // Balance sheet query
  const { data: bsData, isLoading: bsLoading } = useQuery({
    queryKey: ['/accounting-reports/balance-sheet', asOfDate],
    queryFn: async () => {
      const response = await api.get('/accounting-reports/balance-sheet', { params: { asOfDate } });
      return response.data;
    },
    enabled: tab === 'bs',
  });

  // Cost center report
  const { data: ccData, isLoading: ccLoading } = useQuery({
    queryKey: ['/accounting-reports/cost-center', ccStartDate, ccEndDate],
    queryFn: async () => {
      const response = await api.get('/accounting-reports/cost-center', { params: { startDate: ccStartDate, endDate: ccEndDate } });
      return response.data;
    },
    enabled: tab === 'costcenter',
  });

  const formatBal = (balance: number, isDebitNature?: boolean) => {
    const abs = Math.abs(balance);
    if (balance === 0) return formatCurrency(0);
    const suffix = isDebitNature !== undefined
      ? (isDebitNature ? (balance >= 0 ? ' Dr' : ' Cr') : (balance >= 0 ? ' Dr' : ' Cr'))
      : '';
    return `${formatCurrency(abs)}${suffix}`;
  };

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Accounting Reports</Typography>
        <RefreshButton onClick={() => setError('')} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v: TabValue) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Ledger Statement" value="ledger" />
        <Tab label="Day Book" value="daybook" />
        <Tab label="Trial Balance" value="trial" />
        <Tab label="Profit & Loss" value="pl" />
        <Tab label="Balance Sheet" value="bs" />
        <Tab label="Cost Center" value="costcenter" />
      </Tabs>

      {/* ── Ledger Statement Tab ── */}
      {tab === 'ledger' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Autocomplete
                size="small"
                options={allLedgers}
                getOptionLabel={(option) => `${option.name} (${GROUP_LABELS[option.group] ?? option.group})`}
                value={selectedLedger}
                onChange={(_, value) => setSelectedLedger(value)}
                renderInput={(params) => <TextField {...params} label="Select Ledger" sx={{ minWidth: 300 }} />}
                isOptionEqualToValue={(opt, val) => opt.id === val.id}
              />
              <TextField size="small" type="date" label="From" value={stmtStartDate} onChange={(e) => setStmtStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField size="small" type="date" label="To" value={stmtEndDate} onChange={(e) => setStmtEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
          </Card>

          {!selectedLedger ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <LedgerIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography color="text.secondary">Select a ledger above to view its statement.</Typography>
            </Card>
          ) : stmtLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : statementData ? (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Opening Balance</Typography>
                    <Typography variant="h6" fontWeight={600}>{formatBal(statementData.openingBalance, statementData.ledger.isDebitNature)}</Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Closing Balance</Typography>
                    <Typography variant="h6" fontWeight={600}>{formatBal(statementData.closingBalance, statementData.ledger.isDebitNature)}</Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Transactions</Typography>
                    <Typography variant="h6" fontWeight={600}>{statementData.data.length}</Typography>
                  </Card>
                </Grid>
              </Grid>

              <Card sx={{ overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Voucher</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Balance</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ fontWeight: 600, color: 'text.secondary' }}>Opening Balance</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatBal(statementData.openingBalance, statementData.ledger.isDebitNature)}</TableCell>
                      </TableRow>
                      {statementData.data.length === 0 ? (
                        <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3 }}><Typography color="text.secondary">No transactions in this period</Typography></TableCell></TableRow>
                      ) : (
                        statementData.data.map((entry: any) => (
                          <TableRow key={entry.id} hover>
                            <TableCell>{formatDate(entry.voucherDate)}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{entry.voucherNumber}</TableCell>
                            <TableCell><Chip label={entry.voucherType.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                            <TableCell>{entry.description ?? '—'}</TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                            <TableCell align="right" sx={{ color: 'success.main' }}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{formatBal(entry.balance, statementData.ledger.isDebitNature)}</TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow>
                        <TableCell colSpan={6} align="right" sx={{ fontWeight: 600, borderTop: 2 }}>Closing Balance</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, borderTop: 2 }}>{formatBal(statementData.closingBalance, statementData.ledger.isDebitNature)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            </>
          ) : null}
        </Box>
      )}

      {/* ── Day Book Tab ── */}
      {tab === 'daybook' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField size="small" type="date" label="Date" value={dayBookDate} onChange={(e) => setDayBookDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {dayBookData && (
                <Stack direction="row" spacing={2}>
                  <Chip label={`${dayBookData.summary.count} vouchers`} size="small" />
                  <Chip label={`Dr ${formatCurrency(dayBookData.summary.totalDebit)}`} size="small" color="error" />
                  <Chip label={`Cr ${formatCurrency(dayBookData.summary.totalCredit)}`} size="small" color="success" />
                </Stack>
              )}
            </Stack>
          </Card>

          {dayBookLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : dayBookData?.data.length === 0 ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <DayBookIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography color="text.secondary">No vouchers posted on {formatDate(dayBookDate)}.</Typography>
            </Card>
          ) : (
            <Stack spacing={2}>
              {dayBookData?.data.map((v: any) => (
                <Card key={v.id} sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle1" fontWeight={600}>{v.jvNumber}</Typography>
                      <Chip label={v.voucherType.replace(/_/g, ' ')} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">{formatDate(v.date)} · {v.createdBy}</Typography>
                  </Stack>
                  {v.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{v.description}</Typography>}
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Ledger</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {v.entries.map((e: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell>{e.ledgerName}{e.description ? ` — ${e.description}` : ''}</TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>{e.debit > 0 ? formatCurrency(e.debit) : '—'}</TableCell>
                            <TableCell align="right" sx={{ color: 'success.main' }}>{e.credit > 0 ? formatCurrency(e.credit) : '—'}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>Total</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>{formatCurrency(v.totalDebit)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>{formatCurrency(v.totalCredit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ── Trial Balance Tab ── */}
      {tab === 'trial' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField size="small" type="date" label="As of Date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {trialBalanceData && (
                <Stack direction="row" spacing={2}>
                  <Chip label={`Total Dr: ${formatCurrency(trialBalanceData.totals.debit)}`} size="small" color="error" />
                  <Chip label={`Total Cr: ${formatCurrency(trialBalanceData.totals.credit)}`} size="small" color="success" />
                  <Chip
                    label={Math.abs(trialBalanceData.totals.difference) < 0.01 ? 'Balanced' : `Diff: ${formatCurrency(trialBalanceData.totals.difference)}`}
                    size="small"
                    color={Math.abs(trialBalanceData.totals.difference) < 0.01 ? 'success' : 'error'}
                  />
                </Stack>
              )}
            </Stack>
          </Card>

          {trialLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : trialBalanceData ? (
            <Card sx={{ overflow: 'hidden' }}>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Ledger</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Group</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trialBalanceData.groups.map((g: any) => (
                      <>
                        <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                          <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{GROUP_LABELS[g.group] ?? g.group}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.debit > 0 ? formatCurrency(g.debit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.credit > 0 ? formatCurrency(g.credit) : '—'}</TableCell>
                        </TableRow>
                        {g.ledgers.map((l: any) => (
                          <TableRow key={l.id}>
                            <TableCell sx={{ pl: 3 }}>{l.name}</TableCell>
                            <TableCell><Chip label={GROUP_LABELS[l.group] ?? l.group} size="small" variant="outlined" /></TableCell>
                            <TableCell align="right">{l.debit > 0 ? formatCurrency(l.debit) : '—'}</TableCell>
                            <TableCell align="right">{l.credit > 0 ? formatCurrency(l.credit) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Grand Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(trialBalanceData.totals.debit)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(trialBalanceData.totals.credit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          ) : null}
        </Box>
      )}

      {/* ── Profit & Loss Tab ── */}
      {tab === 'pl' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField size="small" type="date" label="From" value={plStartDate} onChange={(e) => setPlStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField size="small" type="date" label="To" value={plEndDate} onChange={(e) => setPlEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {plData && (
                <Chip
                  label={`${plData.isProfit ? 'Net Profit' : 'Net Loss'}: ${formatCurrency(Math.abs(plData.netProfit))}`}
                  color={plData.isProfit ? 'success' : 'error'}
                />
              )}
            </Stack>
          </Card>

          {plLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : plData ? (
            <Grid container spacing={2}>
              {/* Expenses side */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'error.light', color: 'error.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>Expenses</Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {plData.expenses.purchases.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Purchases</TableCell></TableRow>
                            {plData.expenses.purchases.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Purchases</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.purchases.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.expenses.directExpenses.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Direct Expenses</TableCell></TableRow>
                            {plData.expenses.directExpenses.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Direct</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.directExpenses.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.expenses.indirectExpenses.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Indirect Expenses</TableCell></TableRow>
                            {plData.expenses.indirectExpenses.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Indirect</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.indirectExpenses.total)}</TableCell></TableRow>
                          </>
                        )}
                        <TableRow><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Total Expenses</TableCell><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(plData.expenses.total)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>

              {/* Income side */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'success.light', color: 'success.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>Income</Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {plData.income.sales.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Sales</TableCell></TableRow>
                            {plData.income.sales.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Sales</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.sales.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.income.directIncome.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Direct Income</TableCell></TableRow>
                            {plData.income.directIncome.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Direct Income</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.directIncome.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.income.indirectIncome.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>Indirect Income</TableCell></TableRow>
                            {plData.income.indirectIncome.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Total Indirect Income</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.indirectIncome.total)}</TableCell></TableRow>
                          </>
                        )}
                        <TableRow><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Total Income</TableCell><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(plData.income.total)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>

              <Grid item xs={12}>
                <Card sx={{ p: 2, bgcolor: plData.isProfit ? 'success.light' : 'error.light' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" fontWeight={700}>
                      {plData.isProfit ? 'Net Profit' : 'Net Loss'}
                    </Typography>
                    <Typography variant="h5" fontWeight={700}>
                      {formatCurrency(Math.abs(plData.netProfit))}
                    </Typography>
                  </Stack>
                </Card>
              </Grid>
            </Grid>
          ) : null}
        </Box>
      )}

      {/* ── Balance Sheet Tab ── */}
      {tab === 'bs' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField size="small" type="date" label="As of Date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {bsData && (
                <Stack direction="row" spacing={2}>
                  <Chip label={`Assets: ${formatCurrency(bsData.totals.totalAssets)}`} size="small" color="info" />
                  <Chip label={`Liabilities+Capital: ${formatCurrency(bsData.totals.totalCapitalAndLiabilities)}`} size="small" color="warning" />
                  <Chip
                    label={Math.abs(bsData.totals.difference) < 0.01 ? 'Balanced' : `Diff: ${formatCurrency(bsData.totals.difference)}`}
                    size="small"
                    color={Math.abs(bsData.totals.difference) < 0.01 ? 'success' : 'error'}
                  />
                </Stack>
              )}
            </Stack>
          </Card>

          {bsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : bsData ? (
            <Grid container spacing={2}>
              {/* Assets */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'info.light', color: 'info.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>Assets</Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {bsData.assets.map((g: any) => (
                          <>
                            <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                              <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{GROUP_LABELS[g.group] ?? g.group}</TableCell>
                            </TableRow>
                            {g.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Subtotal</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(g.total)}</TableCell></TableRow>
                          </>
                        ))}
                        <TableRow><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Total Assets</TableCell><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(bsData.totals.totalAssets)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>

              {/* Liabilities + Capital */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>Liabilities & Capital</Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {bsData.liabilities.map((g: any) => (
                          <>
                            <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                              <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{GROUP_LABELS[g.group] ?? g.group}</TableCell>
                            </TableRow>
                            {g.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell sx={{ pl: 3 }}>{l.name}</TableCell><TableCell align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell align="right" sx={{ fontWeight: 600 }}>Subtotal</TableCell><TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(g.total)}</TableCell></TableRow>
                          </>
                        ))}
                        {/* Net P&L as part of capital */}
                        <TableRow sx={{ bgcolor: bsData.netProfit >= 0 ? 'success.light' : 'error.light' }}>
                          <TableCell sx={{ fontWeight: 700 }}>{bsData.netProfit >= 0 ? 'Net Profit (added to Capital)' : 'Net Loss (reduced from Capital)'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(Math.abs(bsData.netProfit))}</TableCell>
                        </TableRow>
                        <TableRow><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Total Liabilities + Capital</TableCell><TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(bsData.totals.totalCapitalAndLiabilities)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>
            </Grid>
          ) : null}
        </Box>
      )}

      {/* ── Cost Center Report ── */}
      {tab === 'costcenter' && (
        <Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <TextField size="small" type="date" label="From" value={ccStartDate} onChange={(e) => setCcStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="To" value={ccEndDate} onChange={(e) => setCcEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>
          {ccLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
          ) : ccData ? (
            <Box>
              {/* Summary cards */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">Total Allocated</Typography>
                    <Typography variant="h6">{formatCurrency(ccData.totals.totalAllocated)}</Typography>
                  </CardContent></Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">Total Spent (from ledger)</Typography>
                    <Typography variant="h6" color="error.main">{formatCurrency(ccData.totals.totalSpent)}</Typography>
                  </CardContent></Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">Remaining</Typography>
                    <Typography variant="h6" color={ccData.totals.totalRemaining >= 0 ? 'success.main' : 'error.main'}>{formatCurrency(ccData.totals.totalRemaining)}</Typography>
                  </CardContent></Card>
                </Grid>
              </Grid>

              <TableContainer component={Card}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Budget Head</TableCell>
                      <TableCell align="right">Allocated</TableCell>
                      <TableCell align="right">Committed (PO)</TableCell>
                      <TableCell align="right">Actual (GRN)</TableCell>
                      <TableCell align="right">Paid</TableCell>
                      <TableCell align="right">Ledger Dr</TableCell>
                      <TableCell align="right">Ledger Cr</TableCell>
                      <TableCell align="right">Net</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ccData.costCenters.map((cc: any) => (
                      <TableRow key={cc.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell sx={{ fontWeight: 500 }}>{cc.particulars}</TableCell>
                        <TableCell align="right">{formatCurrency(cc.allocatedAmount)}</TableCell>
                        <TableCell align="right">{formatCurrency(cc.committedAmount)}</TableCell>
                        <TableCell align="right">{formatCurrency(cc.actualAmount)}</TableCell>
                        <TableCell align="right">{formatCurrency(cc.paidAmount)}</TableCell>
                        <TableCell align="right" sx={{ color: 'error.main' }}>{formatCurrency(cc.totalDebit)}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrency(cc.totalCredit)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, color: cc.netAmount > 0 ? 'error.main' : 'success.main' }}>{formatCurrency(cc.netAmount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ borderTop: 2 }}>
                      <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(ccData.totals.totalAllocated)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(ccData.costCenters.reduce((s: number, c: any) => s + c.committedAmount, 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(ccData.costCenters.reduce((s: number, c: any) => s + c.actualAmount, 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(ccData.costCenters.reduce((s: number, c: any) => s + c.paidAmount, 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>{formatCurrency(ccData.costCenters.reduce((s: number, c: any) => s + c.totalDebit, 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>{formatCurrency(ccData.costCenters.reduce((s: number, c: any) => s + c.totalCredit, 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(ccData.totals.totalSpent)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          ) : (
            <Typography color="text.secondary">No data available</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
