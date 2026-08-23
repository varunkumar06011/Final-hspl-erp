import { Permission } from '@hospital-erp/shared';
import { createIssueSchema, updateIssueSchema, listIssuesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { notifyAllHeads } from '../services/push.service';

export default createCrudRouter({
  entityType: 'ISSUE',
  model: 'issue',
  createPermission: Permission.MANAGE_ISSUES,
  createSchema: createIssueSchema,
  updateSchema: updateIssueSchema,
  listSchema: listIssuesSchema,
  searchFields: ['title', 'description'],
  include: {
    createdByUser: { select: { id: true, name: true } },
  },
  afterCreate: async (record, _userId, projectId) => {
    await notifyAllHeads(projectId, {
      entityType: 'ISSUE',
      entityId: record.id as string,
      title: 'New Issue Reported',
      body: `${record.title}${record.priority ? ` — Priority: ${record.priority}` : ''}`,
      url: '/issues',
    });
  },
});
