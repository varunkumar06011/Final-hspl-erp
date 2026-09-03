import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, Typography, Card, CardContent, Chip, IconButton, Tooltip, Alert, CircularProgress } from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import api from '../config/api';
import { WorkTaskStatus, WorkTaskPriority } from '@hospital-erp/shared';
import { formatDate } from '../utils/enumOptions';

interface WorkTask {
  id: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  status: string;
  scheduledDate: string;
  deadlineDate?: string;
  assignedToUser?: { id: string; name: string } | null;
  assignedVendor?: { id: string; name: string } | null;
}

const COLUMNS: { status: WorkTaskStatus; label: string; color: string }[] = [
  { status: WorkTaskStatus.PLANNED, label: 'Planned', color: '#90CAF9' },
  { status: WorkTaskStatus.IN_PROGRESS, label: 'In Progress', color: '#FFB74D' },
  { status: WorkTaskStatus.DONE, label: 'Done', color: '#81C784' },
  { status: WorkTaskStatus.CANCELLED, label: 'Cancelled', color: '#E57373' },
];

const PRIORITY_COLORS: Record<string, 'default' | 'error' | 'warning' | 'success'> = {
  HIGH: 'error',
  URGENT: 'error',
  MEDIUM: 'warning',
  LOW: 'success',
};

interface KanbanBoardProps {
  /** Called when edit button is clicked on a task */
  onEdit?: (task: WorkTask) => void;
  /** Called when a new task button is clicked */
  onCreate?: () => void;
}

export default function KanbanBoard({ onEdit }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['/work-tasks', 'kanban'],
    queryFn: async () => {
      const response = await api.get('/work-tasks', { params: { pageSize: 200 } });
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: WorkTaskStatus }) => {
      return api.patch(`/work-tasks/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/work-tasks'] });
    },
    onError: () => {
      setError('Failed to update task status');
      setTimeout(() => setError(''), 3000);
    },
  });

  const tasks: WorkTask[] = data?.data ?? [];

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(status);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, status: WorkTaskStatus) => {
    e.preventDefault();
    setDragOver(null);
    if (draggedId) {
      updateMutation.mutate({ id: draggedId, status });
      setDraggedId(null);
    }
  }, [draggedId, updateMutation]);

  const handleDragLeave = useCallback(() => {
    setDragOver(null);
  }, []);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
            gap: 2,
            minHeight: 400,
          }}
        >
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <Box
                key={col.status}
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDrop={(e) => handleDrop(e, col.status)}
                onDragLeave={handleDragLeave}
                sx={{
                  borderRadius: 2,
                  p: 1.5,
                  minHeight: 400,
                  transition: 'background-color 0.2s',
                  bgcolor: dragOver === col.status ? 'action.hover' : 'background.default',
                  border: dragOver === col.status ? '2px dashed' : '1px solid',
                  borderColor: dragOver === col.status ? 'primary.main' : 'divider',
                }}
              >
                {/* Column header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: col.color }} />
                  <Typography variant="subtitle2" fontWeight={600}>
                    {col.label}
                  </Typography>
                  <Chip label={colTasks.length} size="small" sx={{ ml: 'auto', height: 20, fontSize: '0.7rem' }} />
                </Box>

                {/* Task cards */}
                {colTasks.map((task) => (
                  <Card
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    sx={{
                      mb: 1,
                      cursor: 'grab',
                      '&:active': { cursor: 'grabbing' },
                      '&:hover': { boxShadow: 3 },
                      opacity: draggedId === task.id ? 0.5 : 1,
                      transition: 'opacity 0.2s, box-shadow 0.2s',
                    }}
                  >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 0.5 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>
                          {task.title}
                        </Typography>
                        {onEdit && (
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => onEdit(task)} sx={{ p: 0.25 }}>
                              <EditIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>

                      {task.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.description}
                        </Typography>
                      )}

                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                        <Chip label={task.type} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                        {task.priority !== WorkTaskPriority.LOW && (
                          <Chip label={task.priority} size="small" color={PRIORITY_COLORS[task.priority] ?? 'default'} sx={{ fontSize: '0.65rem', height: 18 }} />
                        )}
                      </Box>

                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {task.assignedToUser?.name ?? task.assignedVendor?.name ?? 'Unassigned'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(task.scheduledDate)}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                ))}

                {colTasks.length === 0 && (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <Typography variant="caption" color="text.secondary">
                      Drag tasks here
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
