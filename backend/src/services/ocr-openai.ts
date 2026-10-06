/**
 * OpenAI LLM document structuring for OCR auto-fill.
 *
 * Used as the primary structuring engine when configured because vendor
 * quotations do not share one table layout or one set of headings. The local
 * regex parser remains the no-API fallback if OpenAI is unavailable or fails.
 *
 * Two modes:
 *  - Text: raw text from pdfjs-dist for digital PDFs.
 *  - Vision: the original image for screenshots/scanned PDFs, preserving
 *    table geometry that Tesseract's text output may reorder.
 */
import { env } from '../config/env';
import sharp from 'sharp';
import type {
  OcrDocumentType,
  OcrResult,
  OcrQuotationResult,
  OcrInvoiceResult,
} from './ocr.service.types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const QUOTATION_PROMPT = `Extract all fields from this quotation/invoice text. Return ONLY JSON, no markdown:
{"vendorName":string|null,"quotationNumber":string|null,"date":"YYYY-MM-DD"|null,"lineItems":[{"materialName":string,"quantity":number,"unitPrice":number,"unit":string|null}],"gstAmount":number|null,"totalAmount":number|null,"grandTotal":number|null}
Extract EVERY line item. Numbers without symbols/commas. Use 0 if unreadable, null if absent.`;

const INVOICE_PROMPT = `Extract all fields from this invoice text. Return ONLY JSON, no markdown:
{"vendorName":string|null,"invoiceNumber":string|null,"date":"YYYY-MM-DD"|null,"amount":number|null,"taxAmount":number|null,"totalAmount":number|null,"deliveryDate":"YYYY-MM-DD"|null}
Numbers without symbols/commas. Use null if absent.`;

const QUOTATION_VISION_PROMPT = `Extract all fields from this quotation/invoice image. Return ONLY JSON, no markdown:
{"vendorName":string|null,"quotationNumber":string|null,"date":"YYYY-MM-DD"|null,"lineItems":[{"materialName":string,"quantity":number,"unitPrice":number,"unit":string|null}],"gstAmount":number|null,"totalAmount":number|null,"grandTotal":number|null}
Extract EVERY line item. Numbers without symbols/commas. Use 0 if unreadable, null if absent.`;

const INVOICE_VISION_PROMPT = `Extract all fields from this invoice image. Return ONLY JSON, no markdown:
{"vendorName":string|null,"invoiceNumber":string|null,"date":"YYYY-MM-DD"|null,"amount":number|null,"taxAmount":number|null,"totalAmount":number|null,"deliveryDate":"YYYY-MM-DD"|null}
Numbers without symbols/commas. Use null if absent.`;

function parseJsonResponse(text: string): Record<string, unknown> {
  // Strip markdown fences and any text before/after the JSON object
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  // Find the first { and last } to extract just the JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('OpenAI response did not contain a JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Call OpenAI Chat Completions in JSON mode. `content` is the user message
 * (a string, or text + image_url parts). Returns the text response.
 */
async function callOpenAI(content: string | unknown[], maxRetries = 3): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const body = {
    model: env.OCR_MODEL,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_object' },
    reasoning_effort: 'low',
    max_completion_tokens: 8000,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.ok) {
      const data = JSON.parse(text);
      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new Error('OpenAI returned no choices');
      }
      const out = typeof message.content === 'string' ? message.content : '';
      if (!out) {
        throw new Error(`OpenAI returned empty content${message.refusal ? ' (refused)' : ''}`);
      }
      return out;
    }

    // 429 or 5xx — retry with exponential backoff
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const delayMs = Math.min(2000 * Math.pow(2, attempt), 20000);
      console.warn(`[OpenAI] ${res.status} attempt ${attempt + 1}/${maxRetries + 1}, retry in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  throw new Error('OpenAI API: max retries exceeded');
}

/**
 * Fallback: send raw text to OpenAI for structuring.
 * Used when regex parsing fails on text from pdfjs-dist or Tesseract.
 */
export async function fallbackParseText(
  extractedText: string,
  documentType: OcrDocumentType
): Promise<OcrResult> {
  const prompt = documentType === 'QUOTATION' ? QUOTATION_PROMPT : INVOICE_PROMPT;
  const responseText = await callOpenAI(`${prompt}

${extractedText.substring(0, 12000)}`);
  return parseOpenAIResult(responseText, documentType);
}

/**
 * Fallback: send image(s) directly to OpenAI vision for OCR + structuring.
 * Used when Tesseract OCR fails or produces garbage text.
 */
export async function fallbackParseImages(
  images: Buffer[],
  documentType: OcrDocumentType
): Promise<OcrResult> {
  const prompt = documentType === 'QUOTATION' ? QUOTATION_VISION_PROMPT : INVOICE_VISION_PROMPT;

  // Compress images for the API; smaller is faster and cheaper
  const compressed = await Promise.all(
    images.map((img) =>
      sharp(img).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
    )
  );

  const content: unknown[] = [{ type: 'text', text: prompt }];
  for (const buf of compressed) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
    });
  }

  const responseText = await callOpenAI(content);
  return parseOpenAIResult(responseText, documentType);
}

function parseOpenAIResult(text: string, documentType: OcrDocumentType): OcrResult {
  const parsed = parseJsonResponse(text);

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

/**
 * Check if the OpenAI structuring is configured (API key present).
 * If not, the service will just return the regex-parsed result as-is.
 */
export function isOcrLlmConfigured(): boolean {
  return !!env.OPENAI_API_KEY;
}
