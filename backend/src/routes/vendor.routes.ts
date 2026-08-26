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
  defaultSort: { vendorCode: 'asc' },
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
});
