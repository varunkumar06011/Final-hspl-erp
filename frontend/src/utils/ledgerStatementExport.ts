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
  if (!isoDate) return '—';
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

// ─── PDF Export ─────────────────────────────────────────────────────────────

export function exportLedgerStatementPdf(
  data: LedgerStatementData,
  meta: LedgerStatementMeta,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const isDebit = data.ledger.isDebitNature;

  // jsPDF's built-in fonts lack the ₹ glyph (it renders as "¹") — use "Rs."
  // in PDF output. The browser print path keeps ₹ (it renders correctly).
  const pdfAmt = (n: number) => formatCurrency(n).replace('₹', 'Rs.');
  const pdfBal = (n: number) => formatBalanceWithSuffix(n, isDebit).replace('₹', 'Rs.');

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Ledger Statement — ${meta.ledgerName}`, 14, 15);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Group: ${meta.ledgerGroup}`, 14, 22);
  doc.text(`From: ${formatDisplayDate(meta.startDate)}    To: ${formatDisplayDate(meta.endDate)}`, 14, 28);

  // ── Opening / Closing balances ──
  doc.text(`Opening Balance: ${pdfBal(data.openingBalance)}`, 14, 34);
  doc.text(`Closing Balance: ${pdfBal(data.closingBalance)}`, 14, 40);

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
      tableBody.push([
        '',
        {
          content: desc.replace(/₹/g, 'Rs.'),
          colSpan: 5,
          styles: { halign: 'justify', fontSize: 7.5, textColor: [70, 70, 70], cellPadding: { top: 0.5, right: 2, bottom: 2.5, left: 2 } },
        },
      ]);
      txnOfRow.push(i);
    }
  });

  autoTable(doc, {
    head: [['Date', 'Voucher', 'Type', 'Debit', 'Credit', 'Balance']],
    body: tableBody as never,
    startY: 44,
    theme: 'plain',
    tableWidth: 'wrap',
    headStyles: { fillColor: [66, 66, 66], fontSize: 9, halign: 'left' },
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

export function printLedgerStatement(
  data: LedgerStatementData,
  meta: LedgerStatementMeta,
): void {
  const isDebit = data.ledger.isDebitNature;

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
      ${desc ? `<tr class="desc"><td></td><td colspan="5" class="desc-cell">${escapeHtml(desc)}</td></tr>` : ''}
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
  .meta { margin-bottom: 12px; color: #555; }
  .meta div { margin: 2px 0; }
  .balances { display: flex; gap: 24px; margin: 12px 0; }
  .balance-box { border: 1px solid #ddd; padding: 8px 12px; border-radius: 4px; }
  .balance-box .label { font-size: 11px; color: #666; }
  .balance-box .value { font-size: 14px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  col.c-date { width: 12%; }
  col.c-vch { width: 18%; }
  col.c-type { width: 14%; }
  col.c-amt { width: 16%; }
  col.c-bal { width: 24%; }
  thead th {
    background: #424242;
    color: #fff;
    text-align: left;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
  }
  thead th.num { text-align: right; }
  tbody.txn td { padding: 5px 8px 2px; border-bottom: none; }
  tbody.txn tr:last-child td { padding-bottom: 5px; border-bottom: 1px solid #eee; }
  tbody.txn td.num { text-align: right; white-space: nowrap; }
  tbody.txn td.desc-cell {
    padding: 1px 8px 5px 8px;
    text-align: justify;
    color: #333;
    word-wrap: break-word;
  }
  tbody.txn:nth-child(even) { background: #fafafa; }
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
  <h1>Ledger Statement — ${escapeHtml(meta.ledgerName)}</h1>
  <div class="meta">
    <div>Group: ${escapeHtml(meta.ledgerGroup)}</div>
    <div>From: ${escapeHtml(formatDisplayDate(meta.startDate))} &nbsp;&nbsp; To: ${escapeHtml(formatDisplayDate(meta.endDate))}</div>
  </div>
  <div class="balances">
    <div class="balance-box">
      <div class="label">Opening Balance</div>
      <div class="value">${escapeHtml(formatBalanceWithSuffix(data.openingBalance, isDebit))}</div>
    </div>
    <div class="balance-box">
      <div class="label">Closing Balance</div>
      <div class="value">${escapeHtml(formatBalanceWithSuffix(data.closingBalance, isDebit))}</div>
    </div>
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
