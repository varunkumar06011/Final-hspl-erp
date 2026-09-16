import { PassThrough } from 'stream';
import { writeFileSync } from 'fs';
import { streamPaymentSheetPdf } from '../src/services/payment-sheet-pdf.service';

const project = {
  name: 'Test Hospital',
  logoUrl: null,
  address: 'Test Address',
};

function collect(res: PassThrough): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function main() {
  // Test 1: empty day
  const res1 = new PassThrough();
  const p1 = collect(res1);
  await streamPaymentSheetPdf(res1, new Date('2026-09-15'), [], project, { summaryOnly: true });
  const buf1 = await p1;
  writeFileSync('empty-sheet.pdf', buf1);
  console.log('EMPTY DAY PDF:', buf1.length, 'bytes, header:', buf1.slice(0, 8).toString());

  // Test 2: mixed statuses — PENDING 200000 + PAID 2106152 + ADVANCE_PAID 50000
  const entries = [
    {
      status: 'PAID', amount: '2106152', paymentMode: 'NEFT',
      notes: 'paid entry', reference: 'ref1',
      purchaseOrder: { poNumber: 'VGH-PO001', vendor: { name: 'Vendor A' } },
      createdByUser: { name: 'User X' },
    },
    {
      status: 'ADVANCE_PAID', amount: '50000', paymentMode: 'CASH',
      notes: 'advance', reference: null,
      purchaseOrder: { poNumber: 'VGH-PO002', vendor: { name: 'Vendor B' } },
      createdByUser: { name: 'User Y' },
    },
    {
      status: 'PENDING', amount: '200000', paymentMode: 'UPI',
      notes: 'pending entry', reference: null,
      purchaseOrder: { poNumber: 'VGH-PO003', vendor: { name: 'Vendor C' } },
      createdByUser: { name: 'User Z' },
    },
  ];
  const res2 = new PassThrough();
  const p2 = collect(res2);
  await streamPaymentSheetPdf(res2, new Date('2026-09-15'), entries, project, { summaryOnly: true });
  const buf2 = await p2;
  writeFileSync('mixed-sheet.pdf', buf2);
  console.log('MIXED DAY PDF:', buf2.length, 'bytes, header:', buf2.slice(0, 8).toString());
  console.log('Expected: GRAND=2356152, PAID=2156152, PAYABLE=200000');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
