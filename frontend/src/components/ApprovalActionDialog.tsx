import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import DrawIcon from '@mui/icons-material/Draw';
import ResponsiveDialog from './ResponsiveDialog';
import AcknowledgementCheckbox from './AcknowledgementCheckbox';
import type { BudgetOverrun } from '../config/api';
import { formatCurrency } from '../utils/enumOptions';

interface ApprovalActionDialogProps {
  open: boolean;
  action: 'approve' | 'reject';
  entityLabel: string;
  pending?: boolean;
  error?: string;
  onClearError?: () => void;
  onClose: () => void;
  onConfirm: (payload: { comments?: string; reason?: string; acknowledged: true }) => void;
  /** Set after an approval was refused for going over budget: asks for a reason and an explicit yes. */
  overBudget?: BudgetOverrun | null;
  /** Wording for the approve / reject title and button (default Approve / Reject), e.g. Finalize / Not selected. */
  approveLabel?: string;
  rejectLabel?: string;
  /** Approve only: 'will_sign' = the approver's saved signature is applied (consent shown); 'none' = approving without one. */
  signature?: 'will_sign' | 'none';
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
  overBudget,
  approveLabel,
  rejectLabel,
  signature,
}: ApprovalActionDialogProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [overBudgetYes, setOverBudgetYes] = useState(false);

  useEffect(() => {
    if (!open) {
      setNotes('');
      setAcknowledged(false);
      setOverBudgetYes(false);
    }
  }, [open]);

  const isReject = action === 'reject';
  const needsOverBudgetYes = !isReject && !!overBudget;
  const actionLabel = isReject ? rejectLabel ?? t('approval.reject') : approveLabel ?? t('approval.approve');

  return (
    <ResponsiveDialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{actionLabel} {entityLabel}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {needsOverBudgetYes ? (
          <Alert severity="warning" sx={{ width: '100%' }}>
            {t('approval.overBudgetText', {
              head: overBudget!.budgetHead,
              allocated: formatCurrency(overBudget!.allocated),
              after: formatCurrency(overBudget!.afterApproval),
            })}
          </Alert>
        ) : (
          error && <Alert severity="error" sx={{ width: '100%' }} onClose={onClearError}>{error}</Alert>
        )}
        <TextField
          label={isReject ? t('approval.reasonForRejection') : needsOverBudgetYes ? t('approval.overBudgetReason') : t('approval.commentsOptional')}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          multiline
          minRows={3}
          required={isReject || needsOverBudgetYes}
        />
        {needsOverBudgetYes && (
          <FormControlLabel
            control={<Checkbox checked={overBudgetYes} onChange={(e) => setOverBudgetYes(e.target.checked)} color="warning" />}
            label={t('approval.overBudgetYes')}
          />
        )}
        {!isReject && signature === 'will_sign' && (
          <Alert severity="info" icon={<DrawIcon fontSize="small" />} sx={{ width: '100%' }}>
            {t('approval.signatureWillApply', { entity: entityLabel.toLowerCase() })}
          </Alert>
        )}
        {!isReject && signature === 'none' && (
          <Alert severity="warning" sx={{ width: '100%' }}>{t('approval.signatureNone')}</Alert>
        )}
        <AcknowledgementCheckbox
          checked={acknowledged}
          onChange={setAcknowledged}
          entityLabel={entityLabel.toLowerCase()}
          withSignature={!isReject && signature === 'will_sign'}
        />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={pending}>{t('approval.cancel')}</Button>
        <Button
          variant="contained"
          color={isReject ? 'error' : needsOverBudgetYes ? 'warning' : 'success'}
          disabled={
            pending || !acknowledged || (isReject && !notes.trim()) || (needsOverBudgetYes && (!overBudgetYes || !notes.trim()))
          }
          onClick={() => onConfirm({
            ...(isReject ? { reason: notes.trim() } : notes.trim() ? { comments: notes.trim() } : {}),
            acknowledged: true,
          })}
        >
          {actionLabel}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
