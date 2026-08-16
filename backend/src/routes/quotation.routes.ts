import { Permission } from '@hospital-erp/shared';
import { createQuotationSchema, updateQuotationSchema, listQuotationsSchema } from '@hospital-erp/shared';
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
  entityType: 'QUOTATION',
  model: 'quotation',
  createPermission: Permission.CREATE_QUOTATION,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createQuotationSchema,
  updateSchema: updateQuotationSchema,
  listSchema: listQuotationsSchema,
  include: {
    vendor: { select: { id: true, name: true } },
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
      phaseId: body.phaseId ?? null,
      quotationNumber: body.quotationNumber,
      status: body.status,
      notes: body.notes ?? null,
      totalAmount,
      createdBy: userId,
      items: { create: items },
    };
  },
});
