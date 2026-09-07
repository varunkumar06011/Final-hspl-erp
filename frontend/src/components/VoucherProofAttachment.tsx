import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
  CircularProgress,
  Alert,
  Tooltip,
  Link,
} from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  PhotoCamera as CameraIcon,
  RemoveCircle as RemoveIcon,
  PictureAsPdf as PdfIcon,
  InsertDriveFile as FileIcon,
  Visibility as PreviewIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import api, { extractErrorMessage } from '../config/api';
import { fetchFileUrl, downloadFile } from '../utils/file';

// ── Types ──────────────────────────────────────────────────
interface SavedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileType: string;
  filePath: string;
  createdAt: string;
}

interface VoucherProofAttachmentProps {
  /** Voucher ID — when set, existing attachments are loaded and managed. */
  voucherId?: string | null;
  /** Pending file selected by user (managed by parent in create mode). */
  pendingFile?: File | null;
  /** Callback when user selects or removes a pending file. */
  onPendingFileChange?: (file: File | null) => void;
}

const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — matches backend multer limit

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function isPdfMime(mime: string): boolean {
  return mime === 'application/pdf';
}

// ── Component ──────────────────────────────────────────────
export default function VoucherProofAttachment({
  voucherId,
  pendingFile,
  onPendingFileChange,
}: VoucherProofAttachmentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Pending file preview URL (derived from pendingFile prop)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  // Saved attachments (when voucherId is provided)
  const [attachments, setAttachments] = useState<SavedAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [error, setError] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploadingNew, setUploadingNew] = useState(false);

  // ── Sync pending file → preview URL ──
  useEffect(() => {
    if (pendingFile) {
      const url = URL.createObjectURL(pendingFile);
      setPendingPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPendingPreviewUrl(null);
    return undefined;
  }, [pendingFile]);

  // ── Load existing attachments when voucherId is provided ──
  const loadAttachments = useCallback(async () => {
    if (!voucherId) return;
    setLoadingAttachments(true);
    setError('');
    try {
      const res = await api.get('/attachments', {
        params: { entityType: 'VOUCHER', entityId: voucherId },
      });
      setAttachments(res.data.data ?? []);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingAttachments(false);
    }
  }, [voucherId]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  // ── Cleanup blob URLs on unmount ──
  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle file selection ──
  const handleFileSelected = (file: File | undefined) => {
    if (!file) return;
    setError('');

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Unsupported file type. Please upload JPG, JPEG, PNG, WEBP, or PDF.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${formatFileSize(file.size)}). Maximum allowed: ${formatFileSize(MAX_FILE_SIZE)}.`);
      return;
    }

    onPendingFileChange?.(file);
  };

  // ── Remove pending file ──
  const removePendingFile = () => {
    onPendingFileChange?.(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // ── Upload a file immediately (edit/detail mode — voucher already exists) ──
  const uploadDirectly = async (file: File) => {
    if (!voucherId) return;
    setUploadingNew(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', 'VOUCHER');
      formData.append('entityId', voucherId);
      formData.append('description', 'Proof attachment for voucher');

      await api.post('/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadAttachments();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setUploadingNew(false);
    }
  };

  // ── Handle file selection in edit/detail mode (upload immediately) ──
  const handleFileSelectedExisting = (file: File | undefined) => {
    if (!file) return;
    setError('');
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Unsupported file type. Please upload JPG, JPEG, PNG, WEBP, or PDF.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${formatFileSize(file.size)}). Maximum allowed: ${formatFileSize(MAX_FILE_SIZE)}.`);
      return;
    }
    uploadDirectly(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // ── Delete a saved attachment ──
  const deleteAttachment = async (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return;
    setError('');
    try {
      await api.delete(`/attachments/${attachmentId}`);
      if (previewUrls[attachmentId]) {
        URL.revokeObjectURL(previewUrls[attachmentId]);
        setPreviewUrls((prev) => {
          const next = { ...prev };
          delete next[attachmentId];
          return next;
        });
      }
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  // ── Preview a saved attachment (lazy load blob URL) ──
  const previewAttachment = async (attachment: SavedAttachment) => {
    if (previewUrls[attachment.id]) {
      window.open(previewUrls[attachment.id], '_blank');
      return;
    }
    try {
      const url = await fetchFileUrl('attachments', attachment.id);
      setPreviewUrls((prev) => ({ ...prev, [attachment.id]: url }));
      if (isPdfMime(attachment.mimeType)) {
        window.open(url, '_blank');
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  // ── Download a saved attachment ──
  const downloadAttachment = async (attachment: SavedAttachment) => {
    try {
      await downloadFile('attachments', attachment.id, attachment.fileName);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const hasVoucher = !!voucherId;
  const showPending = !!pendingFile;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Proof Attachment <Typography component="span" variant="caption" color="text.secondary">(Optional)</Typography>
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={(e) => hasVoucher ? handleFileSelectedExisting(e.target.files?.[0]) : handleFileSelected(e.target.files?.[0])}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => hasVoucher ? handleFileSelectedExisting(e.target.files?.[0]) : handleFileSelected(e.target.files?.[0])}
      />

      {/* Pending file preview (create mode — before voucher is saved) */}
      {showPending && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          {isImageMime(pendingFile!.type) && pendingPreviewUrl && (
            <Box
              component="img"
              src={pendingPreviewUrl}
              alt={pendingFile!.name}
              sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
            />
          )}
          {isPdfMime(pendingFile!.type) && <PdfIcon sx={{ fontSize: 40, color: 'error.main' }} />}
          {!isImageMime(pendingFile!.type) && !isPdfMime(pendingFile!.type) && <FileIcon sx={{ fontSize: 40, color: 'action.active' }} />}

          <Box sx={{ flex: 1, minWidth: 120 }}>
            <Typography variant="body2" fontWeight={500} noWrap>{pendingFile!.name}</Typography>
            <Typography variant="caption" color="text.secondary">{formatFileSize(pendingFile!.size)}</Typography>
          </Box>

          <Tooltip title="Preview">
            <IconButton size="small" onClick={() => pendingPreviewUrl && window.open(pendingPreviewUrl, '_blank')}>
              <PreviewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton size="small" color="error" onClick={removePendingFile}>
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Upload + Camera buttons — shown when no pending file (create mode) or always (edit/detail mode) */}
      {!showPending && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileInputRef.current?.click()}>
            Upload Proof
          </Button>
          <Button size="small" variant="outlined" startIcon={<CameraIcon />} onClick={() => cameraInputRef.current?.click()}>
            Camera
          </Button>
        </Box>
      )}

      {/* Uploading spinner (edit/detail mode) */}
      {uploadingNew && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">Uploading attachment...</Typography>
        </Box>
      )}

      {/* Saved attachments (edit / detail mode) */}
      {hasVoucher && (
        <>
          {loadingAttachments && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">Loading attachments...</Typography>
            </Box>
          )}

          {attachments.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {attachments.map((att) => (
                <Box
                  key={att.id}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    flexWrap: 'wrap',
                  }}
                >
                  {isImageMime(att.mimeType) && previewUrls[att.id] ? (
                    <Box
                      component="img"
                      src={previewUrls[att.id]}
                      alt={att.fileName}
                      sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                    />
                  ) : isImageMime(att.mimeType) ? (
                    <Box sx={{ width: 56, height: 56, borderRadius: 1, border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.50' }}>
                      <AttachFileIcon color="action" fontSize="small" />
                    </Box>
                  ) : isPdfMime(att.mimeType) ? (
                    <PdfIcon sx={{ fontSize: 40, color: 'error.main' }} />
                  ) : (
                    <FileIcon sx={{ fontSize: 40, color: 'action.active' }} />
                  )}

                  <Box sx={{ flex: 1, minWidth: 120 }}>
                    <Typography variant="body2" fontWeight={500} noWrap>
                      <Link component="button" type="button" onClick={() => previewAttachment(att)} sx={{ textDecoration: 'none', color: 'inherit' }}>
                        {att.fileName}
                      </Link>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {att.fileType === 'IMAGE' ? 'Image' : 'Document'}
                    </Typography>
                  </Box>

                  <Tooltip title="Preview / Open">
                    <IconButton size="small" onClick={() => previewAttachment(att)}>
                      <PreviewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Download">
                    <IconButton size="small" onClick={() => downloadAttachment(att)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => deleteAttachment(att.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
            </Box>
          )}

          {!loadingAttachments && attachments.length === 0 && !showPending && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              No proof attachment uploaded for this voucher.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
