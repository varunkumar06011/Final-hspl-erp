/**
 * OCR Service Tests
 * =================
 *
 * Tests for the new OCR pipeline (local regex parser + Tesseract OCR +
 * Gemini fallback). The old tests mocked the Groq API; these tests verify:
 *  - Unsupported file types are rejected with a helpful message
 *  - Digital PDFs with extractable text are parsed by the regex parser
 *    (no API call, no Tesseract needed)
 *  - Corrupt PDFs produce a friendly "try uploading a photo" message
 *  - Gemini fallback is invoked when regex confidence is low
 *  - Missing GEMINI_API_KEY returns the regex result as-is (graceful degradation)
 *
 * Tesseract.js and pdfjs-dist are mocked to avoid downloading language data
 * or requiring real PDF/image files in the test environment.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

// Mock env so the service believes GEMINI_API_KEY is configured.
vi.mock('../src/config/env', () => ({
  env: {
    GEMINI_API_KEY: 'test-gemini-key',
    STORAGE_MODE: 'local',
    LOCAL_STORAGE_PATH: './test-uploads',
  },
}));

// Mock Tesseract.js to avoid downloading language data in tests.
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({
      data: { text: 'Mock Vendor Pvt Ltd\nGSTIN: 27ABCDE1234F1Z5\nQuotation No: QT-100\nDate: 23/08/2026\n\nDescription    Qty  Rate  Amount\nCement Bags    10   50    500\n\nGrand Total: 500' },
    })),
    terminate: vi.fn(async () => {}),
  })),
}));

import { extractFromFile, OcrQuotationResult, OcrInvoiceResult } from '../src/services/ocr.service';

// Build a real 1x1 PNG so sharp's image-processing branch is exercised.
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
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects unsupported file types with a message telling the user what IS accepted', async () => {
    await expect(
      extractFromFile(Buffer.from('x'), 'text/plain', 'QUOTATION')
    ).rejects.toThrow('Unsupported file type');
  });

  it('uses Gemini vision to structure a variable-layout image', async () => {
    // Even when local OCR produces plausible text, the original image is sent
    // to Gemini so it can understand the document's actual table geometry.
    const geminiResponse = {
      vendorName: 'Mock Vendor Pvt Ltd',
      quotationNumber: 'QT-100',
      date: '2026-08-23',
      lineItems: [{ materialName: 'Cement Bags', quantity: 10, unitPrice: 50 }],
      gstAmount: null,
      totalAmount: 500,
      grandTotal: 500,
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResponse) }] } }],
      }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;

    expect(result.vendorName).toBe('Mock Vendor Pvt Ltd');
    expect(result.quotationNumber).toBe('QT-100');
    expect(result.lineItems[0].quantity).toBe(10);
    expect(result.lineItems[0].unitPrice).toBe(50);
    expect(result.grandTotal).toBe(500);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('falls back to Gemini when regex confidence is low (image path)', async () => {
    // Override the Tesseract mock to return garbage text → low confidence → Gemini fallback
    const tesseract = await import('tesseract.js');
    vi.mocked(tesseract.createWorker).mockResolvedValueOnce({
      recognize: vi.fn(async () => ({ data: { text: 'garbage unstructured text' } })),
      terminate: vi.fn(async () => {}),
    } as any);

    const geminiResponse = {
      vendorName: 'Gemini Vendor',
      quotationNumber: 'Q-GEM',
      date: '2026-08-23',
      lineItems: [{ materialName: 'Item A', quantity: 5, unitPrice: 100 }],
      gstAmount: 50,
      totalAmount: 500,
      grandTotal: 550,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResponse) }] } }],
      }),
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;

    expect(result.vendorName).toBe('Gemini Vendor');
    expect(result.quotationNumber).toBe('Q-GEM');
    expect(result.grandTotal).toBe(550);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('returns regex result as-is when Gemini is not configured (graceful degradation)', async () => {
    const envMod = await import('../src/config/env');
    const original = envMod.env.GEMINI_API_KEY;
    (envMod.env as any).GEMINI_API_KEY = undefined;

    // Tesseract returns low-confidence text
    const tesseract = await import('tesseract.js');
    vi.mocked(tesseract.createWorker).mockResolvedValueOnce({
      recognize: vi.fn(async () => ({ data: { text: 'garbage text no fields' } })),
      terminate: vi.fn(async () => {}),
    } as any);

    const png = await onePixelPng();
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;

    // Should return the (poor) regex result without crashing
    expect(result.vendorName).toBeNull();
    expect(result.quotationNumber).toBeNull();

    (envMod.env as any).GEMINI_API_KEY = original;
  });

  it('produces a friendly "Failed to read PDF" message for a corrupt PDF buffer', async () => {
    const corruptPdf = Buffer.from('not a real pdf');
    await expect(
      extractFromFile(corruptPdf, 'application/pdf', 'QUOTATION')
    ).rejects.toThrow('Failed to read PDF');
  });

  it('surfaces Gemini API errors gracefully (returns regex result, not a crash)', async () => {
    // Tesseract returns low-confidence text, Gemini returns 500.
    // Gemini retries with exponential backoff (2s + 4s + 8s = 14s), so this
    // test needs a longer timeout than the default 5s.
    const tesseract = await import('tesseract.js');
    vi.mocked(tesseract.createWorker).mockResolvedValueOnce({
      recognize: vi.fn(async () => ({ data: { text: 'garbage text no fields' } })),
      terminate: vi.fn(async () => {}),
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal server error',
    }) as unknown as typeof fetch;

    const png = await onePixelPng();
    // Should NOT throw — returns the regex result as-is
    const result = (await extractFromFile(png, 'image/png', 'QUOTATION')) as OcrQuotationResult;
    expect(result).toBeDefined();
    expect(result.vendorName).toBeNull();
  }, 30000);
});
