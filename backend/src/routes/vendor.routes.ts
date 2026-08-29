import { Permission } from '@hospital-erp/shared';
import { createVendorSchema, updateVendorSchema, listVendorsSchema } from '@hospital-erp/shared';
import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { notifyAllHeads } from '../services/push.service';
import { generateSequenceNumber } from '../services/sequence.service';

interface MaterialInput {
  id?: string;
  name: string;
  unit?: string;
}

// Block vendor deletion if any financial records reference it
async function validateVendorDeletion(vendorId: string): Promise<void> {
  const [invoices, quotations, pos, paymentRequests] = await Promise.all([
    prisma.vendorInvoice.count({ where: { vendorId, deletedAt: null } }),
    prisma.quotation.count({ where: { vendorId, deletedAt: null } }),
    prisma.purchaseOrder.count({ where: { vendorId, deletedAt: null } }),
    prisma.paymentRequest.count({ where: { vendorId, deletedAt: null } }),
  ]);
  if (invoices > 0) {
    throw new Error(`Cannot delete vendor with ${invoices} existing invoice(s)`);
  }
  if (quotations > 0) {
    throw new Error(`Cannot delete vendor with ${quotations} existing quotation(s)`);
  }
  if (pos > 0) {
    throw new Error(`Cannot delete vendor with ${pos} existing purchase order(s)`);
  }
  if (paymentRequests > 0) {
    throw new Error(`Cannot delete vendor with ${paymentRequests} existing payment request(s)`);
  }
}

async function generateVendorCode(): Promise<string> {
  return generateSequenceNumber('vendor', 'vendorCode', 'VGH-', 3);
}

const router = createCrudRouter({
  entityType: 'VENDOR',
  model: 'vendor',
  createPermission: Permission.CREATE_VENDOR,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
  listSchema: listVendorsSchema,
  searchFields: ['name', 'vendorCode', 'gstNumber', 'phone', 'contactPersonName', 'contactPersonPhone', 'referenceBy'],
  include: {
    createdByUser: { select: { id: true, name: true } },
    materials: { orderBy: { name: 'asc' } },
  },
  defaultSort: { createdAt: 'desc' },
  transformList: async (records, projectId) => {
    const vendorIds = records.map((vendor) => String(vendor.id));
    if (vendorIds.length === 0) return records;

    const [invoices, paidRequests, paidAdvances] = await Promise.all([
      prisma.vendorInvoice.findMany({
        where: { projectId, vendorId: { in: vendorIds }, deletedAt: null },
        select: { vendorId: true, totalAmount: true, advancePaid: true },
      }),
      prisma.paymentRequest.findMany({
        where: {
          projectId,
          invoiceId: { not: null },
          status: 'PAID',
          deletedAt: null,
          invoice: { vendorId: { in: vendorIds } },
        },
        select: { amount: true, invoice: { select: { vendorId: true } } },
      }),
      // Also count PAID ADVANCE payment requests linked to POs for these vendors.
      // Without this, PO-level advance payments never enter the vendor's "total paid"
      // figure, creating a false impression that money hasn't been sent to the vendor.
      prisma.paymentRequest.findMany({
        where: {
          projectId,
          type: 'ADVANCE',
          status: 'PAID',
          deletedAt: null,
          vendorId: { in: vendorIds },
        },
        select: { amount: true, vendorId: true },
      }),
    ]);

    const totals = new Map(vendorIds.map((vendorId) => [vendorId, { billed: 0, paid: 0 }]));
    for (const invoice of invoices) {
      const total = totals.get(invoice.vendorId);
      if (total) {
        total.billed += Number(invoice.totalAmount);
        // A19: Do NOT add invoice.advancePaid to total.paid here.
        // advancePaid is a manual claim on the invoice, not actual cash sent.
        // The actual cash is counted below from PAID payment requests and
        // PAID PO advance payments. Adding advancePaid here double-counts the
        // same physical advance (once as a claim, once as the actual payment).
      }
    }
    for (const request of paidRequests) {
      const total = request.invoice ? totals.get(request.invoice.vendorId) : undefined;
      if (total) total.paid += Number(request.amount);
    }
    for (const advance of paidAdvances) {
      const total = advance.vendorId ? totals.get(advance.vendorId) : undefined;
      if (total) total.paid += Number(advance.amount);
    }

    return records.map((vendor) => {
      const total = totals.get(String(vendor.id)) ?? { billed: 0, paid: 0 };
      return {
        ...vendor,
        totalBilled: total.billed,
        totalPaid: total.paid,
        outstanding: Math.max(0, total.billed - total.paid),
      };
    });
  },
  transformCreate: async (body, userId, projectId) => {
    const vendorCode = await generateVendorCode();
    const materials = (body.materials as MaterialInput[] | undefined) ?? [];

    return {
      projectId,
      vendorCode,
      name: body.name,
      contactPersonName: body.contactPersonName ?? null,
      contactPersonPhone: body.contactPersonPhone ?? null,
      referenceBy: body.referenceBy ?? null,
      gstNumber: body.gstNumber ?? null,
      panNumber: body.panNumber ?? null,
      category: body.category ?? 'OTHER',
      bankName: body.bankName ?? null,
      bankAccountNumber: body.bankAccountNumber ?? null,
      ifscCode: body.ifscCode ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      status: body.status ?? 'ACTIVE',
      rating: body.rating ?? 0,
      createdBy: userId,
      materials: {
        create: materials.map((m) => ({
          name: m.name,
          unit: m.unit ?? null,
        })),
      },
    };
  },
  transformUpdate: async (body, _userId, _projectId, existingId) => {
    const data: Record<string, unknown> = {};

    // Copy scalar fields
    for (const key of ['name', 'contactPersonName', 'contactPersonPhone', 'referenceBy', 'gstNumber', 'panNumber', 'category', 'bankName', 'bankAccountNumber', 'ifscCode', 'address', 'phone', 'email', 'status', 'rating']) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    // Handle materials sync: delete all existing and recreate
    if (body.materials !== undefined) {
      const materials = body.materials as MaterialInput[];
      await prisma.vendorMaterial.deleteMany({ where: { vendorId: existingId } });
      data.materials = {
        create: materials.map((m) => ({
          name: m.name,
          unit: m.unit ?? null,
        })),
      };
    }

    return data;
  },
  afterCreate: async (record, _userId, projectId) => {
    await notifyAllHeads(projectId, {
      entityType: 'VENDOR',
      entityId: record.id as string,
      title: 'New Vendor Created',
      body: `Vendor ${record.name} (${record.vendorCode}) added`,
      url: '/vendors',
    });
  },
  beforeDelete: validateVendorDeletion,
});

// GET /:id/trace — all records linked to a vendor (reverse traceability).
// Returns quotations, purchase orders, assets, invoices, and payment requests
// so the vendor view can show a complete history of everything tied to them.
router.get(
  '/:id/trace',
  authMiddleware,
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendor = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: {
          id: true, vendorCode: true, name: true, referenceBy: true, contactPersonName: true,
          contactPersonPhone: true, phone: true, email: true, gstNumber: true, address: true,
          category: true, status: true, rating: true,
          quotations: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, quotationNumber: true, date: true, status: true, grandTotal: true },
          },
          purchaseOrders: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, poNumber: true, date: true, status: true, grandTotal: true, budgetHead: { select: { id: true, particulars: true } } },
          },
          assets: {
            orderBy: { assetId: 'asc' },
            select: { id: true, assetId: true, status: true, location: true, totalCost: true, inventoryItem: { select: { id: true, name: true } } },
          },
          invoices: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, invoiceNumber: true, date: true, totalAmount: true, stockStatus: true },
          },
          paymentRequests: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, requestNumber: true, amount: true, status: true, type: true, createdAt: true },
          },
        },
      });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      res.json(vendor);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
