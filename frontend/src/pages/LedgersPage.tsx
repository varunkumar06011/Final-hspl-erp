import { Fragment, useState } from 'react';
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
  Tabs,
  Tab,
  Link,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Sync as SyncIcon,
  ExpandMore as ExpandMoreIcon,
  AccountBalance as LedgerIcon,
  Receipt as StatementIcon,
  AccountTree as GroupsIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import { formatCurrency, formatDate } from '../utils/enumOptions';
import {
  exportLedgerStatementPdf,
  exportLedgerStatementExcel,
  printLedgerStatement,
  type LedgerStatementData,
  type LedgerStatementMeta,
} from '../utils/ledgerStatementExport';
import { LedgerGroup, isDebitNatureGroup } from '@hospital-erp/shared';
import { ledgerGroupLabel } from '../utils/enumOptions';
import { useDeepLinkRow } from '../hooks/useDeepLinkRow';
import { useUrlFilters } from '../hooks/useUrlFilters';

import { useTranslation } from 'react-i18next';
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
  const { t: tr } = useTranslation('ledgers');
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [tab, setTab] = useState<'ledgers' | 'groups'>('ledgers');

  // Group management state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; parentGroup: string } | null>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; parentGroup: string }>({ name: '', parentGroup: LedgerGroup.INDIRECT_EXPENSE });
  const [groupError, setGroupError] = useState('');

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  // Statement dialog
  const [statementLedger, setStatementLedger] = useState<Ledger | null>(null);
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');

  // Export format selection dialog
  const [exportFormatOpen, setExportFormatOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

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

  // ── Ledger statement export/print helpers ────────────────────────────────
  // These consume the CURRENT statementData (already filtered by the selected
  // date range) — they do NOT re-fetch or change any filtering/calculation.
  const buildStatementMeta = (): LedgerStatementMeta => ({
    ledgerName: statementLedger?.name ?? 'Ledger',
    ledgerGroup: ledgerGroupLabel(statementLedger?.group ?? ''),
    startDate: stmtStartDate,
    endDate: stmtEndDate,
  });

  const handleExportPdf = async () => {
    if (!statementData) return;
    setExportBusy(true);
    setExportError('');
    try {
      await exportLedgerStatementPdf(statementData as LedgerStatementData, buildStatementMeta());
      setExportFormatOpen(false);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate PDF');
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportExcel = () => {
    if (!statementData) return;
    setExportBusy(true);
    setExportError('');
    try {
      exportLedgerStatementExcel(statementData as LedgerStatementData, buildStatementMeta());
      setExportFormatOpen(false);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate Excel file');
    } finally {
      setExportBusy(false);
    }
  };

  const handlePrint = async () => {
    if (!statementData) return;
    setExportError('');
    try {
      await printLedgerStatement(statementData as LedgerStatementData, buildStatementMeta());
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to initiate printing');
    }
  };

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
      setSuccessMsg(editing ? tr('okUpd') : tr('okCre'));
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
      setSuccessMsg(tr('okDel'));
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
      setSuccessMsg(tr('syncDone', { c: data.createdCount, s: data.skippedCount }));
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  // Fetch custom groups
  const { data: customGroupsData } = useQuery({
    queryKey: ['/ledgers/groups'],
    queryFn: async () => {
      const response = await api.get('/ledgers/groups');
      return response.data;
    },
  });
  const customGroups: { id: string; name: string; parentGroup: string }[] = customGroupsData?.data ?? [];
  const ledgerGroupOptions = [
    ...GROUP_ORDER.map((value) => ({ value, label: ledgerGroupLabel(value) })),
    ...customGroups.map((group) => ({ value: group.name, label: tr('underLine', { name: group.name, parent: ledgerGroupLabel(group.parentGroup) }) })),
  ];

  const createGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; parentGroup: string }) => {
      const response = await api.post('/ledgers/groups', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers/groups'] });
      setGroupDialogOpen(false);
      setGroupForm({ name: '', parentGroup: LedgerGroup.INDIRECT_EXPENSE });
      setGroupError('');
      setSuccessMsg(tr('gCre'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setGroupError(extractErrorMessage(err)),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string; parentGroup: string }) => {
      const response = await api.patch(`/ledgers/groups/${payload.id}`, { name: payload.name, parentGroup: payload.parentGroup });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers/groups'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      setGroupDialogOpen(false);
      setEditingGroup(null);
      setGroupForm({ name: '', parentGroup: LedgerGroup.INDIRECT_EXPENSE });
      setGroupError('');
      setSuccessMsg(tr('gUpd'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setGroupError(extractErrorMessage(err)),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ledgers/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers/groups'] });
      setSuccessMsg(tr('gDel'));
      setTimeout(() => setSuccessMsg(''), 3000);
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
      setError(tr('errName'));
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

  // Deep-link from global search: ?id=<ledgerId> — filter to that ledger and highlight it
  const { highlightId: ledgerHighlightId, rowRef: ledgerRowRef } = useDeepLinkRow<Ledger>('/ledgers', rows, 'name', setSearch);
  useUrlFilters({ search: (v) => { setSearch(v); setPage(0); }, group: (v) => { setGroupFilter(v); setPage(0); } });

  // Group ledgers by group and render custom subgroups beneath their primary parent.
  const grouped: Record<string, Ledger[]> = {};
  for (const ledger of rows) {
    if (!grouped[ledger.group]) grouped[ledger.group] = [];
    grouped[ledger.group].push(ledger);
  }
  const visibleCustomGroups = groupFilter
    ? GROUP_ORDER.includes(groupFilter)
      ? customGroups.filter((group) => group.parentGroup === groupFilter)
      : customGroups.filter((group) => group.name === groupFilter)
    : search
      // When searching, only show custom sub-groups that actually have matching ledgers
      // so empty group headers (Sundry Creditors, Loans, etc.) don't clutter results.
      ? customGroups.filter((group) => (grouped[group.name] ?? []).length > 0)
      : customGroups;
  const customGroupsByParent = visibleCustomGroups.reduce<Record<string, typeof customGroups>>((groups, group) => {
    if (!groups[group.parentGroup]) groups[group.parentGroup] = [];
    groups[group.parentGroup].push(group);
    return groups;
  }, {});
  const sortedGroups = GROUP_ORDER.filter((group) => grouped[group] || customGroupsByParent[group]);

  const formatBalance = (balance: number, group: string) => {
    const isDebit = isDebitNatureGroup(group as LedgerGroup);
    const abs = Math.abs(balance);
    const suffix = balance === 0 ? '' : isDebit ? (balance >= 0 ? ' Dr' : ' Cr') : (balance >= 0 ? ' Dr' : ' Cr');
    return `${formatCurrency(abs)}${suffix}`;
  };

  const renderLedgerRow = (ledger: Ledger) => (
    <TableRow key={ledger.id} hover ref={ledgerRowRef(ledger.id)} sx={{ ...(ledgerHighlightId === ledger.id && { bgcolor: 'warning.light', '&:hover': { bgcolor: 'warning.light' } }) }}>
      <TableCell sx={{ fontWeight: 500 }} data-label={tr('ledgerName')}>
        {ledger.name}
        {ledger.isSystem && <Chip label={tr('system')} size="small" variant="outlined" sx={{ ml: 1 }} />}
      </TableCell>
      <TableCell data-label={tr('type')}>
        <Typography variant="caption" color="text.secondary">
          {ledger.linkedEntityType === 'VENDOR' ? tr('lt_vendor') :
           ledger.linkedEntityType === 'BANK_ACCOUNT' ? tr('lt_bank') :
           ledger.linkedEntityType === 'CASH_ACCOUNT' ? tr('lt_cash') :
           ledger.linkedEntityType === 'OWNER_ACCOUNT' ? tr('lt_owner') : tr('lt_manual')}
        </Typography>
      </TableCell>
      <TableCell align="right" data-label={tr('opening')}>{formatCurrency(ledger.openingBalance)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }} data-label={tr('currentBalance')}>
        {formatBalance(ledger.currentBalance, ledger.group)}
      </TableCell>
      <TableCell data-label={tr('status')}>
        <Chip label={ledger.isActive ? tr('active') : tr('inactive')} size="small" color={ledger.isActive ? 'success' : 'default'} />
      </TableCell>
      <TableCell align="right" data-label={tr('actions')}>
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title={tr('viewLedgerStatement')}>
            <IconButton size="small" onClick={() => { setStatementLedger(ledger); setStmtStartDate(''); setStmtEndDate(''); }}>
              <StatementIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {!ledger.isSystem && (
            <>
              <Tooltip title={tr('edit')}>
                <IconButton size="small" onClick={() => openEdit(ledger)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={tr('delete')}>
                <IconButton size="small" onClick={() => {
                  if (confirm(tr('confirmDelLedger', { n: ledger.name }))) deleteMutation.mutate(ledger.id);
                }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );

  return (
    <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {tr('title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <RefreshButton onClick={() => refetch()} />
          <Tooltip title={tr('syncTip')}>
            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {tr('syncLedgers')}
            </Button>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr('newLedger')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={tr('tabLedgers')} value="ledgers" />
        <Tab label={tr('tabGroups')} value="groups" />
      </Tabs>

      {/* Sync status banner */}
      {tab === 'ledgers' && syncStatus && !syncStatus.isSynced && (
        <Alert severity="info" sx={{ mb: 2 }} icon={<SyncIcon />}>
          <Typography variant="body2">
            {tr('needSync', { n: syncStatus.totalMissing })}
            {' '}
            {[
              syncStatus.missingVendors.length > 0 && tr('mVendors', { n: syncStatus.missingVendors.length }),
              syncStatus.missingBanks.length > 0 && tr('mBanks', { n: syncStatus.missingBanks.length }),
              syncStatus.missingCash.length > 0 && tr('mCash', { n: syncStatus.missingCash.length }),
              syncStatus.missingOwners.length > 0 && tr('mOwners', { n: syncStatus.missingOwners.length }),
              syncStatus.missingSystem.length > 0 && tr('mSystem', { n: syncStatus.missingSystem.length }),
            ].filter(Boolean).join(', ')}.
          </Typography>
        </Alert>
      )}

      {tab === 'ledgers' && (
        <Card sx={{ overflow: 'hidden', mb: 2 }}>
          <Box sx={{ p: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder={tr('search')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
              sx={{ width: { xs: '100%', sm: 250 } }}
            />
            <TextField select size="small" label={tr('group')} value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setPage(0); }} sx={{ width: 200 }}>
              <MenuItem value="">{tr('allGroups')}</MenuItem>
              {ledgerGroupOptions.map((group) => <MenuItem key={group.value} value={group.value}>{group.label}</MenuItem>)}
            </TextField>
          </Box>
        </Card>
      )}

      {/* ── Groups management tab ── */}
      {tab === 'groups' && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {tr('groupsNote')}
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setGroupForm({ name: '', parentGroup: LedgerGroup.INDIRECT_EXPENSE }); setGroupError(''); setGroupDialogOpen(true); }}>
              {tr('newSubgroup')}
            </Button>
          </Box>

          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>{tr('predefinedGroups15Primary')}</Typography>
          <Card sx={{ overflow: 'hidden', mb: 3 }}>
            <ResponsiveTable>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('groupName')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('nature')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{tr('appearsIn')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {GROUP_ORDER.map((g) => {
                    const isDebit = isDebitNatureGroup(g as LedgerGroup);
                    const isBS = ['FIXED_ASSET', 'CURRENT_ASSET', 'BANK', 'CASH', 'SUNDRY_DEBTORS', 'CURRENT_LIABILITY', 'LOAN', 'DUTIES_TAXES', 'CAPITAL_ACCOUNT', 'SUNDRY_CREDITORS'].includes(g);
                    return (
                      <TableRow key={g} hover>
                        <TableCell sx={{ fontWeight: 500 }} data-label={tr('groupName')}>{ledgerGroupLabel(g)}</TableCell>
                        <TableCell data-label={tr('nature')}><Chip label={isDebit ? tr('debitWord') : tr('credit')} size="small" color={isDebit ? 'info' : 'warning'} variant="outlined" /></TableCell>
                        <TableCell data-label={tr('appearsIn')}><Chip label={isBS ? tr('bs') : tr('pl')} size="small" variant="outlined" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          </Card>

          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>{tr('customGroupsSubGroups')}</Typography>
          {customGroups.length === 0 ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <GroupsIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {tr('noCustom')}
              </Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setGroupForm({ name: '', parentGroup: LedgerGroup.INDIRECT_EXPENSE }); setGroupError(''); setGroupDialogOpen(true); }}>
                {tr('createFirstSubgroup')}
              </Button>
            </Card>
          ) : (
            <Card sx={{ overflow: 'hidden' }}>
              <ResponsiveTable>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('groupName')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('underParentGroup')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {customGroups.map((g) => (
                      <TableRow key={g.id} hover>
                        <TableCell sx={{ fontWeight: 500 }} data-label={tr('groupName')}>{g.name}</TableCell>
                        <TableCell data-label={tr('underParentGroup')}><Chip label={ledgerGroupLabel(g.parentGroup)} size="small" variant="outlined" /></TableCell>
                        <TableCell align="right" data-label={tr('actions')}>
                          <IconButton size="small" color="primary" onClick={() => { setEditingGroup(g); setGroupForm({ name: g.name, parentGroup: g.parentGroup }); setGroupError(''); setGroupDialogOpen(true); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => { if (confirm(tr('confirmDelGroup', { n: g.name }))) deleteGroupMutation.mutate(g.id); }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </Card>
          )}
        </Box>
      )}

      {/* Group create/edit dialog */}
      <ResponsiveDialog open={groupDialogOpen} onClose={() => { setGroupDialogOpen(false); setEditingGroup(null); }} maxWidth="xs" fullWidth>
        <DialogTitle>{editingGroup ? tr('editSub') : 'New Subgroup'}</DialogTitle>
        <DialogContent>
          {groupError && <Alert severity="error" sx={{ mb: 2 }}>{groupError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              size="small"
              label={tr('subgroupName')}
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              fullWidth
              helperText={tr('subHint')}
              autoFocus
            />
            <TextField
              select
              size="small"
              label={tr('underParentGroup')}
              value={groupForm.parentGroup}
              onChange={(e) => setGroupForm({ ...groupForm, parentGroup: e.target.value })}
              fullWidth
              helperText={tr('parentHelp')}
            >
              {GROUP_ORDER.map((g) => <MenuItem key={g} value={g}>{ledgerGroupLabel(g)}</MenuItem>)}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setGroupDialogOpen(false); setEditingGroup(null); }}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!groupForm.name.trim()) { setGroupError(tr('errGroup')); return; }
              if (editingGroup) {
                updateGroupMutation.mutate({ id: editingGroup.id, ...groupForm });
              } else {
                createGroupMutation.mutate(groupForm);
              }
            }}
            disabled={createGroupMutation.isPending || updateGroupMutation.isPending}
          >
            {(createGroupMutation.isPending || updateGroupMutation.isPending) ? <CircularProgress size={20} /> : editingGroup ? tr('updGroup') : tr('creGroup')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Grouped accordion view */}
      {tab === 'ledgers' && (isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>{tr('errLoad')} <Button size="small" onClick={() => refetch()}>{tr('retry')}</Button></Alert>
      ) : rows.length === 0 && customGroups.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <LedgerIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {tr('noLedgers')}
          </Typography>
          <Button variant="contained" startIcon={<SyncIcon />} onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {tr('syncNow')}
          </Button>
        </Card>
      ) : (
        <>
          {sortedGroups.map((group) => {
            const groupLedgers = grouped[group] ?? [];
            const childGroups = customGroupsByParent[group] ?? [];
            const childLedgers = childGroups.flatMap((childGroup) => grouped[childGroup.name] ?? []);
            const groupTotal = [...groupLedgers, ...childLedgers].reduce((s, l) => s + Math.abs(l.currentBalance), 0);
            return (
              <Accordion key={group} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1 }}>
                    <Chip label={ledgerGroupLabel(group)} size="small" color={GROUP_COLORS[group] ?? 'default'} />
                    <Typography variant="caption" color="text.secondary">
                      {tr('nLedgers', { count: groupLedgers.length + childLedgers.length })}
                      {childGroups.length > 0 && ` · ${tr('nSubs', { count: childGroups.length })}`}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" fontWeight={600}>
                      {formatCurrency(groupTotal)}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <ResponsiveTable>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>{tr('ledgerName')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('opening')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('currentBalance')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {groupLedgers.map(renderLedgerRow)}
                        {childGroups.map((childGroup) => {
                          const childGroupLedgers = grouped[childGroup.name] ?? [];
                          return (
                            <Fragment key={childGroup.id}>
                              <TableRow sx={{ bgcolor: 'action.hover' }}>
                                <TableCell colSpan={6} sx={{ pl: 3, fontWeight: 600 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <ExpandMoreIcon fontSize="small" color="action" />
                                    <span>{childGroup.name}</span>
                                    <Typography variant="caption" color="text.secondary">
                                      ({childGroupLedgers.length} ledger{childGroupLedgers.length !== 1 ? 's' : ''})
                                    </Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                              {childGroupLedgers.length > 0 ? childGroupLedgers.map(renderLedgerRow) : (
                                <TableRow>
                                  <TableCell colSpan={6} sx={{ pl: 7, color: 'text.secondary', fontStyle: 'italic' }}>
                                    {tr('noInSub')}
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
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
      ))}

      {/* Create/Edit dialog */}
      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? tr('editLedger') : 'New Ledger'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              size="small"
              label={tr('ledgerName')}
              value={form.name as string ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              helperText={tr('ledgerHint')}
            />
            <TextField
              select
              size="small"
              label={tr('group')}
              value={form.group as string ?? ''}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
              fullWidth
              helperText={tr('groupHelp')}
            >
              {ledgerGroupOptions.map((group) => <MenuItem key={group.value} value={group.value}>{group.label}</MenuItem>)}
            </TextField>
            {!editing && (
              <TextField
                size="small"
                type="number"
                label={tr('openingBalance')}
                value={form.openingBalance as number ?? 0}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                fullWidth
                helperText={tr('openingHelp')}
              />
            )}
            <TextField
              select
              size="small"
              label={tr('status')}
              value={form.isActive as boolean ?? true}
              onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}
              fullWidth
            >
              <MenuItem value="true">{tr('active')}</MenuItem>
              <MenuItem value="false">{tr('inactive')}</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending}>
            {createMutation.isPending ? <CircularProgress size={20} /> : editing ? tr('update') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Ledger Statement dialog */}
      <ResponsiveDialog open={!!statementLedger} onClose={() => setStatementLedger(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Ledger Statement — {statementLedger?.name}
          <Chip label={ledgerGroupLabel(statementLedger?.group ?? '')} size="small" sx={{ ml: 1 }} />
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, mt: 1, flexWrap: 'wrap' }}>
            <TextField size="small" type="date" label={tr('from')} value={stmtStartDate} onChange={(e) => setStmtStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="To" value={stmtEndDate} onChange={(e) => setStmtEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>

          {stmtLoading ? (
            <CircularProgress size={32} sx={{ display: 'block', mx: 'auto', my: 4 }} />
          ) : statementData ? (
            <>
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Card sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">{tr('openingBalance')}</Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {formatCurrency(Math.abs(statementData.openingBalance))}
                    {statementData.openingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.openingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.openingBalance >= 0 ? ' Dr' : ' Cr'))}
                  </Typography>
                </Card>
                <Card sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">{tr('closingBalance')}</Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {formatCurrency(Math.abs(statementData.closingBalance))}
                    {statementData.closingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.closingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.closingBalance >= 0 ? ' Dr' : ' Cr'))}
                  </Typography>
                </Card>
              </Box>

              <ResponsiveTable>
              <TableContainer component={Card} variant="outlined">
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
                      <TableCell align="right" sx={{ fontWeight: 600 }} data-label={tr('balance')}>
                        {formatCurrency(Math.abs(statementData.openingBalance))}
                        {statementData.openingBalance !== 0 && (statementData.ledger.isDebitNature ? (statementData.openingBalance >= 0 ? ' Dr' : ' Cr') : (statementData.openingBalance >= 0 ? ' Dr' : ' Cr'))}
                      </TableCell>
                    </TableRow>
                    {statementData.data.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                          <Typography color="text.secondary">{tr('noTxn')}</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      statementData.data.map((entry: any) => (
                        <TableRow key={entry.id} hover>
                          <TableCell data-label={tr('date')}>{formatDate(entry.voucherDate)}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }} data-label={tr('voucher')}>
                            {entry.journalVoucherId ? (
                              <Tooltip title={tr('openVoucher')}>
                                <Link
                                  component="button"
                                  type="button"
                                  underline="hover"
                                  sx={{ fontWeight: 600, verticalAlign: 'baseline' }}
                                  onClick={() => navigate(`/vouchers?id=${entry.journalVoucherId}`)}
                                >
                                  {entry.voucherNumber}
                                </Link>
                              </Tooltip>
                            ) : (
                              entry.voucherNumber
                            )}
                          </TableCell>
                          <TableCell data-label={tr('type')}><Chip label={entry.voucherType.replace(/_/g, ' ')} size="small" variant="outlined" /></TableCell>
                          <TableCell data-label={tr('description')}>{entry.description ?? '—'}</TableCell>
                          <TableCell align="right" sx={{ color: 'error.main' }} data-label={tr('debit')}>{entry.debit > 0 ? formatCurrency(entry.debit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }} data-label={tr('credit')}>{entry.credit > 0 ? formatCurrency(entry.credit) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }} data-label={tr('balance')}>
                            {formatCurrency(Math.abs(entry.balance))}
                            {entry.balance !== 0 && (statementData.ledger.isDebitNature ? (entry.balance >= 0 ? ' Dr' : ' Cr') : (entry.balance >= 0 ? ' Dr' : ' Cr'))}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            </>
          ) : (
            <Typography color="text.secondary">{tr('noData')}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {exportError && <Alert severity="error" sx={{ width: '100%', mb: 1 }} onClose={() => setExportError('')}>{exportError}</Alert>}
          <Button
            startIcon={<DownloadIcon />}
            onClick={() => { setExportError(''); setExportFormatOpen(true); }}
            disabled={!statementData || stmtLoading}
          >
            {tr('export')}
          </Button>
          <Button
            startIcon={<PrintIcon />}
            onClick={handlePrint}
            disabled={!statementData || stmtLoading}
          >
            {tr('print')}
          </Button>
          <Button onClick={() => setStatementLedger(null)}>{tr('close')}</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Export format selection dialog */}
      <ResponsiveDialog open={exportFormatOpen} onClose={exportBusy ? undefined : () => setExportFormatOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr('exportLedgerStatement')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Typography variant="body2" color="text.secondary">{tr('chooseExportFormat')}</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={exportBusy ? <CircularProgress size={18} /> : <PdfIcon />}
              onClick={handleExportPdf}
              disabled={exportBusy}
              sx={{ flex: '1 1 120px' }}
            >
              {tr('pdf')}
            </Button>
            <Button
              variant="outlined"
              startIcon={exportBusy ? <CircularProgress size={18} /> : <ExcelIcon />}
              onClick={handleExportExcel}
              disabled={exportBusy}
              sx={{ flex: '1 1 120px' }}
            >
              {tr('excel')}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportFormatOpen(false)} disabled={exportBusy}>{tr('cancel')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
