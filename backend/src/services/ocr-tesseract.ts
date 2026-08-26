/**
 * Local OCR via Tesseract.js — no API key, no rate limits.
 *
 * Used for images and scanned PDFs (rendered to images by pdfjs-dist in
 * ocr.service.ts). Returns raw text that is then fed to the regex parser
 * (ocr-parser.ts).
 *
 * Tesseract works best on high-resolution, high-contrast images — the
 * opposite of what the old Groq path needed (which downscaled to fit token
 * limits). So we upscale small images and binarize before OCR.
 */
import sharp from 'sharp';

/**
 * Preprocess an image for better OCR accuracy:
 *  - Upscale if width < 1000px (Tesseract needs ~300 DPI equivalent)
 *  - Convert to grayscale
 *  - Normalize contrast
 *  - Sharpen slightly
 *
 * Returns a PNG buffer ready for Tesseract.
 */
async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const targetWidth = Math.max(meta.width ?? 0, 1000);

  return image
    .resize({ width: targetWidth, withoutEnlargement: false, fit: 'inside' })
    .greyscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

/**
 * Run Tesseract OCR on an image buffer. Returns the extracted text.
 *
 * Tesseract.js downloads its language data (eng.traineddata) on first run
 * and caches it. In production this may need a writable cache directory —
 * see TESSDATA_PREFIX env var if the default cache location isn't writable.
 */
export async function ocrImage(buffer: Buffer): Promise<string> {
  const tesseract = await import('tesseract.js');
  const preprocessed = await preprocessForOcr(buffer);

  const worker = await tesseract.createWorker('eng', 1, {
    // Suppress verbose progress logging in production
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        console.log(`[OCR] Tesseract: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });

  try {
    const { data } = await worker.recognize(preprocessed);
    const text = data.text ?? '';
    console.log(`[OCR] Tesseract extracted ${text.length} chars`);
    return text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Run OCR on multiple images (e.g. multi-page scanned PDF) and concatenate.
 * Pages are processed sequentially to avoid memory spikes.
 */
export async function ocrImages(buffers: Buffer[]): Promise<string> {
  const parts: string[] = [];
  for (const buf of buffers) {
    parts.push(await ocrImage(buf));
  }
  return parts.join('\n\n--- Page Break ---\n\n');
}
