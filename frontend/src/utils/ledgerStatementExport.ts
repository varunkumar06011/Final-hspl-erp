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

import jsPDF from 'jspdf';
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

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Ledger Statement — ${meta.ledgerName}`, 14, 15);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Group: ${meta.ledgerGroup}`, 14, 22);
  doc.text(`From: ${formatDisplayDate(meta.startDate)}    To: ${formatDisplayDate(meta.endDate)}`, 14, 28);

  // ── Opening / Closing balances ──
  doc.text(`Opening Balance: ${formatBalanceWithSuffix(data.openingBalance, isDebit)}`, 14, 34);
  doc.text(`Closing Balance: ${formatBalanceWithSuffix(data.closingBalance, isDebit)}`, 14, 40);

  // ── Table ──
  const tableBody = data.data.map((entry) => [
    formatDate(entry.voucherDate),
    entry.voucherNumber,
    entry.voucherType.replace(/_/g, ' '),
    entry.description ?? '—',
    entry.debit > 0 ? formatCurrency(entry.debit) : '—',
    entry.credit > 0 ? formatCurrency(entry.credit) : '—',
    formatBalanceWithSuffix(entry.balance, isDebit),
  ]);

  // Add opening balance row at the top
  tableBody.unshift(['', '', '', 'Opening Balance', '', '', formatBalanceWithSuffix(data.openingBalance, isDebit)]);

  autoTable(doc, {
    head: [['Date', 'Voucher', 'Type', 'Description', 'Debit', 'Credit', 'Balance']],
    body: tableBody,
    startY: 44,
    theme: 'striped',
    headStyles: { fillColor: [66, 66, 66], fontSize: 9, halign: 'left' },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 32 },
      2: { cellWidth: 28 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 32, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 36, halign: 'right' },
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

  const rowsHtml = data.data.map((entry) => `
    <tr>
      <td>${escapeHtml(formatDate(entry.voucherDate))}</td>
      <td>${escapeHtml(entry.voucherNumber)}</td>
      <td>${escapeHtml(entry.voucherType.replace(/_/g, ' '))}</td>
      <td>${escapeHtml(entry.description ?? '—')}</td>
      <td class="num">${entry.debit > 0 ? escapeHtml(formatCurrency(entry.debit)) : '—'}</td>
      <td class="num">${entry.credit > 0 ? escapeHtml(formatCurrency(entry.credit)) : '—'}</td>
      <td class="num">${escapeHtml(formatBalanceWithSuffix(entry.balance, isDebit))}</td>
    </tr>
  `).join('');

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
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th {
    background: #424242;
    color: #fff;
    text-align: left;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
  }
  thead th.num { text-align: right; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  tbody td.num { text-align: right; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fafafa; }
  .opening-row td { font-weight: 600; color: #555; }
  @page { margin: 12mm; }
  @media print {
    thead { display: table-header-group; }
    tbody { page-break-inside: auto; }
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
    <thead>
      <tr>
        <th>Date</th><th>Voucher</th><th>Type</th><th>Description</th>
        <th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      <tr class="opening-row">
        <td colspan="4">Opening Balance</td>
        <td class="num">—</td><td class="num">—</td>
        <td class="num">${escapeHtml(formatBalanceWithSuffix(data.openingBalance, isDebit))}</td>
      </tr>
      ${rowsHtml}
    </tbody>
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
