import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Button,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Link as MuiLink,
  Alert,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  OpenInNew as OpenInNewIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { formatDate, formatIndianNumber, STATUS_COLORS, enumLabel } from '../utils/enumOptions';
import ResponsiveTable from './ResponsiveTable';

import { useTranslation } from 'react-i18next';
// Shape returned by GET /assets/:id/trace and the authenticated scan endpoint.
export interface TraceData {
  id: string;
  assetId: string;
  vendor?: {
    id: string; vendorCode: string; name: string; referenceBy?: string | null;
    contactPersonName?: string | null; contactPersonPhone?: string | null;
    phone?: string | null; address?: string | null; gstNumber?: string | null;
    category?: string; status?: string;
  } | null;
  quotation?: {
    id: string; quotationNumber: string; date: string; status: string;
    totalAmount?: string | number; gstAmount?: string | number; grandTotal?: string | number;
    fileName?: string | null; filePath?: string | null;
    items?: { materialName: string; quantity: string; unit?: string | null; unitPrice: string; amount: string; gstRate: string }[];
    createdByUser?: { name: string } | null;
  } | null;
  purchaseOrder?: {
    id: string; poNumber: string; date: string; status: string; paymentType: string;
    totalAmount?: string | number; gstAmount?: string | number; grandTotal?: string | number;
    notes?: string | null; regenerationNumber?: number; editReason?: string | null;
    vendor?: { id: string; name: string; vendorCode: string; referenceBy?: string | null } | null;
    quotation?: { id: string; quotationNumber: string; date: string } | null;
    budgetHead?: { id: string; particulars: string } | null;
    createdByUser?: { name: string } | null;
    items?: { materialName: string; quantity: string; unit?: string | null; unitPrice: string; gstRate: string; amount: string }[];
  } | null;
  gatePass?: {
    id: string; passNumber: string; date: string; status: string; gatePassType?: string;
    vehicleNumber?: string | null; driverName?: string | null; driverMobile?: string | null; remarks?: string | null;
    items?: { materialName: string; quantity: string; unit?: string | null }[];
    createdByUser?: { name: string } | null;
  } | null;
  goodsReceipt?: {
    id: string; receiptNumber: string; status: string; createdAt: string;
    inspectedAt?: string | null; postedAt?: string | null;
    items?: { materialName: string; deliveredQty: string; acceptedQty: string; rejectedQty: string; rejectionReason?: string | null; itemType: string }[];
    inspection?: { status: string; completedDate?: string | null } | null;
    createdByUser?: { name: string } | null;
    inspectedByUser?: { name: string } | null;
    postedByUser?: { name: string } | null;
  } | null;
}

function money(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function qty(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return '—';
  return formatIndianNumber(v);
}

function statusLabel(s: string): string {
  return enumLabel(s);
}

interface ChainCardProps {
  step: number;
  label: string;
  badge: string;
  badgeColor?: keyof typeof STATUS_COLORS;
  subtitle?: string;
  onOpen?: () => void;
  openLabel?: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}

function ChainCard({ step, label, badge, badgeColor, subtitle, onOpen, openLabel, children, defaultExpanded = false, hideOpen }: ChainCardProps & { hideOpen?: boolean }) {
  const { t } = useTranslation('trace');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetails = !!children;
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: '16px !important' }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ width: { xs: 24, sm: 28 }, height: { xs: 24, sm: 28 }, minWidth: { xs: 24, sm: 28 }, borderRadius: '50%', bgcolor: 'primary.main', color: 'common.white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: { xs: 11, sm: 13 }, fontWeight: 700 }}>
            {step}
          </Box>
          <Typography variant="overline" color="text.secondary">{label}</Typography>
          <Chip size="small" label={badge} color={(STATUS_COLORS[badgeColor ?? ''] ?? 'default') as never} />
          {subtitle && <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>{subtitle}</Typography>}
          <Box sx={{ flexGrow: 1 }} />
          {hasDetails && (
            <Button size="small" onClick={() => setExpanded((e) => !e)} endIcon={<ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}>
              {expanded ? t('less') : t('detailsBtn')}
            </Button>
          )}
          {onOpen && openLabel && !hideOpen && (
            <Button size="small" startIcon={<OpenInNewIcon />} onClick={onOpen}>{openLabel}</Button>
          )}
        </Box>
        <Collapse in={expanded}>
          <Box sx={{ mt: 1.5 }}>{children}</Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '130px 1fr', sm: '170px 1fr' }, gap: 1.5, py: 0.5, alignItems: 'start' }}>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'break-word' }}>{label}</Typography>
      <Box sx={{ fontSize: '0.875rem', fontWeight: 500, overflowWrap: 'break-word' }}>{value}</Box>
    </Box>
  );
}

export default function TraceabilityChain({ trace, hideNavigation = false }: { trace: TraceData; hideNavigation?: boolean }) {
  const { t } = useTranslation('trace');
  const navigate = useNavigate();
  const { vendor, quotation, purchaseOrder: po, gatePass, goodsReceipt: grn } = trace;

  function openProps(to: string, label: string): { onOpen?: () => void; openLabel?: string } {
    if (hideNavigation) return {};
    return { onOpen: () => navigate(to), openLabel: label };
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Vendor */}
      {vendor && (
        <ChainCard
          step={1}
          label={t('vendor')}
          badge={vendor.vendorCode}
          subtitle={vendor.name}
          {...openProps('/vendors', t('openVendors'))}
          defaultExpanded
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Field label={t('vendorCode')} value={vendor.vendorCode} />
            <Field label={t('category')} value={vendor.category ?? '—'} />
            <Field label={t('status')} value={<Chip size="small" label={statusLabel(vendor.status ?? 'ACTIVE')} color={(STATUS_COLORS[vendor.status ?? ''] ?? 'default') as never} />} />
            <Field label={t('gstNumber')} value={vendor.gstNumber ?? '—'} />
            <Field label={t('contactPerson')} value={vendor.contactPersonName ?? '—'} />
            <Field label={t('contactPhone')} value={vendor.contactPersonPhone ?? vendor.phone ?? '—'} />
            {vendor.referenceBy && (
              <Field
                label={t('referredBy')}
                value={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <PersonIcon fontSize="small" color="action" />
                    {vendor.referenceBy}
                  </Box>
                }
              />
            )}
            {vendor.address && <Field label={t('address')} value={vendor.address} />}
          </Box>
        </ChainCard>
      )}

      {/* Quotation */}
      {quotation && (
        <ChainCard
          step={2}
          label={t('quotation')}
          badge={quotation.quotationNumber}
          badgeColor={quotation.status}
          subtitle={`${formatDate(quotation.date)} • ${money(quotation.grandTotal)}`}
          {...openProps('/quotations', t('openQuotations'))}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Field label={t('quotationNumber')} value={quotation.quotationNumber} />
            <Field label={t('date')} value={formatDate(quotation.date)} />
            <Field label={t('status')} value={<Chip size="small" label={statusLabel(quotation.status)} color={(STATUS_COLORS[quotation.status] ?? 'default') as never} />} />
            <Field label={t('grandTotal')} value={money(quotation.grandTotal)} />
            <Field label={t('subtotal')} value={money(quotation.totalAmount)} />
            <Field label={t('gst2')} value={money(quotation.gstAmount)} />
            {quotation.createdByUser && <Field label={t('createdBy')} value={quotation.createdByUser.name} />}
          </Box>
          {quotation.fileName && quotation.filePath && (
            <Box sx={{ mt: 1 }}>
              <MuiLink href={quotation.filePath as string} target="_blank" rel="noopener" variant="body2">{quotation.fileName}</MuiLink>
            </Box>
          )}
          {quotation.items && quotation.items.length > 0 && (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('gst')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('amount')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {quotation.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell data-label={t('material')}>{it.materialName}</TableCell>
                      <TableCell data-label={t('qty')}>{qty(it.quantity)}</TableCell>
                      <TableCell data-label={t('unit')}>{it.unit ?? '—'}</TableCell>
                      <TableCell data-label={t('unitPrice')}>{money(it.unitPrice)}</TableCell>
                      <TableCell data-label={t('gst')}>{it.gstRate}</TableCell>
                      <TableCell data-label={t('amount')}>{money(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </ChainCard>
      )}

      {/* Purchase Order */}
      {po && (
        <ChainCard
          step={3}
          label={t('purchaseOrder')}
          badge={po.poNumber}
          badgeColor={po.status}
          subtitle={`${formatDate(po.date)} • ${money(po.grandTotal)}`}
          {...openProps('/pos', t('openPos'))}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Field label={t('poNumber')} value={po.poNumber} />
            <Field label={t('date')} value={formatDate(po.date)} />
            <Field label={t('status')} value={<Chip size="small" label={statusLabel(po.status)} color={(STATUS_COLORS[po.status] ?? 'default') as never} />} />
            <Field label={t('paymentType')} value={statusLabel(po.paymentType)} />
            <Field label={t('grandTotal')} value={money(po.grandTotal)} />
            <Field label={t('subtotal')} value={money(po.totalAmount)} />
            {po.budgetHead && <Field label={t('budgetHead')} value={po.budgetHead.particulars} />}
            {po.createdByUser && <Field label={t('createdBy')} value={po.createdByUser.name} />}
            {Number(po.regenerationNumber) > 0 && <Field label={t('regeneration')} value={String(po.regenerationNumber)} />}
            {po.editReason?.trim() && <Field label={t('editReason')} value={po.editReason} />}
          </Box>
          {po.items && po.items.length > 0 && (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unitPrice')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('gst')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('amount')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {po.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell data-label={t('material')}>{it.materialName}</TableCell>
                      <TableCell data-label={t('qty')}>{qty(it.quantity)}</TableCell>
                      <TableCell data-label={t('unit')}>{it.unit ?? '—'}</TableCell>
                      <TableCell data-label={t('unitPrice')}>{money(it.unitPrice)}</TableCell>
                      <TableCell data-label={t('gst')}>{it.gstRate}</TableCell>
                      <TableCell data-label={t('amount')}>{money(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </ChainCard>
      )}

      {/* Gate Pass */}
      {gatePass && (
        <ChainCard
          step={4}
          label={t('gatePass')}
          badge={gatePass.passNumber}
          badgeColor={gatePass.status}
          subtitle={`${formatDate(gatePass.date)} • ${statusLabel(gatePass.gatePassType ?? '')}`}
          {...openProps('/goods-receipts', t('openGrns'))}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Field label={t('passNumber')} value={gatePass.passNumber} />
            <Field label={t('date')} value={formatDate(gatePass.date)} />
            <Field label={t('status')} value={<Chip size="small" label={statusLabel(gatePass.status)} color={(STATUS_COLORS[gatePass.status] ?? 'default') as never} />} />
            <Field label={t('type')} value={statusLabel(gatePass.gatePassType ?? 'NON_RETURNABLE')} />
            <Field label={t('vehicle')} value={gatePass.vehicleNumber ?? '—'} />
            <Field label={t('driver')} value={gatePass.driverName ? `${gatePass.driverName} ${gatePass.driverMobile ? `(${gatePass.driverMobile})` : ''}` : '—'} />
            {gatePass.createdByUser && <Field label={t('createdBy')} value={gatePass.createdByUser.name} />}
          </Box>
          {gatePass.remarks && <Field label={t('remarks')} value={gatePass.remarks} />}
          {gatePass.items && gatePass.items.length > 0 && (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('qty')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('unit')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {gatePass.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell data-label={t('material')}>{it.materialName}</TableCell>
                      <TableCell data-label={t('qty')}>{qty(it.quantity)}</TableCell>
                      <TableCell data-label={t('unit')}>{it.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </ChainCard>
      )}

      {/* Goods Receipt */}
      {grn && (
        <ChainCard
          step={5}
          label={t('goodsReceiptGrn')}
          badge={grn.receiptNumber}
          badgeColor={grn.status}
          subtitle={`${formatDate(grn.createdAt)} • ${statusLabel(grn.status)}`}
          {...openProps('/goods-receipts', t('openGrns'))}
          defaultExpanded
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Field label={t('receiptNumber')} value={grn.receiptNumber} />
            <Field label={t('created')} value={formatDate(grn.createdAt)} />
            <Field label={t('status')} value={<Chip size="small" label={statusLabel(grn.status)} color={(STATUS_COLORS[grn.status] ?? 'default') as never} />} />
            {grn.inspection && <Field label={t('inspection')} value={<Chip size="small" label={statusLabel(grn.inspection.status)} color={(STATUS_COLORS[grn.inspection.status] ?? 'default') as never} />} />}
            {grn.inspectedAt && <Field label={t('inspectedAt')} value={formatDate(grn.inspectedAt)} />}
            {grn.postedAt && <Field label={t('postedAt')} value={formatDate(grn.postedAt)} />}
            {grn.createdByUser && <Field label={t('createdBy')} value={grn.createdByUser.name} />}
            {grn.inspectedByUser && <Field label={t('inspectedBy')} value={grn.inspectedByUser.name} />}
            {grn.postedByUser && <Field label={t('postedBy')} value={grn.postedByUser.name} />}
          </Box>
          {grn.items && grn.items.length > 0 && (
            <ResponsiveTable>
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('material')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('delivered')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('accepted')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('rejected')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('reason')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {grn.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell data-label={t('material')}>{it.materialName}</TableCell>
                      <TableCell data-label={t('delivered')}>{qty(it.deliveredQty)}</TableCell>
                      <TableCell data-label={t('accepted')} sx={{ color: 'success.main' }}>{qty(it.acceptedQty)}</TableCell>
                      <TableCell data-label={t('rejected')} sx={{ color: Number(it.rejectedQty) > 0 ? 'error.main' : 'text.secondary' }}>{qty(it.rejectedQty)}</TableCell>
                      <TableCell data-label={t('reason')}>{it.rejectionReason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </ResponsiveTable>
          )}
        </ChainCard>
      )}

      {/* Asset (this asset) */}
      <ChainCard
        step={6}
        label={t('asset')}
        badge={trace.assetId}
        subtitle={t('thisUnit')}
        {...openProps(`/scan/${trace.assetId}`, t('scanView'))}
        defaultExpanded
      />

      {!vendor && !quotation && !po && !gatePass && !grn && (
        <Alert severity="info">{t('noLinked')}</Alert>
      )}
    </Box>
  );
}
