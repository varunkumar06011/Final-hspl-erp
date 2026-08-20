import { PrismaClient } from '@prisma/client';
import { UserRole, ProjectStatus, VendorStatus, VendorCategory } from '@hospital-erp/shared';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════
// SAFETY GUARD: refuse to run outside development
// ═══════════════════════════════════════════════════════════
if (process.env.NODE_ENV !== 'development') {
  console.error('❌ REFUSING TO SEED: NODE_ENV is not "development".');
  console.error('   Seed scripts may only run against a development database.');
  console.error(`   Current NODE_ENV: ${process.env.NODE_ENV || '(unset)'}`);
  process.exit(1);
}

async function main() {
  console.log('🌱 Seeding database...');

  // Clean existing data (safe — we already verified NODE_ENV=development)
  await prisma.auditLog.deleteMany();
  await prisma.approvalStep.deleteMany();
  await prisma.approvalWorkflow.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.paymentRequest.deleteMany();
  await prisma.vendorInvoice.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.gatePassItem.deleteMany();
  await prisma.gatePass.deleteMany();
  await prisma.sitePhoto.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.contractMilestone.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.staffAttendance.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.document.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.project.deleteMany();

  // Create project
  const project = await prisma.project.create({
    data: {
      name: 'Hospital Construction - Phase 1',
      description: '₹30 Crore, 6-month hospital construction project',
      totalBudget: 3000000000, // ₹30 Crore in rupees
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-30'),
      status: ProjectStatus.ACTIVE,
    },
  });
  console.log(`  ✓ Project: ${project.name}`);

  // Create second project for cross-project isolation tests
  const projectB = await prisma.project.create({
    data: {
      name: 'Hospital Construction - Phase 2 (Test)',
      description: 'Second project for cross-project isolation testing',
      totalBudget: 500000000,
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-12-31'),
      status: ProjectStatus.PLANNED,
    },
  });
  console.log(`  ✓ Project B: ${projectB.name} (for isolation tests)`);

  // Create 4 admin users (placeholder phones — replace before first run)
  const users = await Promise.all([
    prisma.user.create({
      data: {
        firebaseUid: 'pending-+919000000001',
        phone: '+919000000001',
        name: 'Admin One',
        role: UserRole.PROJECT_HEAD,
        projectId: project.id,
        isActive: true,
      },
    }),
    prisma.user.create({
      data: {
        firebaseUid: 'pending-+919000000002',
        phone: '+919000000002',
        name: 'Admin Two',
        role: UserRole.HEAD_OF_CONSTRUCTION,
        projectId: project.id,
        isActive: true,
      },
    }),
    prisma.user.create({
      data: {
        firebaseUid: 'pending-+919000000003',
        phone: '+919000000003',
        name: 'Admin Three',
        role: UserRole.ADMIN,
        projectId: project.id,
        isActive: true,
      },
    }),
    prisma.user.create({
      data: {
        firebaseUid: 'pending-+919000000004',
        phone: '+919000000004',
        name: 'Admin Four',
        role: UserRole.ADMIN_2,
        projectId: project.id,
        isActive: true,
      },
    }),
  ]);
  console.log(`  ✓ ${users.length} users created (one per role)`);

  // Create a test vendor in Project A
  const vendorA = await prisma.vendor.create({
    data: {
      projectId: project.id,
      name: 'Test Vendor A',
      gstNumber: '27ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      category: VendorCategory.MATERIAL_SUPPLIER,
      bankName: 'Test Bank',
      bankAccountNumber: '1234567890',
      ifscCode: 'TEST0001234',
      phone: '+919876543210',
      email: 'vendorA@test.com',
      status: VendorStatus.ACTIVE,
      createdBy: users[0].id,
    },
  });
  console.log(`  ✓ Vendor A: ${vendorA.name}`);

  // Create a test vendor in Project B (for isolation tests)
  const vendorB = await prisma.vendor.create({
    data: {
      projectId: projectB.id,
      name: 'Test Vendor B',
      category: VendorCategory.MATERIAL_SUPPLIER,
      status: VendorStatus.ACTIVE,
      createdBy: users[0].id,
    },
  });
  console.log(`  ✓ Vendor B: ${vendorB.name} (Project B)`);

  console.log('\n✅ Seed complete!');
  console.log('\n📋 Seed Users (replace with real phone numbers before first login):');
  console.log('  PROJECT_HEAD:          Admin One   — +91 9000000001');
  console.log('  HEAD_OF_CONSTRUCTION:  Admin Two   — +91 9000000002');
  console.log('  ADMIN:                 Admin Three — +91 9000000003');
  console.log('  ADMIN_2:               Admin Four  — +91 9000000004');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
