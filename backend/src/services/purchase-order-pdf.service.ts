import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getStorageService } from './storage.service';
import { prisma } from '../config/prisma';

export async function streamPurchaseOrderPdf(res: NodeJS.WritableStream, po: any) {
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
  if (po.project?.logoUrl) {
    try {
      const raw = await getStorageService().getFile(po.project.logoUrl);
      logoBuffer = await sharp(raw)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png({ compressionLevel: 9 })
        .resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    } catch (err: any) {
      console.error('[PO PDF] Failed to load/process logo:', err?.message ?? err);
    }
  }

  // ── Find project users in named approver roles ──
  const approvers = await prisma.user.findMany({
    where: { projectId: po.projectId, isActive: true, role: { in: ['PROJECT_HEAD', 'ACCOUNTS_HEAD', 'ADMIN_2'] } },
    select: { name: true, role: true },
  });

  const head = approvers.find((u) => u.role === 'PROJECT_HEAD');
  const accountsHead = approvers.find((u) => u.role === 'ACCOUNTS_HEAD');
  const md = approvers.find((u) => u.role === 'ADMIN_2');

  const approvedByRole: Record<string, { name: string | null; at?: Date | null }> = {};
  for (const step of po.approvalWorkflow?.steps ?? []) {
    if (step.status === 'APPROVED' && step.approverUser) {
      approvedByRole[step.approverRole] = { name: step.approverUser.name, at: step.decidedAt };
    }
  }

  // ── Top header box ──
  const headerTop = 28;
  const headerH = 100;
  doc.roundedRect(left, headerTop, width, headerH, 6).fill('#ffffff').stroke(border);

  // Logo on the left
  const logoW = 80;
  const logoH = 75;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + 14, 36, { fit: [logoW, logoH] });
    } catch (err: any) {
      console.error('[PO PDF] PNG logo failed to render, falling back to JPEG:', err?.message ?? err);
      try {
        const jpegBuffer = await sharp(logoBuffer).jpeg({ quality: 95 }).toBuffer();
        doc.image(jpegBuffer, left + 14, 36, { fit: [logoW, logoH] });
      } catch (err2: any) {
        console.error('[PO PDF] JPEG logo fallback also failed:', err2?.message ?? err2);
      }
    }
  }

  const titleX = left + (logoBuffer ? 110 : 18);
  const titleWidth = 235;
  const title = text(po.project?.name ?? 'Hospital Construction ERP');

  // Title block
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(20);
  const titleH = doc.heightOfString(title, { width: titleWidth });
  doc.text(title, titleX, 38, { width: titleWidth });

  const addrY = 40 + titleH + 6;
  doc.font('Helvetica').fontSize(9).fillColor(muted).text(text(po.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), titleX, addrY, { width: titleWidth });

  // PO number box on the right
  const poBoxW = 130;
  const poBoxX = right - poBoxW - 10;
  doc.roundedRect(poBoxX, headerTop + 14, poBoxW, 70, 4).fill('#ffffff').stroke(border);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text('PO NUMBER', poBoxX + 10, headerTop + 30);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(15).text(po.poNumber, poBoxX + 10, headerTop + 52, { width: poBoxW - 20 });

  let y = 145;

  // ── Subtitle header ──
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(18).text('PURCHASE ORDER', left, y);
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

  const paymentTerms = po.paymentTerms || 'After Delivery & Inspection';

  const vBoxTop = y;
  y = drawLabel('Date', new Date(po.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), leftCol, y, leftW);
  y = drawLabel('Created By', text(po.createdByUser?.name), leftCol, y, leftW);
  y = drawLabel('Delivery Due Date', po.deliveryDate ? new Date(po.deliveryDate).toLocaleDateString('en-IN') : '—', leftCol, y, leftW);
  y = drawLabel('Payment Terms', text(paymentTerms), leftCol, y, leftW);
  y = drawLabel('Project Head', text(head?.name), leftCol, y, leftW);

  // ── Vendor Details box on the right ──
  const vBoxH = 120;
  doc.roundedRect(rightCol, vBoxTop, rightW, vBoxH, 4).stroke(border);
  doc.rect(rightCol, vBoxTop, rightW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('VENDOR DETAILS:', rightCol + 10, vBoxTop + 6);

  const vData = [
    ['Name', text(po.vendor?.name)],
    ['Contact', text(po.vendor?.phone ?? po.vendor?.contactPersonPhone)],
    ['GSTIN', text(po.vendor?.gstNumber)],
    ['PAN', text(po.vendor?.panNumber)],
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

  // ── Bill To & Delivery address boxes ──
  const midGap = 10;
  const boxW = (width - midGap) / 2;

  // Measure address heights so boxes are tall enough and do not overlap text
  doc.font('Helvetica').fontSize(8.5);
  const billAddrH = doc.heightOfString(text(po.project?.officeAddress), { width: boxW - 28 });
  const delAddrH = doc.heightOfString(text(po.project?.hospitalAddress), { width: boxW - 38 });
  const boxH = Math.max(100, 30 + 18 + Math.max(billAddrH, delAddrH) + 24);

  // Bill To
  const billBoxX = left;
  doc.roundedRect(billBoxX, y, boxW, boxH, 4).stroke(border);
  doc.rect(billBoxX, y, boxW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('BILL TO:', billBoxX + 10, y + 6);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(9.5).text(text(po.project?.name), billBoxX + 10, y + 32);
  doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(text(po.project?.officeAddress), billBoxX + 10, y + 50, { width: boxW - 28 });
  doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`GSTIN: ${text(po.project?.gstNumber)}  |  PAN: ${text(po.project?.panNumber)}`, billBoxX + 10, y + boxH - 15, { width: boxW - 26 });

  // Delivery
  const delBoxX = left + boxW + midGap;
  doc.roundedRect(delBoxX, y, boxW, boxH, 4).stroke(border);
  doc.rect(delBoxX, y, boxW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('DELIVERY ADDRESS (Hospital Site):', delBoxX + 10, y + 6);
  doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(text(po.project?.hospitalAddress), delBoxX + 10, y + 34, { width: boxW - 38 });

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
  for (let i = 0; i < po.items.length; i++) {
    const item = po.items[i];
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
  y = drawTotal('Subtotal:', fmtMoney(Number(po.totalAmount)), y);
  const gstRate = po.items.length > 0 ? Number(po.items[0]?.gstRate ?? 0) : 0;
  const gstLabel = Number(po.gstAmount) > 0 ? `GST (${gstRate}%):` : 'GST (No Gst Applicable):';
  y = drawTotal(gstLabel, Number(po.gstAmount) > 0 ? fmtMoney(Number(po.gstAmount)) : 'Rs. 0.00', y);
  y = drawTotal('GRAND TOTAL (Inclusive of all taxes):', fmtMoney(Number(po.grandTotal)), y, true);
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
    { label: 'Approver 2', role: 'ACCOUNTS_HEAD', title: 'Accounts Head', user: accountsHead },
    { label: 'Approver 3', role: 'ADMIN_2', title: 'Managing Director', user: md },
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
