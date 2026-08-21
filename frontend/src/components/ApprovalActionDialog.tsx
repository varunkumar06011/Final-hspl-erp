import { useEffect, useState } from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import ResponsiveDialog from './ResponsiveDialog';
import AcknowledgementCheckbox from './AcknowledgementCheckbox';

interface ApprovalActionDialogProps {
  open: boolean;
  action: 'approve' | 'reject';
  entityLabel: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (payload: { comments?: string; reason?: string; acknowledged: true }) => void;
}

export default function ApprovalActionDialog({
  open,
  action,
  entityLabel,
  pending = false,
  onClose,
  onConfirm,
}: ApprovalActionDialogProps) {
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) {
      setNotes('');
      setAcknowledged(false);
    }
  }, [open]);

  const isReject = action === 'reject';

  return (
    <ResponsiveDialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isReject ? 'Reject' : 'Approve'} {entityLabel}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <TextField
          label={isReject ? 'Reason for rejection' : 'Comments (optional)'}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          multiline
          minRows={3}
          required={isReject}
        />
        <AcknowledgementCheckbox
          checked={acknowledged}
          onChange={setAcknowledged}
          entityLabel={entityLabel.toLowerCase()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        <Button
          variant="contained"
          color={isReject ? 'error' : 'success'}
          disabled={pending || !acknowledged || (isReject && !notes.trim())}
          onClick={() => onConfirm({
            ...(isReject ? { reason: notes.trim() } : notes.trim() ? { comments: notes.trim() } : {}),
            acknowledged: true,
          })}
        >
          {isReject ? 'Reject' : 'Approve'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
