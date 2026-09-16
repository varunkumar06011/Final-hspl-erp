import { prisma } from '../src/config/prisma';

const IDS = {
  'VGH-PO019': 'd3d69264-1350-46c2-9056-67104dfc7ae1',
  'VGH-PO020': '08aaff72-86c1-46a3-8869-7e8e2c34359a',
  'VGH-PO021': '465a014e-cbfd-498c-9e28-1f4d80466749',
  'VGH-PO022': '47022b70-d646-4fbe-bf03-9c236fc7fe44',
  'VGH-PO023': 'a0d73d4c-5861-45d4-8c91-ed00f96077d8',
  'VGH-PO024': '4666a7c8-b03f-4a67-b662-e4c2b9124687',
};

async function main() {
  const notifs = await prisma.appNotification.findMany({
    where: {
      OR: [
        { entityId: { in: Object.values(IDS) } },
        ...Object.keys(IDS).map((n) => ({ body: { contains: n } })),
        ...Object.keys(IDS).map((n) => ({ title: { contains: n } })),
      ],
    },
    select: { id: true, entityId: true, entityType: true, title: true, body: true, url: true, isRead: true },
  });
  console.log(`notifications referencing target POs: ${notifs.length}`);
  for (const n of notifs) console.log(` ${n.id} entityType=${n.entityType} title="${n.title}" body="${n.body}" url=${n.url} read=${n.isRead}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
