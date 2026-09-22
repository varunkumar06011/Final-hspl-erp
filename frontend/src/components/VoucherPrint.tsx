import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Alert } from '@mui/material';
import { Print as PrintIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import api from '../config/api';
import { formatIndianNumber, formatDate, amountToWords } from '../utils/enumOptions';
import { VoucherType, LedgerGroup } from '@hospital-erp/shared';
import voucherTemplate from '../vochuer.png';
import receiptVoucherTemplate from '../Receipt.png';
import journalVoucherTemplate from '../Journal voucher.png';

export interface VoucherEntry {
  ledgerId: string;
  ledgerName: string;
  ledgerGroup: string;
  debit: number;
  credit: number;
  description: string | null;
  budgetHead: { id: string; particulars: string } | null;
}

export interface BillSettlement {
  id: string;
  amount: number;
  voucher: { id: string; jvNumber: string; voucherType: string; date: string; status: string };
}

export interface Voucher {
  id: string;
  jvNumber: string;
  voucherType: string;
  date: string;
  description: string | null;
  totalDebit: number;
  totalCredit: number;
  status: string;
  createdBy: string;
  updatedBy: string | null;
  updatedAt: string | null;
  chequeNumber: string | null;
  chequeDate: string | null;
  entries: VoucherEntry[];
  billSettlements?: BillSettlement[];
}

export type PrintableVoucher = Voucher & { createdByUser?: { name: string } | null };

export const mapVoucher = (v: any): Voucher => ({
  id: v.id,
  jvNumber: v.jvNumber,
  voucherType: v.voucherType,
  date: v.date,
  description: v.description,
  totalDebit: Number(v.totalDebit),
  totalCredit: Number(v.totalCredit),
  status: v.status,
  createdBy: v.createdByUser?.name ?? v.createdBy ?? '—',
  updatedBy: v.updatedByUser?.name ?? null,
  updatedAt: v.updatedAt ?? null,
  chequeNumber: v.chequeNumber ?? null,
  chequeDate: v.chequeDate ?? null,
  entries: (v.ledgerEntries ?? []).map((le: any) => ({
    ledgerId: le.ledger?.id ?? le.ledgerId ?? '',
    ledgerName: le.ledger?.name ?? '',
    ledgerGroup: le.ledger?.group ?? '',
    debit: Number(le.debit),
    credit: Number(le.credit),
    description: le.description,
    budgetHead: le.budgetHead ? { id: le.budgetHead.id, particulars: le.budgetHead.particulars } : null,
  })),
  billSettlements: (v.billSettlements ?? []).map((bs: any) => ({
    id: bs.id,
    amount: Number(bs.amount),
    voucher: bs.journalVoucher ?? { id: '', jvNumber: '', voucherType: '', date: '', status: '' },
  })),
});

const VOUCHER_PRINT_CSS = `
      @font-face { font-family: Okara; src: url('/fonts/Okara.woff2') format('woff2'); font-display: swap; }
      @media print {
        @page { margin: 0; size: auto; }
        body * { visibility: hidden !important; }
        .voucher-print-root, .voucher-print-root * { visibility: visible !important; }
        .voucher-print-root { position: absolute !important; left: 0 !important; top: 0 !important; width: 100vw !important; max-width: none !important; padding: 0 !important; margin: 0 !important; background: white !important; }
        .voucher-print-sheet { width: 100vw !important; max-width: none !important; box-shadow: none !important; }
        .voucher-preview-controls { display: none !important; }
      }
    `;

/**
 * Print ONLY the rendered voucher through a hidden iframe.
 *
 * window.print() on the main document paginates the entire (hidden) app DOM,
 * so the page count depended on device/screen size — the 8/11-page bug. The
 * iframe document contains just the voucher markup plus the same stylesheets,
 * so the output is always exactly one page on every device and browser.
 */
export function printVoucherSheet() {
  const root = document.querySelector<HTMLElement>('.voucher-print-root');
  if (!root) return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  // A real, fixed viewport so vw/clamp() units in the sheet resolve to the
  // same pixel values on every device — identical print size everywhere.
  iframe.style.left = '-10000px';
  iframe.style.width = '1100px';
  iframe.style.height = '800px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  // Serialize every accessible stylesheet into real CSS text. MUI/Emotion
  // inserts rules via sheet.insertRule(), so cloning <style> elements copies
  // EMPTY tags — the cloned markup would render unstyled (fields detached
  // below the image). document.styleSheets exposes the live rules; the
  // textContent pass below additionally covers any text-based <style> tags.
  const cssChunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      cssChunks.push(Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n'));
    } catch { /* cross-origin stylesheet — skip */ }
  }
  document.querySelectorAll('style').forEach((el) => {
    const text = el.textContent?.trim();
    if (text) cssChunks.push(text);
  });

  // One voucher = one page: tight page margins, sheet fills printable width.
  const styleEl = doc.createElement('style');
  styleEl.textContent = `${cssChunks.join('\n')}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    @page { size: auto; margin: 8mm; }
    .voucher-print-root { display: flex; justify-content: center; width: 100%; break-inside: avoid; page-break-inside: avoid; }
    .voucher-print-sheet { width: 100% !important; max-width: none !important; box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }
    .voucher-preview-controls { display: none !important; }
  `;
  doc.head.appendChild(styleEl);
  doc.title = 'Voucher';

  const clone = root.cloneNode(true) as HTMLElement;
  // Inline the sheet/img geometry as a safety net — even if a class rule is
  // somehow missing, the template image fills the sheet and can't detach.
  const sheetEl = clone.querySelector<HTMLElement>('.voucher-print-sheet');
  const imgEl = clone.querySelector<HTMLImageElement>('img');
  if (sheetEl) {
    const origSheet = root.querySelector<HTMLElement>('.voucher-print-sheet');
    const aspect = origSheet ? getComputedStyle(origSheet).aspectRatio : 'auto';
    sheetEl.style.position = 'relative';
    sheetEl.style.width = '100%';
    sheetEl.style.aspectRatio = aspect !== 'auto' ? aspect : '1568 / 1014';
    sheetEl.style.overflow = 'hidden';
    sheetEl.style.boxShadow = 'none';
  }
  if (imgEl) {
    imgEl.style.position = 'absolute';
    imgEl.style.inset = '0';
    imgEl.style.width = '100%';
    imgEl.style.height = '100%';
    imgEl.style.objectFit = 'contain';
  }
  doc.body.appendChild(clone);

  const cleanup = () => {
    win?.removeEventListener?.('afterprint', cleanup);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  win?.addEventListener?.('afterprint', cleanup);

  const doPrint = () => {
    try {
      win?.focus();
      win?.print();
    } finally {
      setTimeout(cleanup, 2000);
    }
  };

  // Wait for the template image + web font so nothing prints blank/shifted.
  const img = doc.querySelector('img');
  const imgReady = !img || img.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
  Promise.all([imgReady, doc.fonts?.ready ?? Promise.resolve()]).then(doPrint);
}

// Fields vertically centered on their position (boxes / blank areas).
const voucherFieldSx = {
  position: 'absolute',
  transform: 'translateY(-50%)',
  fontFamily: 'Okara, Arial, sans-serif',
  fontSize: 'clamp(11px, 1.45vw, 20px)',
  lineHeight: 1.15,
  color: '#222',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;
// Fields whose text sits on a printed line — bottom edge rests on the line.
const voucherLineFieldSx = { ...voucherFieldSx, transform: 'translateY(-100%)' };
// Narration/description — wraps to a second printed line when long, then clamps
// at 2 lines with an ellipsis so the voucher height never grows. The stored
// narration is untouched; the full text is still available via the title attr.
const voucherNarrationFieldSx = {
  ...voucherLineFieldSx,
  whiteSpace: 'normal',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
} as const;

// Shared print wrapper — injects the print stylesheet and renders the template
// image with absolutely-positioned dynamic text children on top of it.
// Landscape-first: the sheet keeps its wide aspect on every screen; on narrow
// phones the parent scrolls horizontally instead of squeezing the voucher into
// a portrait-width layout where the printed text would become unreadable.
export function VoucherPrintSheet({ template, alt, aspect, children }: { template: string; alt: string; aspect: string; children: React.ReactNode }) {
  return <>
    <style>{VOUCHER_PRINT_CSS}</style>
    {/* xs: flex-start is REQUIRED — with justifyContent:center a child wider
        than the container overflows BOTH edges and the left side becomes
        permanently unreachable by scrolling. flex-start puts the sheet's left
        edge at the scroll origin so the whole voucher is reachable. */}
    <Box className="voucher-print-root" sx={{ width: '100%', display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' }, p: { xs: 0, sm: 1 }, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <Box className="voucher-print-sheet" sx={{ position: 'relative', width: '100%', minWidth: { xs: 640, sm: 0 }, maxWidth: 1100, aspectRatio: aspect, bgcolor: '#fff', boxShadow: 3, overflow: 'hidden', flexShrink: 0 }}>
        <Box component="img" src={template} alt={alt} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        {children}
      </Box>
    </Box>
  </>;
}

export function PaymentVoucherPrintPreview({ voucher, template }: { voucher: PrintableVoucher; template: string }) {
  const partyEntry = voucher.entries.find((entry) => entry.ledgerGroup !== LedgerGroup.BANK && entry.ledgerGroup !== LedgerGroup.CASH);
  const accountEntry = voucher.entries.find((entry) => entry.ledgerGroup === LedgerGroup.BANK || entry.ledgerGroup === LedgerGroup.CASH);
  const paymentMode = accountEntry?.ledgerGroup === LedgerGroup.BANK ? 'Bank' : 'Cash';
  const amount = Number(voucher.totalDebit || voucher.totalCredit || 0);
  const amountText = amountToWords(amount);
  const createdBy = voucher.createdByUser?.name || voucher.createdBy || '';

  return (
    <VoucherPrintSheet template={template} alt="Payment voucher template" aspect="1568 / 1014">
      <Typography sx={{ ...voucherFieldSx, left: '20.4%', top: '34.7%', maxWidth: '40%' }}>{voucher.jvNumber}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '76.2%', top: '34.7%', maxWidth: '18%' }}>{formatDate(voucher.date)}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '19%', top: '42.1%', width: '75%' }}>{partyEntry?.ledgerName || ''}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '24.3%', top: '49.5%', width: '41%' }}>{paymentMode}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '75.3%', top: '49.5%', width: '18%' }}>{paymentMode === 'Bank' ? (voucher.chequeNumber || '') : ''}</Typography>
      <Typography title={voucher.description || ''} sx={{ ...voucherNarrationFieldSx, left: '23.2%', top: '57.1%', width: '70%' }}>{voucher.description || ''}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '16.8%', top: '72.7%', width: '20%', fontWeight: 700 }}>{formatIndianNumber(amount.toFixed(2))}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '46.4%', top: '72.7%', width: '44%', whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{amountText}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '30.5%', top: '90.3%', maxWidth: '25%' }}>{createdBy}</Typography>
    </VoucherPrintSheet>
  );
}

export function ReceiptVoucherPrintPreview({ voucher, template }: { voucher: PrintableVoucher; template: string }) {
  // For a RECEIPT voucher the "Received From" party is the credited non-cash ledger;
  // the debit entry is the bank/cash account that received the money.
  const partyEntry = voucher.entries.find((entry) => entry.ledgerGroup !== LedgerGroup.BANK && entry.ledgerGroup !== LedgerGroup.CASH);
  const accountEntry = voucher.entries.find((entry) => entry.ledgerGroup === LedgerGroup.BANK || entry.ledgerGroup === LedgerGroup.CASH);
  const receiptMode = accountEntry?.ledgerGroup === LedgerGroup.BANK ? 'Bank' : 'Cash';
  const amount = Number(voucher.totalDebit || voucher.totalCredit || 0);
  const amountText = amountToWords(amount);
  const createdBy = voucher.createdByUser?.name || voucher.createdBy || '';

  return (
    <VoucherPrintSheet template={template} alt="Receipt voucher template" aspect="1600 / 1035">
      <Typography sx={{ ...voucherFieldSx, left: '18.6%', top: '34.7%', maxWidth: '50%' }}>{voucher.jvNumber}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '76.2%', top: '34.7%', maxWidth: '17.5%' }}>{formatDate(voucher.date)}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '25.2%', top: '42.1%', width: '68%' }}>{partyEntry?.ledgerName || ''}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '23.6%', top: '49.5%', width: '41%' }}>{receiptMode}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '77.4%', top: '49.5%', width: '16%' }}>{receiptMode === 'Bank' ? (voucher.chequeNumber || '') : ''}</Typography>
      <Typography title={voucher.description || ''} sx={{ ...voucherNarrationFieldSx, left: '21.8%', top: '57.1%', width: '71.5%' }}>{voucher.description || ''}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '17.2%', top: '73.2%', width: '19.5%', fontWeight: 700 }}>{formatIndianNumber(amount.toFixed(2))}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '46.6%', top: '73.2%', width: '46%', whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{amountText}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '30.5%', top: '90.3%', maxWidth: '14%' }}>{createdBy}</Typography>
    </VoucherPrintSheet>
  );
}

export function JournalVoucherPrintPreview({ voucher, template }: { voucher: PrintableVoucher; template: string }) {
  const totalDebit = Number(voucher.totalDebit || 0);
  const totalCredit = Number(voucher.totalCredit || 0);
  const amount = totalDebit || totalCredit;
  const amountText = amountToWords(amount);
  const createdBy = voucher.createdByUser?.name || voucher.createdBy || '';
  const entries = voucher.entries;

  // The template has 8 ruled rows between the header (~34.5%) and the Total row
  // (~64.4%). When a voucher has more than 8 entries, compress the row spacing so
  // every entry still prints inside the table without overlapping the Total line.
  const cellSx = { ...voucherFieldSx, fontSize: 'clamp(9px, 1.15vw, 16px)' };
  const firstRowCenterY = 38.2;
  const templateRowStep = 3.27;
  const lastRowCenterY = 61.2;
  const rowStep = entries.length <= 8
    ? templateRowStep
    : (lastRowCenterY - firstRowCenterY) / Math.max(entries.length - 1, 1);
  const rowCenterY = (index: number) => `${firstRowCenterY + index * rowStep}%`;

  return (
    <VoucherPrintSheet template={template} alt="Journal voucher template" aspect="1559 / 1009">
      <Typography sx={{ ...voucherLineFieldSx, left: '9%', top: '29.3%', maxWidth: '19%' }}>{voucher.jvNumber}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '83.5%', top: '29.3%', maxWidth: '11%' }}>{formatDate(voucher.date)}</Typography>

      {entries.map((entry, index) => (
        <Box key={entry.ledgerId + '-' + index}>
          <Typography sx={{ ...cellSx, left: '5.6%', width: '5.1%', top: rowCenterY(index), textAlign: 'center' }}>{index + 1}</Typography>
          <Typography sx={{ ...cellSx, left: '11.2%', width: '50.5%', top: rowCenterY(index) }}>{entry.ledgerName}</Typography>
          <Typography sx={{ ...cellSx, left: '63%', width: '14.5%', top: rowCenterY(index), textAlign: 'right' }}>{entry.debit > 0 ? formatIndianNumber(entry.debit.toFixed(2)) : ''}</Typography>
          <Typography sx={{ ...cellSx, left: '78.5%', width: '15%', top: rowCenterY(index), textAlign: 'right' }}>{entry.credit > 0 ? formatIndianNumber(entry.credit.toFixed(2)) : ''}</Typography>
        </Box>
      ))}

      <Typography sx={{ ...cellSx, left: '63%', width: '14.5%', top: '64.4%', textAlign: 'right', fontWeight: 700 }}>{formatIndianNumber(totalDebit.toFixed(2))}</Typography>
      <Typography sx={{ ...cellSx, left: '78.5%', width: '15%', top: '64.4%', textAlign: 'right', fontWeight: 700 }}>{formatIndianNumber(totalCredit.toFixed(2))}</Typography>

      <Typography title={voucher.description || ''} sx={{ ...voucherNarrationFieldSx, left: '18%', top: '71%', width: '75%' }}>{voucher.description || ''}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '10.4%', top: '81%', width: '22.8%', fontWeight: 700 }}>{formatIndianNumber(amount.toFixed(2))}</Typography>
      <Typography sx={{ ...voucherFieldSx, left: '43.4%', top: '81%', width: '50%', whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{amountText}</Typography>
      <Typography sx={{ ...voucherLineFieldSx, left: '9%', top: '90.5%', maxWidth: '15.5%' }}>{createdBy}</Typography>
    </VoucherPrintSheet>
  );
}

/**
 * Opens the persisted voucher for a given voucher/journal-voucher id —
 * landscape sheet, horizontally scrollable on narrow screens, printable.
 * Used by the dashboard payment-detail dialogs and the vouchers page.
 */
export function VoucherPreviewDialog({ voucherId, onClose }: { voucherId: string | null; onClose: () => void }) {
  const { data: voucher, isLoading, isError } = useQuery<Voucher>({
    queryKey: ['/vouchers', 'print', voucherId],
    queryFn: async () => mapVoucher((await api.get(`/vouchers/${voucherId}`)).data),
    enabled: !!voucherId,
  });

  return (
    <Dialog open={!!voucherId} onClose={onClose} maxWidth="lg" fullWidth
      sx={{ '& .MuiDialog-paper': { m: { xs: 0.5, sm: 4 }, width: { xs: 'calc(100% - 8px)', sm: 'auto' }, maxHeight: { xs: 'calc(100% - 16px)' } } }}>
      <DialogTitle sx={{ py: { xs: 1, sm: 2 } }}>{voucher?.voucherType === VoucherType.RECEIPT ? 'Receipt Voucher Preview' : voucher?.voucherType === VoucherType.JOURNAL ? 'Journal Voucher Preview' : 'Payment Voucher Preview'}</DialogTitle>
      <DialogContent sx={{ bgcolor: '#eef1f5', p: { xs: 0.5, sm: 2 } }}>
        {isLoading && <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress /></Box>}
        {isError && <Alert severity="error">Unable to load the saved voucher for printing.</Alert>}
        {voucher && (
          voucher.voucherType === VoucherType.RECEIPT
            ? <ReceiptVoucherPrintPreview voucher={voucher} template={receiptVoucherTemplate} />
            : voucher.voucherType === VoucherType.JOURNAL
              ? <JournalVoucherPrintPreview voucher={voucher} template={journalVoucherTemplate} />
              : <PaymentVoucherPrintPreview voucher={voucher} template={voucherTemplate} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<PrintIcon />} disabled={!voucher} onClick={printVoucherSheet}>Print Voucher</Button>
      </DialogActions>
    </Dialog>
  );
}
