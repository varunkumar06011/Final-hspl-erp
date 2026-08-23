import PDFDocument from 'pdfkit';

const text = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

export function streamGatePassPdf(res: NodeJS.WritableStream, gatePass: any) {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  doc.pipe(res);
  const width = 511;
  const primary = '#1a5276';
  const muted = '#6b7280';
  const light = '#eef4f8';
  const row = (label: string, value: unknown, x: number, y: number, w: number) => {
    doc
      .fillColor(muted)
      .font('Helvetica')
      .fontSize(7)
      .text(label.toUpperCase(), x, y, { width: w });
    doc
      .fillColor('#263238')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(text(value), x, y + 9, { width: w });
  };
  const section = (title: string) => {
    doc.moveDown(1).rect(42, doc.y, width, 22).fill(light);
    doc
      .fillColor(primary)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(title.toUpperCase(), 50, doc.y + 7);
    doc.moveDown(1.8);
  };

  doc.rect(0, 0, 595, 78).fill(primary);
  doc
    .fillColor('#fff')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(text(gatePass.project?.name ?? 'Hospital Construction ERP'), 42, 18);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#d9eaf5')
    .text(text(gatePass.project?.hospitalAddress ?? gatePass.project?.officeAddress), 42, 46, {
      width: 335,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#fff')
    .text('GATE PASS', 415, 20, { width: 138, align: 'right' });
  doc.fontSize(10).text(text(gatePass.passNumber), 415, 45, { width: 138, align: 'right' });
  doc.y = 95;
  row('Date', new Date(gatePass.date).toLocaleDateString('en-IN'), 42, doc.y, 120);
  row('Time', gatePass.visitTime, 180, doc.y, 100);
  row('Status', gatePass.status, 300, doc.y, 100);
  row('Type', gatePass.gatePassType, 420, doc.y, 133);
  doc.y += 38;

  section('Visitor and vehicle details');
  row('Visitor / person', gatePass.visitorName, 42, doc.y, 160);
  row('Purpose', gatePass.purpose, 220, doc.y, 175);
  row('Vehicle type', gatePass.vehicleType, 410, doc.y, 123);
  doc.y += 38;
  row('Vehicle number', gatePass.vehicleNumber, 42, doc.y, 160);
  row('Driver name', gatePass.driverName, 220, doc.y, 175);
  row('Driver mobile', gatePass.driverMobile, 410, doc.y, 123);
  doc.y += 38;

  section('Purchase order and vendor');
  row('Purchase order', gatePass.purchaseOrder?.poNumber, 42, doc.y, 160);
  row('Vendor code', gatePass.purchaseOrder?.vendor?.vendorCode, 220, doc.y, 100);
  row('Vendor', gatePass.purchaseOrder?.vendor?.name, 340, doc.y, 193);
  doc.y += 38;
  row('Invoice', gatePass.invoice?.invoiceNumber ?? gatePass.invoice?.invoiceCode, 42, doc.y, 160);
  row('Project / site', gatePass.project?.name, 220, doc.y, 160);
  row(
    'Site address',
    gatePass.project?.hospitalAddress ?? gatePass.project?.officeAddress,
    400,
    doc.y,
    133,
  );
  doc.y += 38;

  section('Material movement');
  row('Movement', gatePass.materialMovement ? 'Yes' : 'No', 42, doc.y, 100);
  row('Remarks', gatePass.remarks, 160, doc.y, 373);
  doc.y += 30;
  doc.fillColor(primary).rect(42, doc.y, width, 22).fill();
  doc
    .fillColor('#fff')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('MATERIAL / DESCRIPTION', 50, doc.y + 7);
  doc.text('QUANTITY', 450, doc.y + 7, { width: 90, align: 'right' });
  doc.y += 22;
  for (const item of gatePass.items ?? []) {
    const y = doc.y;
    doc
      .fillColor('#263238')
      .font('Helvetica')
      .fontSize(9)
      .text(text(item.materialName), 50, y + 7, { width: 365 });
    doc.text(
      `${text(item.quantity)} ${text(item.unit === null ? '' : item.unit).replace('—', '')}`.trim(),
      450,
      y + 7,
      { width: 90, align: 'right' },
    );
    doc
      .strokeColor('#d8dee4')
      .moveTo(42, y + 22)
      .lineTo(553, y + 22)
      .stroke();
    doc.y = y + 22;
  }

  doc.moveDown(2);
  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(8)
    .text(`Issued by: ${text(gatePass.createdByUser?.name)}`, 42, doc.y);
  doc.text(
    `OTP approver: ${text(gatePass.otpRequestedForUser?.name)}   Approval: ${gatePass.status === 'APPROVED' ? text(gatePass.otpApprovedByUser?.name) : 'Pending OTP approval'}`,
    42,
    doc.y + 16,
  );
  doc.text(
    'This document is generated when the gate pass is created. It is subject to the approval status shown above.',
    42,
    doc.y + 42,
    { width },
  );
  doc.end();
}
