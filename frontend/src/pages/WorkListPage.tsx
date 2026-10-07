import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  MenuItem,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  Stack,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Receipt as QuoteIcon,
  Search as SearchIcon,
  ViewKanban as KanbanIcon,
  TableChart as TableIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskPriority,
  Permission,
  UserRole,
  hasPermission,
} from '@hospital-erp/shared';
import { enumToOptions, formatDate, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useUrlFilters } from '../hooks/useUrlFilters';
import KanbanBoard from '../components/KanbanBoard';

import { useTranslation } from 'react-i18next';
interface WorkTaskQuotationLink {
  id: string;
  quotation: {
    id: string;
    quotationNumber: string;
    status: string;
    grandTotal: number;
    vendor: { id: string; name: string };
  };
}

interface WorkTask {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  scheduledDate: string;
  deadlineDate: string | null;
  assignedTo: string | null;
  assignedVendorId: string | null;
  followUpBy: string | null;
  linkedQuotationId: string | null;
  linkedPoId: string | null;
  createdBy: string;
  createdByUser: { id: string; name: string };
  assignedToUser: { id: string; name: string; role: string } | null;
  assignedVendor: { id: string; name: string; vendorCode: string } | null;
  linkedQuotation: { id: string; quotationNumber: string; status: string; vendor: { id: string; name: string } } | null;
  linkedPo: { id: string; poNumber: string; vendor: { id: string; name: string } } | null;
  quotations: WorkTaskQuotationLink[];
}

interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

const PRIORITY_DOT: Record<string, string> = {
  HIGH: '#d32f2f',
  MEDIUM: '#ed6c02',
  LOW: '#9e9e9e',
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO(): string {
  return toISODate(new Date());
}

const EMPTY_FORM: Record<string, unknown> = {
  title: '',
  description: '',
  type: WorkTaskType.SITE_WORK,
  priority: WorkTaskPriority.MEDIUM,
  status: WorkTaskStatus.PLANNED,
  scheduledDate: todayISO(),
  deadlineDate: '',
  assignedTo: '',
  followUpBy: '',
};

export default function WorkListPage() {
  const { t: tr } = useTranslation('worklist');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const canCreateQuotation = !!user && hasPermission(user.role as UserRole, Permission.CREATE_QUOTATION, user.extraPermissions);
  const canManageWork = !!user && hasPermission(user.role as UserRole, Permission.MANAGE_WORK_TASKS, user.extraPermissions);

  // Read NL query filters from URL on mount
  useUrlFilters({ search: (v) => { setSearch(v); setPage(0); }, status: (v) => { setStatusFilter(v); setPage(0); }, priority: (v) => { setPriorityFilter(v); setPage(0); }, type: (v) => { setTypeFilter(v); setPage(0); } });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/work-tasks', 'list', page, pageSize, search, statusFilter, typeFilter, priorityFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const response = await api.get('/work-tasks', { params });
      return response.data;
    },
  });

  const { data: assignableUsers } = useQuery({
    queryKey: ['/work-tasks/assignable-users'],
    queryFn: async () => (await api.get('/work-tasks/assignable-users')).data?.data ?? [],
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/work-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['/quotations'] });
    queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingId) {
        return (await api.patch(`/work-tasks/${editingId}`, payload)).data;
      }
      return (await api.post('/work-tasks', payload)).data;
    },
    onSuccess: () => {
      invalidateAll();
      setFormOpen(false);
      setEditingId(null);
      setForm({});
      setSuccessMsg(editingId ? tr('okUpdated') : tr('okCreated'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/work-tasks/${id}`); },
    onSuccess: () => {
      invalidateAll();
      setDeleteId(null);
      setSuccessMsg(tr('okDeleted'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows: WorkTask[] = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };

  // ── Work item form helpers ──
  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError('');
    setFormOpen(true);
  }

  function openEdit(task: WorkTask) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description ?? '',
      type: task.type,
      priority: task.priority,
      status: task.status,
      scheduledDate: toISODate(new Date(task.scheduledDate)),
      deadlineDate: task.deadlineDate ? toISODate(new Date(task.deadlineDate)) : '',
      assignedTo: task.assignedTo ?? '',
      followUpBy: task.followUpBy ?? '',
    });
    setError('');
    setFormOpen(true);
  }

  function handleSave() {
    const title = String(form.title ?? '').trim();
    if (!title) {
      setError(tr('errTitle'));
      return;
    }
    if (!form.scheduledDate) {
      setError(tr('errDate'));
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      title,
      description: String(form.description ?? '').trim() || undefined,
      type: form.type,
      priority: form.priority,
      status: form.status,
      scheduledDate: form.scheduledDate,
      deadlineDate: form.deadlineDate ? form.deadlineDate : undefined,
      assignedTo: form.assignedTo || undefined,
      followUpBy: String(form.followUpBy ?? '').trim() || undefined,
    };
    saveMutation.mutate(payload);
  }

  // ── Raise to Quotation — navigates to the Quotations page with the create
  // dialog auto-opened, pre-filled with the work task's assigned vendor (if any).
  function raiseToQuotation(task: WorkTask) {
    const params = new URLSearchParams({ create: 'true', workTaskId: task.id });
    if (task.assignedVendorId) params.set('vendorId', task.assignedVendorId);
    navigate(`/quotations?${params.toString()}`);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Typography variant="h5">{tr('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Tooltip title={tr('tableView')}>
              <IconButton size="small" onClick={() => setViewMode('table')} color={viewMode === 'table' ? 'primary' : 'default'} sx={{ borderRadius: '4px 0 0 4px' }}>
                <TableIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={tr('kanbanBoard')}>
              <IconButton size="small" onClick={() => setViewMode('kanban')} color={viewMode === 'kanban' ? 'primary' : 'default'} sx={{ borderRadius: '0 4px 4px 0' }}>
                <KanbanIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <RefreshButton onClick={() => refetch()} />
          {canManageWork && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr('addWork')}</Button>
          )}
        </Box>
      </Box>

      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Kanban Board View */}
      {viewMode === 'kanban' && (
        <KanbanBoard onEdit={(task) => { setEditingId(task.id); setFormOpen(true); }} />
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <>
      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <TextField
          size="small"
          placeholder={tr('search')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          InputProps={{
            startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>),
          }}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <TextField select size="small" label={tr('status')} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">{tr('all')}</MenuItem>
          {enumToOptions(WorkTaskStatus).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label={tr('type')} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">{tr('all')}</MenuItem>
          {enumToOptions(WorkTaskType).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label={tr('priority')} value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">{tr('all')}</MenuItem>
          {enumToOptions(WorkTaskPriority).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
      </Box>

      <Card>
        <ResponsiveTable>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{tr('title2')}</TableCell>
                  <TableCell>{tr('type')}</TableCell>
                  <TableCell>{tr('priority')}</TableCell>
                  <TableCell>{tr('status')}</TableCell>
                  <TableCell>{tr('assigned')}</TableCell>
                  <TableCell>{tr('scheduled')}</TableCell>
                  <TableCell>{tr('quotations')}</TableCell>
                  <TableCell>PO</TableCell>
                  <TableCell align="right">{tr('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>{tr('none')}</TableCell></TableRow>
                ) : rows.map((task) => (
                  <TableRow key={task.id} hover>
                    <TableCell data-label={tr('title2')}>
                      <Typography variant="body2" fontWeight={600}>{task.title}</Typography>
                      {task.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</Typography>
                      )}
                    </TableCell>
                    <TableCell data-label={tr('type')}>{task.type.replace(/_/g, ' ').toLowerCase()}</TableCell>
                    <TableCell data-label={tr('priority')}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PRIORITY_DOT[task.priority] ?? '#9e9e9e' }} />
                        {task.priority.toLowerCase()}
                      </Box>
                    </TableCell>
                    <TableCell data-label={tr('status')}>
                      <Chip size="small" label={task.status.replace(/_/g, ' ')} color={STATUS_COLORS[task.status] ?? 'default'} />
                    </TableCell>
                    <TableCell data-label={tr('assigned')}>{task.assignedToUser?.name ?? '—'}</TableCell>
                    <TableCell data-label={tr('scheduled')}>{formatDate(task.scheduledDate)}</TableCell>
                    <TableCell data-label={tr('quotations')}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {task.quotations?.length ? task.quotations.map((l) => (
                          <Chip
                            key={l.id}
                            size="small"
                            variant="outlined"
                            label={`${l.quotation.quotationNumber} · ${l.quotation.vendor.name}`}
                            onClick={() => navigate('/quotations')}
                            sx={{ cursor: 'pointer' }}
                          />
                        )) : <Typography variant="body2" color="text.secondary">—</Typography>}
                      </Box>
                    </TableCell>
                    <TableCell data-label="PO">
                      {task.linkedPo ? (
                        <Chip size="small" variant="outlined" label={task.linkedPo.poNumber} onClick={() => navigate('/pos')} sx={{ cursor: 'pointer' }} />
                      ) : <Typography variant="body2" color="text.secondary">—</Typography>}
                    </TableCell>
                    <TableCell data-label={tr('actions')} align="right">
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, alignItems: 'center' }}>
                        {canCreateQuotation && (
                          <Button size="small" variant="outlined" color="primary" startIcon={<QuoteIcon />} onClick={() => raiseToQuotation(task)}>
                            {tr('raise')}
                          </Button>
                        )}
                        {canManageWork && (
                          <Tooltip title={tr('edit')}>
                            <IconButton size="small" onClick={() => openEdit(task)}><EditIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                        {canManageWork && (
                          <Tooltip title={tr('delete')}>
                            <IconButton size="small" color="error" onClick={() => setDeleteId(task.id)}><DeleteIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </ResponsiveTable>
        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
        />
      </Card>
        </>
      )}

      {/* Create / Edit work item dialog */}
      <ResponsiveDialog open={formOpen} onClose={() => { setFormOpen(false); setEditingId(null); setForm({}); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? tr('editTitle') : tr('addTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={tr('title2')} value={String(form.title ?? '')} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth required />
            <TextField label={tr('description')} value={String(form.description ?? '')} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline minRows={2} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField select label={tr('type')} value={String(form.type ?? WorkTaskType.SITE_WORK)} onChange={(e) => setForm({ ...form, type: e.target.value })} sx={{ flex: 1, minWidth: 120 }}>
                {enumToOptions(WorkTaskType).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              <TextField select label={tr('priority')} value={String(form.priority ?? WorkTaskPriority.MEDIUM)} onChange={(e) => setForm({ ...form, priority: e.target.value })} sx={{ flex: 1, minWidth: 120 }}>
                {enumToOptions(WorkTaskPriority).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              <TextField select label={tr('status')} value={String(form.status ?? WorkTaskStatus.PLANNED)} onChange={(e) => setForm({ ...form, status: e.target.value })} sx={{ flex: 1, minWidth: 120 }}>
                {enumToOptions(WorkTaskStatus).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField type="date" label={tr('scheduledDate')} value={String(form.scheduledDate ?? '')} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 140 }} required />
              <TextField type="date" label={tr('deadline')} value={String(form.deadlineDate ?? '')} onChange={(e) => setForm({ ...form, deadlineDate: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 140 }} />
            </Box>
            <TextField select label={tr('assignedTo')} value={String(form.assignedTo ?? '')} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} fullWidth>
              <MenuItem value="">{tr('unassigned')}</MenuItem>
              {(assignableUsers as AssignableUser[] | undefined)?.map((u) => <MenuItem key={u.id} value={u.id}>{u.name} ({u.role.replace(/_/g, ' ').toLowerCase()})</MenuItem>)}
            </TextField>
            <TextField label={tr('followUpBy')} value={String(form.followUpBy ?? '')} onChange={(e) => setForm({ ...form, followUpBy: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setFormOpen(false); setEditingId(null); setForm({}); }}>{tr('cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <CircularProgress size={20} /> : editingId ? tr('update') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Delete confirm */}
      <ResponsiveDialog open={!!deleteId} onClose={() => setDeleteId(null)} maxWidth="xs">
        <DialogTitle>{tr('deleteQ')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{tr('deleteNote')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{tr('cancel')}</Button>
          <Button variant="contained" color="error" disabled={deleteMutation.isPending} onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
            {deleteMutation.isPending ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
