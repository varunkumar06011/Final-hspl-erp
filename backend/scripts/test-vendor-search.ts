import { prisma } from '../src/config/prisma';

// Replicates crudFactory's list where-clause for /vendors?search=...
const PROJECT_ID = '78996889-e6d1-4f54-aa5e-8f62f5027394';
const SEARCH = process.argv[2] ?? 'steel';

(async () => {
  const where = {
    projectId: PROJECT_ID,
    deletedAt: null,
    OR: ['name', 'vendorCode', 'category', 'description', 'gstNumber', 'panNumber', 'phone', 'email', 'address', 'contactPersonName', 'contactPersonPhone', 'referenceBy'].map(
      (field) => ({ [field]: { contains: SEARCH, mode: 'insensitive' as const } }),
    ),
  };

  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({ where, select: { vendorCode: true, name: true }, take: 20 }),
    prisma.vendor.count({ where }),
  ]);
  console.log(`search="${SEARCH}" → ${total} match(es)`);
  for (const v of rows) console.log(`  ${v.vendorCode} ${v.name}`);

  const all = await prisma.vendor.count({ where: { projectId: PROJECT_ID, deletedAt: null } });
  console.log(`total vendors in project: ${all}`);
  await prisma.$disconnect();
})();
