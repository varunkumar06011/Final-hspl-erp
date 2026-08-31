import { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  TextField,
  MenuItem,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
} from '@mui/material';
import ResponsiveDialog from '../components/ResponsiveDialog';
import RefreshButton from '../components/RefreshButton';
import {
  Add as AddIcon,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Alarm as DeadlineIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { WorkTaskType, WorkTaskStatus, WorkTaskPriority } from '@hospital-erp/shared';
import { enumToOptions, STATUS_COLORS } from '../utils/enumOptions';
import api, { extractErrorMessage } from '../config/api';

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
  linkedQuotationId: string | null;
  linkedPoId: string | null;
  createdBy: string;
  createdByUser: { id: string; name: string };
  assignedToUser: { id: string; name: string; role: string } | null;
  linkedQuotation: { id: string; quotationNumber: string; vendor: { name: string } } | null;
  linkedPo: { id: string; poNumber: string; vendor: { name: string } } | null;
}

interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

interface LinkableQuotation {
  id: string;
  quotationNumber: string;
  status: string;
  vendor: { name: string };
}

interface LinkablePo {
  id: string;
  poNumber: string;
  status: string;
  vendor: { name: string };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  PROCUREMENT: 'primary',
  INSPECTION: 'warning',
  MEETING: 'info',
  DELIVERY: 'secondary',
  SITE_WORK: 'success',
  OTHER: 'default',
};

const PRIORITY_DOT: Record<string, string> = {
  HIGH: '#d32f2f',
  MEDIUM: '#ed6c02',
  LOW: '#9e9e9e',
};

function toISODate(d: Date): string {
  // Use LOCAL date components — toISOString() shifts to UTC and rolls the
  // date back by one day for users east of GMT (e.g. IST +5:30).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function WorkCalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const queryClient = useQueryClient();

  // Visible grid: 6 weeks (42 days) starting from the Sunday on/before the 1st.
  const { gridStart, gridEnd, days } = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthStart = new Date(year, month, 1);
    const startOffset = monthStart.getDay(); // 0=Sun
    const start = new Date(year, month, 1 - startOffset);
    const built: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      built.push(d);
    }
    const end = built[built.length - 1];
    return { gridStart: start, gridEnd: end, days: built };
  }, [cursor]);

  const rangeKey = useMemo(
    () => `${toISODate(gridStart)}_${toISODate(gridEnd)}`,
    [gridStart, gridEnd]
  );

  const { data: calendarData, isLoading, refetch } = useQuery({
    queryKey: ['/work-tasks/calendar', rangeKey],
    queryFn: async () => {
      const params = {
        startDate: `${toISODate(gridStart)}T00:00:00.000Z`,
        endDate: `${toISODate(gridEnd)}T00:00:00.000Z`,
      };
      const response = await api.get('/work-tasks/calendar', { params });
      return response.data;
    },
  });

  // Group tasks by date key for O(1) cell lookups.
  const tasksByDate = useMemo(() => {
    const map: Record<string, WorkTask[]> = {};
    for (const task of (calendarData?.data ?? []) as WorkTask[]) {
      const key = toISODate(new Date(task.scheduledDate));
      (map[key] ??= []).push(task);
    }
    return map;
  }, [calendarData]);

  // Group tasks by deadline date so deadlines render on the grid.
  const deadlinesByDate = useMemo(() => {
    const map: Record<string, WorkTask[]> = {};
    for (const task of (calendarData?.data ?? []) as WorkTask[]) {
      if (!task.deadlineDate) continue;
      const key = toISODate(new Date(task.deadlineDate));
      (map[key] ??= []).push(task);
    }
    return map;
  }, [calendarData]);

  const { data: assignableUsers } = useQuery({
    queryKey: ['/work-tasks/assignable-users'],
    queryFn: async () => (await api.get('/work-tasks/assignable-users')).data?.data ?? [],
  });
  const { data: linkableQuotations } = useQuery({
    queryKey: ['/work-tasks/linkable-quotations'],
    queryFn: async () => (await api.get('/work-tasks/linkable-quotations')).data?.data ?? [],
  });
  const { data: linkablePos } = useQuery({
    queryKey: ['/work-tasks/linkable-pos'],
    queryFn: async () => (await api.get('/work-tasks/linkable-pos')).data?.data ?? [],
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/work-tasks/calendar'] });
    queryClient.invalidateQueries({ queryKey: ['/work-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['/dashboard/summary'] });
  }, [queryClient]);

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
      setSuccessMsg(editingId ? 'Work task updated.' : 'Work task created.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/work-tasks/${id}`); },
    onSuccess: () => {
      invalidateAll();
      setSuccessMsg('Work task deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return (await api.patch(`/work-tasks/${id}`, { status })).data;
    },
    onSuccess: () => invalidateAll(),
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const tKey = todayKey();
  const cursorMonth = cursor.getMonth();
  const cursorYear = cursor.getFullYear();

  function openCreateForDate(dateKey: string) {
    setEditingId(null);
    setForm({
      type: WorkTaskType.OTHER,
      priority: WorkTaskPriority.MEDIUM,
      status: WorkTaskStatus.PLANNED,
      scheduledDate: dateKey,
    });
    setError('');
    setFormOpen(true);
  }

  function openCreate() {
    openCreateForDate(selectedDate ?? tKey);
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
      linkedQuotationId: task.linkedQuotationId ?? '',
      linkedPoId: task.linkedPoId ?? '',
    });
    setError('');
    setFormOpen(true);
  }

  function submitForm() {
    setError('');
    if (!form.title || !form.scheduledDate) {
      setError('Title and date are required');
      return;
    }
    const payload: Record<string, unknown> = {
      title: form.title,
      description: (form.description as string) || undefined,
      type: form.type,
      priority: form.priority,
      status: form.status,
      scheduledDate: `${form.scheduledDate}T00:00:00.000Z`,
      deadlineDate: (form.deadlineDate as string) ? `${form.deadlineDate}T00:00:00.000Z` : undefined,
      assignedTo: (form.assignedTo as string) || undefined,
      linkedQuotationId: (form.linkedQuotationId as string) || undefined,
      linkedPoId: (form.linkedPoId as string) || undefined,
    };
    saveMutation.mutate(payload);
  }

  const selectedTasks: WorkTask[] = selectedDate ? (tasksByDate[selectedDate] ?? []) : [];
  // Tasks whose deadline falls on the selected date (may differ from scheduled date).
  const selectedDeadlines: WorkTask[] = selectedDate ? (deadlinesByDate[selectedDate] ?? []) : [];
  // Avoid showing a task twice if its scheduled date AND deadline are both this day.
  const selectedDeadlineOnly = selectedDeadlines.filter(
    (d) => !selectedTasks.some((t) => t.id === d.id),
  );

  function renderTaskCard(task: WorkTask, isDeadlineRow: boolean) {
    return (
      <Box
        key={task.id}
        sx={{
          p: 1.25,
          border: '1px solid',
          borderColor: isDeadlineRow ? 'error.main' : 'divider',
          borderRadius: 1,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" noWrap>{task.title}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
              <Chip label={task.type.replace(/_/g, ' ')} size="small" color={TYPE_COLORS[task.type] ?? 'default'} />
              <Chip label={task.status.replace(/_/g, ' ')} size="small" color={STATUS_COLORS[task.status] ?? 'default'} />
              <Chip
                label={task.priority}
                size="small"
                variant="outlined"
                sx={{ borderColor: PRIORITY_DOT[task.priority], color: PRIORITY_DOT[task.priority] }}
              />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexShrink: 0 }}>
            <IconButton size="small" onClick={() => openEdit(task)}><EditIcon fontSize="small" /></IconButton>
            <IconButton size="small" color="error" onClick={() => {
              if (confirm('Delete this work task?')) deleteMutation.mutate(task.id);
            }}><DeleteIcon fontSize="small" /></IconButton>
          </Box>
        </Box>

        {task.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {task.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 0.75, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary' }}>
          {isDeadlineRow ? (
            <span>Scheduled: <strong>{new Date(task.scheduledDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</strong></span>
          ) : (
            task.deadlineDate && (
              <span>Deadline: <strong>{new Date(task.deadlineDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</strong></span>
            )
          )}
          {task.assignedToUser && (
            <span>Assigned: <strong>{task.assignedToUser.name}</strong></span>
          )}
          {task.linkedQuotation && (
            <span>Quotation: <strong>{task.linkedQuotation.quotationNumber}</strong> ({task.linkedQuotation.vendor.name})</span>
          )}
          {task.linkedPo && (
            <span>PO: <strong>{task.linkedPo.poNumber}</strong> ({task.linkedPo.vendor.name})</span>
          )}
        </Box>

        {/* Quick status change */}
        <Box sx={{ mt: 0.75 }}>
          <TextField
            select
            size="small"
            value={task.status}
            onChange={(e) => statusMutation.mutate({ id: task.id, status: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            {Object.values(WorkTaskStatus).map((s) => (
              <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>
            ))}
          </TextField>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Work Calendar
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-end', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <RefreshButton onClick={() => refetch()} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Task</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* Month navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => setCursor(new Date(cursorYear, cursorMonth - 1, 1))} size="small">
            <PrevIcon />
          </IconButton>
          <Typography variant="h6" sx={{ minWidth: 180, textAlign: 'center' }}>
            {MONTHS[cursorMonth]} {cursorYear}
          </Typography>
          <IconButton onClick={() => setCursor(new Date(cursorYear, cursorMonth + 1, 1))} size="small">
            <NextIcon />
          </IconButton>
        </Box>
        <Button size="small" onClick={() => setCursor(new Date())}>Today</Button>
      </Box>

      {/* Legend */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        {Object.values(WorkTaskStatus).map((s) => (
          <Chip
            key={s}
            label={s.replace(/_/g, ' ')}
            size="small"
            variant="outlined"
            color={STATUS_COLORS[s] ?? 'default'}
          />
        ))}
      </Stack>

      {/* Calendar grid — horizontally scrollable on small screens */}
      <Card sx={{ p: { xs: 0.5, sm: 1 }, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 700 }}>
            {/* Weekday header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 0.5 }}>
              {WEEKDAYS.map((d) => (
                <Box key={d} sx={{ textAlign: 'center', py: 0.5 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">{d}</Typography>
                </Box>
              ))}
            </Box>

            {/* Day cells */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
              {days.map((day) => {
                const key = toISODate(day);
                const inMonth = day.getMonth() === cursorMonth;
                const isToday = key === tKey;
                const tasks = tasksByDate[key] ?? [];
                const deadlines = deadlinesByDate[key] ?? [];
                const visible = tasks.slice(0, 2);
                const overflow = tasks.length - visible.length;
                const firstDeadline = deadlines[0];
                const deadlineOverflow = deadlines.length - 1;
                return (
                  <Box
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    sx={{
                      minHeight: { xs: 84, sm: 110 },
                      p: 0.5,
                      border: '1px solid',
                      borderColor: isToday ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      bgcolor: isToday ? 'primary.light' : (inMonth ? 'background.paper' : 'action.hover'),
                      cursor: 'pointer',
                      '&:hover': { borderColor: 'primary.main' },
                      overflow: 'hidden',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: isToday ? 700 : 400,
                        color: inMonth ? 'text.primary' : 'text.disabled',
                        mb: 0.25,
                      }}
                    >
                      {day.getDate()}
                    </Typography>
                    {visible.map((task) => (
                      <Box
                        key={task.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.25,
                          fontSize: 11,
                          bgcolor: STATUS_COLORS[task.status] === 'success' ? 'success.light'
                            : STATUS_COLORS[task.status] === 'info' ? 'info.light'
                            : STATUS_COLORS[task.status] === 'error' ? 'error.light'
                            : STATUS_COLORS[task.status] === 'warning' ? 'warning.light'
                            : 'grey.100',
                          color: 'text.primary',
                          borderRadius: 0.5,
                          px: 0.5,
                          py: '1px',
                          mb: 0.25,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {task.status === WorkTaskStatus.DONE && (
                          <Box component="span" sx={{ textDecoration: 'line-through', opacity: 0.7 }}>{task.title}</Box>
                        )}
                        {task.status !== WorkTaskStatus.DONE && (
                          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</Box>
                        )}
                      </Box>
                    ))}
                    {firstDeadline && (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.25,
                          fontSize: 11,
                          color: 'error.dark',
                          border: '1px dashed',
                          borderColor: 'error.main',
                          borderRadius: 0.5,
                          px: 0.5,
                          py: '1px',
                          mb: 0.25,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <DeadlineIcon sx={{ fontSize: 11, flexShrink: 0 }} />
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstDeadline.title}</Box>
                      </Box>
                    )}
                    {(overflow > 0 || deadlineOverflow > 0) && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                        {overflow > 0 && `+${overflow} task${overflow > 1 ? 's' : ''}`}
                        {overflow > 0 && deadlineOverflow > 0 && ' · '}
                        {deadlineOverflow > 0 && `+${deadlineOverflow} deadline${deadlineOverflow > 1 ? 's' : ''}`}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Card>

      {/* Day dialog — list tasks for the selected date + add */}
      <ResponsiveDialog
        open={!!selectedDate}
        onClose={() => setSelectedDate(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}>
          <Box>
            {selectedDate && new Date(selectedDate + 'T00:00:00.000Z').toLocaleDateString('en-IN', {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
            })}
          </Box>
          <Button size="small" startIcon={<AddIcon />} onClick={openCreate} variant="outlined">
            Add
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          {selectedTasks.length === 0 && selectedDeadlineOnly.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No work scheduled or due. Click “Add” to create a task for this day.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {selectedTasks.length > 0 && (
                <Box>
                  <Typography variant="overline" color="text.secondary">Scheduled</Typography>
                  <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                    {selectedTasks.map((task) => renderTaskCard(task, false))}
                  </Stack>
                </Box>
              )}
              {selectedDeadlineOnly.length > 0 && (
                <Box>
                  <Typography variant="overline" color="error.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <DeadlineIcon sx={{ fontSize: 14 }} /> Deadlines due
                  </Typography>
                  <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                    {selectedDeadlineOnly.map((task) => renderTaskCard(task, true))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedDate(null)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Create / Edit task form */}
      <ResponsiveDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingId(null); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editingId ? 'Edit Work Task' : 'New Work Task'}</DialogTitle>
        <DialogContent dividers>
          {isLoading && <CircularProgress size={20} sx={{ mb: 1 }} />}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
            <TextField
              label="Title"
              required
              value={String(form.title ?? '')}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              fullWidth
              size="small"
            />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="Date"
                type="date"
                required
                value={String(form.scheduledDate ?? '')}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                size="small"
                sx={{ width: { xs: '100%', sm: 200 } }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Deadline (optional)"
                type="date"
                value={String(form.deadlineDate ?? '')}
                onChange={(e) => setForm({ ...form, deadlineDate: e.target.value })}
                size="small"
                sx={{ width: { xs: '100%', sm: 200 } }}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                select
                label="Type"
                value={String(form.type ?? WorkTaskType.OTHER)}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                size="small"
                sx={{ width: { xs: '100%', sm: 180 } }}
              >
                {enumToOptions(WorkTaskType).map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Priority"
                value={String(form.priority ?? WorkTaskPriority.MEDIUM)}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                size="small"
                sx={{ width: { xs: '100%', sm: 180 } }}
              >
                {enumToOptions(WorkTaskPriority).map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Status"
                value={String(form.status ?? WorkTaskStatus.PLANNED)}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                size="small"
                sx={{ width: { xs: '100%', sm: 180 } }}
              >
                {enumToOptions(WorkTaskStatus).map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
            </Box>
            <TextField
              select
              label="Assign to"
              value={String(form.assignedTo ?? '')}
              onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">Unassigned</MenuItem>
              {(assignableUsers as AssignableUser[] ?? []).map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name} ({u.role.replace(/_/g, ' ')})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Link to Quotation"
              value={String(form.linkedQuotationId ?? '')}
              onChange={(e) => setForm({ ...form, linkedQuotationId: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">None</MenuItem>
              {(linkableQuotations as LinkableQuotation[] ?? []).map((q) => (
                <MenuItem key={q.id} value={q.id}>
                  {q.quotationNumber} — {q.vendor.name} ({q.status.replace(/_/g, ' ')})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Link to Purchase Order"
              value={String(form.linkedPoId ?? '')}
              onChange={(e) => setForm({ ...form, linkedPoId: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">None</MenuItem>
              {(linkablePos as LinkablePo[] ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.poNumber} — {p.vendor.name} ({p.status.replace(/_/g, ' ')})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Notes"
              value={String(form.description ?? '')}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth
              size="small"
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setFormOpen(false); setEditingId(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitForm}
            disabled={!form.title || !form.scheduledDate || saveMutation.isPending}
          >
            {saveMutation.isPending ? <CircularProgress size={20} /> : editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
