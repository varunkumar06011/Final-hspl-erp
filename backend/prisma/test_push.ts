import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

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
  // Get Akhil's subscription
  const subs = await prisma.pushSubscription.findMany({
    where: { isActive: true },
    select: { token: true, userId: true },
  });

  if (subs.length === 0) {
    console.log('❌ No active subscriptions found');
    return;
  }

  console.log(`Found ${subs.length} subscription(s)`);

  for (const sub of subs) {
    console.log(`\nSending test push to token: ${sub.token.substring(0, 40)}...`);

    const message = {
      notification: {
        title: '🔔 Test Notification',
        body: 'This is a test push from the backend. If you see this, FCM is working!',
      },
      data: {
        type: 'test',
        title: '🔔 Test Notification',
        body: 'This is a test push from the backend. If you see this, FCM is working!',
        url: '/payments',
      },
      token: sub.token,
    };

    try {
      const response = await admin.messaging().send(message);
      console.log('✅ Push sent successfully! Message ID:', response);
    } catch (error: any) {
      console.error('❌ Push failed:', error.message);
      console.error('Error code:', error.code);
      console.error('Full error:', JSON.stringify(error, null, 2));
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
