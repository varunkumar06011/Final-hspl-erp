import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Button, Chip, CircularProgress, DialogActions, DialogTitle, DialogContent,
  Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Stack, Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ArrowUpward as AscIcon,
  ArrowDownward as DescIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import ResponsiveDialog from './ResponsiveDialog';
import ResponsiveTable from './ResponsiveTable';
import api from '../config/api';
import { formatDate, formatCurrency, formatIndianNumber, STATUS_COLORS, enumLabel, roleLabel } from '../utils/enumOptions';
import { useTranslation } from 'react-i18next';

const statusLabel = (s: string) => enumLabel(s);

export interface VendorHistoryAudit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
  user: { id: string; name: string; role: string };
}

export interface VendorHistory {
  vendor: {
    id: string; vendorCode: string; name: string; contactPersonName: string | null;
    contactPersonPhone: string | null; phone: string | null; email: string | null;
    gstNumber: string | null; panNumber: string | null; address: string | null;
    category: string; status: string; rating: number; referenceBy: string | null;
    description: string | null; createdAt: string; createdByName: string | null;
    bankName: string | null; bankAccountNumber: string | null; ifscCode: string | null;
  };
  summary: {
    totalBilled: number; totalPaid: number; advancePaid: number; outstanding: number;
    paymentSheetPaid: number; paymentSheetPending: number;
    ledgerId: string | null; ledgerBalance: number | null; weOwe: number; theyOwe: number;
    counts: {
      quotations: number; purchaseOrders: number; invoices: number;
      paymentRequests: number; payments: number; paymentSheets: number;
      goodsReceipts: number; assets: number;
    };
  };
  timeline: {
    date: string; type: string; reference: string; description: string;
    debit: number; credit: number; runningBalance: number; status?: string; path?: string;
    actor?: string | null; budgetHead?: string | null; amount?: number;
  }[];
  materials: { id: string; name: string; unit: string | null }[];
  quotations: {
    id: string; quotationNumber: string; date: string; status: string; grandTotal: number;
    items: { materialName: string; quantity: string; unit: string | null; unitPrice: string; amount: string; gstRate: string }[];
    createdByUser?: { id: string; name: string } | null;
  }[];
  purchaseOrders: {
    id: string; poNumber: string; date: string; status: string; paymentType: string;
    advanceAmount: number | null; grandTotal: number; totalDeductions: number; netPayable: number;
    items: { materialName: string; quantity: string; unit: string | null; unitPrice: string; amount: string; gstRate: string }[];
    budgetHead: { id: string; particulars: string } | null;
    quotation: { id: string; quotationNumber: string } | null;
    createdByUser?: { id: string; name: string } | null;
  }[];
  invoices: {
    id: string; invoiceCode: string; invoiceNumber: string; date: string;
    amount: string; taxAmount: string; totalAmount: string; advancePaid: string;
    paymentStatus: string; stockStatus: string; verificationStatus: string;
    purchaseOrder: { id: string; poNumber: string } | null;
    createdByUser?: { id: string; name: string } | null;
  }[];
  paymentRequests: {
    id: string; requestNumber: string; paymentCode: string; type: string; amount: string;
    status: string; paymentMode: string | null; description: string | null; createdAt: string;
    invoice: { id: string; invoiceCode: string; invoiceNumber: string } | null;
    purchaseOrder: { id: string; poNumber: string } | null;
    budgetHead?: { id: string; particulars: string } | null;
    createdByUser?: { id: string; name: string } | null;
    payments: { id: string; amount: string; date: string; mode: string; reference: string | null; status: string }[];
  }[];
  paymentSheets: {
    id: string; date: string; amount: number; status: string; paymentMode: string;
    reference: string | null; notes: string | null;
    purchaseOrder: { id: string; poNumber: string };
    createdByUser: { id: string; name: string };
  }[];
  goodsReceipts: {
    id: string; receiptNumber: string; status: string; createdAt: string;
    purchaseOrder: { id: string; poNumber: string };
    items: { materialName: string; deliveredQty: string; acceptedQty: string; rejectedQty: string; unit: string | null }[];
  }[];
  assets: {
    id: string; assetId: string; status: string; location: string; totalCost: string | null;
    inventoryItem: { id: string; name: string };
  }[];
  audit: VendorHistoryAudit[] | null;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** Renders a compact "old → new" summary for an audit entry's changed fields. */
function auditDiff(oldV: unknown, newV: unknown): string {
  const parts: string[] = [];
  if (newV && typeof newV === 'object' && !Array.isArray(newV)) {
    const n = newV as Record<string, unknown>;
    const o = (oldV && typeof oldV === 'object' && !Array.isArray(oldV) ? oldV : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'acknowledged' || k === 'reason') continue;
      const ov = o[k];
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      if (ov !== undefined && ov !== null && String(ov) !== String(v)) parts.push(`${label}: ${String(ov)} → ${String(v)}`);
      else if (ov === undefined || ov === null) parts.push(`${label}: ${String(v)}`);
    }
  }
  return parts.slice(0, 3).join('  ·  ') || '';
}

interface Props {
  vendorId: string | null;
  open: boolean;
  onClose: () => void;
  /** Optional month scope (1-based month + year) — shows a "This month" filter chip and a month banner. */
  focusMonth?: number;
  focusYear?: number;
}

export default function VendorHistoryDialog({ vendorId, open, onClose, focusMonth, focusYear }: Props) {
  const { t, i18n } = useTranslation('vhistory');
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [timelineDesc, setTimelineDesc] = useState(true); // newest → oldest default
  const [monthOnly, setMonthOnly] = useState(true);
  const { data, isLoading } = useQuery<VendorHistory>({
    queryKey: ['/vendors', vendorId, 'history'],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/history`)).data,
    enabled: !!vendorId && open,
  });

  const go = (path?: string) => {
    if (!path) return;
    navigate(path);
    onClose();
  };

  const clickableRow = (path?: string) => ({
    hover: !!path,
    onClick: () => go(path),
    sx: { cursor: path ? 'pointer' : 'default' },
  });

  const money = (v: string | number | null | undefined) => formatCurrency(Number(v ?? 0));
  const s = data?.summary;

  const hasFocus = focusMonth !== undefined && focusYear !== undefined;
  const inFocus = (d: string | Date) => {
    if (!hasFocus || !monthOnly) return true;
    const dt = new Date(d);
    const istMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(dt));
    const istYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(dt));
    return istMonth === focusMonth && istYear === focusYear;
  };
  const MONTH_LABEL = hasFocus ? new Date(focusYear!, focusMonth! - 1, 1).toLocaleString(i18n.language?.startsWith('te') ? 'te-IN' : 'en-US', { month: 'long', year: 'numeric' }) : '';

  const timeline = useMemo(() => {
    if (!data) return [];
    const rows = data.timeline.filter((r) => inFocus(r.date));
    return timelineDesc ? [...rows].reverse() : rows;
  }, [data, timelineDesc, monthOnly, focusMonth, focusYear]);

  const filteredPOs = useMemo(() => (data?.purchaseOrders ?? []).filter((p) => inFocus(p.date)), [data, monthOnly, focusMonth, focusYear]);
  const filteredQuotations = useMemo(() => (data?.quotations ?? []).filter((q) => inFocus(q.date)), [data, monthOnly, focusMonth, focusYear]);
  const filteredInvoices = useMemo(() => (data?.invoices ?? []).filter((i) => inFocus(i.date)), [data, monthOnly, focusMonth, focusYear]);
  const filteredRequests = useMemo(() => (data?.paymentRequests ?? []).filter((p) => inFocus(p.createdAt)), [data, monthOnly, focusMonth, focusYear]);
  const filteredSheets = useMemo(() => (data?.paymentSheets ?? []).filter((p) => inFocus(p.date)), [data, monthOnly, focusMonth, focusYear]);
  const filteredReceipts = useMemo(() => (data?.goodsReceipts ?? []).filter((g) => inFocus(g.createdAt)), [data, monthOnly, focusMonth, focusYear]);

  const auditRows = data?.audit ?? null;
  const tabCount = auditRows ? 7 : 6;
  const scope = monthOnly && hasFocus ? t('inMonth', { m: MONTH_LABEL }) : '';

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {isLoading || !data
          ? t('title360')
          : t('title360Full', { name: data.vendor.name, code: data.vendor.vendorCode })}
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : !data ? (
          <Typography color="text.secondary">{t('noData')}</Typography>
        ) : (
          <>
            {/* Vendor profile strip */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {data.vendor.category ? enumLabel(data.vendor.category) : '—'} • {t('statusColon')}{' '}
                <Chip size="small" label={statusLabel(data.vendor.status)} color={(STATUS_COLORS[data.vendor.status] ?? 'default') as never} />
                {' '}{t('since', { d: formatDate(data.vendor.createdAt) })}
                {data.vendor.createdByName ? t('addedBy', { n: data.vendor.createdByName }) : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[
                  data.vendor.phone && t('phone', { v: data.vendor.phone }),
                  data.vendor.contactPersonName && t('contact', { v: `${data.vendor.contactPersonName}${data.vendor.contactPersonPhone ? ` (${data.vendor.contactPersonPhone})` : ''}` }),
                  data.vendor.email && t('email', { v: data.vendor.email }),
                  data.vendor.gstNumber && t('gst', { v: data.vendor.gstNumber }),
                  data.vendor.panNumber && t('pan', { v: data.vendor.panNumber }),
                  data.vendor.referenceBy && t('referredBy', { v: data.vendor.referenceBy }),
                ].filter(Boolean).join('  ·  ')}
              </Typography>
              {data.vendor.address && (
                <Typography variant="body2" color="text.secondary">{t('address', { v: data.vendor.address })}</Typography>
              )}
              {(data.vendor.bankName || data.vendor.bankAccountNumber) && (
                <Typography variant="body2" color="text.secondary">
                  {t('bank', { v: [data.vendor.bankName, data.vendor.bankAccountNumber && t('account', { v: data.vendor.bankAccountNumber }), data.vendor.ifscCode && t('ifsc', { v: data.vendor.ifscCode })].filter(Boolean).join(' · ') })}
                </Typography>
              )}
            </Box>

            {/* Financial summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={t('totalBilled', { v: money(s?.totalBilled) })} color="error" variant="outlined" />
              <Chip label={t('totalPaid', { v: money(s?.totalPaid) })} color="success" variant="outlined" />
              <Chip label={t('outstanding', { v: money(s?.outstanding) })} color="primary" />
              {(s?.advancePaid ?? 0) > 0 && (
                <Chip label={t('advances', { v: money(s?.advancePaid) })} color="info" variant="outlined" />
              )}
              {(s?.paymentSheetPaid ?? 0) > 0 && (
                <Chip label={t('sheetPaid', { v: money(s?.paymentSheetPaid) })} variant="outlined" />
              )}
              {(s?.paymentSheetPending ?? 0) > 0 && (
                <Chip label={t('sheetPayable', { v: money(s?.paymentSheetPending) })} color="warning" variant="outlined" />
              )}
              {s?.ledgerId && (
                <Chip
                  label={t('ledgerLine', { v: s.weOwe > 0 ? t('weOwe', { v: money(s.weOwe) }) : s.theyOwe > 0 ? t('theyOwe', { v: money(s.theyOwe) }) : t('settled') })}
                  variant="outlined"
                  onClick={() => go(`/ledgers?id=${s.ledgerId}`)}
                  sx={{ cursor: 'pointer' }}
                />
              )}
            </Stack>

            {/* Month-scope filter (register context) */}
            {hasFocus && (
              <Chip
                label={monthOnly ? t('monthOnly', { m: MONTH_LABEL }) : t('allHistory', { m: MONTH_LABEL })}
                color={monthOnly ? 'primary' : 'default'}
                variant={monthOnly ? 'filled' : 'outlined'}
                onClick={() => setMonthOnly((v) => !v)}
                sx={{ mb: 2 }}
              />
            )}

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab label={t('tabTimeline', { n: timeline.length })} />
                <Tab label={t('tabPOs', { n: filteredPOs.length })} />
                <Tab label={t('tabPayments', { n: filteredRequests.length + filteredSheets.length })} />
                <Tab label={t('tabInvoices', { n: filteredInvoices.length })} />
                <Tab label={t('tabQuotations', { n: filteredQuotations.length })} />
                <Tab label={t('tabMore', { n: filteredReceipts.length + data.assets.length + data.materials.length })} />
                {auditRows && <Tab label={t('tabAudit', { n: auditRows.length })} />}
              </Tabs>
            </Box>

            {/* ── Timeline: every transaction in chronological order ── */}
            {tab === 0 && (
              <>
                <Stack direction="row" justifyContent="flex-end" sx={{ mb: 0.5 }}>
                  <Tooltip title={timelineDesc ? t('newestTip') : t('oldestTip')}>
                    <Button size="small" startIcon={timelineDesc ? <DescIcon /> : <AscIcon />} onClick={() => setTimelineDesc((v) => !v)}>
                      {timelineDesc ? t('newestFirst') : t('oldestFirst')}
                    </Button>
                  </Tooltip>
                </Stack>
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colDate')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colType')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colReference')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colDescription')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colBy')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colDebit')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colCredit')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colBalance')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {timeline.length === 0 ? (
                      <TableRow><TableCell colSpan={8} align="center" sx={{ py: 3 }}><Typography color="text.secondary">{t('noTxn')}</Typography></TableCell></TableRow>
                    ) : (
                      timeline.map((row, i) => (
                        <TableRow key={i} {...clickableRow(row.path)}>
                          <TableCell data-label={t('colDate')} sx={{ whiteSpace: 'nowrap' }}>{fmtTime(row.date)}</TableCell>
                          <TableCell data-label={t('colType')}>
                            <Stack spacing={0.25} alignItems={{ xs: 'flex-end', md: 'flex-start' }}>
                              <Typography variant="body2" fontWeight={500}>{t(`types.${row.type}`, { defaultValue: row.type })}</Typography>
                              {row.status && <Chip label={statusLabel(row.status)} size="small" sx={{ fontSize: '0.65rem', height: 16 }} color={(STATUS_COLORS[row.status] ?? 'default') as never} />}
                            </Stack>
                          </TableCell>
                          <TableCell data-label={t('colReference')}>{row.reference}</TableCell>
                          <TableCell data-label={t('colDescription')} sx={{ whiteSpace: 'normal', minWidth: { md: 160 } }}>
                            {row.description || '—'}
                            {row.budgetHead && <Typography variant="caption" color="text.secondary" display="block">{t('budget', { v: row.budgetHead })}</Typography>}
                          </TableCell>
                          <TableCell data-label={t('colBy')}>{row.actor ?? '—'}</TableCell>
                          <TableCell data-label={t('colDebit')} align="right" sx={{ color: row.debit > 0 ? 'error.main' : 'text.disabled' }}>{row.debit > 0 ? formatIndianNumber(row.debit) : '—'}</TableCell>
                          <TableCell data-label={t('colCredit')} align="right" sx={{ color: row.credit > 0 ? 'success.main' : 'text.disabled' }}>{row.credit > 0 ? formatIndianNumber(row.credit) : '—'}</TableCell>
                          <TableCell data-label={t('colBalance')} align="right" sx={{ fontWeight: 600 }}>{formatIndianNumber(row.runningBalance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
              </>
            )}

            {/* ── Purchase Orders with item-level detail ── */}
            {tab === 1 && (
              filteredPOs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('noPOs', { scope })}</Typography>
              ) : (
                filteredPOs.map((po) => (
                  <Accordion key={po.id} disableGutters sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%', rowGap: 0.5 }}>
                        <Typography fontWeight={600}>{po.poNumber}</Typography>
                        <Chip label={statusLabel(po.status)} size="small" color={(STATUS_COLORS[po.status] ?? 'default') as never} />
                        <Typography variant="body2" color="text.secondary">{formatDate(po.date)}</Typography>
                        {po.budgetHead && <Typography variant="body2" color="text.secondary">• {po.budgetHead.particulars}</Typography>}
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="body2" fontWeight={600}>{money(po.grandTotal)}</Typography>
                        <Button size="small" onClick={(e) => { e.stopPropagation(); go(`/pos?id=${po.id}`); }} onFocus={(e) => e.stopPropagation()}>{t('open')}</Button>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {/* Cross-module chain: Quotation → PO → Invoice → Payment */}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {po.quotation ? (
                          <>
                            {t('fromQuotation')}{' '}
                            <Button size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none' }} onClick={() => go(`/quotations?id=${po.quotation!.id}`)}>
                              {po.quotation.quotationNumber}
                            </Button>
                            {' → '}
                          </>
                        ) : null}
                        {po.paymentType ? enumLabel(po.paymentType) : ''}{po.advanceAmount ? t('advanceLine', { v: Number(po.advanceAmount).toLocaleString('en-IN') }) : ''}
                        {po.totalDeductions > 0 ? t('deductionsLine', { d: po.totalDeductions.toLocaleString('en-IN'), n: money(po.netPayable) }) : ''}
                        {po.budgetHead ? t('budgetLine', { v: po.budgetHead.particulars }) : ''}
                        {po.createdByUser ? t('byLine', { v: po.createdByUser.name }) : ''}
                      </Typography>
                      {/* linked invoices + payments for this PO */}
                      {(() => {
                        const poInvoices = data.invoices.filter((i) => i.purchaseOrder?.id === po.id);
                        const poPayments = data.paymentRequests.filter((p) => p.purchaseOrder?.id === po.id);
                        if (poInvoices.length === 0 && poPayments.length === 0) return null;
                        return (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                            {poInvoices.map((inv) => (
                              <Button key={inv.id} size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none', mr: 1 }} onClick={() => go(`/invoices?id=${inv.id}`)}>
                                {t('invoiceLink', { v: inv.invoiceCode ?? inv.invoiceNumber })}
                              </Button>
                            ))}
                            {poPayments.map((p) => (
                              <Button key={p.id} size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none', mr: 1 }} onClick={() => go(`/payments?id=${p.id}`)}>
                                {t('paymentLink', { v: p.requestNumber })}
                              </Button>
                            ))}
                          </Typography>
                        );
                      })()}
                      <TableContainer sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>{t('colItem')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colQty')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colRate')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colGst')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colAmount')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {po.items.map((it, i) => (
                            <TableRow key={i}>
                              <TableCell>{it.materialName}</TableCell>
                              <TableCell align="right">{Number(it.quantity)} {it.unit ?? ''}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.unitPrice))}</TableCell>
                              <TableCell align="right">{Number(it.gstRate) > 0 ? `${Number(it.gstRate)}% (₹${formatIndianNumber(Number(it.amount) * Number(it.gstRate) / 100)})` : '—'}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.amount))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      </TableContainer>
                    </AccordionDetails>
                  </Accordion>
                ))
              )
            )}

            {/* ── Payments: requests + payments + payment-sheet entries ── */}
            {tab === 2 && (
              <>
                {filteredRequests.length === 0 && filteredSheets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">{t('noPayments', { scope })}</Typography>
                ) : (
                  <ResponsiveTable>
                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                          <TableCell sx={{ fontWeight: 600 }}>{t('colDate')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('colReference')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('colDetails')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('colMode')}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t('colStatus')}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colAmount')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredRequests.map((pr) => (
                          <TableRow key={pr.id} {...clickableRow(`/payments?id=${pr.id}`)}>
                            <TableCell data-label={t('colDate')}>{formatDate(pr.createdAt)}</TableCell>
                            <TableCell data-label={t('colReference')}>{pr.requestNumber}</TableCell>
                            <TableCell data-label={t('colDetails')}>
                              <Box>
                                {enumLabel(pr.type)}
                                {pr.purchaseOrder ? t('poRef', { v: pr.purchaseOrder.poNumber }) : ''}
                                {pr.invoice ? ` · ${pr.invoice.invoiceCode ?? pr.invoice.invoiceNumber}` : ''}
                                {pr.budgetHead ? ` · ${pr.budgetHead.particulars}` : ''}
                                {pr.payments.length > 0 && (
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    {pr.payments.map((p) => `${formatDate(p.date)} ${enumLabel(p.mode)} ₹${Number(p.amount).toLocaleString('en-IN')}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}
                                  </Typography>
                                )}
                                {pr.createdByUser && (
                                  <Typography variant="caption" color="text.secondary" display="block">{t('byLine', { v: pr.createdByUser.name }).replace(/^ • /, '')}</Typography>
                                )}
                              </Box>
                            </TableCell>
                            <TableCell data-label={t('colMode')}>{pr.paymentMode ? enumLabel(pr.paymentMode) : '—'}</TableCell>
                            <TableCell data-label={t('colStatus')}><Chip label={statusLabel(pr.status)} size="small" color={(STATUS_COLORS[pr.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label={t('colAmount')} align="right">{money(pr.amount)}</TableCell>
                          </TableRow>
                        ))}
                        {filteredSheets.map((ps) => (
                          <TableRow key={ps.id} {...clickableRow(`/pos?id=${ps.purchaseOrder.id}`)}>
                            <TableCell data-label={t('colDate')}>{formatDate(ps.date)}</TableCell>
                            <TableCell data-label={t('colReference')}>{t('sheetRef', { v: ps.purchaseOrder.poNumber })}</TableCell>
                            <TableCell data-label={t('colDetails')}>
                              <Box>
                                {t('sheetEntry')}{ps.notes ? ` — ${ps.notes}` : ''}
                                <Typography variant="caption" color="text.secondary" display="block">{t('byLine', { v: ps.createdByUser.name }).replace(/^ • /, '')}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell data-label={t('colMode')}>{enumLabel(ps.paymentMode)}</TableCell>
                            <TableCell data-label={t('colStatus')}><Chip label={statusLabel(ps.status)} size="small" color={(STATUS_COLORS[ps.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label={t('colAmount')} align="right">{money(ps.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </ResponsiveTable>
                )}
              </>
            )}

            {/* ── Invoices ── */}
            {tab === 3 && (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colInvoiceNo')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colDate')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colPO')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colPayment')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colStock')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colTotal')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredInvoices.length === 0 ? (
                      <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3 }}><Typography color="text.secondary">{t('noInvoices', { scope })}</Typography></TableCell></TableRow>
                    ) : (
                      filteredInvoices.map((inv) => (
                        <TableRow key={inv.id} {...clickableRow(`/invoices?id=${inv.id}`)}>
                          <TableCell data-label={t('colInvoiceNo')}>{inv.invoiceCode ?? inv.invoiceNumber}</TableCell>
                          <TableCell data-label={t('colDate')}>{formatDate(inv.date)}</TableCell>
                          <TableCell data-label={t('colPO')}>
                            {inv.purchaseOrder ? (
                              <Button size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none' }} onClick={(e) => { e.stopPropagation(); go(`/pos?id=${inv.purchaseOrder!.id}`); }}>
                                {inv.purchaseOrder.poNumber}
                              </Button>
                            ) : '—'}
                          </TableCell>
                          <TableCell data-label={t('colPayment')}><Chip label={statusLabel(inv.paymentStatus)} size="small" color={(STATUS_COLORS[inv.paymentStatus] ?? 'default') as never} /></TableCell>
                          <TableCell data-label={t('colStock')}><Chip label={statusLabel(inv.stockStatus)} size="small" color={(STATUS_COLORS[inv.stockStatus] ?? 'default') as never} /></TableCell>
                          <TableCell data-label={t('colTotal')} align="right">{money(inv.totalAmount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}

            {/* ── Quotations with items ── */}
            {tab === 4 && (
              filteredQuotations.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('noQuotations', { scope })}</Typography>
              ) : (
                filteredQuotations.map((q) => (
                  <Accordion key={q.id} disableGutters sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%', rowGap: 0.5 }}>
                        <Typography fontWeight={600}>{q.quotationNumber}</Typography>
                        <Chip label={statusLabel(q.status)} size="small" color={(STATUS_COLORS[q.status] ?? 'default') as never} />
                        <Typography variant="body2" color="text.secondary">{formatDate(q.date)}</Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="body2" fontWeight={600}>{money(q.grandTotal)}</Typography>
                        <Button size="small" onClick={(e) => { e.stopPropagation(); go(`/quotations?id=${q.id}`); }} onFocus={(e) => e.stopPropagation()}>{t('open')}</Button>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {/* Downstream chain: this quotation's POs */}
                      {(() => {
                        const qPos = data.purchaseOrders.filter((p) => p.quotation?.id === q.id);
                        if (qPos.length === 0) return null;
                        return (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                            {qPos.map((p) => (
                              <Button key={p.id} size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none', mr: 1 }} onClick={() => go(`/pos?id=${p.id}`)}>
                                {t('toPo', { v: p.poNumber })}
                              </Button>
                            ))}
                          </Typography>
                        );
                      })()}
                      <TableContainer sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>{t('colItem')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colQty')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colRate')}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{t('colAmount')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {q.items.map((it, i) => (
                            <TableRow key={i}>
                              <TableCell>{it.materialName}</TableCell>
                              <TableCell align="right">{Number(it.quantity)} {it.unit ?? ''}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.unitPrice))}</TableCell>
                              <TableCell align="right">{formatIndianNumber(Number(it.amount))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      </TableContainer>
                    </AccordionDetails>
                  </Accordion>
                ))
              )
            )}

            {/* ── More: declared materials, goods receipts, assets ── */}
            {tab === 5 && (
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('materialsSupplied')}</Typography>
                  {data.materials.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('noneDeclared')}</Typography>
                  ) : (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {data.materials.map((m) => <Chip key={m.id} size="small" variant="outlined" label={`${m.name}${m.unit ? ` (${m.unit})` : ''}`} />)}
                    </Box>
                  )}
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('goodsReceipts')}</Typography>
                  {filteredReceipts.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('none', { scope })}</Typography>
                  ) : (
                    <ResponsiveTable>
                    <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableBody>
                        {filteredReceipts.map((gr) => (
                          <TableRow key={gr.id} {...clickableRow('/goods-receipts')}>
                            <TableCell data-label={t('colReceipt')}>{gr.receiptNumber}</TableCell>
                            <TableCell data-label={t('colPO')}>{t('poShort', { v: gr.purchaseOrder.poNumber })}</TableCell>
                            <TableCell data-label={t('colDate')}>{formatDate(gr.createdAt)}</TableCell>
                            <TableCell data-label={t('colStatus')}><Chip label={statusLabel(gr.status)} size="small" color={(STATUS_COLORS[gr.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label={t('colItemName')}>{t('itemsCount', { n: gr.items.length })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </TableContainer>
                    </ResponsiveTable>
                  )}
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('assetsSupplied')}</Typography>
                  {data.assets.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('noneDot')}</Typography>
                  ) : (
                    <ResponsiveTable>
                    <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableBody>
                        {data.assets.map((a) => (
                          <TableRow key={a.id} {...clickableRow(`/scan/${a.assetId}`)}>
                            <TableCell data-label={t('colAsset')}><strong>{a.assetId}</strong></TableCell>
                            <TableCell data-label={t('colItemName')}>{a.inventoryItem.name}</TableCell>
                            <TableCell data-label={t('colStatus')}><Chip label={statusLabel(a.status)} size="small" color={(STATUS_COLORS[a.status] ?? 'default') as never} /></TableCell>
                            <TableCell data-label={t('colLocation')}>{a.location}</TableCell>
                            <TableCell data-label={t('colCost')} align="right">{a.totalCost ? money(a.totalCost) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </TableContainer>
                    </ResponsiveTable>
                  )}
                </Box>
              </Stack>
            )}

            {/* ── Audit trail (VIEW_AUDIT_LOG roles only) ── */}
            {tab === tabCount - 1 && auditRows && (
              <ResponsiveTable>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{t('dateTime')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colAction')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colModule')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colChanges')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('colBy')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {auditRows.length === 0 ? (
                      <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3 }}><Typography color="text.secondary">{t('noAudit')}</Typography></TableCell></TableRow>
                    ) : (
                      auditRows.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell data-label={t('colDate')} sx={{ whiteSpace: 'nowrap' }}>{fmtTime(a.timestamp)}</TableCell>
                          <TableCell data-label={t('colAction')}><Chip label={statusLabel(a.action)} size="small" variant="outlined" /></TableCell>
                          <TableCell data-label={t('colModule')}>{enumLabel(a.entityType)}</TableCell>
                          <TableCell data-label={t('colChanges')} sx={{ whiteSpace: 'normal', minWidth: { md: 200 } }}>
                            <Typography variant="caption">{auditDiff(a.oldValue, a.newValue) || '—'}</Typography>
                          </TableCell>
                          <TableCell data-label={t('colBy')}>{a.user.name} <Typography variant="caption" color="text.secondary">({roleLabel(a.user.role)})</Typography></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              </ResponsiveTable>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
