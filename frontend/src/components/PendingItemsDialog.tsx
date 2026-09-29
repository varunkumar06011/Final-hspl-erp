import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import CloseIconSmall from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { APPROVER_ROLES, type UserResponse } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from './ResponsiveDialog';
import ApprovalActionDialog from './ApprovalActionDialog';
import { formatCurrency, formatDate, enumLabel } from '../utils/enumOptions';
import { useTranslation } from 'react-i18next';

// ─── Entity type configuration ──────────────────────────────────────────────
// Each pending entity maps to:
//  - the list API endpoint
//  - the status field + pending status value(s) used to filter pending records
//  - the approve/reject endpoint suffix
//  - the route to navigate to when "View" is clicked
//  - the fields to display for each record

export type PendingEntityType = 'payments' | 'quotations' | 'pos' | 'invoices' | 'mprs';

interface EntityConfig {
  title: string;
  endpoint: string;
  statusParam: string; // query param name
  pendingStatuses: string[]; // status values that count as "pending"
  approveEndpoint: (id: string) => string;
  rejectEndpoint: (id: string) => string;
  viewRoute: string;
  entityLabel: string; // singular label for the approval dialog
  pageSizeParam?: string; // query param name for page size (default: 'pageSize')
}

export const ENTITY_CONFIGS: Record<PendingEntityType, EntityConfig> = {
  payments: {
    title: 'Pending Payments',
    endpoint: '/payments',
    statusParam: 'status',
    pendingStatuses: ['PENDING'],
    approveEndpoint: (id) => `/payments/${id}/approve`,
    rejectEndpoint: (id) => `/payments/${id}/reject`,
    viewRoute: '/payments',
    entityLabel: 'Payment Request',
  },
  quotations: {
    title: 'Pending Quotations',
    endpoint: '/quotations',
    statusParam: 'status',
    pendingStatuses: ['SUBMITTED', 'UNDER_REVIEW'],
    approveEndpoint: (id) => `/quotations/${id}/approve`,
    rejectEndpoint: (id) => `/quotations/${id}/reject`,
    viewRoute: '/quotations',
    entityLabel: 'Quotation',
  },
  pos: {
    title: 'Pending Purchase Orders',
    endpoint: '/purchase-orders',
    statusParam: 'status',
    pendingStatuses: ['PENDING_APPROVAL'],
    approveEndpoint: (id) => `/purchase-orders/${id}/approve`,
    rejectEndpoint: (id) => `/purchase-orders/${id}/reject`,
    viewRoute: '/pos',
    entityLabel: 'Purchase Order',
  },
  invoices: {
    title: 'Pending Invoices',
    endpoint: '/invoices',
    statusParam: 'verificationStatus',
    pendingStatuses: ['PENDING'],
    approveEndpoint: (id) => `/invoices/${id}/approve`,
    rejectEndpoint: (id) => `/invoices/${id}/reject`,
    viewRoute: '/invoices',
    entityLabel: 'Invoice',
  },
  mprs: {
    title: 'Pending Material Purchase Requests',
    endpoint: '/material-purchase-requests',
    statusParam: 'status',
    pendingStatuses: ['SUBMITTED'],
    approveEndpoint: (id) => `/material-purchase-requests/${id}/approve`,
    rejectEndpoint: (id) => `/material-purchase-requests/${id}/reject`,
    viewRoute: '/material-purchase-requests',
    entityLabel: 'Material Purchase Request',
    pageSizeParam: 'limit',
  },
};

// ─── Record field extraction ────────────────────────────────────────────────
// Each entity has different field names. These helpers extract the most useful
// display fields from any pending record in a safe, defensive way.

interface RecordDisplay {
  id: string;
  code: string; // quotationNumber / poNumber / invoiceCode / paymentCode
  vendorName: string;
  amount: string; // formatted currency
  date: string; // formatted date
  status: string; // raw status for the chip
  approvalWorkflow?: {
    status?: string;
    steps?: Array<{
      approverRole: string;
      approverUserId?: string | null;
      status: string;
    }>;
  };
  deductions?: { amount: number; reason: string }[];
  totalDeductions?: number;
  netPayable?: number;
}

function extractRecord(entityType: PendingEntityType, raw: Record<string, unknown>): RecordDisplay {
  const vendor = raw.vendor as { name?: string } | null | undefined;
  switch (entityType) {
    case 'payments':
      return {
        id: String(raw.id ?? ''),
        code: String(raw.paymentCode ?? raw.requestNumber ?? '—'),
        vendorName: vendor?.name ?? (raw.type === 'EXPENSE' ? String(raw.description ?? '—') : '—'),
        amount: formatCurrency(Number(raw.amount ?? 0)),
        date: formatDate(String(raw.createdAt ?? '')),
        status: String(raw.status ?? 'PENDING'),
        approvalWorkflow: raw.approvalWorkflow as RecordDisplay['approvalWorkflow'],
      };
    case 'quotations':
      return {
        id: String(raw.id ?? ''),
        code: String(raw.quotationNumber ?? '—'),
        vendorName: vendor?.name ?? '—',
        amount: formatCurrency(Number(raw.totalAmount ?? 0)),
        date: formatDate(String(raw.date ?? raw.createdAt ?? '')),
        status: String(raw.status ?? 'SUBMITTED'),
        approvalWorkflow: raw.approvalWorkflow as RecordDisplay['approvalWorkflow'],
      };
    case 'pos':
      return {
        id: String(raw.id ?? ''),
        code: String(raw.poNumber ?? '—'),
        vendorName: vendor?.name ?? '—',
        amount: formatCurrency(Number(raw.grandTotal ?? 0)),
        date: formatDate(String(raw.date ?? raw.createdAt ?? '')),
        status: String(raw.status ?? 'PENDING_APPROVAL'),
        approvalWorkflow: raw.approvalWorkflow as RecordDisplay['approvalWorkflow'],
        deductions: Array.isArray(raw.deductions) ? raw.deductions : undefined,
        totalDeductions: raw.totalDeductions ? Number(raw.totalDeductions) : undefined,
        netPayable: raw.netPayable ? Number(raw.netPayable) : undefined,
      };
    case 'invoices':
      return {
        id: String(raw.id ?? ''),
        code: String(raw.invoiceCode ?? raw.invoiceNumber ?? '—'),
        vendorName: vendor?.name ?? '—',
        amount: formatCurrency(Number(raw.totalAmount ?? 0)),
        date: formatDate(String(raw.invoiceDate ?? raw.createdAt ?? '')),
        status: String(raw.verificationStatus ?? 'PENDING'),
        approvalWorkflow: raw.approvalWorkflow as RecordDisplay['approvalWorkflow'],
      };
    case 'mprs':
      return {
        id: String(raw.id ?? ''),
        code: String(raw.mprNumber ?? '—'),
        vendorName: vendor?.name ?? '—',
        amount: formatCurrency(Number(raw.estimatedTotal ?? 0)),
        date: formatDate(String(raw.date ?? raw.createdAt ?? '')),
        status: String(raw.status ?? 'SUBMITTED'),
        approvalWorkflow: raw.approvalWorkflow as RecordDisplay['approvalWorkflow'],
      };
  }
}

// ─── Authorization helper ───────────────────────────────────────────────────
// Mirrors the canApprove logic used in the existing pages: the user must be in
// APPROVER_ROLES, and there must be a PENDING step matching their role that
// they haven't already decided on.

function canUserApprove(record: RecordDisplay, user: UserResponse | null): boolean {
  if (!user || !APPROVER_ROLES.some((role) => role === user.role)) return false;
  if (!record.approvalWorkflow?.steps) return false;
  // Workflow already decided elsewhere (approved/rejected on another device or
  // by another admin) — never show approve/reject for it.
  const wfStatus = record.approvalWorkflow.status;
  if (wfStatus === 'APPROVED' || wfStatus === 'REJECTED') return false;
  const alreadyDecided = record.approvalWorkflow.steps.some(
    (step) => step.approverUserId === user.id && step.status !== 'PENDING',
  );
  if (alreadyDecided) return false;
  return record.approvalWorkflow.steps.some(
    (step) => step.approverRole === user.role && step.status === 'PENDING',
  );
}

// ─── Status chip color helper ───────────────────────────────────────────────
function statusColor(status: string): 'default' | 'warning' | 'success' | 'error' | 'info' {
  const s = status.toUpperCase();
  if (s === 'PENDING' || s === 'PENDING_APPROVAL' || s === 'SUBMITTED' || s === 'UNDER_REVIEW') return 'warning';
  if (s === 'APPROVED' || s === 'VERIFIED' || s === 'PAID') return 'success';
  if (s === 'REJECTED') return 'error';
  return 'default';
}

// ─── Component ──────────────────────────────────────────────────────────────

interface PendingItemsContentProps {
  entityType: PendingEntityType;
  user: UserResponse | null;
  open: boolean;
  onClose: () => void;
}

// ─── Content ────────────────────────────────────────────────────────────────
// The list + approve/reject logic for a single entity type, without the
// enclosing Dialog chrome. Reused by PendingItemsDialog (single-type dialog)
// and by AllPendingTasksDialog (tabbed, all-types-in-one-place dialog).
export function PendingItemsContent({ entityType, user, open, onClose }: PendingItemsContentProps) {
  const { t } = useTranslation('pending');
  const config = ENTITY_CONFIGS[entityType];
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [approvalAction, setApprovalAction] = useState<{ record: RecordDisplay; action: 'approve' | 'reject' } | null>(null);
  const [actionError, setActionError] = useState('');

  // Fetch pending records using the existing list API with status filter.
  // We fetch a reasonable page size (50) to cover most real-world pending lists.
  const { data, isLoading, isError, refetch, error } = useQuery({
    queryKey: ['pending-items', entityType],
    queryFn: async () => {
      // Use the same { params } syntax as the existing pages (e.g. QuotationsPage)
      const params: Record<string, string | number> = { page: 1, [config.pageSizeParam ?? 'pageSize']: 50 };
      // For quotations, the dashboard counts both SUBMITTED + UNDER_REVIEW as
      // pending, but the API only accepts a single status value. So we fetch
      // without a status filter and filter client-side.
      if (entityType !== 'quotations') {
        params[config.statusParam] = config.pendingStatuses[0];
      }
      const response = await api.get(config.endpoint, { params });
      return response.data;
    },
    enabled: open,
    // Keep the list in sync while the dialog is open — if an admin approves on
    // another device/section, the record disappears here within seconds.
    refetchInterval: 10000,
    refetchOnWindowFocus: 'always',
  });

  // Filter client-side for quotations (SUBMITTED + UNDER_REVIEW)
  // Also exclude any record where an approval step has been REJECTED —
  // a single rejection should remove it from the pending list even if
  // the top-level status hasn't been updated yet.
  // Additionally exclude records whose workflow is already APPROVED/REJECTED —
  // the top-level status may lag behind the workflow decision.
  const rawRecords: Record<string, unknown>[] = data?.data ?? [];
  const records: RecordDisplay[] = rawRecords
    .map((raw) => extractRecord(entityType, raw))
    .filter((rec) => {
      if (!config.pendingStatuses.includes(rec.status.toUpperCase())) return false;
      const wfStatus = rec.approvalWorkflow?.status;
      if (wfStatus === 'APPROVED' || wfStatus === 'REJECTED') return false;
      const hasRejectedStep = rec.approvalWorkflow?.steps?.some(
        (step) => step.status === 'REJECTED',
      );
      return !hasRejectedStep;
    });

  // ── Approve mutation — uses the existing approve endpoint ──
  const approveMutation = useMutation({
    mutationFn: async ({ id, comments, acknowledged }: { id: string; comments?: string; acknowledged: true }) => {
      const response = await api.post(config.approveEndpoint(id), { comments, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-items', entityType] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      setApprovalAction(null);
      setActionError('');
    },
    onError: (err: unknown) => setActionError(extractErrorMessage(err)),
  });

  // ── Reject mutation — uses the existing reject endpoint ──
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason, acknowledged }: { id: string; reason: string; acknowledged: true }) => {
      const response = await api.post(config.rejectEndpoint(id), { reason, acknowledged });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-items', entityType] });
      queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      setApprovalAction(null);
      setActionError('');
    },
    onError: (err: unknown) => setActionError(extractErrorMessage(err)),
  });

  const handleView = (record: RecordDisplay) => {
    onClose();
    navigate(`${config.viewRoute}?id=${record.id}`);
  };

  const handleApprove = (record: RecordDisplay) => {
    setActionError('');
    setApprovalAction({ record, action: 'approve' });
  };

  const handleReject = (record: RecordDisplay) => {
    setActionError('');
    setApprovalAction({ record, action: 'reject' });
  };

  const handleConfirmApproval = (payload: { comments?: string; reason?: string; acknowledged: true }) => {
    if (!approvalAction) return;
    if (approvalAction.action === 'approve') {
      approveMutation.mutate({ id: approvalAction.record.id, comments: payload.comments, acknowledged: payload.acknowledged });
    } else {
      rejectMutation.mutate({ id: approvalAction.record.id, reason: payload.reason!, acknowledged: payload.acknowledged });
    }
  };

  const pending = approveMutation.isPending || rejectMutation.isPending;

  return (
    <>
      <Box>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>
          )}

          {isLoading ? (
            <Stack spacing={1.5}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rounded" height={120} />
              ))}
            </Stack>
          ) : isError ? (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Alert severity="error" sx={{ mb: 2 }}>
                {extractErrorMessage(error) || t('errLoad')}
              </Alert>
              <Button size="small" onClick={() => refetch()}>{t('retry')}</Button>
            </Box>
          ) : records.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">{t('noneTitle', { title: t(`title.${entityType}`).toLowerCase() })}</Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('count', { count: records.length })}
              </Typography>
              <Stack spacing={1.5}>
                {records.map((record) => {
                  const canApprove = canUserApprove(record, user);
                  return (
                    <Card key={record.id} variant="outlined">
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        {/* Record header: code + status */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ overflowWrap: 'break-word' }}>
                            {record.code}
                          </Typography>
                          <Chip label={enumLabel(record.status)} size="small" color={statusColor(record.status)} />
                        </Box>

                        {/* Record details: stacked label/value rows */}
                        <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                          <DetailRow label={t('vendor')} value={record.vendorName} />
                          <DetailRow label={t('amount')} value={record.amount} />
                          {record.deductions && record.deductions.length > 0 && (
                            <>
                              {record.deductions.map((d, i) => (
                                <DetailRow key={i} label={t('lessLine', { reason: d.reason })} value={`-${formatCurrency(d.amount)}`} />
                              ))}
                              <DetailRow label={t('totalDeductions')} value={formatCurrency(Number(record.totalDeductions ?? 0))} />
                              <DetailRow label={t('netPayable')} value={formatCurrency(Number(record.netPayable ?? 0))} />
                            </>
                          )}
                          <DetailRow label={t('date')} value={record.date} />
                        </Stack>

                        {/* Actions */}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Button size="small" variant="outlined" startIcon={<VisibilityIcon />} onClick={() => handleView(record)}>
                            {t('view')}
                          </Button>
                          {canApprove && (
                            <>
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                startIcon={<CheckIcon />}
                                onClick={() => handleApprove(record)}
                                disabled={pending}
                              >
                                {t('approve')}
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                color="error"
                                startIcon={<CloseIconSmall />}
                                onClick={() => handleReject(record)}
                                disabled={pending}
                              >
                                {t('reject')}
                              </Button>
                            </>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            </>
          )}
      </Box>

      {/* Reuse the existing ApprovalActionDialog for the approve/reject confirmation */}
      <ApprovalActionDialog
        open={!!approvalAction}
        action={approvalAction?.action ?? 'approve'}
        entityLabel={t(`entity.${entityType}`)}
        pending={pending}
        error={actionError}
        onClearError={() => setActionError('')}
        onClose={() => { setApprovalAction(null); setActionError(''); }}
        onConfirm={handleConfirmApproval}
      />
    </>
  );
}

// ─── Single-type dialog wrapper (existing usage, e.g. DashboardPage.tsx) ────

interface PendingItemsDialogProps {
  open: boolean;
  entityType: PendingEntityType;
  user: UserResponse | null;
  onClose: () => void;
}

export default function PendingItemsDialog({ open, entityType, user, onClose }: PendingItemsDialogProps) {
  const { t } = useTranslation('pending');
  return (
    <ResponsiveDialog hideCloseButton open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}>
        <Typography variant="h6" component="span" fontWeight={600}>{t(`title.${entityType}`)}</Typography>
        <IconButton onClick={onClose} size="small" aria-label={t('close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <PendingItemsContent entityType={entityType} user={user} open={open} onClose={onClose} />
      </DialogContent>
    </ResponsiveDialog>
  );
}

// ─── Small helper component for label/value rows ────────────────────────────
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', overflowWrap: 'break-word', fontWeight: 500 }}>{value}</Typography>
    </Box>
  );
}
