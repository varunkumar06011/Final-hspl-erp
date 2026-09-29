import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  MPRStatus,
  AuditAction,
  UserRole,
  VendorType,
  isAdminRole,
  getRequiredApproverCount,
} from '@hospital-erp/shared';
import { createMPRSchema, updateMPRSchema, listMPRSchema, approvalActionSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateSequenceNumber } from '../services/sequence.service';
import { streamMprPdf } from '../services/mpr-pdf.service';
import * as approvalService from '../services/approval.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { notifyApprovers } from '../services/push.service';
import { createNonVendorPoFromMpr, findLivePoForMpr } from '../services/non-vendor-po.service';
import { ensureVendorLedger } from './ledger.routes';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const allowedReceiptFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

// "Half" approval = a PROJECT_HEAD or HEAD_OF_CONSTRUCTION approval on its own
// (needs an admin too to finish); "full" approval = a single ADMIN approval —
// this is the existing HEAD_GROUPS policy (see approval.service.ts), the same
// one used for invoices and journal vouchers.
const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION];

async function getMprApproverRoles(projectId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { projectId, isActive: true },
    select: { role: true },
  });
  const roles = new Set<string>(HEAD_ROLES as string[]);
  for (const u of users) {
    if (isAdminRole(u.role)) roles.add(u.role);
  }
  return Array.from(roles);
}

async function generateVendorCode(): Promise<string> {
  return generateSequenceNumber('vendor', 'vendorCode', 'VGH-', 3);
}

const router = Router();
router.use(authMiddleware);

const mprInclude = {
  createdByUser: { select: { id: true, name: true } },
  requestRaisedBy: { select: { id: true, name: true } },
  items: true,
  purchaseOrders: {
    where: { deletedAt: null, status: { notIn: ['DELETED', 'CANCELLED', 'REJECTED'] } },
    select: { id: true, poNumber: true, status: true },
  },
  vendor: { select: { id: true, name: true, vendorCode: true, vendorType: true, phone: true, contactPersonPhone: true } },
  quotations: {
    where: { deletedAt: null },
    select: { id: true, quotationNumber: true, status: true, totalAmount: true, grandTotal: true },
  },
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
  project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
};

/**
 * Resolves the vendor to raise this MPR against — either an existing vendor
 * (vendorId) or a brand-new one created inline from just a name + phone +
 * type (newVendor). The inline-created vendor is a real Vendor record, so it
 * immediately shows up in the Vendors module too.
 */
async function resolveVendor(
  body: Record<string, unknown>,
  projectId: string,
  userId: string,
): Promise<string | null> {
  if (body.vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: body.vendorId as string, projectId, deletedAt: null },
    });
    if (!vendor) {
      throw new Error('Vendor not found');
    }
    return vendor.id;
  }

  const newVendor = body.newVendor as { name: string; phone?: string; vendorType?: string } | undefined;
  if (newVendor?.name) {
    const vendorCode = await generateVendorCode();
    const vendor = await prisma.vendor.create({
      data: {
        projectId,
        vendorCode,
        name: newVendor.name,
        vendorType: newVendor.vendorType ?? VendorType.VENDOR,
        contactPersonPhone: newVendor.phone ?? null,
        phone: newVendor.phone ?? null,
        category: 'OTHER',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await ensureVendorLedger(vendor.id, projectId).catch((err) =>
      console.error(`[MPR] auto-ledger creation failed for new vendor ${vendor.id}:`, err),
    );
    return vendor.id;
  }

  return null;
}

// GET /next-material-code — next auto-increment item code (e.g. VGH-MAT-0021),
// continuing from the highest code already used in this project's MPR items.
router.get(
  '/next-material-code',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const rows = await prisma.materialPurchaseRequestItem.findMany({
        where: { materialCode: { contains: '-MAT-' }, mpr: { projectId } },
        select: { materialCode: true },
      });
      let prefix = 'MAT-';
      let max = 0;
      let width = 4;
      for (const r of rows) {
        const m = /^(.*-MAT-)(\d+)$/.exec(r.materialCode ?? '');
        if (!m) continue;
        const n = Number(m[2]);
        if (n >= max) {
          max = n;
          prefix = m[1];
          width = m[2].length;
        }
      }
      res.json({ prefix, next: max + 1, width });
    } catch (error) {
      next(error);
    }
  },
);

// GET / — list MPRs
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_MPR),
  validateMiddleware(listMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const vendorId = req.query.vendorId as string | undefined;

      const requestType = req.query.requestType as string | undefined;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (status) where.status = status;
      if (requestType) where.requestType = requestType;
      if (vendorId) where.vendorId = vendorId;
      if (search) where.mprNumber = { contains: search, mode: 'insensitive' };

      const [items, total] = await Promise.all([
        prisma.materialPurchaseRequest.findMany({
          where,
          include: mprInclude,
          orderBy: { date: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.materialPurchaseRequest.count({ where }),
      ]);

      res.json({ data: items, total, page, limit });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — single MPR
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: mprInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/variance — MPR requested vs Quotation quoted vs PO ordered,
// matched by material name across the chain (MPR → Quotation(s) → PO(s)).
router.get(
  '/:id/variance',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          items: true,
          quotations: {
            where: { deletedAt: null },
            include: {
              items: true,
              purchaseOrders: { where: { deletedAt: null }, include: { items: true } },
            },
          },
        },
      });
      if (!mpr) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }

      const key = (name: string) => name.trim().toLowerCase();

      type Row = {
        materialName: string;
        unit: string | null;
        requestedQty: number;
        quotedQty: number;
        quotedRate: number;
        orderedQty: number;
        orderedRate: number;
        qtyVarianceVsRequested: number; // quoted - requested
        qtyVarianceVsQuoted: number; // ordered - quoted
        rateVarianceVsQuoted: number; // ordered rate - quoted rate
      };

      const rows = new Map<string, Row>();
      const ensureRow = (materialName: string, unit: string | null) => {
        const k = key(materialName);
        let row = rows.get(k);
        if (!row) {
          row = {
            materialName,
            unit,
            requestedQty: 0,
            quotedQty: 0,
            quotedRate: 0,
            orderedQty: 0,
            orderedRate: 0,
            qtyVarianceVsRequested: 0,
            qtyVarianceVsQuoted: 0,
            rateVarianceVsQuoted: 0,
          };
          rows.set(k, row);
        }
        return row;
      };

      for (const item of mpr.items) {
        const row = ensureRow(item.materialName, item.unit);
        row.requestedQty += Number(item.quantity);
      }
      for (const quotation of mpr.quotations) {
        for (const item of quotation.items) {
          const row = ensureRow(item.materialName, item.unit);
          row.quotedQty += Number(item.quantity);
          row.quotedRate = Number(item.unitPrice); // last quotation wins if multiple
        }
        for (const po of quotation.purchaseOrders) {
          for (const item of po.items) {
            const row = ensureRow(item.materialName, item.unit);
            row.orderedQty += Number(item.quantity);
            row.orderedRate = Number(item.unitPrice);
          }
        }
      }

      const result = Array.from(rows.values()).map((row) => ({
        ...row,
        qtyVarianceVsRequested: row.quotedQty - row.requestedQty,
        qtyVarianceVsQuoted: row.orderedQty - row.quotedQty,
        rateVarianceVsQuoted: row.orderedRate - row.quotedRate,
      }));

      res.json({ mprId: mpr.id, mprNumber: mpr.mprNumber, items: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create MPR
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_MPR),
  validateMiddleware(createMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mprNumber = await generateSequenceNumber('materialPurchaseRequest', 'mprNumber', 'VGH-MPR', 3, { projectId });

      const vendorId = await resolveVendor(req.body, projectId, req.user!.id);

      const items = req.body.items;
      const estimatedGstRate = Number(req.body.estimatedGstRate) || 0;

      // Compute estimated amounts
      const computedItems = items.map((item: any) => {
        const qty = Number(item.quantity);
        const rate = Number(item.estimatedRate) || 0;
        return { ...item, estimatedAmount: qty * rate };
      });
      const estimatedSubtotal = computedItems.reduce((sum: number, item: any) => sum + Number(item.estimatedAmount), 0);
      const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
      const estimatedTotal = estimatedSubtotal + estimatedGstAmount;

      const record = await prisma.materialPurchaseRequest.create({
        data: {
          projectId,
          mprNumber,
          vendorId,
          requestType: req.body.requestType || 'MATERIAL',
          serviceCategory: req.body.serviceCategory || null,
          servicePeriodStart: req.body.servicePeriodStart ? new Date(req.body.servicePeriodStart) : null,
          servicePeriodEnd: req.body.servicePeriodEnd ? new Date(req.body.servicePeriodEnd) : null,
          requiredBy: req.body.requiredBy ? new Date(req.body.requiredBy) : null,
          department: req.body.department || null,
          priority: req.body.priority || null,
          status: MPRStatus.DRAFT,
          description: req.body.description || null,
          deliveryAddress: req.body.deliveryAddress || null,
          contactPerson: req.body.contactPerson || null,
          contactNumber: req.body.contactNumber || null,
          billingAddress: req.body.billingAddress || null,
          stateCode: req.body.stateCode || null,
          requestRaisedById: req.body.requestRaisedById || null,
          estimatedSubtotal,
          estimatedGstRate,
          estimatedGstAmount,
          estimatedTotal,
          technicalRequirements: req.body.technicalRequirements || null,
          createdBy: req.user!.id,
          items: {
            create: computedItems.map((item: any) => ({
              materialName: item.materialName,
              materialCode: item.materialCode || null,
              specification: item.specification || null,
              quantity: item.quantity,
              unit: item.unit || null,
              requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
              estimatedRate: item.estimatedRate,
              estimatedAmount: item.estimatedAmount,
              remarks: item.remarks || null,
            })),
          },
        },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CREATE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.status(201).json(record);
    } catch (error) {
      if (error instanceof Error && error.message === 'Vendor not found') {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

// PUT /:id — update MPR. Allowed while DRAFT or SUBMITTED (an edit made
// while awaiting approval resets and re-raises the approval workflow, since
// the numbers/items the approvers saw no longer match).
router.put(
  '/:id',
  rbacMiddleware(Permission.CREATE_MPR),
  validateMiddleware(updateMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      // An approved MPR can be edited too — it goes back through approval.
      const wasApproved = existing.status === MPRStatus.APPROVED;
      const wasSubmitted = existing.status === MPRStatus.SUBMITTED || wasApproved;
      if (existing.status !== MPRStatus.DRAFT && !wasSubmitted) {
        res.status(400).json({ error: 'Cannot edit MPR after it has been rejected, cancelled, or closed' });
        return;
      }
      if (wasApproved) {
        const [quotationCount, po] = await Promise.all([
          prisma.quotation.count({ where: { mprId: existing.id, deletedAt: null } }),
          findLivePoForMpr(existing.id),
        ]);
        if (po) {
          res.status(400).json({ error: `Purchase Order ${po.poNumber} has been raised from this request — it cannot be edited` });
          return;
        }
        if (quotationCount > 0) {
          res.status(400).json({ error: `This request has ${quotationCount} quotation(s) raised against it — it cannot be edited` });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (req.body.serviceCategory !== undefined) updateData.serviceCategory = req.body.serviceCategory || null;
      if (req.body.servicePeriodStart !== undefined) updateData.servicePeriodStart = req.body.servicePeriodStart ? new Date(req.body.servicePeriodStart) : null;
      if (req.body.servicePeriodEnd !== undefined) updateData.servicePeriodEnd = req.body.servicePeriodEnd ? new Date(req.body.servicePeriodEnd) : null;
      if (req.body.requiredBy !== undefined) updateData.requiredBy = req.body.requiredBy ? new Date(req.body.requiredBy) : null;
      if (req.body.department !== undefined) updateData.department = req.body.department || null;
      if (req.body.priority !== undefined) updateData.priority = req.body.priority || null;
      if (req.body.description !== undefined) updateData.description = req.body.description || null;
      if (req.body.deliveryAddress !== undefined) updateData.deliveryAddress = req.body.deliveryAddress || null;
      if (req.body.contactPerson !== undefined) updateData.contactPerson = req.body.contactPerson || null;
      if (req.body.contactNumber !== undefined) updateData.contactNumber = req.body.contactNumber || null;
      if (req.body.billingAddress !== undefined) updateData.billingAddress = req.body.billingAddress || null;
      if (req.body.stateCode !== undefined) updateData.stateCode = req.body.stateCode || null;
      if (req.body.requestRaisedById !== undefined) updateData.requestRaisedById = req.body.requestRaisedById || null;
      if (req.body.technicalRequirements !== undefined) updateData.technicalRequirements = req.body.technicalRequirements || null;
      if (req.body.estimatedGstRate !== undefined) updateData.estimatedGstRate = Number(req.body.estimatedGstRate);

      if (req.body.vendorId !== undefined || req.body.newVendor !== undefined) {
        updateData.vendorId = await resolveVendor(req.body, projectId, req.user!.id);
      }

      // If items are provided, recompute totals and replace items
      if (req.body.items) {
        const items = req.body.items;
        const estimatedGstRate = Number(updateData.estimatedGstRate ?? existing.estimatedGstRate);
        const computedItems = items.map((item: any) => {
          const qty = Number(item.quantity);
          const rate = Number(item.estimatedRate) || 0;
          return { ...item, estimatedAmount: qty * rate };
        });
        const estimatedSubtotal = computedItems.reduce((sum: number, item: any) => sum + Number(item.estimatedAmount), 0);
        const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
        const estimatedTotal = estimatedSubtotal + estimatedGstAmount;

        updateData.estimatedSubtotal = estimatedSubtotal;
        updateData.estimatedGstAmount = estimatedGstAmount;
        updateData.estimatedTotal = estimatedTotal;

        // Delete old items and create new ones
        await prisma.materialPurchaseRequestItem.deleteMany({ where: { mprId: req.params.id } });
        updateData.items = {
          create: computedItems.map((item: any) => ({
            materialName: item.materialName,
            materialCode: item.materialCode || null,
            specification: item.specification || null,
            quantity: item.quantity,
            unit: item.unit || null,
            requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
            estimatedRate: item.estimatedRate,
            estimatedAmount: item.estimatedAmount,
            remarks: item.remarks || null,
          })),
        };
      } else if (req.body.estimatedGstRate !== undefined) {
        // Recompute GST with new rate but existing items
        const estimatedSubtotal = Number(existing.estimatedSubtotal);
        const estimatedGstRate = Number(updateData.estimatedGstRate);
        const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
        updateData.estimatedGstAmount = estimatedGstAmount;
        updateData.estimatedTotal = estimatedSubtotal + estimatedGstAmount;
      }

      let approverRoles: string[] = [];
      let record;
      if (wasSubmitted) {
        approverRoles = await getMprApproverRoles(projectId);
        const newTotal = Number(updateData.estimatedTotal ?? existing.estimatedTotal);
        record = await prisma.$transaction(async (tx) => {
          await tx.approvalWorkflow.deleteMany({
            where: { entityType: 'MATERIAL_PURCHASE_REQUEST', entityId: existing.id },
          });

          const workflow = await tx.approvalWorkflow.create({
            data: {
              entityType: 'MATERIAL_PURCHASE_REQUEST',
              entityId: existing.id,
              projectId,
              status: 'VERIFICATION',
              currentStep: 0,
              minApprovers: getRequiredApproverCount(newTotal),
              approvalPolicy: 'HEAD_GROUPS',
              steps: {
                create: approverRoles.map((role, idx) => ({
                  stepNumber: idx + 1,
                  approverRole: role,
                  status: 'PENDING',
                })),
              },
            },
          });

          return tx.materialPurchaseRequest.update({
            where: { id: req.params.id },
            data: { ...updateData, approvalWorkflowId: workflow.id, status: MPRStatus.SUBMITTED },
            include: mprInclude,
          });
        });
      } else {
        record = await prisma.materialPurchaseRequest.update({
          where: { id: req.params.id },
          data: updateData,
          include: mprInclude,
        });
      }

      await logAudit({ userId: req.user!.id, action: AuditAction.UPDATE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });

      if (wasSubmitted) {
        notifyApprovers(projectId, approverRoles as UserRole[], {
          approvalId: record.approvalWorkflowId!,
          entityType: 'MATERIAL_PURCHASE_REQUEST',
          entityId: record.id,
          title: 'Material Purchase Request Updated — Approval Required',
          body: `Material Purchase Request ${record.mprNumber} — ₹${Number(record.estimatedTotal).toLocaleString('en-IN')}`,
          url: `/material-purchase-requests?id=${record.id}`,
        }).catch((err) => console.error('[Push] MPR notification error:', err));
      }

      res.json(record);
    } catch (error) {
      if (error instanceof Error && error.message === 'Vendor not found') {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

// POST /:id/submit — change status from DRAFT to SUBMITTED and kick off the
// approval workflow: a single ADMIN approval is enough on its own ("full"
// approval — Kaushal Sir); a PROJECT_HEAD or HEAD_OF_CONSTRUCTION approval
// on its own is only "half" — it still needs an admin's sign-off too
// (Nagarjuna Sir / Ashok Sir). Same HEAD_GROUPS policy used for invoices.
router.post(
  '/:id/submit',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status !== MPRStatus.DRAFT) {
        res.status(400).json({ error: 'Only DRAFT MPRs can be submitted' });
        return;
      }
      if (existing.items.length === 0) {
        res.status(400).json({ error: 'Cannot submit an MPR with no items' });
        return;
      }

      const approverRoles = await getMprApproverRoles(projectId);

      const record = await prisma.$transaction(async (tx) => {
        // A prior submit (e.g. before this MPR was cancelled/reset to draft) may have
        // left a workflow behind — entityType+entityId is unique, so clear it first.
        await tx.approvalWorkflow.deleteMany({
          where: { entityType: 'MATERIAL_PURCHASE_REQUEST', entityId: existing.id },
        });

        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'MATERIAL_PURCHASE_REQUEST',
            entityId: existing.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: getRequiredApproverCount(Number(existing.estimatedTotal)),
            approvalPolicy: 'HEAD_GROUPS',
            steps: {
              create: approverRoles.map((role, idx) => ({
                stepNumber: idx + 1,
                approverRole: role,
                status: 'PENDING',
              })),
            },
          },
        });

        return tx.materialPurchaseRequest.update({
          where: { id: existing.id },
          data: { status: MPRStatus.SUBMITTED, approvalWorkflowId: workflow.id },
          include: mprInclude,
        });
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.SUBMIT_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });

      notifyApprovers(projectId, approverRoles as UserRole[], {
        approvalId: record.approvalWorkflowId!,
        entityType: 'MATERIAL_PURCHASE_REQUEST',
        entityId: record.id,
        title: 'New Approval Required',
        body: `Material Purchase Request ${record.mprNumber} — ₹${Number(record.estimatedTotal).toLocaleString('en-IN')}`,
        url: `/material-purchase-requests?id=${record.id}`,
      }).catch((err) => console.error('[Push] MPR notification error:', err));

      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!mpr || !mpr.approvalWorkflow) {
        res.status(404).json({ error: 'Material Purchase Request or approval workflow not found' });
        return;
      }
      if (mpr.status !== MPRStatus.SUBMITTED) {
        res.status(400).json({ error: `Cannot approve an MPR that is ${mpr.status.replace(/_/g, ' ').toLowerCase()}` });
        return;
      }
      if (!HEAD_ROLES.includes(req.user!.role as UserRole) && !isAdminRole(req.user!.role)) {
        res.status(403).json({ error: 'Only heads can approve material purchase requests' });
        return;
      }

      const step = mpr.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already approved' });
        return;
      }
      const alreadyApproved = mpr.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this request' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      if (result.isFullyApproved) {
        await prisma.materialPurchaseRequest.update({
          where: { id: mpr.id },
          data: { status: MPRStatus.APPROVED },
        }).catch((err) => console.error('[MPR] Safety-net status sync failed (non-fatal):', err));

        // Non-vendor requests have no quotation — go straight to a PO (amount 0, to be filled in).
        await createNonVendorPoFromMpr(mpr.id, projectId, req.user!.id)
          .catch((err) => console.error('[MPR] Non-vendor PO auto-create failed (non-fatal):', err));
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'MATERIAL_PURCHASE_REQUEST',
        entityId: mpr.id,
        projectId,
        newValue: { stepId: step.id, comments: req.body.comments, acknowledged: true },
      });

      const updated = await prisma.materialPurchaseRequest.findUnique({
        where: { id: mpr.id },
        include: mprInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!mpr || !mpr.approvalWorkflow) {
        res.status(404).json({ error: 'Material Purchase Request or approval workflow not found' });
        return;
      }
      if (mpr.status !== MPRStatus.SUBMITTED) {
        res.status(400).json({ error: `Cannot reject an MPR that is ${mpr.status.replace(/_/g, ' ').toLowerCase()}` });
        return;
      }
      if (!HEAD_ROLES.includes(req.user!.role as UserRole) && !isAdminRole(req.user!.role)) {
        res.status(403).json({ error: 'Only heads can reject material purchase requests' });
        return;
      }

      const step = mpr.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already decided' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.materialPurchaseRequest.update({
          where: { id: mpr.id },
          data: { status: MPRStatus.REJECTED },
        }).catch((err) => console.error('[MPR] Safety-net status sync failed (non-fatal):', err));
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'MATERIAL_PURCHASE_REQUEST',
        entityId: mpr.id,
        projectId,
        newValue: { stepId: step.id, reason },
      });

      const updated = await prisma.materialPurchaseRequest.findUnique({
        where: { id: mpr.id },
        include: mprInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/receipt — NON_VENDOR fast path: attach a receipt/bill and close
// the MPR directly, skipping the Quotation module entirely.
router.post(
  '/:id/receipt',
  rbacMiddleware(Permission.CREATE_MPR),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { vendor: true },
      });
      if (!mpr) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (mpr.status !== MPRStatus.APPROVED) {
        res.status(400).json({ error: 'Only an approved MPR can be settled with a receipt' });
        return;
      }
      if (mpr.vendor?.vendorType === VendorType.VENDOR) {
        res.status(400).json({ error: 'This request is raised against a vendor — raise a Quotation instead of uploading a receipt directly' });
        return;
      }
      if (await findLivePoForMpr(mpr.id)) {
        res.status(400).json({ error: 'A Purchase Order has been raised for this request — manage it from the Purchase Orders page' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'A receipt/bill file is required' });
        return;
      }
      if (!allowedReceiptFileTypes.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'Receipt must be a PDF or supported image' });
        return;
      }

      const isImage = req.file.mimetype.startsWith('image/');
      const subPath = isImage ? 'images' : 'documents';
      const prefixedFileName = `mpr-receipts/${subPath}/${mpr.mprNumber}-${req.file.originalname}`;
      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: mpr.id },
        data: {
          receiptFilePath: uploadResult.filePath,
          receiptFileName: req.file.originalname,
          receiptFileMimeType: req.file.mimetype,
          status: MPRStatus.CLOSED,
          description: req.body.notes ? `${mpr.description ? mpr.description + '\n' : ''}${req.body.notes}` : mpr.description,
        },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CLOSE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber, receiptFileName: req.file.originalname } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/receipt — serve the uploaded receipt/bill file
router.get(
  '/:id/receipt',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!mpr) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (!mpr.receiptFilePath) {
        res.status(404).json({ error: 'No receipt attached' });
        return;
      }
      await serveFile(res, mpr.receiptFilePath, mpr.receiptFileMimeType);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/switch-type — flip a request between MATERIAL and SERVICE,
// keeping everything already entered (items, vendor, approvals). Service-only
// fields are cleared when switching back to MATERIAL.
router.post(
  '/:id/switch-type',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.CLOSED || existing.status === MPRStatus.CANCELLED) {
        res.status(400).json({ error: `A ${existing.status.toLowerCase()} request cannot be switched` });
        return;
      }
      const newType = existing.requestType === 'SERVICE' ? 'MATERIAL' : 'SERVICE';
      const record = await prisma.materialPurchaseRequest.update({
        where: { id: existing.id },
        data: newType === 'MATERIAL'
          ? { requestType: newType, serviceCategory: null, servicePeriodStart: null, servicePeriodEnd: null }
          : { requestType: newType },
        include: mprInclude,
      });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'MATERIAL_PURCHASE_REQUEST',
        entityId: existing.id,
        projectId,
        oldValue: { requestType: existing.requestType },
        newValue: { requestType: newType },
      });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/cancel — cancel an MPR
router.post(
  '/:id/cancel',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.CLOSED || existing.status === MPRStatus.CANCELLED) {
        res.status(400).json({ error: 'Cannot cancel a closed or already cancelled MPR' });
        return;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { status: MPRStatus.CANCELLED },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CANCEL_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/close — close an MPR (after POs created)
router.post(
  '/:id/close',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.CANCELLED) {
        res.status(400).json({ error: 'Cannot close a cancelled MPR' });
        return;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { status: MPRStatus.CLOSED },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CLOSE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete. DRAFT MPRs can be deleted by their editors; an
// APPROVED MPR can only be deleted by Vinod Sir (ADMIN_2), and only while no
// quotation or purchase order has been raised from it.
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.APPROVED) {
        if (req.user!.role !== UserRole.ADMIN_2) {
          res.status(403).json({ error: 'Only Vinod Sir can delete an approved request' });
          return;
        }
        const [quotationCount, po] = await Promise.all([
          prisma.quotation.count({ where: { mprId: existing.id, deletedAt: null } }),
          findLivePoForMpr(existing.id),
        ]);
        if (po || quotationCount > 0) {
          res.status(400).json({ error: 'A quotation or purchase order has been raised from this request — remove it first' });
          return;
        }
      } else if (existing.status !== MPRStatus.DRAFT) {
        res.status(400).json({ error: 'Only DRAFT or APPROVED MPRs can be deleted' });
        return;
      }

      await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.DELETE_MPR, entityType: 'material_purchase_requests', entityId: req.params.id, projectId, newValue: { mprNumber: existing.mprNumber } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/pdf — generate and download PDF
router.get(
  '/:id/pdf',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          ...mprInclude,
          project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
        },
      });
      if (!mpr) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${mpr.mprNumber}.pdf"`);
      await streamMprPdf(res as unknown as NodeJS.WritableStream, mpr);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
