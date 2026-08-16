import { Permission } from '@hospital-erp/shared';
import { createInvoiceSchema, updateInvoiceSchema, listInvoicesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

export default createCrudRouter({
  entityType: 'VENDOR_INVOICE',
  model: 'vendorInvoice',
  createPermission: Permission.VERIFY_INVOICE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createInvoiceSchema,
  updateSchema: updateInvoiceSchema,
  listSchema: listInvoicesSchema,
  include: {
    vendor: { select: { id: true, name: true } },
    purchaseOrder: { select: { id: true, poNumber: true } },
    createdByUser: { select: { id: true, name: true } },
  },
});
