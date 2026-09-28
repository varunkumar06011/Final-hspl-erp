import { useEffect, useState } from 'react';
import { Badge, DialogContent, DialogTitle, IconButton, Tab, Tabs, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { UserResponse } from '@hospital-erp/shared';
import ResponsiveDialog from './ResponsiveDialog';
import { PendingItemsContent, ENTITY_CONFIGS, type PendingEntityType } from './PendingItemsDialog';

interface AllPendingTasksDialogProps {
  open: boolean;
  user: UserResponse | null;
  onClose: () => void;
  counts: Record<PendingEntityType, number>;
  initialTab?: PendingEntityType;
}

const TAB_ORDER: PendingEntityType[] = ['quotations', 'pos', 'invoices', 'payments'];

// All pending approval tasks (quotations, POs, invoices, payments) in one
// place, tabbed by type. Each tab reuses the same list + approve/reject +
// confirmation logic as the single-type PendingItemsDialog.
export default function AllPendingTasksDialog({ open, user, onClose, counts, initialTab }: AllPendingTasksDialogProps) {
  const [tab, setTab] = useState<PendingEntityType>(initialTab ?? 'quotations');

  useEffect(() => {
    if (open) setTab(initialTab ?? 'quotations');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalCount = TAB_ORDER.reduce((sum, t) => sum + (counts[t] ?? 0), 0);

  return (
    <ResponsiveDialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}>
        <Typography variant="h6" component="span" fontWeight={600}>
          All Pending Tasks {totalCount > 0 ? `(${totalCount})` : ''}
        </Typography>
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {TAB_ORDER.map((t) => (
          <Tab
            key={t}
            value={t}
            label={
              <Badge badgeContent={counts[t] ?? 0} color="warning" max={99} sx={{ pr: counts[t] ? 1.2 : 0 }}>
                {ENTITY_CONFIGS[t].entityLabel}
              </Badge>
            }
          />
        ))}
      </Tabs>
      <DialogContent sx={{ pt: '12px !important' }}>
        <PendingItemsContent entityType={tab} user={user} open={open} onClose={onClose} />
      </DialogContent>
    </ResponsiveDialog>
  );
}
