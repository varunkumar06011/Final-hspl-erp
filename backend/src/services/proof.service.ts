/**
 * Proof numbers. Clicking "Get proof number" on a request, quotation, PO, gate pass or site bill
 * form issues a number the supervisor writes on the paper before photographing it.
 *
 *  - One purchase chain (request -> quotation -> PO -> goods receipt -> gate pass) shares the chain's
 *    request number: VGH-MPR014-P1, VGH-MPR014-P2... A quotation or PO with no request behind it
 *    hangs on its own number (VGH-QT007-P1).
 *  - Site bills are requests too: VGH-MPR021-P1 (their number is reserved when the form asks for it).
 *  - Numbers are issued by the server, unique per project, and never reused: an upload that carries
 *    a used number is flagged (see duplicate.service.ts).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { generateProjectSequenceNumber } from './sequence.service';

export class ProofError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ChainBase {
  baseType: 'MPR' | 'QUOTATION' | 'PURCHASE_ORDER';
  baseId: string;
  baseNumber: string;
}

/** Entity types a proof number can be requested for. */
export const PROOF_ENTITY_TYPES = ['MATERIAL_PURCHASE_REQUEST', 'QUOTATION', 'PURCHASE_ORDER', 'GATE_PASS', 'GOODS_RECEIPT', 'VENDOR_INVOICE'] as const;

const mprBase = (m: { id: string; mprNumber: string }): ChainBase => ({ baseType: 'MPR', baseId: m.id, baseNumber: m.mprNumber });

/** The record a chain hangs on: its request when there is one, else the quotation / PO itself. */
export async function resolveChainBase(projectId: string, entityType: string, entityId: string): Promise<ChainBase | null> {
  const mpr = (id: string) => prisma.materialPurchaseRequest.findFirst({ where: { id, projectId }, select: { id: true, mprNumber: true } });
  const quotationBase = async (q: { id: string; quotationNumber: string; mprId: string | null }): Promise<ChainBase | null> => {
    if (q.mprId) {
      const m = await mpr(q.mprId);
      if (m) return mprBase(m);
    }
    return { baseType: 'QUOTATION', baseId: q.id, baseNumber: q.quotationNumber };
  };
  const poBase = async (po: { id: string; poNumber: string; mprId: string | null; quotationId: string | null }): Promise<ChainBase | null> => {
    if (po.mprId) {
      const m = await mpr(po.mprId);
      if (m) return mprBase(m);
    }
    if (po.quotationId) {
      const q = await prisma.quotation.findFirst({ where: { id: po.quotationId, projectId }, select: { id: true, quotationNumber: true, mprId: true } });
      if (q) return quotationBase(q);
    }
    return { baseType: 'PURCHASE_ORDER', baseId: po.id, baseNumber: po.poNumber };
  };
  const poById = async (poId: string | null | undefined) => {
    if (!poId) return null;
    const po = await prisma.purchaseOrder.findFirst({ where: { id: poId, projectId }, select: { id: true, poNumber: true, mprId: true, quotationId: true } });
    return po ? poBase(po) : null;
  };

  switch (entityType) {
    case 'MATERIAL_PURCHASE_REQUEST': {
      const m = await mpr(entityId);
      return m ? mprBase(m) : null;
    }
    case 'QUOTATION': {
      const q = await prisma.quotation.findFirst({ where: { id: entityId, projectId }, select: { id: true, quotationNumber: true, mprId: true } });
      return q ? quotationBase(q) : null;
    }
    case 'PURCHASE_ORDER':
      return poById(entityId);
    case 'GATE_PASS': {
      const g = await prisma.gatePass.findFirst({ where: { id: entityId, projectId }, select: { poId: true, invoiceId: true } });
      if (!g) return null;
      if (g.poId) return poById(g.poId);
      if (g.invoiceId) {
        const inv = await prisma.vendorInvoice.findFirst({ where: { id: g.invoiceId, projectId }, select: { poId: true } });
        return poById(inv?.poId);
      }
      return null;
    }
    case 'VENDOR_INVOICE': {
      const inv = await prisma.vendorInvoice.findFirst({ where: { id: entityId, projectId }, select: { poId: true } });
      return poById(inv?.poId);
    }
    case 'GOODS_RECEIPT': {
      const g = await prisma.goodsReceipt.findFirst({ where: { id: entityId, projectId }, select: { poId: true } });
      return poById(g?.poId);
    }
    default:
      return null;
  }
}

export interface ProofNumberRow {
  id: string;
  number: string;
  baseType: string;
  baseNumber: string;
  issuedAt: Date;
  issuedByName: string | null;
  usedAt: Date | null;
  reuseCount: number;
}

const toRow = (p: { id: string; number: string; baseType: string; baseNumber: string; issuedAt: Date; issuedBy: string; usedAt: Date | null; reuseCount: number }, names: Map<string, string>): ProofNumberRow => ({
  id: p.id,
  number: p.number,
  baseType: p.baseType,
  baseNumber: p.baseNumber,
  issuedAt: p.issuedAt,
  issuedByName: names.get(p.issuedBy) ?? null,
  usedAt: p.usedAt,
  reuseCount: p.reuseCount,
});

async function names(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Retry once when two people click at the same moment and pick the same sequence. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
}

/** Next proof number for the chain of this record. */
export async function issueChainProof(projectId: string, userId: string, entityType: string, entityId: string): Promise<ProofNumberRow> {
  if (!(PROOF_ENTITY_TYPES as readonly string[]).includes(entityType)) throw new ProofError('Proof numbers cannot be issued for this kind of record');
  const base = await resolveChainBase(projectId, entityType, entityId);
  if (!base) throw new ProofError('Record not found', 404);
  const row = await withRetry(async () => {
    const last = await prisma.proofNumber.aggregate({ where: { projectId, baseType: base.baseType, baseId: base.baseId }, _max: { seq: true } });
    const seq = (last._max.seq ?? 0) + 1;
    return prisma.proofNumber.create({
      data: { projectId, number: `${base.baseNumber}-P${seq}`, baseType: base.baseType, baseId: base.baseId, baseNumber: base.baseNumber, seq, issuedBy: userId },
    });
  });
  return toRow(row, await names([userId]));
}

/**
 * Request numbers held back for a site bill whose proof number was issued before the bill exists
 * (the form asks for the number first). A reserved number is baseType SITE_BILL until the bill is saved.
 */
async function reservedRequestNumbers(projectId: string): Promise<Set<string>> {
  const rows = await prisma.proofNumber.findMany({ where: { projectId, baseType: 'SITE_BILL' }, select: { baseNumber: true } });
  return new Set(rows.map((r) => r.baseNumber));
}

/** Moves a freshly generated request number past any number reserved for a site bill. */
export async function skipReservedRequestNumber(projectId: string, candidate: string): Promise<string> {
  const reserved = await reservedRequestNumbers(projectId);
  let current = candidate;
  for (let i = 0; i < 50 && reserved.has(current); i++) {
    const m = current.match(/^(.*?)(\d+)$/);
    if (!m) break;
    current = m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
  }
  return current;
}

/**
 * Site bills are numbered like any request (VGH-MPR021) and their proof number is that number plus
 * -P1. The bill form asks for the proof number before the bill exists, so the next request number
 * is reserved here and the bill is saved under it.
 */
export async function issueSiteBillProof(projectId: string, userId: string): Promise<ProofNumberRow> {
  const row = await withRetry(async () => {
    const next = await skipReservedRequestNumber(projectId, await generateProjectSequenceNumber('materialPurchaseRequest', 'mprNumber', 'MPR', 3, projectId));
    return prisma.proofNumber.create({
      data: { projectId, number: `${next}-P1`, baseType: 'SITE_BILL', baseNumber: next, seq: 1, issuedBy: userId },
    });
  });
  return toRow(row, await names([userId]));
}

/** The reserved request number a site-bill proof number was issued with (null when not a reservation). */
export async function reservedNumberForProof(projectId: string, proofNumber: string | null | undefined): Promise<string | null> {
  if (!proofNumber) return null;
  const row = await prisma.proofNumber.findUnique({ where: { projectId_number: { projectId, number: proofNumber.trim().toUpperCase() } } });
  return row && row.baseType === 'SITE_BILL' ? row.baseNumber : null;
}

/** Numbers already issued on the chain of this record (newest last). */
export async function listChainProofs(projectId: string, entityType: string, entityId: string): Promise<{ base: ChainBase | null; items: ProofNumberRow[] }> {
  const base = await resolveChainBase(projectId, entityType, entityId);
  if (!base) return { base: null, items: [] };
  const rows = await prisma.proofNumber.findMany({ where: { projectId, baseType: base.baseType, baseId: base.baseId }, orderBy: { seq: 'asc' } });
  const n = await names(rows.map((r) => r.issuedBy));
  return { base, items: rows.map((r) => toRow(r, n)) };
}

/** Site-bill numbers this user issued and has not used yet (to pick from on the bill form). */
export async function listOpenSiteBillProofs(projectId: string, userId: string): Promise<ProofNumberRow[]> {
  const rows = await prisma.proofNumber.findMany({ where: { projectId, baseType: 'SITE_BILL', issuedBy: userId, usedAt: null }, orderBy: { seq: 'desc' }, take: 20 });
  return rows.map((r) => toRow(r, new Map()));
}

/**
 * Ties a bill to its proof number once it exists: the reserved one it was saved under becomes a normal
 * request-chain number, or (no number supplied, e.g. bills made through Miko) the next one is issued.
 * Never throws.
 */
export async function attachSiteBillProof(projectId: string, userId: string, bill: { id: string; mprNumber: string }, headerNumber?: string | null): Promise<string | null> {
  try {
    const proof = headerNumber
      ? await prisma.proofNumber.findUnique({ where: { projectId_number: { projectId, number: headerNumber.trim().toUpperCase() } } })
      : null;
    if (proof && proof.baseType === 'SITE_BILL' && proof.baseNumber === bill.mprNumber) {
      await prisma.proofNumber.update({
        where: { id: proof.id },
        data: { baseType: 'MPR', baseId: bill.id, usedOnType: 'MATERIAL_PURCHASE_REQUEST', usedOnId: bill.id, usedAt: proof.usedAt ?? new Date() },
      });
      return proof.number;
    }
    const issued = await issueChainProof(projectId, userId, 'MATERIAL_PURCHASE_REQUEST', bill.id);
    await prisma.proofNumber.update({ where: { id: issued.id }, data: { usedOnType: 'MATERIAL_PURCHASE_REQUEST', usedOnId: bill.id, usedAt: new Date() } });
    return issued.number;
  } catch (err) {
    console.error('[Proof] site bill attach failed:', err);
    return null;
  }
}

/** The proof number a site bill carries (for display). */
export async function proofOfRecord(projectId: string, entityId: string): Promise<string[]> {
  const rows = await prisma.proofNumber.findMany({ where: { projectId, usedOnId: entityId }, select: { number: true } });
  return rows.map((r) => r.number);
}
