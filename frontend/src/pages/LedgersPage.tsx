import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Stack,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Sync as SyncIcon,
  ExpandMore as ExpandMoreIcon,
  AccountBalance as LedgerIcon,
  Receipt as StatementIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import { LedgerGroup, isDebitNatureGroup } from '@hospital-erp/shared';

interface Ledger {
  id: string;
  name: string;
  group: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
}

interface SyncStatus {
  isSynced: boolean;
  totalMissing: number;
  missingVendors: string[];
  missingBanks: string[];
  missingCash: string[];
  missingOwners: string[];
  missingSystem: string[];
  existingLedgerCount: number;
}

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

const GROUP_ORDER = [
  'FIXED_ASSET', 'CURRENT_ASSET', 'BANK', 'CASH', 'SUNDRY_DEBTORS',
  'CURRENT_LIABILITY', 'LOAN', 'DUTIES_TAXES', 'CAPITAL_ACCOUNT', 'SUNDRY_CREDITORS',
  'PURCHASE', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE',
  'SALES', 'DIRECT_INCOME', 'INDIRECT_INCOME',
];

const GROUP_COLORS: Record<string, 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  FIXED_ASSET: 'primary',
  CURRENT_ASSET: 'info',
  BANK: 'info',
  CASH: 'success',
  SUNDRY_DEBTORS: 'info',
  CURRENT_LIABILITY: 'warning',
  LOAN: 'warning',
  DUTIES_TAXES: 'warning',
  CAPITAL_ACCOUNT: 'secondary',
  SUNDRY_CREDITORS: 'warning',
  PURCHASE: 'error',
  DIRECT_EXPENSE: 'error',
  INDIRECT_EXPENSE: 'error',
  SALES: 'success',
  DIRECT_INCOME: 'success',
  INDIRECT_INCOME: 'success',
};

export default function LedgersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  // Statement dialog
  const [statementLedger, setStatementLedger] = useState<Ledger | null>(null);
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['/ledgers', page, pageSize, search, groupFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (groupFilter) params.group = groupFilter;
      const response = await api.get('/ledgers', { params });
      return response.data;
    },
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ['/ledgers/sync/status'],
    queryFn: async () => {
      const response = await api.get('/ledgers/sync/status');
      return response.data;
    },
  });

  const { data: statementData, isLoading: stmtLoading } = useQuery({
    queryKey: ['/accounting-reports/ledger-statement', statementLedger?.id, stmtStartDate, stmtEndDate],
    queryFn: async () => {
      if (!statementLedger) return null;
      const params: Record<string, unknown> = { page: 1, pageSize: 200 };
      if (stmtStartDate) params.startDate = stmtStartDate;
      if (stmtEndDate) params.endDate = stmtEndDate;
      const response = await api.get(`/accounting-reports/ledger-statement/${statementLedger.id}`, { params });
      return response.data;
    },
    enabled: !!statementLedger,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) {
        const response = await api.patch(`/ledgers/${editing.id}`, payload);
        return response.data;
      }
      const response = await api.post('/ledgers', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers/sync/status'] });
      setDialogOpen(false);
      setSuccessMsg(editing ? 'Ledger updated' : 'Ledger created');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ledgers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      setSuccessMsg('Ledger deleted');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/ledgers/sync');
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers/sync/status'] });
      setSuccessMsg(`Sync complete: ${data.createdCount} created, ${data.skippedCount} already exist`);
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', group: LedgerGroup.INDIRECT_EXPENSE, openingBalance: 0, isActive: true });
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (ledger: Ledger) => {
    setEditing(ledger);
    setForm({ name: ledger.name, group: ledger.group, isActive: ledger.isActive });
    setError('');
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name) {
      setError('Ledger name is required');
      return;
    }
    setError('');
    const payload = editing
      ? { name: form.name, group: form.group, isActive: form.isActive }
      : { name: form.name, group: form.group, openingBalance: Number(form.openingBalance) || 0, isActive: form.isActive };
    createMutation.mutate(payload);
  };

  const rows: Ledger[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 100, total: 0, totalPages: 0 };

  // Group ledgers by group for accordion view
  const grouped: Record<string, Ledger[]> = {};
  for (const l of rows) {
    if (!grouped[l.group]) grouped[l.group] = [];
    grouped[l.group].push(l);
  }
  const sortedGroups = Object.keys(grouped).sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));

  const formatBalance = (balance: number, group: string) => {
    const isDebit = isDebitNatureGroup(group as LedgerGroup);
    const abs = Math.abs(balance);
    const suffix = balance === 0 ? '' : isDebit ? (balance >= 0 ? ' Dr' : ' Cr') : (balance >= 0 ? ' Dr' : ' Cr');
    return `${formatCurrency(abs)}${suffix}`;
  };

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Chart of Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Tooltip title="Auto-create ledgers for existing vendors, banks, cash, owners + seed GST/expense ledgers">
            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              Sync Ledgers
            </Button>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Ledger</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Sync status banner */}
      {syncStatus && !syncStatus.isSynced && (
        <Alert severity="info" sx={{ mb: 2 }} icon={<SyncIcon />}>
          <Typography variant="body2">
            {syncStatus.totalMissing} ledgers need to be created. Click "Sync Ledgers" to auto-create ledgers for:
            {' '}
            {[
              syncStatus.missingVendors.length > 0 && `${syncStatus.missingVendors.length} vendors`,
              syncStatus.missingBanks.length > 0 && `${syncStatus.missingBanks.length} bank accounts`,
              syncStatus.missingCash.length > 0 && `${syncStatus.missingCash.length} cash accounts`,
              syncStatus.missingOwners.length > 0 && `${syncStatus.missingOwners.length} owner accounts`,
              syncStatus.missingSystem.length > 0 && `${syncStatus.missingSystem.length} system ledgers (GST/expense)`,
            ].filter(Boolean).join(', ')}.
          </Typography>
        </Alert>
      )}

      <Card sx={{ overflow: 'hidden', mb: 2 }}>
        <Box sx={{ p: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search ledger name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            sx={{ width: { xs: '100%', sm: 250 } }}
          />
          <TextField select size="small" label="Group" value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setPage(0); }} sx={{ width: 200 }}>
            <MenuItem value="">All Groups</MenuItem>
            {GROUP_ORDER.map((g) => <MenuItem key={g} value={g}>{GROUP_LABELS[g]}</MenuItem>)}
          </TextField>
        </Box>
      </Card>

      {/* Grouped accordion view */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>Failed to load ledgers. <Button size="small" onClick={() => refetch()}>Retry</Button></Alert>
      ) : rows.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <LedgerIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            No ledgers found. Click "Sync Ledgers" to auto-create ledgers for your existing vendors, banks, and owners,
            or click "New Ledger" to create one manually.
          </Typography>
          <Button variant="contained" startIcon={<SyncIcon />} onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            Sync Now
          </Button>
        </Card>
      ) : (
        <>
          {sortedGroups.map((group) => {
            const groupLedgers = grouped[group];
            const groupTotal = groupLedgers.reduce((s, l) => s + Math.abs(l.currentBalance), 0);
            return (
              <Accordion key={group} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1 }}>
                    <Chip label={GROUP_LABELS[group] ?? group} size="small" color={GROUP_COLORS[group] ?? 'default'} />
                    <Typography variant="caption" color="text.secondary">
                      {groupLedgers.length} ledger{groupLedgers.length !== 1 ? 's' : ''}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" fontWeight={600}>
                      {formatCurrency(groupTotal)}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Ledger Name</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Opening</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Current Balance</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {groupLedgers.map((ledger) => (
                          <TableRow key={ledger.id} hover>
                            <TableCell sx={{ fontWeight: 500 }}>
                              {ledger.name}
                              {ledger.isSystem && <Chip label="System" size="small" variant="outlined" sx={{ ml: 1 }} />}
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {ledger.linkedEntityType === 'VENDOR' ? 'Vendor' :
                                 ledger.linkedEntityType === 'BANK_ACCOUNT' ? 'Bank' :
                                 ledger.linkedEntityType === 'CASH_ACCOUNT' ? 'Cash' :
                                 ledger.linkedEntityType === 'OWNER_ACCOUNT' ? 'Owner' : 'Manual'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{formatCurrency(ledger.openingBalance)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {formatBalance(ledger.currentBalance, ledger.group)}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={ledger.isActive ? 'Active' : 'Inactive'}
                                size="small"
                                color={ledger.isActive ? 'success' : 'default'}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Tooltip title="View Ledger Statement">
                                  <IconButton size="small" onClick={() => { setStatementLedger(ledger); setStmtStartDate(''); setStmtEndDate(''); }}>
                                    <StatementIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                {!ledger.isSystem && (
                                  <>
                                    <Tooltip title="Edit">
                                      <IconButton size="small" onClick={() => openEdit(ledger)}>
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Delete">
                                      <IconButton size="small" onClick={() => {
                                        if (confirm(`Delete ledger "${ledger.name}"? This cannot be undone.`)) {
                                          deleteMutation.mutate(ledger.id);
                                        }
                                      }}>
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </>
                                )}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
            );
          })}
          <TablePagination
            component="div"
            count={pagination.total}
            page={page}
            onPageChange={(_e, newPage) => setPage(newPage)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            rowsPerPageOptions={[50, 100, 200]}
          />
        </>
      )}

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Ledger' : 'New Ledger'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              size="small"
              label="Ledger Name"
              value={form.name as string ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              helperText="e.g. Rent Expense, Owner A, ABC Suppliers"
            />
            <TextField
              select
              size="small"
              label="Group"
              value={form.group as string ?? ''}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
              fullWidth
              helperText="Determines P&L vs Balance Sheet classification"
            >
              {GROUP_ORDER.map((g) => <MenuItem key={g} value={g}>{GROUP_LABELS[g]}</MenuItem>)}
            </TextField>
            {!editing && (
              <TextField
                size="small"
                type="number"
                label="Opening Balance"
                value={form.openingBalance as number ?? 0}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                fullWidth
                helperText="Enter as positive. Debit-nature groups (assets/expenses) show as Dr; credit-nature (liabilities/capital/income) as Cr."
              />
            )}
            <TextField
              select
              size="small"
              label="Status"
              value={form.isActive as boolean ?? true}
              onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}
              fullWidth
            >
              <MenuItem value="true">Active</MenuItem>
              <MenuItem value="false">Inactive</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Ledger Statement dialog */}
      <ResponsiveDialog open={!!statementLedger} onClose={() => setStatementLedger(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Ledger Statement — {statementLedger?.name}
          <Chip label={GROUP_LABELS[statementLedger?.group ?? ''] ?? statementLedger?.group} size="small" sx={{ ml: 1 }} />
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, mt: 1, flexWrap: 'wrap' }}>
            <TextField size="small" type="date" label="From" value={stmtStartDate} onChange={(e) => setStmtStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="To" value={stmtEndDate} onChange={(e) => setStmtEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>

          {stmtLoading ? (
            <CircularProgress size={32} sx={{ display: 'block', mx: 'auto', my: 4 }} />
          ) : statementData ? (
            <>
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Card sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Opening Balance</Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {formatCurrency(Math.abs(statementData.openingBalance))}
                    {statementData.openingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.openingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.openingBalance >= 0 ? ' Dr' : ' Cr'))}
                  </Typography>
                </Card>
                <Card sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Closing Balance</Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {formatCurrency(Math.abs(statementData.closingBalance))}
                    {statementData.closingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.closingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.closingBalance >= 0 ? ' Dr' : ' Cr'))}
                  </Typography>
                </Card>
              </Box>

              <TableContainer component={Card} variant="outlined">
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
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {formatCurrency(Math.abs(statementData.openingBalance))}
                        {statementData.openingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.openingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.openingBalance >= 0 ? ' Dr' : ' Cr'))}
                      </TableCell>
                    </TableRow>
                    {statementData.data.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                          <Typography color="text.secondary">No transactions in this period</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      statementData.data.map((entry: any) => (
                        <TableRow key={entry.id} hover>
                          <TableCell>{formatDate(entry.voucherDate)}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{entry.voucherNumber}</TableCell>
                          <TableCell><Chip label={entry.voucherType.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                          <TableCell>{entry.description ?? '—'}</TableCell>
                          <TableCell align="right" sx={{ color: 'error.main' }}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {formatCurrency(Math.abs(entry.balance))}
                            {entry.balance !== 0 && (statementData.ledger.isDebitNature ? (entry.balance >= 0 ? ' Dr' : ' Cr') : (entry.balance >= 0 ? ' Dr' : ' Cr'))}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : (
            <Typography color="text.secondary">No data</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatementLedger(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
