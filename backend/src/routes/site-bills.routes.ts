import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { Permission, createSiteBillSchema, listSiteBillsSchema, generateSiteBillPoSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { generateProjectSequenceNumber } from '../services/sequence.service';
import { getStorageService } from '../services/storage.service';
import {
  SiteBillError,
  cancelSiteBill,
  createSiteBill,
  generateSiteBillPo,
  listSiteBills,
  priceSiteBill,
} from '../services/site-bill.service';

/**
 * Site bills (≤ ₹5,000, paid at site, reimbursed). The bill photo is served by
 * GET /material-purchase-requests/:id/receipt, since every bill is a material request.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const allowedBillFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'];

const router = Router();
router.use(authMiddleware);

function sendError(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof SiteBillError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

// GET / — bills, newest first. filter=open (not in a PO yet) | in_po | all
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_MPR),
  validateMiddleware(listSiteBillsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const q = req.query as Record<string, unknown>;
      res.json(
        await listSiteBills(projectId, {
          filter: (q.filter as 'open' | 'in_po' | 'all' | undefined) ?? 'all',
          dateFrom: q.dateFrom as Date | undefined,
          dateTo: q.dateTo as Date | undefined,
          paymentMode: q.paymentMode as string | undefined,
          search: q.search as string | undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// POST / — record one bill (multipart: fields + `file`, the bill photo/PDF, required)
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_MPR),
  upload.single('file'),
  validateMiddleware(createSiteBillSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'Attach a photo or PDF of the bill' });
        return;
      }
      if (!allowedBillFileTypes.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'The bill must be a PDF or an image' });
        return;
      }
      // Check the amount before the number is taken and the file stored.
      priceSiteBill(req.body.items);

      const paidById: string | null = req.body.paidById ?? null;
      if (paidById) {
        const payer = await prisma.user.findFirst({ where: { id: paidById, isActive: true }, select: { id: true } });
        if (!payer) {
          res.status(400).json({ error: 'The person who paid was not found' });
          return;
        }
      }

      const mprNumber = await generateProjectSequenceNumber('materialPurchaseRequest', 'mprNumber', 'MPR', 3, projectId);
      const subPath = req.file.mimetype.startsWith('image/') ? 'images' : 'documents';
      const uploaded = await getStorageService().upload(
        req.file.buffer,
        `site-bills/${subPath}/${mprNumber}-${req.file.originalname}`,
        req.file.mimetype,
        'documents',
      );

      const bill = await createSiteBill({
        projectId,
        userId: req.user!.id,
        billDate: req.body.billDate,
        shopName: req.body.shopName,
        paymentMode: req.body.paymentMode,
        description: req.body.description,
        paidById,
        items: req.body.items,
        file: { filePath: uploaded.filePath, fileName: req.file.originalname, mimeType: req.file.mimetype },
        mprNumber,
      });
      res.status(201).json(bill);
    } catch (error) {
      sendError(res, next, error);
    }
  },
);

// POST /generate-po — one PO for the selected bills, sent straight for approval
router.post(
  '/generate-po',
  rbacMiddleware(Permission.CREATE_MPR),
  validateMiddleware(generateSiteBillPoSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await generateSiteBillPo({
        projectId,
        userId: req.user!.id,
        billIds: req.body.billIds,
        paymentType: req.body.paymentType,
        reimburseTo: req.body.reimburseTo,
        budgetHeadId: req.body.budgetHeadId,
        notes: req.body.notes,
      });
      res.status(201).json({ id: po.id, poNumber: po.poNumber });
    } catch (error) {
      sendError(res, next, error);
    }
  },
);

// DELETE /:id — cancel a bill that is not in a live PO
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      await cancelSiteBill(projectId, req.params.id, req.user!.id);
      res.json({ success: true });
    } catch (error) {
      sendError(res, next, error);
    }
  },
);

export default router;
