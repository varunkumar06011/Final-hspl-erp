import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
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
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as PresentIcon,
  Cancel as AbsentIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, formatIndianNumber, todayLocalDate } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveTable from '../components/ResponsiveTable';
import RefreshButton from '../components/RefreshButton';

import { useTranslation } from 'react-i18next';
interface Staff {
  id: string;
  name: string;
  type: 'COMPANY' | 'LABOUR';
  role: string | null;
  phone: string | null;
  baseSalary: number;
  active: boolean;
}

interface AttendanceRow {
  id: string;
  staffId: string;
  date: string;
  present: boolean;
  notes: string | null;
  staff: { id: string; name: string; type: string; role: string | null; baseSalary: number };
  marker: { id: string; name: string };
}

interface SummaryRow {
  id: string;
  name: string;
  type: string;
  role: string | null;
  baseSalary: number;
  presentDays: number;
  absentDays: number;
  totalDays: number;
  salaryForPeriod: number;
}

export default function AttendancePage() {
  const { t: tr } = useTranslation('labour');
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [staffForm, setStaffForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Attendance marking state
  const [attendanceDate, setAttendanceDate] = useState(todayLocalDate());
  const [attendanceType, setAttendanceType] = useState<'COMPANY' | 'LABOUR'>('COMPANY');
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, { present: boolean; notes: string }>>({});

  // Summary state
  const [summaryStart, setSummaryStart] = useState(new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const [summaryEnd, setSummaryEnd] = useState(todayLocalDate());
  const [summaryType, setSummaryType] = useState('');

  const queryClient = useQueryClient();

  // Staff list
  const { data: staffData, isLoading: staffLoading, refetch: refetchStaff } = useQuery({
    queryKey: ['/labour/staff', page, pageSize, search, typeFilter, activeFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      if (activeFilter) params.active = activeFilter;
      const response = await api.get('/labour/staff', { params });
      return response.data;
    },
  });

  // Staff for attendance marking (all active staff of selected type)
  const { data: attendanceStaff } = useQuery({
    queryKey: ['/labour/staff', 'attendance', attendanceType],
    queryFn: async () => {
      const response = await api.get('/labour/staff', { params: { type: attendanceType, active: 'true', pageSize: 100 } });
      return response.data?.data ?? [];
    },
    enabled: tab === 1,
  });

  // Attendance list
  const { data: attendanceData, isLoading: attendanceLoading, refetch: refetchAttendance } = useQuery({
    queryKey: ['/labour/attendance', page, pageSize, typeFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: page + 1, pageSize };
      if (typeFilter) params.type = typeFilter;
      const response = await api.get('/labour/attendance', { params });
      return response.data;
    },
    enabled: tab === 2,
  });

  // Summary
  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['/labour/attendance/summary', summaryStart, summaryEnd, summaryType],
    queryFn: async () => {
      const params: Record<string, string> = { startDate: summaryStart, endDate: summaryEnd };
      if (summaryType) params.type = summaryType;
      const response = await api.get('/labour/attendance/summary', { params });
      return response.data;
    },
    enabled: tab === 3,
  });

  const createStaffMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingStaff) {
        const response = await api.patch(`/labour/staff/${editingStaff.id}`, payload);
        return response.data;
      }
      const response = await api.post('/labour/staff', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/labour/staff'] });
      setStaffDialogOpen(false);
      setEditingStaff(null);
      setStaffForm({});
      setSuccessMsg(editingStaff ? tr('okUpdated') : tr('okAdded'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/labour/staff/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/labour/staff'] });
      setSuccessMsg(tr('okDeleted'));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const markAttendanceMutation = useMutation({
    mutationFn: async () => {
      const records = (attendanceStaff as Staff[])
        .filter((s) => attendanceRecords[s.id]?.present !== undefined)
        .map((s) => {
          const rec = attendanceRecords[s.id];
          return {
            staffId: s.id,
            present: rec!.present,
            ...(rec!.notes?.trim() ? { notes: rec!.notes.trim() } : {}),
          };
        });
      const response = await api.post('/labour/attendance', { date: attendanceDate, records });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/labour/attendance'] });
      setSuccessMsg(tr('okMarked', { d: attendanceDate }));
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const staffRows: Staff[] = staffData?.data ?? [];
  const staffPagination = staffData?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const attendanceRows: AttendanceRow[] = attendanceData?.data ?? [];
  const attendancePagination = attendanceData?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const summaryRows: SummaryRow[] = summaryData?.data ?? [];

  function openCreateStaff() {
    setEditingStaff(null);
    setStaffForm({ type: 'COMPANY', baseSalary: 0, active: true });
    setError('');
    setStaffDialogOpen(true);
  }

  function openEditStaff(staff: Staff) {
    setEditingStaff(staff);
    setStaffForm({ name: staff.name, type: staff.type, role: staff.role, phone: staff.phone, baseSalary: staff.baseSalary, active: staff.active });
    setError('');
    setStaffDialogOpen(true);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tr('title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => { refetchStaff(); refetchAttendance(); refetchSummary(); }} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateStaff}>{tr('addStaff')}</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <Tab label={tr('staff')} />
        <Tab label={tr('markAttendance')} />
        <Tab label={tr('attendanceLog')} />
        <Tab label={tr('summary')} />
      </Tabs>

      {/* Tab 0: Staff Management */}
      {tab === 0 && (
        <Card>
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder={tr('search')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: { xs: '100%', sm: 250 } }}
            />
            <TextField select size="small" label={tr('type')} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              <MenuItem value="COMPANY">{tr('company')}</MenuItem>
              <MenuItem value="LABOUR">{tr('labour')}</MenuItem>
            </TextField>
            <TextField select size="small" label={tr('active')} value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(0); }} sx={{ width: 120 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              <MenuItem value="true">{tr('active')}</MenuItem>
              <MenuItem value="false">{tr('inactive')}</MenuItem>
            </TextField>
          </Box>
          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('role')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('phone')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('baseSalary')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {staffLoading ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : staffRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No staff found. Click "Add Staff" to get started.</Typography></TableCell></TableRow>
                ) : (
                  staffRows.map((s) => (
                    <TableRow key={s.id} hover>
                      <TableCell data-label={tr('name')}>{s.name}</TableCell>
                      <TableCell data-label={tr('type')}><Chip label={s.type} size="small" color={s.type === 'COMPANY' ? 'primary' : 'secondary'} variant="outlined" /></TableCell>
                      <TableCell data-label={tr('role')}>{s.role ?? '—'}</TableCell>
                      <TableCell data-label={tr('phone')}>{s.phone ?? '—'}</TableCell>
                      <TableCell data-label={tr('baseSalary')}>{formatCurrency(s.baseSalary)}</TableCell>
                      <TableCell data-label={tr('status')}><Chip label={s.active ? 'Active' : 'Inactive'} size="small" color={s.active ? 'success' : 'default'} /></TableCell>
                      <TableCell data-label={tr('actions')}>
                        <IconButton size="small" onClick={() => openEditStaff(s)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => { if (confirm(tr('confirmDelete', { n: s.name }))) deleteStaffMutation.mutate(s.id); }}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          </ResponsiveTable>
          <TablePagination
            component="div"
            count={staffPagination.total}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 20, 50]}
            sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
          />
        </Card>
      )}

      {/* Tab 1: Mark Attendance */}
      {tab === 1 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              <TextField
                label={tr('date')}
                type="date"
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                select
                label={tr('staffType')}
                value={attendanceType}
                onChange={(e) => { setAttendanceType(e.target.value as 'COMPANY' | 'LABOUR'); setAttendanceRecords({}); }}
                size="small"
                sx={{ width: 150 }}
              >
                <MenuItem value="COMPANY">{tr('company')}</MenuItem>
                <MenuItem value="LABOUR">{tr('labour')}</MenuItem>
              </TextField>
              <Button variant="contained" onClick={() => { setError(''); markAttendanceMutation.mutate(); }} disabled={markAttendanceMutation.isPending || !attendanceStaff?.length || Object.keys(attendanceRecords).length === 0}>
                {markAttendanceMutation.isPending ? <CircularProgress size={20} /> : (Object.keys(attendanceRecords).length > 0 ? tr('saveAttN', { n: Object.keys(attendanceRecords).length }) : tr('saveAtt'))}
              </Button>
            </Box>

            {!attendanceStaff ? (
              <CircularProgress size={32} />
            ) : attendanceStaff.length === 0 ? (
              <Typography color="text.secondary">No active {attendanceType.toLowerCase()} staff found. Add staff first.</Typography>
            ) : (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('role')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('present')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{tr('notes')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(attendanceStaff as Staff[]).map((s) => {
                      const marked = attendanceRecords[s.id]?.present !== undefined;
                      const isPresent = attendanceRecords[s.id]?.present === true;
                      return (
                        <TableRow key={s.id}>
                          <TableCell data-label={tr('name')}>{s.name}</TableCell>
                          <TableCell data-label={tr('role')}>{s.role ?? '—'}</TableCell>
                          <TableCell data-label={tr('present')}>
                            <ToggleButtonGroup
                              exclusive
                              size="small"
                              value={marked ? (isPresent ? 'present' : 'absent') : null}
                              onChange={(_e, val) => {
                                if (val === null) return;
                                setAttendanceRecords({
                                  ...attendanceRecords,
                                  [s.id]: { present: val === 'present', notes: attendanceRecords[s.id]?.notes ?? '' },
                                });
                              }}
                            >
                              <ToggleButton value="present" sx={{ '&.Mui-selected': { color: '#27ae60', backgroundColor: 'rgba(39,174,96,0.1)' } }}>
                                <PresentIcon fontSize="small" sx={{ mr: 0.5 }} /> {tr('present')}
                              </ToggleButton>
                              <ToggleButton value="absent" sx={{ '&.Mui-selected': { color: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)' } }}>
                                <AbsentIcon fontSize="small" sx={{ mr: 0.5 }} /> {tr('absent')}
                              </ToggleButton>
                            </ToggleButtonGroup>
                          </TableCell>
                          <TableCell data-label={tr('notes')}>
                            <TextField
                              size="small"
                              value={attendanceRecords[s.id]?.notes ?? ''}
                              onChange={(e) => setAttendanceRecords({
                                ...attendanceRecords,
                                [s.id]: { present: attendanceRecords[s.id]?.present ?? false, notes: e.target.value },
                              })}
                              placeholder={tr('optionalNotes')}
                              disabled={!marked}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Attendance Log */}
      {tab === 2 && (
        <Card>
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField select size="small" label={tr('type')} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} sx={{ width: 150 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              <MenuItem value="COMPANY">{tr('company')}</MenuItem>
              <MenuItem value="LABOUR">{tr('labour')}</MenuItem>
            </TextField>
          </Box>
          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('date')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('role')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('notes')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('markedBy')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {attendanceLoading ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : attendanceRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('none')}</Typography></TableCell></TableRow>
                ) : (
                  attendanceRows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell data-label={tr('date')}>{formatDate(row.date)}</TableCell>
                      <TableCell data-label={tr('name')}>{row.staff?.name}</TableCell>
                      <TableCell data-label={tr('type')}><Chip label={row.staff?.type} size="small" variant="outlined" /></TableCell>
                      <TableCell data-label={tr('role')}>{row.staff?.role ?? '—'}</TableCell>
                      <TableCell data-label={tr('status')}><Chip label={row.present ? 'Present' : 'Absent'} size="small" color={row.present ? 'success' : 'error'} /></TableCell>
                      <TableCell data-label={tr('notes')}>{row.notes ?? '—'}</TableCell>
                      <TableCell data-label={tr('markedBy')}>{row.marker?.name ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          </ResponsiveTable>
          <TablePagination
            component="div"
            count={attendancePagination.total}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 20, 50]}
            sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' } }}
          />
        </Card>
      )}

      {/* Tab 3: Summary */}
      {tab === 3 && (
        <Card>
          <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField label={tr('startDate')} type="date" value={summaryStart} onChange={(e) => setSummaryStart(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
            <TextField label={tr('endDate')} type="date" value={summaryEnd} onChange={(e) => setSummaryEnd(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
            <TextField select size="small" label={tr('type')} value={summaryType} onChange={(e) => setSummaryType(e.target.value)} sx={{ width: 150 }}>
              <MenuItem value="">{tr('all')}</MenuItem>
              <MenuItem value="COMPANY">{tr('company')}</MenuItem>
              <MenuItem value="LABOUR">{tr('labour')}</MenuItem>
            </TextField>
          </Box>
          <ResponsiveTable>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('role')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('baseSalary')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('present')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('absent')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('totalDays')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tr('salaryProRated')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summaryLoading ? (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><CircularProgress size={32} /></TableCell></TableRow>
                ) : summaryRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{tr('noPeriod')}</Typography></TableCell></TableRow>
                ) : (
                  summaryRows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell data-label={tr('name')}>{row.name}</TableCell>
                      <TableCell data-label={tr('type')}><Chip label={row.type} size="small" variant="outlined" /></TableCell>
                      <TableCell data-label={tr('role')}>{row.role ?? '—'}</TableCell>
                      <TableCell data-label={tr('baseSalary')}>{formatCurrency(row.baseSalary)}</TableCell>
                      <TableCell data-label={tr('present')}><Chip label={row.presentDays} size="small" color="success" /></TableCell>
                      <TableCell data-label={tr('absent')}><Chip label={row.absentDays} size="small" color="error" /></TableCell>
                      <TableCell data-label={tr('totalDays')}>{row.totalDays}</TableCell>
                      <TableCell data-label={tr('salaryProRated')}><strong>{formatCurrency(row.salaryForPeriod)}</strong></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          </ResponsiveTable>
        </Card>
      )}

      {/* Add/Edit Staff Dialog */}
      <ResponsiveDialog open={staffDialogOpen} onClose={() => setStaffDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingStaff ? tr('editTitle') : 'Add Staff'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label={tr('name')} required value={String(staffForm.name ?? '')} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} fullWidth size="small" />
            <TextField
              select
              label={tr('type')}
              required
              value={String(staffForm.type ?? 'COMPANY')}
              onChange={(e) => setStaffForm({ ...staffForm, type: e.target.value })}
              fullWidth
              size="small"
              disabled={!!editingStaff}
              helperText={tr('typeHelp')}
            >
              <MenuItem value="COMPANY">{tr('companySalaried')}</MenuItem>
              <MenuItem value="LABOUR">{tr('labourTemporary')}</MenuItem>
            </TextField>
            <TextField label={tr('role')} value={String(staffForm.role ?? '')} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} fullWidth size="small" />
            <TextField label={tr('phone')} value={String(staffForm.phone ?? '')} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} fullWidth size="small" />
            <TextField label={tr('baseSalary')} type="text" required value={formatIndianNumber(staffForm.baseSalary ?? '')} onChange={(e) => setStaffForm({ ...staffForm, baseSalary: e.target.value === '' ? '' : Number(e.target.value.replace(/,/g, '')) })} inputMode="decimal" inputProps={{ min: 0, step: 0.01 }} fullWidth size="small" />
            {editingStaff && (
              <TextField select label={tr('status')} value={staffForm.active === false ? 'false' : 'true'} onChange={(e) => setStaffForm({ ...staffForm, active: e.target.value === 'true' })} fullWidth size="small">
                <MenuItem value="true">{tr('active')}</MenuItem>
                <MenuItem value="false">{tr('inactive')}</MenuItem>
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setStaffDialogOpen(false)}>{tr('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setError('');
              if (!String(staffForm.name ?? '').trim()) {
                setError(tr('errName'));
                return;
              }
              if (!Number.isFinite(Number(staffForm.baseSalary)) || Number(staffForm.baseSalary) < 0) {
                setError(tr('errSalary'));
                return;
              }
              if (staffForm.phone && !/^[0-9+() .-]{7,20}$/.test(String(staffForm.phone).trim())) {
                setError(tr('errPhone'));
                return;
              }
              createStaffMutation.mutate({
                name: staffForm.name,
                type: staffForm.type,
                role: staffForm.role || undefined,
                phone: staffForm.phone || undefined,
                baseSalary: Number(staffForm.baseSalary ?? 0),
                ...(editingStaff ? { active: staffForm.active } : {}),
              });
            }}
            disabled={!staffForm.name || createStaffMutation.isPending}
          >
            {createStaffMutation.isPending ? <CircularProgress size={20} /> : editingStaff ? tr('update') : tr('add')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
