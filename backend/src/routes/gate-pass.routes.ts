import { Permission } from '@hospital-erp/shared';
import { createGatePassSchema, updateGatePassSchema, listGatePassesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

export default createCrudRouter({
  entityType: 'GATE_PASS',
  model: 'gatePass',
  createPermission: Permission.CREATE_GATE_PASS,
  createSchema: createGatePassSchema,
  updateSchema: updateGatePassSchema,
  listSchema: listGatePassesSchema,
  searchFields: ['passNumber', 'vehicleNumber', 'driverName'],
  include: {
    purchaseOrder: { select: { id: true, poNumber: true } },
    invoice: { select: { id: true, invoiceNumber: true } },
    items: true,
    createdByUser: { select: { id: true, name: true } },
  },
  transformCreate: (body, userId, projectId) => ({
    projectId,
    poId: body.poId ?? null,
    invoiceId: body.invoiceId ?? null,
    passNumber: body.passNumber,
    type: body.type,
    vehicleNumber: body.vehicleNumber ?? null,
    driverName: body.driverName ?? null,
    carrierName: body.carrierName ?? null,
    createdBy: userId,
    items: { create: body.items as { description: string; quantity: number; unit: string }[] },
  }),
});
