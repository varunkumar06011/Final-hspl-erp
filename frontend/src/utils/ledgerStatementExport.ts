/**
 * Ledger Statement export + print utilities.
 *
 * These functions operate on the CURRENT ledger statement data that is already
 * displayed in the Ledger Statement dialog. They do NOT re-fetch data or change
 * any filtering/calculation logic — they consume the same `statementData` object
 * that the dialog renders.
 *
 * PDF  — uses jsPDF + jspdf-autotable (already in the project)
 * Excel — uses CSV with UTF-8 BOM (opens natively in Excel, preserves numbers/dates)
 * Print — opens a hidden print-only iframe with print-specific CSS
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDate } from './enumOptions';
import api from '../config/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LedgerStatementEntry {
  id: string;
  voucherDate: string;
  voucherNumber: string;
  voucherType: string;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerStatementData {
  ledger: {
    name: string;
    isDebitNature: boolean;
  };
  openingBalance: number;
  closingBalance: number;
  data: LedgerStatementEntry[];
}

export interface LedgerStatementMeta {
  ledgerName: string;
  ledgerGroup: string;
  startDate: string; // YYYY-MM-DD from the date input
  endDate: string;   // YYYY-MM-DD from the date input
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Sanitize a string for use in a filename (remove invalid filesystem chars). */
function sanitizeFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Format a YYYY-MM-DD date string as DD-MM-YYYY for display in the document. */
function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return 'All';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/** Format a balance with Dr/Cr suffix based on the ledger's nature. */
function formatBalanceWithSuffix(amount: number, isDebitNature: boolean): string {
  const abs = Math.abs(amount);
  const formatted = formatCurrency(abs);
  if (amount === 0) return formatted;
  const suffix = isDebitNature ? (amount >= 0 ? ' Dr' : ' Cr') : (amount >= 0 ? ' Dr' : ' Cr');
  return `${formatted}${suffix}`;
}

/** Build a dynamic filename from account name + date range. */
function buildFilename(meta: LedgerStatementMeta, extension: string): string {
  const name = sanitizeFilename(meta.ledgerName);
  const from = meta.startDate ? formatDisplayDate(meta.startDate).replace(/-/g, '-') : 'start';
  const to = meta.endDate ? formatDisplayDate(meta.endDate).replace(/-/g, '-') : 'end';
  return `Ledger_Statement_${name}_${from}_to_${to}.${extension}`;
}

// ─── Company logo ───────────────────────────────────────────────────────────

let logoDataUrlCache: string | null | undefined;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Company logo for the statement letterhead. Prefers the logo uploaded in
 * Settings (GET /settings/logo), falls back to the bundled /logo.png.
 * Fetched once per session and cached.
 */
async function fetchLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlCache !== undefined) return logoDataUrlCache;
  logoDataUrlCache = null;
  try {
    const res = await api.get('/settings/logo', { responseType: 'blob' });
    if (res.data instanceof Blob && res.data.size > 0) {
      logoDataUrlCache = await blobToDataUrl(res.data);
    }
  } catch { /* no uploaded logo — fall through to the bundled one */ }
  if (!logoDataUrlCache) {
    try {
      const res = await fetch('/logo.png');
      if (res.ok) logoDataUrlCache = await blobToDataUrl(await res.blob());
    } catch { /* no logo available */ }
  }
  return logoDataUrlCache;
}

// ─── PDF Export ─────────────────────────────────────────────────────────────

export async function exportLedgerStatementPdf(
  data: LedgerStatementData,
  meta: LedgerStatementMeta,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const isDebit = data.ledger.isDebitNature;

  // jsPDF's built-in fonts lack the ₹ glyph (it renders as "¹") — use "Rs."
  // in PDF output. The browser print path keeps ₹ (it renders correctly).
  const pdfAmt = (n: number) => formatCurrency(n).replace('₹', 'Rs.');
  const pdfBal = (n: number) => formatBalanceWithSuffix(n, isDebit).replace('₹', 'Rs.');

  // ── Header ──
  // Company logo top-left; the title sits beside it (or at x=14 when no logo).
  const logoDataUrl = await fetchLogoDataUrl();
  let titleX = 14;
  let logoBottom = 8;
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const logoH = 12;
      const logoW = Math.min(45, (props.width / props.height) * logoH);
      doc.addImage(logoDataUrl, props.fileType || 'PNG', 14, 8, logoW, logoH);
      titleX = 14 + logoW + 6;
      logoBottom = 8 + logoH;
    } catch { /* logo unavailable — keep plain header */ }
  }
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Ledger Statement — ${meta.ledgerName}`, titleX, 16);

  // ── Meta line + boxed balances ──
  // One line: "Group: X   From: …   To: …" on the left, Opening/Closing
  // balances in boxed sections on the right. metaY sits a clear ~9mm below
  // the logo so the letterhead never crowds the content.
  const metaY = logoBottom + 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Group: ${meta.ledgerGroup}`, 14, metaY);
  doc.text(`From: ${formatDisplayDate(meta.startDate)}`, 95, metaY);
  doc.text(`To: ${formatDisplayDate(meta.endDate)}`, 135, metaY);

  const pageW = doc.internal.pageSize.getWidth();
  const boxW = 56;
  const boxH = 11;
  const boxY = metaY - 7.5;
  const box2X = pageW - 14 - boxW;
  const box1X = box2X - 5 - boxW;
  const drawBalBox = (x: number, label: string, value: string) => {
    doc.setDrawColor(120);
    doc.setLineWidth(0.3);
    doc.rect(x, boxY, boxW, boxH);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90);
    doc.text(label, x + 3, boxY + 4);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text(value, x + boxW - 3, boxY + 8.5, { align: 'right' });
  };
  drawBalBox(box1X, 'Opening Balance', pdfBal(data.openingBalance));
  drawBalBox(box2X, 'Closing Balance', pdfBal(data.closingBalance));

  // ── Table ──
  // Each transaction is a compact main row (Date | Voucher | Type | Debit |
  // Credit | Balance) followed by an optional description row that starts at
  // the Voucher column and spans the remaining width — matching the print
  // layout. `txnOfRow` tracks which transaction each body row belongs to so
  // both rows of a transaction share the same alternating shade.
  const tableBody: object[] = [];
  const txnOfRow: number[] = [];

  // Opening balance row
  tableBody.push([
    { content: 'Opening Balance', colSpan: 3, styles: { fontStyle: 'bold' } },
    '', '',
    { content: pdfBal(data.openingBalance), styles: { halign: 'right', fontStyle: 'bold' } },
  ]);
  txnOfRow.push(-1);

  data.data.forEach((entry, i) => {
    tableBody.push([
      formatDate(entry.voucherDate),
      entry.voucherNumber,
      entry.voucherType.replace(/_/g, ' '),
      entry.debit > 0 ? pdfAmt(entry.debit) : '—',
      entry.credit > 0 ? pdfAmt(entry.credit) : '—',
      pdfBal(entry.balance),
    ]);
    txnOfRow.push(i);
    const desc = entry.description?.trim();
    if (desc) {
      // Description block starts under Voucher and spans through the Type
      // column — a narrow block that wraps to ~2 lines, semi-bold.
      tableBody.push([
        '',
        {
          content: desc.replace(/₹/g, 'Rs.'),
          colSpan: 2,
          styles: { halign: 'justify', fontSize: 8, fontStyle: 'bold', textColor: [40, 40, 40], cellPadding: { top: 0.5, right: 2, bottom: 2.5, left: 2 } },
        },
        '',
        '',
        '',
      ]);
      txnOfRow.push(i);
    }
  });

  autoTable(doc, {
    head: [['Date', 'Voucher', 'Type', 'Debit', 'Credit', 'Balance']],
    body: tableBody as never,
    startY: metaY + 10,
    theme: 'plain',
    tableWidth: 'wrap',
    headStyles: { fillColor: [66, 66, 66], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, halign: 'left' },
    bodyStyles: { fontSize: 8 },
    rowPageBreak: 'avoid',
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 34 },
      2: { cellWidth: 26 },
      3: { cellWidth: 40, halign: 'right' },
      4: { cellWidth: 40, halign: 'right' },
      5: { cellWidth: 46, halign: 'right' },
    },
    didParseCell: (hookData) => {
      // Alternate shading per transaction block so a main row and its
      // description row share one fill.
      if (hookData.section === 'body' && txnOfRow[hookData.row.index] > 0 && txnOfRow[hookData.row.index] % 2 === 1) {
        hookData.cell.styles.fillColor = [250, 250, 250];
      }
    },
    didDrawPage: (hookData) => {
      // Footer page number
      const pageCount = doc.getNumberOfPages();
      const currentPage = hookData.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Generated on ${new Date().toLocaleString('en-IN')}  |  Page ${currentPage} of ${pageCount}`,
        14,
        doc.internal.pageSize.getHeight() - 8,
      );
      doc.setTextColor(0);
    },
  });

  doc.save(buildFilename(meta, 'pdf'));
}

// ─── Excel Export (CSV with BOM — opens natively in Excel) ──────────────────

export function exportLedgerStatementExcel(
  data: LedgerStatementData,
  meta: LedgerStatementMeta,
): void {
  const isDebit = data.ledger.isDebitNature;
  const rows: string[] = [];

  // Title rows
  rows.push(`Ledger Statement — ${meta.ledgerName}`);
  rows.push(`Group,${meta.ledgerGroup}`);
  rows.push(`From,${formatDisplayDate(meta.startDate)}`);
  rows.push(`To,${formatDisplayDate(meta.endDate)}`);
  rows.push(`Opening Balance,${formatBalanceWithSuffix(data.openingBalance, isDebit)}`);
  rows.push(`Closing Balance,${formatBalanceWithSuffix(data.closingBalance, isDebit)}`);
  rows.push('');

  // Header row
  rows.push('Date,Voucher,Type,Description,Debit,Credit,Balance');

  // Opening balance row
  rows.push(`,,,Opening Balance,,,${formatBalanceWithSuffix(data.openingBalance, isDebit)}`);

  // Transaction rows — keep amounts as plain numbers (no currency symbol) so
  // Excel treats them as numeric values. Dates stay as DD-MM-YYYY strings.
  for (const entry of data.data) {
    const date = formatDate(entry.voucherDate);
    const voucher = escapeCsv(entry.voucherNumber);
    const type = escapeCsv(entry.voucherType.replace(/_/g, ' '));
    const desc = escapeCsv(entry.description ?? '—');
    const debit = entry.debit > 0 ? String(entry.debit) : '';
    const credit = entry.credit > 0 ? String(entry.credit) : '';
    const balance = String(entry.balance);
    rows.push(`${date},${voucher},${type},${desc},${debit},${credit},${balance}`);
  }

  const csv = rows.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFilename(meta, 'csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** RFC 4180 CSV escaping for values containing commas, quotes, or newlines. */
function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Print ──────────────────────────────────────────────────────────────────
// Opens a hidden iframe with print-specific CSS so only the ledger statement
// is printed — no app navigation, modal overlay, or buttons.

export async function printLedgerStatement(
  data: LedgerStatementData,
  meta: LedgerStatementMeta,
): Promise<void> {
  const isDebit = data.ledger.isDebitNature;
  const logoDataUrl = await fetchLogoDataUrl();

  // Each transaction is one <tbody> block: a compact main row followed by an
  // optional description row. The description cell starts at the Voucher
  // column (first cell is the empty Date column) and spans the remaining
  // table width, so every wrapped line aligns under the Voucher column.
  const rowsHtml = data.data.map((entry) => {
    const desc = entry.description?.trim();
    return `
    <tbody class="txn">
      <tr class="main">
        <td>${escapeHtml(formatDate(entry.voucherDate))}</td>
        <td>${escapeHtml(entry.voucherNumber)}</td>
        <td>${escapeHtml(entry.voucherType.replace(/_/g, ' '))}</td>
        <td class="num">${entry.debit > 0 ? escapeHtml(formatCurrency(entry.debit)) : '—'}</td>
        <td class="num">${entry.credit > 0 ? escapeHtml(formatCurrency(entry.credit)) : '—'}</td>
        <td class="num">${escapeHtml(formatBalanceWithSuffix(entry.balance, isDebit))}</td>
      </tr>
      ${desc ? `<tr class="desc"><td></td><td colspan="2" class="desc-cell">${escapeHtml(desc)}</td><td></td><td></td><td></td></tr>` : ''}
    </tbody>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ledger Statement — ${escapeHtml(meta.ledgerName)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    padding: 24px;
    font-size: 12px;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .letterhead { display: flex; align-items: center; gap: 20px; padding-bottom: 14px; border-bottom: 1.5px solid #e0e0e0; margin-bottom: 14px; }
  .letterhead img { height: 52px; max-width: 180px; object-fit: contain; display: block; }
  .meta-row { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; margin: 2px 0 14px; font-size: 12px; color: #333; }
  .meta-row b { color: #111; }
  .balance-box { border: 1.5px solid #555; padding: 4px 12px; display: inline-flex; align-items: baseline; gap: 8px; background: #fff; }
  .balance-box .label { font-size: 11px; color: #555; }
  .balance-box .value { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  col.c-date { width: 12%; }
  col.c-vch { width: 18%; }
  col.c-type { width: 14%; }
  col.c-amt { width: 16%; }
  col.c-bal { width: 24%; }
  thead th {
    /* Light header — browsers strip background colors when printing, so a
       dark fill would leave white text on white. A bottom rule is always
       visible regardless of the "background graphics" print setting. */
    background: #f5f5f5;
    color: #1a1a1a;
    border-bottom: 2px solid #424242;
    text-align: left;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 700;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  thead th.num { text-align: right; }
  tbody.txn td { padding: 5px 8px 2px; border-bottom: none; }
  tbody.txn tr:last-child td { padding-bottom: 5px; border-bottom: 1px solid #eee; }
  tbody.txn td.num { text-align: right; white-space: nowrap; }
  tbody.txn td.desc-cell {
    padding: 1px 8px 5px 8px;
    text-align: justify;
    /* Narrow columns justify poorly without hyphenation — 'auto' lets long
       words break so lines fill evenly instead of stretching with gaps. */
    hyphens: auto;
    -webkit-hyphens: auto;
    font-weight: 600;
    color: #222;
    overflow-wrap: break-word;
  }
  tbody.txn:nth-child(even) { background: #fafafa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tbody.opening td { padding: 5px 8px; border-bottom: 1px solid #eee; font-weight: 600; color: #555; }
  @page { margin: 12mm; }
  @media print {
    thead { display: table-header-group; }
    tbody { page-break-inside: avoid; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="letterhead">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Company logo" />` : ''}
    <div>
      <h1>Ledger Statement — ${escapeHtml(meta.ledgerName)}</h1>
    </div>
  </div>
  <div class="meta-row">
    <span><b>Group:</b> ${escapeHtml(meta.ledgerGroup)}</span>
    <span><b>From:</b> ${escapeHtml(formatDisplayDate(meta.startDate))}</span>
    <span><b>To:</b> ${escapeHtml(formatDisplayDate(meta.endDate))}</span>
    <span class="balance-box">
      <span class="label">Opening Balance</span>
      <span class="value">${escapeHtml(formatBalanceWithSuffix(data.openingBalance, isDebit))}</span>
    </span>
    <span class="balance-box">
      <span class="label">Closing Balance</span>
      <span class="value">${escapeHtml(formatBalanceWithSuffix(data.closingBalance, isDebit))}</span>
    </span>
  </div>
  <table>
    <colgroup>
      <col class="c-date" /><col class="c-vch" /><col class="c-type" />
      <col class="c-amt" /><col class="c-amt" /><col class="c-bal" />
    </colgroup>
    <thead>
      <tr>
        <th>Date</th><th>Voucher</th><th>Type</th>
        <th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th>
      </tr>
    </thead>
    <tbody class="opening">
      <tr>
        <td colspan="3">Opening Balance</td>
        <td class="num">—</td><td class="num">—</td>
        <td class="num">${escapeHtml(formatBalanceWithSuffix(data.openingBalance, isDebit))}</td>
      </tr>
    </tbody>
    ${rowsHtml}
  </table>
</body>
</html>`;

  // Use a hidden iframe so the print output contains ONLY the ledger statement
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('Could not open print window');
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Wait for the iframe to load before printing
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Some browsers may block print on the iframe — try the main window as fallback
      window.print();
    }
    // Remove the iframe after a short delay to allow the print dialog to appear
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1000);
  };
}

/** Escape HTML special characters to prevent injection in the print iframe. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
