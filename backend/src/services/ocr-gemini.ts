/**
 * Gemini LLM fallback for OCR auto-fill.
 *
 * Only called when the local regex parser (ocr-parser.ts) returns low-
 * confidence results. Uses Google Gemini 2.5 Flash which has a generous
 * free tier (15 RPM, 1500 req/day, 1M TPM) — far better than Groq's 8000 TPM.
 *
 * Two modes:
 *  - Text: when we have raw text (from pdfjs-dist or Tesseract) but the regex
 *    parser couldn't structure it. Send the text to Gemini's text model.
 *  - Vision: when OCR itself failed or produced garbage. Send the image
 *    directly to Gemini's vision model.
 */
import { env } from '../config/env';
import sharp from 'sharp';
import type {
  OcrDocumentType,
  OcrResult,
  OcrQuotationResult,
  OcrInvoiceResult,
} from './ocr.service.types';

const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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
    throw new Error('Gemini response did not contain a JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Call Gemini's generateContent endpoint. Returns the text response.
 */
async function callGemini(
  model: string,
  contents: unknown[],
  maxRetries = 3
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.ok) {
      const data = JSON.parse(text);
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error('Gemini returned no candidates');
      }
      // responseMimeType: application/json → content is in parts[0].text
      const content = candidate.content?.parts?.[0]?.text ?? '';
      if (!content) {
        throw new Error('Gemini returned empty content');
      }
      return content;
    }

    // 429 or 5xx — retry with exponential backoff
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const delayMs = Math.min(2000 * Math.pow(2, attempt), 20000);
      console.warn(`[Gemini] ${res.status} attempt ${attempt + 1}/${maxRetries + 1}, retry in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  throw new Error('Gemini API: max retries exceeded');
}

/**
 * Fallback: send raw text to Gemini for structuring.
 * Used when regex parsing fails on text from pdfjs-dist or Tesseract.
 */
export async function fallbackParseText(
  extractedText: string,
  documentType: OcrDocumentType
): Promise<OcrResult> {
  const prompt = documentType === 'QUOTATION' ? QUOTATION_PROMPT : INVOICE_PROMPT;
  const contents = [
    { role: 'user', parts: [{ text: prompt }, { text: extractedText.substring(0, 12000) }] },
  ];
  const responseText = await callGemini(GEMINI_TEXT_MODEL, contents);
  return parseGeminiResult(responseText, documentType);
}

/**
 * Fallback: send image(s) directly to Gemini vision for OCR + structuring.
 * Used when Tesseract OCR fails or produces garbage text.
 */
export async function fallbackParseImages(
  images: Buffer[],
  documentType: OcrDocumentType
): Promise<OcrResult> {
  const prompt = documentType === 'QUOTATION' ? QUOTATION_VISION_PROMPT : INVOICE_VISION_PROMPT;

  // Compress images for the API (Gemini accepts up to ~4MB per image, but
  // smaller is faster and uses less quota)
  const compressed = await Promise.all(
    images.map((img) =>
      sharp(img).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
    )
  );

  const parts: unknown[] = [{ text: prompt }];
  for (const buf of compressed) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: buf.toString('base64'),
      },
    });
  }

  const contents = [{ role: 'user', parts }];
  const responseText = await callGemini(GEMINI_VISION_MODEL, contents);
  return parseGeminiResult(responseText, documentType);
}

function parseGeminiResult(text: string, documentType: OcrDocumentType): OcrResult {
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
 * Check if the Gemini fallback is configured (API key present).
 * If not, the service will just return the regex-parsed result as-is.
 */
export function isGeminiConfigured(): boolean {
  return !!env.GEMINI_API_KEY;
}
