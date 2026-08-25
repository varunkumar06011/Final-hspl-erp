import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { extractFromFile, type OcrDocumentType, type OcrResult } from '../services/ocr.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

// POST /extract — extract fields from an uploaded document (image or PDF)
router.post(
  '/extract',
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const documentType = (req.body.documentType as OcrDocumentType) || 'QUOTATION';
      if (documentType !== 'QUOTATION' && documentType !== 'INVOICE') {
        res.status(400).json({ error: 'documentType must be QUOTATION or INVOICE' });
        return;
      }

      const result = await extractFromFile(req.file.buffer, req.file.mimetype, documentType);

      // If vendorName was extracted, try to match it to an existing vendor in this project
      if (result.vendorName) {
        const vendor = await prisma.vendor.findFirst({
          where: {
            projectId,
            deletedAt: null,
            name: { contains: result.vendorName, mode: 'insensitive' },
          },
          select: { id: true, name: true },
        });
        if (vendor) {
          (result as OcrResult & { vendorId?: string }).vendorId = vendor.id;
        }
      }

      res.json(result);
    } catch (error) {
      console.error('[OCR] Extract error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Provide a user-friendly hint for common PDF rendering failures
      const isPdfRenderError = message.includes('Failed to read PDF') || message.includes('canvas');
      const hint = isPdfRenderError
        ? ' Could not process the PDF. Try uploading a photo/screenshot of the document instead.'
        : '';
      res.status(500).json({ error: `Failed to process document: ${message}${hint}` });
    }
  }
);

export default router;
