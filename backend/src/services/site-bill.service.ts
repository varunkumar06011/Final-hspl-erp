import {
  AuditAction,
  FIRST_LEVEL_APPROVER_ROLES,
  MPRStatus,
  POPaymentType,
  POStatus,
  SITE_BILL_LIMIT,
  SITE_PURCHASES_VENDOR_NAME,
  UserRole,
  VendorType,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { logAudit } from './audit.service';
import { notifyApprovers } from './push.service';
import { generateProjectSequenceNumber } from './sequence.service';
import { HEAD_THEN_ADMIN_POLICY, headThenAdminSteps } from './approval.service';
import { generatePONumber, getActiveAdminRoles } from './non-vendor-po.service';
import { ensureVendorLedger } from '../routes/ledger.routes';

/**
 * Site bills: small purchases (≤ SITE_BILL_LIMIT) the site person pays for and
 * brings a proper bill for. Each bill is stored as an already-approved material
 * request (no approval of its own) with the bill attached. Several bills are then
 * combined into ONE purchase order against the project's "Site Purchases
 * (Reimbursement)" vendor; that PO goes through the normal PO approval.
 */

const DEAD_PO_STATUSES: string[] = [POStatus.DELETED, POStatus.CANCELLED, POStatus.REJECTED];

/** A refused site-bill action; `status` is the HTTP status to answer with. */
export class SiteBillError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SiteBillItemInput {
  materialName: string;
  quantity: number;
  unit?: string;
  rate: number;
}

/** Line amounts and bill total; refuses an empty bill or one above the limit. */
export function priceSiteBill(items: SiteBillItemInput[]) {
  const lines = items.map((i) => ({ ...i, amount: round2(Number(i.quantity) * Number(i.rate)) }));
  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  if (total <= 0) throw new SiteBillError('Enter the amount of the bill');
  if (total > SITE_BILL_LIMIT) {
    throw new SiteBillError(
      `A site bill can be at most ₹${SITE_BILL_LIMIT.toLocaleString('en-IN')} (this one is ₹${total.toLocaleString('en-IN')}). Raise a normal material request for it.`,
    );
  }
  return { lines, total };
}

/** The project's "Site Purchases (Reimbursement)" vendor, created (or restored) on first use. */
export async function ensureSitePurchasesVendor(projectId: string, userId: string): Promise<string> {
  const existing = await prisma.vendor.findFirst({
    where: { projectId, name: SITE_PURCHASES_VENDOR_NAME },
    select: { id: true, deletedAt: true },
  });
  if (existing) {
    if (existing.deletedAt) {
      await prisma.vendor.update({ where: { id: existing.id }, data: { deletedAt: null, status: 'ACTIVE' } });
    }
    return existing.id;
  }
  const vendorCode = await generateProjectSequenceNumber('vendor', 'vendorCode', '', 3, projectId);
  const vendor = await prisma.vendor.create({
    data: {
      projectId,
      vendorCode,
      name: SITE_PURCHASES_VENDOR_NAME,
      vendorType: VendorType.NON_VENDOR,
      category: 'OTHER',
      status: 'ACTIVE',
      description: 'Bills paid at site and reimbursed to the person who paid',
      createdBy: userId,
    },
  });
  await ensureVendorLedger(vendor.id, projectId).catch((err) =>
    console.error(`[SiteBills] ledger creation failed for vendor ${vendor.id}:`, err),
  );
  return vendor.id;
}

export interface CreateSiteBillInput {
  projectId: string;
  userId: string;
  billDate: Date;
  shopName: string;
  paymentMode: string;
  description?: string | null;
  paidById?: string | null;
  items: SiteBillItemInput[];
  file: { filePath: string; fileName: string; mimeType: string } | null;
  mprNumber: string;
}

export async function createSiteBill(input: CreateSiteBillInput) {
  const { lines, total } = priceSiteBill(input.items);
  const vendorId = await ensureSitePurchasesVendor(input.projectId, input.userId);

  const bill = await prisma.materialPurchaseRequest.create({
    data: {
      projectId: input.projectId,
      mprNumber: input.mprNumber,
      vendorId,
      requestType: 'MATERIAL',
      status: MPRStatus.APPROVED,
      isSiteBill: true,
      billDate: input.billDate,
      billShopName: input.shopName,
      billPaymentMode: input.paymentMode,
      description: input.description || null,
      requestRaisedById: input.paidById || input.userId,
      estimatedSubtotal: total,
      estimatedGstRate: 0,
      estimatedGstAmount: 0,
      estimatedTotal: total,
      receiptFilePath: input.file?.filePath ?? null,
      receiptFileName: input.file?.fileName ?? null,
      receiptFileMimeType: input.file?.mimeType ?? null,
      createdBy: input.userId,
      items: {
        create: lines.map((l) => ({
          materialName: l.materialName,
          quantity: l.quantity,
          unit: l.unit || null,
          estimatedRate: l.rate,
          estimatedAmount: l.amount,
        })),
      },
    },
  });

  await logAudit({
    userId: input.userId,
    action: AuditAction.CREATE_MPR,
    entityType: 'material_purchase_requests',
    entityId: bill.id,
    projectId: input.projectId,
    newValue: { mprNumber: bill.mprNumber, siteBill: true, shopName: input.shopName, total, paymentMode: input.paymentMode },
  });
  return bill;
}

/** Ids of the POs (among `poIds`) that are still alive. */
async function livePoIds(poIds: string[]): Promise<Set<string>> {
  if (poIds.length === 0) return new Set();
  const pos = await prisma.purchaseOrder.findMany({
    where: { id: { in: poIds }, deletedAt: null, status: { notIn: DEAD_PO_STATUSES } },
    select: { id: true },
  });
  return new Set(pos.map((p) => p.id));
}

export interface ListSiteBillsFilter {
  filter?: 'open' | 'in_po' | 'all';
  dateFrom?: Date;
  dateTo?: Date;
  paymentMode?: string;
  search?: string;
}

export async function listSiteBills(projectId: string, f: ListSiteBillsFilter) {
  const billDate: Record<string, Date> = {};
  if (f.dateFrom) billDate.gte = f.dateFrom;
  if (f.dateTo) billDate.lte = new Date(f.dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
  const bills = await prisma.materialPurchaseRequest.findMany({
    where: {
      projectId,
      deletedAt: null,
      isSiteBill: true,
      status: { not: MPRStatus.CANCELLED },
      ...(f.paymentMode ? { billPaymentMode: f.paymentMode } : {}),
      ...(Object.keys(billDate).length ? { billDate } : {}),
    },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      requestRaisedBy: { select: { id: true, name: true } },
      createdByUser: { select: { id: true, name: true } },
    },
    orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
  });

  const poIds = Array.from(new Set(bills.map((b) => b.sitePoId).filter((id): id is string => !!id)));
  const pos = poIds.length
    ? await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, poNumber: true, status: true, deletedAt: true } })
    : [];
  const poById = new Map(pos.map((p) => [p.id, p]));

  const words = (f.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = bills
    .map((b) => {
      const po = b.sitePoId ? poById.get(b.sitePoId) : undefined;
      const livePo = po && !po.deletedAt && !DEAD_PO_STATUSES.includes(po.status) ? po : undefined;
      return {
        id: b.id,
        mprNumber: b.mprNumber,
        billDate: b.billDate ?? b.date,
        shopName: b.billShopName,
        paymentMode: b.billPaymentMode,
        description: b.description,
        total: Number(b.estimatedTotal),
        items: b.items.map((i) => ({
          materialName: i.materialName,
          quantity: Number(i.quantity),
          unit: i.unit,
          rate: Number(i.estimatedRate),
          amount: Number(i.estimatedAmount),
        })),
        paidBy: b.requestRaisedBy,
        createdBy: b.createdByUser,
        createdAt: b.createdAt,
        fileName: b.receiptFileName,
        hasFile: !!b.receiptFilePath,
        po: livePo ? { id: livePo.id, poNumber: livePo.poNumber, status: livePo.status } : null,
        // The PO this bill was in before it was rejected/cancelled (bill is free again).
        previousPo: po && !livePo ? { id: po.id, poNumber: po.poNumber, status: po.status } : null,
      };
    })
    .filter((r) => (f.filter === 'open' ? !r.po : f.filter === 'in_po' ? !!r.po : true))
    .filter((r) => {
      if (words.length === 0) return true;
      const text = [r.mprNumber, r.shopName, r.description, r.paidBy?.name, r.po?.poNumber, String(r.total), ...r.items.map((i) => i.materialName)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    });

  const open = rows.filter((r) => !r.po);
  return {
    data: rows,
    summary: { count: rows.length, openCount: open.length, openTotal: round2(open.reduce((s, r) => s + r.total, 0)), limit: SITE_BILL_LIMIT },
  };
}

/** Cancel a bill that is not (or no longer) in a live PO. */
export async function cancelSiteBill(projectId: string, billId: string, userId: string) {
  const bill = await prisma.materialPurchaseRequest.findFirst({
    where: { id: billId, projectId, deletedAt: null, isSiteBill: true },
  });
  if (!bill) throw new SiteBillError('Site bill not found', 404);
  if (bill.sitePoId && (await livePoIds([bill.sitePoId])).size > 0) {
    throw new SiteBillError('This bill is part of a purchase order. Reject or delete that PO first.');
  }
  await prisma.materialPurchaseRequest.update({
    where: { id: bill.id },
    data: { status: MPRStatus.CANCELLED, deletedAt: new Date() },
  });
  await logAudit({
    userId,
    action: AuditAction.CANCEL_MPR,
    entityType: 'material_purchase_requests',
    entityId: bill.id,
    projectId,
    newValue: { mprNumber: bill.mprNumber, siteBill: true },
  });
}

export interface GenerateSiteBillPoInput {
  projectId: string;
  userId: string;
  billIds: string[];
  paymentType: string;
  reimburseTo?: string;
  budgetHeadId?: string;
  notes?: string;
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One PO for several site bills: every bill's items become PO lines, the PO goes
 * straight to approval (no budget head needed) and the bills are linked to it.
 */
export async function generateSiteBillPo(input: GenerateSiteBillPoInput) {
  const { projectId, userId } = input;
  const billIds = Array.from(new Set(input.billIds));
  const bills = await prisma.materialPurchaseRequest.findMany({
    where: { id: { in: billIds }, projectId, deletedAt: null, isSiteBill: true, status: { not: MPRStatus.CANCELLED } },
    include: { items: { orderBy: { createdAt: 'asc' } }, requestRaisedBy: { select: { name: true } } },
    orderBy: [{ billDate: 'asc' }, { createdAt: 'asc' }],
  });
  if (bills.length !== billIds.length) throw new SiteBillError('Some of the selected bills were not found. Refresh and try again.');

  const linkedPoIds = Array.from(new Set(bills.map((b) => b.sitePoId).filter((id): id is string => !!id)));
  const alive = await livePoIds(linkedPoIds);
  const taken = bills.filter((b) => b.sitePoId && alive.has(b.sitePoId));
  if (taken.length > 0) {
    throw new SiteBillError(`Already in a purchase order: ${taken.map((b) => b.mprNumber).join(', ')}`);
  }
  const deadPoIds = linkedPoIds.filter((id) => !alive.has(id));

  if (input.budgetHeadId) {
    const head = await prisma.budgetHead.findFirst({ where: { id: input.budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
    if (!head) throw new SiteBillError('Budget head not found');
  }

  const lines = bills.flatMap((b) =>
    b.items.map((i) => ({
      materialName: i.materialName,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.estimatedRate,
      amount: i.estimatedAmount,
      gstRate: 0,
    })),
  );
  const total = round2(bills.reduce((s, b) => s + Number(b.estimatedTotal), 0));
  if (total <= 0) throw new SiteBillError('The selected bills have no amount');

  const payers = Array.from(new Set(bills.map((b) => b.requestRaisedBy?.name).filter((n): n is string => !!n)));
  const reimburseTo = input.reimburseTo?.trim() || payers.join(', ') || null;
  const billList = bills
    .map((b) => `${b.mprNumber} — ${b.billShopName ?? ''} (${fmtDate(b.billDate ?? b.date)}, ₹${Number(b.estimatedTotal).toLocaleString('en-IN')}, ${b.billPaymentMode ?? ''})`)
    .join('\n');
  const notes = `${input.notes?.trim() ? `${input.notes.trim()}\n` : ''}Site bills:\n${billList}`;
  const paymentType = input.paymentType || POPaymentType.FULL_PAYMENT;
  const advanceAmount = paymentType === POPaymentType.AFTER_DELIVERY ? null : total;

  const vendorId = await ensureSitePurchasesVendor(projectId, userId);
  const poNumber = await generatePONumber(projectId);
  const adminRoles = await getActiveAdminRoles(projectId);

  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        projectId,
        vendorId,
        poNumber,
        status: POStatus.PENDING_APPROVAL,
        paymentType,
        advanceAmount,
        notes,
        totalAmount: total,
        gstAmount: 0,
        grandTotal: total,
        totalDeductions: 0,
        netPayable: total,
        budgetHeadId: input.budgetHeadId ?? null,
        isSiteBillBatch: true,
        reimburseTo,
        createdBy: userId,
        items: { create: lines },
      },
    });
    const workflow = await tx.approvalWorkflow.create({
      data: {
        entityType: 'PURCHASE_ORDER',
        entityId: created.id,
        projectId,
        status: 'VERIFICATION',
        currentStep: 0,
        minApprovers: 1,
        approvalPolicy: HEAD_THEN_ADMIN_POLICY,
        steps: { create: headThenAdminSteps(adminRoles) },
      },
    });
    // Claim the bills; if another PO took one meanwhile, nothing is saved.
    const claimed = await tx.materialPurchaseRequest.updateMany({
      where: {
        id: { in: billIds },
        OR: [{ sitePoId: null }, ...(deadPoIds.length ? [{ sitePoId: { in: deadPoIds } }] : [])],
      },
      data: { sitePoId: created.id, status: MPRStatus.CLOSED },
    });
    if (claimed.count !== billIds.length) {
      throw new SiteBillError('Some of the selected bills were just added to another purchase order. Refresh and try again.', 409);
    }
    return tx.purchaseOrder.update({ where: { id: created.id }, data: { approvalWorkflowId: workflow.id } });
  });

  await logAudit({
    userId,
    action: AuditAction.CREATE,
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    projectId,
    newValue: { poNumber, source: 'SITE_BILLS', bills: bills.map((b) => b.mprNumber), grandTotal: total, reimburseTo, acknowledged: true },
  });

  notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
    approvalId: po.approvalWorkflowId ?? '',
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    title: 'New Approval Required',
    body: `Purchase Order ${poNumber} — ${bills.length} site bill(s) — ₹${total}`,
    url: `/pos?id=${po.id}`,
  }).catch((err) => console.error('[Push] Site bill PO notification error:', err));

  return po;
}
