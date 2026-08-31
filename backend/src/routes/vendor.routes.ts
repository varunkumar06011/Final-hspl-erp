import { Permission } from '@hospital-erp/shared';
import { createVendorSchema, updateVendorSchema, listVendorsSchema } from '@hospital-erp/shared';
import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { notifyAllHeads } from '../services/push.service';
import { generateSequenceNumber } from '../services/sequence.service';
import { ensureVendorLedger } from './ledger.routes';

interface MaterialInput {
  id?: string;
  name: string;
  unit?: string;
}

// Block vendor deletion if any financial records reference it
async function validateVendorDeletion(vendorId: string): Promise<void> {
  const [invoices, quotations, pos, paymentRequests] = await Promise.all([
    prisma.vendorInvoice.count({ where: { vendorId, deletedAt: null } }),
    prisma.quotation.count({ where: { vendorId, deletedAt: null } }),
    prisma.purchaseOrder.count({ where: { vendorId, deletedAt: null } }),
    prisma.paymentRequest.count({ where: { vendorId, deletedAt: null } }),
  ]);
  if (invoices > 0) {
    throw new Error(`Cannot delete vendor with ${invoices} existing invoice(s)`);
  }
  if (quotations > 0) {
    throw new Error(`Cannot delete vendor with ${quotations} existing quotation(s)`);
  }
  if (pos > 0) {
    throw new Error(`Cannot delete vendor with ${pos} existing purchase order(s)`);
  }
  if (paymentRequests > 0) {
    throw new Error(`Cannot delete vendor with ${paymentRequests} existing payment request(s)`);
  }
}

async function generateVendorCode(): Promise<string> {
  return generateSequenceNumber('vendor', 'vendorCode', 'VGH-', 3);
}

const router = createCrudRouter({
  entityType: 'VENDOR',
  model: 'vendor',
  createPermission: Permission.CREATE_VENDOR,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
  listSchema: listVendorsSchema,
  searchFields: ['name', 'vendorCode', 'gstNumber', 'phone', 'contactPersonName', 'contactPersonPhone', 'referenceBy'],
  include: {
    createdByUser: { select: { id: true, name: true } },
    materials: { orderBy: { name: 'asc' } },
  },
  defaultSort: { createdAt: 'desc' },
  transformList: async (records, projectId) => {
    const vendorIds = records.map((vendor) => String(vendor.id));
    if (vendorIds.length === 0) return records;

    const [invoices, paidRequests, paidAdvances, vendorLedgers] = await Promise.all([
      prisma.vendorInvoice.findMany({
        where: { projectId, vendorId: { in: vendorIds }, deletedAt: null },
        select: { vendorId: true, totalAmount: true, advancePaid: true },
      }),
      prisma.paymentRequest.findMany({
        where: {
          projectId,
          invoiceId: { not: null },
          status: 'PAID',
          deletedAt: null,
          invoice: { vendorId: { in: vendorIds } },
        },
        select: { amount: true, invoice: { select: { vendorId: true } } },
      }),
      // Also count PAID ADVANCE payment requests linked to POs for these vendors.
      // Without this, PO-level advance payments never enter the vendor's "total paid"
      // figure, creating a false impression that money hasn't been sent to the vendor.
      prisma.paymentRequest.findMany({
        where: {
          projectId,
          type: 'ADVANCE',
          status: 'PAID',
          deletedAt: null,
          vendorId: { in: vendorIds },
        },
        select: { amount: true, vendorId: true },
      }),
      // Fetch vendor ledgers for the accounting (Tally-style) payable balance.
      // Ledger currentBalance for SUNDRY_CREDITORS: negative = we owe them (credit balance),
      // positive = they owe us (debit balance, rare — advance paid exceeds bills).
      prisma.ledger.findMany({
        where: {
          projectId,
          linkedEntityType: 'VENDOR',
          linkedEntityId: { in: vendorIds },
          deletedAt: null,
        },
        select: { linkedEntityId: true, currentBalance: true, id: true },
      }),
    ]);

    const totals = new Map(vendorIds.map((vendorId) => [vendorId, { billed: 0, paid: 0 }]));
    for (const invoice of invoices) {
      const total = totals.get(invoice.vendorId);
      if (total) {
        total.billed += Number(invoice.totalAmount);
        // A19: Do NOT add invoice.advancePaid to total.paid here.
        // advancePaid is a manual claim on the invoice, not actual cash sent.
        // The actual cash is counted below from PAID payment requests and
        // PAID PO advance payments. Adding advancePaid here double-counts the
        // same physical advance (once as a claim, once as the actual payment).
      }
    }
    for (const request of paidRequests) {
      const total = request.invoice ? totals.get(request.invoice.vendorId) : undefined;
      if (total) total.paid += Number(request.amount);
    }
    for (const advance of paidAdvances) {
      const total = advance.vendorId ? totals.get(advance.vendorId) : undefined;
      if (total) total.paid += Number(advance.amount);
    }

    // Map vendorId → ledger balance
    const ledgerMap = new Map(
      vendorLedgers.map((l) => [String(l.linkedEntityId), { id: l.id, balance: Number(l.currentBalance) }]),
    );

    return records.map((vendor) => {
      const total = totals.get(String(vendor.id)) ?? { billed: 0, paid: 0 };
      const ledger = ledgerMap.get(String(vendor.id));
      // For SUNDRY_CREDITORS (credit nature): negative balance = we owe them (payable)
      // positive balance = they owe us (advance/debit)
      const ledgerBalance = ledger?.balance ?? 0;
      return {
        ...vendor,
        totalBilled: total.billed,
        totalPaid: total.paid,
        outstanding: Math.max(0, total.billed - total.paid),
        // Accounting ledger balance (from posted vouchers). null = no ledger yet.
        ledgerId: ledger?.id ?? null,
        ledgerBalance,
        // weOwe = positive payable (credit balance). theyOwe = positive receivable (debit balance).
        weOwe: ledgerBalance < 0 ? Math.abs(ledgerBalance) : 0,
        theyOwe: ledgerBalance > 0 ? ledgerBalance : 0,
      };
    });
  },
  transformCreate: async (body, userId, projectId) => {
    const vendorCode = await generateVendorCode();
    const materials = (body.materials as MaterialInput[] | undefined) ?? [];

    return {
      projectId,
      vendorCode,
      name: body.name,
      contactPersonName: body.contactPersonName ?? null,
      contactPersonPhone: body.contactPersonPhone ?? null,
      referenceBy: body.referenceBy ?? null,
      gstNumber: body.gstNumber ?? null,
      panNumber: body.panNumber ?? null,
      category: body.category ?? 'OTHER',
      bankName: body.bankName ?? null,
      bankAccountNumber: body.bankAccountNumber ?? null,
      ifscCode: body.ifscCode ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      status: body.status ?? 'ACTIVE',
      rating: body.rating ?? 0,
      createdBy: userId,
      materials: {
        create: materials.map((m) => ({
          name: m.name,
          unit: m.unit ?? null,
        })),
      },
    };
  },
  transformUpdate: async (body, _userId, _projectId, existingId) => {
    const data: Record<string, unknown> = {};

    // Copy scalar fields
    for (const key of ['name', 'contactPersonName', 'contactPersonPhone', 'referenceBy', 'gstNumber', 'panNumber', 'category', 'bankName', 'bankAccountNumber', 'ifscCode', 'address', 'phone', 'email', 'status', 'rating']) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    // Handle materials sync: delete all existing and recreate
    if (body.materials !== undefined) {
      const materials = body.materials as MaterialInput[];
      await prisma.vendorMaterial.deleteMany({ where: { vendorId: existingId } });
      data.materials = {
        create: materials.map((m) => ({
          name: m.name,
          unit: m.unit ?? null,
        })),
      };
    }

    return data;
  },
  afterCreate: async (record, _userId, projectId) => {
    // Auto-create a Sundry Creditors ledger for this vendor so it's immediately
    // available for Tally-style voucher entry and payable tracking. Fire-and-forget:
    // if this fails, the vendor is still created and "Sync Ledgers" can catch up.
    await ensureVendorLedger(record.id as string, projectId).catch((err) =>
      console.error(`[Vendor] auto-ledger creation failed for ${record.id}:`, err),
    );
    await notifyAllHeads(projectId, {
      entityType: 'VENDOR',
      entityId: record.id as string,
      title: 'New Vendor Created',
      body: `Vendor ${record.name} (${record.vendorCode}) added`,
      url: '/vendors',
    });
  },
  afterUpdate: async (record, _userId, _projectId) => {
    // Keep the linked ledger name in sync when the vendor is renamed.
    if (record.name) {
      await prisma.ledger.updateMany({
        where: { linkedEntityType: 'VENDOR', linkedEntityId: record.id as string, deletedAt: null },
        data: { name: record.name as string },
      }).catch((err) => console.error(`[Vendor] ledger name sync failed for ${record.id}:`, err));
    }
  },
  beforeDelete: validateVendorDeletion,
});

// GET /:id/trace — all records linked to a vendor (reverse traceability).
// Returns quotations, purchase orders, assets, invoices, and payment requests
// so the vendor view can show a complete history of everything tied to them.
router.get(
  '/:id/trace',
  authMiddleware,
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendor = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: {
          id: true, vendorCode: true, name: true, referenceBy: true, contactPersonName: true,
          contactPersonPhone: true, phone: true, email: true, gstNumber: true, address: true,
          category: true, status: true, rating: true,
          quotations: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, quotationNumber: true, date: true, status: true, grandTotal: true },
          },
          purchaseOrders: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, poNumber: true, date: true, status: true, grandTotal: true, budgetHead: { select: { id: true, particulars: true } } },
          },
          assets: {
            orderBy: { assetId: 'asc' },
            select: { id: true, assetId: true, status: true, location: true, totalCost: true, inventoryItem: { select: { id: true, name: true } } },
          },
          invoices: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, invoiceNumber: true, date: true, totalAmount: true, stockStatus: true },
          },
          paymentRequests: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, requestNumber: true, amount: true, status: true, type: true, createdAt: true },
          },
        },
      });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      res.json(vendor);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /:id/statement — Tally-style vendor statement with running balance ──
// Shows all transactions with the vendor in chronological order:
// POs (commitment), Invoices (payable), Payments (settled), Returns, Bill Settlements
// Each row has: date, type, reference, debit (we owe more), credit (we paid), running balance
router.get(
  '/:id/statement',
  authMiddleware,
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { startDate, endDate } = req.query as Record<string, unknown>;

      const vendor = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: { id: true, vendorCode: true, name: true, status: true },
      });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      // Find the vendor's ledger (SUNDRY_CREDITORS)
      const vendorLedger = await prisma.ledger.findFirst({
        where: { linkedEntityType: 'VENDOR', linkedEntityId: vendor.id, projectId, deletedAt: null },
        select: { id: true, name: true, currentBalance: true, openingBalance: true },
      });

      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) dateFilter.gte = new Date(String(startDate));
      if (endDate) dateFilter.lte = new Date(String(endDate));

      // Fetch all transaction types in parallel
      const [purchaseOrders, invoices, paymentRequests, billSettlements, ledgerEntries] = await Promise.all([
        // Purchase Orders — commitment (not a ledger entry, but shows in statement)
        prisma.purchaseOrder.findMany({
          where: { vendorId: vendor.id, projectId, deletedAt: null, ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}) },
          select: { id: true, poNumber: true, date: true, grandTotal: true, status: true },
          orderBy: { date: 'asc' },
        }),
        // Vendor Invoices — creates payable (Dr to vendor ledger via PURCHASE voucher)
        prisma.vendorInvoice.findMany({
          where: { vendorId: vendor.id, projectId, deletedAt: null, ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}) },
          select: { id: true, invoiceCode: true, invoiceNumber: true, date: true, totalAmount: true, verificationStatus: true, paymentStatus: true },
          orderBy: { date: 'asc' },
        }),
        // Payment Requests — payments made to vendor
        prisma.paymentRequest.findMany({
          where: { vendorId: vendor.id, projectId, deletedAt: null, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
          include: {
            payments: { select: { id: true, amount: true, date: true, mode: true, reference: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        // Bill Settlements — payments linked to specific invoices via vouchers
        prisma.billSettlement.findMany({
          where: { vendorId: vendor.id, projectId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
          include: {
            invoice: { select: { invoiceCode: true, invoiceNumber: true } },
            journalVoucher: { select: { jvNumber: true, voucherType: true, date: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        // Ledger entries directly on the vendor ledger (manual vouchers, journals, etc.)
        vendorLedger
          ? prisma.ledgerEntry.findMany({
              where: { ledgerId: vendorLedger.id, ...(Object.keys(dateFilter).length > 0 ? { voucherDate: dateFilter } : {}) },
              include: { journalVoucher: { select: { jvNumber: true, voucherType: true, status: true, sourceInvoiceId: true } } },
              orderBy: { voucherDate: 'asc' },
            })
          : Promise.resolve([]),
      ]);

      // Build a unified transaction list
      interface StmtRow {
        date: Date;
        type: string;
        reference: string;
        debit: number;  // increases what we owe (invoice raised, purchase)
        credit: number; // decreases what we owe (payment made, return)
        runningBalance: number;
        status?: string;
      }

      const rows: StmtRow[] = [];

      // Opening balance from ledger
      const openingBalance = vendorLedger ? Number(vendorLedger.openingBalance) : 0;
      // For SUNDRY_CREDITORS (credit-nature), positive balance = we owe them
      // Stored as negative in the ledger, so invert
      const openingPayable = Math.abs(openingBalance);

      if (openingPayable > 0 && !startDate) {
        rows.push({
          date: new Date(0),
          type: 'Opening Balance',
          reference: '—',
          debit: openingPayable,
          credit: 0,
          runningBalance: openingPayable,
        });
      }

      // Add POs (commitment — not a real ledger entry, but shows in statement)
      for (const po of purchaseOrders) {
        rows.push({
          date: po.date,
          type: 'Purchase Order',
          reference: po.poNumber,
          debit: 0, // PO doesn't create a payable yet
          credit: 0,
          runningBalance: 0, // will be calculated below
          status: po.status,
        });
      }

      // Add invoices (creates payable — Dr to vendor)
      for (const inv of invoices) {
        rows.push({
          date: inv.date,
          type: 'Invoice',
          reference: inv.invoiceCode ?? inv.invoiceNumber,
          debit: Number(inv.totalAmount),
          credit: 0,
          runningBalance: 0,
          status: inv.verificationStatus,
        });
      }

      // Add payments (reduces payable — Cr to vendor)
      for (const pr of paymentRequests) {
        for (const p of pr.payments) {
          rows.push({
            date: p.date,
            type: 'Payment',
            reference: `${pr.requestNumber} / ${p.mode}${p.reference ? ' / ' + p.reference : ''}`,
            debit: 0,
            credit: Number(p.amount),
            runningBalance: 0,
            status: pr.status,
          });
        }
      }

      // Add bill settlements (payments linked to specific invoices)
      for (const bs of billSettlements) {
        // Avoid double-counting if the payment is already in paymentRequests
        // Bill settlements are from voucher-level, payments are from payment-request-level
        // They may overlap if a payment request was also posted as a voucher.
        // For the statement, we show bill settlements as "Settlement" lines (info only, no amount)
        rows.push({
          date: bs.journalVoucher.date,
          type: 'Bill Settlement',
          reference: `${bs.journalVoucher.jvNumber} → ${bs.invoice.invoiceCode ?? bs.invoice.invoiceNumber}`,
          debit: 0,
          credit: 0, // amount already counted via payment
          runningBalance: 0,
          status: bs.journalVoucher.status,
        });
      }

      // Add direct ledger entries (manual vouchers, journals)
      for (const le of ledgerEntries) {
        // Only include if from a non-PURCHASE voucher (PURCHASE already covered by invoices)
        if (le.journalVoucher?.voucherType === 'PURCHASE' && le.journalVoucher.sourceInvoiceId) continue;
        const debit = Number(le.debit);
        const credit = Number(le.credit);
        if (debit === 0 && credit === 0) continue;
        rows.push({
          date: le.voucherDate,
          type: le.journalVoucher?.voucherType ?? 'Journal',
          reference: le.journalVoucher?.jvNumber ?? le.voucherNumber,
          debit,
          credit,
          runningBalance: 0,
          status: le.journalVoucher?.status,
        });
      }

      // Sort by date and compute running balance
      rows.sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = openingPayable;
      for (const row of rows) {
        running += row.debit - row.credit;
        row.runningBalance = running;
      }

      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

      res.json({
        vendor: {
          id: vendor.id,
          name: vendor.name,
          vendorCode: vendor.vendorCode,
          status: vendor.status,
        },
        ledger: vendorLedger ? {
          id: vendorLedger.id,
          name: vendorLedger.name,
          currentBalance: Number(vendorLedger.currentBalance),
        } : null,
        dateRange: {
          startDate: startDate ? String(startDate) : null,
          endDate: endDate ? String(endDate) : null,
        },
        rows: rows.map((r) => ({
          ...r,
          date: r.date.toISOString(),
        })),
        summary: {
          openingBalance: openingPayable,
          totalDebit,
          totalCredit,
          closingBalance: running,
          currentLedgerBalance: vendorLedger ? Math.abs(Number(vendorLedger.currentBalance)) : running,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
