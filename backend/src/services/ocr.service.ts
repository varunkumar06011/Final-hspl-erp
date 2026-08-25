import { env } from '../config/env';
import sharp from 'sharp';
import { createCanvas, CanvasRenderingContext2D } from 'canvas';

export type OcrDocumentType = 'QUOTATION' | 'INVOICE';

export interface OcrLineItem {
  materialName: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
}

export interface OcrQuotationResult {
  vendorName: string | null;
  quotationNumber: string | null;
  date: string | null;
  lineItems: OcrLineItem[];
  gstAmount: number | null;
  totalAmount: number | null;
  grandTotal: number | null;
}

export interface OcrInvoiceResult {
  vendorName: string | null;
  invoiceNumber: string | null;
  date: string | null;
  amount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  deliveryDate: string | null;
}

export type OcrResult = OcrQuotationResult | OcrInvoiceResult;

const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b';
const GROQ_TEXT_MODEL = 'openai/gpt-oss-20b';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Progressive image widths — tried in order on 413 (too large) errors.
// Start small because Groq free tier has 8000 TPM limit (input + max_tokens must fit).
const IMAGE_WIDTH_STEPS = [768, 512, 384, 256, 200];
const JPEG_QUALITY_STEPS = [60, 50, 40, 30, 20];

// Short prompts to minimize token usage (every token counts on free tier)
const QUOTATION_PROMPT = `Extract all fields from this quotation/invoice image. Return ONLY JSON:
{"vendorName":string|null,"quotationNumber":string|null,"date":"YYYY-MM-DD"|null,"lineItems":[{"materialName":string,"quantity":number,"unitPrice":number,"unit":string|null}],"gstAmount":number|null,"totalAmount":number|null,"grandTotal":number|null}
Extract EVERY line item. Numbers without symbols/commas. Use 0 if unreadable, null if absent.`;

const INVOICE_PROMPT = `Extract all fields from this invoice image. Return ONLY JSON:
{"vendorName":string|null,"invoiceNumber":string|null,"date":"YYYY-MM-DD"|null,"amount":number|null,"taxAmount":number|null,"totalAmount":number|null,"deliveryDate":"YYYY-MM-DD"|null}
Numbers without symbols/commas. Use null if absent.`;

// Even shorter prompt for text-based extraction (no image tokens)
const QUOTATION_TEXT_PROMPT = `Extract all fields from this quotation/invoice text. Return ONLY JSON:
{"vendorName":string|null,"quotationNumber":string|null,"date":"YYYY-MM-DD"|null,"lineItems":[{"materialName":string,"quantity":number,"unitPrice":number,"unit":string|null}],"gstAmount":number|null,"totalAmount":number|null,"grandTotal":number|null}
Extract EVERY line item from the text. Numbers without symbols/commas. Use 0 if unreadable, null if absent.`;

const INVOICE_TEXT_PROMPT = `Extract all fields from this invoice text. Return ONLY JSON:
{"vendorName":string|null,"invoiceNumber":string|null,"date":"YYYY-MM-DD"|null,"amount":number|null,"taxAmount":number|null,"totalAmount":number|null,"deliveryDate":"YYYY-MM-DD"|null}
Numbers without symbols/commas. Use null if absent.`;

/**
 * Compress an image buffer to JPEG at a given width and quality.
 */
async function compressImage(buffer: Buffer, maxWidth: number, quality: number): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/**
 * Build the Groq message content array from image buffers.
 */
function buildVisionContent(
  images: Buffer[],
  documentType: OcrDocumentType
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = images.map((imgBuf) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${imgBuf.toString('base64')}` },
  }));
  content.push({
    type: 'text',
    text: documentType === 'QUOTATION' ? 'Extract all quotation fields' : 'Extract all invoice fields',
  });
  return content;
}

/**
 * Call Groq API once. Returns status + text.
 * max_tokens is kept LOW because Groq free tier counts input+output against TPM limit.
 */
async function callGroqOnce(
  content: Array<Record<string, unknown>>,
  systemPrompt: string,
  isVision: boolean
): Promise<{ ok: boolean; status: number; text: string }> {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const body: Record<string, unknown> = {
    model: isVision ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    temperature: 0,
    // Keep max_tokens low — Groq free tier counts input + max_tokens against 8000 TPM
    max_tokens: isVision ? 2000 : 4000,
  };

  // Only vision model (qwen) supports response_format json_object reliably
  if (isVision) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/**
 * Call Groq text model (no image) — much cheaper, no 413 risk.
 * Used when PDF has extractable text.
 */
async function callGroqText(
  extractedText: string,
  documentType: OcrDocumentType
): Promise<string> {
  const systemPrompt = documentType === 'QUOTATION' ? QUOTATION_TEXT_PROMPT : INVOICE_TEXT_PROMPT;
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: extractedText.substring(0, 12000) }, // cap text length
    ];

    const result = await callGroqOnce(content, systemPrompt, false);

    if (result.ok) {
      const data = JSON.parse(result.text);
      return data.choices?.[0]?.message?.content ?? '';
    }

    if ((result.status === 429 || result.status >= 500) && attempt < MAX_RETRIES) {
      let delayMs = Math.min(2000 * Math.pow(2, attempt), 20000);
      const retryMatch = result.text.match(/try again in ([\d.]+)s/i);
      if (retryMatch) {
        delayMs = Math.ceil(Number(retryMatch[1]) * 1000) + 500;
      }
      console.warn(`[Groq Text] ${result.status} attempt ${attempt + 1}, retry in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`Groq API error ${result.status}: ${result.text}`);
  }

  throw new Error('Groq API: max retries exceeded');
}

/**
 * Call Groq vision with progressive downscaling on 413 (too large) errors.
 */
async function callGroqVision(
  rawImages: Buffer[],
  documentType: OcrDocumentType
): Promise<string> {
  const systemPrompt = documentType === 'QUOTATION' ? QUOTATION_PROMPT : INVOICE_PROMPT;
  const MAX_RATE_LIMIT_RETRIES = 3;
  let lastErrText = '';

  for (let step = 0; step < IMAGE_WIDTH_STEPS.length; step++) {
    const width = IMAGE_WIDTH_STEPS[step];
    const quality = JPEG_QUALITY_STEPS[step];

    // Compress all images at this step's resolution
    const compressed = await Promise.all(
      rawImages.map((img) => compressImage(img, width, quality))
    );
    const totalSize = compressed.reduce((sum, buf) => sum + buf.length, 0);
    console.log(`[OCR] Vision: width=${width}px, quality=${quality}, total=${(totalSize / 1024).toFixed(0)}KB`);

    const content = buildVisionContent(compressed, documentType);

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const result = await callGroqOnce(content, systemPrompt, true);

      if (result.ok) {
        const data = JSON.parse(result.text);
        return data.choices?.[0]?.message?.content ?? '';
      }

      lastErrText = result.text;

      // 413 = image too large — step down to next smaller size
      if (result.status === 413) {
        console.warn(`[Groq] 413 at width=${width}px, stepping down...`);
        break;
      }

      // 429 or 5xx — retry with delay
      if ((result.status === 429 || result.status >= 500) && attempt < MAX_RATE_LIMIT_RETRIES) {
        let delayMs = Math.min(2000 * Math.pow(2, attempt), 20000);
        const retryMatch = result.text.match(/try again in ([\d.]+)s/i);
        if (retryMatch) {
          delayMs = Math.ceil(Number(retryMatch[1]) * 1000) + 500;
        }
        console.warn(`[Groq] ${result.status} attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}, retry in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw new Error(`Groq API error ${result.status}: ${result.text}`);
    }
  }

  throw new Error(
    'Document image is too large for the AI model even after aggressive compression. ' +
    'Please try uploading a smaller image or crop to just the items table.'
  );
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Try to extract text from a PDF using pdfjs-dist.
 * Returns the extracted text or null if no text could be extracted (scanned PDF).
 */
async function tryExtractPdfText(buffer: Buffer, maxPages = 3): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  let allText = '';

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str ?? '')
      .join(' ')
      .trim();
    if (pageText) {
      allText += pageText + '\n';
    }
    page.cleanup();
  }

  await pdf.destroy();

  // If we got very little text, it's likely a scanned PDF — return null to use vision
  if (allText.trim().length < 50) {
    console.log('[OCR] PDF has little/no extractable text (likely scanned), falling back to vision');
    return null;
  }

  console.log(`[OCR] PDF text extracted: ${allText.length} chars from ${pageCount} page(s)`);
  return allText;
}

/**
 * Render pages of a PDF to PNG buffers for vision API (fallback for scanned PDFs)
 */
async function renderPdfPagesToPng(buffer: Buffer, maxPages = 1): Promise<Buffer[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images: Buffer[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

    await page.render({
      canvasContext: ctx,
      viewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    images.push(canvas.toBuffer('image/png'));
    page.cleanup();
  }

  await pdf.destroy();
  return images;
}

export async function extractFromFile(
  fileBuffer: Buffer,
  mimeType: string,
  documentType: OcrDocumentType
): Promise<OcrResult> {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  if (!isImage && !isPdf) {
    throw new Error('Unsupported file type. Please upload an image (JPG, PNG, GIF, WebP, BMP, TIFF) or PDF.');
  }

  let responseText: string;

  if (isPdf) {
    // STRATEGY: Try text extraction first (cheap, no 413 risk).
    // Fall back to vision only if the PDF is scanned (no extractable text).
    let extractedText: string | null = null;
    try {
      extractedText = await tryExtractPdfText(fileBuffer, 3);
    } catch (err) {
      console.warn('[OCR] PDF text extraction failed:', err instanceof Error ? err.message : err);
    }

    if (extractedText) {
      // Use text model — much cheaper, no image tokens, no 413
      console.log('[OCR] Using text extraction path (no vision needed)');
      responseText = await callGroqText(extractedText, documentType);
    } else {
      // Scanned PDF — fall back to vision with progressive downscaling
      console.log('[OCR] Using vision path for scanned PDF');
      let rawImages: Buffer[];
      try {
        rawImages = await renderPdfPagesToPng(fileBuffer, 1);
      } catch (renderErr) {
        const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
        throw new Error(`Failed to read PDF: ${msg}. Try uploading a photo/screenshot of the document instead.`);
      }
      if (rawImages.length === 0) {
        throw new Error('Could not read any pages from this PDF. Please try uploading a photo/screenshot instead.');
      }
      responseText = await callGroqVision(rawImages, documentType);
    }
  } else {
    // Image — must use vision API with progressive downscaling
    console.log(`[OCR] Using vision path for image: ${mimeType}, ${fileBuffer.length} bytes`);
    // sharp handles all image formats (JPEG, PNG, GIF, WebP, BMP, TIFF, AVIF)
    const png = await sharp(fileBuffer).png().toBuffer();
    responseText = await callGroqVision([png], documentType);
  }

  console.log('[OCR] Groq response:', responseText.substring(0, 500));
  const parsed = parseJsonResponse(responseText);

  if (documentType === 'QUOTATION') {
    const items = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
    console.log(`[OCR] Extracted ${items.length} line items, vendorName=${parsed.vendorName ?? 'null'}`);
    return {
      vendorName: (parsed.vendorName as string) ?? null,
      quotationNumber: (parsed.quotationNumber as string) ?? null,
      date: (parsed.date as string) ?? null,
      lineItems: items.map((item: Record<string, unknown>) => ({
        materialName: String(item.materialName ?? ''),
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        unit: (item.unit as string) ?? undefined,
      })),
      gstAmount: parsed.gstAmount != null ? Number(parsed.gstAmount) : null,
      totalAmount: parsed.totalAmount != null ? Number(parsed.totalAmount) : null,
      grandTotal: parsed.grandTotal != null ? Number(parsed.grandTotal) : null,
    } as OcrQuotationResult;
  }

  return {
    vendorName: (parsed.vendorName as string) ?? null,
    invoiceNumber: (parsed.invoiceNumber as string) ?? null,
    date: (parsed.date as string) ?? null,
    amount: parsed.amount != null ? Number(parsed.amount) : null,
    taxAmount: parsed.taxAmount != null ? Number(parsed.taxAmount) : null,
    totalAmount: parsed.totalAmount != null ? Number(parsed.totalAmount) : null,
    deliveryDate: (parsed.deliveryDate as string) ?? null,
  } as OcrInvoiceResult;
}
