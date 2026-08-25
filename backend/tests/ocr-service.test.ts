/**
 * OCR Service Tests
 * =================
 *
 * The OCR service extracts structured data from uploaded quotation and invoice
 * documents (images or PDFs) using the Groq vision model. This powers the
 * "Scan quotation" and "Scan invoice" auto-fill buttons in the frontend —
 * a supervisor photographs a vendor's paper quotation, and the app fills in
 * the line items, amounts, and vendor name automatically.
 *
 * These tests mock the Groq API (via global.fetch) so they run without an API
 * key or network access. They verify:
 *  - Unsupported file types are rejected with a helpful message
 *  - Missing API key produces a clear error (not a cryptic fetch failure)
 *  - Quotation and invoice JSON responses are parsed into the correct shapes
 *  - Markdown code fences in the model's response are stripped before parsing
 *  - Null/missing fields are coerced gracefully (the model returns null when
 *    it can't read a field — we must not crash on that)
 *  - Non-OK API responses (rate limits, server errors) surface the status code
 *  - Corrupt PDFs produce a friendly "try uploading a photo" message
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import sharp from 'sharp';

// Mock env so callGroq believes GROQ_API_KEY is configured.
vi.mock('../src/config/env', () => ({
  env: {
    GROQ_API_KEY: 'test-groq-key',
    STORAGE_MODE: 'local',
    LOCAL_STORAGE_PATH: './test-uploads',
  },
}));

import { extractFromFile, OcrQuotationResult, OcrInvoiceResult } from '../src/services/ocr.service';

// Build a real 1x1 PNG so sharp's image-processing branch is exercised.
// We use a real image (not a mock) because the service runs the buffer through
// sharp to compress/convert it before sending to Groq.
async function onePixelPng(): Promise<Buffer> {
  return sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe('OCR Service — extractFromFile', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    // Restore the real fetch and clear all mocks between tests.
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects unsupported file types with a message telling the user what IS accepted', async () => {
    // Users sometimes upload Word docs or Excel files by mistake. The error
    // message should tell them to upload an image or PDF instead of just
    // saying "error".
    await expect(
      extractFromFile(Buffer.from('x'), 'text/plain', 'QUOTATION')
    ).rejects.toThrow('Unsupported file type');
  });

  it('throws a clear "GROQ_API_KEY is not configured" error when the key is missing', async () => {
    // Without this check, the service would call fetch() with an undefined
    // Authorization header and get a confusing 401 from Groq. This gives
    // the operator a clear action item instead.
    const envMod = await import('../src/config/env');
    const original = envMod.env.GROQ_API_KEY;
    (envMod.env as any).GROQ_API_KEY = undefined;

    const png = await onePixelPng();
    await expect(
      extractFromFile(png, 'image/png', 'QUOTATION')
    ).rejects.toThrow('GROQ_API_KEY is not configured');

    (envMod.env as any).GROQ_API_KEY = original;
  });

  it('parses a quotation JSON response and maps line items correctly', async () => {
    // The happy path: the model returns a clean JSON object with vendor name,
    // quotation number, line items, and amounts. We verify each field is
    // mapped to the correct property in OcrQuotationResult.
    const groqResponse = {
      vendorName: 'Acme Cement',
      quotationNumber: 'Q-100',
      date: '2026-08-23',
      lineItems: [
        { materialName: 'Cement', quantity: 10, unitPrice: 50, unit: 'BAG' },
        { materialName: 'Sand', quantity: 5, unitPrice: 20 },
      ],
      gstAmount: 70,
      totalAmount: 600,
      grandTotal: 670,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(groqResponse) } }],
      }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;

    expect(result.vendorName).toBe('Acme Cement');
    expect(result.quotationNumber).toBe('Q-100');
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[0]).toEqual({
      materialName: 'Cement',
      quantity: 10,
      unitPrice: 50,
      unit: 'BAG',
    });
    expect(result.gstAmount).toBe(70);
    expect(result.grandTotal).toBe(670);
  });

  it('parses an invoice JSON response and maps all fields correctly', async () => {
    // Same as above but for invoices — the fields are different (invoiceNumber,
    // amount, taxAmount, deliveryDate instead of lineItems).
    const groqResponse = {
      vendorName: 'Acme Cement',
      invoiceNumber: 'INV-2026-001',
      date: '2026-08-23',
      amount: 1000,
      taxAmount: 180,
      totalAmount: 1180,
      deliveryDate: '2026-08-25',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(groqResponse) } }],
      }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'INVOICE')) as OcrInvoiceResult;

    expect(result.vendorName).toBe('Acme Cement');
    expect(result.invoiceNumber).toBe('INV-2026-001');
    expect(result.amount).toBe(1000);
    expect(result.taxAmount).toBe(180);
    expect(result.totalAmount).toBe(1180);
    expect(result.deliveryDate).toBe('2026-08-25');
  });

  it('strips markdown code fences from the model response before parsing JSON', async () => {
    // LLMs sometimes wrap their JSON output in ```json ... ``` fences even
    // when asked not to. The parseJsonResponse function strips these so we
    // don't get a JSON parse error.
    const groqResponse = {
      vendorName: 'Fenced Vendor',
      invoiceNumber: 'INV-1',
      date: null,
      amount: 100,
      taxAmount: null,
      totalAmount: 100,
      deliveryDate: null,
    };
    const fenced = '```json\n' + JSON.stringify(groqResponse) + '\n```';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: fenced } }] }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'INVOICE')) as OcrInvoiceResult;
    expect(result.vendorName).toBe('Fenced Vendor');
    expect(result.amount).toBe(100);
  });

  it('coerces missing/null numeric fields to null and defaults line item numbers to 0', async () => {
    // The model returns null when it can't read a field (e.g. the total is
    // smudged on the paper). We must not crash — we return null so the
    // frontend can show "could not read" and let the user fill it in.
    // For line items, missing quantity/unitPrice default to 0 (not null)
    // because the frontend form expects numbers.
    const groqResponse = {
      vendorName: null,
      quotationNumber: null,
      date: null,
      lineItems: [{ materialName: 'Only name' }],
      gstAmount: null,
      totalAmount: null,
      grandTotal: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(groqResponse) } }],
      }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;

    expect(result.vendorName).toBeNull();
    expect(result.gstAmount).toBeNull();
    expect(result.grandTotal).toBeNull();
    expect(result.lineItems[0].quantity).toBe(0);
    expect(result.lineItems[0].unitPrice).toBe(0);
    expect(result.lineItems[0].unit).toBeUndefined();
  });

  it('surfaces the HTTP status code when the Groq API returns a non-OK response', async () => {
    // A 429 (rate limit) or 500 (server error) should produce an error that
    // includes the status code so the operator can diagnose the issue.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    await expect(extractFromFile(png, 'image/png', 'QUOTATION')).rejects.toThrow(
      'Groq API error 429'
    );
  });

  it('produces a friendly "Failed to read PDF" message for a corrupt PDF buffer', async () => {
    // A user might rename a .jpg to .pdf, or upload a corrupted PDF. The
    // pdfjs library will fail to parse it. We catch that and tell the user
    // to upload a photo/screenshot instead — which always works.
    const corruptPdf = Buffer.from('not a real pdf');
    await expect(
      extractFromFile(corruptPdf, 'application/pdf', 'QUOTATION')
    ).rejects.toThrow('Failed to read PDF');
  });
});
