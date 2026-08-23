import { Permission } from '@hospital-erp/shared';
import { createContractSchema, updateContractSchema, listContractsSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { notifyAllHeads } from '../services/push.service';

export default createCrudRouter({
  entityType: 'CONTRACT',
  model: 'contract',
  createPermission: Permission.MANAGE_CONTRACTS,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createContractSchema,
  updateSchema: updateContractSchema,
  listSchema: listContractsSchema,
  include: {
    vendor: { select: { id: true, name: true } },
    milestones: { orderBy: { dueDate: 'asc' as const } },
    createdByUser: { select: { id: true, name: true } },
  },
  transformCreate: (body, userId, projectId) => ({
    projectId,
    vendorId: body.vendorId,
    type: body.type,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    value: body.value,
    advancePercent: body.advancePercent ?? 0,
    retentionPercent: body.retentionPercent ?? 0,
    createdBy: userId,
    milestones: body.milestones
      ? { create: body.milestones as { name: string; dueDate?: Date; amount: number }[] }
      : undefined,
  }),
  afterCreate: async (record, _userId, projectId) => {
    const vendorName = (record as any).vendor?.name ?? 'vendor';
    await notifyAllHeads(projectId, {
      entityType: 'CONTRACT',
      entityId: record.id as string,
      title: 'New Contract Created',
      body: `Contract with ${vendorName} — ₹${record.value}`,
      url: '/contracts',
    });
  },
});
