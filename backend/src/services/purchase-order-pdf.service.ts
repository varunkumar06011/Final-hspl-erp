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
    where: { projectId: po.projectId, isActive: true, role: { in: ['PROJECT_HEAD', 'ADMIN', 'ADMIN_2'] } },
    select: { name: true, role: true },
  });

  const head = approvers.find((u) => u.role === 'PROJECT_HEAD');
  const admin1 = approvers.find((u) => u.role === 'ADMIN');
  const admin2 = approvers.find((u) => u.role === 'ADMIN_2');

  const approvedByRole: Record<string, { name: string | null; at?: Date | null }> = {};
  for (const step of po.approvalWorkflow?.steps ?? []) {
    if (step.status === 'APPROVED' && step.approverUser) {
      approvedByRole[step.approverRole] = { name: step.approverUser.name, at: step.decidedAt };
    }
  }

  // ── Top header box ──
  const headerTop = 22;
  const headerH = 82;
  const poBoxW = 130;
  const poBoxX = right - poBoxW - 16;

  doc.roundedRect(left, headerTop, width, headerH, 6).fill('#ffffff').stroke(border);

  // Vertical separator between company info and PO number
  const sepX = poBoxX - 8;
  doc.moveTo(sepX, headerTop + 15).lineTo(sepX, headerTop + headerH - 15).stroke(border);

  // Logo on the left
  const logoW = 66;
  const logoH = 60;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + 12, 30, { fit: [logoW, logoH] });
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

  const titleX = left + (logoBuffer ? 92 : 18);
  const titleWidth = 250;
  const title = text(po.project?.name ?? 'Hospital Construction ERP');

  // Title block
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(16);
  const titleH = doc.heightOfString(title, { width: titleWidth });
  doc.text(title, titleX, 30, { width: titleWidth });

  const addrY = 32 + titleH + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(muted).text(text(po.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), titleX, addrY, { width: titleWidth });

  // PO number box on the right
  doc.roundedRect(poBoxX, headerTop + 8, poBoxW, 66, 4).fill('#ffffff').stroke(border);
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(9).text('PO NUMBER', poBoxX, headerTop + 20, { width: poBoxW, align: 'center' });
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(13).text(po.poNumber, poBoxX, headerTop + 40, { width: poBoxW, align: 'center' });

  let y = 116;

  // ── Subtitle header ──
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text('PURCHASE ORDER', left, y);
  y += 22;

  // ── Left info column ──
  const leftW = 235;
  const gap = 10;
  const rightW = width - leftW - gap;
  const leftCol = left;
  const rightCol = left + leftW + gap;

  const drawLabel = (labelText: string, value: string, xx: number, yy: number, ww: number) => {
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`${labelText}:`, xx, yy, { width: 88 });
    const valueW = ww - 96;
    doc.font('Helvetica-Bold').fontSize(8);
    const valueH = doc.heightOfString(value, { width: valueW });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(8).text(value, xx + 92, yy, { width: valueW });
    return yy + Math.max(14, valueH + 3);
  };

  const paymentTerms = po.paymentTerms || 'After Delivery & Inspection';

  const paymentTypeLabel =
    po.paymentType === 'ADVANCE' ? 'Against Advance'
    : po.paymentType === 'FULL_PAYMENT' ? 'Against Full Payment'
    : 'After Delivery';

  const vBoxTop = y;
  y = drawLabel('Date', new Date(po.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), leftCol, y, leftW);
  y = drawLabel('Created By', text(po.createdByUser?.name), leftCol, y, leftW);
  y = drawLabel('Delivery Due Date', po.deliveryDate ? new Date(po.deliveryDate).toLocaleDateString('en-IN') : '—', leftCol, y, leftW);
  y = drawLabel('Payment Type', paymentTypeLabel, leftCol, y, leftW);
  y = drawLabel('Payment Terms', text(paymentTerms), leftCol, y, leftW);
  y = drawLabel('Project Head', text(head?.name), leftCol, y, leftW);

  // ── Vendor Details box on the right ──
  const vBoxH = 96;
  doc.roundedRect(rightCol, vBoxTop, rightW, vBoxH, 4).stroke(border);
  doc.rect(rightCol, vBoxTop, rightW, 24).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9.5).text('VENDOR DETAILS:', rightCol + 8, vBoxTop + 5);

  const vData = [
    ['Name', text(po.vendor?.name)],
    ['Contact', text(po.vendor?.phone ?? po.vendor?.contactPersonPhone)],
    ['GSTIN', text(po.vendor?.gstNumber)],
    ['PAN', text(po.vendor?.panNumber)],
  ];

  let vy = vBoxTop + 29;
  for (const [k, v] of vData) {
    const vLabelW = 60;
    const vValueW = rightW - vLabelW - 22;
    doc.font('Helvetica-Bold').fontSize(7.5);
    const vh = doc.heightOfString(v, { width: vValueW });
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`${k}:`, rightCol + 8, vy, { width: vLabelW });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(7.5).text(v, rightCol + 8 + vLabelW, vy, { width: vValueW });
    vy += Math.max(13, vh + 2);
  }

  y = Math.max(y, vBoxTop + vBoxH + 10);

  // ── Bill To & Delivery address boxes ──
  const midGap = 10;
  const boxW = (width - midGap) / 2;

  // Measure address heights so boxes are tall enough and do not overlap text
  doc.font('Helvetica').fontSize(8.5);
  const billAddrH = doc.heightOfString(text(po.project?.officeAddress), { width: boxW - 28 });
  const delAddrH = doc.heightOfString(text(po.project?.hospitalAddress), { width: boxW - 38 });
  const boxH = Math.max(74, 26 + 16 + Math.max(billAddrH, delAddrH) + 16);

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

  y += boxH + 10;

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

  // Reserve room for notes, totals, signatures and the footer before sizing rows.
  const poNotes = (po as { notes?: string | null }).notes;
  const bottomReserve = 154 + (poNotes && poNotes.trim().length > 0 ? 58 : 0);
  const rowH = Math.max(10, Math.min(21, (pageH - y - bottomReserve) / Math.max(1, po.items.length)));
  const rowFontSize = rowH < 14 ? 6.5 : rowH < 17 ? 7 : 8;
  const rowTextOffset = Math.max(2, (rowH - rowFontSize) / 2 - 1);

  for (let i = 0; i < po.items.length; i++) {
    const item = po.items[i];
    if (i % 2 === 0) doc.rect(left, y, width, rowH).fill(primaryLight);
    doc.rect(left, y, width, rowH).stroke(border);

    doc.fillColor(dark).font('Helvetica').fontSize(rowFontSize);
    doc.text(String(i + 1), colSno, y + rowTextOffset, { width: wSno, align: 'center', lineBreak: false });
    let description = text(item.materialName);
    while (description.length > 3 && doc.widthOfString(description) > wDesc - 8) {
      description = `${description.slice(0, -4).trimEnd()}...`;
    }
    doc.text(description, colDesc + 4, y + rowTextOffset, { width: wDesc - 8, lineBreak: false });
    doc.text(String(item.quantity), colQty, y + rowTextOffset, { width: wQty, align: 'center', lineBreak: false });
    doc.text(text(item.unit), colUnit, y + rowTextOffset, { width: wUnit, align: 'center', lineBreak: false });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(rowFontSize);
    doc.text(fmtMoney(Number(item.unitPrice)), colPrice + 4, y + rowTextOffset, { width: wPrice - 8, align: 'right', lineBreak: false });
    doc.text(fmtMoney(Number(item.amount)), colTotal + 4, y + rowTextOffset, { width: wTotal - 8, align: 'right', lineBreak: false });
    y += rowH;
  }

  // ── PO Description / Notes (highlighted) ──
  if (poNotes && poNotes.trim().length > 0) {
    y += 5;
    const notesW = width;
    const notesLabel = 'PO Description / Notes';
    doc.font('Helvetica-Bold').fontSize(8.5);
    const notesTextH = doc.heightOfString(poNotes.trim(), { width: notesW - 24, align: 'left' });
    const notesBoxH = Math.max(30, 18 + notesTextH + 10);
    // Light amber background to highlight the description
    doc.rect(left, y, notesW, notesBoxH).fill('#FFF8E1').stroke('#FFB300');
    doc.fillColor('#E65100').font('Helvetica-Bold').fontSize(8.5).text(notesLabel, left + 8, y + 6, { width: notesW - 16 });
    doc.fillColor(dark).font('Helvetica').fontSize(9).text(poNotes.trim(), left + 8, y + 18, { width: notesW - 24, align: 'left' });
    y += notesBoxH + 6;
  }

  // ── Totals ──
  const totalsW = 240;
  const totalsX = right - totalsW;

  const drawTotal = (lbl: string, val: string, yy: number, bg = false) => {
    const rowHeight = bg ? 22 : 20;
    if (bg) doc.rect(totalsX, yy, totalsW, rowHeight).fill(primary);
    else doc.rect(totalsX, yy, totalsW, rowHeight).fill(primaryLight).stroke(border);
    const labelW = 165;
    const valueW = totalsW - labelW - 16;
    doc.fillColor(bg ? '#fff' : muted).font('Helvetica').fontSize(7.5).text(lbl, totalsX + 8, yy + 5, { width: labelW, lineBreak: false });
    doc.fillColor(bg ? '#fff' : dark).font('Helvetica-Bold').fontSize(8).text(val, totalsX + 8 + labelW, yy + 5, { width: valueW, align: 'right', lineBreak: false });
    return yy + rowHeight;
  };

  // Highlighted advance row — amber background to draw attention to the amount payable now
  const advanceHighlight = '#E65100';
  const drawAdvanceTotal = (lbl: string, val: string, yy: number) => {
    doc.rect(totalsX, yy, totalsW, 22).fill(advanceHighlight);
    const labelW = 140;
    const valueW = totalsW - labelW - 16;
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(lbl, totalsX + 8, yy + 6, { width: labelW, lineBreak: false });
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5).text(val, totalsX + 8 + labelW, yy + 6, { width: valueW, align: 'right', lineBreak: false });
    return yy + 22;
  };

  y += 6;
  y = drawTotal('Subtotal:', fmtMoney(Number(po.totalAmount)), y);
  const gstRate = po.items.length > 0 ? Number(po.items[0]?.gstRate ?? 0) : 0;
  const gstLabel = Number(po.gstAmount) > 0 ? `GST (${gstRate}%):` : 'GST (No Gst Applicable):';
  y = drawTotal(gstLabel, Number(po.gstAmount) > 0 ? fmtMoney(Number(po.gstAmount)) : 'Rs. 0.00', y);
  y = drawTotal('GRAND TOTAL (Inclusive of all taxes):', fmtMoney(Number(po.grandTotal)), y, true);

  // ── Deductions breakdown ──
  const deductionRows = Array.isArray((po as { deductions?: unknown }).deductions) ? (po as { deductions: { amount: number; reason: string }[] }).deductions : [];
  if (deductionRows.length > 0) {
    y += 6;
    deductionRows.forEach((d) => {
      y = drawTotal(`Less: ${d.reason}`, `-${fmtMoney(Number(d.amount))}`, y);
    });
    y = drawTotal('Total Deductions:', fmtMoney(Number(po.totalDeductions)), y);
    y = drawTotal('NET PAYABLE:', fmtMoney(Number(po.netPayable)), y, true);
  }

  // For ADVANCE / FULL_PAYMENT POs, show the advance breakdown: advance now pay (highlighted), outstanding
  // Skip when deductions exist — NET PAYABLE already represents the final amount.
  if (deductionRows.length === 0 && po.advanceAmount !== null && po.advanceAmount !== undefined && Number(po.advanceAmount) > 0) {
    const advanceVal = Number(po.advanceAmount);
    const outstandingVal = Math.max(0, Number(po.grandTotal) - advanceVal);
    y += 5;
    y = drawAdvanceTotal('ADVANCE NOW PAY:', fmtMoney(advanceVal), y);
    y = drawTotal('Outstanding (after advance):', fmtMoney(outstandingVal), y);
  }
  y += 10;

  // ── Approval & Authorization boxes ──
  const sigW = (width - 24) / 3;
  const sigH = 48;
  const approvalHeadingH = 20;

  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10.5).text('APPROVAL & AUTHORIZATION:', left, y);
  y += approvalHeadingH;

  // Order: Managing Director, Director, Construction Project Head
  // Show just the person's name — no "Admin 1/2" or "Approver X" labels.
  const roles = [
    { role: 'ADMIN_2', title: 'Managing Director', user: admin2 },
    { role: 'ADMIN', title: 'Director', user: admin1 },
    { role: 'PROJECT_HEAD', title: 'Construction Project Head', user: head },
  ];

  for (let i = 0; i < roles.length; i++) {
    const sx = left + i * (sigW + 12);
    const { role, title, user: u } = roles[i];
    const approved = approvedByRole[role];
    const displayName = u?.name ?? approved?.name ?? '—';

    doc.roundedRect(sx, y, sigW, sigH, 4).stroke(border);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(8.5).text(displayName, sx + 6, y + 10, { width: sigW - 12, align: 'center', lineBreak: false });
    doc.fillColor(muted).font('Helvetica').fontSize(7).text(`(${title})`, sx + 6, y + 30, { width: sigW - 12, align: 'center' });
  }

  // ── Footer ──
  y += sigH + 8;
  doc.moveTo(left, y).lineTo(right, y).stroke(primary);
  doc.fillColor(muted).font('Helvetica').fontSize(6.5).text(`Generated from Hospital Construction ERP — ${new Date().toLocaleDateString('en-IN')}`, left, y + 4, { width, align: 'center' });

  doc.end();
}
