/**
 * Unit tests for the local regex/rule-based document parser (ocr-parser.ts).
 *
 * These tests do NOT touch the network or any LLM — they verify that
 * parseDocumentText correctly extracts fields from raw text that would
 * come from pdfjs-dist (digital PDFs) or Tesseract.js (images/scanned PDFs).
 *
 * The parser is intentionally conservative: it returns null rather than
 * guess wrong. Tests cover both well-structured and messy inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDocumentText,
  parseAmount,
  normalizeDate,
  assessConfidence,
} from '../src/services/ocr-parser';

// ────────────────────────────────────────────────────────────────────────────
// Number parsing
// ────────────────────────────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('parses plain integers', () => {
    expect(parseAmount('1000')).toBe(1000);
  });

  it('parses Western thousand separators (comma)', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
  });

  it('parses Indian grouping (12,34,567.00)', () => {
    expect(parseAmount('12,34,567.00')).toBe(1234567);
  });

  it('parses European format (1.234,50)', () => {
    expect(parseAmount('1.234,50')).toBe(1234.5);
  });

  it('strips currency symbols and words', () => {
    expect(parseAmount('Rs. 1,000')).toBe(1000);
    expect(parseAmount('₹ 1,000/-')).toBe(1000);
    expect(parseAmount('INR 5,000.00')).toBe(5000);
  });

  it('treats a single comma with 1-2 trailing digits as decimal', () => {
    expect(parseAmount('100,50')).toBe(100.5);
  });

  it('returns null for empty / non-numeric input', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Date parsing
// ────────────────────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('normalizes DD/MM/YYYY', () => {
    expect(normalizeDate('23/08/2026')).toBe('2026-08-23');
  });

  it('normalizes DD-MM-YYYY', () => {
    expect(normalizeDate('23-08-2026')).toBe('2026-08-23');
  });

  it('normalizes DD.MM.YYYY', () => {
    expect(normalizeDate('23.08.2026')).toBe('2026-08-23');
  });

  it('normalizes YYYY-MM-DD (passthrough)', () => {
    expect(normalizeDate('2026-08-23')).toBe('2026-08-23');
  });

  it('normalizes 2-digit years (assumes 20xx for <=50)', () => {
    expect(normalizeDate('23/08/26')).toBe('2026-08-23');
  });

  it('normalizes 2-digit years (assumes 19xx for >50)', () => {
    expect(normalizeDate('23/08/99')).toBe('1999-08-23');
  });

  it('normalizes "DD MMM YYYY" format', () => {
    expect(normalizeDate('23 Aug 2026')).toBe('2026-08-23');
    expect(normalizeDate('23-August-2026')).toBe('2026-08-23');
  });

  it('pads single-digit day/month', () => {
    expect(normalizeDate('5/3/2026')).toBe('2026-03-05');
  });

  it('returns null for unparseable input', () => {
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('not a date')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Quotation parsing — well-structured digital PDF text
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_QUOTATION = `
ABC Cement Pvt Ltd
GSTIN: 27ABCDE1234F1Z5

Quotation No: QT-2026-001
Date: 23/08/2026

Sl No  Description            Qty  Unit  Rate     Amount
1      Cement OPC 53 Grade    100  BAG   350.00   35,000.00
2      Sand River Washed      50   CFT   45.00    2,250.00
3      Steel TMT Bars 12mm    20   KG    75.00    1,500.00

Sub Total:                      38,750.00
GST 18%:                        6,975.00
Grand Total:                    45,725.00
`;

describe('parseDocumentText — quotation (well-structured)', () => {
  const result = parseDocumentText(SAMPLE_QUOTATION, 'QUOTATION');

  it('extracts vendor name from the line above GSTIN', () => {
    expect(result.vendorName).toBe('ABC Cement Pvt Ltd');
  });

  it('extracts the quotation number', () => {
    expect((result as any).quotationNumber).toBe('QT-2026-001');
  });

  it('extracts and normalizes the date', () => {
    expect((result as any).date).toBe('2026-08-23');
  });

  it('extracts all 3 line items with qty, rate, unit', () => {
    const items = (result as any).lineItems;
    expect(items).toHaveLength(3);
    expect(items[0].materialName).toContain('Cement OPC 53 Grade');
    expect(items[0].quantity).toBe(100);
    expect(items[0].unitPrice).toBe(350);
    expect(items[0].unit).toBe('BAG');
    expect(items[2].materialName).toContain('Steel TMT Bars 12mm');
    expect(items[2].quantity).toBe(20);
  });

  it('extracts GST, sub total, and grand total', () => {
    expect((result as any).gstAmount).toBe(6975);
    expect((result as any).totalAmount).toBe(38750);
    expect((result as any).grandTotal).toBe(45725);
  });

  it('passes the confidence check', () => {
    expect(assessConfidence(result, 'QUOTATION').ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Invoice parsing — Indian GST format with CGST+SGST split
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_INVOICE = `
XYZ Steel Industries Ltd
GSTIN: 29WXYZ5678A1ZP

Invoice No: INV-2026-045
Invoice Date: 15/08/2026
Delivery Date: 18/08/2026

Description              Qty   Rate      Amount
TMT Steel Bar 16mm       500   78.00     39,000.00
MS Angle 50x50           120   95.00     11,400.00

Sub Total:                       50,400.00
CGST 9%:                          4,536.00
SGST 9%:                          4,536.00
Grand Total:                     59,472.00
`;

describe('parseDocumentText — invoice (GST format)', () => {
  const result = parseDocumentText(SAMPLE_INVOICE, 'INVOICE');

  it('extracts vendor name', () => {
    expect(result.vendorName).toBe('XYZ Steel Industries Ltd');
  });

  it('extracts invoice number', () => {
    expect((result as any).invoiceNumber).toBe('INV-2026-045');
  });

  it('extracts invoice date', () => {
    expect((result as any).date).toBe('2026-08-15');
  });

  it('extracts delivery date', () => {
    expect((result as any).deliveryDate).toBe('2026-08-18');
  });

  it('sums CGST + SGST into taxAmount', () => {
    expect((result as any).taxAmount).toBe(9072);
  });

  it('extracts grand total', () => {
    expect((result as any).totalAmount).toBe(59472);
  });

  // Note: invoices do not extract line items — only summary fields (amount,
  // tax, total). This matches the original Groq-based INVOICE_PROMPT schema.
  // Line-item extraction is only done for QUOTATION documents.

  it('passes the confidence check', () => {
    expect(assessConfidence(result, 'INVOICE').ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases — should return nulls (triggering Gemini fallback)
// ────────────────────────────────────────────────────────────────────────────

describe('parseDocumentText — edge cases', () => {
  it('returns nulls for unstructured text', () => {
    const result = parseDocumentText('Hello world, this is just some random text.', 'QUOTATION');
    expect(result.vendorName).toBeNull();
    expect((result as any).quotationNumber).toBeNull();
    expect((result as any).lineItems).toHaveLength(0);
  });

  it('fails confidence on empty/garbage input (triggers fallback)', () => {
    const result = parseDocumentText('', 'QUOTATION');
    expect(assessConfidence(result, 'QUOTATION').ok).toBe(false);
  });

  it('fails confidence when only vendor is found (no items, no total)', () => {
    const text = 'ABC Cement Pvt Ltd\nGSTIN: 27ABCDE1234F1Z5';
    const result = parseDocumentText(text, 'QUOTATION');
    expect(assessConfidence(result, 'QUOTATION').ok).toBe(false);
  });

  it('handles pipe-separated columns', () => {
    const text = `
Vendor: Test Vendor
Quotation No: Q-99

Item | Qty | Rate | Amount
Cement | 10 | 50 | 500
Sand | 5 | 20 | 100

Grand Total: 600
`;
    const result = parseDocumentText(text, 'QUOTATION');
    const items = (result as any).lineItems;
    expect(items).toHaveLength(2);
    expect(items[0].materialName).toBe('Cement');
    expect(items[0].quantity).toBe(10);
    expect(items[0].unitPrice).toBe(50);
  });

  it('stops line-item extraction at "Sub Total"', () => {
    const text = `
Sl No  Description      Qty  Rate   Amount
1      Item A           2    10     20
2      Item B           3    15     45
Sub Total                      65
Grand Total                    65
`;
    const result = parseDocumentText(text, 'QUOTATION');
    expect((result as any).lineItems).toHaveLength(2);
  });

  it('parses the nine-row construction quote layout without shifting columns', () => {
    const text = `
Construction Quote
Company Name: Bengaluru HSR
Quotation No: CQ-2024-01
Date: 05/13/2024

Description of Work  Unit  Quantity  Rate per Unit  Total Cost
Structural Steel     kg    1500      55             82500
Electrical Wiring    meters 200      100            20000
Plastering Work      sq. ft. 500     50             25000
Skilled Labor        hours 100       300            30000
work 1               Nos   245       260            63700
Work 2               Nos   124       280            34720
Work 3               Nos   245       850            208250
Work 4               Nos   654       546            357084
Work 5               Nos   345       256            88320
Total                                      909574
`;
    const result = parseDocumentText(text, 'QUOTATION') as any;

    expect(result.lineItems).toHaveLength(9);
    expect(result.lineItems[0]).toMatchObject({
      materialName: 'Structural Steel',
      quantity: 1500,
      unitPrice: 55,
    });
    expect(result.lineItems[6]).toMatchObject({
      materialName: 'Work 3',
      quantity: 245,
      unitPrice: 850,
    });
    expect(result.lineItems[8]).toMatchObject({
      materialName: 'Work 5',
      quantity: 345,
      unitPrice: 256,
    });
  });
});
