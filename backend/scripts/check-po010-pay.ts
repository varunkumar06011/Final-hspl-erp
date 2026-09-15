import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const payments = await prisma.paymentRequest.findMany({
    where: { poId: 'f4842cfe-415b-42f9-bb92-974aa2ac524d' },
    select: { id: true, paymentCode: true, status: true, amount: true, deletedAt: true },
  });
  console.log('Payment requests for VGH-PO010:');
  for (const p of payments) {
    console.log(`  ${p.paymentCode} | status: ${p.status} | amount: ${p.amount} | deletedAt: ${p.deletedAt?.toISOString() ?? 'null'}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
