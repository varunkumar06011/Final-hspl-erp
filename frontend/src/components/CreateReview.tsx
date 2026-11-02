import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, DialogActions, DialogContent, DialogTitle, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ResponsiveDialog from './ResponsiveDialog';
import { readFormForReview, topDialogPaper, type ReviewData } from '../utils/reviewForm';

/**
 * "Check before you create": before a new record is saved, show everything that was typed
 * or chosen in the open form, and save only when the person confirms.
 *
 *   const review = useCreateReview();
 *   ...
 *   if (editing) mutation.mutate(payload);          // edits save directly
 *   else review(() => mutation.mutate(payload));    // creates are checked first
 *
 * The summary is read from the form on screen (see utils/reviewForm.ts), so a screen does
 * not describe its fields a second time. If there is nothing to show, it just saves.
 */

interface ReviewOptions {
  /** Text of the confirm button; defaults to "Create". */
  confirmLabel?: string;
  /** Read this element instead of the dialog on top (for forms that are not in a dialog). */
  root?: Element | null;
}

type Review = (onConfirm: () => void, options?: ReviewOptions) => void;

const ReviewContext = createContext<Review>((onConfirm) => onConfirm());

export function useCreateReview(): Review {
  return useContext(ReviewContext);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '38% 1fr' }, gap: { xs: 0, sm: 1.5 }, py: 0.6 }}>
      {label ? (
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      ) : (
        <span />
      )}
      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{value}</Typography>
    </Box>
  );
}

export function CreateReviewProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<{ data: ReviewData; confirmLabel?: string } | null>(null);
  // kept in a ref: the confirm callback is called once, from the button, never re-rendered
  const onConfirm = useRef<(() => void) | null>(null);
  // a quick second tap on Create must not create the record twice
  const sent = useRef(false);

  const review = useCallback<Review>((confirm, options) => {
    const root = options?.root ?? topDialogPaper();
    const data = root ? readFormForReview(root) : { fields: [], lines: [] };
    if (data.fields.length === 0 && data.lines.length === 0) {
      confirm(); // nothing readable to show
      return;
    }
    onConfirm.current = confirm;
    sent.current = false;
    setPending({ data, confirmLabel: options?.confirmLabel });
  }, []);

  const back = () => {
    onConfirm.current = null;
    setPending(null);
  };
  const create = () => {
    if (sent.current) return;
    sent.current = true;
    const run = onConfirm.current;
    onConfirm.current = null;
    setPending(null);
    run?.();
  };

  const value = useMemo(() => review, [review]);

  return (
    <ReviewContext.Provider value={value}>
      {children}
      <ResponsiveDialog open={!!pending} onClose={back} maxWidth="sm" fullWidth hideCloseButton data-review-dialog>
        <DialogTitle>{t('review.title')}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 1.5 }}>{t('review.intro')}</Alert>
          {pending && (
            <>
              {pending.data.fields.length > 0 && (
                <Box sx={{ '& > *:not(:last-child)': { borderBottom: 1, borderColor: 'divider' } }}>
                  {pending.data.fields.map((r, i) => <Row key={`${r.label}-${i}`} label={r.label} value={r.value} />)}
                </Box>
              )}
              {pending.data.lines.map((line, n) => (
                <Paper key={n} variant="outlined" sx={{ p: 1.25, mt: 1.5 }}>
                  <Typography variant="caption" fontWeight={700} color="primary">{t('review.line', { n: n + 1 })}</Typography>
                  {line.map((r, i) => <Row key={`${r.label}-${i}`} label={r.label} value={r.value} />)}
                </Paper>
              ))}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={back}>{t('review.back')}</Button>
          <Button variant="contained" onClick={create}>{pending?.confirmLabel ?? t('review.create')}</Button>
        </DialogActions>
      </ResponsiveDialog>
    </ReviewContext.Provider>
  );
}
