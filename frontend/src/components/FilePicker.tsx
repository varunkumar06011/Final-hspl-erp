import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import CameraCapture from './CameraCapture';
import UploadSourceButton from './UploadSourceButton';

interface FilePickerProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Button text when no file is selected. */
  label: ReactNode;
  /** Button text when a file is selected; defaults to the file name. */
  selectedLabel?: ReactNode;
  startIcon?: ReactNode;
  /** `accept` for the upload input. Camera photos are always images. */
  accept?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
}

/**
 * Upload button + camera icon + (when a file is chosen) a thumbnail and a
 * remove (X) button. Camera flow has live preview with retake.
 */
export default function FilePicker({
  file,
  onChange,
  label,
  selectedLabel,
  startIcon,
  accept,
  disabled,
  size = 'medium',
  fullWidth,
}: FilePickerProps) {
  const { t } = useTranslation();

  const previewUrl = useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <UploadSourceButton
        onFile={onChange}
        accept={accept}
        startIcon={startIcon}
        disabled={disabled}
        size={size}
        fullWidth={fullWidth}
      >
        {file ? (selectedLabel ?? file.name) : label}
      </UploadSourceButton>
      <CameraCapture size={size} disabled={disabled} onCapture={onChange} />
      {previewUrl && (
        <Box
          component="img"
          src={previewUrl}
          alt=""
          sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
        />
      )}
      {file && (
        <Tooltip title={t('shared.removePhoto')}>
          <IconButton size="small" color="error" disabled={disabled} onClick={() => onChange(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
