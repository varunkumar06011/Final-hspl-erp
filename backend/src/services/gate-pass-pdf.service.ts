import PDFDocument from 'pdfkit';

const text = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

export function streamGatePassPdf(res: NodeJS.WritableStream, gatePass: any) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(res);

  const pageWidth = 595;
  const left = 48;
  const top = 44;
  const width = 499;
  const right = left + width;
  const primary = '#1a5276';
  const primaryLight = '#d4e6f1';
  const textDark = '#2c3e50';
  const muted = '#6b7280';
  const border = '#718096';
  const rowHeight = 22;

  const line = (x1: number, y1: number, x2: number, y2: number, color = border) => {
    doc.strokeColor(color).lineWidth(0.7).moveTo(x1, y1).lineTo(x2, y2).stroke();
  };
  const cell = (label: string, value: unknown, x: number, y: number, w: number, h = rowHeight) => {
    doc
      .fillColor(muted)
      .font('Helvetica')
      .fontSize(6.5)
      .text(label.toUpperCase(), x + 5, y + 4, { width: w - 10 });
    doc
      .fillColor(textDark)
      .font('Helvetica')
      .fontSize(8)
      .text(text(value), x + 5, y + 11, { width: w - 10, height: h - 12, ellipsis: true });
  };
  const sectionTitle = (title: string, y: number) => {
    doc.rect(left, y, width, 20).fill(primaryLight);
    doc
      .fillColor(primary)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(title.toUpperCase(), left + 7, y + 6);
  };
  const address = (place: any) => text(place?.hospitalAddress ?? place?.officeAddress);
  const date = gatePass.date ? new Date(gatePass.date).toLocaleDateString('en-IN') : '—';
  const approval =
    gatePass.status === 'APPROVED'
      ? text(gatePass.otpApprovedByUser?.name)
      : 'Pending OTP approval';

  // Clean PO-style header without logos.
  doc.rect(0, 0, pageWidth, 8).fill(primary);
  doc
    .fillColor(primary)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(text(gatePass.project?.name ?? 'Hospital Construction ERP'), left, top);
  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(8)
    .text(address(gatePass.project), left, top + 23, { width: 320 });
  doc
    .fillColor(textDark)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('GATE PASS', 390, top + 2, { width: 157, align: 'right' });
  doc
    .fillColor(primary)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(text(gatePass.passNumber), 390, top + 25, { width: 157, align: 'right' });
  line(left, top + 44, right, top + 44, primary);

  let y = top + 52;
  doc
    .fillColor(primary)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(
      gatePass.gatePassCategory === 'VISITOR'
        ? 'VISITOR GATE PASS'
        : `MATERIAL GATE PASS (${gatePass.gatePassType === 'RETURNABLE' ? 'RETURNABLE' : 'NON-RETURNABLE'})`,
      left,
      y,
      { width, align: 'center' },
    );
  y += 14;
  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(7)
    .text(
      gatePass.gatePassCategory === 'VISITOR' ? 'For authorized visitor entry only' : 'For authorized material movement only',
      left,
      y,
      { width, align: 'center' },
    );
  y += 14;

  // Document references and visit information.
  sectionTitle('Document and visit details', y);
  y += 20;
  const metaWidths = [125, 125, 125, 124];
  const meta = [
    ['GSTIN', gatePass.project?.gstNumber],
    ['PO number', gatePass.purchaseOrder?.poNumber],
    ['Invoice number', gatePass.invoice?.invoiceNumber ?? gatePass.invoice?.invoiceCode],
    ['Visit date', date],
    ['Visit time', gatePass.visitTime],
    ['Gate pass status', gatePass.status],
    ['Movement type', gatePass.gatePassType],
    ['Approval', approval],
  ];
  meta.forEach(([label, value], index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = left + metaWidths.slice(0, column).reduce((sum, item) => sum + item, 0);
    const cellY = y + row * rowHeight;
    cell(String(label), value, x, cellY, metaWidths[column]);
    line(x, cellY, x, cellY + rowHeight);
    if (column === 3) line(left, cellY + rowHeight, right, cellY + rowHeight);
  });
  line(right, y, right, y + rowHeight * 2);
  y += rowHeight * 2;

  // Form-style From/To section matching the reference layout.
  sectionTitle(gatePass.gatePassCategory === 'VISITOR' ? 'Visit details' : 'Movement details', y);
  y += 20;
  const half = width / 2;
  cell('From', gatePass.project?.name, left, y, half, 48);
  cell(
    'To',
    gatePass.gatePassCategory === 'VISITOR' ? gatePass.visitorName : gatePass.purchaseOrder?.vendor?.name,
    left + half,
    y,
    half,
    48,
  );
  doc
    .fillColor(textDark)
    .font('Helvetica')
    .fontSize(8)
    .text(address(gatePass.project), left + 5, y + 27, {
      width: half - 10,
      height: 16,
      ellipsis: true,
    });
  doc
    .fillColor(textDark)
    .font('Helvetica')
    .fontSize(8)
    .text(
      gatePass.purpose ? `Purpose: ${gatePass.purpose}` : 'Purpose: —',
      left + half + 5,
      y + 27,
      { width: half - 10, height: 16, ellipsis: true },
    );
  line(left, y, right, y);
  line(left, y + 48, right, y + 48);
  line(left + half, y, left + half, y + 48);
  line(left, y, left, y + 48);
  line(right, y, right, y + 48);
  y += 48;

  sectionTitle('Visitor and vehicle details', y);
  y += 20;
  const detailWidths = [166, 166, 167];
  const details = gatePass.gatePassCategory === 'VISITOR'
    ? [
        ['Visitor / person', gatePass.visitorName],
        ['Visitor phone', gatePass.visitorPhone],
        ['Visit time', gatePass.visitTime],
        ['Purpose', gatePass.purpose],
        ['Gate pass status', gatePass.status],
        ['Approval', approval],
      ]
    : [
        ['Vehicle type', gatePass.vehicleType],
        ['Vehicle number', gatePass.vehicleNumber],
        ['Driver name', gatePass.driverName],
        ['Driver mobile', gatePass.driverMobile],
        ['Material movement', gatePass.materialMovement ? 'Yes' : 'No'],
        ['Gate pass status', gatePass.status],
      ];
  details.forEach(([label, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = left + column * detailWidths[0];
    const cellY = y + row * rowHeight;
    cell(String(label), value, x, cellY, detailWidths[column]);
    line(x, cellY, x, cellY + rowHeight);
    if (column === 2) line(left, cellY + rowHeight, right, cellY + rowHeight);
  });
  line(right, y, right, y + rowHeight * 2);
  y += rowHeight * 2;

  if (gatePass.gatePassCategory !== 'VISITOR') {
    sectionTitle('Material details', y);
    y += 20;
    const materialHeader = 22;
  const qtyX = right - 92;
  doc.rect(left, y, width, materialHeader).fill(primary);
  doc
    .fillColor('#fff')
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text('MATERIAL / DESCRIPTION', left + 7, y + 7);
  doc.text('UNIT', qtyX - 45, y + 7, { width: 40, align: 'right' });
  doc.text('QTY', right - 38, y + 7, { width: 31, align: 'right' });
  y += materialHeader;
  const items = gatePass.items ?? [];
  const materialRows = Math.max(items.length, 5);
  for (let index = 0; index < materialRows; index += 1) {
    const item = items[index];
    const itemHeight = 23;
    if (item) {
      doc
        .fillColor(textDark)
        .font('Helvetica')
        .fontSize(8)
        .text(text(item.materialName), left + 7, y + 7, {
          width: qtyX - left - 17,
          ellipsis: true,
        });
      doc.text(text(item.unit), qtyX - 45, y + 7, { width: 40, align: 'right' });
      doc.text(text(item.quantity), right - 38, y + 7, { width: 31, align: 'right' });
    }
    line(left, y + itemHeight, right, y + itemHeight);
    y += itemHeight;
  }
  line(qtyX, y - materialRows * 23 - materialHeader, qtyX, y);
  line(right - 47, y - materialRows * 23 - materialHeader, right - 47, y);
    y += 2;
  }

  sectionTitle('Gate record', y);
  y += 20;
  const recordWidths = [166, 166, 167];
  [
    ['Vehicle no.', gatePass.vehicleNumber],
    [
      'Out time',
      gatePass.status === 'APPROVED'
        ? new Date(gatePass.otpApprovedAt ?? gatePass.date).toLocaleString('en-IN')
        : '—',
    ],
    [
      'PO / Invoice ref.',
      `${text(gatePass.purchaseOrder?.poNumber)} / ${text(gatePass.invoice?.invoiceNumber ?? gatePass.invoice?.invoiceCode)}`,
    ],
  ].forEach(([label, value], index) => {
    const x = left + index * recordWidths[0];
    cell(String(label), value, x, y, recordWidths[index]);
    line(x, y, x, y + rowHeight);
  });
  line(right, y, right, y + rowHeight);
  line(left, y + rowHeight, right, y + rowHeight);
  y += rowHeight;

  if (gatePass.remarks) {
    cell('Remarks', gatePass.remarks, left, y, width, 30);
    line(left, y, left, y + 30);
    line(right, y, right, y + 30);
    line(left, y + 30, right, y + 30);
    y += 30;
  }

  // Signature row.
  y += 18;
  const signatureY = y + 22;
  [
    ['Checked by', gatePass.createdByUser?.name],
    ['Store keeper', ''],
    [
      'Approved by',
      gatePass.status === 'APPROVED' ? gatePass.otpApprovedByUser?.name : 'Pending OTP',
    ],
  ].forEach(([label, name], index) => {
    const x = left + index * 166;
    line(x + 8, signatureY, x + 150, signatureY);
    doc
      .fillColor(muted)
      .font('Helvetica')
      .fontSize(7)
      .text(String(label), x + 8, signatureY + 5, { width: 142, align: 'center' });
    if (name)
      doc
        .fillColor(textDark)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(text(name), x + 8, signatureY + 17, { width: 142, align: 'center' });
  });
  doc
    .fillColor(muted)
    .font('Helvetica')
    .fontSize(6.5)
    .text(
      'Generated from the Gate Pass record. Approval status is shown above; OTP is not required to download this document.',
      left,
      signatureY + 38,
      { width, align: 'center' },
    );
  doc.end();
}
