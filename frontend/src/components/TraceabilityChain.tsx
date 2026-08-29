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
import { formatDate, formatIndianNumber, STATUS_COLORS } from '../utils/enumOptions';

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
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
              {expanded ? 'Less' : 'Details'}
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
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: { sm: 'space-between' }, gap: { xs: 0, sm: 2 }, py: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>{label}</Typography>
      <Typography variant="body2" fontWeight={500} sx={{ textAlign: { xs: 'left', sm: 'right' }, fontSize: { xs: '0.8rem', sm: '0.875rem' } }}>{value}</Typography>
    </Box>
  );
}

export default function TraceabilityChain({ trace, hideNavigation = false }: { trace: TraceData; hideNavigation?: boolean }) {
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
          label="Vendor"
          badge={vendor.vendorCode}
          subtitle={vendor.name}
          {...openProps('/vendors', 'Open Vendors')}
          defaultExpanded
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            <Field label="Vendor Code" value={vendor.vendorCode} />
            <Field label="Category" value={vendor.category ?? '—'} />
            <Field label="Status" value={<Chip size="small" label={statusLabel(vendor.status ?? 'ACTIVE')} color={(STATUS_COLORS[vendor.status ?? ''] ?? 'default') as never} />} />
            <Field label="GST Number" value={vendor.gstNumber ?? '—'} />
            <Field label="Contact Person" value={vendor.contactPersonName ?? '—'} />
            <Field label="Contact Phone" value={vendor.contactPersonPhone ?? vendor.phone ?? '—'} />
          </Box>
          {vendor.referenceBy && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon fontSize="small" color="action" />
              <Typography variant="body2"><strong>Referred By:</strong> {vendor.referenceBy}</Typography>
            </Box>
          )}
          {vendor.address && <Field label="Address" value={vendor.address} />}
        </ChainCard>
      )}

      {/* Quotation */}
      {quotation && (
        <ChainCard
          step={2}
          label="Quotation"
          badge={quotation.quotationNumber}
          badgeColor={quotation.status}
          subtitle={`${formatDate(quotation.date)} • ${money(quotation.grandTotal)}`}
          {...openProps('/quotations', 'Open Quotations')}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            <Field label="Quotation Number" value={quotation.quotationNumber} />
            <Field label="Date" value={formatDate(quotation.date)} />
            <Field label="Status" value={<Chip size="small" label={statusLabel(quotation.status)} color={(STATUS_COLORS[quotation.status] ?? 'default') as never} />} />
            <Field label="Grand Total" value={money(quotation.grandTotal)} />
            <Field label="Subtotal" value={money(quotation.totalAmount)} />
            <Field label="GST" value={money(quotation.gstAmount)} />
            {quotation.createdByUser && <Field label="Created By" value={quotation.createdByUser.name} />}
          </Box>
          {quotation.fileName && quotation.filePath && (
            <Box sx={{ mt: 1 }}>
              <MuiLink href={quotation.filePath as string} target="_blank" rel="noopener" variant="body2">{quotation.fileName}</MuiLink>
            </Box>
          )}
          {quotation.items && quotation.items.length > 0 && (
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {quotation.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.materialName}</TableCell>
                      <TableCell>{qty(it.quantity)}</TableCell>
                      <TableCell>{it.unit ?? '—'}</TableCell>
                      <TableCell>{money(it.unitPrice)}</TableCell>
                      <TableCell>{it.gstRate}</TableCell>
                      <TableCell>{money(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </ChainCard>
      )}

      {/* Purchase Order */}
      {po && (
        <ChainCard
          step={3}
          label="Purchase Order"
          badge={po.poNumber}
          badgeColor={po.status}
          subtitle={`${formatDate(po.date)} • ${money(po.grandTotal)}`}
          {...openProps('/pos', 'Open POs')}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            <Field label="PO Number" value={po.poNumber} />
            <Field label="Date" value={formatDate(po.date)} />
            <Field label="Status" value={<Chip size="small" label={statusLabel(po.status)} color={(STATUS_COLORS[po.status] ?? 'default') as never} />} />
            <Field label="Payment Type" value={statusLabel(po.paymentType)} />
            <Field label="Grand Total" value={money(po.grandTotal)} />
            <Field label="Subtotal" value={money(po.totalAmount)} />
            {po.budgetHead && <Field label="Budget Head" value={po.budgetHead.particulars} />}
            {po.createdByUser && <Field label="Created By" value={po.createdByUser.name} />}
            {po.regenerationNumber && po.regenerationNumber > 0 && <Field label="Regeneration #" value={String(po.regenerationNumber)} />}
            {po.editReason && <Field label="Edit Reason" value={po.editReason} />}
          </Box>
          {po.items && po.items.length > 0 && (
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>GST %</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {po.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.materialName}</TableCell>
                      <TableCell>{qty(it.quantity)}</TableCell>
                      <TableCell>{it.unit ?? '—'}</TableCell>
                      <TableCell>{money(it.unitPrice)}</TableCell>
                      <TableCell>{it.gstRate}</TableCell>
                      <TableCell>{money(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </ChainCard>
      )}

      {/* Gate Pass */}
      {gatePass && (
        <ChainCard
          step={4}
          label="Gate Pass"
          badge={gatePass.passNumber}
          badgeColor={gatePass.status}
          subtitle={`${formatDate(gatePass.date)} • ${statusLabel(gatePass.gatePassType ?? '')}`}
          {...openProps('/goods-receipts', 'Open GRNs')}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            <Field label="Pass Number" value={gatePass.passNumber} />
            <Field label="Date" value={formatDate(gatePass.date)} />
            <Field label="Status" value={<Chip size="small" label={statusLabel(gatePass.status)} color={(STATUS_COLORS[gatePass.status] ?? 'default') as never} />} />
            <Field label="Type" value={statusLabel(gatePass.gatePassType ?? 'NON_RETURNABLE')} />
            <Field label="Vehicle" value={gatePass.vehicleNumber ?? '—'} />
            <Field label="Driver" value={gatePass.driverName ? `${gatePass.driverName} ${gatePass.driverMobile ? `(${gatePass.driverMobile})` : ''}` : '—'} />
            {gatePass.createdByUser && <Field label="Created By" value={gatePass.createdByUser.name} />}
          </Box>
          {gatePass.remarks && <Field label="Remarks" value={gatePass.remarks} />}
          {gatePass.items && gatePass.items.length > 0 && (
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Qty</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {gatePass.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.materialName}</TableCell>
                      <TableCell>{qty(it.quantity)}</TableCell>
                      <TableCell>{it.unit ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </ChainCard>
      )}

      {/* Goods Receipt */}
      {grn && (
        <ChainCard
          step={5}
          label="Goods Receipt (GRN)"
          badge={grn.receiptNumber}
          badgeColor={grn.status}
          subtitle={`${formatDate(grn.createdAt)} • ${statusLabel(grn.status)}`}
          {...openProps('/goods-receipts', 'Open GRNs')}
          defaultExpanded
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            <Field label="Receipt Number" value={grn.receiptNumber} />
            <Field label="Created" value={formatDate(grn.createdAt)} />
            <Field label="Status" value={<Chip size="small" label={statusLabel(grn.status)} color={(STATUS_COLORS[grn.status] ?? 'default') as never} />} />
            {grn.inspection && <Field label="Inspection" value={<Chip size="small" label={statusLabel(grn.inspection.status)} color={(STATUS_COLORS[grn.inspection.status] ?? 'default') as never} />} />}
            {grn.inspectedAt && <Field label="Inspected At" value={formatDate(grn.inspectedAt)} />}
            {grn.postedAt && <Field label="Posted At" value={formatDate(grn.postedAt)} />}
            {grn.createdByUser && <Field label="Created By" value={grn.createdByUser.name} />}
            {grn.inspectedByUser && <Field label="Inspected By" value={grn.inspectedByUser.name} />}
            {grn.postedByUser && <Field label="Posted By" value={grn.postedByUser.name} />}
          </Box>
          {grn.items && grn.items.length > 0 && (
            <TableContainer component={Card} variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ '& .MuiTableCell-root': { p: { xs: '4px', sm: '8px' }, fontSize: { xs: '0.7rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Material</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Delivered</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Accepted</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Rejected</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {grn.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.materialName}</TableCell>
                      <TableCell>{qty(it.deliveredQty)}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>{qty(it.acceptedQty)}</TableCell>
                      <TableCell sx={{ color: Number(it.rejectedQty) > 0 ? 'error.main' : 'text.secondary' }}>{qty(it.rejectedQty)}</TableCell>
                      <TableCell>{it.rejectionReason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </ChainCard>
      )}

      {/* Asset (this asset) */}
      <ChainCard
        step={6}
        label="Asset"
        badge={trace.assetId}
        subtitle="This unit"
        {...openProps(`/scan/${trace.assetId}`, 'Scan View')}
        defaultExpanded
      />

      {!vendor && !quotation && !po && !gatePass && !grn && (
        <Alert severity="info">No linked procurement records found for this asset. It may have been created manually or its source records were deleted.</Alert>
      )}
    </Box>
  );
}
