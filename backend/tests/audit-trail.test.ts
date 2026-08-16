import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAudit, getAuditLogs } from '../src/services/audit.service';
import { AuditAction } from '@hospital-erp/shared';

const auditStore: any[] = [];

vi.mock('../src/config/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const entry = {
          id: `audit-${auditStore.length + 1}`,
          ...data,
          timestamp: new Date(),
          user: { id: data.userId, name: 'Test User', role: 'ADMIN' },
        };
        auditStore.push(entry);
        return entry;
      }),
      findMany: vi.fn(async ({ where, skip, take }: any) => {
        let results = [...auditStore];
        if (where.projectId) results = results.filter((e) => e.projectId === where.projectId);
        if (where.entityType) results = results.filter((e) => e.entityType === where.entityType);
        if (where.userId) results = results.filter((e) => e.userId === where.userId);
        return results.slice(skip, skip + take);
      }),
      count: vi.fn(async ({ where }: any) => {
        let results = [...auditStore];
        if (where.projectId) results = results.filter((e) => e.projectId === where.projectId);
        if (where.entityType) results = results.filter((e) => e.entityType === where.entityType);
        return results.length;
      }),
    },
  },
}));

describe('Audit Trail Tests', () => {
  beforeEach(() => {
    auditStore.length = 0;
    vi.clearAllMocks();
  });

  it('create vendor → AuditLog entry with action=CREATE', async () => {
    await logAudit({
      userId: 'user-1',
      action: AuditAction.CREATE,
      entityType: 'VENDOR',
      entityId: 'vendor-1',
      projectId: 'project-1',
      newValue: { name: 'Test Vendor', status: 'ACTIVE' },
    });

    expect(auditStore).toHaveLength(1);
    expect(auditStore[0].action).toBe(AuditAction.CREATE);
    expect(auditStore[0].entityType).toBe('VENDOR');
    expect(auditStore[0].entityId).toBe('vendor-1');
    expect(auditStore[0].newValue).toEqual({ name: 'Test Vendor', status: 'ACTIVE' });
  });

  it('update vendor → AuditLog entry with oldValue + newValue', async () => {
    await logAudit({
      userId: 'user-1',
      action: AuditAction.UPDATE,
      entityType: 'VENDOR',
      entityId: 'vendor-2',
      projectId: 'project-1',
      oldValue: { name: 'Old Name' },
      newValue: { name: 'New Name' },
    });

    expect(auditStore).toHaveLength(1);
    expect(auditStore[0].action).toBe(AuditAction.UPDATE);
    expect(auditStore[0].oldValue).toEqual({ name: 'Old Name' });
    expect(auditStore[0].newValue).toEqual({ name: 'New Name' });
  });

  it('delete vendor → AuditLog entry with action=DELETE', async () => {
    await logAudit({
      userId: 'user-1',
      action: AuditAction.DELETE,
      entityType: 'VENDOR',
      entityId: 'vendor-3',
      projectId: 'project-1',
    });

    expect(auditStore).toHaveLength(1);
    expect(auditStore[0].action).toBe(AuditAction.DELETE);
  });

  it('audit entries include correct userId and timestamp', async () => {
    const before = new Date();
    await logAudit({
      userId: 'user-2',
      action: AuditAction.APPROVE,
      entityType: 'PAYMENT_REQUEST',
      entityId: 'pr-1',
      projectId: 'project-1',
    });

    expect(auditStore[0].userId).toBe('user-2');
    expect(auditStore[0].timestamp).toBeDefined();
    expect(auditStore[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('getAuditLogs returns paginated results filtered by project', async () => {
    await logAudit({
      userId: 'user-1',
      action: AuditAction.CREATE,
      entityType: 'VENDOR',
      entityId: 'v-1',
      projectId: 'project-A',
    });
    await logAudit({
      userId: 'user-1',
      action: AuditAction.CREATE,
      entityType: 'VENDOR',
      entityId: 'v-2',
      projectId: 'project-B',
    });

    const result = await getAuditLogs('project-A', { page: 1, pageSize: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].entityId).toBe('v-1');
    expect(result.pagination.total).toBe(1);
  });
});
