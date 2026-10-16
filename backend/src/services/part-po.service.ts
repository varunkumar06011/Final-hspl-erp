/**
 * Balance sub-POs ("part POs").
 *
 * A normal approved PO keeps its full amount, budget commitment and vendor payable.
 * When it is paid in parts, each further part is raised as a sub-PO
 * (<PO>-SUB01, -SUB02 ...) that goes through the normal approval and payment flow
 * but adds NOTHING to the budget commitment or the vendor payable (the main PO
 * already holds the whole amount). Goods are received against the main PO only.
 *
 * No schema change: a part PO is a PO whose `parentPoId` points at the main PO and
 * whose `regenerationNumber` is 0 (regenerated POs always start at 1).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/** Prisma filter that leaves part POs out (commitments, receiving, dashboards). */
export const EXCLUDE_PART_POS: Prisma.PurchaseOrderWhereInput = {
  NOT: { parentPoId: { not: null }, regenerationNumber: 0 },
};

export function isPartPo(po: { parentPoId?: string | null; regenerationNumber?: number | null }): boolean {
  return !!po.parentPoId && (po.regenerationNumber ?? 0) === 0;
}

const DEAD_STATUSES = ['DELETED', 'REJECTED', 'CANCELLED'];

/** Amount of the main PO not yet paid and not yet covered by a live sub-PO. */
export async function partPoBalance(main: { id: string; grandTotal: unknown; netPayable: unknown }): Promise<{
  total: number;
  paid: number;
  inSubPos: number;
  remaining: number;
}> {
  const total = Number(main.netPayable) > 0 ? Number(main.netPayable) : Number(main.grandTotal);
  const [paidAgg, subAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'PAID', paymentRequest: { poId: main.id, deletedAt: null } },
      _sum: { amount: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { parentPoId: main.id, regenerationNumber: 0, deletedAt: null, status: { notIn: DEAD_STATUSES } },
      _sum: { grandTotal: true },
    }),
  ]);
  const paid = Number(paidAgg._sum.amount) || 0;
  const inSubPos = Number(subAgg._sum.grandTotal) || 0;
  const remaining = Math.max(0, Math.round((total - paid - inSubPos) * 100) / 100);
  return { total, paid, inSubPos, remaining };
}
