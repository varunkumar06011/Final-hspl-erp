import { Permission } from '@hospital-erp/shared';
import { createPhaseSchema, updatePhaseSchema, listPhasesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

export default createCrudRouter({
  entityType: 'PHASE',
  model: 'phase',
  createPermission: Permission.MANAGE_PHASES,
  createSchema: createPhaseSchema,
  updateSchema: updatePhaseSchema,
  listSchema: listPhasesSchema,
  searchFields: ['name'],
  include: {
    activities: {
      where: { deletedAt: null },
      select: { id: true, name: true, status: true, progressPercent: true, plannedStart: true, plannedEnd: true },
    },
    createdByUser: { select: { id: true, name: true } },
  },
  defaultSort: { createdAt: 'asc' },
});
