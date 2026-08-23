import { useState, useRef } from 'react';
import {
  Box,
  Button,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Delete as DeleteIcon,
  AttachFile as AttachFileIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { downloadFile } from '../utils/file';

interface AttachmentUploadProps {
  entityType: string;
  entityId: string | null;
  size?: 'small' | 'medium';
}

export default function AttachmentUpload({
  entityType,
  entityId,
  size = 'small',
}: AttachmentUploadProps) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');

  const { data: attachments, isLoading } = useQuery({
    queryKey: ['attachments', entityType, entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const response = await api.get('/attachments', {
        params: { entityType, entityId },
      });
      return response.data?.data ?? [];
    },
    enabled: !!entityId,
    staleTime: 10_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: { file: File; description?: string }) => {
      const formData = new FormData();
      formData.append('file', payload.file);
      formData.append('entityType', entityType);
      formData.append('entityId', entityId!);
      if (payload.description) formData.append('description', payload.description);
      const response = await api.post('/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', entityType, entityId] });
      setDescription('');
      setError('');
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/attachments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', entityType, entityId] });
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const handleFileSelect = (file: File) => {
    if (!entityId) {
      setError('Save the record first before uploading attachments');
      return;
    }
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!allowedTypes.includes(file.type) || file.size > 50 * 1024 * 1024) {
      setError('File must be a supported document or image smaller than 50 MB');
      return;
    }
    uploadMutation.mutate({ file, description: description.trim() || undefined });
  };

  const rows = (attachments as Record<string, unknown>[]) ?? [];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant={size === 'small' ? 'body2' : 'body1'} fontWeight={600}>
          Attachments / Proof
        </Typography>
        {!entityId && (
          <Chip label="Save record first to upload" size="small" color="warning" />
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = '';
          }}
        />
        <Button
          variant="outlined"
          size={size}
          startIcon={<UploadIcon />}
          onClick={() => fileRef.current?.click()}
          disabled={!entityId || uploadMutation.isPending}
        >
          {uploadMutation.isPending ? <CircularProgress size={16} /> : 'Upload'}
        </Button>
      </Box>

      {isLoading ? (
        <CircularProgress size={20} />
      ) : rows.length > 0 ? (
        <List dense>
          {rows.map((row) => {
            const isImage = String(row.fileType) === 'IMAGE';
            return (
              <ListItem key={row.id as string} sx={{ pl: 0 }}>
                {isImage ? <ImageIcon fontSize="small" color="primary" /> : <AttachFileIcon fontSize="small" />}
                <ListItemText
                  primary={String(row.fileName)}
                  secondary={`${String(row.fileType)} • ${row.description ? String(row.description) : 'No description'} • ${(row.user as any)?.name ?? 'Unknown'}`}
                  sx={{ ml: 1 }}
                />
                <ListItemSecondaryAction>
                  <IconButton
                    size="small"
                    onClick={() => downloadFile('attachments', row.id as string, String(row.fileName)).catch(() => setError('Failed to download file'))}
                  >
                    <AttachFileIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => deleteMutation.mutate(row.id as string)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            );
          })}
        </List>
      ) : (
        entityId && (
          <Typography variant="body2" color="text.secondary">
            No attachments yet
          </Typography>
        )
      )}
    </Box>
  );
}
