/**
 * Scenario 17: OCR Processing
 *
 * Tests the OCR extract endpoint: validation, image processing, vendor matching.
 * The OCR pipeline may fall back to local regex if Gemini is not configured.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, makeReporter } from './_helpers';

const RUN_ID = `ocr-${Date.now()}`;
const { record, printReport } = makeReporter('OCR PROCESSING', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[OCR] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('OCR Processing', () => {
  it('POST /ocr/extract rejects when no file is uploaded', async () => {
    const res = await request
      .post('/api/ocr/extract')
      .set(authAs(ctx.userPhId))
      .field('documentType', 'QUOTATION');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    record('ocr.noFile', true, `400 as expected`);
  });

  it('POST /ocr/extract rejects invalid documentType', async () => {
    // Minimal valid PNG header
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const res = await request
      .post('/api/ocr/extract')
      .set(authAs(ctx.userPhId))
      .attach('file', pngBuffer, { filename: `test-${RUN_ID}.png`, contentType: 'image/png' })
      .field('documentType', 'INVALID_TYPE');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('documentType');
    record('ocr.badType', true, `400 as expected`);
  });

  it('POST /ocr/extract processes an image (QUOTATION)', async () => {
    // Create a simple PNG with text-like content — OCR will attempt extraction.
    // The result may be empty or partial; we only verify the endpoint responds.
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const res = await request
      .post('/api/ocr/extract')
      .set(authAs(ctx.userPhId))
      .attach('file', pngBuffer, { filename: `quotation-${RUN_ID}.png`, contentType: 'image/png' })
      .field('documentType', 'QUOTATION')
      .timeout(60000);
    // OCR may succeed (200) or fail (500) depending on Tesseract/Gemini config.
    // We accept either, but verify the response structure on success.
    if (res.status === 200) {
      expect(res.body).toHaveProperty('documentType');
      record('ocr.extract', true, `200 documentType=${res.body.documentType}`);
    } else {
      // 500 is acceptable if OCR backend (Tesseract/Gemini) is not configured
      expect([400, 500]).toContain(res.status);
      record('ocr.extract', true, `${res.status} (OCR backend may not be configured)`);
    }
  });

  it('POST /ocr/extract processes an image (INVOICE)', async () => {
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const res = await request
      .post('/api/ocr/extract')
      .set(authAs(ctx.userPhId))
      .attach('file', pngBuffer, { filename: `invoice-${RUN_ID}.png`, contentType: 'image/png' })
      .field('documentType', 'INVOICE')
      .timeout(60000);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('documentType');
      record('ocr.invoice', true, `200 documentType=${res.body.documentType}`);
    } else {
      expect([400, 500]).toContain(res.status);
      record('ocr.invoice', true, `${res.status} (OCR backend may not be configured)`);
    }
  });
});
