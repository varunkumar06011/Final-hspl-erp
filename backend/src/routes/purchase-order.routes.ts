import { Permission } from '@hospital-erp/shared';
import { createPOSchema, updatePOSchema, listPOsSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
}

function buildItemsWithTotals(items: LineItem[]) {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    amount: item.quantity * item.rate,
  }));
}

export default createCrudRouter({
  entityType: 'PURCHASE_ORDER',
  model: 'purchaseOrder',
  createPermission: Permission.CREATE_PO,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createPOSchema,
  updateSchema: updatePOSchema,
  listSchema: listPOsSchema,
  include: {
    vendor: { select: { id: true, name: true } },
    quotation: { select: { id: true, quotationNumber: true } },
    phase: { select: { id: true, name: true } },
    items: true,
    createdByUser: { select: { id: true, name: true } },
  },
  transformCreate: (body, userId, projectId) => {
    const items = buildItemsWithTotals(body.items as LineItem[]);
    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    return {
      projectId,
      vendorId: body.vendorId,
      quotationId: body.quotationId ?? null,
      phaseId: body.phaseId ?? null,
      poNumber: body.poNumber,
      deliveryDate: body.deliveryDate ?? null,
      status: body.status,
      notes: body.notes ?? null,
      totalAmount,
      createdBy: userId,
      items: { create: items },
    };
  },
});
