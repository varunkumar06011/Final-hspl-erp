import { Router, Response, NextFunction } from 'express';
import {
  AuditAction,
  Permission,
  createVendorBankAccountSchema,
  updateVendorBankAccountSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { makePrimary, mirrorOf } from '../services/vendor-bank.service';

/**
 * A vendor's bank accounts (several per vendor, one primary). Mounted under /vendors:
 *   GET    /vendors/:id/bank-accounts
 *   POST   /vendors/:id/bank-accounts
 *   PATCH  /vendors/:id/bank-accounts/:accountId
 *   DELETE /vendors/:id/bank-accounts/:accountId
 */
const router = Router();

async function findVendor(projectId: string, vendorId: string) {
  return prisma.vendor.findFirst({ where: { id: vendorId, projectId, deletedAt: null }, select: { id: true } });
}

router.get(
  '/:id/bank-accounts',
  authMiddleware,
  rbacMiddleware(Permission.VIEW_VENDORS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!(await findVendor(projectId, req.params.id))) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      const accounts = await prisma.vendorBankAccount.findMany({
        where: { vendorId: req.params.id },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      res.json(accounts);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/bank-accounts',
  authMiddleware,
  rbacMiddleware(Permission.CREATE_VENDOR),
  validateMiddleware(createVendorBankAccountSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendorId = req.params.id;
      if (!(await findVendor(projectId, vendorId))) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      const b = req.body as {
        bankName?: string; accountHolderName?: string; accountNumber: string; ifscCode: string; makePrimary?: boolean;
      };
      const duplicate = await prisma.vendorBankAccount.findFirst({
        where: { vendorId, accountNumber: b.accountNumber, ifscCode: b.ifscCode },
        select: { id: true },
      });
      if (duplicate) {
        res.status(409).json({ error: 'This bank account is already saved for the vendor' });
        return;
      }

      const existingCount = await prisma.vendorBankAccount.count({ where: { vendorId } });
      const primary = existingCount === 0 || b.makePrimary === true;
      const created = await prisma.$transaction(async (tx) => {
        const account = await tx.vendorBankAccount.create({
          data: {
            vendorId,
            bankName: b.bankName || null,
            accountHolderName: b.accountHolderName || null,
            accountNumber: b.accountNumber,
            ifscCode: b.ifscCode,
            isPrimary: false,
          },
        });
        if (primary) await makePrimary(tx, vendorId, account.id);
        return tx.vendorBankAccount.findUniqueOrThrow({ where: { id: account.id } });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VENDOR',
        entityId: vendorId,
        projectId,
        newValue: { bankAccount: { accountNumber: created.accountNumber, ifscCode: created.ifscCode, isPrimary: created.isPrimary } },
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:id/bank-accounts/:accountId',
  authMiddleware,
  rbacMiddleware(Permission.CREATE_VENDOR),
  validateMiddleware(updateVendorBankAccountSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { id: vendorId, accountId } = req.params;
      if (!(await findVendor(projectId, vendorId))) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      const current = await prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId } });
      if (!current) {
        res.status(404).json({ error: 'Bank account not found' });
        return;
      }
      const b = req.body as {
        bankName?: string | null; accountHolderName?: string | null; accountNumber?: string; ifscCode?: string; makePrimary?: boolean;
      };
      if (b.makePrimary === false && current.isPrimary) {
        res.status(400).json({ error: 'Make another account primary instead. A vendor always has one primary account' });
        return;
      }
      const accountNumber = b.accountNumber ?? current.accountNumber;
      const ifscCode = b.ifscCode ?? current.ifscCode;
      if (accountNumber !== current.accountNumber || ifscCode !== current.ifscCode) {
        const duplicate = await prisma.vendorBankAccount.findFirst({
          where: { vendorId, accountNumber, ifscCode, NOT: { id: accountId } },
          select: { id: true },
        });
        if (duplicate) {
          res.status(409).json({ error: 'This bank account is already saved for the vendor' });
          return;
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const account = await tx.vendorBankAccount.update({
          where: { id: accountId },
          data: {
            ...(b.bankName !== undefined ? { bankName: b.bankName || null } : {}),
            ...(b.accountHolderName !== undefined ? { accountHolderName: b.accountHolderName || null } : {}),
            accountNumber,
            ifscCode,
          },
        });
        if (b.makePrimary === true) {
          await makePrimary(tx, vendorId, accountId);
        } else if (account.isPrimary) {
          // The primary's details changed: keep the vendor's mirror columns in step.
          await tx.vendor.update({ where: { id: vendorId }, data: mirrorOf(account) });
        }
        return tx.vendorBankAccount.findUniqueOrThrow({ where: { id: accountId } });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VENDOR',
        entityId: vendorId,
        projectId,
        oldValue: { bankAccount: { accountNumber: current.accountNumber, ifscCode: current.ifscCode, isPrimary: current.isPrimary } },
        newValue: { bankAccount: { accountNumber: updated.accountNumber, ifscCode: updated.ifscCode, isPrimary: updated.isPrimary } },
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id/bank-accounts/:accountId',
  authMiddleware,
  rbacMiddleware(Permission.CREATE_VENDOR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { id: vendorId, accountId } = req.params;
      if (!(await findVendor(projectId, vendorId))) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      const current = await prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId } });
      if (!current) {
        res.status(404).json({ error: 'Bank account not found' });
        return;
      }
      const used = await prisma.materialPurchaseRequest.count({ where: { paymentBankAccountId: accountId } });
      if (used > 0) {
        res.status(409).json({ error: `This account is used by ${used} material request(s) and cannot be removed` });
        return;
      }

      await prisma.$transaction(async (tx) => {
        if (current.isPrimary) {
          // Another account takes over as primary; with none left the vendor's mirror columns clear.
          const successor = await tx.vendorBankAccount.findFirst({
            where: { vendorId, NOT: { id: accountId } },
            orderBy: { createdAt: 'desc' },
          });
          if (successor) {
            await makePrimary(tx, vendorId, successor.id);
          } else {
            await tx.vendor.update({ where: { id: vendorId }, data: mirrorOf(null) });
          }
        }
        await tx.vendorBankAccount.delete({ where: { id: accountId } });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'VENDOR',
        entityId: vendorId,
        projectId,
        oldValue: { bankAccount: { accountNumber: current.accountNumber, ifscCode: current.ifscCode, isPrimary: current.isPrimary } },
      });
      res.json({ message: 'Bank account removed' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
