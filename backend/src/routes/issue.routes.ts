import { Permission } from '@hospital-erp/shared';
import { createIssueSchema, updateIssueSchema, listIssuesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';

export default createCrudRouter({
  entityType: 'ISSUE',
  model: 'issue',
  createPermission: Permission.MANAGE_ISSUES,
  createSchema: createIssueSchema,
  updateSchema: updateIssueSchema,
  listSchema: listIssuesSchema,
  searchFields: ['title', 'description'],
  include: {
    phase: { select: { id: true, name: true } },
    activity: { select: { id: true, name: true } },
    createdByUser: { select: { id: true, name: true } },
  },
});
