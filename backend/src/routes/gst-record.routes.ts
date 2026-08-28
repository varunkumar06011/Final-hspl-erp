import { Router, Response, NextFunction } from 'express';
import { Permission, PaymentStatus } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { prisma } from '../config/prisma';

const router = Router();
router.use(authMiddleware);

type GSTStatus = 'PAID' | 'PARTIALLY_PAID' | 'OUTSTANDING' | 'UNBILLED';

function getPaymentStatus(paidAmount: number, totalAmount: number): GSTStatus {
  if (paidAmount >= totalAmount && totalAmount > 0) return 'PAID';
  if (paidAmount > 0) return 'PARTIALLY_PAID';
  return 'OUTSTANDING';
}

router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;

      const [invoices, purchaseOrders] = await Promise.all([
        prisma.vendorInvoice.findMany({
          where: {
            projectId,
            deletedAt: null,
            ...(vendorId ? { vendorId } : {}),
          },
          include: {
            vendor: { select: { id: true, name: true, vendorCode: true } },
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
                gstAmount: true,
                quotation: { select: { id: true, quotationNumber: true, gstAmount: true } },
                // Include PAID advance payment requests on the linked PO so that
                // actual advance payments are counted toward "paid", not just the
                // manually-entered invoice.advancePaid field.
                advancePaymentRequests: {
                  where: { deletedAt: null, status: PaymentStatus.PAID, type: 'ADVANCE' },
                  select: { amount: true },
                },
              },
            },
            paymentRequests: {
              where: { deletedAt: null, status: PaymentStatus.PAID },
              select: { amount: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.purchaseOrder.findMany({
          where: {
            projectId,
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'REJECTED'] },
            ...(vendorId ? { vendorId } : {}),
          },
          include: {
            vendor: { select: { id: true, name: true, vendorCode: true } },
            quotation: { select: { id: true, quotationNumber: true, gstAmount: true } },
            invoices: { where: { deletedAt: null }, select: { id: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
      const records = [
        ...invoices.map((invoice) => {
          const totalAmount = Number(invoice.totalAmount);
          // Use actual paid advances on the linked PO (not just the manual
          // invoice.advancePaid field) to determine how much has been paid.
          const poAdvancePaid = invoice.purchaseOrder
            ? invoice.purchaseOrder.advancePaymentRequests.reduce((sum, pr) => sum + Number(pr.amount), 0)
            : 0;
          const paidAmount = Math.min(
            totalAmount,
            Number(invoice.advancePaid) + poAdvancePaid + invoice.paymentRequests.reduce((sum, payment) => sum + Number(payment.amount), 0),
          );
          const gstRecorded = Number(invoice.taxAmount);
          const paidRatio = totalAmount > 0 ? paidAmount / totalAmount : 0;
          const gstPaid = gstRecorded * paidRatio;
          const recordStatus = getPaymentStatus(paidAmount, totalAmount);
          return {
            id: `invoice-${invoice.id}`,
            sourceType: 'INVOICE' as const,
            sourceId: invoice.id,
            sourceNumber: invoice.invoiceNumber || invoice.invoiceCode,
            date: invoice.date,
            vendor: invoice.vendor,
            po: invoice.purchaseOrder ? { id: invoice.purchaseOrder.id, poNumber: invoice.purchaseOrder.poNumber } : null,
            quotation: invoice.purchaseOrder?.quotation
              ? { id: invoice.purchaseOrder.quotation.id, quotationNumber: invoice.purchaseOrder.quotation.quotationNumber }
              : null,
            poGstRecorded: invoice.purchaseOrder ? Number(invoice.purchaseOrder.gstAmount) : null,
            quotationGstRecorded: invoice.purchaseOrder?.quotation ? Number(invoice.purchaseOrder.quotation.gstAmount) : null,
            gstRecorded,
            gstPaid,
            gstOutstanding: Math.max(0, gstRecorded - gstPaid),
            cgstAmount: Number(invoice.cgstAmount),
            sgstAmount: Number(invoice.sgstAmount),
            igstAmount: Number(invoice.igstAmount),
            paymentStatus: recordStatus,
            invoiceTotal: totalAmount,
            paidAmount,
            isCanonical: true,
            note: 'Invoice GST is the canonical GST amount for this PO/invoice chain.',
          };
        }),
        ...purchaseOrders
          .filter((po) => !po.invoices.some((invoice) => invoiceIds.has(invoice.id)) && po.invoices.length === 0)
          .map((po) => ({
            id: `po-${po.id}`,
            sourceType: 'PURCHASE_ORDER' as const,
            sourceId: po.id,
            sourceNumber: po.poNumber,
            date: po.date,
            vendor: po.vendor,
            po: { id: po.id, poNumber: po.poNumber },
            quotation: po.quotation
              ? { id: po.quotation.id, quotationNumber: po.quotation.quotationNumber }
              : null,
            poGstRecorded: Number(po.gstAmount),
            quotationGstRecorded: po.quotation ? Number(po.quotation.gstAmount) : null,
            gstRecorded: Number(po.gstAmount),
            gstPaid: 0,
            gstOutstanding: Number(po.gstAmount),
            paymentStatus: 'UNBILLED' as const,
            invoiceTotal: null,
            paidAmount: 0,
            isCanonical: true,
            note: 'PO GST is an estimate until an invoice is recorded; it is replaced by invoice GST and never added twice.',
          })),
      ].filter((record) => !status || record.paymentStatus === status);

      const vendorSummary = new Map<string, {
        vendorId: string;
        vendorName: string;
        vendorCode: string;
        gstRecorded: number;
        gstPaid: number;
        gstOutstanding: number;
      }>();
      for (const record of records) {
        const existing = vendorSummary.get(record.vendor.id) ?? {
          vendorId: record.vendor.id,
          vendorName: record.vendor.name,
          vendorCode: record.vendor.vendorCode,
          gstRecorded: 0,
          gstPaid: 0,
          gstOutstanding: 0,
        };
        existing.gstRecorded += record.gstRecorded;
        existing.gstPaid += record.gstPaid;
        existing.gstOutstanding += record.gstOutstanding;
        vendorSummary.set(record.vendor.id, existing);
      }

      res.json({
        data: records,
        summary: {
          gstRecorded: records.reduce((sum, record) => sum + record.gstRecorded, 0),
          gstPaid: records.reduce((sum, record) => sum + record.gstPaid, 0),
          gstOutstanding: records.reduce((sum, record) => sum + record.gstOutstanding, 0),
          vendorWise: [...vendorSummary.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
