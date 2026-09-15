import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getStorageService } from './storage.service';

/**
 * Streams the daily Payment Sheet PDF — compact single-page layout.
 * Header → entries summary table → per-entry full PO details → day total → signature block.
 * Mirrors the visual language of purchase-order-pdf.service.ts.
 */
export async function streamPaymentSheetPdf(
  res: NodeJS.WritableStream,
  date: Date,
  entries: any[],
  project: any,
) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(res as unknown as any);

  const pageW = 595;
  const pageH = 842;
  const left = 42;
  const right = pageW - left;
  const width = right - left;

  const primary = '#0F4C4C';
  const primaryLight = '#E8F5F5';
  const dark = '#263238';
  const muted = '#78909C';
  const border = '#B0BEC5';

  const fmtMoney = (n: number) => `Rs. ${Number(n).toFixed(2)}`;
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const fmtDate = (d: unknown) =>
    d ? new Date(d as string).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
  const fmtDateTime = (d: unknown) =>
    d ? new Date(d as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

  // ── Load logo if present ──
  let logoBuffer: Buffer | null = null;
  if (project?.logoUrl) {
    try {
      const raw = await getStorageService().getFile(project.logoUrl);
      logoBuffer = await sharp(raw)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png({ compressionLevel: 9 })
        .resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    } catch (err: any) {
      console.error('[PaymentSheet PDF] Failed to load/process logo:', err?.message ?? err);
    }
  }

  // ── Top header box ──
  const headerTop = 24;
  const headerH = 78;
  const dateBoxW = 120;
  const dateBoxX = right - dateBoxW - 12;

  doc.roundedRect(left, headerTop, width, headerH, 6).fill('#ffffff').stroke(border);

  const sepX = dateBoxX - 6;
  doc.moveTo(sepX, headerTop + 12).lineTo(sepX, headerTop + headerH - 12).stroke(border);

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + 12, headerTop + 8, { fit: [70, 62] });
    } catch (err: any) {
      console.error('[PaymentSheet PDF] PNG logo failed, trying JPEG:', err?.message ?? err);
      try {
        const jpegBuffer = await sharp(logoBuffer).jpeg({ quality: 95 }).toBuffer();
        doc.image(jpegBuffer, left + 12, headerTop + 8, { fit: [70, 62] });
      } catch {
        // ignore
      }
    }
  }

  const titleX = left + (logoBuffer ? 94 : 16);
  const titleWidth = 245;
  const title = text(project?.name ?? 'Hospital Construction ERP');

  doc.fillColor(dark).font('Helvetica-Bold').fontSize(17);
  const titleH = doc.heightOfString(title, { width: titleWidth });
  doc.text(title, titleX, headerTop + 12, { width: titleWidth });

  doc.font('Helvetica').fontSize(8).fillColor(muted)
    .text(text(project?.officeAddress), titleX, headerTop + 14 + titleH + 4, { width: titleWidth });

  // Date box on the right
  doc.roundedRect(dateBoxX, headerTop + 10, dateBoxW, 58, 4).fill('#ffffff').stroke(border);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(9)
    .text('SHEET DATE', dateBoxX, headerTop + 22, { width: dateBoxW, align: 'center' });
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(13)
    .text(fmtDate(date), dateBoxX, headerTop + 40, { width: dateBoxW, align: 'center' });

  let y = headerTop + headerH + 12;

  // ── Title ──
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(15).text('PAYMENT SHEET', left, y);
  y += 20;

  const totalAmount = entries.reduce((sum, e) => sum + Number(e.amount), 0);

  // ── Entries summary table ──
  const colGap = 3;
  const cols = [
    { label: 'S.No', w: 24 },
    { label: 'PO Number', w: 70 },
    { label: 'Vendor', w: 105 },
    { label: 'Amount', w: 75 },
    { label: 'Mode', w: 68 },
    { label: 'Reference', w: 75 },
    { label: 'Status', w: 0 }, // remainder
  ];
  cols[cols.length - 1].w = width - cols.slice(0, -1).reduce((s, c) => s + c.w + colGap, 0);
  const colX = cols.map((_, i) => left + cols.slice(0, i).reduce((s, c2) => s + c2.w + colGap, 0));

  doc.rect(left, y, width, 20).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
  cols.forEach((c, i) => {
    const align = c.label === 'Amount' ? 'right' : c.label === 'S.No' ? 'center' : 'left';
    doc.text(c.label, colX[i] + 4, y + 6, { width: c.w - 8, align });
  });
  y += 20;

  const sumRowH = 16;
  entries.forEach((e, i) => {
    if (i % 2 === 0) doc.rect(left, y, width, sumRowH).fill(primaryLight);
    doc.rect(left, y, width, sumRowH).stroke(border);
    doc.fillColor(dark).font('Helvetica').fontSize(8);
    const vals = [
      String(i + 1),
      text(e.purchaseOrder?.poNumber),
      text(e.purchaseOrder?.vendor?.name),
      fmtMoney(Number(e.amount)),
      text(e.paymentMode),
      text(e.reference),
      text(e.status),
    ];
    cols.forEach((c, ci) => {
      const align = c.label === 'Amount' ? 'right' : c.label === 'S.No' ? 'center' : 'left';
      doc.text(vals[ci], colX[ci] + 4, y + 4, { width: c.w - 8, align });
    });
    y += sumRowH;
  });

  // Day total row
  doc.rect(left, y, width, 22).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
    .text(`TOTAL PAID — ${fmtDate(date)}`, left + 8, y + 6, { width: width - 110 });
  doc.text(fmtMoney(totalAmount), left + 8, y + 6, { width: width - 16, align: 'right' });
  y += 30;

  // ── Per-entry detail blocks (full PO details, compact) ──
  for (const e of entries) {
    const po = e.purchaseOrder;
    if (!po) continue;

    if (y > pageH - 200) { doc.addPage(); y = 40; }

    doc.moveTo(left, y).lineTo(right, y).stroke(border);
    y += 8;
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(11)
      .text(`PO DETAILS — ${text(po.poNumber)}`, left, y);
    y += 16;

    // Two-column info: PO meta left, vendor box right
    const leftW = 240;
    const gap = 10;
    const rightW = width - leftW - gap;
    const rightCol = left + leftW + gap;
    const blockTop = y;

    const drawLabel = (labelText: string, value: string, xx: number, yy: number, ww: number) => {
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(`${labelText}:`, xx, yy, { width: 82 });
      const valueW = ww - 90;
      const valueH = doc.heightOfString(value, { width: valueW });
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(8).text(value, xx + 86, yy, { width: valueW });
      return yy + Math.max(13, valueH + 3);
    };

    const paymentTypeLabel =
      po.paymentType === 'ADVANCE' ? 'Against Advance'
      : po.paymentType === 'FULL_PAYMENT' ? 'Against Full Payment'
      : 'After Delivery';

    y = drawLabel('PO Date', fmtDate(po.date), left, y, leftW);
    y = drawLabel('Payment Type', paymentTypeLabel, left, y, leftW);
    y = drawLabel('Payment Terms', text(po.paymentTerms), left, y, leftW);
    y = drawLabel('Delivery Due', fmtDate(po.deliveryDate), left, y, leftW);
    y = drawLabel('Budget Head', text(po.budgetHead?.particulars), left, y, leftW);
    y = drawLabel('PO Created By', text(po.createdByUser?.name), left, y, leftW);
    y = drawLabel('Grand Total', fmtMoney(Number(po.grandTotal)), left, y, leftW);
    y = drawLabel('Net Payable', fmtMoney(Number(po.netPayable)), left, y, leftW);

    // Vendor box
    const vBoxH = 80;
    doc.roundedRect(rightCol, blockTop, rightW, vBoxH, 4).stroke(border);
    doc.rect(rightCol, blockTop, rightW, 20).fill(primary);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9.5)
      .text('VENDOR DETAILS:', rightCol + 8, blockTop + 5);

    const vData = [
      ['Name', text(po.vendor?.name)],
      ['Code', text(po.vendor?.vendorCode)],
      ['Contact', text(po.vendor?.phone ?? po.vendor?.contactPersonPhone)],
      ['Address', text(po.vendor?.address)],
    ];
    let vy = blockTop + 26;
    for (const [k, v] of vData) {
      const vLabelW = 52;
      const vValueW = rightW - vLabelW - 18;
      const vh = doc.heightOfString(v, { width: vValueW });
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(`${k}:`, rightCol + 8, vy, { width: vLabelW });
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(8).text(v, rightCol + 8 + vLabelW, vy, { width: vValueW });
      vy += Math.max(12, vh + 2);
    }

    y = Math.max(y, blockTop + vBoxH + 10);

    // PO items table
    const items = po.items ?? [];
    if (items.length > 0) {
      const iCols = [
        { label: 'S.No', w: 24 },
        { label: 'Material', w: 0 },
        { label: 'Qty', w: 40 },
        { label: 'Unit', w: 44 },
        { label: 'Unit Price', w: 80 },
        { label: 'Amount', w: 85 },
      ];
      iCols[1].w = width - iCols.filter((_, i2) => i2 !== 1).reduce((s, c) => s + c.w + colGap, 0);
      const iX = iCols.map((_, i2) => left + iCols.slice(0, i2).reduce((s, c2) => s + c2.w + colGap, 0));

      doc.rect(left, y, width, 18).fill(primary);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      iCols.forEach((c, i2) => {
        const align = c.label === 'S.No' ? 'center' : c.label === 'Unit Price' || c.label === 'Amount' ? 'right' : 'left';
        doc.text(c.label, iX[i2] + 4, y + 5, { width: c.w - 8, align });
      });
      y += 18;

      const iRowH = 15;
      items.forEach((it: any, i2: number) => {
        if (i2 % 2 === 0) doc.rect(left, y, width, iRowH).fill(primaryLight);
        doc.rect(left, y, width, iRowH).stroke(border);
        doc.fillColor(dark).font('Helvetica').fontSize(8);
        const vals = [
          String(i2 + 1),
          text(it.materialName),
          text(it.quantity),
          text(it.unit),
          fmtMoney(Number(it.unitPrice)),
          fmtMoney(Number(it.amount)),
        ];
        iCols.forEach((c, ci) => {
          const align = c.label === 'S.No' ? 'center' : c.label === 'Unit Price' || c.label === 'Amount' ? 'right' : 'left';
          doc.text(vals[ci], iX[ci] + 4, y + 3, { width: c.w - 8, align });
        });
        y += iRowH;
      });
      y += 8;
    }

    // Payment made box (highlighted)
    const payBoxH = e.notes ? 62 : 50;
    doc.roundedRect(left, y, width, payBoxH, 4).fill('#FFF8E1').stroke('#FFB300');
    doc.fillColor('#E65100').font('Helvetica-Bold').fontSize(9)
      .text('PAYMENT MADE:', left + 10, y + 6);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9)
      .text(`Amount: ${fmtMoney(Number(e.amount))}    Mode: ${text(e.paymentMode)}    Reference: ${text(e.reference)}`,
        left + 10, y + 20, { width: width - 20 });
    doc.fillColor(dark).font('Helvetica').fontSize(7.5)
      .text(`Status: ${text(e.status)}    Recorded By: ${text(e.createdByUser?.name)}    Recorded At: ${fmtDateTime(e.createdAt)}`,
        left + 10, y + 33, { width: width - 20 });
    if (e.notes) {
      doc.fillColor(dark).font('Helvetica').fontSize(7.5)
        .text(`Notes: ${text(e.notes)}`, left + 10, y + 46, { width: width - 20 });
    }
    y += payBoxH + 20;
  }

  // ── Signature block (bottom-right of last page) ──
  const sigBlockH = 70;
  if (y + sigBlockH > pageH - 50) { doc.addPage(); y = 40; }
  const sigY = Math.max(y + 16, pageH - 120);
  const sigW = 180;
  const sigX = right - sigW;

  doc.moveTo(sigX, sigY).lineTo(right, sigY).stroke(dark);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(9)
    .text('Signature', sigX, sigY + 6, { width: sigW, align: 'center' });
  doc.fillColor(muted).font('Helvetica').fontSize(8.5)
    .text('T.Vinod Kumar', sigX, sigY + 20, { width: sigW, align: 'center' });

  // ── Footer ──
  doc.moveTo(left, pageH - 42).lineTo(right, pageH - 42).stroke(primary);
  doc.fillColor(muted).font('Helvetica').fontSize(7)
    .text(`Generated from Hospital Construction ERP — ${new Date().toLocaleDateString('en-IN')}`,
      left, pageH - 34, { width, align: 'center' });

  doc.end();
}
