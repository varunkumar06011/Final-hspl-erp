import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../config/prisma';

const router = Router();
router.use(authMiddleware);

// Activity Log — a read-only, human-friendly "who did what, and when" feed for
// every signed-in user. It merges the audit trail (approvals, rejections,
// creates, edits, deletes) with record comments. It stores nothing itself.

// Audit rows about these are account-management noise, not project activity.
const HIDDEN_AUDIT_ENTITIES = ['USER'];

interface ActivityItem {
  id: string;
  kind: 'AUDIT' | 'COMMENT';
  action: string; // AuditAction value, or COMMENT
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  url: string | null;
  actor: { id: string; name: string; role: string } | null;
  at: Date;
  note: string | null; // approval/rejection remark or comment text
  mentions: Array<{ id: string; name: string }>;
}

// Human reference (PO number, invoice code, ...) for the audited record types
// that have one; other types simply show without a label.
async function resolveLabels(pairs: Array<{ entityType: string; entityId: string }>) {
  const idsOf = (type: string) => Array.from(new Set(pairs.filter((p) => p.entityType === type).map((p) => p.entityId)));
  const labels = new Map<string, string>();
  const put = (id: string, label: string | null | undefined) => {
    if (label) labels.set(id, label);
  };

  const [quotations, pos, invoices, payments, mprs, jvs, vendors] = await Promise.all([
    prisma.quotation.findMany({ where: { id: { in: idsOf('QUOTATION') } }, select: { id: true, quotationNumber: true } }),
    prisma.purchaseOrder.findMany({ where: { id: { in: idsOf('PURCHASE_ORDER') } }, select: { id: true, poNumber: true } }),
    prisma.vendorInvoice.findMany({ where: { id: { in: idsOf('VENDOR_INVOICE') } }, select: { id: true, invoiceCode: true } }),
    prisma.paymentRequest.findMany({ where: { id: { in: idsOf('PAYMENT_REQUEST') } }, select: { id: true, paymentCode: true } }),
    prisma.materialPurchaseRequest.findMany({ where: { id: { in: idsOf('MATERIAL_PURCHASE_REQUEST') } }, select: { id: true, mprNumber: true } }),
    prisma.journalVoucher.findMany({ where: { id: { in: idsOf('JOURNAL_VOUCHER') } }, select: { id: true, jvNumber: true } }),
    prisma.vendor.findMany({ where: { id: { in: idsOf('VENDOR') } }, select: { id: true, name: true } }),
  ]);
  quotations.forEach((r) => put(r.id, r.quotationNumber));
  pos.forEach((r) => put(r.id, r.poNumber));
  invoices.forEach((r) => put(r.id, r.invoiceCode));
  payments.forEach((r) => put(r.id, r.paymentCode));
  mprs.forEach((r) => put(r.id, r.mprNumber));
  jvs.forEach((r) => put(r.id, r.jvNumber));
  vendors.forEach((r) => put(r.id, r.name));
  return labels;
}

function auditNote(newValue: unknown): string | null {
  if (!newValue || typeof newValue !== 'object') return null;
  const v = newValue as Record<string, unknown>;
  const text = v.comments ?? v.reason;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

// GET /activity-log?userId=&action=&from=&to=&page=&pageSize=
//   action: APPROVE | REJECT | CREATE | UPDATE | DELETE | COMMENT (omit = all)
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const projectId = req.user!.projectId ?? null;
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(q.pageSize ?? '20', 10) || 20));
    const window = page * pageSize; // each source is read to this depth, then merged

    const range: Prisma.DateTimeFilter = {};
    if (q.from && !isNaN(Date.parse(q.from))) range.gte = new Date(q.from);
    if (q.to && !isNaN(Date.parse(q.to))) {
      const end = new Date(q.to);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    const hasRange = !!(range.gte || range.lte);

    const wantAudit = q.action !== 'COMMENT';
    const wantComments = !q.action || q.action === 'COMMENT';

    const auditWhere: Prisma.AuditLogWhereInput = {
      ...(projectId && { projectId }),
      entityType: { notIn: HIDDEN_AUDIT_ENTITIES },
      ...(q.userId && { userId: q.userId }),
      ...(q.action && q.action !== 'COMMENT' && { action: q.action }),
      ...(hasRange && { timestamp: range }),
    };
    const commentWhere: Prisma.CommentWhereInput = {
      ...(projectId && { projectId }),
      ...(q.userId && { authorId: q.userId }),
      ...(hasRange && { createdAt: range }),
    };

    const [audits, auditTotal, comments, commentTotal] = await Promise.all([
      wantAudit
        ? prisma.auditLog.findMany({
            where: auditWhere,
            orderBy: { timestamp: 'desc' },
            take: window,
            include: { user: { select: { id: true, name: true, role: true } } },
          })
        : [],
      wantAudit ? prisma.auditLog.count({ where: auditWhere }) : 0,
      wantComments
        ? prisma.comment.findMany({
            where: commentWhere,
            orderBy: { createdAt: 'desc' },
            take: window,
            include: { author: { select: { id: true, name: true, role: true } } },
          })
        : [],
      wantComments ? prisma.comment.count({ where: commentWhere }) : 0,
    ]);

    const labels = await resolveLabels(audits.map((a) => ({ entityType: a.entityType, entityId: a.entityId })));

    const items: ActivityItem[] = [
      ...audits.map((a): ActivityItem => ({
        id: `a:${a.id}`,
        kind: 'AUDIT',
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        entityLabel: labels.get(a.entityId) ?? null,
        url: null,
        actor: a.user,
        at: a.timestamp,
        note: auditNote(a.newValue),
        mentions: [],
      })),
      ...comments.map((c): ActivityItem => ({
        id: `c:${c.id}`,
        kind: 'COMMENT',
        action: 'COMMENT',
        entityType: c.entityType,
        entityId: c.entityId,
        entityLabel: c.entityLabel,
        url: c.url,
        actor: c.author,
        at: c.createdAt,
        note: c.body,
        mentions: Array.isArray(c.mentions) ? (c.mentions as unknown as ActivityItem['mentions']) : [],
      })),
    ];

    items.sort((x, y) => y.at.getTime() - x.at.getTime());
    const total = auditTotal + commentTotal;
    res.json({
      data: items.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
