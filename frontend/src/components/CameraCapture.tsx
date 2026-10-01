import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
} from '@mui/material';
import { PhotoCamera as CameraIcon, Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface CameraCaptureProps {
  /** Called with the captured photo as a JPEG File. */
  onCapture: (file: File) => void;
  disabled?: boolean;
  /** Render as a labelled outlined button instead of a bare camera icon. */
  label?: boolean;
  size?: 'small' | 'medium';
}

/**
 * Camera icon that opens the device camera in a live-preview dialog, with
 * Capture → Retake / Use photo. Falls back to the native camera picker
 * (`<input capture>`) when getUserMedia is unavailable or permission is denied.
 */
export default function CameraCapture({
  onCapture,
  disabled,
  label,
  size = 'small',
}: CameraCaptureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      // No camera API / permission denied → hand over to the native picker.
      setOpen(false);
      fallbackRef.current?.click();
    }
  }, [stopStream]);

  const clearShot = useCallback(() => {
    setShot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const handleOpen = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackRef.current?.click();
      return;
    }
    setOpen(true);
  };

  const handleClose = () => {
    stopStream();
    clearShot();
    setOpen(false);
  };

  // Start the preview once the dialog (and its <video>) has mounted.
  useEffect(() => {
    if (!open || shot) return;
    const id = window.setTimeout(() => void startStream(), 50);
    return () => window.clearTimeout(id);
  }, [open, shot, startStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setShot({ blob, url: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.9,
    );
  };

  const handleUse = () => {
    if (!shot) return;
    const file = new File([shot.blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    handleClose();
    onCapture(file);
  };

  return (
    <>
      <input
        ref={fallbackRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onCapture(f);
          e.target.value = '';
        }}
      />
      {label ? (
        <Button
          variant="outlined"
          size={size}
          startIcon={<CameraIcon />}
          onClick={handleOpen}
          disabled={disabled}
        >
          {t('shared.camera')}
        </Button>
      ) : (
        <Tooltip title={t('shared.takePhoto')}>
          <span>
            <IconButton size={size} color="primary" onClick={handleOpen} disabled={disabled}>
              <CameraIcon fontSize={size === 'small' ? 'small' : 'medium'} />
            </IconButton>
          </span>
        </Tooltip>
      )}

      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {t('shared.takePhoto')}
          <IconButton size="small" onClick={handleClose} aria-label={t('shared.cancel')}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ bgcolor: 'black', borderRadius: 1, overflow: 'hidden', lineHeight: 0 }}>
            {shot ? (
              <Box component="img" src={shot.url} alt="" sx={{ width: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain' }}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          {shot ? (
            <>
              <Button onClick={clearShot}>{t('shared.retake')}</Button>
              <Button variant="contained" onClick={handleUse}>
                {t('shared.usePhoto')}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleClose}>{t('shared.cancel')}</Button>
              <Button variant="contained" startIcon={<CameraIcon />} onClick={handleCapture}>
                {t('shared.capture')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
