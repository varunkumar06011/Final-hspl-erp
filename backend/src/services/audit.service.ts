import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AuditAction } from '@hospital-erp/shared';

interface LogAuditParams {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
}

export async function logAudit({
  userId,
  action,
  entityType,
  entityId,
  projectId,
  oldValue,
  newValue,
}: LogAuditParams): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      projectId: projectId ?? null,
      oldValue: oldValue ? (oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
      newValue: newValue ? (newValue as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

export async function getAuditLogs(
  projectId: string,
  filters: {
    entityType?: string;
    userId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  }
) {
  const { entityType, userId, action, startDate, endDate, page = 1, pageSize = 20 } = filters;

  const where: Prisma.AuditLogWhereInput = {
    projectId,
    ...(entityType && { entityType }),
    ...(userId && { userId }),
    ...(action && { action: action as AuditAction }),
    ...(startDate || endDate
      ? {
          timestamp: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data: logs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
