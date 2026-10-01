import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Permission, hasPermission } from '@hospital-erp/shared';
import ResponsiveDialog from '../components/ResponsiveDialog';
import ResponsiveTable from '../components/ResponsiveTable';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { useSwitchProject } from '../hooks/useSwitchProject';
import { enumLabel, formatCurrency, formatDate } from '../utils/enumOptions';

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  totalBudget: string | number;
  startDate: string;
  endDate: string | null;
  status: string;
  officeAddress: string | null;
  hospitalAddress: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  createdAt: string;
  deletedAt: string | null;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  totalBudget: string;
  startDate: string;
  endDate: string;
  status: string;
  officeAddress: string;
  hospitalAddress: string;
  gstNumber: string;
  panNumber: string;
}

const STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

const emptyForm = (): FormState => ({
  code: '',
  name: '',
  description: '',
  totalBudget: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  status: 'ACTIVE',
  officeAddress: '',
  hospitalAddress: '',
  gstNumber: '',
  panNumber: '',
});

const formFromProject = (p: ProjectRow): FormState => ({
  code: p.code,
  name: p.name,
  description: p.description ?? '',
  totalBudget: String(Number(p.totalBudget ?? 0)),
  startDate: p.startDate ? p.startDate.slice(0, 10) : '',
  endDate: p.endDate ? p.endDate.slice(0, 10) : '',
  status: p.status,
  officeAddress: p.officeAddress ?? '',
  hospitalAddress: p.hospitalAddress ?? '',
  gstNumber: p.gstNumber ?? '',
  panNumber: p.panNumber ?? '',
});

export default function ProjectsPage() {
  const { t: tr } = useTranslation('projects');
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { switchTo, switching, error: switchError } = useSwitchProject();

  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const allowed = !!user && hasPermission(user.role, Permission.MANAGE_PROJECTS);

  const { data, isLoading } = useQuery({
    queryKey: ['/projects', { includeArchived: showArchived }],
    queryFn: async () =>
      (await api.get('/projects', { params: { includeArchived: showArchived } })).data,
    enabled: allowed,
  });
  const projects: ProjectRow[] = data?.data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/projects'] });
    queryClient.invalidateQueries({ queryKey: ['/settings'] });
    queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
  };
  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        totalBudget: form.totalBudget === '' ? 0 : Number(form.totalBudget),
        startDate: form.startDate || undefined,
        endDate: form.endDate || null,
        status: form.status,
        officeAddress: form.officeAddress.trim() || null,
        hospitalAddress: form.hospitalAddress.trim() || null,
        gstNumber: form.gstNumber.trim() || null,
        panNumber: form.panNumber.trim() || null,
      };
      if (editing) return (await api.patch(`/projects/${editing.id}`, body)).data;
      return (await api.post('/projects', { ...body, code: form.code.trim().toUpperCase() })).data;
    },
    onSuccess: () => {
      flash(editing ? tr('okUpdated') : tr('okCreated'));
      setDialogOpen(false);
      setError('');
      refresh();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await api.patch(`/projects/${id}`, { archived })).data,
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  if (!allowed) return <Navigate to="/" replace />;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError('');
    setDialogOpen(true);
  };
  const openEdit = (p: ProjectRow) => {
    setEditing(p);
    setForm(formFromProject(p));
    setError('');
    setDialogOpen(true);
  };
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const codeValid = editing ? true : CODE_PATTERN.test(form.code.trim().toUpperCase());
  const canSave = !!form.name.trim() && codeValid && !saveMutation.isPending;

  const handleArchive = (p: ProjectRow) => {
    if (window.confirm(tr('archiveConfirm', { name: p.name }))) {
      archiveMutation.mutate({ id: p.id, archived: true });
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          {tr('title')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
            label={tr('showArchived')}
          />
          <Button variant="contained" size="small" onClick={openCreate}>
            {tr('newProject')}
          </Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {tr('subtitle')}
      </Typography>
      {error && !dialogOpen && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {switchError && <Alert severity="error" sx={{ mb: 2 }}>{switchError}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Card>
        <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{tr('code')}</TableCell>
                  <TableCell>{tr('name')}</TableCell>
                  <TableCell>{tr('status')}</TableCell>
                  <TableCell align="right">{tr('budget')}</TableCell>
                  <TableCell>{tr('created')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={30} /></TableCell></TableRow>
                ) : projects.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}>{tr('none')}</TableCell></TableRow>
                ) : projects.map((p) => {
                  const isCurrent = p.id === user?.projectId;
                  const archived = !!p.deletedAt;
                  return (
                    <TableRow key={p.id} hover sx={archived ? { opacity: 0.6 } : undefined}>
                      <TableCell data-label={tr('code')}><strong>{p.code}</strong></TableCell>
                      <TableCell data-label={tr('name')}>
                        {p.name}{' '}
                        {isCurrent && <Chip size="small" color="primary" label={tr('current')} sx={{ ml: 0.5 }} />}
                        {archived && <Chip size="small" label={tr('archived')} sx={{ ml: 0.5 }} />}
                      </TableCell>
                      <TableCell data-label={tr('status')}>{enumLabel(p.status)}</TableCell>
                      <TableCell data-label={tr('budget')} align="right">{formatCurrency(p.totalBudget)}</TableCell>
                      <TableCell data-label={tr('created')}>{formatDate(p.createdAt)}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: { sm: 'flex-end' } }}>
                          {!isCurrent && !archived && (
                            <Button size="small" disabled={switching} onClick={() => void switchTo(p.id)}>
                              {tr('switchTo')}
                            </Button>
                          )}
                          <Button size="small" onClick={() => openEdit(p)}>{tr('edit')}</Button>
                          {archived ? (
                            <Button size="small" onClick={() => archiveMutation.mutate({ id: p.id, archived: false })} disabled={archiveMutation.isPending}>
                              {tr('restore')}
                            </Button>
                          ) : (
                            !isCurrent && (
                              <Button size="small" color="warning" onClick={() => handleArchive(p)} disabled={archiveMutation.isPending}>
                                {tr('archive')}
                              </Button>
                            )
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </ResponsiveTable>
      </Card>

      <ResponsiveDialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? tr('editProject') : tr('newProject')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {!editing && <Alert severity="info">{tr('emptyNote')}</Alert>}
            {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
            <TextField
              label={tr('code')}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }))}
              disabled={!!editing}
              required
              error={!editing && form.code !== '' && !codeValid}
              helperText={!editing && form.code !== '' && !codeValid ? tr('codeInvalid') : tr('codeHint')}
              size="small"
            />
            <TextField label={tr('name')} value={form.name} onChange={set('name')} required size="small" />
            <TextField label={tr('description')} value={form.description} onChange={set('description')} multiline minRows={2} size="small" />
            <TextField label={tr('budget')} type="number" value={form.totalBudget} onChange={set('totalBudget')} size="small" inputProps={{ min: 0 }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label={tr('startDate')} type="date" value={form.startDate} onChange={set('startDate')} size="small" InputLabelProps={{ shrink: true }} />
              <TextField label={tr('endDate')} type="date" value={form.endDate} onChange={set('endDate')} size="small" InputLabelProps={{ shrink: true }} />
            </Box>
            <TextField select label={tr('status')} value={form.status} onChange={set('status')} size="small">
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{enumLabel(s)}</MenuItem>
              ))}
            </TextField>
            <TextField label={tr('officeAddress')} value={form.officeAddress} onChange={set('officeAddress')} multiline minRows={2} size="small" />
            <TextField label={tr('hospitalAddress')} value={form.hospitalAddress} onChange={set('hospitalAddress')} multiline minRows={2} size="small" />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label={tr('gst')} value={form.gstNumber} onChange={set('gstNumber')} size="small" />
              <TextField label={tr('pan')} value={form.panNumber} onChange={set('panNumber')} size="small" />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{tr('cancel')}</Button>
          <Button variant="contained" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? <CircularProgress size={18} /> : editing ? tr('save') : tr('create')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
