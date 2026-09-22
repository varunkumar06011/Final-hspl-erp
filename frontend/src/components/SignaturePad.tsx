import { useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, CircularProgress } from '@mui/material';

const PAD_W = 560;
const PAD_H = 240;

/**
 * Finger/stylus signature pad — draws on a canvas, exports a PNG data URL.
 * Pointer events cover touch, pen and mouse; touch-action:none keeps the
 * stroke from scrolling the page while signing on a phone.
 */
export default function SignaturePad({ open, title, saving, onClose, onSave }: {
  open: boolean;
  title?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  };

  const ctx = () => canvasRef.current!.getContext('2d')!;

  const start = (e: React.PointerEvent) => {
    drawing.current = true;
    const { x, y } = pos(e);
    const c = ctx();
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#101418';
    c.beginPath();
    c.moveTo(x, y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    const c = ctx();
    c.lineTo(x, y);
    c.stroke();
    setDirty(true);
  };

  const stop = () => { drawing.current = false; };

  const clear = () => {
    const c = canvasRef.current;
    if (c) ctx().clearRect(0, 0, c.width, c.height);
    setDirty(false);
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>{title ?? 'Sign Voucher'}</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Sign with your finger inside the box, then tap Save.
        </Typography>
        <Box sx={{ border: '1.5px dashed', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: '#fff', touchAction: 'none' }}>
          <Box
            component="canvas"
            ref={canvasRef}
            width={PAD_W}
            height={PAD_H}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            sx={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair' }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={clear} disabled={saving || !dirty}>Clear</Button>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!dirty || saving}
          onClick={() => onSave(canvasRef.current!.toDataURL('image/png'))}
        >
          {saving ? <CircularProgress size={20} /> : 'Save Signature'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
