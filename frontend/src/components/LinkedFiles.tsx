import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Delete as DeleteIcon,
  AttachFile as AttachFileIcon,
  Download as DownloadIcon,
  Image as ImageIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { downloadPath } from '../utils/file';
import { useFileViewer } from './FileViewerDialog';
import CameraCapture from './CameraCapture';
import ResponsiveDialog from './ResponsiveDialog';
import UploadSourceButton from './UploadSourceButton';

export type ChainType = 'MPR' | 'QUOTATION' | 'PO' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT';

/** Attachment.entityType the backend stores for each record type. */
const ENTITY_TYPE: Record<ChainType, string> = {
  MPR: 'MATERIAL_PURCHASE_REQUEST',
  QUOTATION: 'QUOTATION',
  PO: 'PURCHASE_ORDER',
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  INVOICE: 'VENDOR_INVOICE',
  PAYMENT: 'PAYMENT_REQUEST',
};

interface LinkedFile {
  key: string;
  source: 'ATTACHMENT' | 'RECORD';
  id: string;
  fileName: string;
  mimeType: string | null;
  fileType: 'IMAGE' | 'DOCUMENT';
  description: string | null;
  uploadedBy: { id: string; name: string } | null;
  uploadedAt: string;
  recordType: ChainType;
  recordId: string;
  recordLabel: string;
  own: boolean;
  fileRoute: string;
  canDelete: boolean;
  deleteRoute?: string;
}

interface LinkedFilesProps {
  recordType: ChainType;
  recordId: string | null | undefined;
  /** Hide the upload buttons (read-only view). */
  readOnly?: boolean;
  size?: 'small' | 'medium';
}

/**
 * Every file and photo on a procurement record AND on the records it came from / led to
 * (MPR -> quotation -> PO -> receipt / invoice -> payment). Upload as many as needed; each
 * file is stored once against the record it was added on and shows up on all the others.
 * Refreshes by itself, so a file added elsewhere appears here without reopening.
 */
export default function LinkedFiles({ recordType, recordId, readOnly, size = 'small' }: LinkedFilesProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { openPath, viewer } = useFileViewer();
  const [error, setError] = useState('');
  const queryKey = ['attachments', 'related', recordType, recordId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get('/attachments/related', {
        params: { entityType: ENTITY_TYPE[recordType], entityId: recordId },
      });
      return (res.data?.data ?? []) as LinkedFile[];
    },
    enabled: !!recordId,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['attachments'] });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', ENTITY_TYPE[recordType]);
      formData.append('entityId', recordId!);
      return (await api.post('/attachments/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (route: string) => api.delete(route),
    onSuccess: refresh,
    onError: (err: unknown) => setError(extractErrorMessage(err)),
  });

  const rows = data ?? [];
  const busy = uploadMutation.isPending;

  return (
    <Box>
      {viewer}
      <Typography variant={size === 'small' ? 'body2' : 'body1'} fontWeight={600} sx={{ mb: 1 }}>
        {t('shared.filesTitle')}
        {rows.length > 0 && <Chip label={rows.length} size="small" sx={{ ml: 1 }} />}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {!readOnly && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <UploadSourceButton
            multiple
            onFile={(f) => uploadMutation.mutate(f)}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
            startIcon={<UploadIcon />}
            size={size}
            disabled={!recordId || busy}
          >
            {busy ? <CircularProgress size={16} /> : t('shared.uploadFiles')}
          </UploadSourceButton>
          <CameraCapture label size={size} onCapture={(f) => uploadMutation.mutate(f)} disabled={!recordId || busy} />
        </Box>
      )}

      {isLoading ? (
        <CircularProgress size={20} />
      ) : rows.length > 0 ? (
        <List dense disablePadding>
          {rows.map((row) => (
            <ListItem
              key={row.key}
              disableGutters
              sx={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 0.5 }}
              secondaryAction={undefined}
            >
              <Box sx={{ pt: 0.5 }}>
                {row.fileType === 'IMAGE' ? <ImageIcon fontSize="small" color="primary" /> : <AttachFileIcon fontSize="small" />}
              </Box>
              <ListItemText
                sx={{ ml: 1, minWidth: 0, flex: '1 1 160px' }}
                primary={row.fileName}
                primaryTypographyProps={{ sx: { wordBreak: 'break-all' } }}
                secondary={
                  <>
                    <Chip
                      component="span"
                      size="small"
                      variant={row.own ? 'filled' : 'outlined'}
                      color={row.own ? 'primary' : 'default'}
                      label={`${t(`shared.chain.${row.recordType}`)}${row.recordLabel ? ` ${row.recordLabel}` : ''}`}
                      sx={{ height: 18, fontSize: 11, mr: 0.75 }}
                    />
                    {[row.description, row.uploadedBy?.name].filter(Boolean).join(' • ')}
                  </>
                }
              />
              <Box sx={{ display: 'flex', flexShrink: 0 }}>
                <Tooltip title={t('shared.view')}>
                  <IconButton size="small" onClick={() => openPath(row.fileRoute, row.fileName)}>
                    <ViewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('shared.download')}>
                  <IconButton
                    size="small"
                    onClick={() => void downloadPath(row.fileRoute, row.fileName).catch(() => setError(t('shared.errDownload')))}
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {!readOnly && row.canDelete && row.deleteRoute && (
                  <IconButton size="small" color="error" onClick={() => deleteMutation.mutate(row.deleteRoute!)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            </ListItem>
          ))}
        </List>
      ) : (
        recordId && (
          <Typography variant="body2" color="text.secondary">
            {t('shared.noAttachments')}
          </Typography>
        )
      )}
    </Box>
  );
}

interface LinkedFilesButtonProps extends Omit<LinkedFilesProps, 'size'> {
  /** Record number shown in the dialog title */
  title?: string;
}

/** Paperclip button that opens the linked files of a record in a dialog (for table rows). */
export function LinkedFilesButton({ recordType, recordId, readOnly, title }: LinkedFilesButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip title={t('shared.filesTitle')}>
        <IconButton size="small" onClick={() => setOpen(true)}>
          <AttachFileIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <ResponsiveDialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{[t('shared.filesTitle'), title].filter(Boolean).join(' — ')}</DialogTitle>
        <DialogContent>{open && <LinkedFiles recordType={recordType} recordId={recordId} readOnly={readOnly} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('shared.close')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
