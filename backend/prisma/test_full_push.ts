import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';

dotenv.config();

const prisma = new PrismaClient();

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  }),
});

async function main() {
  const projectId = '78996889-e6d1-4f54-aa5e-8f62f5027394';
  const approverRoles = ['PROJECT_HEAD', 'HEAD_OF_CONSTRUCTION', 'ADMIN', 'ADMIN_2'];

  // Step 1: Find approvers
  const approvers = await prisma.user.findMany({
    where: { projectId, isActive: true, role: { in: approverRoles } },
    select: { id: true, name: true, role: true },
  });
  console.log('=== APPROVERS FOUND ===');
  for (const a of approvers) {
    console.log(`  - ${a.name} (${a.role}) → ${a.id}`);
  }

  // Step 2: Get their push subscriptions
  const approverIds = approvers.map(a => a.id);
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: approverIds }, isActive: true },
    select: { token: true, userId: true },
  });
  console.log('\n=== SUBSCRIPTIONS ===');
  console.log(`Found ${subscriptions.length} subscription(s)`);
  for (const s of subscriptions) {
    const user = approvers.find(a => a.id === s.userId);
    console.log(`  - ${user?.name}: ${s.token.substring(0, 40)}...`);
  }

  if (subscriptions.length === 0) {
    console.log('\n❌ No subscriptions — no push will be sent!');
    return;
  }

  // Step 3: Send via sendEachForMulticast (same as push.service.ts)
  const tokens = subscriptions.map(s => s.token);
  const message = {
    notification: {
      title: '🔔 Test: New Approval Required',
      body: 'Test PO notification — if you see this, the full flow works!',
    },
    data: {
      type: 'approval_request',
      approvalId: 'test-approval-id',
      entityType: 'PURCHASE_ORDER',
      entityId: 'test-po-id',
      title: '🔔 Test: New Approval Required',
      body: 'Test PO notification — if you see this, the full flow works!',
      url: '/pos?approval=test-approval-id',
    },
    tokens,
  };

  console.log('\n=== SENDING PUSH ===');
  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ Sent to ${response.successCount}/${tokens.length} devices`);
    console.log(`   Success: ${response.successCount}, Failure: ${response.failureCount}`);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, index) => {
        if (!resp.success) {
          console.error(`   ❌ Token ${index} failed: ${resp.error?.code} — ${resp.error?.message}`);
        }
      });
    }
  } catch (error: any) {
    console.error('❌ sendEachForMulticast failed:', error.message);
    console.error('Error code:', error.code);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
