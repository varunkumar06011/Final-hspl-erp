import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { PaymentStatus } from '@hospital-erp/shared';

/**
 * Calculate paid-to-date for an invoice: advance + sum of all PAID payment request amounts.
 * Returns { paidToDate, outstanding, totalAmount, advancePaid, installmentsPaid,
 *           poAdvancePaid, unclaimedAdvance }.
 *
 * poAdvancePaid: total actual PAID advance payment requests on the linked PO.
 * unclaimedAdvance: paid on PO but not yet claimed by any invoice (poAdvancePaid - sum of all invoice advancePaid on that PO).
 *
 * These cross-reference fields expose the connection between actual PO advances and
 * the invoice's claimed advance, preventing a parallel financial reality where the
 * invoice says "advancePaid = ₹2L" while ₹3L was actually paid on the PO.
 *
 * Accepts optional transaction client for use inside transactions.
 */
export async function getInvoicePaymentSummary(invoiceId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const invoice = await client.vendorInvoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, advancePaid: true, poId: true },
  });
  if (!invoice) throw new Error('Invoice not found');

  const paidRequests = await client.paymentRequest.findMany({
    where: { invoiceId, status: PaymentStatus.PAID, deletedAt: null },
    select: { amount: true },
  });

  const installmentsPaid = paidRequests.reduce((sum, pr) => sum + Number(pr.amount), 0);

  const advancePaid = Number(invoice.advancePaid) || 0;
  const totalAmount = Number(invoice.totalAmount) || 0;

  // Cross-reference with actual paid advances on the linked PO.
  // The unclaimed portion of PO advances (paid but not yet claimed on any
  // invoice) is allocated to invoices in date order so the SAME advance is
  // never counted against multiple invoices — preventing double-payment.
  let poAdvancePaid = 0;
  let unclaimedAdvance = 0;
  let allocatedUnclaimed = 0;
  if (invoice.poId) {
    const [paidAdvancesOnPo, claimedByInvoices] = await Promise.all([
      client.paymentRequest.aggregate({
        where: { poId: invoice.poId, type: 'ADVANCE', status: PaymentStatus.PAID, deletedAt: null },
        _sum: { amount: true },
      }),
      client.vendorInvoice.aggregate({
        where: { poId: invoice.poId, deletedAt: null },
        _sum: { advancePaid: true },
      }),
    ]);
    poAdvancePaid = Number(paidAdvancesOnPo._sum.amount) || 0;
    const totalClaimed = Number(claimedByInvoices._sum.advancePaid) || 0;
    unclaimedAdvance = Math.max(0, poAdvancePaid - totalClaimed);

    // Allocate unclaimed advance to invoices in date order, each capped at its
    // remaining (totalAmount - its own advancePaid), until exhausted.
    if (unclaimedAdvance > 0) {
      const poInvoices = await client.vendorInvoice.findMany({
        where: { poId: invoice.poId, deletedAt: null },
        select: { id: true, totalAmount: true, advancePaid: true, date: true },
        orderBy: { date: 'asc' },
      });
      let remainingPool = unclaimedAdvance;
      for (const inv of poInvoices) {
        if (remainingPool <= 0) break;
        const cap = Math.max(0, Number(inv.totalAmount) - Number(inv.advancePaid));
        const share = Math.min(remainingPool, cap);
        if (inv.id === invoiceId) {
          allocatedUnclaimed = share;
          break;
        }
        remainingPool -= share;
      }
    }
  }

  // This invoice's effective advance = its own claimed advance + its allocated
  // share of unclaimed PO advances, capped at the invoice total.
  const effectiveAdvance = Math.min(totalAmount, advancePaid + allocatedUnclaimed);
  const paidToDate = effectiveAdvance + installmentsPaid;
  const outstanding = totalAmount - paidToDate;

  return { totalAmount, advancePaid, installmentsPaid, paidToDate, outstanding, poAdvancePaid, unclaimedAdvance };
}

/**
 * Recalculate and update invoice payment status based on outstanding balance.
 * - outstanding <= 0 → PAID
 * - paidToDate > 0 but outstanding > 0 → PARTIALLY_PAID
 * - paidToDate === 0 → PENDING
 * Accepts optional transaction client for use inside transactions.
 */
export async function recalcInvoicePaymentStatus(invoiceId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const { paidToDate, outstanding } = await getInvoicePaymentSummary(invoiceId, tx);
  let status: PaymentStatus;
  if (outstanding <= 0) {
    status = PaymentStatus.PAID;
  } else if (paidToDate > 0) {
    status = PaymentStatus.PARTIALLY_PAID;
  } else {
    status = PaymentStatus.PENDING;
  }
  const client = tx ?? prisma;
  await client.vendorInvoice.update({
    where: { id: invoiceId },
    data: { paymentStatus: status },
  });
}
