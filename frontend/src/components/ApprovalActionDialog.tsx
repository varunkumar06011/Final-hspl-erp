import { useEffect, useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ResponsiveDialog from './ResponsiveDialog';
import AcknowledgementCheckbox from './AcknowledgementCheckbox';

interface ApprovalActionDialogProps {
  open: boolean;
  action: 'approve' | 'reject';
  entityLabel: string;
  pending?: boolean;
  error?: string;
  onClearError?: () => void;
  onClose: () => void;
  onConfirm: (payload: { comments?: string; reason?: string; acknowledged: true }) => void;
}

export default function ApprovalActionDialog({
  open,
  action,
  entityLabel,
  pending = false,
  error,
  onClearError,
  onClose,
  onConfirm,
}: ApprovalActionDialogProps) {
  const { t } = useTranslation();
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
      <DialogTitle>{isReject ? t('approval.reject') : t('approval.approve')} {entityLabel}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error" sx={{ width: '100%' }} onClose={onClearError}>{error}</Alert>}
        <TextField
          label={isReject ? t('approval.reasonForRejection') : t('approval.commentsOptional')}
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
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={pending}>{t('approval.cancel')}</Button>
        <Button
          variant="contained"
          color={isReject ? 'error' : 'success'}
          disabled={pending || !acknowledged || (isReject && !notes.trim())}
          onClick={() => onConfirm({
            ...(isReject ? { reason: notes.trim() } : notes.trim() ? { comments: notes.trim() } : {}),
            acknowledged: true,
          })}
        >
          {isReject ? t('approval.reject') : t('approval.approve')}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
