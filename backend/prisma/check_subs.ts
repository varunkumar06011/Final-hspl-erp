import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const subs = await prisma.pushSubscription.findMany({
    select: { id: true, userId: true, token: true, isActive: true, userAgent: true, createdAt: true },
  });
  console.log('=== PUSH SUBSCRIPTIONS ===');
  console.log('Total count:', subs.length);
  console.log('Active count:', subs.filter(s => s.isActive).length);
  for (const s of subs) {
    console.log(`  - user: ${s.userId}, active: ${s.isActive}, token: ${s.token.substring(0, 30)}..., agent: ${s.userAgent?.substring(0, 60) ?? 'null'}, created: ${s.createdAt}`);
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true, projectId: true },
  });
  console.log('\n=== ACTIVE USERS ===');
  for (const u of users) {
    const hasSub = subs.some(s => s.userId === u.id && s.isActive);
    console.log(`  - ${u.name} | role: ${u.role} | project: ${u.projectId} | has push: ${hasSub}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
