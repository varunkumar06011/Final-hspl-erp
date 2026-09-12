import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getStorageService } from './storage.service';
import { prisma } from '../config/prisma';

export async function streamQuotationPdf(res: NodeJS.WritableStream, quotation: any) {
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

  // ── Load logo if present ──
  let logoBuffer: Buffer | null = null;
  if (quotation.project?.logoUrl) {
    try {
      const raw = await getStorageService().getFile(quotation.project.logoUrl);
      logoBuffer = await sharp(raw)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png({ compressionLevel: 9 })
        .resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    } catch (err: any) {
      console.error('[Quotation PDF] Failed to load/process logo:', err?.message ?? err);
    }
  }

  // ── Find project users in named approver roles ──
  const approvers = await prisma.user.findMany({
    where: { projectId: quotation.projectId, isActive: true, role: { in: ['PROJECT_HEAD', 'HEAD_OF_CONSTRUCTION', 'ACCOUNTS_HEAD', 'ADMIN', 'ADMIN_2'] } },
    select: { name: true, role: true },
  });

  const head = approvers.find((u) => u.role === 'PROJECT_HEAD');
  const constructionHead = approvers.find((u) => u.role === 'HEAD_OF_CONSTRUCTION');
  const accountsHead = approvers.find((u) => u.role === 'ACCOUNTS_HEAD');

  const approvedByRole: Record<string, { name: string | null; at?: Date | null }> = {};
  for (const step of quotation.approvalWorkflow?.steps ?? []) {
    if (step.status === 'APPROVED' && step.approverUser) {
      approvedByRole[step.approverRole] = { name: step.approverUser.name, at: step.decidedAt };
    }
  }

  // ── Top header box ──
  const headerTop = 28;
  const headerH = 100;
  const qBoxW = 140;
  const qBoxX = right - qBoxW - 16;

  doc.roundedRect(left, headerTop, width, headerH, 6).fill('#ffffff').stroke(border);

  const sepX = qBoxX - 8;
  doc.moveTo(sepX, headerTop + 15).lineTo(sepX, headerTop + headerH - 15).stroke(border);

  // Logo on the left
  const logoW = 80;
  const logoH = 75;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + 14, 36, { fit: [logoW, logoH] });
    } catch (err: any) {
      console.error('[Quotation PDF] PNG logo failed to render, falling back to JPEG:', err?.message ?? err);
      try {
        const jpegBuffer = await sharp(logoBuffer).jpeg({ quality: 95 }).toBuffer();
        doc.image(jpegBuffer, left + 14, 36, { fit: [logoW, logoH] });
      } catch (err2: any) {
        console.error('[Quotation PDF] JPEG logo fallback also failed:', err2?.message ?? err2);
      }
    }
  }

  const titleX = left + (logoBuffer ? 110 : 18);
  const titleWidth = 235;
  const title = text(quotation.project?.name ?? 'Hospital Construction ERP');

  doc.fillColor(dark).font('Helvetica-Bold').fontSize(20);
  const titleH = doc.heightOfString(title, { width: titleWidth });
  doc.text(title, titleX, 38, { width: titleWidth });

  const addrY = 40 + titleH + 6;
  doc.font('Helvetica').fontSize(9).fillColor(muted).text(text(quotation.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), titleX, addrY, { width: titleWidth });

  // Quotation number box on the right
  doc.roundedRect(qBoxX, headerTop + 14, qBoxW, 70, 4).fill('#ffffff').stroke(border);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(9).text('QUOTATION NO.', qBoxX, headerTop + 30, { width: qBoxW, align: 'center' });
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text(quotation.quotationNumber, qBoxX, headerTop + 52, { width: qBoxW, align: 'center' });

  let y = 145;

  // ── Subtitle header ──
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(18).text('QUOTATION', left, y);
  y += 30;

  // ── Left info column ──
  const leftW = 235;
  const gap = 10;
  const rightW = width - leftW - gap;
  const leftCol = left;
  const rightCol = left + leftW + gap;

  const drawLabel = (labelText: string, value: string, xx: number, yy: number, ww: number) => {
    doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(`${labelText}:`, xx, yy, { width: 88 });
    const valueW = ww - 96;
    doc.font('Helvetica-Bold').fontSize(9);
    const valueH = doc.heightOfString(value, { width: valueW });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(value, xx + 92, yy, { width: valueW });
    return yy + Math.max(18, valueH + 6);
  };

  const statusLabel =
    quotation.status === 'APPROVED' ? 'APPROVED'
    : quotation.status === 'REJECTED' ? 'REJECTED'
    : quotation.status === 'CONVERTED_TO_PO' ? 'CONVERTED TO PO'
    : quotation.status === 'UNDER_REVIEW' ? 'UNDER REVIEW'
    : 'SUBMITTED';

  const vBoxTop = y;
  y = drawLabel('Date', new Date(quotation.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), leftCol, y, leftW);
  y = drawLabel('Created By', text(quotation.createdByUser?.name), leftCol, y, leftW);
  y = drawLabel('Status', statusLabel, leftCol, y, leftW);
  y = drawLabel('Vendor Code', text(quotation.vendor?.vendorCode), leftCol, y, leftW);
  y = drawLabel('Project Head', text(head?.name), leftCol, y, leftW);

  // ── Vendor Details box on the right ──
  const vBoxH = 120;
  doc.roundedRect(rightCol, vBoxTop, rightW, vBoxH, 4).stroke(border);
  doc.rect(rightCol, vBoxTop, rightW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('VENDOR DETAILS:', rightCol + 10, vBoxTop + 6);

  const vData = [
    ['Name', text(quotation.vendor?.name)],
    ['Contact', text(quotation.vendor?.phone ?? quotation.vendor?.contactPersonPhone)],
    ['GSTIN', text(quotation.vendor?.gstNumber)],
    ['PAN', text(quotation.vendor?.panNumber)],
  ];

  let vy = vBoxTop + 34;
  for (const [k, v] of vData) {
    const vLabelW = 60;
    const vValueW = rightW - vLabelW - 22;
    doc.font('Helvetica-Bold').fontSize(8.5);
    const vh = doc.heightOfString(v, { width: vValueW });
    doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(`${k}:`, rightCol + 10, vy, { width: vLabelW });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(8.5).text(v, rightCol + 10 + vLabelW, vy, { width: vValueW });
    vy += Math.max(15, vh + 4);
  }

  y = Math.max(y, vBoxTop + vBoxH + 22);

  // ── Bill To & Quotation For boxes ──
  const midGap = 10;
  const boxW = (width - midGap) / 2;

  doc.font('Helvetica').fontSize(8.5);
  const billAddrH = doc.heightOfString(text(quotation.project?.officeAddress), { width: boxW - 28 });
  const boxH = Math.max(100, 30 + 18 + billAddrH + 24);

  // Bill To
  const billBoxX = left;
  doc.roundedRect(billBoxX, y, boxW, boxH, 4).stroke(border);
  doc.rect(billBoxX, y, boxW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('QUOTATION FOR:', billBoxX + 10, y + 6);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(9.5).text(text(quotation.project?.name), billBoxX + 10, y + 32);
  doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(text(quotation.project?.officeAddress), billBoxX + 10, y + 50, { width: boxW - 28 });
  doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`GSTIN: ${text(quotation.project?.gstNumber)}  |  PAN: ${text(quotation.project?.panNumber)}`, billBoxX + 10, y + boxH - 15, { width: boxW - 26 });

  // Delivery / Site Address
  const delBoxX = left + boxW + midGap;
  doc.roundedRect(delBoxX, y, boxW, boxH, 4).stroke(border);
  doc.rect(delBoxX, y, boxW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('SITE ADDRESS (Hospital):', delBoxX + 10, y + 6);
  doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(text(quotation.project?.hospitalAddress), delBoxX + 10, y + 34, { width: boxW - 38 });

  y += boxH + 22;

  // ── Items table ──
  const colGap = 4;
  const wSno = 27;
  const wDesc = 170;
  const wQty = 42;
  const wUnit = 52;
  const wPrice = 95;
  const wTotal = 105;

  const colSno = left;
  const colDesc = left + wSno + colGap;
  const colQty = colDesc + wDesc + colGap;
  const colUnit = colQty + wQty + colGap;
  const colPrice = colUnit + wUnit + colGap;
  const colTotal = colPrice + wPrice + colGap;

  doc.rect(left, y, width, 26).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  doc.text('S.No', colSno, y + 7, { width: wSno, align: 'center' });
  doc.text('Item Description', colDesc + 4, y + 7, { width: wDesc - 8 });
  doc.text('Qty', colQty, y + 7, { width: wQty, align: 'center' });
  doc.text('Unit', colUnit, y + 7, { width: wUnit, align: 'center' });
  doc.text('Unit Price', colPrice + 4, y + 7, { width: wPrice - 8, align: 'right' });
  doc.text('Total', colTotal + 4, y + 7, { width: wTotal - 8, align: 'right' });
  y += 26;

  const rowH = 24;
  for (let i = 0; i < quotation.items.length; i++) {
    const item = quotation.items[i];
    if (y > pageH - 60) { doc.addPage(); y = 40; }
    if (i % 2 === 0) doc.rect(left, y, width, rowH).fill(primaryLight);
    doc.rect(left, y, width, rowH).stroke(border);

    doc.fillColor(dark).font('Helvetica').fontSize(8.5);
    doc.text(String(i + 1), colSno, y + 6, { width: wSno, align: 'center' });
    doc.text(item.materialName, colDesc + 4, y + 6, { width: wDesc - 8 });
    doc.text(String(item.quantity), colQty, y + 6, { width: wQty, align: 'center' });
    doc.text(text(item.unit), colUnit, y + 6, { width: wUnit, align: 'center' });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(8.5);
    doc.text(fmtMoney(Number(item.unitPrice)), colPrice + 4, y + 6, { width: wPrice - 8, align: 'right' });
    doc.text(fmtMoney(Number(item.amount)), colTotal + 4, y + 6, { width: wTotal - 8, align: 'right' });
    y += rowH;
  }

  // ── Quotation Notes (highlighted) ──
  const qNotes = quotation.notes;
  if (qNotes && qNotes.trim().length > 0) {
    if (y > pageH - 80) { doc.addPage(); y = 40; }
    y += 8;
    const notesW = width;
    const notesLabel = 'Quotation Notes';
    doc.font('Helvetica-Bold').fontSize(8.5);
    const notesTextH = doc.heightOfString(qNotes.trim(), { width: notesW - 24, align: 'left' });
    const notesBoxH = Math.max(30, 18 + notesTextH + 10);
    doc.rect(left, y, notesW, notesBoxH).fill('#FFF8E1').stroke('#FFB300');
    doc.fillColor('#E65100').font('Helvetica-Bold').fontSize(8.5).text(notesLabel, left + 8, y + 6, { width: notesW - 16 });
    doc.fillColor(dark).font('Helvetica').fontSize(9).text(qNotes.trim(), left + 8, y + 18, { width: notesW - 24, align: 'left' });
    y += notesBoxH + 6;
  }

  // ── Totals ──
  const totalsW = 240;
  const totalsX = right - totalsW;

  const drawTotal = (lbl: string, val: string, yy: number, bg = false) => {
    if (bg) doc.rect(totalsX, yy, totalsW, 26).fill(primary);
    else doc.rect(totalsX, yy, totalsW, 24).fill(primaryLight).stroke(border);
    const labelW = 145;
    const valueW = 85;
    doc.fillColor(bg ? '#fff' : muted).font('Helvetica').fontSize(9).text(lbl, totalsX + 8, yy + 6, { width: labelW });
    doc.fillColor(bg ? '#fff' : dark).font('Helvetica-Bold').fontSize(9).text(val, totalsX + 8 + labelW, yy + 6, { width: valueW, align: 'right' });
    return yy + (bg ? 26 : 24);
  };

  y += 12;
  y = drawTotal('Subtotal:', fmtMoney(Number(quotation.totalAmount)), y);
  const gstRate = quotation.items.length > 0 ? Number(quotation.items[0]?.gstRate ?? 0) : 0;
  const gstLabel = Number(quotation.gstAmount) > 0 ? `GST (${gstRate}%):` : 'GST (Not Applicable):';
  y = drawTotal(gstLabel, Number(quotation.gstAmount) > 0 ? fmtMoney(Number(quotation.gstAmount)) : 'Rs. 0.00', y);
  y = drawTotal('GRAND TOTAL (Inclusive of all taxes):', fmtMoney(Number(quotation.grandTotal)), y, true);
  y += 36;

  // ── Approval & Authorization boxes ──
  if (y > pageH - 150) {
    doc.addPage();
    y = 40;
  }

  doc.fillColor(primary).font('Helvetica-Bold').fontSize(12).text('APPROVAL & AUTHORIZATION:', left, y);
  y += 26;

  const sigW = (width - 24) / 3;
  const sigH = 65;
  const roles = [
    { label: 'Approver 1', role: 'PROJECT_HEAD', title: 'Construction Project Head', user: head },
    { label: 'Approver 2', role: 'HEAD_OF_CONSTRUCTION', title: 'Head of Construction', user: constructionHead },
    { label: 'Approver 3', role: 'ACCOUNTS_HEAD', title: 'Accounts Head', user: accountsHead },
  ];

  for (let i = 0; i < roles.length; i++) {
    const sx = left + i * (sigW + 12);
    const { label, role, title, user: u } = roles[i];
    const approved = approvedByRole[role];

    doc.roundedRect(sx, y, sigW, sigH, 4).stroke(border);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(`${label}: ${u?.name ?? approved?.name ?? '—'}`, sx + 8, y + 18, { width: sigW - 16, align: 'center' });
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(`(${title})`, sx + 8, y + 38, { width: sigW - 16, align: 'center' });
  }

  // ── Footer ──
  y += sigH + 24;
  doc.moveTo(left, y).lineTo(right, y).stroke(primary);
  doc.fillColor(muted).font('Helvetica').fontSize(7).text(`Generated from Hospital Construction ERP — ${new Date().toLocaleDateString('en-IN')}`, left, y + 8, { width, align: 'center' });

  doc.end();
}
