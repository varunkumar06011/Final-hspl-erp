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
const GROQ_TEXT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getQuotationPrompt(): string {
  return `You are an expert at reading Indian vendor quotations. Extract the following fields from this document and return ONLY valid JSON (no markdown, no explanation):

{
  "vendorName": "name of the vendor/company or null",
  "quotationNumber": "quotation/reference number or null",
  "date": "date on the document in YYYY-MM-DD format or null",
  "lineItems": [
    { "materialName": "item name/description", "quantity": number, "unitPrice": number, "unit": "unit if mentioned or null" }
  ],
  "gstAmount": number_or_null,
  "totalAmount": "subtotal before tax or null",
  "grandTotal": "final total after tax or null"
}

Rules:
- Extract ALL line items visible on the document.
- Use null for any field you cannot read clearly.
- Numbers must be plain numbers (no currency symbols, no commas).
- Return ONLY the JSON object.`;
}

function getInvoicePrompt(): string {
  return `You are an expert at reading Indian vendor invoices. Extract the following fields from this document and return ONLY valid JSON (no markdown, no explanation):

{
  "vendorName": "name of the vendor/company or null",
  "invoiceNumber": "invoice number or null",
  "date": "invoice date in YYYY-MM-DD format or null",
  "amount": "subtotal before tax or null",
  "taxAmount": "GST/tax amount or null",
  "totalAmount": "final total after tax or null",
  "deliveryDate": "delivery date in YYYY-MM-DD format or null"
}

Rules:
- Use null for any field you cannot read clearly.
- Numbers must be plain numbers (no currency symbols, no commas).
- Return ONLY the JSON object.`;
}

async function callGroq(
  content: Array<Record<string, unknown>>,
  isVision: boolean
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const model = isVision ? GROQ_VISION_MODEL : GROQ_TEXT_MODEL;
  const prompt = content[content.length - 1]?.text as string;
  const documentType = prompt.includes('quotation') ? 'QUOTATION' : 'INVOICE';
  const systemPrompt = documentType === 'QUOTATION' ? getQuotationPrompt() : getInvoicePrompt();

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    temperature: 0,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  };

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function parseJsonResponse(text: string): Record<string, unknown> {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

// Render first N pages of a PDF to PNG buffers using pdfjs-dist + node-canvas
async function renderPdfPagesToImages(buffer: Buffer, maxPages = 3): Promise<Buffer[]> {
  // pdfjs-dist v4 is ESM-only — use dynamic import
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images: Buffer[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

    await page.render({
      canvasContext: ctx,
      viewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    // Compress and resize if too large (Groq has ~10MB limit per request)
    const optimized = await sharp(pngBuffer)
      .resize({ width: Math.min(width, 1600), withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    images.push(optimized);

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
    throw new Error('Unsupported file type. Please upload an image (JPG/PNG) or PDF.');
  }

  let content: Array<Record<string, unknown>>;
  let isVision = false;

  if (isImage) {
    // Groq vision API only supports JPG, PNG, and GIF — convert other formats (webp, etc.)
    // Also compress large images to stay within API limits
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    let imageBuffer = fileBuffer;
    let targetMime = mimeType;
    if (!supportedTypes.includes(mimeType)) {
      imageBuffer = await sharp(fileBuffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      targetMime = 'image/jpeg';
    } else if (fileBuffer.length > 4 * 1024 * 1024) {
      // Compress if larger than 4MB
      imageBuffer = await sharp(fileBuffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      targetMime = 'image/jpeg';
    }
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${targetMime};base64,${base64}`;
    content = [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: documentType === 'QUOTATION' ? 'Extract quotation fields' : 'Extract invoice fields' },
    ];
    isVision = true;
  } else {
    // PDF: render pages to images and use vision API (handles both text and scanned PDFs)
    let pageImages: Buffer[];
    try {
      pageImages = await renderPdfPagesToImages(fileBuffer, 3);
    } catch (renderErr) {
      const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
      throw new Error(`Failed to read PDF: ${msg}. Try uploading a photo/screenshot of the document instead.`);
    }
    if (pageImages.length === 0) {
      throw new Error('Could not read any pages from this PDF. Please try uploading a photo/screenshot instead.');
    }
    // Send all pages as images to the vision model
    content = pageImages.map((imgBuf) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imgBuf.toString('base64')}` },
    }));
    content.push({
      type: 'text',
      text: documentType === 'QUOTATION'
        ? 'Extract quotation fields from this document (may span multiple pages)'
        : 'Extract invoice fields from this document (may span multiple pages)',
    });
    isVision = true;
  }

  const responseText = await callGroq(content, isVision);
  const parsed = parseJsonResponse(responseText);

  if (documentType === 'QUOTATION') {
    const items = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
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
