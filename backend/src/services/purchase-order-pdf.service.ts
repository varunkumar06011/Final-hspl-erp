import PDFDocument from 'pdfkit';
import { getStorageService } from './storage.service';
import { POPaymentType } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

export async function streamPurchaseOrderPdf(res: NodeJS.WritableStream, po: any) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(res as unknown as any);

  const pageW = 595;
  const pageH = 842;
  const left = 40;
  const right = pageW - 40;
  const width = pageW - 80;

  const teal = '#00695c';
  const tealLight = '#e0f2f1';
  const dark = '#263238';
  const muted = '#546e7a';
  const border = '#b0bec5';

  const fmtMoney = (n: number) => `Rs. ${Number(n).toFixed(2)}`;
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

  // Load logo if present
  let logoBuffer: Buffer | null = null;
  if (po.project?.logoUrl) {
    try {
      logoBuffer = await getStorageService().getFile(po.project.logoUrl);
    } catch {
      logoBuffer = null;
    }
  }

  // Find project users in named approver roles for the signature boxes
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

  // ── Top header bar ──
  doc.rect(0, 0, pageW, 110).fill(teal);

  // Logo on the left
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left, 20, { height: 70 });
    } catch {}
  }

  // Title block
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text(text(po.project?.name ?? 'Hospital Construction ERP'), left + (logoBuffer ? 90 : 0), 25);
  doc.font('Helvetica').fontSize(9).fillColor(tealLight).text(text(po.project?.officeAddress ?? 'V Grand Health Care Pvt. Ltd.'), left + (logoBuffer ? 90 : 0), 52, { width: 280 });

  // PO number box on the right
  doc.roundedRect(pageW - 200, 20, 160, 70, 4).fill('#fff');
  doc.fillColor(teal).font('Helvetica-Bold').fontSize(11).text('PO NUMBER', pageW - 190, 32);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text(po.poNumber, pageW - 190, 52);

  let y = 130;

  // ── Subtitle header ──
  doc.fillColor(teal).font('Helvetica-Bold').fontSize(16).text('PURCHASE ORDER', left, y);
  y += 28;

  // ── Two column info area ──
  const leftCol = left;
  const leftW = width * 0.48;
  const rightCol = left + leftW + 24;
  const rightW = width * 0.52;

  const label = (l: string, v: string, x: number, yy: number, ww: number) => {
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(`${l}:`, x, yy, { width: 80 });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(v, x + 80, yy, { width: ww - 80 });
  };

  const paymentTerms = po.paymentTerms || (po.paymentType === POPaymentType.AFTER_DELIVERY ? 'Net 30 Days (After Delivery & Inspection)' : '—');
  const projectHeadApproved = approvedByRole['PROJECT_HEAD'];

  label('Date', new Date(po.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), leftCol, y, leftW);
  y += 16;
  label('Created By', text(po.createdByUser?.name), leftCol, y, leftW);
  y += 16;
  label('Delivery Due Date', po.deliveryDate ? new Date(po.deliveryDate).toLocaleDateString('en-IN') : '—', leftCol, y, leftW);
  y += 16;
  label('Payment Terms', text(paymentTerms), leftCol, y, leftW);
  y += 16;
  label('Project Head', projectHeadApproved ? `${head?.name ?? '—'} (Approved)` : `${head?.name ?? '—'} (Pending)`, leftCol, y, leftW);

  // ── Vendor Details box on the right ──
  const vh = 95;
  doc.roundedRect(rightCol, 150, rightW, vh, 4).stroke(border);
  doc.rect(rightCol, 150, rightW, 22).fill(teal);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text('VENDOR DETAILS:', rightCol + 8, 156);

  const vData = [
    ['Name', text(po.vendor?.name)],
    ['Contact', text(po.vendor?.phone ?? po.vendor?.contactPersonPhone)],
    ['GSTIN', text(po.vendor?.gstNumber)],
    ['PAN', text(po.vendor?.panNumber)],
  ];

  let vy = 178;
  for (const [k, v] of vData) {
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(`${k}:`, rightCol + 8, vy, { width: 60 });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(v, rightCol + 70, vy, { width: rightW - 80 });
    vy += 16;
  }

  y = Math.max(y + 20, 150 + vh + 20);

  // ── Bill To & Delivery address boxes ──
  const half = width / 2;
  const boxH = 75;

  // Bill To
  doc.roundedRect(left, y, half - 10, boxH, 4).stroke(border);
  doc.rect(left, y, half - 10, 22).fill(teal);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text('BILL TO:', left + 8, y + 6);
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(text(po.project?.name), left + 8, y + 30);
  doc.fillColor(dark).font('Helvetica').fontSize(8).text(text(po.project?.officeAddress), left + 8, y + 44, { width: half - 26 });
  doc.fillColor(muted).font('Helvetica').fontSize(7).text(`GSTIN: ${text(po.project?.gstNumber)} | PAN: ${text(po.project?.panNumber)}`, left + 8, y + boxH - 12, { width: half - 26 });

  // Delivery
  doc.roundedRect(left + half + 10, y, half - 10, boxH, 4).stroke(border);
  doc.rect(left + half + 10, y, half - 10, 22).fill(teal);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text('DELIVERY ADDRESS (Hospital Site):', left + half + 18, y + 6);
  doc.fillColor(dark).font('Helvetica').fontSize(8).text(text(po.project?.hospitalAddress), left + half + 18, y + 30, { width: half - 36 });

  y += boxH + 20;

  // ── Items table ──
  const colSno = left;
  const colDesc = left + 40;
  const colQty = left + 290;
  const colUnit = left + 340;
  const colPrice = left + 390;
  const colTotal = left + 470;

  doc.rect(left, y, width, 24).fill(teal);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  doc.text('S.No', colSno + 6, y + 7, { width: 30 });
  doc.text('Item Description', colDesc + 6, y + 7, { width: 200 });
  doc.text('Qty', colQty + 6, y + 7, { width: 40, align: 'center' });
  doc.text('Unit', colUnit + 6, y + 7, { width: 40, align: 'center' });
  doc.text('Unit Price', colPrice + 6, y + 7, { width: 70, align: 'right' });
  doc.text('Total Amount', colTotal + 6, y + 7, { width: 80, align: 'right' });
  y += 24;

  const rowH = 22;
  for (let i = 0; i < Math.max(po.items.length, 5); i++) {
    const item = po.items[i];
    if (i % 2 === 0) doc.rect(left, y, width, rowH).fill(tealLight);
    if (item) {
      doc.fillColor(dark).font('Helvetica').fontSize(9);
      doc.text(String(i + 1), colSno + 6, y + 5, { width: 30, align: 'center' });
      doc.text(item.materialName, colDesc + 6, y + 5, { width: 240 });
      doc.text(String(item.quantity), colQty + 6, y + 5, { width: 40, align: 'center' });
      doc.text(item.unit ?? '', colUnit + 6, y + 5, { width: 40, align: 'center' });
      doc.text(fmtMoney(Number(item.unitPrice)), colPrice + 6, y + 5, { width: 70, align: 'right' });
      doc.text(fmtMoney(Number(item.amount)), colTotal + 6, y + 5, { width: 80, align: 'right' });
    }
    // row border
    doc.rect(left, y, width, rowH).stroke(border);
    y += rowH;
  }

  // ── Totals ──
  const totalsW = 220;
  const totalsX = right - totalsW;

  const line = (label: string, value: string, yy: number, bg = false) => {
    if (bg) doc.rect(totalsX, yy, totalsW, 22).fill(teal);
    else doc.rect(totalsX, yy, totalsW, 22).fill(tealLight).stroke(border);
    doc.fillColor(bg ? '#fff' : muted).font('Helvetica').fontSize(9).text(label, totalsX + 8, yy + 5, { width: 110 });
    doc.fillColor(bg ? '#fff' : dark).font('Helvetica-Bold').fontSize(9).text(value, totalsX + 120, yy + 5, { width: 90, align: 'right' });
  };

  y += 10;
  line('Subtotal:', fmtMoney(Number(po.totalAmount)), y);
  y += 22;
  const gstLabel = Number(po.gstAmount) > 0 ? `GST (${Number(po.items[0]?.gstRate ?? 0)}%):` : 'GST: Rs. 0 (No Gst Applicable)';
  line(gstLabel, Number(po.gstAmount) > 0 ? fmtMoney(Number(po.gstAmount)) : 'Rs. 0.00', y);
  y += 22;
  line('GRAND TOTAL (Inclusive of all taxes):', fmtMoney(Number(po.grandTotal)), y, true);
  y += 38;

  // ── Approval & Authorization boxes ──
  if (y > pageH - 140) {
    doc.addPage();
    y = 40;
  }

  doc.fillColor(teal).font('Helvetica-Bold').fontSize(11).text('APPROVAL & AUTHORIZATION:', left, y);
  y += 22;

  const sigW = (width - 20) / 3;
  const sigH = 75;
  const roles = [
    { label: 'Approver 1', role: 'PROJECT_HEAD', title: 'Construction Project Head', user: head },
    { label: 'Approver 2', role: 'ACCOUNTS_HEAD', title: 'Accounts Head', user: accountsHead },
    { label: 'Approver 3', role: 'ADMIN_2', title: 'Managing Director', user: md },
  ];

  for (let i = 0; i < roles.length; i++) {
    const sx = left + i * (sigW + 10);
    const { label, role, title, user: u } = roles[i];
    const approved = approvedByRole[role];

    doc.roundedRect(sx, y, sigW, sigH, 4).stroke(border);
    doc.fillColor(approved ? '#2e7d32' : muted).font('Helvetica-Bold').fontSize(10).text(`[ ${approved ? 'APPROVED' : 'PENDING'} ]`, sx + 8, y + 8, { width: sigW - 16, align: 'center' });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text(`${label}: ${u?.name ?? approved?.name ?? '—'}`, sx + 8, y + 28, { width: sigW - 16, align: 'center' });
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(`(${title})`, sx + 8, y + 44, { width: sigW - 16, align: 'center' });
    if (approved?.at) {
      doc.fillColor(muted).font('Helvetica').fontSize(7).text(new Date(approved.at).toLocaleDateString('en-IN'), sx + 8, y + 60, { width: sigW - 16, align: 'center' });
    }
  }

  // ── Footer ──
  y += sigH + 20;
  doc.moveTo(left, y).lineTo(right, y).stroke(teal);
  doc.fillColor(muted).font('Helvetica').fontSize(7).text(`Generated from Hospital Construction ERP — ${new Date().toLocaleDateString('en-IN')}`, left, y + 8, { width, align: 'center' });

  doc.end();
}
