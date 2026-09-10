import { Router, Response, NextFunction } from 'express';
import { APPROVER_ROLES, Permission, QuotationStatus, AuditAction, UserRole } from '@hospital-erp/shared';
import { createQuotationSchema, listQuotationsSchema, approvalActionSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { notifyAdmins } from '../services/push.service';
import {
  createQuotation,
  generateQuotationNumber,
  quotationInclude,
  type QuotationLineItem,
} from '../services/quotation.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const allowedQuotationFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

const router = Router();
router.use(authMiddleware);

// ── Quotation Approval Aging (additive, read-only) ──────────────────
// Calculates how long each quotation has been waiting for approval, based
// on ApprovalWorkflow.createdAt (when approval was requested), NOT
// Quotation.createdAt. Returns aging status + label for color-coding.
//
// Aging rules:
//   < 1 day  → "NORMAL"   (neutral)
//   ≥ 1 day  → "ATTENTION" (light red)
//   > 1 day  → "OVERDUE"   (red)
//   APPROVED → "APPROVED"  (green)
//   REJECTED → "REJECTED"  (gray)
router.get(
  '/approval-aging',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const quotations = await prisma.quotation.findMany({
        where: {
          projectId,
          deletedAt: null,
          approvalWorkflowId: { not: null },
        },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          approvalWorkflow: { select: { id: true, createdAt: true, status: true } },
        },
      });

      const now = new Date();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      const records = quotations.map((q) => {
        const approvalRequestedAt = q.approvalWorkflow?.createdAt ?? null;
        let agingMs = 0;
        let agingHours = 0;
        let agingDays = 0;
        let agingLabel = '';
        let agingStatus: 'NORMAL' | 'ATTENTION' | 'OVERDUE' | 'APPROVED' | 'REJECTED' = 'NORMAL';

        if (q.status === QuotationStatus.APPROVED) {
          agingStatus = 'APPROVED';
          agingLabel = 'Approved';
        } else if (q.status === QuotationStatus.REJECTED) {
          agingStatus = 'REJECTED';
          agingLabel = 'Rejected';
        } else if (approvalRequestedAt) {
          agingMs = now.getTime() - approvalRequestedAt.getTime();
          agingHours = agingMs / (1000 * 60 * 60);
          agingDays = Math.floor(agingHours / 24);
          const remainingHours = Math.floor(agingHours % 24);

          if (agingMs > ONE_DAY_MS) {
            agingStatus = 'OVERDUE';
            agingLabel = `Approval Overdue · ${agingDays}d ${remainingHours}h`;
          } else if (agingMs >= ONE_DAY_MS) {
            agingStatus = 'ATTENTION';
            agingLabel = `Pending Approval · ${agingDays}d ${remainingHours}h`;
          } else {
            agingStatus = 'NORMAL';
            agingLabel = `Pending Approval · ${agingDays}d ${remainingHours}h`;
          }
        } else {
          agingLabel = 'Pending Approval';
        }

        return {
          id: q.id,
          quotationNumber: q.quotationNumber,
          status: q.status,
          approvalRequestedAt: approvalRequestedAt?.toISOString() ?? null,
          agingMs,
          agingHours: Math.round(agingHours * 10) / 10,
          agingDays,
          agingStatus,
          agingLabel,
        };
      });

      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  }
);

// ── Check & Notify Overdue Quotation Approvals (additive) ───────────
// Scans for quotations pending approval for ≥ 1 day. For each, if no
// AppNotification exists yet (dedup), sends a push notification to all
// admins and creates an in-app notification entry. This avoids spam —
// each quotation only generates one notification ever.
router.post(
  '/check-aging-notifications',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const now = new Date();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      // Find quotations still pending approval with aging ≥ 1 day
      const quotations = await prisma.quotation.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { in: [QuotationStatus.SUBMITTED, QuotationStatus.UNDER_REVIEW] },
          approvalWorkflow: { isNot: null },
        },
        select: {
          id: true,
          quotationNumber: true,
          grandTotal: true,
          approvalWorkflow: { select: { id: true, createdAt: true } },
        },
      });

      const overdueQuotations = quotations.filter((q) => {
        const approvalRequestedAt = q.approvalWorkflow?.createdAt;
        if (!approvalRequestedAt) return false;
        return (now.getTime() - approvalRequestedAt.getTime()) >= ONE_DAY_MS;
      });

      if (overdueQuotations.length === 0) {
        res.json({ success: true, checked: quotations.length, notified: 0, message: 'No overdue quotations found' });
        return;
      }

      // Check which ones already have notifications (dedup)
      const existingNotifications = await prisma.appNotification.findMany({
        where: {
          entityId: { in: overdueQuotations.map((q) => q.id) },
          type: 'QUOTATION_APPROVAL_OVERDUE',
        },
        select: { entityId: true },
      });
      const alreadyNotified = new Set(existingNotifications.map((n) => n.entityId));

      const newOverdue = overdueQuotations.filter((q) => !alreadyNotified.has(q.id));

      if (newOverdue.length === 0) {
        res.json({ success: true, checked: quotations.length, notified: 0, message: 'All overdue quotations already notified' });
        return;
      }

      // Get all admin users to create in-app notifications for each
      const admins = await prisma.user.findMany({
        where: { isActive: true, role: { in: [UserRole.ADMIN, UserRole.ADMIN_2] } },
        select: { id: true },
      });

      // Create in-app notifications for each admin × each overdue quotation
      const notificationData: Array<{
        userId: string;
        projectId: string;
        type: string;
        title: string;
        body: string;
        url: string;
        entityId: string;
        entityType: string;
      }> = [];

      for (const q of newOverdue) {
        const agingHours = Math.floor((now.getTime() - (q.approvalWorkflow?.createdAt?.getTime() ?? now.getTime())) / (1000 * 60 * 60));
        const agingDays = Math.floor(agingHours / 24);
        const agingLabel = agingDays > 0 ? `${agingDays} day${agingDays === 1 ? '' : 's'}` : `${agingHours} hours`;

        for (const admin of admins) {
          notificationData.push({
            userId: admin.id,
            projectId,
            type: 'QUOTATION_APPROVAL_OVERDUE',
            title: '🔴 Quotation Approval Required',
            body: `Quotation ${q.quotationNumber} has been pending approval since ${agingLabel}. Total: ₹${Number(q.grandTotal).toLocaleString('en-IN')}`,
            url: `/quotations?approval=${q.approvalWorkflow?.id ?? ''}`,
            entityId: q.id,
            entityType: 'QUOTATION',
          });
        }
      }

      // Batch create all notifications
      if (notificationData.length > 0) {
        await prisma.appNotification.createMany({ data: notificationData });
      }

      // Send push notifications (one per quotation, batched to all admins)
      let pushSent = 0;
      for (const q of newOverdue) {
        try {
          await notifyAdmins({
            entityType: 'QUOTATION',
            entityId: q.id,
            title: 'Pending Approval',
            body: `Quotation #${q.quotationNumber} has been pending approval for 1 day. Please review and confirm.`,
            url: `/quotations?approval=${q.approvalWorkflow?.id ?? ''}`,
          });
          pushSent++;
        } catch (pushError) {
          console.error(`[Quotation Aging] Push failed for ${q.quotationNumber} (non-fatal):`, pushError);
        }
      }

      res.json({
        success: true,
        checked: quotations.length,
        notified: newOverdue.length,
        pushSent,
        message: `Created ${notificationData.length} in-app notification(s) and sent ${pushSent} push notification(s) for ${newOverdue.length} overdue quotation(s)`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET / — list quotations
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listQuotationsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, vendorId, status, search } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { quotationNumber: { contains: String(search), mode: 'insensitive' } },
          { vendor: { name: { contains: String(search), mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.quotation.findMany({
          where,
          include: quotationInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.quotation.count({ where }),
      ]);

      res.json({
        data,
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — get single quotation
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: quotationInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create quotation (with optional file upload)
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  upload.single('file'),
  validateMiddleware(createQuotationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendorId = req.body.vendorId;
      const items = typeof req.body.items === 'string'
        ? JSON.parse(req.body.items || '[]') as QuotationLineItem[]
        : (req.body.items || []) as QuotationLineItem[];

      // Generate the quotation number up front so it can be used for the file
      // prefix; it is passed into createQuotation to avoid regenerating it.
      const quotationNumber = await generateQuotationNumber(projectId);

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        if (!allowedQuotationFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Quotation file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `quotations/${subPath}/${quotationNumber}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const result = await createQuotation({
        projectId,
        vendorId,
        items,
        createdBy: req.user!.id,
        quotationNumber,
        workTaskId: req.body.workTaskId,
        filePath,
        fileName,
        fileMimeType,
      });

      res.status(201).json(result);
    } catch (error) {
      // Surface known validation errors (e.g. "Vendor not found") as 400s
      if (error instanceof Error && error.message === 'Vendor not found') {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

// GET /:id/file — serve the quotation attachment file
router.get(
  '/:id/file',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      if (!existing.filePath) {
        res.status(404).json({ error: 'No file attached' });
        return;
      }
      await serveFile(res, existing.filePath, existing.fileMimeType);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id — update quotation (only if not yet approved)
router.patch(
  '/:id',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      if (existing.status === QuotationStatus.APPROVED || existing.status === QuotationStatus.CONVERTED_TO_PO) {
        res.status(400).json({ error: 'Cannot edit an approved quotation' });
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (req.body.items) {
        const items = typeof req.body.items === 'string'
          ? JSON.parse(req.body.items) as QuotationLineItem[]
          : req.body.items as QuotationLineItem[];
        const vendor = await prisma.vendor.findFirst({
          where: { id: existing.vendorId, projectId },
          include: { materials: true },
        });
        // Auto-register any new materials from the quotation to the vendor
        const vendorMaterialNames = vendor?.materials.map((m) => m.name.toLowerCase()) ?? [];
        const newMaterials = items
          .filter((item) => !vendorMaterialNames.includes(item.materialName.toLowerCase()))
          .map((item) => ({ name: item.materialName, unit: item.unit || null }));
        if (newMaterials.length > 0 && vendor) {
          await prisma.vendorMaterial.createMany({
            data: newMaterials.map((m) => ({
              vendorId: vendor.id,
              name: m.name,
              unit: m.unit,
            })),
          });
          console.log(`[Quotation] Auto-registered ${newMaterials.length} new material(s) for vendor "${vendor.name}"`);
        }
        const itemsWithAmounts = items.map((item) => {
          const amount = item.quantity * item.unitPrice;
          const rate = Number(item.gstRate) || 0;
          return {
            materialName: item.materialName,
            quantity: item.quantity,
            unit: item.unit || null,
            unitPrice: item.unitPrice,
            amount,
            gstRate: rate,
          };
        });
        const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
        const gstAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstRate) / 100, 0);
        updateData.totalAmount = totalAmount;
        updateData.gstAmount = gstAmount;
        updateData.grandTotal = totalAmount + gstAmount;
        await prisma.quotationItem.deleteMany({ where: { quotationId: existing.id } });
        updateData.items = { create: itemsWithAmounts };
      }

      // Handle file upload
      if (req.file) {
        if (!allowedQuotationFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Quotation file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `quotations/${subPath}/${existing.quotationNumber}-${req.file.originalname}`;
        const storage = getStorageService();
        // Delete the previous file before uploading the replacement
        if (existing.filePath) {
          await storage.deleteFile(existing.filePath).catch(() => {});
        }
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        updateData.filePath = uploadResult.filePath;
        updateData.fileName = req.file.originalname;
        updateData.fileMimeType = req.file.mimetype;
      }

      const updated = await prisma.quotation.update({
        where: { id: existing.id },
        data: updateData,
        include: quotationInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'QUOTATION',
        entityId: existing.id,
        projectId,
        newValue: updateData,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      if (existing.status === QuotationStatus.APPROVED || existing.status === QuotationStatus.CONVERTED_TO_PO) {
        res.status(400).json({ error: 'Cannot delete an approved quotation or one that has been converted to a purchase order' });
        return;
      }

      const storage = getStorageService();
      if (existing.filePath) {
        await storage.deleteFile(existing.filePath).catch(() => {});
      }

      await prisma.quotation.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'QUOTATION',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Quotation deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve — approve a quotation (any of 4 heads, in any order)
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotation = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!quotation || !quotation.approvalWorkflow) {
        res.status(404).json({ error: 'Quotation or approval workflow not found' });
        return;
      }

      // Check user is one of the approver roles
      if (!APPROVER_ROLES.some((role) => role === req.user!.role)) {
        res.status(403).json({ error: 'Only heads can approve quotations' });
        return;
      }

      // Find the pending step for this user's role
      const step = quotation.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already approved' });
        return;
      }

      // Check same person hasn't already approved
      const alreadyApproved = quotation.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this quotation' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      if (result.isFullyApproved) {
        await prisma.quotation.update({
          where: { id: quotation.id },
          data: { status: QuotationStatus.APPROVED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        newValue: { stepId: step.id, comments: req.body.comments, acknowledged: true },
      });

      const updated = await prisma.quotation.findUnique({
        where: { id: quotation.id },
        include: quotationInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject — reject a quotation (any of 4 heads, in any order)
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotation = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!quotation || !quotation.approvalWorkflow) {
        res.status(404).json({ error: 'Quotation or approval workflow not found' });
        return;
      }

      // Check user is one of the approver roles
      if (!APPROVER_ROLES.some((role) => role === req.user!.role)) {
        res.status(403).json({ error: 'Only heads can reject quotations' });
        return;
      }

      // Find the pending step for this user's role
      const step = quotation.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already decided' });
        return;
      }

      // Check same person hasn't already decided
      const alreadyDecided = quotation.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && (s.status === 'APPROVED' || s.status === 'REJECTED')
      );
      if (alreadyDecided) {
        res.status(400).json({ error: 'You have already decided on this quotation' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      // A single rejection is enough to reject the entire quotation —
      // don't wait for minApprovers rejections. This prevents rejected
      // quotations from lingering in the pending/action-required list.
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { status: QuotationStatus.REJECTED },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        newValue: { stepId: step.id, reason, acknowledged: true },
      });

      const updated = await prisma.quotation.findUnique({
        where: { id: quotation.id },
        include: quotationInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/timeline — full chronological lifecycle of a quotation
// Combines audit logs + approval workflow steps + quotation metadata into a
// single timeline. Available to any user who can view quotations.
router.get(
  '/:id/timeline',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotation = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          createdByUser: { select: { id: true, name: true, role: true } },
          approvalWorkflow: {
            include: {
              steps: {
                orderBy: { stepNumber: 'asc' },
                include: { approverUser: { select: { id: true, name: true, role: true } } },
              },
            },
          },
        },
      });
      if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }

      // Fetch all audit logs for this quotation (bypassing the VIEW_AUDIT_LOG
      // RBAC check — any user who can see the quotation can see its timeline).
      const auditLogs = await prisma.auditLog.findMany({
        where: { entityType: 'QUOTATION', entityId: quotation.id, projectId },
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { timestamp: 'asc' },
      });

      type TimelineEvent = {
        timestamp: string;
        action: string;
        actionLabel: string;
        userName: string;
        userRole: string;
        details: Record<string, unknown>;
      };

      const timeline: TimelineEvent[] = [];

      // 1. Quotation created — use the quotation record itself
      timeline.push({
        timestamp: quotation.createdAt.toISOString(),
        action: 'CREATED',
        actionLabel: 'Quotation Created',
        userName: quotation.createdByUser?.name ?? 'System',
        userRole: quotation.createdByUser?.role ?? '',
        details: {
          quotationNumber: quotation.quotationNumber,
          vendor: quotation.vendor,
          status: quotation.status,
          hasFile: !!quotation.filePath,
          fileName: quotation.fileName,
        },
      });

      // 2. Audit log entries (UPDATE, DELETE, APPROVE, REJECT, and any
      //    duplicate CREATE entries from the service layer)
      const actionLabels: Record<string, string> = {
        CREATE: 'Quotation Created',
        UPDATE: 'Quotation Updated',
        DELETE: 'Quotation Deleted',
        APPROVE: 'Quotation Approved',
        REJECT: 'Quotation Rejected',
      };

      // Process audit log entries. APPROVE/REJECT are skipped here because the
      // approval workflow steps (added below) already capture those events with
      // richer data (approver user, comments, decidedAt). This avoids duplicate
      // timeline entries from two data sources.
      for (const log of auditLogs) {
        // Skip CREATE — already added from the quotation record above
        if (log.action === 'CREATE') continue;
        // Skip APPROVE/REJECT — workflow steps below cover these
        if (log.action === 'APPROVE' || log.action === 'REJECT') continue;

        const newValue = (log.newValue ?? {}) as Record<string, unknown>;
        const isFileUpdate =
          log.action === 'UPDATE' &&
          ('filePath' in newValue || 'fileName' in newValue || 'fileMimeType' in newValue);

        timeline.push({
          timestamp: log.timestamp.toISOString(),
          action: log.action,
          actionLabel: isFileUpdate
            ? 'File Attached / Updated'
            : actionLabels[log.action] ?? log.action,
          userName: log.user?.name ?? 'System',
          userRole: log.user?.role ?? '',
          details: {
            ...newValue,
            ...(log.oldValue ? { previousValues: log.oldValue } : {}),
          },
        });
      }

      // 3. Approval workflow steps — each decision is a timeline event
      if (quotation.approvalWorkflow) {
        for (const step of quotation.approvalWorkflow.steps) {
          if (step.status === 'PENDING') {
            timeline.push({
              timestamp: quotation.createdAt.toISOString(),
              action: 'PENDING_APPROVAL',
              actionLabel: `Pending — ${step.approverRole.replace(/_/g, ' ')}`,
              userName: '—',
              userRole: step.approverRole,
              details: { stepNumber: step.stepNumber, status: step.status },
            });
          } else {
            timeline.push({
              timestamp: step.decidedAt?.toISOString() ?? quotation.createdAt.toISOString(),
              action: step.status === 'APPROVED' ? 'STEP_APPROVED' : 'STEP_REJECTED',
              actionLabel:
                step.status === 'APPROVED'
                  ? `Approved by ${step.approverRole.replace(/_/g, ' ')}`
                  : `Rejected by ${step.approverRole.replace(/_/g, ' ')}`,
              userName: step.approverUser?.name ?? '—',
              userRole: step.approverRole,
              details: {
                stepNumber: step.stepNumber,
                status: step.status,
                comments: step.comments,
              },
            });
          }
        }
      }

      // Sort chronologically (oldest first)
      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.json({
        quotation: {
          id: quotation.id,
          quotationNumber: quotation.quotationNumber,
          vendor: quotation.vendor,
          status: quotation.status,
          grandTotal: quotation.grandTotal,
          fileName: quotation.fileName,
          filePath: quotation.filePath,
          createdAt: quotation.createdAt,
          createdByUser: quotation.createdByUser,
        },
        timeline,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
