import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/config/env', () => ({ env: { OPENAI_API_KEY: 'test-key' } }));

import { normalizeReading, readDocument, readingForModel } from '../src/services/assistant/reader';

afterEach(() => vi.unstubAllGlobals());

describe('document reader', () => {
  it('cleans numbers, dates, GSTIN and drops empty lines', () => {
    const r = normalizeReading({
      documentType: 'tax_invoice',
      legibility: 3,
      vendor: { name: '  ABC Traders ', gstNumber: '36 abcde1234f1z5' },
      documentDate: '05/10/2026',
      lines: [{ name: 'Cement', quantity: '50', rate: '₹ 1,380.50' }, { name: '', quantity: 1 }],
      total: '22,420',
      paymentMode: 'BITCOIN',
      unreadable: ['rate on line 3', 7],
    });
    expect(r.legibility).toBe(1);
    expect(r.vendor.name).toBe('ABC Traders');
    expect(r.vendor.gstNumber).toBe('36ABCDE1234F1Z5');
    expect(r.documentDate).toBeNull();
    expect(r.lines).toEqual([{ name: 'Cement', quantity: 50, unit: null, rate: 1380.5, gstRate: null, amount: null }]);
    expect(r.total).toBe(22420);
    expect(r.paymentMode).toBeNull();
    expect(r.unreadable).toEqual(['rate on line 3']);
  });

  it('falls back to "other" for an unknown document type', () => {
    expect(normalizeReading({ documentType: 'spaceship' }).documentType).toBe('other');
  });

  it('readingForModel leaves out empty fields', () => {
    const text = readingForModel(normalizeReading({ documentType: 'shop_bill', total: 300 }));
    expect(text).toContain('"total":300');
    expect(text).not.toContain('null');
    expect(text).not.toContain('"lines"');
  });

  it('sends one strict-schema vision request with every page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ documentType: 'delivery_challan', lines: [{ name: 'Sand', quantity: 2, unit: 'ton' }] }) } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await readDocument(
      [
        { mimeType: 'image/jpeg', data: 'AAAA' },
        { mimeType: 'application/pdf', data: 'BBBB' },
      ],
      'a delivery challan',
    );

    expect(out.documentType).toBe('delivery_challan');
    expect(out.lines[0]).toMatchObject({ name: 'Sand', quantity: 2, unit: 'ton' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5-mini');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].content).toContain('a delivery challan');
    const parts = body.messages[1].content;
    expect(parts.some((p: { type: string }) => p.type === 'image_url')).toBe(true);
    expect(parts.some((p: { type: string }) => p.type === 'file')).toBe(true);
  });

  it('retries once in plain JSON mode when the strict request is refused', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Invalid schema' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Here: {"documentType":"shop_bill","total":250}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const out = await readDocument([{ mimeType: 'image/jpeg', data: 'AAAA' }]);

    expect(out).toMatchObject({ documentType: 'shop_bill', total: 250 });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.response_format).toEqual({ type: 'json_object' });
    expect(second.messages[0].content).toContain('JSON schema');
  });

  it('reports the provider being out of credit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'insufficient_quota' }));
    await expect(readDocument([{ mimeType: 'image/png', data: 'AAAA' }])).rejects.toThrow(/run out of credit/);
  });
});
