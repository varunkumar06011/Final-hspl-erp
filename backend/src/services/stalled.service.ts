import { prisma } from '../config/prisma';

/**
 * "Approved but not moved forward": records that finished approval and are still
 * waiting for the next step of the procurement chain
 * (MPR -> quotation -> PO -> goods receipt -> invoice -> payment request -> payment).
 * Read-only; everything is derived from existing rows and always scoped to one project.
 */

/** A record is only marked once it has waited this long after approval. */
export const STALLED_AFTER_MS = 2 * 60 * 60 * 1000;

export type StalledType = 'MPR' | 'QUOTATION' | 'PO' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT_REQUEST';

export interface StalledItem {
  type: StalledType;
  id: string;
  number: string;
  party: string | null;
  /** When the record became "approved" (workflow approval time, else last update). */
  since: string;
  /** Translation key suffix describing the missing next step. */
  waitingFor: 'QUOTATION_OR_PO' | 'PO' | 'GOODS_RECEIPT' | 'GOODS_RECEIPT_POST' | 'PAYMENT_REQUEST' | 'PAYMENT';
}

const DEAD_STATUSES = ['REJECTED', 'CANCELLED', 'DELETED'];

const approvedAt = (workflow: { status: string; updatedAt: Date } | null | undefined, fallback: Date) =>
  workflow?.status === 'APPROVED' ? workflow.updatedAt : fallback;

export interface StalledScope {
  MPR: boolean;
  QUOTATION: boolean;
  PO: boolean;
  GOODS_RECEIPT: boolean;
  INVOICE: boolean;
  PAYMENT_REQUEST: boolean;
}

export async function findStalled(projectId: string, scope: StalledScope, now = new Date()): Promise<StalledItem[]> {
  const cutoff = new Date(now.getTime() - STALLED_AFTER_MS);
  const wf = { select: { status: true, updatedAt: true } };
  const out: StalledItem[] = [];

  if (scope.MPR) {
    const rows = await prisma.materialPurchaseRequest.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: 'APPROVED',
        receiptFilePath: null,
        quotations: { none: { deletedAt: null } },
        purchaseOrders: { none: { status: { notIn: DEAD_STATUSES } } },
      },
      select: { id: true, mprNumber: true, updatedAt: true, vendor: { select: { name: true } }, approvalWorkflow: wf },
    });
    for (const r of rows) {
      out.push({ type: 'MPR', id: r.id, number: r.mprNumber, party: r.vendor?.name ?? null, since: approvedAt(r.approvalWorkflow, r.updatedAt).toISOString(), waitingFor: 'QUOTATION_OR_PO' });
    }
  }

  if (scope.QUOTATION) {
    const rows = await prisma.quotation.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: 'APPROVED',
        purchaseOrders: { none: { status: { notIn: DEAD_STATUSES } } },
      },
      select: { id: true, quotationNumber: true, updatedAt: true, vendor: { select: { name: true } }, approvalWorkflow: wf },
    });
    for (const r of rows) {
      out.push({ type: 'QUOTATION', id: r.id, number: r.quotationNumber, party: r.vendor.name, since: approvedAt(r.approvalWorkflow, r.updatedAt).toISOString(), waitingFor: 'PO' });
    }
  }

  if (scope.PO) {
    const rows = await prisma.purchaseOrder.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: 'APPROVED',
        isContract: false,
        goodsReceipts: { none: { deletedAt: null } },
        invoices: { none: { deletedAt: null } },
        advancePaymentRequests: { none: { deletedAt: null } },
        gatePasses: { none: {} },
      },
      select: { id: true, poNumber: true, updatedAt: true, vendor: { select: { name: true } }, approvalWorkflow: wf },
    });
    for (const r of rows) {
      out.push({ type: 'PO', id: r.id, number: r.poNumber, party: r.vendor.name, since: approvedAt(r.approvalWorkflow, r.updatedAt).toISOString(), waitingFor: 'GOODS_RECEIPT' });
    }
  }

  if (scope.GOODS_RECEIPT) {
    const rows = await prisma.goodsReceipt.findMany({
      where: { projectId, deletedAt: null, status: 'READY_TO_POST' },
      select: { id: true, receiptNumber: true, updatedAt: true, inspectedAt: true, purchaseOrder: { select: { vendor: { select: { name: true } } } } },
    });
    for (const r of rows) {
      out.push({ type: 'GOODS_RECEIPT', id: r.id, number: r.receiptNumber, party: r.purchaseOrder.vendor.name, since: (r.inspectedAt ?? r.updatedAt).toISOString(), waitingFor: 'GOODS_RECEIPT_POST' });
    }
  }

  if (scope.INVOICE) {
    const rows = await prisma.vendorInvoice.findMany({
      where: {
        projectId,
        deletedAt: null,
        paymentStatus: 'PENDING',
        OR: [{ verificationStatus: 'VERIFIED' }, { approvalWorkflow: { status: 'APPROVED' } }],
        paymentRequests: { none: { deletedAt: null, status: { notIn: DEAD_STATUSES } } },
      },
      select: { id: true, invoiceCode: true, updatedAt: true, vendor: { select: { name: true } }, approvalWorkflow: wf },
    });
    for (const r of rows) {
      out.push({ type: 'INVOICE', id: r.id, number: r.invoiceCode, party: r.vendor.name, since: approvedAt(r.approvalWorkflow, r.updatedAt).toISOString(), waitingFor: 'PAYMENT_REQUEST' });
    }
  }

  if (scope.PAYMENT_REQUEST) {
    const rows = await prisma.paymentRequest.findMany({
      where: { projectId, deletedAt: null, status: 'APPROVED', payments: { none: {} } },
      select: { id: true, requestNumber: true, updatedAt: true, vendor: { select: { name: true } }, approvalWorkflow: wf },
    });
    for (const r of rows) {
      out.push({ type: 'PAYMENT_REQUEST', id: r.id, number: r.requestNumber, party: r.vendor?.name ?? null, since: approvedAt(r.approvalWorkflow, r.updatedAt).toISOString(), waitingFor: 'PAYMENT' });
    }
  }

  return out.filter((i) => new Date(i.since) <= cutoff).sort((a, b) => a.since.localeCompare(b.since));
}
