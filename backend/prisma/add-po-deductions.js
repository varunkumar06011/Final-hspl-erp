const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE purchase_orders
     ADD COLUMN IF NOT EXISTS deductions JSONB,
     ADD COLUMN IF NOT EXISTS total_deductions DECIMAL(15,2) DEFAULT 0,
     ADD COLUMN IF NOT EXISTS net_payable DECIMAL(15,2) DEFAULT 0`
  );
  console.log('Columns added successfully');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
