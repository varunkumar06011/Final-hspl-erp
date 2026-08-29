/**
 * Backfill asset traceability FK links (poId, grnId, vendorId, gatePassId)
 * from the frozen snapshot strings stored on each asset at creation time.
 *
 * Run with:  npx tsx prisma/backfill-asset-links.ts
 *
 * This is idempotent: it only fills FKs that are currently null and for which
 * a matching source record can be found. Assets whose snapshots are missing or
 * whose source records were deleted are left untouched (FK stays null).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔗 Backfilling asset traceability links...');

  const assets = await prisma.asset.findMany({
    where: {
      OR: [{ poId: null }, { grnId: null }, { vendorId: null }, { gatePassId: null }],
    },
    select: {
      id: true,
      projectId: true,
      poNumber: true,
      receiptNumber: true,
      vendorCode: true,
      gatePassNumber: true,
      poId: true,
      grnId: true,
      vendorId: true,
      gatePassId: true,
    },
  });

  if (assets.length === 0) {
    console.log('✅ All assets already have traceability links. Nothing to do.');
    return;
  }

  console.log(`   Found ${assets.length} asset(s) with missing links.`);

  // Preload lookup maps keyed by (projectId, businessNumber) and vendorCode.
  // vendorCode is globally unique, so a single map suffices for vendors.
  const poNumbers = new Set<string>();
  const receiptNumbers = new Set<string>();
  const gatePassNumbers = new Set<string>();
  const vendorCodes = new Set<string>();
  for (const a of assets) {
    if (!a.poId && a.poNumber) poNumbers.add(a.poNumber);
    if (!a.grnId && a.receiptNumber) receiptNumbers.add(a.receiptNumber);
    if (!a.gatePassId && a.gatePassNumber) gatePassNumbers.add(a.gatePassNumber);
    if (!a.vendorId && a.vendorCode) vendorCodes.add(a.vendorCode);
  }

  const projectIds = [...new Set(assets.map((a) => a.projectId))];

  const [pos, grns, gatePasses, vendors] = await Promise.all([
    poNumbers.size
      ? prisma.purchaseOrder.findMany({
          where: { projectId: { in: projectIds }, poNumber: { in: [...poNumbers] }, deletedAt: null },
          select: { id: true, projectId: true, poNumber: true, vendorId: true, quotationId: true },
        })
      : Promise.resolve([]),
    receiptNumbers.size
      ? prisma.goodsReceipt.findMany({
          where: { projectId: { in: projectIds }, receiptNumber: { in: [...receiptNumbers] }, deletedAt: null },
          select: { id: true, projectId: true, receiptNumber: true, poId: true, gatePassId: true },
        })
      : Promise.resolve([]),
    gatePassNumbers.size
      ? prisma.gatePass.findMany({
          where: { projectId: { in: projectIds }, passNumber: { in: [...gatePassNumbers] }, deletedAt: null },
          select: { id: true, projectId: true, passNumber: true },
        })
      : Promise.resolve([]),
    vendorCodes.size
      ? prisma.vendor.findMany({
          where: { vendorCode: { in: [...vendorCodes] }, deletedAt: null },
          select: { id: true, vendorCode: true },
        })
      : Promise.resolve([]),
  ]);

  const poByKey = new Map<string, (typeof pos)[number]>();
  for (const p of pos) poByKey.set(`${p.projectId}|${p.poNumber}`, p);

  const grnByKey = new Map<string, (typeof grns)[number]>();
  for (const g of grns) grnByKey.set(`${g.projectId}|${g.receiptNumber}`, g);

  const gatePassByKey = new Map<string, (typeof gatePasses)[number]>();
  for (const g of gatePasses) gatePassByKey.set(`${g.projectId}|${g.passNumber}`, g);

  const vendorByCode = new Map<string, (typeof vendors)[number]>();
  for (const v of vendors) vendorByCode.set(v.vendorCode, v);

  let updated = 0;
  let skipped = 0;

  for (const a of assets) {
    const po = a.poNumber ? poByKey.get(`${a.projectId}|${a.poNumber}`) : undefined;
    const grn = a.receiptNumber ? grnByKey.get(`${a.projectId}|${a.receiptNumber}`) : undefined;
    const gatePass = a.gatePassNumber ? gatePassByKey.get(`${a.projectId}|${a.gatePassNumber}`) : undefined;
    const vendor = a.vendorCode ? vendorByCode.get(a.vendorCode) : undefined;

    // Prefer the FK's own nested links when our snapshot lookup missed them:
    // a GRN already carries poId + gatePassId, and a PO carries vendorId + quotationId.
    const resolvedPoId = a.poId ?? po?.id ?? grn?.poId ?? null;
    const resolvedGrnId = a.grnId ?? grn?.id ?? null;
    const resolvedGatePassId = a.gatePassId ?? gatePass?.id ?? grn?.gatePassId ?? null;
    const resolvedVendorId = a.vendorId ?? vendor?.id ?? po?.vendorId ?? null;
    const resolvedQuotationId = po?.quotationId ?? null;

    const hasUpdate =
      (resolvedPoId && a.poId !== resolvedPoId) ||
      (resolvedGrnId && a.grnId !== resolvedGrnId) ||
      (resolvedVendorId && a.vendorId !== resolvedVendorId) ||
      (resolvedGatePassId && a.gatePassId !== resolvedGatePassId) ||
      (resolvedQuotationId && !a.quotationId);

    if (!hasUpdate) {
      skipped++;
      continue;
    }

    await prisma.asset.update({
      where: { id: a.id },
      data: {
        poId: resolvedPoId,
        grnId: resolvedGrnId,
        vendorId: resolvedVendorId,
        gatePassId: resolvedGatePassId,
        quotationId: resolvedQuotationId,
      },
    });
    updated++;
  }

  console.log(`✅ Backfill complete. Updated ${updated} asset(s), skipped ${skipped}.`);
}

main()
  .catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
