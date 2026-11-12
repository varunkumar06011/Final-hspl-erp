/**
 * Duplicate detection. Everything here WARNS and FLAGS; nothing ever blocks an upload or a record.
 *
 *  - File fingerprint: every file that goes through the storage service gets a SHA-256 row. A file
 *    whose hash already exists in the project raises a FILE flag; the uploader sees a warning in
 *    the response (`duplicateWarning`) and the admins are told.
 *  - Soft duplicates: a site bill from the same shop for the same amount within a few days, or a
 *    vendor invoice for the same vendor and amount within a few days, raises an AMOUNT flag.
 *  - Proof numbers: an upload that carries an already-used proof number raises a PROOF_REUSE flag.
 *
 * The upload context (who is uploading, the proof number header, the warnings collected) lives in an
 * AsyncLocalStorage started by the auth middleware, so any route that stores a file is covered without
 * touching the route.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import type { NextFunction, Response } from 'express';
import { prisma } from '../config/prisma';
import { notifyUsers } from './push.service';
import { getStorageService, type StorageService, type UploadResult } from './storage.service';

/** Days either side within which the same shop/vendor + amount counts as a possible duplicate. */
export const SOFT_DUPLICATE_DAYS = 7;
/** Buckets never fingerprinted or flagged (branding, not evidence). */
const SKIP_BUCKETS = new Set(['logos']);

export interface DuplicateWarning {
  kind: 'FILE' | 'AMOUNT' | 'PROOF_REUSE';
  message: string;
}

interface ProofRow {
  id: string;
  number: string;
  usedAt: Date | null;
}

interface UploadContext {
  projectId: string;
  userId: string;
  userName: string;
  proofHeader: string | null;
  proof: ProofRow | null;
  proofHandled: boolean;
  warnings: DuplicateWarning[];
}

const als = new AsyncLocalStorage<UploadContext>();

/** Starts the per-request upload context (called by the auth middleware once the user is known). */
export function startUploadContext(
  req: { user?: { id: string; name?: string | null; projectId?: string | null }; method: string; header(name: string): string | undefined },
  res: Response,
  next: NextFunction,
): void {
  const user = req.user;
  if (!user?.projectId || typeof res?.json !== 'function' || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const raw = typeof req.header === 'function' ? req.header('x-proof-number') : undefined;
  const ctx: UploadContext = {
    projectId: user.projectId,
    userId: user.id,
    userName: user.name ?? 'Someone',
    proofHeader: raw ? raw.trim().toUpperCase().slice(0, 60) : null,
    proof: null,
    proofHandled: false,
    warnings: [],
  };
  // Hand the warnings back to the caller inside the normal JSON answer.
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (ctx.warnings.length > 0 && res.statusCode < 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      return json({ ...(body as Record<string, unknown>), duplicateWarning: ctx.warnings });
    }
    return json(body);
  }) as Response['json'];
  als.run(ctx, next);
}

/** Warnings collected so far in this request (used by route code that runs soft checks). */
export function addRequestWarning(w: DuplicateWarning): void {
  als.getStore()?.warnings.push(w);
}

class UploadGuardError extends Error {
  status = 400;
}

// ── labels for the record a file / flag points at ───────────────────────────

export interface EntityRef {
  entityType: string;
  entityId: string;
  label: string;
  url: string | null;
}

const ENTITY_URL: Record<string, string> = {
  MATERIAL_PURCHASE_REQUEST: '/material-purchase-requests',
  QUOTATION: '/quotations',
  PURCHASE_ORDER: '/purchase-orders',
  GATE_PASS: '/gate-passes',
  VENDOR_INVOICE: '/invoices',
  INVOICE: '/invoices',
  PAYMENT_REQUEST: '/payments',
};

export async function labelEntity(entityType: string, entityId: string): Promise<EntityRef> {
  const base = ENTITY_URL[entityType];
  const url = base ? `${base}?id=${entityId}` : null;
  let label: string | null = null;
  try {
    switch (entityType) {
      case 'MATERIAL_PURCHASE_REQUEST': {
        const r = await prisma.materialPurchaseRequest.findUnique({ where: { id: entityId }, select: { mprNumber: true, isSiteBill: true } });
        if (r) label = `${r.isSiteBill ? 'Site bill' : 'Request'} ${r.mprNumber}`;
        break;
      }
      case 'QUOTATION': {
        const r = await prisma.quotation.findUnique({ where: { id: entityId }, select: { quotationNumber: true } });
        if (r) label = `Quotation ${r.quotationNumber}`;
        break;
      }
      case 'PURCHASE_ORDER': {
        const r = await prisma.purchaseOrder.findUnique({ where: { id: entityId }, select: { poNumber: true } });
        if (r) label = `PO ${r.poNumber}`;
        break;
      }
      case 'GATE_PASS': {
        const r = await prisma.gatePass.findUnique({ where: { id: entityId }, select: { passNumber: true } });
        if (r) label = `Gate pass ${r.passNumber}`;
        break;
      }
      case 'VENDOR_INVOICE':
      case 'INVOICE': {
        const r = await prisma.vendorInvoice.findUnique({ where: { id: entityId }, select: { invoiceCode: true } });
        if (r) label = `Invoice ${r.invoiceCode}`;
        break;
      }
      case 'PAYMENT_REQUEST': {
        const r = await prisma.paymentRequest.findUnique({ where: { id: entityId }, select: { paymentCode: true } });
        if (r) label = `Payment ${r.paymentCode}`;
        break;
      }
      default:
    }
  } catch {
    /* label stays generic */
  }
  return { entityType, entityId, label: label ?? entityType.replace(/_/g, ' ').toLowerCase(), url };
}

/** Which record a stored file belongs to, found through the tables that keep file paths. */
export async function locateFile(filePath: string): Promise<EntityRef | null> {
  const attachment = await prisma.attachment.findFirst({ where: { filePath }, select: { entityType: true, entityId: true } });
  if (attachment) return labelEntity(attachment.entityType, attachment.entityId);
  const mpr = await prisma.materialPurchaseRequest.findFirst({ where: { receiptFilePath: filePath }, select: { id: true } });
  if (mpr) return labelEntity('MATERIAL_PURCHASE_REQUEST', mpr.id);
  const quotation = await prisma.quotation.findFirst({ where: { filePath }, select: { id: true } });
  if (quotation) return labelEntity('QUOTATION', quotation.id);
  const invoice = await prisma.vendorInvoice.findFirst({ where: { filePath }, select: { id: true } });
  if (invoice) return labelEntity('VENDOR_INVOICE', invoice.id);
  const gate = await prisma.gatePass.findFirst({ where: { photoProofPath: filePath }, select: { id: true } });
  if (gate) return labelEntity('GATE_PASS', gate.id);
  const pay = await prisma.paymentRequest.findFirst({ where: { filePath }, select: { id: true } });
  if (pay) return labelEntity('PAYMENT_REQUEST', pay.id);
  return null;
}

// ── notifying admins ────────────────────────────────────────────────────────

/** In-app notice + push to every active admin (except the person who caused the flag). */
export async function notifyAdminsOfFlag(projectId: string, excludeUserId: string | null | undefined, title: string, body: string): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { isActive: true, role: { startsWith: 'ADMIN' }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      select: { id: true },
    });
    if (admins.length === 0) return;
    const ids = admins.map((a) => a.id);
    await prisma.appNotification.createMany({
      data: ids.map((userId) => ({ userId, projectId, type: 'DUPLICATE_FLAG', title, body, url: '/duplicates', entityType: 'DUPLICATE_FLAG' })),
    });
    await notifyUsers(ids, { entityType: 'DUPLICATE_FLAG', entityId: '', title, body, url: '/duplicates' }, 'entity_created');
  } catch (err) {
    console.error('[Duplicates] admin notification failed:', err);
  }
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

// ── upload guard (storage decorator) ────────────────────────────────────────

async function loadProof(ctx: UploadContext): Promise<void> {
  if (!ctx.proofHeader || ctx.proof) return;
  const row = await prisma.proofNumber.findUnique({
    where: { projectId_number: { projectId: ctx.projectId, number: ctx.proofHeader } },
    select: { id: true, number: true, usedAt: true },
  });
  if (!row) {
    throw new UploadGuardError(`Proof number ${ctx.proofHeader} was not found. Check the number written on the paper, or press "Get proof number".`);
  }
  ctx.proof = row;
}

async function afterUpload(ctx: UploadContext, file: Buffer, result: UploadResult, bucket: string): Promise<void> {
  const sha256 = createHash('sha256').update(file).digest('hex');
  const matches = await prisma.fileFingerprint.findMany({
    where: { projectId: ctx.projectId, sha256 },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  const takeProof = !!ctx.proof && !ctx.proofHandled;
  const fp = await prisma.fileFingerprint.create({
    data: {
      projectId: ctx.projectId,
      sha256,
      size: file.length,
      fileName: result.fileName,
      filePath: result.filePath,
      mimeType: result.mimeType,
      bucket,
      uploadedBy: ctx.userId,
      proofNumber: takeProof ? ctx.proof!.number : null,
    },
  });

  // Proof number carried by this upload: first use binds it, a later use is flagged.
  if (takeProof) {
    ctx.proofHandled = true;
    const proof = ctx.proof!;
    const fresh = await prisma.proofNumber.updateMany({
      where: { id: proof.id, usedAt: null },
      data: { usedAt: new Date(), usedFingerprintId: fp.id },
    });
    if (fresh.count === 0) {
      await prisma.proofNumber.update({ where: { id: proof.id }, data: { reuseCount: { increment: 1 } } });
      const reason = `Proof number ${proof.number} was already used for an earlier upload, and ${ctx.userName} used it again (${result.fileName}).`;
      await prisma.duplicateFlag.create({
        data: { projectId: ctx.projectId, kind: 'PROOF_REUSE', reason, uploadedBy: ctx.userId, fingerprintId: fp.id, proofNumber: proof.number },
      });
      ctx.warnings.push({ kind: 'PROOF_REUSE', message: `Proof number ${proof.number} has already been used. The admins have been told.` });
      void notifyAdminsOfFlag(ctx.projectId, ctx.userId, 'Proof number used twice', `${reason} Please reconcile.`);
    }
  }

  if (matches.length > 0) {
    const first = matches[0];
    const [earlier, earlierBy] = await Promise.all([
      locateFile(first.filePath).catch(() => null),
      first.uploadedBy ? prisma.user.findUnique({ where: { id: first.uploadedBy }, select: { name: true } }) : Promise.resolve(null),
    ]);
    const where = earlier ? ` for ${earlier.label}` : '';
    const who = earlierBy?.name ? ` by ${earlierBy.name}` : '';
    const reason = `${ctx.userName} uploaded "${result.fileName}", which is the same file as "${first.fileName}" uploaded on ${fmtDate(first.createdAt)}${who}${where}.`;
    await prisma.duplicateFlag.create({
      data: {
        projectId: ctx.projectId,
        kind: 'FILE',
        reason,
        uploadedBy: ctx.userId,
        fingerprintId: fp.id,
        matchedFingerprintId: first.id,
        matchedEntityType: earlier?.entityType ?? null,
        matchedEntityId: earlier?.entityId ?? null,
        proofNumber: takeProof ? ctx.proof!.number : null,
      },
    });
    ctx.warnings.push({
      kind: 'FILE',
      message: `This file was already uploaded on ${fmtDate(first.createdAt)}${who}${where}. It has been saved, and the admins have been asked to check it.`,
    });
    void notifyAdminsOfFlag(ctx.projectId, ctx.userId, 'Duplicate file uploaded', `${reason} Please reconcile.`);
  }
}

/** Wraps a storage service: every upload is fingerprinted, proof numbers are bound, duplicates flagged. */
export function withUploadGuard(inner: StorageService): StorageService {
  return {
    getFile: inner.getFile.bind(inner),
    deleteFile: inner.deleteFile.bind(inner),
    getSignedUrl: inner.getSignedUrl.bind(inner),
    async upload(file, fileName, mimeType, bucket) {
      const ctx = als.getStore();
      const guarded = !!ctx && !SKIP_BUCKETS.has(bucket);
      if (guarded) await loadProof(ctx!); // a wrong number is refused before anything is stored
      const result = await inner.upload(file, fileName, mimeType, bucket);
      if (guarded) {
        try {
          await afterUpload(ctx!, file, result, bucket);
        } catch (err) {
          console.error('[Duplicates] fingerprinting failed:', err); // never fail an upload over this
        }
      }
      return result;
    },
  };
}

// ── soft duplicates (same shop / vendor, same amount, a few days apart) ──────

async function createAmountFlag(args: {
  projectId: string;
  userId: string;
  entityType: string;
  entityId: string;
  matchedEntityType: string;
  matchedEntityId: string;
  vendorName: string;
  amount: number;
  reason: string;
}): Promise<void> {
  const exists = await prisma.duplicateFlag.findFirst({
    where: {
      projectId: args.projectId,
      kind: 'AMOUNT',
      OR: [
        { entityId: args.entityId, matchedEntityId: args.matchedEntityId },
        { entityId: args.matchedEntityId, matchedEntityId: args.entityId },
      ],
    },
    select: { id: true },
  });
  if (exists) return;
  await prisma.duplicateFlag.create({
    data: {
      projectId: args.projectId,
      kind: 'AMOUNT',
      reason: args.reason,
      uploadedBy: args.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      matchedEntityType: args.matchedEntityType,
      matchedEntityId: args.matchedEntityId,
      vendorName: args.vendorName,
      amount: args.amount,
    },
  });
  addRequestWarning({ kind: 'AMOUNT', message: args.reason });
  void notifyAdminsOfFlag(args.projectId, args.userId, 'Possible duplicate bill', `${args.reason} Please reconcile.`);
}

const dayMs = 24 * 60 * 60 * 1000;

/** A site bill from the same shop for the same amount within SOFT_DUPLICATE_DAYS. Never throws. */
export async function checkSiteBillDuplicate(bill: { id: string; projectId: string; mprNumber: string; billShopName: string | null; billDate: Date | null; date: Date; estimatedTotal: unknown }, userId: string): Promise<void> {
  try {
    const shop = bill.billShopName?.trim();
    const amount = Number(bill.estimatedTotal);
    if (!shop || !(amount > 0)) return;
    const at = (bill.billDate ?? bill.date).getTime();
    const near = await prisma.materialPurchaseRequest.findMany({
      where: {
        projectId: bill.projectId,
        isSiteBill: true,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        id: { not: bill.id },
        estimatedTotal: amount,
        billShopName: { equals: shop, mode: 'insensitive' },
      },
      select: { id: true, mprNumber: true, billDate: true, date: true },
      take: 20,
    });
    for (const o of near.filter((n) => Math.abs((n.billDate ?? n.date).getTime() - at) <= SOFT_DUPLICATE_DAYS * dayMs).slice(0, 3)) {
      await createAmountFlag({
        projectId: bill.projectId,
        userId,
        entityType: 'MATERIAL_PURCHASE_REQUEST',
        entityId: bill.id,
        matchedEntityType: 'MATERIAL_PURCHASE_REQUEST',
        matchedEntityId: o.id,
        vendorName: shop,
        amount,
        reason: `Site bill ${bill.mprNumber} from ${shop} for ₹${inr.format(amount)} matches ${o.mprNumber} (same shop and amount within ${SOFT_DUPLICATE_DAYS} days).`,
      });
    }
  } catch (err) {
    console.error('[Duplicates] site bill check failed:', err);
  }
}

/** A vendor invoice for the same vendor and amount within SOFT_DUPLICATE_DAYS. Never throws. */
export async function checkInvoiceDuplicate(invoice: { id: string; projectId: string; vendorId: string; invoiceCode: string; date: Date; totalAmount: unknown }, userId: string): Promise<void> {
  try {
    const amount = Number(invoice.totalAmount);
    if (!(amount > 0)) return;
    const near = await prisma.vendorInvoice.findMany({
      where: {
        projectId: invoice.projectId,
        vendorId: invoice.vendorId,
        deletedAt: null,
        id: { not: invoice.id },
        totalAmount: amount,
        date: { gte: new Date(invoice.date.getTime() - SOFT_DUPLICATE_DAYS * dayMs), lte: new Date(invoice.date.getTime() + SOFT_DUPLICATE_DAYS * dayMs) },
      },
      select: { id: true, invoiceCode: true, vendor: { select: { name: true } } },
      take: 3,
    });
    for (const o of near) {
      await createAmountFlag({
        projectId: invoice.projectId,
        userId,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        matchedEntityType: 'VENDOR_INVOICE',
        matchedEntityId: o.id,
        vendorName: o.vendor?.name ?? '',
        amount,
        reason: `Invoice ${invoice.invoiceCode} from ${o.vendor?.name ?? 'the vendor'} for ₹${inr.format(amount)} matches ${o.invoiceCode} (same vendor and amount within ${SOFT_DUPLICATE_DAYS} days).`,
      });
    }
  } catch (err) {
    console.error('[Duplicates] invoice check failed:', err);
  }
}

/** Background pass that fingerprints files uploaded before this feature existed. Idempotent. */
export async function backfillFingerprints(limit = 200): Promise<number> {
  // Old files cannot be read generically (local disk or Supabase), so only attachments of known paths are done.
  const storage = getStorageService();
  const done = new Set((await prisma.fileFingerprint.findMany({ select: { filePath: true } })).map((f) => f.filePath));
  const rows = await prisma.attachment.findMany({ orderBy: { createdAt: 'asc' }, take: limit * 3 });
  let n = 0;
  for (const a of rows) {
    if (n >= limit) break;
    if (done.has(a.filePath)) continue;
    try {
      const buf = await storage.getFile(a.filePath);
      await prisma.fileFingerprint.create({
        data: {
          projectId: a.projectId,
          sha256: createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
          fileName: a.fileName,
          filePath: a.filePath,
          mimeType: a.mimeType,
          uploadedBy: a.uploadedBy,
          createdAt: a.createdAt,
        },
      });
      n += 1;
    } catch {
      /* unreadable file: skip */
    }
  }
  return n;
}
