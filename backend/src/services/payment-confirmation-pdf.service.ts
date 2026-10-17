import PDFDocument from 'pdfkit';

export interface PaymentConfirmationData {
  projectName: string;
  paymentCode: string;
  vendorName: string;
  vendorCode?: string | null;
  amount: number;
  type: string;
  poNumber?: string | null;
  invoiceCode?: string | null;
  description?: string | null;
  mode?: string | null;
  reference?: string | null;
  account?: string | null;
  voucherNumber?: string | null;
  paidOn: Date;
}

/** One-page "payment done" slip that is shared with the vendor / head over WhatsApp. */
export function streamPaymentConfirmationPdf(res: NodeJS.WritableStream, d: PaymentConfirmationData) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(res);

  const left = 42;
  const width = 595 - left * 2;
  const primary = '#0F4C4C';
  const primaryLight = '#E8F5F5';
  const dark = '#263238';
  const muted = '#78909C';
  const border = '#B0BEC5';

  const money = `INR ${d.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const label = (v: string) => v.replace(/_/g, ' ');
  const dateText = d.paidOn.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

  doc.rect(0, 0, 595, 90).fill(primary);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(d.projectName, left, 28, { width });
  doc.font('Helvetica').fontSize(10).text('Payment Confirmation', left, 56, { width });

  let y = 120;
  doc.roundedRect(left, y, width, 90, 6).fill(primaryLight);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(11).text('PAYMENT DONE', left + 18, y + 16);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(26).text(money, left + 18, y + 38, { width: width - 36 });
  y += 114;

  const rows: [string, string][] = [
    ['Paid to', d.vendorCode ? `${d.vendorName} (${d.vendorCode})` : d.vendorName],
    ['Payment ref.', d.paymentCode],
    ['Date', dateText],
    ['Payment type', label(d.type)],
  ];
  if (d.poNumber) rows.push(['Purchase order', d.poNumber]);
  if (d.invoiceCode) rows.push(['Invoice', d.invoiceCode]);
  if (d.mode) rows.push(['Mode', label(d.mode)]);
  if (d.reference) rows.push(['UTR / reference', d.reference]);
  if (d.account) rows.push(['Paid from', d.account]);
  if (d.voucherNumber) rows.push(['Voucher no.', d.voucherNumber]);
  if (d.description) rows.push(['For', d.description]);

  const rowH = 30;
  for (const [k, v] of rows) {
    doc.rect(left, y, 150, rowH).fill(primaryLight).stroke(border);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(9).text(k, left + 10, y + 10, { width: 135 });
    doc.rect(left + 150, y, width - 150, rowH).fill('#ffffff').stroke(border);
    doc.fillColor(dark).font('Helvetica').fontSize(10).text(v, left + 160, y + 10, { width: width - 170, height: rowH - 12, ellipsis: true });
    y += rowH;
  }

  doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(
    'This is a system-generated confirmation that the above payment has been made.',
    left,
    y + 24,
    { width, align: 'center' },
  );

  doc.end();
}
