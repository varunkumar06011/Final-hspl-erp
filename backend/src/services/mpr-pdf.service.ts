import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getStorageService } from './storage.service';
import { prisma } from '../config/prisma';

export async function streamMprPdf(res: NodeJS.WritableStream, mpr: any) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(res as unknown as any);

  const pageW = 595;
  const pageH = 842;
  const left = 42;
  const right = pageW - left;
  const width = right - left;

  // V Grand corporate blue colour scheme
  const primary = '#0F4C4C';
  const primaryLight = '#E8F5F5';
  const dark = '#263238';
  const muted = '#78909C';
  const border = '#B0BEC5';

  const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

  // ── Load logo if present (existing V Grand letterhead) ──
  let logoBuffer: Buffer | null = null;
  if (mpr.project?.logoUrl) {
    try {
      const raw = await getStorageService().getFile(mpr.project.logoUrl);
      logoBuffer = await sharp(raw)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png({ compressionLevel: 9 })
        .resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    } catch (err: any) {
      console.error('[MRF PDF] Failed to load/process logo:', err?.message ?? err);
    }
  }

  // ── Find project head for "Requested By" ──
  const approvers = await prisma.user.findMany({
    where: { projectId: mpr.projectId, isActive: true, role: 'PROJECT_HEAD' },
    select: { name: true, role: true },
  });
  const projectHead = approvers.find((u) => u.role === 'PROJECT_HEAD');

  // ═══════════════════════════════════════════════════════════
  // 1. COMPANY HEADER / LETTERHEAD (existing V Grand style)
  // ═══════════════════════════════════════════════════════════
  const headerTop = 28;
  const headerH = 90;

  doc.roundedRect(left, headerTop, width, headerH, 6).fill('#ffffff').stroke(border);

  // Logo on the left
  const logoW = 75;
  const logoH = 70;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + 14, 34, { fit: [logoW, logoH] });
    } catch (err: any) {
      console.error('[MRF PDF] PNG logo failed, trying JPEG:', err?.message ?? err);
      try {
        const jpegBuffer = await sharp(logoBuffer).jpeg({ quality: 95 }).toBuffer();
        doc.image(jpegBuffer, left + 14, 34, { fit: [logoW, logoH] });
      } catch (err2: any) {
        console.error('[MRF PDF] JPEG logo fallback also failed:', err2?.message ?? err2);
      }
    }
  }

  const titleX = left + (logoBuffer ? 105 : 18);
  const titleWidth = width - (logoBuffer ? 120 : 30);
  const companyName = text(mpr.project?.name ?? 'V Grand Health Care Pvt. Ltd.');

  doc.fillColor(dark).font('Helvetica-Bold').fontSize(18);
  const nameH = doc.heightOfString(companyName, { width: titleWidth });
  doc.text(companyName, titleX, 34, { width: titleWidth });

  const addrY = 36 + nameH + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(text(mpr.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), titleX, addrY, { width: titleWidth });

  let y = headerTop + headerH + 18;

  // ═══════════════════════════════════════════════════════════
  // 2. FORM TITLE
  // ═══════════════════════════════════════════════════════════
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(16).text('MATERIAL REQUEST FORM', left, y, { width, align: 'center' });
  y += 24;
  // Clean horizontal line underneath
  doc.moveTo(left, y).lineTo(right, y).strokeColor(primary).lineWidth(1.5).stroke();
  y += 16;

  // ═══════════════════════════════════════════════════════════
  // 3. REQUEST INFORMATION
  // ═══════════════════════════════════════════════════════════
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text('REQUEST INFORMATION', left, y);
  y += 18;

  // Info table — 2 columns x 4 rows
  const infoColW = (width - 10) / 2;
  const infoRowH = 22;
  const infoCol1 = left;
  const infoCol2 = left + infoColW + 10;

  const priorityLabel = text(mpr.priority);

  const infoRows = [
    ['Request No.', text(mpr.mprNumber), 'Request Date', new Date(mpr.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Required By', mpr.requiredBy ? new Date(mpr.requiredBy).toLocaleDateString('en-IN') : '—', 'Project / Site', text(mpr.project?.name)],
    ['Department', text(mpr.department), 'Priority', priorityLabel],
    ['Requested By', text(mpr.createdByUser?.name ?? projectHead?.name), '', ''],
  ];

  for (const row of infoRows) {
    // Label cell 1
    doc.rect(infoCol1, y, 90, infoRowH).fill(primaryLight).stroke(border);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(8).text(row[0], infoCol1 + 6, y + 6, { width: 80 });
    // Value cell 1
    doc.rect(infoCol1 + 90, y, infoColW - 90, infoRowH).fill('#ffffff').stroke(border);
    doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(row[1], infoCol1 + 96, y + 6, { width: infoColW - 100 });

    // Label cell 2 (skip if empty — last row right side)
    if (row[2]) {
      doc.rect(infoCol2, y, 90, infoRowH).fill(primaryLight).stroke(border);
      doc.fillColor(primary).font('Helvetica-Bold').fontSize(8).text(row[2], infoCol2 + 6, y + 6, { width: 80 });
      doc.rect(infoCol2 + 90, y, infoColW - 90, infoRowH).fill('#ffffff').stroke(border);
      doc.fillColor(dark).font('Helvetica').fontSize(8.5).text(row[3], infoCol2 + 96, y + 6, { width: infoColW - 100 });
    } else {
      // Empty cell to keep grid alignment
      doc.rect(infoCol2, y, infoColW, infoRowH).fill('#ffffff').stroke(border);
    }
    y += infoRowH;
  }
  y += 14;

  // ═══════════════════════════════════════════════════════════
  // 4. DELIVERY & BILLING INFORMATION
  // ═══════════════════════════════════════════════════════════
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text('DELIVERY & BILLING INFORMATION', left, y);
  y += 16;

  const addrBoxW = (width - 12) / 2;
  const addrBox1X = left;
  const addrBox2X = left + addrBoxW + 12;
  const addrBoxH = 110;

  // ── DELIVERY ADDRESS box ──
  doc.roundedRect(addrBox1X, y, addrBoxW, addrBoxH, 4).stroke(border);
  doc.rect(addrBox1X, y, addrBoxW, 20).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5).text('DELIVERY ADDRESS', addrBox1X + 8, y + 5, { width: addrBoxW - 16 });

  const deliveryAddr = mpr.deliveryAddress || mpr.project?.hospitalAddress || '—';
  const deliveryLines = [
    { label: 'Project / Site:', value: text(mpr.project?.name) },
    { label: 'Delivery Address:', value: text(deliveryAddr) },
    { label: 'Contact Person:', value: text(mpr.contactPerson) },
    { label: 'Contact Number:', value: text(mpr.contactNumber) },
  ];
  let dy = y + 26;
  for (const line of deliveryLines) {
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(7.5).text(line.label, addrBox1X + 8, dy, { width: 80 });
    doc.fillColor(dark).font('Helvetica').fontSize(8).text(line.value, addrBox1X + 92, dy, { width: addrBoxW - 100 });
    dy += 18;
  }

  // ── BILL TO box ──
  doc.roundedRect(addrBox2X, y, addrBoxW, addrBoxH, 4).stroke(border);
  doc.rect(addrBox2X, y, addrBoxW, 20).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5).text('BILL TO', addrBox2X + 8, y + 5, { width: addrBoxW - 16 });

  const billingAddr = mpr.billingAddress || mpr.project?.officeAddress || '—';
  const gstin = mpr.project?.gstNumber || '—';
  const billLines = [
    { label: 'Company:', value: 'V Grand Health Care Pvt. Ltd.' },
    { label: 'Billing Address:', value: text(billingAddr) },
    { label: 'GSTIN:', value: text(gstin) },
    { label: 'State / State Code:', value: text(mpr.stateCode) },
  ];
  dy = y + 26;
  for (const line of billLines) {
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(7.5).text(line.label, addrBox2X + 8, dy, { width: 80 });
    doc.fillColor(dark).font('Helvetica').fontSize(8).text(line.value, addrBox2X + 92, dy, { width: addrBoxW - 100 });
    dy += 18;
  }

  y += addrBoxH + 14;

  // ═══════════════════════════════════════════════════════════
  // 5. MATERIAL DETAILS TABLE
  // ═══════════════════════════════════════════════════════════
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text('MATERIAL DETAILS', left, y);
  y += 18;

  // Column widths — Description is widest
  const colGap = 3;
  const wSl = 28;
  const wCode = 65;
  const wDesc = 175;
  const wSpec = 100;
  const wQty = 40;
  const wUnit = 42;
  const wReqDate = 70;

  const colSl = left;
  const colCode = colSl + wSl + colGap;
  const colDesc = colCode + wCode + colGap;
  const colSpec = colDesc + wDesc + colGap;
  const colQty = colSpec + wSpec + colGap;
  const colUnit = colQty + wQty + colGap;
  const colReqDate = colUnit + wUnit + colGap;

  // Header row
  const headerRowH = 28;
  doc.rect(left, y, width, headerRowH).fill(primary);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5);
  doc.text('SL.', colSl, y + 8, { width: wSl, align: 'center' });
  doc.text('MATERIAL CODE', colCode + 2, y + 8, { width: wCode - 4, align: 'center' });
  doc.text('MATERIAL / ITEM DESCRIPTION', colDesc + 2, y + 8, { width: wDesc - 4 });
  doc.text('SPECIFICATION / GRADE', colSpec + 2, y + 8, { width: wSpec - 4 });
  doc.text('QTY', colQty, y + 8, { width: wQty, align: 'center' });
  doc.text('UNIT', colUnit, y + 8, { width: wUnit, align: 'center' });
  doc.text('REQUIRED DATE', colReqDate + 2, y + 8, { width: wReqDate - 4, align: 'center' });
  y += headerRowH;

  // Data rows
  const dataRowH = 26;
  const items = mpr.items ?? [];
  // Show actual items + blank rows (minimum 8 rows total for print use)
  const minRows = Math.max(8, items.length);
  for (let i = 0; i < minRows; i++) {
    if (y > pageH - 120) { doc.addPage(); y = 40; }
    const item = items[i];
    if (i % 2 === 0) doc.rect(left, y, width, dataRowH).fill(primaryLight);
    doc.rect(left, y, width, dataRowH).stroke(border);

    doc.fillColor(dark).font('Helvetica').fontSize(8);
    doc.text(item ? String(i + 1) : '', colSl, y + 7, { width: wSl, align: 'center' });
    doc.text(item ? text(item.materialCode) : '', colCode + 2, y + 7, { width: wCode - 4 });
    doc.text(item ? text(item.materialName) : '', colDesc + 2, y + 7, { width: wDesc - 4 });
    doc.text(item ? text(item.specification) : '', colSpec + 2, y + 7, { width: wSpec - 4 });
    doc.text(item ? String(item.quantity) : '', colQty, y + 7, { width: wQty, align: 'center' });
    doc.text(item ? text(item.unit) : '', colUnit, y + 7, { width: wUnit, align: 'center' });
    doc.text(item && item.requiredDate ? new Date(item.requiredDate).toLocaleDateString('en-IN') : '', colReqDate + 2, y + 7, { width: wReqDate - 4, align: 'center' });
    y += dataRowH;
  }
  y += 16;

  // ═══════════════════════════════════════════════════════════
  // 6. PURPOSE / JUSTIFICATION
  // ═══════════════════════════════════════════════════════════
  if (y > pageH - 100) { doc.addPage(); y = 40; }
  doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text('PURPOSE / JUSTIFICATION', left, y);
  y += 16;

  const purposeText = mpr.description || '';
  // Draw a bordered box with adequate blank space
  const purposeBoxH = purposeText.trim().length > 0
    ? Math.max(60, doc.heightOfString(purposeText.trim(), { width: width - 16, align: 'left' }) + 20)
    : 70;
  doc.rect(left, y, width, purposeBoxH).fill('#ffffff').stroke(border);
  if (purposeText.trim().length > 0) {
    doc.fillColor(dark).font('Helvetica').fontSize(9).text(purposeText.trim(), left + 8, y + 8, { width: width - 16, align: 'left' });
  }
  y += purposeBoxH + 16;

  // ═══════════════════════════════════════════════════════════
  // 7. FOOTER (existing V Grand address + subtle form reference)
  // ═══════════════════════════════════════════════════════════
  // NO approval section — no signature blocks

  // Push footer to bottom of page
  const footerY = pageH - 60;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(primary).lineWidth(1).stroke();

  // Company address line (existing footer)
  doc.fillColor(muted).font('Helvetica').fontSize(7).text(text(mpr.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), left, footerY + 6, { width, align: 'center' });

  // Subtle form reference
  doc.fillColor(muted).font('Helvetica').fontSize(6.5).text('Form No.: VGH/PROC/MRF/001  |  Rev. 00  |  Page 1 of 1  |  Generated from Hospital Construction ERP', left, footerY + 18, { width, align: 'center' });

  doc.end();
}
