import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  OpenInNew as OpenIcon,
  PictureAsPdf as PdfIcon,
  Send as SendIcon,
  Visibility as ViewIcon,
  EmojiEvents as LowestIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Permission,
  POPaymentType,
  canFinalizeQuotation,
  canOverrideApprovals,
  findApprovableStep,
  hasPermission,
  isApproverRole,
  isWorkflowOpenToRole,
  type UserResponse,
} from '@hospital-erp/shared';
import api, { budgetOverrunOf, extractErrorMessage, type BudgetOverrun } from '../../config/api';
import { useAuthStore } from '../../stores/authStore';
import ResponsiveDialog from '../ResponsiveDialog';
import ApprovalActionDialog from '../ApprovalActionDialog';
import ApprovalStepsDisplay from '../ApprovalStepsDisplay';
import ApprovalTiming from '../ApprovalTiming';
import ItemsGist from '../ItemsGist';
import CopyText from '../CopyText';
import CommentsButton, { CommentContent, timeAgo, type CommentRow } from '../CommentsButton';
import { useFileViewer } from '../FileViewerDialog';
import { useToast } from '../ToastProvider';
import { enumLabel, formatCurrency, formatDate, formatDateTime } from '../../utils/enumOptions';
import StageStepper, { type Step, type StepKey } from './StageStepper';
import AddQuotationDialog from './AddQuotationDialog';

// ── response shape of GET /combined-records/:type/:id (only what the view uses) ──
interface WfStep {
  id: string;
  stepNumber: number;
  approverRole: string;
  status: string;
  approverUserId?: string | null;
  approverUser?: { id: string; name: string; role: string } | null;
  comments?: string | null;
  decidedAt?: string | null;
}
interface Workflow {
  id: string;
  status: string;
  approvalPolicy?: string | null;
  currentStep: number;
  steps: WfStep[];
}
interface Item {
  id?: string;
  materialName: string;
  quantity: number | string;
  unit: string | null;
  unitPrice?: number | string;
  estimatedRate?: number | string;
  amount?: number | string;
  gstRate?: number | string;
}
interface Mpr {
  id: string;
  mprNumber: string;
  status: string;
  requestType: string;
  date: string;
  requiredBy: string | null;
  priority: string | null;
  description: string | null;
  estimatedTotal: number | string;
  estimatedGstRate: number | string;
  createdAt: string;
  vendorId: string | null;
  vendor: { id: string; name: string; vendorType: string; vendorCode: string } | null;
  createdByUser: { name: string } | null;
  requestRaisedBy: { name: string } | null;
  items: Item[];
  approvalWorkflow: Workflow | null;
}
interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  date: string;
  createdAt: string;
  grandTotal: number | string;
  vendorId: string;
  vendor: { id: string; name: string; vendorCode: string };
  createdByUser: { name: string } | null;
  items: Item[];
  notes: string | null;
  fileName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  purchaseOrderIds: string[];
  approvalWorkflow: { status: string } | null;
}
interface SiteBill {
  id: string;
  mprNumber: string;
  billDate: string | null;
  billShopName: string | null;
  billPaymentMode: string | null;
  estimatedTotal: number | string;
  receiptFileName: string | null;
  requestRaisedBy: { name: string } | null;
}
interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  date: string;
  createdAt: string;
  grandTotal: number | string;
  netPayable: number | string;
  paymentType: string;
  advanceAmount: number | string | null;
  notes: string | null;
  quotationId: string | null;
  budgetHeadId: string | null;
  budgetHead: { id: string; particulars: string } | null;
  vendor: { id: string; name: string; vendorCode: string };
  createdByUser: { name: string } | null;
  items: Item[];
  approvalWorkflow: Workflow | null;
  isSiteBillBatch: boolean;
  reimburseTo: string | null;
  siteBills: SiteBill[];
}
interface Detail {
  root: { type: string; id: string };
  canSeeFinancials: boolean;
  steps: Step[];
  current: string;
  next: string;
  uncoveredMaterials: string[];
  mpr: Mpr | null;
  quotations: Quotation[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: { id: string; poId: string; receiptNumber: string; status: string; createdAt: string }[];
  invoices: { id: string; poId: string; invoiceCode: string; invoiceNumber: string; totalAmount: number | string; paymentStatus: string; date: string }[];
  payments: { id: string; paymentCode: string; requestNumber: string; type: string; amount: number | string; status: string; paymentMode: string | null; createdAt: string }[];
}

const WAITING = ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'];
const FINALIZED = ['APPROVED', 'CONVERTED_TO_PO'];
const LIVE_PO = ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'];

/** The pending step this user may decide on a workflow, or null. */
function approvableStep(wf: Workflow | null, user: UserResponse | null): WfStep | null {
  if (!wf || !user) return null;
  if (wf.status === 'APPROVED' || wf.status === 'REJECTED') return null;
  const override = canOverrideApprovals(user.role, user.extraPermissions);
  if (!isApproverRole(user.role) && !override) return null;
  if (!isWorkflowOpenToRole(wf, user.role, user.extraPermissions)) return null;
  if (!override && wf.steps.some((s) => s.approverUserId === user.id && s.status !== 'PENDING')) return null;
  return findApprovableStep(wf.steps, user) ?? null;
}

type Action =
  | { kind: 'mpr'; id: string; label: string; action: 'approve' | 'reject' }
  | { kind: 'quotation'; id: string; label: string; action: 'approve' | 'reject' }
  | { kind: 'po'; id: string; label: string; action: 'approve' | 'reject' };

/**
 * One purchase, start to finish, on one screen: the request, every quotation for it,
 * the PO(s), delivery, invoices and payments. Each stage can be acted on right here
 * (approve, add/finalize quotations, approve the PO, set budget head / payment type);
 * the stage the record is waiting for is highlighted.
 */
export default function CombinedRecordDialog({ type, id, onClose }: { type: string; id: string; onClose: () => void }) {
  const { t } = useTranslation('combined');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuthStore();
  const { openPath, openFile, viewer } = useFileViewer();
  const [action, setAction] = useState<Action | null>(null);
  const [actionError, setActionError] = useState('');
  const [overBudget, setOverBudget] = useState<BudgetOverrun | null>(null);
  const [addQuotationOpen, setAddQuotationOpen] = useState(false);
  const [editQuotation, setEditQuotation] = useState<Quotation | null>(null);
  const sectionRefs = useRef<Partial<Record<StepKey, HTMLDivElement | null>>>({});

  const can = (p: Permission) => !!user && hasPermission(user.role, p, user.extraPermissions);

  const { data, isLoading, error } = useQuery({
    queryKey: ['/combined-records', 'detail', type, id],
    queryFn: async () => (await api.get(`/combined-records/${type}/${id}`)).data as Detail,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/combined-records'] });
    queryClient.invalidateQueries({ queryKey: ['/quotations'] });
    queryClient.invalidateQueries({ queryKey: ['/pos'] });
    queryClient.invalidateQueries({ queryKey: ['mprs'] });
    queryClient.invalidateQueries({ queryKey: ['/dashboard'] });
  };

  const decide = useMutation({
    mutationFn: async ({ a, payload }: { a: Action; payload: { comments?: string; reason?: string } }) => {
      const base = a.kind === 'mpr' ? '/material-purchase-requests' : a.kind === 'quotation' ? '/quotations' : '/purchase-orders';
      if (a.kind === 'quotation' && a.action === 'approve') return (await api.post(`${base}/${a.id}/finalize`, { comments: payload.comments })).data;
      const verb = a.action === 'approve' ? 'approve' : 'reject';
      return (await api.post(`${base}/${a.id}/${verb}`, { ...payload, acknowledged: true })).data;
    },
    onSuccess: (result, { a }) => {
      setAction(null);
      setOverBudget(null);
      setActionError('');
      refresh();
      if (a.kind === 'quotation' && a.action === 'approve') {
        toast.success(result?.purchaseOrder ? t('finalizedWithPo', { po: result.purchaseOrder.poNumber }) : t('finalized'));
      } else if (a.kind === 'mpr' && a.action === 'approve') {
        toast.success(t('requestApproved'));
      } else {
        toast.success(a.action === 'approve' ? t('approvedToast') : t('rejectedToast'));
      }
    },
    onError: (err) => {
      setOverBudget(budgetOverrunOf(err));
      setActionError(extractErrorMessage(err));
    },
  });

  const submitMpr = useMutation({
    mutationFn: async (mprId: string) => api.post(`/material-purchase-requests/${mprId}/submit`),
    onSuccess: () => { refresh(); toast.success(t('submittedToast')); },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const { data: headsData } = useQuery({
    queryKey: ['/budget-heads', 'all'],
    queryFn: async () => (await api.get('/budget-heads', { params: { page: 1, pageSize: 100 } })).data,
    enabled: !!data?.purchaseOrders.length && can(Permission.CREATE_PO),
  });
  const budgetHeads: { id: string; particulars: string }[] = headsData?.data ?? [];

  const setBudgetHead = useMutation({
    mutationFn: async ({ poId, budgetHeadId }: { poId: string; budgetHeadId: string }) =>
      api.post(`/purchase-orders/${poId}/change-budget-head`, { budgetHeadId, reason: 'Set from Combined Records' }),
    onSuccess: () => { refresh(); toast.success(t('budgetHeadSaved')); },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });
  const setPaymentType = useMutation({
    mutationFn: async ({ po, paymentType, advanceAmount }: { po: PurchaseOrder; paymentType: string; advanceAmount?: number }) =>
      api.post(`/purchase-orders/${po.id}/change-payment-type`, {
        paymentType,
        advanceAmount: paymentType === POPaymentType.FULL_PAYMENT ? Number(po.grandTotal) : paymentType === POPaymentType.ADVANCE ? advanceAmount : undefined,
        reason: 'Set from Combined Records',
      }),
    onSuccess: () => { refresh(); toast.success(t('paymentTypeSaved')); },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const lowestWaiting = useMemo(() => {
    const waiting = (data?.quotations ?? []).filter((q) => WAITING.includes(q.status) && Number(q.grandTotal) > 0);
    if (waiting.length < 2) return null;
    return waiting.reduce((min, q) => (Number(q.grandTotal) < Number(min.grandTotal) ? q : min)).id;
  }, [data]);

  const scrollTo = (key: StepKey) => sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const title = data?.mpr?.mprNumber ?? data?.quotations[0]?.quotationNumber ?? data?.purchaseOrders[0]?.poNumber ?? '';
  const stepState = (key: StepKey) => data?.steps.find((s) => s.key === key)?.state ?? 'todo';
  const mpr = data?.mpr ?? null;
  const nonVendor = mpr?.vendor?.vendorType === 'NON_VENDOR';
  const isSiteBills = !!data?.purchaseOrders.some((p) => p.isSiteBillBatch);
  const mprOpenForQuotes = !!mpr && ['APPROVED', 'QUOTATIONS_RECEIVED'].includes(mpr.status) && !nonVendor;

  return (
    <ResponsiveDialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" fontWeight={700}>{isSiteBills ? t('siteBillsRecord') : t('recordTitle')} {title}</Typography>
          {data && <Chip size="small" color={data.next === 'completed' ? 'success' : data.next === 'rejected' || data.next === 'cancelled' ? 'error' : 'warning'} label={t(`next.${data.next}`)} />}
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default', p: { xs: 1, sm: 2 } }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : error || !data ? (
          <Alert severity="error">{extractErrorMessage(error) || t('notFound')}</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card sx={{ p: { xs: 1.5, sm: 2 } }}>
              <StageStepper steps={data.steps} onSelect={scrollTo} />
              <Alert severity={data.next === 'completed' ? 'success' : data.next === 'rejected' || data.next === 'cancelled' ? 'error' : 'info'} sx={{ mt: 2 }}>
                {t(`nextHelp.${data.next}`)}
              </Alert>
            </Card>

            {/* ── 1. Request ── */}
            <Section
              innerRef={(el) => { sectionRefs.current.REQUEST = el; }}
              n={1}
              title={t('step.REQUEST')}
              state={stepState('REQUEST')}
              right={mpr ? <><CopyText text={mpr.mprNumber} /><Chip size="small" label={enumLabel(mpr.status)} /></> : null}
            >
              {!mpr ? (
                <Typography color="text.secondary">{isSiteBills ? t('siteBillsNoRequest') : t('noRequest')}</Typography>
              ) : (
                <>
                  <InfoGrid
                    rows={[
                      [t('vendor'), mpr.vendor ? `${mpr.vendor.name}${nonVendor ? ` (${t('oneTimeVendor')})` : ''}` : '—'],
                      [t('requestType'), mpr.requestType === 'SERVICE' ? t('typeService') : t('typeMaterial')],
                      [t('requestedBy'), mpr.requestRaisedBy?.name ?? mpr.createdByUser?.name ?? '—'],
                      [t('date'), formatDate(mpr.date)],
                      [t('requiredBy'), formatDate(mpr.requiredBy)],
                      [t('priority'), mpr.priority ? t(`priorityOpt.${mpr.priority}`, mpr.priority) : '—'],
                      [t('estimate'), formatCurrency(mpr.estimatedTotal)],
                    ]}
                  />
                  <ItemsGist items={mpr.items} max={50} />
                  {mpr.description && <Typography variant="body2" sx={{ mt: 1 }}>{mpr.description}</Typography>}
                  {mpr.approvalWorkflow && (
                    <Box sx={{ mt: 1 }}>
                      <ApprovalTiming startedAt={mpr.createdAt} workflow={mpr.approvalWorkflow} />
                      <ApprovalStepsDisplay steps={mpr.approvalWorkflow.steps} />
                    </Box>
                  )}
                  <Actions>
                    {mpr.status === 'DRAFT' && can(Permission.CREATE_MPR) && (
                      <Button variant="contained" size="small" startIcon={<SendIcon />} disabled={submitMpr.isPending} onClick={() => submitMpr.mutate(mpr.id)}>{t('submitForApproval')}</Button>
                    )}
                    {mpr.status === 'SUBMITTED' && approvableStep(mpr.approvalWorkflow, user) && (
                      <>
                        <Button variant="contained" color="success" size="small" startIcon={<CheckIcon />} onClick={() => setAction({ kind: 'mpr', id: mpr.id, label: mpr.mprNumber, action: 'approve' })}>{t('approve')}</Button>
                        <Button color="error" size="small" startIcon={<CloseIcon />} onClick={() => setAction({ kind: 'mpr', id: mpr.id, label: mpr.mprNumber, action: 'reject' })}>{t('reject')}</Button>
                      </>
                    )}
                    <Button size="small" startIcon={<PdfIcon />} onClick={() => openPath(`/material-purchase-requests/${mpr.id}/pdf`, `${mpr.mprNumber}.pdf`)}>{t('pdf')}</Button>
                    <Button size="small" startIcon={<OpenIcon />} onClick={() => navigate(`/material-purchase-requests?id=${mpr.id}`)}>{t('openInMpr')}</Button>
                  </Actions>
                </>
              )}
            </Section>

            {data.canSeeFinancials && (
              <>
                {/* ── 2. Quotations ── */}
                <Section
                  innerRef={(el) => { sectionRefs.current.QUOTATION = el; }}
                  n={2}
                  title={t('step.QUOTATION')}
                  state={stepState('QUOTATION')}
                  right={data.quotations.length > 0 ? <Chip size="small" label={t('quotationCount', { count: data.quotations.length })} /> : null}
                >
                  {nonVendor || isSiteBills ? (
                    <Typography color="text.secondary">{isSiteBills ? t('siteBillsNoQuotation') : t('nonVendorNoQuotation')}</Typography>
                  ) : (
                    <>
                      {mpr && !['APPROVED', 'QUOTATIONS_RECEIVED', 'CLOSED'].includes(mpr.status) && data.quotations.length === 0 && (
                        <Typography color="text.secondary">{t('quotationsAfterApproval')}</Typography>
                      )}
                      {data.quotations.some((q) => WAITING.includes(q.status)) && <Alert severity="info" sx={{ mb: 1 }}>{t('compareHint')}</Alert>}
                      {data.uncoveredMaterials.length > 0 && data.quotations.some((q) => FINALIZED.includes(q.status)) && (
                        <Alert severity="warning" sx={{ mb: 1 }}>{t('stillToFinalize', { list: data.uncoveredMaterials.join(', ') })}</Alert>
                      )}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 1.5 }}>
                        {data.quotations.map((q) => {
                          const waiting = WAITING.includes(q.status) && q.approvalWorkflow?.status !== 'APPROVED' && q.approvalWorkflow?.status !== 'REJECTED';
                          const finalized = FINALIZED.includes(q.status);
                          return (
                            <Card
                              key={q.id}
                              variant="outlined"
                              sx={{ p: 1.5, borderWidth: finalized ? 2 : 1, borderColor: finalized ? 'success.main' : q.id === lowestWaiting ? 'info.main' : 'divider', opacity: q.status === 'REJECTED' ? 0.6 : 1 }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                <CopyText text={q.quotationNumber} />
                                <Chip size="small" color={finalized ? 'success' : waiting ? 'warning' : 'default'} label={finalized ? t('qFinalized') : waiting ? t('qWaiting') : q.status === 'REJECTED' ? t('qNotSelected') : enumLabel(q.status)} />
                                {q.id === lowestWaiting && <Chip size="small" color="info" icon={<LowestIcon />} label={t('lowest')} />}
                              </Box>
                              <Typography fontWeight={600} sx={{ mt: 0.5 }}>{q.vendor.name}</Typography>
                              <Typography variant="h6" fontWeight={700}>{formatCurrency(q.grandTotal)}</Typography>
                              <ItemsGist items={q.items} max={20} />
                              {q.notes && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{q.notes}</Typography>}
                              {finalized && (
                                <Typography variant="caption" color="success.main" display="block" sx={{ mt: 0.5 }}>
                                  {q.finalizedByName ? t('finalizedBy', { name: q.finalizedByName, when: formatDateTime(q.finalizedAt) }) : t('qFinalized')}
                                </Typography>
                              )}
                              <Actions>
                                {waiting && user && canFinalizeQuotation(user.role, user.extraPermissions) && (
                                  <>
                                    <Button variant="contained" color="success" size="small" startIcon={<CheckIcon />} onClick={() => setAction({ kind: 'quotation', id: q.id, label: q.quotationNumber, action: 'approve' })}>{t('finalize')}</Button>
                                    <Button color="error" size="small" onClick={() => setAction({ kind: 'quotation', id: q.id, label: q.quotationNumber, action: 'reject' })}>{t('notSelected')}</Button>
                                  </>
                                )}
                                {waiting && can(Permission.CREATE_QUOTATION) && (
                                  <Button size="small" startIcon={<EditIcon />} onClick={() => setEditQuotation(q)}>{t('editRates')}</Button>
                                )}
                                {q.fileName && <Button size="small" startIcon={<ViewIcon />} onClick={() => openFile('quotations', q.id, q.fileName!)}>{t('viewFile')}</Button>}
                                <Button size="small" startIcon={<PdfIcon />} onClick={() => openPath(`/quotations/${q.id}/pdf`, `${q.quotationNumber}.pdf`)}>{t('pdf')}</Button>
                              </Actions>
                            </Card>
                          );
                        })}
                      </Box>
                      {mprOpenForQuotes && can(Permission.CREATE_QUOTATION) && (
                        <Button startIcon={<AddIcon />} variant="outlined" size="small" sx={{ mt: 1.5 }} onClick={() => setAddQuotationOpen(true)}>{t('addQuotation')}</Button>
                      )}
                    </>
                  )}
                </Section>

                {/* ── 3. Purchase order ── */}
                <Section innerRef={(el) => { sectionRefs.current.PO = el; }} n={3} title={t('step.PO')} state={stepState('PO')}>
                  {data.purchaseOrders.length === 0 ? (
                    <Typography color="text.secondary">{nonVendor ? t('poAfterApproval') : t('poAfterFinalize')}</Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      {data.purchaseOrders.map((po) => (
                        <PoCard
                          key={po.id}
                          po={po}
                          user={user}
                          canEdit={can(Permission.CREATE_PO) && LIVE_PO.includes(po.status)}
                          budgetHeads={budgetHeads}
                          busy={setBudgetHead.isPending || setPaymentType.isPending}
                          onBudgetHead={(budgetHeadId) => setBudgetHead.mutate({ poId: po.id, budgetHeadId })}
                          onPaymentType={(paymentType, advanceAmount) => setPaymentType.mutate({ po, paymentType, advanceAmount })}
                          onDecide={(a) => setAction({ kind: 'po', id: po.id, label: po.poNumber, action: a })}
                          onPdf={() => openPath(`/purchase-orders/${po.id}/pdf`, `${po.poNumber}.pdf`)}
                          onOpen={() => navigate(`/pos?id=${po.id}`)}
                          onViewBill={(b) => openPath(`/material-purchase-requests/${b.id}/receipt`, b.receiptFileName ?? 'bill')}
                        />
                      ))}
                    </Box>
                  )}
                </Section>

                {/* ── 4. Delivery ── */}
                <Section innerRef={(el) => { sectionRefs.current.DELIVERY = el; }} n={4} title={t('step.DELIVERY')} state={stepState('DELIVERY')}>
                  {isSiteBills ? (
                    <Typography color="text.secondary">{t('siteBillsNoDelivery')}</Typography>
                  ) : (
                    <LinkList
                      empty={t('noDelivery')}
                      rows={data.goodsReceipts.map((g) => ({ id: g.id, main: g.receiptNumber, sub: formatDate(g.createdAt), status: enumLabel(g.status), path: `/goods-receipts?id=${g.id}` }))}
                      action={stepState('DELIVERY') === 'current' ? { label: t('goToGoodsReceipts'), path: '/goods-receipts' } : undefined}
                    />
                  )}
                </Section>

                {/* ── 5. Invoice ── */}
                <Section innerRef={(el) => { sectionRefs.current.INVOICE = el; }} n={5} title={t('step.INVOICE')} state={stepState('INVOICE')}>
                  {isSiteBills ? (
                    <Typography color="text.secondary">{t('siteBillsNoInvoice')}</Typography>
                  ) : (
                    <LinkList
                      empty={t('noInvoice')}
                      rows={data.invoices.map((i) => ({ id: i.id, main: `${i.invoiceCode} · ${i.invoiceNumber}`, sub: formatCurrency(i.totalAmount), status: enumLabel(i.paymentStatus), path: `/invoices?id=${i.id}` }))}
                      action={stepState('INVOICE') === 'current' ? { label: t('goToInvoices'), path: '/invoices' } : undefined}
                    />
                  )}
                </Section>

                {/* ── 6. Payment ── */}
                <Section innerRef={(el) => { sectionRefs.current.PAYMENT = el; }} n={6} title={t('step.PAYMENT')} state={stepState('PAYMENT')}>
                  <PaymentSummary data={data} />
                  <LinkList
                    empty={t('noPayment')}
                    rows={data.payments.map((p) => ({ id: p.id, main: `${p.requestNumber} · ${enumLabel(p.type)}`, sub: `${formatCurrency(p.amount)}${p.paymentMode ? ` · ${enumLabel(p.paymentMode)}` : ''}`, status: enumLabel(p.status), path: `/payments?id=${p.id}` }))}
                    action={stepState('PAYMENT') === 'current' ? { label: t('goToPayments'), path: '/payments' } : undefined}
                  />
                </Section>
              </>
            )}
            {!data.canSeeFinancials && <Alert severity="info">{t('noFinancialAccess')}</Alert>}
          </Box>
        )}
      </DialogContent>

      <ApprovalActionDialog
        open={!!action}
        action={action?.action ?? 'approve'}
        entityLabel={action?.label ?? ''}
        approveLabel={action?.kind === 'quotation' ? t('finalize') : undefined}
        rejectLabel={action?.kind === 'quotation' ? t('notSelected') : undefined}
        pending={decide.isPending}
        error={actionError}
        onClearError={() => setActionError('')}
        overBudget={action?.kind === 'po' ? overBudget : null}
        onClose={() => { setAction(null); setOverBudget(null); setActionError(''); }}
        onConfirm={(payload) => action && decide.mutate({ a: action, payload })}
      />
      {mpr && (
        <AddQuotationDialog
          open={addQuotationOpen || !!editQuotation}
          mprId={mpr.id}
          mprNumber={mpr.mprNumber}
          lines={mpr.items.map((i) => ({ materialName: i.materialName, quantity: i.quantity, unit: i.unit, estimatedRate: i.estimatedRate ?? 0 }))}
          preferMaterials={data?.uncoveredMaterials}
          gstRate={Number(mpr.estimatedGstRate) || 0}
          editing={editQuotation ? { id: editQuotation.id, quotationNumber: editQuotation.quotationNumber, vendorId: editQuotation.vendorId, items: editQuotation.items.map((i) => ({ materialName: i.materialName, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice ?? 0, gstRate: i.gstRate ?? 0 })) } : null}
          onClose={() => { setAddQuotationOpen(false); setEditQuotation(null); }}
          onSaved={() => {
            toast.success(editQuotation ? t('ratesSaved') : t('quotationAdded'));
            setAddQuotationOpen(false);
            setEditQuotation(null);
            refresh();
          }}
        />
      )}
      {viewer}
    </ResponsiveDialog>
  );
}

const STATE_COLOR: Record<string, string> = {
  done: 'success.main',
  current: 'warning.main',
  rejected: 'error.main',
  todo: 'divider',
  skipped: 'divider',
};

function Section({ n, title, state, right, children, innerRef }: { n: number; title: string; state: string; right?: ReactNode; children: ReactNode; innerRef: (el: HTMLDivElement | null) => void }) {
  const { t } = useTranslation('combined');
  return (
    <Card ref={innerRef} sx={{ p: { xs: 1.5, sm: 2 }, borderLeft: 4, borderLeftColor: STATE_COLOR[state] ?? 'divider', scrollMarginTop: 16 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700}>{n}. {title}</Typography>
        <Chip size="small" variant={state === 'current' ? 'filled' : 'outlined'} color={state === 'done' ? 'success' : state === 'current' ? 'warning' : state === 'rejected' ? 'error' : 'default'} label={t(`state.${state}`)} />
        <Box sx={{ flex: 1 }} />
        {right}
      </Box>
      {children}
    </Card>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>{children}</Box>;
}

function InfoGrid({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1, mb: 1 }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="body2" fontWeight={600} noWrap>{value}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function LinkList({ rows, empty, action }: { rows: { id: string; main: string; sub: string; status: string; path: string }[]; empty: string; action?: { label: string; path: string } }) {
  const navigate = useNavigate();
  return (
    <Box>
      {rows.length === 0 ? (
        <Typography color="text.secondary">{empty}</Typography>
      ) : (
        rows.map((r) => (
          <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600}>{r.main}</Typography>
            <Typography variant="body2" color="text.secondary">{r.sub}</Typography>
            <Chip size="small" label={r.status} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" endIcon={<OpenIcon fontSize="small" />} onClick={() => navigate(r.path)}>{r.main.split(' ')[0]}</Button>
          </Box>
        ))
      )}
      {action && <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => navigate(action.path)} endIcon={<OpenIcon fontSize="small" />}>{action.label}</Button>}
    </Box>
  );
}

function PaymentSummary({ data }: { data: Detail }) {
  const { t } = useTranslation('combined');
  const live = data.purchaseOrders.filter((p) => LIVE_PO.includes(p.status));
  if (live.length === 0) return null;
  const payable = live.reduce((s, p) => s + Number(p.netPayable || p.grandTotal), 0);
  const paid = data.payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + Number(p.amount), 0);
  return (
    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
      <Typography variant="body2">{t('payable')}: <b>{formatCurrency(payable)}</b></Typography>
      <Typography variant="body2" color="success.main">{t('paid')}: <b>{formatCurrency(paid)}</b></Typography>
      <Typography variant="body2" color={payable - paid > 0.5 ? 'error.main' : 'text.secondary'}>{t('balance')}: <b>{formatCurrency(Math.max(0, payable - paid))}</b></Typography>
    </Box>
  );
}

function PoCard({
  po,
  user,
  canEdit,
  budgetHeads,
  busy,
  onBudgetHead,
  onPaymentType,
  onDecide,
  onPdf,
  onOpen,
  onViewBill,
}: {
  po: PurchaseOrder;
  user: UserResponse | null;
  canEdit: boolean;
  budgetHeads: { id: string; particulars: string }[];
  busy: boolean;
  onBudgetHead: (id: string) => void;
  onPaymentType: (type: string, advanceAmount?: number) => void;
  onDecide: (a: 'approve' | 'reject') => void;
  onPdf: () => void;
  onOpen: () => void;
  onViewBill: (b: SiteBill) => void;
}) {
  const { t } = useTranslation('combined');
  const [advance, setAdvance] = useState('');
  const [pendingType, setPendingType] = useState<string | null>(null);
  const amountMissing = Number(po.grandTotal) <= 0;
  const step = po.status === 'PENDING_APPROVAL' ? approvableStep(po.approvalWorkflow, user) : null;
  const dead = !LIVE_PO.includes(po.status);
  // Same query as the comment thread dialog, so posting there refreshes this list too.
  const { data: poComments = [] } = useQuery<CommentRow[]>({
    queryKey: ['comments', 'PURCHASE_ORDER', po.id],
    queryFn: async () =>
      (await api.get('/comments', { params: { entityType: 'PURCHASE_ORDER', entityId: po.id } })).data?.data ?? [],
  });

  return (
    <Card variant="outlined" sx={{ p: 1.5, opacity: dead ? 0.65 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <CopyText text={po.poNumber} />
        <Chip size="small" color={po.status === 'PENDING_APPROVAL' ? 'warning' : dead ? 'error' : 'success'} label={enumLabel(po.status)} />
        <Typography fontWeight={600}>{po.vendor.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="h6" fontWeight={700}>{formatCurrency(po.grandTotal)}</Typography>
      </Box>
      {po.isSiteBillBatch && po.reimburseTo && <Typography variant="body2" color="text.secondary">{t('reimburseTo', { name: po.reimburseTo })}</Typography>}
      {amountMissing && !dead && <Alert severity="error" sx={{ mt: 1 }}>{t('amountMissing')}</Alert>}
      <ItemsGist items={po.items} max={30} />
      {po.notes && (
        <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" display="block">{t('poDescription')}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{po.notes}</Typography>
        </Box>
      )}

      <Box sx={{ mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">{t('poComments', { count: poComments.length })}</Typography>
          <Box sx={{ ml: 'auto' }}>
            <CommentsButton labelled entityType="PURCHASE_ORDER" entityId={po.id} entityLabel={po.poNumber} url="/pos" />
          </Box>
        </Box>
        {poComments.map((c) => (
          <Box key={c.id} sx={{ ml: c.parentId ? 2 : 0, mt: 0.75, pl: c.parentId ? 1.5 : 0, borderLeft: c.parentId ? 2 : 0, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{c.author.name}</Typography>
              <Typography variant="caption" color="text.secondary">{timeAgo(c.createdAt)}</Typography>
            </Box>
            <CommentContent comment={c} />
          </Box>
        ))}
      </Box>

      {po.siteBills.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">{t('billsInPo', { count: po.siteBills.length })}</Typography>
          {po.siteBills.map((b) => (
            <Box key={b.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2">{b.mprNumber} · {b.billShopName} · {formatDate(b.billDate)} · {b.billPaymentMode ? enumLabel(b.billPaymentMode) : ''}</Typography>
              <Typography variant="body2" fontWeight={600}>{formatCurrency(b.estimatedTotal)}</Typography>
              {b.receiptFileName && <Button size="small" onClick={() => onViewBill(b)}>{t('viewBill')}</Button>}
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ my: 1.25 }} />
      {/* Budget head and payment type: set or change any time, no re-approval. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <TextField
          select
          size="small"
          label={t('budgetHead')}
          value={po.budgetHeadId ?? ''}
          disabled={!canEdit || busy}
          onChange={(e) => e.target.value && e.target.value !== po.budgetHeadId && onBudgetHead(e.target.value)}
          helperText={po.budgetHeadId ? t('budgetHeadChangeHelp') : t('budgetHeadMissingHelp')}
        >
          {!po.budgetHeadId && <MenuItem value="" disabled>{t('noBudgetHeadYet')}</MenuItem>}
          {po.budgetHead && !budgetHeads.some((h) => h.id === po.budgetHead!.id) && <MenuItem value={po.budgetHead.id}>{po.budgetHead.particulars}</MenuItem>}
          {budgetHeads.map((h) => <MenuItem key={h.id} value={h.id}>{h.particulars}</MenuItem>)}
        </TextField>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            select
            size="small"
            fullWidth
            label={t('paymentType')}
            value={pendingType ?? po.paymentType}
            disabled={!canEdit || busy || amountMissing}
            onChange={(e) => {
              const next = e.target.value;
              if (next === POPaymentType.ADVANCE) {
                setPendingType(next);
                setAdvance(po.advanceAmount ? String(Number(po.advanceAmount)) : '');
              } else {
                setPendingType(null);
                if (next !== po.paymentType) onPaymentType(next);
              }
            }}
            helperText={po.paymentType !== POPaymentType.AFTER_DELIVERY && po.advanceAmount ? t('advanceIs', { amount: formatCurrency(po.advanceAmount) }) : t('paymentTypeHelp')}
          >
            {Object.values(POPaymentType).map((p) => <MenuItem key={p} value={p}>{enumLabel(p)}</MenuItem>)}
          </TextField>
          {pendingType === POPaymentType.ADVANCE && (
            <>
              <TextField size="small" type="number" label={t('advanceAmount')} value={advance} onChange={(e) => setAdvance(e.target.value)} sx={{ width: 140 }} inputProps={{ min: 0, step: 'any' }} />
              <Button size="small" variant="contained" disabled={!(Number(advance) > 0) || busy} onClick={() => { onPaymentType(POPaymentType.ADVANCE, Number(advance)); setPendingType(null); }}>{t('save')}</Button>
            </>
          )}
        </Box>
      </Box>

      {po.approvalWorkflow && (
        <Box sx={{ mt: 1 }}>
          <ApprovalTiming startedAt={po.createdAt} workflow={po.approvalWorkflow} />
          <ApprovalStepsDisplay steps={po.approvalWorkflow.steps} />
        </Box>
      )}
      <Actions>
        {step && !amountMissing && (
          <>
            <Button variant="contained" color="success" size="small" startIcon={<CheckIcon />} onClick={() => onDecide('approve')}>{t('approvePo')}</Button>
            <Button color="error" size="small" startIcon={<CloseIcon />} onClick={() => onDecide('reject')}>{t('reject')}</Button>
          </>
        )}
        {amountMissing && !dead && <Button variant="contained" color="warning" size="small" startIcon={<EditIcon />} onClick={onOpen}>{t('enterPrices')}</Button>}
        <Button size="small" startIcon={<PdfIcon />} onClick={onPdf} disabled={!['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'].includes(po.status)}>{t('pdf')}</Button>
        <Button size="small" startIcon={<OpenIcon />} onClick={onOpen}>{t('openInPo')}</Button>
      </Actions>
    </Card>
  );
}
