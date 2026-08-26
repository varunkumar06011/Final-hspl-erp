import { Permission } from '@hospital-erp/shared';
import { createVendorSchema, updateVendorSchema, listVendorsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { notifyAllHeads } from '../services/push.service';

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
  const vendors = await prisma.vendor.findMany({
    where: { vendorCode: { startsWith: 'VGH-' } },
    select: { vendorCode: true },
  });
  const maxNum = vendors.reduce((max, v) => {
    const match = v.vendorCode?.match(/^VGH-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-${String(maxNum + 1).padStart(3, '0')}`;
}

export default createCrudRouter({
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

    const [invoices, paidRequests] = await Promise.all([
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
    ]);

    const totals = new Map(vendorIds.map((vendorId) => [vendorId, { billed: 0, paid: 0 }]));
    for (const invoice of invoices) {
      const total = totals.get(invoice.vendorId);
      if (total) {
        total.billed += Number(invoice.totalAmount);
        total.paid += Number(invoice.advancePaid);
      }
    }
    for (const request of paidRequests) {
      const total = request.invoice ? totals.get(request.invoice.vendorId) : undefined;
      if (total) total.paid += Number(request.amount);
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
