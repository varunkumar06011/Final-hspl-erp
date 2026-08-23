import { Permission } from '@hospital-erp/shared';
import { createPhaseSchema, updatePhaseSchema, listPhasesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { notifyAllHeads } from '../services/push.service';

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
  afterCreate: async (record, _userId, projectId) => {
    await notifyAllHeads(projectId, {
      entityType: 'PHASE',
      entityId: record.id as string,
      title: 'New Phase Created',
      body: `Phase "${record.name}" created`,
      url: '/dashboard',
    });
  },
});
