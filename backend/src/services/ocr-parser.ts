/**
 * Local regex/rule-based document parser.
 *
 * Replaces the Groq LLM structuring step. Takes raw text (from pdfjs-dist for
 * digital PDFs, or Tesseract.js for images/scanned PDFs) and extracts the
 * structured fields the frontend expects.
 *
 * Design principle: be CONSERVATIVE. Return null rather than guess wrong —
 * the Gemini fallback in ocr.service.ts catches anything ambiguous. A wrong
 * value silently autofilled is worse than a null the user must fill in.
 */
import type {
  OcrDocumentType,
  OcrInvoiceResult,
  OcrLineItem,
  OcrQuotationResult,
  OcrResult,
} from './ocr.service.types';

// Re-export the types so callers can import from one place.
export type { OcrDocumentType, OcrInvoiceResult, OcrLineItem, OcrQuotationResult, OcrResult };

// ────────────────────────────────────────────────────────────────────────────
// Number helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a number that may contain thousand separators (comma or space or dot
 * depending on locale) and a decimal part. Handles Indian (12,34,567.00) and
 * Western (1,234,567.00) grouping — we just strip all non-digit/non-dot chars
 * and pick the last dot as the decimal separator.
 *
 * "1,234.50"      → 1234.5
 * "12,34,567.00"  → 1234567
 * "1.234,50"      → 1234.5  (European)
 * "Rs. 1,000"     → 1000
 * "₹ 1,000/-"     → 1000
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  // Strip currency prefixes/suffixes first so their dots don't pollute the
  // number (e.g. "Rs. 1,000" → the "." in "Rs." would otherwise become a
  // decimal separator). Then keep only digits, dots, and commas.
  const cleaned = String(raw)
    .replace(/\b(?:rs|inr|₹|eur|usd|\$|£|€)\b\.?\s*/gi, '')
    .replace(/\/-$/, '')
    .replace(/[^\d.,]/g, '')
    .trim();
  if (!cleaned) return null;

  // If both , and . appear, the rightmost is the decimal separator.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    if (lastDot > lastComma) {
      // Western: 1,234.56 → comma is thousands
      normalized = cleaned.replace(/,/g, '');
    } else {
      // European: 1.234,56 → dot is thousands, comma is decimal
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma > -1) {
    // Only commas. If exactly one comma followed by 1-2 digits → decimal.
    const after = cleaned.length - lastComma - 1;
    if (after <= 2 && !cleaned.slice(0, lastComma).includes(',')) {
      normalized = cleaned.replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    normalized = cleaned;
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a date found in the document to ISO YYYY-MM-DD.
 * Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, and 2-digit years.
 * Returns null if it cannot confidently parse.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // YYYY-MM-DD already
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${mm}-${dd}`;
  }

  // DD MMM YYYY  (e.g. "23 Aug 2026", "23-August-2026")
  m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-](\d{2,4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[m[2].slice(0, 3).toLowerCase()];
    if (mm) {
      const dd = m[1].padStart(2, '0');
      let yy = m[3];
      if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
      return `${yy}-${mm}-${dd}`;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Field extractors
// ────────────────────────────────────────────────────────────────────────────

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1})\b/;

/**
 * Extract the vendor/supplier name. Looks for explicit labels first, then
 * falls back to the line immediately above a GSTIN (which is typically the
 * legal name on Indian invoices).
 */
function extractVendorName(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Explicit labels: "Vendor:", "Supplier:", "Sold By:", "Bill From:", "From:"
  const labelRe = /^(?:vendor|supplier|sold\s*by|bill\s*from|from|billed\s*by|party)\s*[:\-]\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(labelRe);
    if (m && m[1].length >= 2 && m[1].length <= 80) {
      return m[1].replace(/\s+/g, ' ').trim();
    }
  }

  // 2. Line immediately above a GSTIN is usually the legal name.
  for (let i = 0; i < lines.length; i++) {
    if (GSTIN_RE.test(lines[i]) && i > 0) {
      const candidate = lines[i - 1].replace(/[*_\-]+/g, ' ').trim();
      // Filter out generic header words
      if (
        candidate.length >= 3 &&
        candidate.length <= 80 &&
        !/^(invoice|quotation|bill|tax|gst|date|page)\b/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  // 3. First non-trivial line that looks like a company name (contains a
  //    legal suffix). Conservative — only fires if no label/GSTIN found.
  const companyRe = /\b(?:pvt\.?\s*ltd\.?|private\s*limited|ltd\.?|limited|inc\.?|llp|co\.?)\b\.?$/i;
  for (const line of lines.slice(0, 10)) {
    if (line.length >= 5 && line.length <= 80 && companyRe.test(line)) {
      return line.replace(/\s+/g, ' ').trim();
    }
  }

  return null;
}

/**
 * Extract the document number (quotation/invoice/bill number).
 */
function extractDocNumber(text: string, type: OcrDocumentType): string | null {
  const labels =
    type === 'QUOTATION'
      ? ['quotation', 'quote', 'qtn', 'qt', 'offer']
      : ['invoice', 'bill', 'inv', 'receipt', 'dc'];
  // Build a single alternation of labels, case-insensitive.
  const labelAlt = labels.join('|');
  const re = new RegExp(
    `(?:${labelAlt})\\s*(?:no\\.?|number|#)?\\s*[:\\-]\\s*([A-Za-z0-9][A-Za-z0-9\\-/]{1,40})`,
    'i'
  );
  const m = text.match(re);
  if (m) return m[1];

  // Fallback: "No: XXX" near the top of the document
  const noRe = /\bno\.?\s*[:#\-]\s*([A-Za-z0-9][A-Za-z0-9\-/]{2,40})\b/i;
  const noMatch = text.slice(0, 800).match(noRe);
  return noMatch ? noMatch[1] : null;
}

/**
 * Extract a date next to a label like "Date:", "Invoice Date:", "Dated:".
 * Falls back to the first date-like token in the top 800 chars.
 */
function extractDate(text: string, label?: string): string | null {
  const dateToken = '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{2,4})';
  const labelRe = label
    ? new RegExp(`${label}\\s*(?:date)?\\s*[:\\-]?\\s*${dateToken}`, 'i')
    : new RegExp(`\\bdate\\b\\s*[:\\-]?\\s*${dateToken}`, 'i');
  const m = text.match(labelRe);
  if (m) {
    const d = normalizeDate(m[1]);
    if (d) return d;
  }
  // Generic "Date:" anywhere
  const generic = text.match(new RegExp(`\\bdate\\b\\s*[:\\-]?\\s*${dateToken}`, 'i'));
  if (generic) {
    const d = normalizeDate(generic[1]);
    if (d) return d;
  }
  // First date-like token in the first 800 chars
  const first = text.slice(0, 800).match(new RegExp(dateToken));
  return first ? normalizeDate(first[1]) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Line-item table extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Heuristics for detecting a line-items table:
 *  - Find a header row containing a "description/item" column AND a
 *    "qty/quantity" or "rate/price" column.
 *  - Parse subsequent rows until we hit a totals row ("sub total", "grand
 *    total", "total amount") or a clearly non-table line.
 *
 * Rows are split by newlines; columns within a row are split by 2+ spaces,
 * tabs, or pipe characters. Single-space splits are avoided because item
 * names contain spaces.
 */
function extractLineItems(text: string): OcrLineItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Find the header row index.
  const headerRe = /\b(?:sl\.?\s*no|s\.?\s*no|#|item|description|particulars|product|material|goods|service)\b/i;
  const qtyRe = /\b(?:qty|quantity|nos|no\.?)\b/i;
  const rateRe = /\b(?:rate|price|unit\s*price|mrp|cost)\b/i;
  const amountRe = /\b(?:amount|amt|total|value)\b/i;

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (headerRe.test(lower) && (qtyRe.test(lower) || rateRe.test(lower) || amountRe.test(lower))) {
      headerIdx = i;
      break;
    }
  }

  // No header found — try a relaxed scan: rows that look like "name ... qty rate amount"
  if (headerIdx === -1) {
    return extractLineItemsRelaxed(lines);
  }

  // Determine column positions from the header row.
  const headerCols = splitColumns(lines[headerIdx]);
  const colIndex = identifyColumns(headerCols);

  const items: OcrLineItem[] = [];
  const stopRe = /^\s*(?:sub\s*total|subtotal|grand\s*total|total\s*amount|total|round\s*off|rounding\s*off|cgst|sgst|igst|tax|gst\s*total|amount\s*payable|amount\s*due|balance\s*due|net\s*amount|net\s*total)\b/i;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length < 3) continue;
    if (stopRe.test(line)) break;

    const cols = splitColumns(line);
    if (cols.length < 2) continue;

    const item = buildItemFromColumns(cols, colIndex);
    if (item && item.materialName.length >= 2) {
      items.push(item);
    }
  }

  return items;
}

interface ColumnIndex {
  name: number;      // index of description column
  qty: number;       // -1 if not found
  rate: number;      // -1 if not found
  amount: number;    // -1 if not found
  unit: number;      // -1 if not found
}

function identifyColumns(headerCols: string[]): ColumnIndex {
  const idx: ColumnIndex = { name: -1, qty: -1, rate: -1, amount: -1, unit: -1 };
  headerCols.forEach((h, i) => {
    const lower = h.toLowerCase();
    if (idx.name === -1 && /\b(?:item|description|particulars|product|material|goods|service|name|details)\b/.test(lower)) {
      idx.name = i;
    } else if (idx.qty === -1 && /\b(?:qty|quantity|nos)\b/.test(lower)) {
      idx.qty = i;
    } else if (idx.rate === -1 && /\b(?:rate|price|unit\s*price|mrp|cost)\b/.test(lower)) {
      idx.rate = i;
    } else if (idx.amount === -1 && /\b(?:amount|amt|value)\b/.test(lower)) {
      idx.amount = i;
    } else if (idx.unit === -1 && /\b(?:unit|uom|per)\b/.test(lower)) {
      idx.unit = i;
    }
  });

  // If no description column was labelled, assume it's the first column.
  if (idx.name === -1) idx.name = 0;
  return idx;
}

/**
 * Split a row into columns. Tries pipe first, then 2+ spaces / tabs.
 * Single-space-separated text (like "Cement Bags") stays in one column.
 */
function splitColumns(line: string): string[] {
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  }
  // 2+ spaces or a tab
  const cols = line.split(/\t|\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);
  return cols;
}

function buildItemFromColumns(cols: string[], idx: ColumnIndex): OcrLineItem | null {
  if (idx.name >= cols.length) return null;
  const materialName = cols[idx.name].replace(/^\d+[.)]\s*/, '').trim();
  if (!materialName || /^\d+$/.test(materialName)) return null;

  const quantity = idx.qty >= 0 && idx.qty < cols.length ? parseAmount(cols[idx.qty]) : null;
  const unitPrice = idx.rate >= 0 && idx.rate < cols.length ? parseAmount(cols[idx.rate]) : null;
  const amount = idx.amount >= 0 && idx.amount < cols.length ? parseAmount(cols[idx.amount]) : null;
  const unit = idx.unit >= 0 && idx.unit < cols.length ? cols[idx.unit].trim() : undefined;

  // Reject rows where the "name" column is actually a number (misaligned).
  if (/^\d+(\.\d+)?$/.test(materialName)) return null;

  // If all three numeric columns are available, validate their relationship.
  // This prevents a column-shifted OCR row from being accepted by the local
  // fallback. Layout-aware Gemini remains responsible for unusual tables.
  if (quantity != null && unitPrice != null && amount != null && quantity > 0 && unitPrice > 0 && amount > 0) {
    const expected = quantity * unitPrice;
    const difference = Math.abs(expected - amount);
    if (difference > Math.max(1, expected * 0.25)) return null;
  }

  return {
    materialName,
    quantity: quantity ?? 0,
    unitPrice: unitPrice ?? 0,
    unit: unit && unit.length <= 10 ? unit : undefined,
  };
}

/**
 * Relaxed extraction when no header row is detected. Scans for lines that look
 * like "name ... qty rate amount" where the last 2-3 tokens are numbers.
 * Conservative: requires at least 2 trailing numbers to count as a line item.
 */
function extractLineItemsRelaxed(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  const stopRe = /^\s*(?:sub\s*total|subtotal|grand\s*total|total\s*amount|total|round\s*off|cgst|sgst|igst|tax|gst|amount\s*payable|amount\s*due|net\s*amount|net\s*total|bank|payment|terms|conditions|for\s+|thank)\b/i;
  const numberToken = /^\d[\d,]*\.?\d*$/;

  for (const line of lines) {
    if (line.trim().length < 5) continue;
    if (stopRe.test(line)) continue;

    const cols = splitColumns(line);
    if (cols.length < 3) continue;

    // Last column must be a number (amount), second-last a number (rate or qty)
    const last = cols[cols.length - 1];
    const secondLast = cols[cols.length - 2];
    if (!numberToken.test(last.replace(/[^\d.,]/g, ''))) continue;
    if (!numberToken.test(secondLast.replace(/[^\d.,]/g, ''))) continue;

    // Name = everything except the trailing numbers
    const nameCols = cols.slice(0, cols.length - 2);
    const materialName = nameCols.join(' ').replace(/^\d+[.)]\s*/, '').trim();
    if (materialName.length < 2) continue;
    if (/^\d+(\.\d+)?$/.test(materialName)) continue;

    // If there are 3 trailing numbers, treat them as qty, rate, amount
    let quantity = 0;
    let unitPrice = 0;
    if (cols.length >= 4 && numberToken.test(cols[cols.length - 3].replace(/[^\d.,]/g, ''))) {
      quantity = parseAmount(cols[cols.length - 3]) ?? 0;
      unitPrice = parseAmount(secondLast) ?? 0;
    } else {
      // Only 2 trailing numbers — assume rate + amount; qty unknown
      unitPrice = parseAmount(secondLast) ?? 0;
    }

    items.push({ materialName, quantity, unitPrice });
  }

  return items;
}

// ────────────────────────────────────────────────────────────────────────────
// Totals extraction
// ────────────────────────────────────────────────────────────────────────────

function extractLabeledAmount(text: string, labels: string[]): number | null {
  for (const label of labels) {
    // The (?:\d+\s*%\s*)? part skips percentage expressions like "GST 18%:"
    // so we don't capture the rate (18) instead of the actual amount (6,975).
    const re = new RegExp(
      `\\b${label}\\s*(?:\\d+\\s*%\\s*)?[:\\-]?\\s*(?:rs\\.?|₹|inr)?\\s*([\\d,]+(?:\\.\\d+)?)`,
      'i'
    );
    const m = text.match(re);
    if (m) {
      const amt = parseAmount(m[1]);
      if (amt != null) return amt;
    }
  }
  return null;
}

function extractTotals(text: string): {
  gstAmount: number | null;
  totalAmount: number | null;
  grandTotal: number | null;
} {
  // GST: sum of CGST + SGST, or IGST, or a single "GST" line
  let gst: number | null = null;
  const cgst = extractLabeledAmount(text, ['cgst']);
  const sgst = extractLabeledAmount(text, ['sgst']);
  const igst = extractLabeledAmount(text, ['igst']);
  if (cgst != null && sgst != null) {
    gst = cgst + sgst;
  } else if (igst != null) {
    gst = igst;
  } else {
    gst = extractLabeledAmount(text, ['gst', 'tax', 'total\\s*gst']);
  }

  const totalAmount = extractLabeledAmount(text, [
    'sub\\s*total',
    'subtotal',
    'total\\s*(?:before|excl)',
    'taxable\\s*(?:value|amount)',
    'total',
  ]);

  const grandTotal = extractLabeledAmount(text, [
    'grand\\s*total',
    'total\\s*amount',
    'invoice\\s*total',
    'net\\s*payable',
    'amount\\s*payable',
    'total\\s*payable',
  ]);

  return { gstAmount: gst, totalAmount, grandTotal };
}

// ────────────────────────────────────────────────────────────────────────────
// Confidence scoring
// ────────────────────────────────────────────────────────────────────────────

export interface ParseConfidence {
  /** True if the regex parse is good enough to skip the LLM fallback. */
  ok: boolean;
  /** Human-readable reason for low confidence (for logging). */
  reason: string;
}

/**
 * Decide whether the regex parse is good enough to return without calling
 * the Gemini fallback. Conservative: any of these failing triggers fallback.
 */
export function assessConfidence(
  result: OcrResult,
  type: OcrDocumentType
): ParseConfidence {
  if (type === 'QUOTATION') {
    const r = result as OcrQuotationResult;
    if (r.lineItems.length < 1) {
      return { ok: false, reason: 'no line items extracted' };
    }
    const hasVendor = !!r.vendorName;
    const hasNumber = !!r.quotationNumber;
    const hasTotal = r.grandTotal != null || r.totalAmount != null;
    // Need at least 2 of {vendor, doc number, total} to trust the parse.
    const score = [hasVendor, hasNumber, hasTotal].filter(Boolean).length;
    if (score < 2) {
      return { ok: false, reason: `low coverage (vendor=${hasVendor}, number=${hasNumber}, total=${hasTotal})` };
    }
    return { ok: true, reason: 'ok' };
  }

  const r = result as OcrInvoiceResult;
  const hasVendor = !!r.vendorName;
  const hasNumber = !!r.invoiceNumber;
  const hasTotal = r.totalAmount != null || r.amount != null;
  const score = [hasVendor, hasNumber, hasTotal].filter(Boolean).length;
  if (score < 2) {
    return { ok: false, reason: `low coverage (vendor=${hasVendor}, number=${hasNumber}, total=${hasTotal})` };
  }
  return { ok: true, reason: 'ok' };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse raw document text into structured fields using regex rules.
 * Returns null for any field it cannot confidently extract — the caller
 * (ocr.service.ts) decides whether to invoke the LLM fallback.
 */
export function parseDocumentText(
  text: string,
  documentType: OcrDocumentType
): OcrResult {
  const vendorName = extractVendorName(text);
  const docNumber = extractDocNumber(text, documentType);
  const date = extractDate(text);
  const lineItems = extractLineItems(text);
  const totals = extractTotals(text);

  if (documentType === 'QUOTATION') {
    return {
      vendorName,
      quotationNumber: docNumber,
      date,
      lineItems,
      gstAmount: totals.gstAmount,
      totalAmount: totals.totalAmount,
      grandTotal: totals.grandTotal,
    } as OcrQuotationResult;
  }

  // For invoices, "amount" is the pre-tax/subtotal; "totalAmount" is grand total.
  return {
    vendorName,
    invoiceNumber: docNumber,
    date,
    amount: totals.totalAmount,
    taxAmount: totals.gstAmount,
    totalAmount: totals.grandTotal ?? totals.totalAmount,
    deliveryDate: extractDate(text, 'delivery'),
  } as OcrInvoiceResult;
}
