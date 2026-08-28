import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, UserRole } from '@hospital-erp/shared';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

const uuid = z.string().uuid();

// ── Schemas ──
const requestRevisionSchema = z.object({
  body: z.object({
    budgetHeadId: uuid,
    newSlNo: z.number().int().positive().optional(),
    newParticulars: z.string().trim().min(1).max(500).optional(),
    newAllocated: z.number().nonnegative().optional(),
    newStatus: z.string().trim().max(20).optional(),
    reason: z.string().trim().min(5).max(1000),
  }),
});

const reviewRevisionSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    approved: z.boolean(),
    comments: z.string().trim().max(1000).optional(),
  }),
});

const listRevisionsSchema = z.object({
  query: z.object({
    budgetHeadId: uuid.optional(),
    status: z.string().optional(),
  }).optional(),
});

// ── GET / — list revisions (with optional filters) ──
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listRevisionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const where: Record<string, unknown> = { projectId };
      if (req.query.budgetHeadId) where.budgetHeadId = req.query.budgetHeadId;
      if (req.query.status) where.status = req.query.status;

      const revisions = await prisma.budgetRevision.findMany({
        where,
        include: {
          budgetHead: { select: { id: true, particulars: true, slNo: true } },
          requestedByUser: { select: { id: true, name: true, role: true } },
          reviewedByUser: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ data: revisions });
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /request — request a budget head edit (creates a pending revision) ──
router.post(
  '/request',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(requestRevisionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { budgetHeadId, newSlNo, newParticulars, newAllocated, newStatus, reason } = req.body;

      const head = await prisma.budgetHead.findFirst({
        where: { id: budgetHeadId, projectId, deletedAt: null },
      });
      if (!head) {
        res.status(404).json({ error: 'Budget head not found' });
        return;
      }

      // Check there's at least one change
      const hasChange =
        (newSlNo !== undefined && newSlNo !== head.slNo) ||
        (newParticulars !== undefined && newParticulars !== head.particulars) ||
        (newAllocated !== undefined && Number(newAllocated) !== Number(head.allocatedAmount)) ||
        (newStatus !== undefined && newStatus !== head.status);
      if (!hasChange) {
        res.status(400).json({ error: 'No changes detected. Provide at least one field to edit.' });
        return;
      }

      // Check no existing pending revision for this head
      const existingPending = await prisma.budgetRevision.findFirst({
        where: { budgetHeadId, projectId, status: 'PENDING' },
      });
      if (existingPending) {
        res.status(409).json({ error: 'A pending revision request already exists for this budget head. Review it first.' });
        return;
      }

      const revision = await prisma.budgetRevision.create({
        data: {
          projectId,
          budgetHeadId,
          oldSlNo: head.slNo,
          oldParticulars: head.particulars,
          oldAllocated: head.allocatedAmount,
          oldStatus: head.status,
          newSlNo: newSlNo ?? null,
          newParticulars: newParticulars ?? null,
          newAllocated: newAllocated !== undefined ? Number(newAllocated) : null,
          newStatus: newStatus ?? null,
          reason,
          requestedBy: req.user!.id,
          status: 'PENDING',
        },
        include: {
          budgetHead: { select: { id: true, particulars: true, slNo: true } },
          requestedByUser: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BUDGET_REVISION',
        entityId: revision.id,
        projectId,
        newValue: { budgetHeadId, reason, status: 'PENDING' },
      });

      res.status(201).json(revision);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /:id/review — approve or reject a revision (Admin or Admin_2 only) ──
router.post(
  '/:id/review',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(reviewRevisionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { approved, comments } = req.body;

      // Only ADMIN or ADMIN_2 can review budget revisions
      const userRole = req.user!.role as UserRole;
      if (![UserRole.ADMIN, UserRole.ADMIN_2].includes(userRole)) {
        res.status(403).json({ error: 'Only Admin or Admin 2 can review budget revisions' });
        return;
      }

      const revision = await prisma.budgetRevision.findFirst({
        where: { id: req.params.id, projectId },
        include: { budgetHead: true },
      });
      if (!revision) {
        res.status(404).json({ error: 'Budget revision not found' });
        return;
      }
      if (revision.status !== 'PENDING') {
        res.status(400).json({ error: `Revision already ${revision.status}` });
        return;
      }

      await prisma.$transaction(async (tx) => {
        // Update revision status
        await tx.budgetRevision.update({
          where: { id: revision.id },
          data: {
            status: approved ? 'APPROVED' : 'REJECTED',
            reviewedBy: req.user!.id,
            reviewedAt: new Date(),
            reviewComments: comments ?? null,
          },
        });

        // If approved, apply the changes to the budget head
        if (approved) {
          const updateData: Record<string, unknown> = {};
          if (revision.newSlNo !== null) updateData.slNo = revision.newSlNo;
          if (revision.newParticulars !== null) updateData.particulars = revision.newParticulars;
          if (revision.newAllocated !== null) updateData.allocatedAmount = revision.newAllocated;
          if (revision.newStatus !== null) updateData.status = revision.newStatus;

          await tx.budgetHead.update({
            where: { id: revision.budgetHeadId },
            data: updateData,
          });

          await tx.budgetRevision.update({
            where: { id: revision.id },
            data: { status: 'APPLIED', appliedAt: new Date() },
          });
        }
      });

      await logAudit({
        userId: req.user!.id,
        action: approved ? AuditAction.APPROVE : AuditAction.REJECT,
        entityType: 'BUDGET_REVISION',
        entityId: revision.id,
        projectId,
        newValue: { approved, comments, applied: approved },
      });

      const finalRecord = await prisma.budgetRevision.findUnique({
        where: { id: revision.id },
        include: {
          budgetHead: { select: { id: true, particulars: true, slNo: true, allocatedAmount: true, status: true } },
          requestedByUser: { select: { id: true, name: true } },
          reviewedByUser: { select: { id: true, name: true } },
        },
      });

      res.json(finalRecord);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /:id/history — revision history for a specific budget head ──
router.get(
  '/:budgetHeadId/history',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const revisions = await prisma.budgetRevision.findMany({
        where: { projectId, budgetHeadId: req.params.budgetHeadId },
        include: {
          requestedByUser: { select: { id: true, name: true, role: true } },
          reviewedByUser: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ data: revisions });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
