import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getStorageService } from './storage.service';

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 42;
const RIGHT = PAGE_W - LEFT;
const WIDTH = RIGHT - LEFT;

const PRIMARY = '#0F4C4C';
const PRIMARY_LIGHT = '#E8F5F5';
const DARK = '#263238';
const MUTED = '#78909C';
const BORDER = '#B0BEC5';
const COL_GAP = 3;

const fmtMoney = (n: number) => `Rs. ${Number(n).toFixed(2)}`;
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const fmtDate = (d: unknown) =>
  d ? new Date(d as string).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const fmtDateTime = (d: unknown) =>
  d ? new Date(d as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';

/** Draws the branded top header box (logo + project + date box). Returns the y below it. */
function drawHeader(doc: PDFKit.PDFDocument, logoBuffer: Buffer | null, project: any, date: Date): number {
  const headerTop = 24;
  const headerH = 78;
  const dateBoxW = 120;
  const dateBoxX = RIGHT - dateBoxW - 12;

  doc.roundedRect(LEFT, headerTop, WIDTH, headerH, 6).fill('#ffffff').stroke(BORDER);

  const sepX = dateBoxX - 6;
  doc.moveTo(sepX, headerTop + 12).lineTo(sepX, headerTop + headerH - 12).stroke(BORDER);

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, LEFT + 12, headerTop + 8, { fit: [70, 62] });
    } catch {
      // logo failed to render — leave header text-only
    }
  }

  const titleX = LEFT + (logoBuffer ? 94 : 16);
  const titleWidth = 245;
  const title = text(project?.name ?? 'Hospital Construction ERP');

  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(17);
  const titleH = doc.heightOfString(title, { width: titleWidth });
  doc.text(title, titleX, headerTop + 12, { width: titleWidth });

  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(text(project?.officeAddress), titleX, headerTop + 14 + titleH + 4, { width: titleWidth });

  doc.roundedRect(dateBoxX, headerTop + 10, dateBoxW, 58, 4).fill('#ffffff').stroke(BORDER);
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9)
    .text('SHEET DATE', dateBoxX, headerTop + 22, { width: dateBoxW, align: 'center' });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13)
    .text(fmtDate(date), dateBoxX, headerTop + 40, { width: dateBoxW, align: 'center' });

  return headerTop + headerH + 12;
}

/** Draws one entry's full detail block: PO meta + vendor box + items table + payment box. Returns new y. */
function drawEntryDetails(doc: PDFKit.PDFDocument, e: any, startY: number): number {
  const po = e.purchaseOrder;
  let y = startY;

  doc.moveTo(LEFT, y).lineTo(RIGHT, y).stroke(BORDER);
  y += 8;
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(11)
    .text(`PO DETAILS — ${text(po?.poNumber)}`, LEFT, y);
  y += 16;

  const leftW = 240;
  const gap = 10;
  const rightW = WIDTH - leftW - gap;
  const rightCol = LEFT + leftW + gap;
  const blockTop = y;

  const drawLabel = (labelText: string, value: string, xx: number, yy: number, ww: number) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${labelText}:`, xx, yy, { width: 82 });
    const valueW = ww - 90;
    const valueH = doc.heightOfString(value, { width: valueW });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8).text(value, xx + 86, yy, { width: valueW });
    return yy + Math.max(13, valueH + 3);
  };

  const paymentTypeLabel =
    po?.paymentType === 'ADVANCE' ? 'Against Advance'
    : po?.paymentType === 'FULL_PAYMENT' ? 'Against Full Payment'
    : 'After Delivery';

  y = drawLabel('PO Date', fmtDate(po?.date), LEFT, y, leftW);
  y = drawLabel('Payment Type', paymentTypeLabel, LEFT, y, leftW);
  y = drawLabel('Payment Terms', text(po?.paymentTerms), LEFT, y, leftW);
  y = drawLabel('Delivery Due', fmtDate(po?.deliveryDate), LEFT, y, leftW);
  y = drawLabel('Budget Head', text(po?.budgetHead?.particulars), LEFT, y, leftW);
  y = drawLabel('PO Created By', text(po?.createdByUser?.name), LEFT, y, leftW);
  y = drawLabel('Grand Total', fmtMoney(Number(po?.grandTotal)), LEFT, y, leftW);
  y = drawLabel('Net Payable', fmtMoney(Number(po?.netPayable)), LEFT, y, leftW);

  // Vendor box
  const vBoxH = 80;
  doc.roundedRect(rightCol, blockTop, rightW, vBoxH, 4).stroke(BORDER);
  doc.rect(rightCol, blockTop, rightW, 20).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9.5)
    .text('VENDOR DETAILS:', rightCol + 8, blockTop + 5);

  const vData = [
    ['Name', text(po?.vendor?.name)],
    ['Code', text(po?.vendor?.vendorCode)],
    ['Contact', text(po?.vendor?.phone ?? po?.vendor?.contactPersonPhone)],
    ['Address', text(po?.vendor?.address)],
  ];
  let vy = blockTop + 26;
  for (const [k, v] of vData) {
    const vLabelW = 52;
    const vValueW = rightW - vLabelW - 18;
    const vh = doc.heightOfString(v, { width: vValueW });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${k}:`, rightCol + 8, vy, { width: vLabelW });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8).text(v, rightCol + 8 + vLabelW, vy, { width: vValueW });
    vy += Math.max(12, vh + 2);
  }

  y = Math.max(y, blockTop + vBoxH + 10);

  // PO items table
  const items = po?.items ?? [];
  if (items.length > 0) {
    const iCols = [
      { label: 'S.No', w: 24 },
      { label: 'Material', w: 0 },
      { label: 'Qty', w: 40 },
      { label: 'Unit', w: 44 },
      { label: 'Unit Price', w: 80 },
      { label: 'Amount', w: 85 },
    ];
    iCols[1].w = WIDTH - iCols.filter((_, i2) => i2 !== 1).reduce((s, c) => s + c.w + COL_GAP, 0);
    const iX = iCols.map((_, i2) => LEFT + iCols.slice(0, i2).reduce((s, c2) => s + c2.w + COL_GAP, 0));

    doc.rect(LEFT, y, WIDTH, 18).fill(PRIMARY);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    iCols.forEach((c, i2) => {
      const align = c.label === 'S.No' ? 'center' : c.label === 'Unit Price' || c.label === 'Amount' ? 'right' : 'left';
      doc.text(c.label, iX[i2] + 4, y + 5, { width: c.w - 8, align });
    });
    y += 18;

    const iRowH = 15;
    items.forEach((it: any, i2: number) => {
      if (i2 % 2 === 0) doc.rect(LEFT, y, WIDTH, iRowH).fill(PRIMARY_LIGHT);
      doc.rect(LEFT, y, WIDTH, iRowH).stroke(BORDER);
      doc.fillColor(DARK).font('Helvetica').fontSize(8);
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
  doc.roundedRect(LEFT, y, WIDTH, payBoxH, 4).fill('#FFF8E1').stroke('#FFB300');
  doc.fillColor('#E65100').font('Helvetica-Bold').fontSize(9)
    .text('PAYMENT MADE:', LEFT + 10, y + 6);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
    .text(`Amount: ${fmtMoney(Number(e.amount))}    Mode: ${text(e.paymentMode)}`,
      LEFT + 10, y + 20, { width: WIDTH - 20 });
  doc.fillColor(DARK).font('Helvetica').fontSize(7.5)
    .text(`Status: ${text(e.status)}    Recorded By: ${text(e.createdByUser?.name)}    Recorded At: ${fmtDateTime(e.createdAt)}`,
      LEFT + 10, y + 33, { width: WIDTH - 20 });
  if (e.notes) {
    doc.fillColor(DARK).font('Helvetica').fontSize(7.5)
      .text(`Notes: ${text(e.notes)}`, LEFT + 10, y + 46, { width: WIDTH - 20 });
  }
  y += payBoxH + 16;

  return y;
}

/** Signature block — Signature / T.Vinod Kumar, bottom-right. */
function drawSignature(doc: PDFKit.PDFDocument, y: number): number {
  const sigY = Math.max(y + 16, PAGE_H - 120);
  const sigW = 180;
  const sigX = RIGHT - sigW;

  doc.moveTo(sigX, sigY).lineTo(RIGHT, sigY).stroke(DARK);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
    .text('Signature', sigX, sigY + 6, { width: sigW, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text('T.Vinod Kumar', sigX, sigY + 20, { width: sigW, align: 'center' });

  return sigY;
}

/** Entries summary table + day total row. Returns new y. */
function drawSummaryTable(doc: PDFKit.PDFDocument, entries: any[], date: Date, startY: number, showDescription = false): number {
  let y = startY;

  const cols = [
    { label: 'S.No', w: 34, align: 'center' as const },
    { label: 'PO Number', w: 75, align: 'left' as const },
    { label: 'Vendor', w: 105, align: 'left' as const },
    { label: 'Amount', w: 80, align: 'right' as const },
    { label: 'Mode', w: 85, align: 'left' as const },
    { label: 'Status', w: 0, align: 'right' as const }, // remainder
  ];
  const descIdx = cols.findIndex((c) => c.w === 0);
  cols[descIdx].w = WIDTH - cols.filter((_, i) => i !== descIdx).reduce((s, c) => s + c.w + COL_GAP, 0);
  const colX = cols.map((_, i) => LEFT + cols.slice(0, i).reduce((s, c2) => s + c2.w + COL_GAP, 0));

  doc.rect(LEFT, y, WIDTH, 20).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
  cols.forEach((c, i) => {
    doc.text(c.label, colX[i] + 4, y + 6, { width: c.w - 8, align: c.align, lineBreak: false });
  });
  y += 20;

  const sumRowH = 16;
  entries.forEach((e, i) => {
    // Description (notes) gets its own full-width line under the entry row.
    const desc = showDescription ? String(e.notes ?? '').trim() : '';
    const descH = desc ? doc.heightOfString(desc, { width: WIDTH - 100 }) + 6 : 0;
    const entryH = sumRowH + descH;

    if (i % 2 === 0) doc.rect(LEFT, y, WIDTH, entryH).fill(PRIMARY_LIGHT);
    doc.rect(LEFT, y, WIDTH, entryH).stroke(BORDER);
    doc.fillColor(DARK).font('Helvetica').fontSize(8);
    const vals = [
      String(i + 1),
      text(e.purchaseOrder?.poNumber),
      text(e.purchaseOrder?.vendor?.name),
      fmtMoney(Number(e.amount)),
      text(e.paymentMode),
      text(e.status),
    ];
    cols.forEach((c, ci) => {
      doc.text(vals[ci], colX[ci] + 4, y + 4, { width: c.w - 8, align: c.align, lineBreak: false });
    });
    if (desc) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5)
        .text(desc, colX[2] + 4, y + sumRowH, { width: WIDTH - 100 });
    }
    y += entryH;
  });

  const totalAmount = entries.reduce((sum, e) => sum + Number(e.amount), 0);
  doc.rect(LEFT, y, WIDTH, 22).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
    .text(`TOTAL PAID — ${fmtDate(date)}`, LEFT + 8, y + 6, { width: WIDTH - 110 });
  doc.text(fmtMoney(totalAmount), LEFT + 8, y + 6, { width: WIDTH - 16, align: 'right' });
  y += 22;

  return y;
}

/**
 * Streams the Payment Sheet PDF.
 * - summaryOnly (day sheet): one page — header, all entries as rows with a
 *   description column, day total, signature.
 * - default (per-entry PDF): full detail — summary + PO/vendor details +
 *   payment box + signature.
 */
export async function streamPaymentSheetPdf(
  res: NodeJS.WritableStream,
  date: Date,
  entries: any[],
  project: any,
  options: { summaryOnly?: boolean } = {},
) {
  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
  doc.pipe(res as unknown as any);

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
      // Pre-validate the PNG renders; fall back to JPEG bytes if not
      try {
        await sharp(logoBuffer).stats();
      } catch {
        logoBuffer = await sharp(logoBuffer).jpeg({ quality: 95 }).toBuffer();
      }
    } catch (err: any) {
      console.error('[PaymentSheet PDF] Failed to load/process logo:', err?.message ?? err);
      logoBuffer = null;
    }
  }

  // ── Page 1: header + summary ──
  let y = drawHeader(doc, logoBuffer, project, date);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text('PAYMENT SHEET', LEFT, y);
  y += 20;
  y = drawSummaryTable(doc, entries, date, y, options.summaryOnly);

  if (options.summaryOnly) {
    // Day sheet — entries only, signature at the bottom.
    drawSignature(doc, y);
  } else {
    for (const e of entries) {
      if (y > PAGE_H - 220) { doc.addPage(); y = 40; }
      y = drawEntryDetails(doc, e, y + 12);
    }
    drawSignature(doc, y);
  }

  // ── Footer on every page ──
  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(LEFT, PAGE_H - 42).lineTo(RIGHT, PAGE_H - 42).stroke(PRIMARY);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(`Generated from Hospital Construction ERP — ${new Date().toLocaleDateString('en-IN')}`,
        LEFT, PAGE_H - 34, { width: WIDTH, align: 'center' });
  }

  doc.end();
}
