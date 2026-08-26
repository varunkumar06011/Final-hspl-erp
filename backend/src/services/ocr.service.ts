/**
 * OCR auto-fill service — orchestrates the extraction pipeline.
 *
 * Pipeline:
 *  1. Get raw document data locally:
 *     - Digital PDF → pdfjs-dist text extraction
 *     - Image / scanned PDF → Tesseract.js OCR plus rendered images
 *  2. When Gemini is configured, use Gemini to structure the document. This
 *     is important because vendor quotations do not share one table layout or
 *     one set of headings, and regex rules can silently shift columns.
 *  3. If Gemini is unavailable or fails, return the conservative local regex
 *     parse as a no-API fallback.
 *
 * This eliminates the Groq dependency that was causing rate-limit failures.
 */
import sharp from 'sharp';
import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import { parseDocumentText, assessConfidence } from './ocr-parser';
import { ocrImage, ocrImages } from './ocr-tesseract';
import {
  fallbackParseText,
  fallbackParseImages,
  isGeminiConfigured,
} from './ocr-gemini';
import type {
  OcrDocumentType,
  OcrResult,
} from './ocr.service.types';

// Re-export types so existing imports from ocr.service still work.
export type {
  OcrDocumentType,
  OcrLineItem,
  OcrQuotationResult,
  OcrInvoiceResult,
  OcrResult,
} from './ocr.service.types';

// ────────────────────────────────────────────────────────────────────────────
// PDF text extraction (pdfjs-dist) — unchanged from the previous implementation
// ────────────────────────────────────────────────────────────────────────────

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

  // If we got very little text, it's likely a scanned PDF — return null to use OCR
  if (allText.trim().length < 50) {
    console.log('[OCR] PDF has little/no extractable text (likely scanned), falling back to OCR');
    return null;
  }

  console.log(`[OCR] PDF text extracted: ${allText.length} chars from ${pageCount} page(s)`);
  return allText;
}

/**
 * Render pages of a PDF to PNG buffers for OCR or vision API.
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

// ────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────────────────

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

  // Step 1: Get raw text from the document
  let rawText: string | null = null;
  let rawImages: Buffer[] | null = null;

  if (isPdf) {
    // Try text extraction first (fast, local, no OCR needed for digital PDFs)
    try {
      rawText = await tryExtractPdfText(fileBuffer, 3);
    } catch (err) {
      console.warn('[OCR] PDF text extraction failed:', err instanceof Error ? err.message : err);
    }

    if (!rawText) {
      // Scanned PDF — render to images, then OCR with Tesseract
      console.log('[OCR] Using Tesseract OCR for scanned PDF');
      try {
        rawImages = await renderPdfPagesToPng(fileBuffer, 1);
      } catch (renderErr) {
        const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
        throw new Error(`Failed to read PDF: ${msg}. Try uploading a photo/screenshot of the document instead.`);
      }
      if (rawImages.length === 0) {
        throw new Error('Could not read any pages from this PDF. Please try uploading a photo/screenshot instead.');
      }
      rawText = await ocrImages(rawImages);
    }
  } else {
    // Image — OCR with Tesseract
    console.log(`[OCR] Using Tesseract OCR for image: ${mimeType}, ${fileBuffer.length} bytes`);
    // sharp normalizes all image formats (JPEG, PNG, GIF, WebP, BMP, TIFF, AVIF)
    const png = await sharp(fileBuffer).png().toBuffer();
    rawImages = [png];
    rawText = await ocrImage(png);
  }

  // Always build the local result first. It is the fallback when the optional
  // LLM is unavailable, and it also gives us useful diagnostics in the logs.
  console.log(`[OCR] Parsing ${rawText.length} chars with local parser`);
  const localResult = parseDocumentText(rawText, documentType);
  const confidence = assessConfidence(localResult, documentType);

  // Do not use the local parser as the authority for arbitrary layouts. A
  // column-oriented OCR result can look superficially valid while assigning
  // a quantity to the wrong column. Gemini receives the original image for
  // visual layout understanding, not just Tesseract's reordered text.
  if (isGeminiConfigured()) {
    try {
      if (rawImages && rawImages.length > 0) {
        console.log('[OCR] Using Gemini vision to structure the document layout');
        return await fallbackParseImages(rawImages, documentType);
      }

      console.log('[OCR] Using Gemini text to structure the digital PDF');
      return await fallbackParseText(rawText, documentType);
    } catch (fallbackErr) {
      console.warn(
        '[OCR] Gemini structuring failed, returning local result:',
        fallbackErr instanceof Error ? fallbackErr.message : fallbackErr
      );
    }
  } else {
    console.warn('[OCR] Gemini not configured; using local parser');
  }

  console.log(`[OCR] Local parser result retained (confidence: ${confidence.reason})`);
  return localResult;
}
