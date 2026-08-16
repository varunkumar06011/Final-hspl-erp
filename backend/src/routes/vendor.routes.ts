import { Permission } from '@hospital-erp/shared';
import { createVendorSchema, updateVendorSchema, listVendorsSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

export default createCrudRouter({
  entityType: 'VENDOR',
  model: 'vendor',
  createPermission: Permission.CREATE_VENDOR,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
  listSchema: listVendorsSchema,
  searchFields: ['name', 'gstNumber', 'phone'],
  include: { createdByUser: { select: { id: true, name: true } } },
  defaultSort: { name: 'asc' },
});
