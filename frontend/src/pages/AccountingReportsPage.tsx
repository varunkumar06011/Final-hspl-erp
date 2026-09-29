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
  MenuItem,
} from '@mui/material';
import {
  AccountBalance as LedgerIcon,
  CalendarMonth as DayBookIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { ledgerGroupLabel } from '../utils/enumOptions';
import api from '../config/api';
import RefreshButton from '../components/RefreshButton';
import ResponsiveTable from '../components/ResponsiveTable';
import { formatCurrency, formatDate, todayLocalDate } from '../utils/enumOptions';
import { LedgerGroup, isDebitNatureGroup } from '@hospital-erp/shared';

import { useTranslation } from 'react-i18next';
const GROUP_ORDER = [
  'FIXED_ASSET', 'CURRENT_ASSET', 'BANK', 'CASH', 'SUNDRY_DEBTORS',
  'CURRENT_LIABILITY', 'LOAN', 'DUTIES_TAXES', 'CAPITAL_ACCOUNT', 'SUNDRY_CREDITORS',
  'PURCHASE', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE',
  'SALES', 'DIRECT_INCOME', 'INDIRECT_INCOME',
];

type TabValue = 'ledger' | 'daybook' | 'trial' | 'pl' | 'bs' | 'costcenter' | 'groupsummary';

interface Ledger {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
  openingBalance?: number;
  linkedEntityType?: string | null;
}

export default function AccountingReportsPage() {
  const { t: tr } = useTranslation('acreports');
  const [tab, setTab] = useState<TabValue>('ledger');
  const [error, setError] = useState('');

  // Ledger statement state
  const [selectedLedger, setSelectedLedger] = useState<Ledger | null>(null);
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');

  // Group summary state
  const [selectedGroup, setSelectedGroup] = useState('');

  // Day book state
  const [dayBookDate, setDayBookDate] = useState(todayLocalDate());

  // Trial balance / BS state
  const [asOfDate, setAsOfDate] = useState(todayLocalDate());

  // P&L state
  const [plStartDate, setPlStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]);
  const [plEndDate, setPlEndDate] = useState(todayLocalDate());

  // Cost center report state
  const [ccStartDate, setCcStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]);
  const [ccEndDate, setCcEndDate] = useState(todayLocalDate());

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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <RefreshButton onClick={() => setError('')} />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v: TabValue) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={tr('tabLedger')} value="ledger" />
        <Tab label={tr('tabGroup')} value="groupsummary" />
        <Tab label={tr('tabDayBook')} value="daybook" />
        <Tab label={tr('tabTrial')} value="trial" />
        <Tab label={tr('tabPl')} value="pl" />
        <Tab label={tr('tabBs')} value="bs" />
        <Tab label={tr('tabCost')} value="costcenter" />
      </Tabs>

      {/* ── Ledger Statement Tab ── */}
      {tab === 'ledger' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Autocomplete
                size="small"
                options={allLedgers}
                getOptionLabel={(option) => `${option.name} (${ledgerGroupLabel(option.group)})`}
                value={selectedLedger}
                onChange={(_, value) => setSelectedLedger(value)}
                renderInput={(params) => <TextField {...params} label={tr('selectLedger')} sx={{ minWidth: { xs: '100%', sm: 300 } }} />}
                isOptionEqualToValue={(opt, val) => opt.id === val.id}
              />
              <TextField size="small" type="date" label={tr('from')} value={stmtStartDate} onChange={(e) => setStmtStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField size="small" type="date" label={tr('to')} value={stmtEndDate} onChange={(e) => setStmtEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
          </Card>

          {!selectedLedger ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <LedgerIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography color="text.secondary">{tr('selectLedgerHint')}</Typography>
            </Card>
          ) : stmtLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : statementData ? (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">{tr('openingBalance')}</Typography>
                    <Typography variant="h6" fontWeight={600}>{formatBal(statementData.openingBalance, statementData.ledger.isDebitNature)}</Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">{tr('closingBalance')}</Typography>
                    <Typography variant="h6" fontWeight={600}>{formatBal(statementData.closingBalance, statementData.ledger.isDebitNature)}</Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">{tr('transactions')}</Typography>
                    <Typography variant="h6" fontWeight={600}>{statementData.data.length}</Typography>
                  </Card>
                </Grid>
              </Grid>

              <Card sx={{ overflow: 'hidden' }}>
                <ResponsiveTable>
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('voucher')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{tr('description')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('debit')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('credit')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('balance')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ fontWeight: 600, color: 'text.secondary' }}>{tr('openingBalance')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatBal(statementData.openingBalance, statementData.ledger.isDebitNature)}</TableCell>
                      </TableRow>
                      {statementData.data.length === 0 ? (
                        <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3 }}><Typography color="text.secondary">{tr('noTxn')}</Typography></TableCell></TableRow>
                      ) : (
                        statementData.data.map((entry: any) => (
                          <TableRow key={entry.id} hover>
                            <TableCell data-label={tr('date')}>{formatDate(entry.voucherDate)}</TableCell>
                            <TableCell data-label={tr('voucher')} sx={{ fontWeight: 600 }}>{entry.voucherNumber}</TableCell>
                            <TableCell data-label={tr('type')}><Chip label={entry.voucherType.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                            <TableCell data-label={tr('description')}>{entry.description ?? '—'}</TableCell>
                            <TableCell data-label={tr('debit')} align="right" sx={{ color: 'error.main' }}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                            <TableCell data-label={tr('credit')} align="right" sx={{ color: 'success.main' }}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                            <TableCell data-label={tr('balance')} align="right" sx={{ fontWeight: 600 }}>{formatBal(entry.balance, statementData.ledger.isDebitNature)}</TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow>
                        <TableCell colSpan={6} align="right" sx={{ fontWeight: 600, borderTop: 2 }}>{tr('closingBalance')}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, borderTop: 2 }}>{formatBal(statementData.closingBalance, statementData.ledger.isDebitNature)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
                </ResponsiveTable>
              </Card>
            </>
          ) : null}
        </Box>
      )}

      {/* ── Group Summary Tab ── */}
      {tab === 'groupsummary' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField
                select
                size="small"
                label={tr('selectGroup')}
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                sx={{ minWidth: { xs: '100%', sm: 250 } }}
              >
                <MenuItem value="">— Select a Group —</MenuItem>
                {GROUP_ORDER.map((g) => <MenuItem key={g} value={g}>{ledgerGroupLabel(g)}</MenuItem>)}
              </TextField>
              <TextField size="small" type="date" label={tr('asOf')} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
          </Card>

          {!selectedGroup ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">{tr('selectGroupHint')}</Typography>
            </Card>
          ) : (
            <Card sx={{ overflow: 'hidden' }}>
              <ResponsiveTable>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('ledgerName')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('openingBalance')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('currentBalance')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {allLedgers.filter((l) => l.group === selectedGroup).length === 0 ? (
                      <TableRow><TableCell colSpan={4} align="center"><Typography color="text.secondary" sx={{ py: 2 }}>{tr('noLedgersGroup')}</Typography></TableCell></TableRow>
                    ) : (
                      <>
                        {allLedgers.filter((l) => l.group === selectedGroup).map((l) => {
                          const isDebit = isDebitNatureGroup(l.group as LedgerGroup);
                          const absBal = Math.abs(l.currentBalance);
                          const suffix = l.currentBalance === 0 ? '' : (isDebit ? (l.currentBalance >= 0 ? ' Dr' : ' Cr') : (l.currentBalance >= 0 ? ' Dr' : ' Cr'));
                          return (
                            <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => { setSelectedLedger(l); setTab('ledger'); }}>
                              <TableCell data-label={tr('ledgerName')} sx={{ fontWeight: 500 }}>{l.name}</TableCell>
                              <TableCell data-label={tr('type')}>
                                <Typography variant="caption" color="text.secondary">
                                  {l.linkedEntityType === 'VENDOR' ? tr('lt_vendor') : l.linkedEntityType === 'BANK_ACCOUNT' ? tr('lt_bank') : l.linkedEntityType === 'CASH_ACCOUNT' ? tr('lt_cash') : l.linkedEntityType === 'OWNER_ACCOUNT' ? tr('lt_owner') : tr('lt_manual')}
                                </Typography>
                              </TableCell>
                              <TableCell data-label={tr('openingBalance')} align="right">{formatCurrency(l.openingBalance)}</TableCell>
                              <TableCell data-label={tr('currentBalance')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(absBal)}{suffix}</TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow sx={{ bgcolor: 'grey.100' }}>
                          <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Total ({ledgerGroupLabel(selectedGroup)})</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {formatCurrency(allLedgers.filter((l) => l.group === selectedGroup).reduce((s, l) => s + Math.abs(l.openingBalance ?? 0), 0))}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {formatCurrency(allLedgers.filter((l) => l.group === selectedGroup).reduce((s, l) => s + Math.abs(l.currentBalance), 0))}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
              <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                {tr('tip')}
              </Typography>
            </Card>
          )}
        </Box>
      )}

      {/* ── Day Book Tab ── */}
      {tab === 'daybook' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField size="small" type="date" label={tr('date')} value={dayBookDate} onChange={(e) => setDayBookDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {dayBookData && (
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={tr('vouchersCount', { n: dayBookData.summary.count })} size="small" />
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
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>{tr('ledger')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('debit')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('credit')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {v.entries.map((e: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell data-label={tr('ledger')}>{e.ledgerName}{e.description ? ` — ${e.description}` : ''}</TableCell>
                            <TableCell data-label={tr('debit')} align="right" sx={{ color: 'error.main' }}>{e.debit > 0 ? formatCurrency(e.debit) : '—'}</TableCell>
                            <TableCell data-label={tr('credit')} align="right" sx={{ color: 'success.main' }}>{e.credit > 0 ? formatCurrency(e.credit) : '—'}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>{tr('total')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>{formatCurrency(v.totalDebit)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1 }}>{formatCurrency(v.totalCredit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
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
            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField size="small" type="date" label={tr('asOfDate')} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {trialBalanceData && (
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={tr('totalDr', { v: formatCurrency(trialBalanceData.totals.debit) })} size="small" color="error" />
                  <Chip label={tr('totalCr', { v: formatCurrency(trialBalanceData.totals.credit) })} size="small" color="success" />
                  <Chip
                    label={Math.abs(trialBalanceData.totals.difference) < 0.01 ? tr('balanced') : tr('diff', { v: formatCurrency(trialBalanceData.totals.difference) })}
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
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('ledger')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('group')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('debit')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('credit')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trialBalanceData.groups.map((g: any) => (
                      <>
                        <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                          <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{ledgerGroupLabel(g.group)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.debit > 0 ? formatCurrency(g.debit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{g.credit > 0 ? formatCurrency(g.credit) : '—'}</TableCell>
                        </TableRow>
                        {g.ledgers.map((l: any) => (
                          <TableRow key={l.id}>
                            <TableCell data-label={tr('ledger')} sx={{ pl: 3 }}>{l.name}</TableCell>
                            <TableCell data-label={tr('group')}><Chip label={ledgerGroupLabel(l.group)} size="small" variant="outlined" /></TableCell>
                            <TableCell data-label={tr('debit')} align="right">{l.debit > 0 ? formatCurrency(l.debit) : '—'}</TableCell>
                            <TableCell data-label={tr('credit')} align="right">{l.credit > 0 ? formatCurrency(l.credit) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{tr('grandTotal')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(trialBalanceData.totals.debit)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(trialBalanceData.totals.credit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </Card>
          ) : null}
        </Box>
      )}

      {/* ── Profit & Loss Tab ── */}
      {tab === 'pl' && (
        <Box>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField size="small" type="date" label={tr('from')} value={plStartDate} onChange={(e) => setPlStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField size="small" type="date" label={tr('to')} value={plEndDate} onChange={(e) => setPlEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {plData && (
                <Chip
                  label={`${plData.isProfit ? tr('netProfit') : tr('netLoss')}: ${formatCurrency(Math.abs(plData.netProfit))}`}
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
                    <Typography variant="h6" fontWeight={600}>{tr('expenses')}</Typography>
                  </Box>
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {plData.expenses.purchases.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('purchases')}</TableCell></TableRow>
                            {plData.expenses.purchases.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalPurchases')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.purchases.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.expenses.directExpenses.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('directExpenses')}</TableCell></TableRow>
                            {plData.expenses.directExpenses.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalDirect')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.directExpenses.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.expenses.indirectExpenses.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('indirectExpenses')}</TableCell></TableRow>
                            {plData.expenses.indirectExpenses.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalIndirect')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.expenses.indirectExpenses.total)}</TableCell></TableRow>
                          </>
                        )}
                        <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{tr('totalExpenses')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(plData.expenses.total)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
                </Card>
              </Grid>

              {/* Income side */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'success.light', color: 'success.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>{tr('income')}</Typography>
                  </Box>
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {plData.income.sales.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('sales')}</TableCell></TableRow>
                            {plData.income.sales.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalSales')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.sales.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.income.directIncome.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('directIncome')}</TableCell></TableRow>
                            {plData.income.directIncome.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalDirectIncome')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.directIncome.total)}</TableCell></TableRow>
                          </>
                        )}
                        {plData.income.indirectIncome.ledgers.length > 0 && (
                          <>
                            <TableRow sx={{ bgcolor: 'grey.50' }}><TableCell colSpan={2} sx={{ fontWeight: 700 }}>{tr('indirectIncome')}</TableCell></TableRow>
                            {plData.income.indirectIncome.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('totalIndirectIncome')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(plData.income.indirectIncome.total)}</TableCell></TableRow>
                          </>
                        )}
                        <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{tr('totalIncome')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(plData.income.total)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
                </Card>
              </Grid>

              <Grid item xs={12}>
                <Card sx={{ p: 2, bgcolor: plData.isProfit ? 'success.light' : 'error.light' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" fontWeight={700}>
                      {plData.isProfit ? tr('netProfit') : tr('netLoss')}
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
            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField size="small" type="date" label={tr('asOfDate')} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              {bsData && (
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={tr('assetsV', { v: formatCurrency(bsData.totals.totalAssets) })} size="small" color="info" />
                  <Chip label={tr('liabV', { v: formatCurrency(bsData.totals.totalCapitalAndLiabilities) })} size="small" color="warning" />
                  <Chip
                    label={Math.abs(bsData.totals.difference) < 0.01 ? tr('balanced') : tr('diff', { v: formatCurrency(bsData.totals.difference) })}
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
                    <Typography variant="h6" fontWeight={600}>{tr('assets')}</Typography>
                  </Box>
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {bsData.assets.map((g: any) => (
                          <>
                            <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                              <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{ledgerGroupLabel(g.group)}</TableCell>
                            </TableRow>
                            {g.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('subtotal')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(g.total)}</TableCell></TableRow>
                          </>
                        ))}
                        <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{tr('totalAssets')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(bsData.totals.totalAssets)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
                </Card>
              </Grid>

              {/* Liabilities + Capital */}
              <Grid item xs={12} md={6}>
                <Card sx={{ overflow: 'hidden' }}>
                  <Box sx={{ p: 2, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
                    <Typography variant="h6" fontWeight={600}>{tr('liabilitiesCapital')}</Typography>
                  </Box>
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {bsData.liabilities.map((g: any) => (
                          <>
                            <TableRow key={g.group} sx={{ bgcolor: 'grey.50' }}>
                              <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{ledgerGroupLabel(g.group)}</TableCell>
                            </TableRow>
                            {g.ledgers.map((l: any) => (
                              <TableRow key={l.id}><TableCell data-label={tr('particulars')} sx={{ pl: 3 }}>{l.name}</TableCell><TableCell data-label={tr('amount')} align="right">{formatCurrency(l.amount)}</TableCell></TableRow>
                            ))}
                            <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 600 }}>{tr('subtotal')}</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 600 }}>{formatCurrency(g.total)}</TableCell></TableRow>
                          </>
                        ))}
                        {/* Net P&L as part of capital */}
                        <TableRow sx={{ bgcolor: bsData.netProfit >= 0 ? 'success.light' : 'error.light' }}>
                          <TableCell data-label={tr('particulars')} sx={{ fontWeight: 700 }}>{bsData.netProfit >= 0 ? 'Net Profit (added to Capital)' : 'Net Loss (reduced from Capital)'}</TableCell>
                          <TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 700 }}>{formatCurrency(Math.abs(bsData.netProfit))}</TableCell>
                        </TableRow>
                        <TableRow><TableCell data-label={tr('particulars')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>Total Liabilities + Capital</TableCell><TableCell data-label={tr('amount')} align="right" sx={{ fontWeight: 700, borderTop: 2 }}>{formatCurrency(bsData.totals.totalCapitalAndLiabilities)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
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
            <TextField size="small" type="date" label={tr('from')} value={ccStartDate} onChange={(e) => setCcStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label={tr('to')} value={ccEndDate} onChange={(e) => setCcEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>
          {ccLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
          ) : ccData ? (
            <Box>
              {/* Summary cards */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">{tr('totalAllocated')}</Typography>
                    <Typography variant="h6">{formatCurrency(ccData.totals.totalAllocated)}</Typography>
                  </CardContent></Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">{tr('totalSpentFromLedger')}</Typography>
                    <Typography variant="h6" color="error.main">{formatCurrency(ccData.totals.totalSpent)}</Typography>
                  </CardContent></Card>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Card><CardContent>
                    <Typography variant="caption" color="text.secondary">{tr('remaining')}</Typography>
                    <Typography variant="h6" color={ccData.totals.totalRemaining >= 0 ? 'success.main' : 'error.main'}>{formatCurrency(ccData.totals.totalRemaining)}</Typography>
                  </CardContent></Card>
                </Grid>
              </Grid>

              <ResponsiveTable>
              <TableContainer component={Card}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{tr('budgetHead')}</TableCell>
                      <TableCell align="right">{tr('allocated')}</TableCell>
                      <TableCell align="right">{tr('committedPo')}</TableCell>
                      <TableCell align="right">{tr('actualGrn')}</TableCell>
                      <TableCell align="right">{tr('paid')}</TableCell>
                      <TableCell align="right">{tr('ledgerDr')}</TableCell>
                      <TableCell align="right">{tr('ledgerCr')}</TableCell>
                      <TableCell align="right">{tr('net')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ccData.costCenters.map((cc: any) => (
                      <TableRow key={cc.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell data-label={tr('budgetHead')} sx={{ fontWeight: 500 }}>{cc.particulars}</TableCell>
                        <TableCell data-label={tr('allocated')} align="right">{formatCurrency(cc.allocatedAmount)}</TableCell>
                        <TableCell data-label={tr('committedPo')} align="right">{formatCurrency(cc.committedAmount)}</TableCell>
                        <TableCell data-label={tr('actualGrn')} align="right">{formatCurrency(cc.actualAmount)}</TableCell>
                        <TableCell data-label={tr('paid')} align="right">{formatCurrency(cc.paidAmount)}</TableCell>
                        <TableCell data-label={tr('ledgerDr')} align="right" sx={{ color: 'error.main' }}>{formatCurrency(cc.totalDebit)}</TableCell>
                        <TableCell data-label={tr('ledgerCr')} align="right" sx={{ color: 'success.main' }}>{formatCurrency(cc.totalCredit)}</TableCell>
                        <TableCell data-label={tr('net')} align="right" sx={{ fontWeight: 600, color: cc.netAmount > 0 ? 'error.main' : 'success.main' }}>{formatCurrency(cc.netAmount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ borderTop: 2 }}>
                      <TableCell sx={{ fontWeight: 700 }}>{tr('total')}</TableCell>
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
              </ResponsiveTable>
            </Box>
          ) : (
            <Typography color="text.secondary">{tr('noDataAvailable')}</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
